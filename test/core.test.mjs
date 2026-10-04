import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask, taskKey, branchName, facts, hash, markerFor } from '../src/core.mjs';
import { parseRun } from '../src/dsh.mjs';
import { remoteMatches, gitAuthEnv } from '../src/repo.mjs';
import { validateConfig } from '../src/cli.mjs';
import { GitHub } from '../src/github.mjs';

const config = { owner: 'owner', repo: 'repo', base: 'main', agent: { id: 'solo', expectedLogin: 'actor' }, dsh: { command: ['dsh', 'headless'] }, verify: [['node', '--test']] };
function fixture() {
  const state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  const snapshot = { issue: { number: 1, title: 'task', body: 'acceptance', state: 'open' }, comments: [], pr: null, feedback: {} };
  const counts = { agents: 0, prs: 0, checkpoints: 0, commits: 0, verifies: 0, pushes: 0 };
  let head = 'base', headTree = 'base-tree', tree = headTree;
  let publishFailure = false, checkpointFailure = false, pushFailure = false, commitFailure = false, validation = 0, makeChanges = true, hookTree = null;
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
    async prepare() {}, async head() { return head; },
    async verify(commands) { counts.verifies++; return commands.map(command => ({ command, code: validation || (tree === 'unsafe' ? 1 : 0) })); },
    async stage() { return { tree, oldHead: head, changed: tree === headTree ? [] : ['code'], reviewable: tree !== 'base-tree' }; },
    async recoverCommit(s) { return head === s.prepared.oldHead ? null : { head, tree: headTree, needsValidation: headTree !== s.prepared.tree }; },
    async commit(s) {
      if (commitFailure) { commitFailure = false; throw Error('interrupted before commit'); }
      if (tree !== headTree) { counts.commits++; head = `sha-${counts.commits}`; headTree = tree = hookTree || tree; }
      return { head, tree: headTree, needsValidation: headTree !== s.prepared.tree };
    },
    async push(s) {
      assert.equal(s.validation.tree, headTree); assert.equal(s.validation.verifyHash, hash(args.config.verify));
      counts.pushes++;
      if (pushFailure) { pushFailure = false; throw Error('push disconnected'); }
    },
  };
  const args = { config: structuredClone(config), issue: 1, state, github, repo, persist() {}, async agent() { counts.agents++; args.state.sessionId ||= 'session-one'; if (makeChanges) tree = `tree-${counts.agents}`; return 'Implemented. Tests passed. Unresolved: none.'; } };
  return { args, counts, snapshot, failPR() { publishFailure = true; }, failCheckpoint() { checkpointFailure = true; }, failValidation() { validation = 1; }, failPush() { pushFailure = true; }, failCommit() { commitFailure = true; }, noChanges(value = true) { makeChanges = !value; }, hook(value) { hookTree = value; }, changeTree(value) { tree = value; } };
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
  assert.equal(f.counts.checkpoints, 1); // Recovery must not overwrite the original report.
  assert.match(f.snapshot.comments[0].body, /exit 0/);
});
test('missing Issue checkpoint is repaired from PR without losing verification', async () => {
  const f = fixture(); await runTask(f.args); f.snapshot.comments = [];
  f.args.state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  assert.equal((await runTask(f.args)).status, 'unchanged');
  assert.match(f.snapshot.comments[0].body, /exit 0/);
  assert.equal(f.counts.agents, 1);
});
test('first no-change turn waits, deduplicates, and resumes on new feedback', async () => {
  const f = fixture(); f.noChanges();
  assert.equal((await runTask(f.args)).status, 'waiting');
  assert.equal(f.args.state.phase, 'waiting'); assert.equal(f.counts.prs, 0); assert.equal(f.counts.pushes, 0);
  assert.equal((await runTask(f.args)).status, 'unchanged'); assert.equal(f.counts.agents, 1);
  assert.match(f.snapshot.comments[0].body, /waiting for feedback/);
  f.snapshot.comments.push({ id: 22, user: { login: 'reviewer' }, body: 'Here are the missing requirements' });
  f.noChanges(false);
  assert.equal((await runTask(f.args)).status, 'published'); assert.equal(f.counts.agents, 2);
});
test('waiting session can be recovered from Issue checkpoint without a PR', async () => {
  const f = fixture(); f.noChanges(); await runTask(f.args);
  f.args.state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  assert.equal((await runTask(f.args)).status, 'unchanged');
  assert.equal(f.args.state.sessionId, 'session-one'); assert.equal(f.args.state.phase, 'waiting'); assert.equal(f.counts.agents, 1);
});
test('existing PR with no further edits retains its reviewable commit', async () => {
  const f = fixture(); await runTask(f.args); const head = f.args.state.head;
  f.noChanges(); f.snapshot.comments.push({ id: 22, user: { login: 'reviewer' }, body: 'Confirm existing behavior' });
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.args.state.head, head); assert.equal(f.counts.commits, 1); assert.equal(f.counts.prs, 1); assert.equal(f.counts.agents, 2);
});
for (const phase of ['done', 'validated', 'publishing']) {
  test(`${phase}: acceptance changes revalidate the candidate without a model turn`, async () => {
    const f = fixture();
    if (phase === 'validated') f.failCommit();
    if (phase === 'publishing') f.failPush();
    if (phase === 'done') await runTask(f.args); else await assert.rejects(runTask(f.args));
    assert.equal(f.args.state.phase, phase);
    f.args.config.verify.push(['node', 'additional-acceptance.mjs']);
    assert.equal((await runTask(f.args)).status, 'published');
    assert.equal(f.counts.agents, 1); assert.equal(f.counts.verifies, 2); assert.equal(f.counts.commits, 1);
    assert.equal(f.args.state.validation.verifyHash, hash(f.args.config.verify));
    assert.equal(f.args.state.verification.length, 2);
  });
}
test('new failing acceptance prevents retrying publication with old proof', async () => {
  const f = fixture(); f.failPush(); await assert.rejects(runTask(f.args), /push disconnected/);
  f.args.config.verify.push(['node', 'new-test.mjs']); f.failValidation();
  await assert.rejects(runTask(f.args), /Verification failed/);
  assert.equal(f.counts.pushes, 1); assert.equal(f.counts.prs, 0); assert.equal(f.counts.agents, 1); assert.equal(f.args.state.validation, undefined);
});
test('hook-modified committed tree must pass a second independent verification', async () => {
  const f = fixture(); f.hook('hook-tree');
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.counts.verifies, 2); assert.equal(f.args.state.validation.tree, 'hook-tree');
});
test('hook-created failing tree is not pushed or published', async () => {
  const f = fixture(); f.hook('unsafe');
  await assert.rejects(runTask(f.args), /Verification failed/);
  assert.equal(f.counts.verifies, 2); assert.equal(f.counts.pushes, 0); assert.equal(f.counts.prs, 0);
});
test('same HEAD with a changed candidate tree cannot reuse cached validation', async () => {
  const f = fixture(); f.failCommit(); await assert.rejects(runTask(f.args), /interrupted/);
  f.changeTree('new-candidate');
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.counts.verifies, 2); assert.equal(f.counts.agents, 1); assert.equal(f.args.state.validation.tree, 'new-candidate');
});
test('legacy validated/no-change checkpoint accepts later feedback instead of deadlocking', async () => {
  const f = fixture(); f.noChanges(); await runTask(f.args);
  f.args.state.phase = 'validated'; delete f.args.state.validation;
  f.snapshot.comments.push({ id: 44, user: { login: 'reviewer' }, body: 'Clarification for the old checkpoint' });
  f.noChanges(false);
  assert.equal((await runTask(f.args)).status, 'published'); assert.equal(f.counts.agents, 2);
});
test('legacy remote report lacking a validation binding is rechecked without a model turn', async () => {
  const f = fixture(); await runTask(f.args);
  f.snapshot.pr.body = f.snapshot.pr.body.replace('"v":3', '"v":1').replace(/"validation":\{[^}]+\},/, '');
  f.args.state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.counts.agents, 1); assert.equal(f.counts.verifies, 2); assert.match(f.args.state.summary, /Tests passed/);
});
test('verification that changes candidate content cannot certify either tree', async () => {
  const f = fixture(), verify = f.args.repo.verify;
  f.args.repo.verify = async commands => { const result = await verify(commands); f.changeTree('changed-by-test'); return result; };
  await assert.rejects(runTask(f.args), /Verification changed/);
  assert.equal(f.args.state.validation, undefined); assert.equal(f.counts.commits, 0); assert.equal(f.counts.pushes, 0);
});
test('Git uses API credential in child environment only and disables tracing', () => {
  const parent = { PATH: 'path', GIT_TRACE_CURL: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.version', GIT_CONFIG_VALUE_0: 'HTTP/1.1' };
  const env = gitAuthEnv('test-only', parent);
  assert.equal(env.GIT_CONFIG_COUNT, '4');
  assert.equal(env.GIT_CONFIG_KEY_3, 'http.https://github.com/.extraHeader');
  assert.equal(env.GIT_CONFIG_VALUE_3, `Authorization: Basic ${Buffer.from('x-access-token:test-only').toString('base64')}`);
  assert.equal(env.GIT_TRACE_CURL, undefined);
  assert.equal(parent.GIT_CONFIG_COUNT, '1');
  assert.throws(() => gitAuthEnv('', {}), /credential required/);
  assert(!remoteMatches('git@github.com:owner/repo.git', config));
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

test('changing executor retains the same business task, PR, branch and session', async () => {
  const f = fixture(); await runTask(f.args);
  const { key, branch, sessionId, task } = f.args.state, previousRun = f.args.state.lastRun.id;
  f.args.config.agent.id = 'replacement';
  assert.equal((await runTask(f.args)).status, 'unchanged');
  assert.equal(f.args.state.key, key); assert.equal(f.args.state.branch, branch); assert.equal(f.args.state.sessionId, sessionId);
  assert.deepEqual(f.args.state.task, task); assert.equal(f.args.state.task.key, taskKey(f.args.config, 1));
  assert.notEqual(f.args.state.lastRun.id, previousRun); assert.equal(f.args.state.lastRun.executor.id, 'replacement');
  f.snapshot.comments.push({ id: 90, user: { login: 'reviewer' }, body: 'New feedback for replacement executor' });
  assert.equal((await runTask(f.args)).status, 'published');
  assert.equal(f.counts.prs, 1); assert.equal(f.counts.agents, 2); assert.equal(f.args.state.sessionId, sessionId);
});
for (const waiting of [false, true]) {
  for (const version of [1, 2]) {
    test(`lost cache and executor change recover v${version} legacy ${waiting ? 'waiting checkpoint' : 'PR'} in place`, async () => {
      const f = fixture(), oldKey = 'owner_repo_1_original', oldBranch = 'harness/original/issue-1';
      f.args.state = { key: oldKey, branch: oldBranch };
      if (waiting) f.noChanges();
      await runTask(f.args);
      const downgrade = body => body.replace(/<!-- dsh-gh-state (\{[^\n]+\}) -->/, (_match, json) => {
        const data = JSON.parse(json); data.v = version; data.agent = 'original'; delete data.task; delete data.branch;
        if (version === 1) delete data.validation;
        return `<!-- dsh-gh-state ${JSON.stringify(data)} -->`;
      });
      if (f.snapshot.pr) f.snapshot.pr.body = downgrade(f.snapshot.pr.body);
      f.snapshot.comments[0].body = downgrade(f.snapshot.comments[0].body);
      // PR-only recovery also repairs the missing checkpoint using the same marker.
      if (!waiting) f.snapshot.comments = [];
      f.args.config.agent.id = 'replacement';
      f.args.state = { key: taskKey(f.args.config, 1), branch: branchName(f.args.config, 1) };
      await runTask(f.args);
      assert.equal(f.args.state.key, oldKey); assert.equal(f.args.state.branch, oldBranch);
      assert.equal(f.args.state.task.key, taskKey(f.args.config, 1)); assert.equal(f.args.state.sessionId, 'session-one');
      assert.equal(f.counts.agents, 1); assert.equal(f.counts.prs, waiting ? 0 : 1);
      assert.equal(f.counts.verifies, version === 1 ? 2 : 1);
      assert(f.snapshot.comments[0].body.startsWith(markerFor(oldKey)));
    });
  }
}
test('receipt-only session recovery also restores durable proof without another model turn', async () => {
  const f = fixture(); await runTask(f.args);
  f.args.state = { key: taskKey(config, 1), branch: branchName(config, 1), sessionId: 'session-one' };
  assert.equal((await runTask(f.args)).status, 'unchanged'); assert.equal(f.counts.agents, 1);
});
test('conflicting recovered sessions fail before checkout preparation or model execution', async () => {
  const f = fixture(); await runTask(f.args);
  f.args.state.sessionId = 'different-session';
  f.args.repo.prepare = async () => assert.fail('must not prepare on ambiguous session');
  await assert.rejects(runTask(f.args), /Conflicting task sessions/);
  assert.equal(f.counts.agents, 1); assert.equal(f.counts.pushes, 1);
});
test('ambiguous legacy checkpoints never silently join two executor tasks', async () => {
  const f = fixture(); f.noChanges();
  f.args.state = { key: 'owner_repo_1_first', branch: 'harness/first/issue-1' }; await runTask(f.args);
  const first = f.snapshot.comments[0];
  f.snapshot.comments.push({ ...first, id: 99, body: first.body.replaceAll('owner_repo_1_first', 'owner_repo_1_second').replaceAll('harness/first/issue-1', 'harness/second/issue-1') });
  f.args.state = { key: taskKey(config, 1), branch: branchName(config, 1) };
  f.args.repo.prepare = async () => assert.fail('ambiguous legacy candidates must not prepare');
  await assert.rejects(runTask(f.args), /Ambiguous task/); assert.equal(f.counts.agents, 1);
});
test('configuration mutation during an await cannot change this invocation verification or executor', async () => {
  const f = fixture(), expectedVerify = structuredClone(f.args.config.verify); f.noChanges();
  f.args.github.verify = async () => {
    f.args.config.agent.id = 'changed-after-entry';
    f.args.config.verify.push(['node', 'next-invocation-only.mjs']);
    return { login: 'actor' };
  };
  await runTask(f.args);
  assert.equal(f.args.state.lastRun.executor.id, 'solo');
  assert.deepEqual(f.args.state.verification.map(x => x.command), expectedVerify);
  assert.equal(f.args.state.validation.verifyHash, hash(expectedVerify));
  assert.deepEqual(f.args.state.lastRun.verification.commands, expectedVerify);
});
test('verified repository ID changes fail before preparing a previously bound task', async () => {
  const f = fixture();
  f.args.state.task = { key: taskKey(config, 1), repository: 'github:owner/repo', issue: 1, repositoryId: 123 };
  f.args.github.verify = async () => ({ login: 'actor', repo: { id: 456 } });
  f.args.repo.prepare = async () => assert.fail('repository replacement must not prepare');
  await assert.rejects(runTask(f.args), /repository ID differs/); assert.equal(f.counts.agents, 0);
});
