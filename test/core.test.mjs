import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask, taskKey, branchName, facts, hash, markerFor } from '../src/core.mjs';
import { parseRun } from '../src/dsh.mjs';
import { remoteMatches } from '../src/repo.mjs';
import { validateConfig } from '../src/cli.mjs';
import { GitHub } from '../src/github.mjs';

const config = { owner: 'owner', repo: 'repo', base: 'main', agent: { id: 'solo', expectedLogin: 'actor' }, dsh: { command: ['dsh', 'headless'] }, verify: [['node', '--test']] };
function fixture() {
  const state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  const snapshot = { issue: { number: 1, title: 'task', body: 'acceptance', state: 'open' }, comments: [], pr: null, feedback: {} };
  const counts = { agents: 0, prs: 0, checkpoints: 0, commits: 0 };
  let head = 'base', publishFailure = false, checkpointFailure = false, validation = 0;
  const github = {
    async verify() { return { login: 'actor' }; }, async snapshot() { return structuredClone(snapshot); },
    async publishPull(branch, title, body) {
      if (!snapshot.pr) { counts.prs++; snapshot.pr = { number: 2, html_url: 'https://github.com/owner/repo/pull/2', state: 'open', head: { ref: branch, sha: head }, base: { ref: 'main' } }; }
      snapshot.pr.body = body; snapshot.pr.head.sha = head;
      if (publishFailure) { publishFailure = false; throw Error('lost PR response'); }
      return snapshot.pr;
    },
    async checkpoint(_issue, marker, body) {
      if (checkpointFailure) { checkpointFailure = false; throw Error('lost checkpoint'); }
      counts.checkpoints++;
      snapshot.comments = snapshot.comments.filter(x => !x.body.startsWith(marker));
      snapshot.comments.push({ id: 10, user: { login: 'actor' }, body });
    },
  };
  const repo = {
    async prepare() {}, async head() { return head; }, async verify() { return [{ command: ['node', '--test'], code: validation }]; },
    async stage() { return { tree: `tree-${counts.agents}`, oldHead: head, changed: ['code'] }; },
    async commit() { counts.commits++; head = `sha-${counts.commits}`; return head; }, async push() {},
  };
  const args = { config, issue: 1, state, github, repo, persist() {}, async agent() { counts.agents++; state.sessionId ||= 'session-one'; return 'Implemented. Tests passed. Unresolved: none.'; } };
  return { args, counts, snapshot, failPR() { publishFailure = true; }, failCheckpoint() { checkpointFailure = true; }, failValidation() { validation = 1; } };
}

test('first Issue creates one PR; repeated run reuses it without model or commit', async () => {
  const f = fixture();
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal((await runTask(f.args)).status, 'unchanged');
  assert.equal(f.counts.agents, 1); assert.equal(f.counts.prs, 1); assert.equal(f.counts.commits, 1);
});
test('new Issue, PR review and CI feedback resume SAME session and PR', async () => {
  const f = fixture(); await runTask(f.args);
  for (const kind of ['issue', 'review', 'ci']) {
    if (kind === 'issue') f.snapshot.comments.push({ id: 11, body: 'handle empty input', user: { login: 'actor' } });
    if (kind === 'review') f.snapshot.feedback.reviews = [{ id: 20, state: 'CHANGES_REQUESTED', body: 'add edge test', user: { login: 'reviewer' } }];
    if (kind === 'ci') f.snapshot.feedback.checks = [{ id: 30, name: 'ci', status: 'completed', conclusion: 'failure', head_sha: 'sha-3' }];
    assert.equal((await runTask(f.args)).status, 'published');
  }
  assert.equal(f.counts.agents, 4); assert.equal(f.counts.prs, 1); assert.equal(f.args.state.sessionId, 'session-one');
});
test('PR created but response lost: recover publication without another model call or PR', async () => {
  const f = fixture(); f.failPR(); await assert.rejects(runTask(f.args), /lost PR response/);
  assert.equal(f.args.state.phase, 'publishing');
  await runTask(f.args); assert.equal(f.counts.agents, 1); assert.equal(f.counts.prs, 1); assert.equal(f.args.state.phase, 'done');
});
test('checkpoint failure can be retried without losing new feedback', async () => {
  const f = fixture(); f.failCheckpoint(); await assert.rejects(runTask(f.args), /lost checkpoint/);
  f.snapshot.comments.push({ id: 22, user: { login: 'reviewer' }, body: 'new feedback while publishing' });
  await runTask(f.args); assert.equal(f.counts.agents, 1);
  await runTask(f.args); assert.equal(f.counts.agents, 2);
});
test('failed validation never publishes', async () => {
  const f = fixture(); f.failValidation(); await assert.rejects(runTask(f.args), /Verification failed/);
  assert.equal(f.counts.prs, 0); assert.equal(f.counts.commits, 0); assert.equal(f.args.state.phase, 'working');
});
test('closed or merged PR is never recreated', async () => {
  const f = fixture(); await runTask(f.args); f.snapshot.pr.state = 'closed';
  await assert.rejects(runTask(f.args), /closed or merged/); assert.equal(f.counts.prs, 1);
});
test('lost local state recovers existing session and task from GitHub metadata', async () => {
  const f = fixture(); await runTask(f.args);
  f.args.state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  assert.equal((await runTask(f.args)).status, 'unchanged');
  assert.equal(f.args.state.sessionId, 'session-one'); assert.equal(f.counts.agents, 1);
});
test('own checkpoint ignored, but same identity human feedback retained', () => {
  const marker = markerFor(taskKey(config, 1));
  const s = { issue: { number: 1 }, feedback: {}, comments: [] };
  const before = hash(facts(s, config, marker));
  s.comments.push({ user: { login: 'actor' }, body: marker + '\nreport' });
  assert.equal(hash(facts(s, config, marker)), before);
  s.comments.push({ user: { login: 'actor' }, body: 'please fix this' });
  assert.notEqual(hash(facts(s, config, marker)), before);
});
test('parse real headless NDJSON contract and reject incomplete turns', () => {
  const events = [{ type: 'session', sessionId: 'session-a' }, { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } }, { type: 'final', text: 'done' }];
  assert.deepEqual(parseRun(events.map(JSON.stringify).join('\n')), { sessionId: 'session-a', text: 'done' });
  assert.throws(() => parseRun(JSON.stringify(events[0])), /did not complete/);
});
test('strict config and remote URL guards', () => {
  assert.equal(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, owner: '../escape' }), /Invalid/);
  assert(remoteMatches('https://github.com/owner/repo.git', config));
  assert(!remoteMatches('https://token@github.com/owner/repo.git', config));
  assert(!remoteMatches('https://github.com/other/repo.git', config));
});
test('API refuses wrong identity before any write', async () => {
  const calls = [];
  const api = new GitHub(config, { token: 'test-only', fetchImpl: async (url, init) => { calls.push(init.method); return { ok: true, status: 200, json: async () => ({ login: 'wrong' }) }; } });
  await assert.rejects(api.createRepository(), /identity mismatch/);
  assert.deepEqual(calls, ['GET']);
});
test('pagination loads beyond first page', async () => {
  let page = 0;
  const api = new GitHub(config, { token: 'test-only', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ++page === 1 ? Array(100).fill({ id: 1 }) : [{ id: 101 }] }) });
  assert.equal((await api.list('/test')).length, 101);
});
