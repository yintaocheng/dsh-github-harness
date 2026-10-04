import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/repo.mjs';
import { runTask, hash, taskKey, branchName } from '../src/core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t, { large = false } = {}) {
  const scratch = join(root, '.harness'); mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, 'repo-regression-'));
  t.after(() => {
    assert.equal(dirname(cwd), scratch); assert(basename(cwd).startsWith('repo-regression-'));
    rmSync(cwd, { recursive: true, force: true });
  });
  const config = { owner: 'fixture', repo: 'local', base: 'main', agent: { id: 'solo', expectedLogin: 'fixture' }, verify: [[process.execPath, '--input-type=module', '-e', "import{readFileSync}from'node:fs';process.exit(readFileSync('value.txt','utf8').trim()==='bad'?1:0)"]] };
  const repo = new Repo(config, cwd);
  await repo.git(['init', '-b', 'main']);
  await repo.git(['config', 'user.name', 'Fixture']); await repo.git(['config', 'user.email', 'fixture@example.invalid']);
  await repo.git(['config', 'core.autocrlf', 'false']);
  writeFileSync(join(cwd, '.gitignore'), '.harness/\n.reference/\n');
  writeFileSync(join(cwd, 'value.txt'), 'base\n');
  if (large) writeFileSync(join(cwd, 'existing.bin'), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
  await repo.git(['add', '--all']); await repo.git(['commit', '-m', 'baseline']);
  const base = await repo.head(); await repo.git(['update-ref', 'refs/remotes/origin/main', base]);
  const state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  await repo.git(['switch', '-c', state.branch]);
  const snapshot = { issue: { number: 1, title: 'Local regression', body: 'acceptance', state: 'open' }, comments: [], pr: null, feedback: {} };
  const counts = { agents: 0, pushes: 0, verifications: 0 };
  const nativeGit = repo.git.bind(repo), nativeVerify = repo.verify.bind(repo);
  // Only network operations are stubbed; staging, trees, tests, hooks and commits are real Git/Node.
  repo.identity = async () => {};
  repo.prepare = async s => { s.startHead ||= await repo.head(); };
  repo.git = async args => {
    if (args[0] !== 'push') return nativeGit(args);
    counts.pushes++; assert.equal(args.at(-1), `${state.head}:refs/heads/${state.branch}`);
    return '';
  };
  repo.verify = async commands => { counts.verifications++; return nativeVerify(commands); };
  const github = {
    async verify() {}, async snapshot() { return structuredClone(snapshot); },
    async publishPull(branch, title, body) {
      snapshot.pr = { number: 2, html_url: 'https://example.invalid/pull/2', state: 'open', base: { ref: 'main' }, head: { ref: branch, sha: await repo.head() }, body };
      return snapshot.pr;
    },
    async checkpoint(_issue, _marker, body) { snapshot.comments = [{ user: { login: 'fixture' }, body }]; },
  };
  const args = { config, state, issue: 1, repo, github, persist() {}, async agent() { counts.agents++; state.sessionId = 'fixture-session'; writeFileSync(join(cwd, 'value.txt'), 'good\n'); return 'Local fixture completed'; } };
  return { cwd, config, repo, state, snapshot, counts, args, base };
}

test('unchanged >2 MiB baseline file does not block a small task; changed large file does', async t => {
  const f = await fixture(t, { large: true });
  writeFileSync(join(f.cwd, 'value.txt'), 'good\n');
  const prepared = await f.repo.stage(f.state);
  assert.deepEqual(prepared.changed, ['value.txt']); assert.equal(prepared.reviewable, true);
  writeFileSync(join(f.cwd, 'existing.bin'), Buffer.alloc(2 * 1024 * 1024 + 2, 98));
  await assert.rejects(f.repo.stage(f.state), /File too large/);
});
test('new credentials and tracked runtime files remain blocked within candidate scope', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.cwd, 'new.txt'), 'ghp_' + 'x'.repeat(36));
  await assert.rejects(f.repo.stage(f.state), /Potential credential/);
  for (const name of readdirSync(join(f.cwd, '.harness', 'logs'))) assert(!readFileSync(join(f.cwd, '.harness', 'logs', name), 'utf8').includes('ghp_' + 'x'.repeat(36)), 'Rejected credential must not remain in logs');
  writeFileSync(join(f.cwd, 'new.txt'), 'safe');
  writeFileSync(join(f.cwd, '.harness', 'private.txt'), 'runtime');
  await f.repo.git(['add', '-f', '.harness/private.txt']);
  await assert.rejects(f.repo.stage(f.state), /sensitive\/generated/);
});
test('real pre-commit hook changes committed tree: failing new content is never published', async t => {
  const f = await fixture(t);
  const hook = join(f.cwd, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nprintf "bad\\n" > value.txt\ngit add value.txt\n'); chmodSync(hook, 0o755);
  await assert.rejects(runTask(f.args), /Verification failed/);
  assert.equal(readFileSync(join(f.cwd, 'value.txt'), 'utf8').trim(), 'bad');
  assert.notEqual(await f.repo.head(), f.base); assert.equal(await f.repo.git(['status', '--porcelain']), '');
  assert.equal(f.counts.verifications, 2); assert.equal(f.counts.pushes, 0); assert.equal(f.snapshot.pr, null);
  assert.equal(f.state.validation, undefined);
});
test('real hook with passing new content is revalidated and bound to actual HEAD tree', async t => {
  const f = await fixture(t);
  const hook = join(f.cwd, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nprintf "hook-good\\n" > value.txt\ngit add value.txt\n'); chmodSync(hook, 0o755);
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.counts.verifications, 2); assert.equal(f.counts.pushes, 1);
  assert.equal(f.state.validation.tree, await f.repo.git(['rev-parse', 'HEAD^{tree}']));
  assert.equal(f.state.validation.verifyHash, hash(f.config.verify));
  assert.equal(await f.repo.git(['rev-parse', 'HEAD^']), f.base);
});
test('commit recovery rejects an unexpected parent, even when the tree matches', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.cwd, 'value.txt'), 'good\n'); f.state.prepared = await f.repo.stage(f.state);
  await f.repo.git(['commit', '-m', 'first']); await f.repo.git(['commit', '--allow-empty', '-m', 'unexpected second']);
  assert.equal(await f.repo.git(['rev-parse', 'HEAD^{tree}']), f.state.prepared.tree);
  await assert.rejects(f.repo.recoverCommit(f.state), /Unexpected HEAD parent/);
});
test('real no-change task waits twice, then executes new feedback and publishes once', async t => {
  const f = await fixture(t);
  f.args.agent = async () => { f.counts.agents++; f.state.sessionId = 'fixture-session'; return 'Need clarification'; };
  assert.equal((await runTask(f.args)).status, 'waiting');
  assert.equal((await runTask(f.args)).status, 'unchanged'); assert.equal(f.counts.agents, 1);
  f.snapshot.comments.push({ user: { login: 'reviewer' }, body: 'Use the clarified requirement' });
  f.args.agent = async () => { f.counts.agents++; writeFileSync(join(f.cwd, 'value.txt'), 'good\n'); return 'Clarification implemented'; };
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.counts.agents, 2); assert.equal(f.counts.pushes, 1);
});
test('real unchanged published HEAD executes added acceptance instead of returning unchanged', async t => {
  const f = await fixture(t); await runTask(f.args); const head = await f.repo.head();
  f.config.verify.push([process.execPath, '-e', 'process.exit(1)']);
  await assert.rejects(runTask(f.args), /Verification failed/);
  assert.equal(await f.repo.head(), head); assert.equal(f.counts.agents, 1);
  assert.equal(f.counts.verifications, 2); assert.equal(f.counts.pushes, 1);
});
