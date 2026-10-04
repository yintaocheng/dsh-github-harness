import { realpathSync } from 'node:fs';
import { command, git } from './process.mjs';
import { hash } from './core.mjs';

export function remoteMatches(url, config) {
  return [
    `https://github.com/${config.owner}/${config.repo}`, `https://github.com/${config.owner}/${config.repo}.git`,
  ].some(x => x.toLowerCase() === url.toLowerCase());
}
// Bind Git HTTPS to exactly the token already verified by GET /user.
export function gitAuthEnv(token, parent = process.env) {
  if (!token) throw Error('Verified GitHub credential required for Git transport');
  const env = { ...parent, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of Object.keys(env)) if (/^GIT_TRACE|^GIT_CURL_VERBOSE$|^GIT_CONFIG_PARAMETERS$/i.test(key)) delete env[key];
  let count = Number(env.GIT_CONFIG_COUNT || 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100) throw Error('Invalid inherited Git configuration count');
  for (const [key, value] of [
    ['credential.helper', ''], ['http.extraHeader', ''],
    ['http.https://github.com/.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`],
  ]) { env[`GIT_CONFIG_KEY_${count}`] = key; env[`GIT_CONFIG_VALUE_${count++}`] = value; }
  env.GIT_CONFIG_COUNT = String(count);
  return env;
}
const names = text => text.split('\0').filter(Boolean);
export class Repo {
  constructor(config, cwd, onSpawn, token, signal) { this.config = config; this.cwd = cwd; this.options = { cwd, onSpawn, signal }; this.token = token; }
  git(args) { return git(args, ['fetch', 'push'].includes(args[0]) ? { ...this.options, env: gitAuthEnv(this.token) } : this.options); }
  async identity() {
    const root = await this.git(['rev-parse', '--show-toplevel']);
    if (realpathSync(root).toLowerCase() !== realpathSync(this.cwd).toLowerCase()) throw Error('Run from the repository root, not a parent or child directory');
    for (const args of [['remote', 'get-url', 'origin'], ['remote', 'get-url', '--push', 'origin']]) {
      if (!remoteMatches(await this.git(args), this.config)) throw Error('origin or push URL does not match configured GitHub owner/repo');
    }
    for (const file of ['.harness/probe', '.reference/probe']) {
      const ignored = await command(['git', 'check-ignore', '-q', '--', file], this.options);
      if (ignored.code !== 0) throw Error('Add .harness/ and .reference/ to .gitignore before running');
    }
  }
  head() { return this.git(['rev-parse', 'HEAD']); }
  async prepare(state, pr) {
    await this.identity();
    const current = await this.git(['branch', '--show-current']);
    const dirty = await this.git(['status', '--porcelain']);
    if (dirty && !(current === state.branch && ['working', 'validated'].includes(state.phase))) throw Error('Unrelated or uncheckpointed dirty worktree; preserve it and resolve manually');
    await this.git(['fetch', 'origin']);
    const local = await command(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${state.branch}`], this.options);
    const remote = await command(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${state.branch}`], this.options);
    if (![0, 1].includes(local.code) || ![0, 1].includes(remote.code)) throw Error('Cannot inspect task branch');
    if (current !== state.branch) {
      if (local.code === 0) await this.git(['switch', state.branch]);
      else if (remote.code === 0) await this.git(['switch', '--track', '-c', state.branch, `origin/${state.branch}`]);
      else await this.git(['switch', '-c', state.branch, `origin/${this.config.base}`]);
    }
    if (remote.code === 0) {
      const remoteHead = await this.git(['rev-parse', `origin/${state.branch}`]);
      if (pr && pr.head.sha !== remoteHead) throw Error('Remote branch changed during snapshot; rerun');
      if (remoteHead !== await this.head()) {
        const ancestor = await command(['git', 'merge-base', '--is-ancestor', remoteHead, 'HEAD'], this.options);
        if (ancestor.code !== 0) throw Error('Remote branch is ahead or diverged; reconcile manually (never force-pushed)');
      }
    }
    if (!state.startHead) state.startHead = await this.head();
  }
  async verify(commands) {
    const results = [];
    for (const argv of commands) {
      const r = await command(argv, this.options);
      results.push({ command: argv, code: r.code, stdout: r.out, stderr: r.err });
    }
    return results;
  }
  async stage(state) {
    if (await this.git(['branch', '--show-current']) !== state.branch) throw Error('Agent changed task branch');
    await this.git(['add', '--all', '--', '.']);
    const tree = await this.git(['write-tree']);
    const oldHead = await this.head();
    const base = await this.git(['merge-base', `origin/${this.config.base}`, oldHead]);
    // Freeze and scan Git blobs in THIS delivery, including earlier task commits.
    // Existing, unchanged images/data are not subjected to the new-file size limit.
    const delivery = names(await this.git(['diff', '--name-only', '--no-renames', '-z', base, tree, '--']));
    const changedFiles = names(await this.git(['diff', '--name-only', '--diff-filter=ACMRT', '--no-renames', '-z', base, tree, '--']));
    const entries = new Map(names(await this.git(['ls-tree', '-r', '-z', tree])).map(entry => {
      const tab = entry.indexOf('\t');
      return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')];
    }));
    // Runtime state must never be tracked, even if it predates this task.
    for (const name of entries.keys()) if (/^\.(harness|reference)\//i.test(name)) throw Error(`Refusing sensitive/generated file: ${name}`);
    for (const name of changedFiles) {
      if (/(^|\/)\.env($|\.)|\.(pem|p12|key)$|\.local\.json$/i.test(name)) throw Error(`Refusing sensitive/generated file: ${name}`);
      const [mode, type, oid] = entries.get(name) || [];
      if (mode === '120000') throw Error('MVP does not publish symlinks');
      if (type !== 'blob') throw Error(`Unsupported candidate file type: ${name}`);
      if (Number(await this.git(['cat-file', '-s', oid])) > 2 * 1024 * 1024) throw Error(`File too large for minimal publication guard: ${name}`);
      // Do not retain raw candidate content (especially a rejected secret) in diagnostic logs.
      const blob = await command(['git', 'cat-file', 'blob', oid], { ...this.options, discardLogs: true });
      if (blob.code !== 0) throw Error(`Cannot read candidate Git blob: ${name}`);
      const text = blob.stdout;
      if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw Error(`Potential credential in ${name}; refusing publication`);
    }
    const changed = names(await this.git(['diff', '--name-only', '--no-renames', '-z', oldHead, tree, '--']));
    return { tree, oldHead, changed, base, reviewable: delivery.length > 0 };
  }
  async commitResult(state, head) {
    if (head !== state.prepared.oldHead) {
      const parents = (await this.git(['rev-list', '--parents', '-n', '1', head])).split(' ').slice(1);
      if (parents.length !== 1 || parents[0] !== state.prepared.oldHead) throw Error('Unexpected HEAD parent during commit/recovery');
    }
    const tree = await this.git(['rev-parse', `${head}^{tree}`]);
    return { head, tree, needsValidation: tree !== state.prepared.tree };
  }
  async recoverCommit(state) {
    if (!state.prepared?.oldHead) throw Error('Validated state is missing its commit intent');
    const head = await this.head();
    return head === state.prepared.oldHead ? null : this.commitResult(state, head);
  }
  async commit(state) {
    if (await this.git(['branch', '--show-current']) !== state.branch) throw Error('Task branch changed');
    const recovered = await this.recoverCommit(state);
    if (recovered) return recovered;
    if (await this.git(['diff', '--name-only'])) throw Error('Worktree changed after verification');
    if (await this.git(['ls-files', '--others', '--exclude-standard'])) throw Error('Untracked changes after verification');
    if (await this.git(['write-tree']) !== state.prepared.tree) throw Error('Index changed after verification');
    if (state.prepared.changed.length) await this.git(['-c', `user.name=${this.config.agent.expectedLogin}`, '-c', `user.email=${this.config.agent.expectedLogin}@users.noreply.github.com`, 'commit', '-m', `Resolve task ${state.key}`]);
    // A successful git commit is NOT proof that hooks preserved the tested tree.
    return this.commitResult(state, await this.head());
  }
  async push(state) {
    await this.identity();
    if (await this.git(['branch', '--show-current']) !== state.branch || await this.head() !== state.head || await this.git(['status', '--porcelain'])) throw Error('Branch, HEAD or worktree changed before publication');
    if (state.validation?.verifyHash !== hash(this.config.verify) || state.validation?.tree !== await this.git(['rev-parse', `${state.head}^{tree}`])) throw Error('Publication candidate lacks matching tree/config verification');
    // Pin the immutable object, not a symbolic HEAD that a pre-push hook could change.
    await this.git(['push', '--set-upstream', 'origin', `${state.head}:refs/heads/${state.branch}`]);
  }
}
