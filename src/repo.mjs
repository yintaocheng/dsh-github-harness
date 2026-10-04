import { realpathSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { command, git } from './process.mjs';

export function remoteMatches(url, config) {
  return [
    `https://github.com/${config.owner}/${config.repo}`, `https://github.com/${config.owner}/${config.repo}.git`,
  ].some(x => x.toLowerCase() === url.toLowerCase());
}
// Bind Git HTTPS to exactly the token already verified by GET /user. No token in
// argv, URL, Git config files or logs. The environment exists only for Git children.
export function gitAuthEnv(token, parent = process.env) {
  if (!token) throw Error('Verified GitHub credential required for Git transport');
  const env = { ...parent, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of Object.keys(env)) if (/^GIT_TRACE|^GIT_CURL_VERBOSE$|^GIT_CONFIG_PARAMETERS$/.test(key)) delete env[key];
  let count = Number(env.GIT_CONFIG_COUNT || 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100) throw Error('Invalid inherited Git configuration count');
  for (const [key, value] of [
    ['credential.helper', ''], ['http.extraHeader', ''],
    ['http.https://github.com/.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`],
  ]) { env[`GIT_CONFIG_KEY_${count}`] = key; env[`GIT_CONFIG_VALUE_${count++}`] = value; }
  env.GIT_CONFIG_COUNT = String(count);
  return env;
}
export class Repo {
  constructor(config, cwd, onSpawn, token) { this.config = config; this.cwd = cwd; this.options = { cwd, onSpawn }; this.token = token; }
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
    // Scan the actual candidate files, not model claims. This is a basic guard, not a full secret scanner.
    const names = (await this.git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    for (const name of names) {
      if (/^\.harness\/|^\.reference\/|(^|\/)\.env($|\.)|\.(pem|p12|key)$/i.test(name)) throw Error(`Refusing sensitive/generated file: ${name}`);
      const path = join(this.cwd, name);
      let stat; try { stat = lstatSync(path); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      if (stat.isSymbolicLink()) throw Error('MVP does not publish symlinks');
      if (!stat.isFile()) continue;
      if (stat.size > 2 * 1024 * 1024) throw Error(`File too large for minimal publication guard: ${name}`);
      const text = readFileSync(path, 'utf8');
      if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw Error(`Potential credential in ${name}; refusing publication`);
    }
    await this.git(['add', '--all', '--', '.']);
    const tree = await this.git(['write-tree']);
    const oldHead = await this.head();
    const changed = await this.git(['diff', '--cached', '--name-only']);
    return { tree, oldHead, changed: changed.split('\n').filter(Boolean) };
  }
  async commit(state) {
    if (await this.git(['branch', '--show-current']) !== state.branch) throw Error('Task branch changed');
    if (await this.git(['diff', '--name-only'])) throw Error('Worktree changed after verification');
    if (await this.git(['ls-files', '--others', '--exclude-standard'])) throw Error('Untracked changes after verification');
    if (await this.git(['write-tree']) !== state.prepared.tree) throw Error('Index changed after verification');
    const head = await this.head();
    if (head !== state.prepared.oldHead) {
      if (await this.git(['rev-parse', 'HEAD^{tree}']) !== state.prepared.tree || await this.git(['rev-parse', 'HEAD^']) !== state.prepared.oldHead) throw Error('Unexpected HEAD during commit recovery');
      return head;
    }
    if (state.prepared.changed.length) await this.git(['-c', `user.name=${this.config.agent.expectedLogin}`, '-c', `user.email=${this.config.agent.expectedLogin}@users.noreply.github.com`, 'commit', '-m', `Resolve task ${state.key}`]);
    const difference = await this.git(['rev-list', '--count', `origin/${this.config.base}..HEAD`]);
    if (difference === '0') throw Error('No task changes to review; no empty PR created');
    return this.head();
  }
  async push(state) {
    await this.identity();
    if (await this.git(['branch', '--show-current']) !== state.branch || await this.head() !== state.head || await this.git(['status', '--porcelain'])) throw Error('Branch, HEAD or worktree changed before publication');
    await this.git(['push', '--set-upstream', 'origin', `HEAD:refs/heads/${state.branch}`]);
  }
}
