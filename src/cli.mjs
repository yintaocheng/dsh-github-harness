#!/usr/bin/env node
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GitHub } from './github.mjs';
import { Repo, remoteMatches } from './repo.mjs';
import { load, save, acquire, unlock } from './state.mjs';
import { runDsh } from './dsh.mjs';
import { runTask, taskKey, branchName } from './core.mjs';
import { command, git } from './process.mjs';

export function validateConfig(c) {
  for (const [key, value] of [['owner', c.owner], ['repo', c.repo], ['agent.id', c.agent?.id], ['agent.expectedLogin', c.agent?.expectedLogin]]) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) || value.includes('..')) throw Error(`Invalid config ${key}`);
  }
  if (typeof c.base !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(c.base) || c.base.includes('..')) throw Error('Invalid base branch');
  if (!Array.isArray(c.dsh?.command) || !c.dsh.command.length || c.dsh.command.some(x => typeof x !== 'string')) throw Error('dsh.command must be an argv array');
  if (!Array.isArray(c.verify) || !c.verify.length || c.verify.some(x => !Array.isArray(x) || !x.length || x.some(a => typeof a !== 'string'))) throw Error('verify must contain explicit argv arrays');
  return c;
}
export async function main(argv = process.argv.slice(2)) {
  let configPath = 'harness.config.json';
  const index = argv.indexOf('--config');
  if (index >= 0) { configPath = argv[index + 1]; argv.splice(index, 2); }
  const [action = 'help', rawIssue, ...extra] = argv;
  if (action === 'help') {
    console.log('Usage: node src/cli.mjs [--config harness.local.json] doctor|bootstrap|run ISSUE|status ISSUE|unlock|issue-create TITLE BODY_FILE|comment ISSUE BODY_FILE');
    return;
  }
  const config = validateConfig(JSON.parse(readFileSync(resolve(configPath), 'utf8')));
  const cwd = process.cwd(), root = join(cwd, '.harness');
  mkdirSync(root, { recursive: true });
  if (action === 'unlock') { unlock(root); console.log('Unlocked stopped task'); return; }
  if (action === 'status') {
    const key = taskKey(config, Number(rawIssue));
    console.log(JSON.stringify({ task: load(join(root, `${key}.json`)), session: load(join(root, `${key}.session.json`)), lock: load(join(root, 'lock.json')) }, null, 2)); return;
  }
  const github = new GitHub(config);
  if (action === 'doctor') {
    const login = await github.identity();
    const repository = await github.request(github.root, { allow404: true });
    if (repository && repository.full_name.toLowerCase() !== `${config.owner}/${config.repo}`.toLowerCase()) throw Error('Repository mismatch');
    const dsh = await command([...config.dsh.command, '--help'], { cwd });
    console.log(JSON.stringify({ cwd, expectedOwner: config.owner, repository: repository?.full_name || 'not created', actualOperator: login, agentId: config.agent.id, dshHelpExit: dsh.code, dshHelp: dsh.stdout, diagnosticFile: dsh.err }, null, 2));
    if (dsh.code) throw Error('DSH command is not ready'); return;
  }
  const lock = acquire(root);
  try {
    const options = { cwd, onSpawn: pid => lock.child(pid) };
    if (action === 'bootstrap') {
      if ((await git(['rev-parse', '--show-toplevel'], options)).replaceAll('\\', '/').toLowerCase() !== cwd.replaceAll('\\', '/').toLowerCase()) throw Error('Run bootstrap at project repository root');
      const remotes = await git(['remote'], options);
      if (remotes.split('\n').includes('origin')) {
        for (const args of [['remote', 'get-url', 'origin'], ['remote', 'get-url', '--push', 'origin']]) if (!remoteMatches(await git(args, options), config)) throw Error('Existing origin does not match config');
      }
      const repository = await github.createRepository();
      if (!remotes.split('\n').includes('origin')) await git(['remote', 'add', 'origin', repository.clone_url], options);
      console.log(JSON.stringify({ repository: repository.full_name, private: repository.private, url: repository.html_url })); return;
    }
    if (action === 'issue-create') {
      await github.verify();
      if (!rawIssue || !extra[0]) throw Error('issue-create requires TITLE BODY_FILE');
      const issue = await github.request(`${github.root}/issues`, { method: 'POST', body: { title: rawIssue, body: readFileSync(resolve(extra[0]), 'utf8') } });
      console.log(JSON.stringify({ issue: issue.number, url: issue.html_url })); return;
    }
    const issue = Number(rawIssue);
    if (!Number.isSafeInteger(issue) || issue < 1) throw Error('Issue number must be a positive integer');
    if (action === 'comment') {
      await github.verify();
      if (!extra[0]) throw Error('comment requires ISSUE BODY_FILE');
      const comment = await github.request(`${github.root}/issues/${issue}/comments`, { method: 'POST', body: { body: readFileSync(resolve(extra[0]), 'utf8') } });
      console.log(JSON.stringify({ url: comment.html_url })); return;
    }
    if (action !== 'run') throw Error('Unknown action');
    const key = taskKey(config, issue), path = join(root, `${key}.json`);
    const state = load(path) || { version: 1, key, branch: branchName(config, issue) };
    if (state.key !== key || state.branch !== branchName(config, issue)) throw Error('Local task identity mismatch');
    const persist = () => save(path, state);
    const repo = new Repo(config, cwd, pid => lock.child(pid));
    const agent = prompt => runDsh({ config, state, prompt, root, cwd, onSpawn: pid => lock.child(pid), persist });
    const result = await runTask({ config, issue, state, github, repo, agent, persist });
    console.log(JSON.stringify(result, null, 2));
  } finally { lock.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
