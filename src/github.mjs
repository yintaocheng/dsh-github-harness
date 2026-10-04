export class GitHub {
  constructor(config, { token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
    if (!token) throw Error('No GitHub credential. Set GH_TOKEN in the environment or use scripts/run.ps1 (Git Credential Manager).');
    this.config = config; this.token = token; this.fetch = fetchImpl;
    this.root = `/repos/${config.owner}/${config.repo}`;
  }
  async request(path, { method = 'GET', body, allow404 = false } = {}) {
    const response = await this.fetch(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && allow404) return null;
    // Never print response bodies or request headers: they may echo sensitive data.
    if (!response.ok) throw Error(`GitHub ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
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
    if (user.login.toLowerCase() !== this.config.agent.expectedLogin.toLowerCase()) throw Error(`GitHub identity mismatch: expected ${this.config.agent.expectedLogin}, got ${user.login}`);
    return user.login;
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
