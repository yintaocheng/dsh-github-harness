export class GitHub {
  constructor(config, { token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, fetchImpl = fetch, signal } = {}) {
    if (!token) throw Error('No GitHub credential. Set GH_TOKEN in the environment or use scripts/run.ps1 (Git Credential Manager).');
    this.config = config; this.token = token; this.fetch = fetchImpl; this.signal = signal;
    this.root = `/repos/${config.owner}/${config.repo}`;
  }
  async request(path, { method = 'GET', body, allow404 = false } = {}) {
    this.signal?.throwIfAborted();
    let response;
    try {
      response = await this.fetch(`https://api.github.com${path}`, {
        method, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
    } catch { throw Error(`GitHub ${method} ${path.split('?')[0]}: request failed`); }
    if (response.status === 404 && allow404) return null;
    // Never print response bodies or request headers: they may echo sensitive data.
    if (!response.ok) throw Object.assign(Error(`GitHub ${method} ${path.split('?')[0]}: HTTP ${response.status}`), { status: response.status });
    try { return response.status === 204 ? null : await response.json(); }
    catch { throw Error(`GitHub ${method} ${path.split('?')[0]}: invalid JSON response`); }
  }
  async list(path, field) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const data = await this.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = field ? data[field] : data;
      if (!Array.isArray(rows)) throw Error('Unexpected GitHub list response');
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw Error('Feedback exceeds 2000 records; refusing to silently truncate');
  }
  async identity() {
    const user = await this.request('/user');
    if (typeof user?.login !== 'string') throw Error('Unexpected GitHub identity response');
    if (user.login.toLowerCase() !== this.config.agent.expectedLogin.toLowerCase()) throw Error(`GitHub identity mismatch: expected ${this.config.agent.expectedLogin}`);
    return user.login;
  }
  async diagnose() {
    // Fail closed on identity before probing the target or any of its resources.
    const login = await this.identity();
    const unverified = reason => ({ status: 'unverified', reason });
    const failed = error => {
      const httpStatus = Number.isInteger(error?.status) ? error.status : undefined;
      return {
        status: 'failed', httpStatus,
        reason: httpStatus === 403
          ? 'HTTP 403: required read access is unavailable (permission/policy denial or rate limiting).'
          : httpStatus === undefined ? 'Read request failed; no response body or transport error details are recorded.' : `Read request failed with HTTP ${httpStatus}.`,
      };
    };
    const notProbed = 'Repository is not verified; this read capability has not been tested.';
    const report = {
      login,
      repository: { expected: `${this.config.owner}/${this.config.repo}`, full_name: null, private: null, ...unverified(notProbed) },
      base: { ref: this.config.base, sha: null, permission: 'Contents: read', ...unverified(notProbed) },
      reads: Object.fromEntries(Object.entries({ issues: 'Issues: read', pulls: 'Pull requests: read', commitStatuses: 'Commit statuses: read', checks: 'Checks: read' })
        .map(([key, permission]) => [key, { permission, ...unverified(notProbed) }])),
      writes: unverified('Read-only diagnosis never attempts a write. Repository push permission does not prove token-specific write permissions.'),
      tokenPermissions: unverified('Successful GETs demonstrate access to those resources, not a token-scope inventory. Public resources may be readable without authentication or the named permission.'),
    };
    const finish = () => {
      // The summary covers reads only; write permissions and token scopes stay unverified.
      const results = [report.repository, report.base, ...Object.values(report.reads)];
      report.status = results.some(x => x.status === 'failed') ? 'failed' : results.every(x => x.status === 'available') ? 'ok' : 'unverified';
      return report;
    };
    let repository;
    try { repository = await this.request(this.root, { method: 'GET' }); }
    catch (error) {
      Object.assign(report.repository, error?.status === 404
        ? { ...unverified('HTTP 404: repository is not created or is not visible to this credential; bootstrap may still be required.'), httpStatus: 404 }
        : failed(error));
      return finish();
    }
    if (typeof repository?.full_name !== 'string' || repository.full_name.toLowerCase() !== report.repository.expected.toLowerCase()) throw Error('GitHub repository mismatch');
    Object.assign(report.repository, {
      status: 'available', full_name: repository.full_name, private: typeof repository.private === 'boolean' ? repository.private : null,
      reason: 'Repository identity matched the configured owner and repository.',
    });
    const probe = async (target, path, valid) => {
      target.path = path;
      try {
        const data = await this.request(path, { method: 'GET' });
        Object.assign(target, valid(data)
          ? { status: 'available', reason: 'GET succeeded with the expected response shape; resource read access was observed.' }
          : { status: 'failed', reason: 'GET returned an unexpected response shape; read capability was not verified.' });
      } catch (error) { Object.assign(target, failed(error)); }
    };
    await probe(report.reads.issues, `${this.root}/issues?state=all&per_page=1`, Array.isArray);
    await probe(report.reads.pulls, `${this.root}/pulls?state=all&per_page=1`, Array.isArray);
    report.base.path = `${this.root}/branches/${encodeURIComponent(this.config.base)}`;
    try {
      const branch = await this.request(report.base.path, { method: 'GET' });
      const sha = branch?.commit?.sha;
      if (branch?.name !== this.config.base) {
        Object.assign(report.base, { status: 'failed', reason: 'Base branch identity did not match the configured branch.' });
      } else if (typeof sha === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) {
        Object.assign(report.base, { status: 'available', sha, reason: 'Configured base branch resolved to a commit.' });
      } else {
        Object.assign(report.base, { status: 'failed', reason: 'Base branch response did not contain a valid commit SHA.' });
      }
    } catch (error) {
      Object.assign(report.base, failed(error));
      // Only a successful branch-list read can support an empty/uninitialized diagnosis.
      // In particular, never reinterpret HTTP 403 as an empty repository.
      if (error?.status === 404 || error?.status === 409) {
        try {
          const branches = await this.request(`${this.root}/branches?per_page=1`, { method: 'GET' });
          if (!Array.isArray(branches)) {
            Object.assign(report.base, { status: 'failed', reason: 'Branch list response had an unexpected shape; no baseline could be verified.' });
          } else {
            Object.assign(report.base, unverified(branches.length
              ? 'Configured base branch is missing or unavailable; no baseline commit could be verified.'
              : 'No branches/baseline commit are available (empty or not yet initialized repository); commit-based reads remain unverified.'));
          }
        } catch (error) { Object.assign(report.base, failed(error)); }
      }
    }
    if (report.base.status === 'available') {
      const commit = `${this.root}/commits/${report.base.sha}`;
      await probe(report.reads.commitStatuses, `${commit}/statuses?per_page=1`, Array.isArray);
      await probe(report.reads.checks, `${commit}/check-runs?per_page=1`, data => Array.isArray(data?.check_runs));
    } else {
      for (const key of ['commitStatuses', 'checks']) Object.assign(report.reads[key], unverified(`No verified baseline SHA: ${report.base.reason}`));
    }
    return finish();
  }
  async verify() {
    const login = await this.identity();
    const repo = await this.request(this.root);
    if (repo.full_name.toLowerCase() !== `${this.config.owner}/${this.config.repo}`.toLowerCase()) throw Error('GitHub repository mismatch');
    if (!repo.permissions?.push) throw Error('Authenticated identity lacks repository push permission');
    return { login, repo };
  }
  async createRepository() {
    const login = await this.identity();
    if (login.toLowerCase() !== this.config.owner.toLowerCase()) throw Error('MVP bootstrap only creates a personal repository owned by the authenticated user');
    const existing = await this.request(this.root, { allow404: true });
    if (existing) { await this.verify(); return existing; }
    return this.request('/user/repos', { method: 'POST', body: { name: this.config.repo, private: true, description: 'Minimal single-agent GitHub task loop for DeepSeek Harness', auto_init: false } });
  }
  async pull(branch) {
    const rows = await this.list(`${this.root}/pulls?state=all&head=${encodeURIComponent(`${this.config.owner}:${branch}`)}`);
    if (rows.length > 1) throw Error('Multiple PRs for task branch; resolve manually');
    return rows[0] || null;
  }
  async snapshot(issueNumber, branch) {
    const issue = await this.request(`${this.root}/issues/${issueNumber}`);
    if (issue.pull_request) throw Error('Expected an Issue number, not a PR number');
    const comments = await this.list(`${this.root}/issues/${issueNumber}/comments`);
    const pr = await this.pull(branch);
    let feedback = {};
    if (pr) {
      const [comments, reviews, inline, checks, statuses] = await Promise.all([
        this.list(`${this.root}/issues/${pr.number}/comments`), this.list(`${this.root}/pulls/${pr.number}/reviews`),
        this.list(`${this.root}/pulls/${pr.number}/comments`), this.list(`${this.root}/commits/${pr.head.sha}/check-runs`, 'check_runs'),
        this.list(`${this.root}/commits/${pr.head.sha}/statuses`),
      ]);
      feedback = { comments, reviews, inline, checks, statuses };
    }
    return { issue, comments, pr, feedback };
  }
  async publishPull(branch, title, body) {
    await this.verify();
    const existing = await this.pull(branch);
    if (existing && existing.state !== 'open') throw Error('Task PR is closed or merged; refusing to recreate');
    return existing
      ? this.request(`${this.root}/pulls/${existing.number}`, { method: 'PATCH', body: { body } })
      : this.request(`${this.root}/pulls`, { method: 'POST', body: { head: branch, base: this.config.base, title, body } });
  }
  async checkpoint(issue, marker, body) {
    await this.verify();
    const rows = await this.list(`${this.root}/issues/${issue}/comments`);
    const existing = rows.filter(x => x.user.login.toLowerCase() === this.config.agent.expectedLogin.toLowerCase() && x.body.startsWith(marker));
    if (existing.length > 1) throw Error('Multiple task checkpoints; resolve manually');
    if (existing[0]?.body === body) return existing[0];
    return existing[0]
      ? this.request(`${this.root}/issues/comments/${existing[0].id}`, { method: 'PATCH', body: { body } })
      : this.request(`${this.root}/issues/${issue}/comments`, { method: 'POST', body: { body } });
  }
}
