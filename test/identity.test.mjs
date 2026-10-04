import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskKey, branchName, markerFor, taskIdentity, createRunContext, readLocalTask } from '../src/identity.mjs';
import { execute } from '../src/runner.mjs';
import { GitHub } from '../src/github.mjs';

const config = { owner: 'owner', repo: 'repo', base: 'main', agent: { id: 'new-executor', expectedLogin: 'actor' }, dsh: { command: [process.execPath] }, verify: [[process.execPath, '--test']] };
const root = fileURLToPath(new URL('../', import.meta.url));
function scratch(t) {
  const parent = join(root, '.harness'); mkdirSync(parent, { recursive: true });
  const path = mkdtempSync(join(parent, 'identity-test-'));
  t.after(() => { assert.equal(dirname(path), parent); assert(basename(path).startsWith('identity-test-')); rmSync(path, { recursive: true, force: true }); });
  return path;
}
function legacy(executor = 'old', overrides = {}) {
  const key = `owner_repo_1_${executor}`;
  const data = { v: 2, key, sessionId: 'original-session', inputHash: 'facts', head: 'sha', phase: 'done', agent: executor, operator: 'actor', ...overrides };
  return { key, branch: `harness/${executor}/issue-1`, body: `${markerFor(key)}\n<!-- dsh-gh-state ${JSON.stringify(data)} -->\nCloses #1\n` };
}
const comment = record => ({ id: 10, user: { login: 'actor' }, body: record.body });
const pull = (record, number = 2) => ({ number, state: 'open', body: record.body, base: { ref: 'main' }, head: { ref: record.branch, sha: 'sha', repo: { full_name: 'owner/repo' } } });
function apiFixture({ comments = [], pulls = [], refs = [], selected = config, repositoryId = 123 } = {}) {
  const calls = [];
  const repoRoot = `/repos/${selected.owner}/${selected.repo}`;
  const api = new GitHub(selected, { token: 'fixture-only', fetchImpl: async (url, init) => {
    const parsed = new URL(url), path = parsed.pathname;
    calls.push({ path, method: init.method, query: parsed.search });
    assert.equal(init.method, 'GET', 'Identity discovery must never write');
    let body;
    if (path === '/user') body = { login: 'actor' };
    else if (path === repoRoot) body = { full_name: `${selected.owner}/${selected.repo}`, id: repositoryId, permissions: { push: true } };
    else if (path === `${repoRoot}/issues/1`) body = { number: 1, state: 'open', title: 'one', body: '' };
    else if (path === `${repoRoot}/issues/1/comments`) body = comments;
    else if (path === `${repoRoot}/pulls`) body = pulls;
    else if (path === `${repoRoot}/git/matching-refs/heads/harness/`) body = refs.map(ref => ({ ref: `refs/heads/${ref}` }));
    else if (/\/check-runs$/.test(path)) body = { check_runs: [] };
    else if (/\/(comments|reviews|statuses)$/.test(path)) body = [];
    else assert.fail(`Unexpected read: ${path}`);
    return { status: 200, ok: true, json: async () => structuredClone(body) };
  } });
  return { api, calls };
}

test('business identity separates projects and ignores executor, operator and GitHub name casing', () => {
  const otherExecutor = { ...config, agent: { id: 'second', expectedLogin: 'another' } };
  assert.equal(taskKey(config, 1), taskKey(otherExecutor, 1));
  assert.equal(branchName(config, 1), branchName(otherExecutor, 1));
  assert.equal(taskKey(config, 1), taskKey({ ...config, owner: 'OwNeR', repo: 'RePo' }, 1));
  assert.notEqual(taskKey(config, 1), taskKey({ ...config, repo: 'other' }, 1));
  assert.notEqual(taskKey(config, 1), taskKey(config, 2));
  assert.notEqual(taskKey({ ...config, owner: 'a_b', repo: 'c' }, 1), taskKey({ ...config, owner: 'a', repo: 'b_c' }, 1));
});
test('run context snapshots project, workdir, Issue, operator, executor and verification deeply', t => {
  const input = structuredClone(config), cwd = scratch(t), originalCwd = process.cwd();
  const context = createRunContext(input, { cwd, issue: 1 });
  input.owner = 'elsewhere'; input.agent.id = 'next'; input.agent.expectedLogin = 'changed'; input.verify[0].push('changed');
  assert.equal(context.project.workdir, cwd); assert.equal(context.project.key, 'github:owner/repo');
  assert.deepEqual(context.task, taskIdentity(config, 1));
  assert.deepEqual(context.executor, { id: 'new-executor' }); assert.deepEqual(context.operator, { expectedLogin: 'actor' });
  assert.deepEqual(context.verification.commands, config.verify);
  assert.throws(() => context.config.verify[0].push('mutate'), TypeError);
  assert.throws(() => { context.operator.expectedLogin = 'mutate'; }, TypeError);
  assert.notEqual(createRunContext(config, { cwd, issue: 1 }).id, context.id);
  assert.equal(process.cwd(), originalCwd);
});
test('legacy state and DSH receipt migrate in place after executor change', t => {
  const path = scratch(t), old = legacy();
  const state = { version: 2, key: old.key, branch: old.branch, sessionId: 'original-session', phase: 'working', prepared: { tree: 'tree' } };
  const receipt = { taskKey: old.key, sessionId: 'original-session', phase: 'turn/start' };
  writeFileSync(join(path, `${old.key}.json`), JSON.stringify(state));
  writeFileSync(join(path, `${old.key}.session.json`), JSON.stringify(receipt));
  const selected = readLocalTask(path, config, 1);
  assert.equal(selected.known, true); assert.equal(selected.state.key, old.key); assert.equal(selected.state.branch, old.branch);
  assert.deepEqual(selected.state.task, taskIdentity(config, 1)); assert.deepEqual(selected.session, receipt);
  assert.deepEqual(selected.state.prepared, state.prepared);
  assert.deepEqual(JSON.parse(readFileSync(join(path, `${old.key}.json`), 'utf8')), state, 'selection must remain read-only');
});
test('receipt-only recovery retains the old session artifact alias', t => {
  const path = scratch(t), old = legacy();
  writeFileSync(join(path, `${old.key}.session.json`), JSON.stringify({ taskKey: old.key, sessionId: 'original-session' }));
  const selected = readLocalTask(path, config, 1);
  assert.equal(selected.state.key, old.key); assert.equal(selected.state.branch, old.branch);
  assert.equal(selected.state.sessionId, 'original-session'); assert.equal(selected.state.receipt, undefined);
});
test('local multiple executor aliases or a canonical plus legacy alias fail closed', t => {
  for (const second of [legacy('second'), { key: taskKey(config, 1), branch: branchName(config, 1) }]) {
    const path = scratch(t), old = legacy();
    for (const record of [old, second]) writeFileSync(join(path, `${record.key}.json`), JSON.stringify({ key: record.key, branch: record.branch }));
    assert.throws(() => readLocalTask(path, config, 1), /Ambiguous task/);
  }
});
test('local state versus receipt session conflict and foreign business binding fail closed', t => {
  const path = scratch(t), old = legacy();
  writeFileSync(join(path, `${old.key}.json`), JSON.stringify({ key: old.key, branch: old.branch, sessionId: 'one' }));
  writeFileSync(join(path, `${old.key}.session.json`), JSON.stringify({ taskKey: old.key, sessionId: 'two' }));
  assert.throws(() => readLocalTask(path, config, 1), /Conflicting task sessions/);
  const foreign = scratch(t);
  writeFileSync(join(foreign, `${old.key}.json`), JSON.stringify({ key: old.key, branch: old.branch, task: taskIdentity({ ...config, repo: 'other' }, 1) }));
  assert.throws(() => readLocalTask(foreign, config, 1), /repository\/Issue identity mismatch/);
});
test('simultaneous project status calls with the same Issue never share state or change cwd', async t => {
  const originalCwd = process.cwd();
  const projects = ['first', 'second'].map(repo => {
    const cwd = scratch(t), selected = { ...config, repo }, stateRoot = join(cwd, '.harness'); mkdirSync(stateRoot);
    writeFileSync(join(cwd, 'harness.config.json'), JSON.stringify(selected));
    const key = taskKey(selected, 1), state = { key, branch: branchName(selected, 1), sessionId: `session-${repo}` };
    writeFileSync(join(stateRoot, `${key}.json`), JSON.stringify(state));
    return { cwd, selected };
  });
  const results = await Promise.all(projects.map(({ cwd }) => execute(['status', '1'], { cwd, getToken() { assert.fail('status must not read credentials'); } })));
  assert.equal(results[0].task.sessionId, 'session-first'); assert.equal(results[1].task.sessionId, 'session-second');
  assert.notEqual(results[0].task.task.key, results[1].task.task.key);
  assert.equal(process.cwd(), originalCwd);
});
test('status resolves legacy aliases with the new executor and without credentials', async t => {
  const cwd = scratch(t), stateRoot = join(cwd, '.harness'), old = legacy(); mkdirSync(stateRoot);
  writeFileSync(join(cwd, 'harness.config.json'), JSON.stringify(config));
  writeFileSync(join(stateRoot, `${old.key}.json`), JSON.stringify({ key: old.key, branch: old.branch, sessionId: 'old-session' }));
  const result = await execute(['status', '1'], { cwd, getToken() { assert.fail('no credential lookup'); } });
  assert.equal(result.task.key, old.key); assert.equal(result.task.task.key, taskKey(config, 1));
});
test('lost cache and changed executor recover a legacy PR even without its Issue checkpoint', async () => {
  const old = legacy(), f = apiFixture({ pulls: [pull(old)], refs: [old.branch] });
  const snapshot = await f.api.snapshot(1, branchName(config, 1));
  assert.equal(snapshot.task.key, old.key); assert.equal(snapshot.task.branch, old.branch);
  assert.equal(snapshot.task.sessionId, 'original-session'); assert.equal(snapshot.pr.number, 2);
  assert(f.calls.some(x => x.path.endsWith('/pulls') && !x.query.includes('head=')));
});
test('lost-cache waiting checkpoint recovers the old branch with no PR', async () => {
  const old = legacy('old', { phase: 'waiting' }), f = apiFixture({ comments: [comment(old)], refs: [old.branch] });
  const snapshot = await f.api.snapshot(1, branchName(config, 1));
  assert.equal(snapshot.task.key, old.key); assert.equal(snapshot.pr, null);
});
test('different legacy PRs, even sharing a session, are ambiguous rather than merged', async () => {
  const first = legacy(), second = legacy('second'), f = apiFixture({ pulls: [pull(first), pull(second, 3)] });
  await assert.rejects(f.api.snapshot(1, branchName(config, 1)), /Ambiguous task/);
});
test('local versus remote alias disagreement fails closed', async () => {
  const old = legacy(), f = apiFixture({ pulls: [pull(old)] });
  await assert.rejects(f.api.snapshot(1, branchName(config, 1), { known: true, key: taskKey(config, 1) }), /Ambiguous task/);
});
test('legacy checkpoint and PR disagreeing on session fail closed', async () => {
  const old = legacy(), changed = legacy('old', { sessionId: 'different' }), f = apiFixture({ comments: [comment(old)], pulls: [pull(changed)] });
  await assert.rejects(f.api.snapshot(1, branchName(config, 1)), /Conflicting task sessions/);
});
test('duplicate checkpoints or duplicate PRs for one legacy branch fail closed', async () => {
  const old = legacy();
  await assert.rejects(apiFixture({ comments: [comment(old), { ...comment(old), id: 11 }] }).api.snapshot(1, branchName(config, 1)), /Multiple task checkpoints/);
  await assert.rejects(apiFixture({ pulls: [pull(old), pull(old, 3)] }).api.snapshot(1, branchName(config, 1)), /Multiple PRs/);
});
test('unrecorded local or remote legacy branches require manual session recovery', async () => {
  const old = legacy();
  await assert.rejects(apiFixture({ refs: [old.branch] }).api.snapshot(1, branchName(config, 1)), /unrecorded task branch/);
  await assert.rejects(apiFixture().api.snapshot(1, branchName(config, 1), { branches: [old.branch] }), /unrecorded task branch/);
});
test('missing PR or changed operator is not turned into a fresh business task', async () => {
  const old = legacy();
  await assert.rejects(apiFixture({ comments: [comment(old)] }).api.snapshot(1, branchName(config, 1)), /missing PR/);
  const changed = legacy('old', { operator: 'different' });
  await assert.rejects(apiFixture({ pulls: [pull(changed)] }).api.snapshot(1, branchName(config, 1)), /operator changed/);
});
test('closed legacy PRs and branch/base bindings remain visible after executor change', async () => {
  const old = legacy(), closed = { ...pull(old), state: 'closed' }, f = apiFixture({ pulls: [closed] });
  const snapshot = await f.api.snapshot(1, branchName(config, 1));
  assert.equal(snapshot.pr.state, 'closed'); assert.equal(snapshot.task.branch, old.branch);
  const mismatch = pull(old); mismatch.head.ref = 'harness/other/issue-1';
  await assert.rejects(apiFixture({ pulls: [mismatch] }).api.snapshot(1, branchName(config, 1)), /Unrecognized task PR/);
});
test('another repository with Issue 1 cannot supply this project checkpoint or fork PR', async () => {
  const old = legacy(), other = { ...old, body: old.body.replaceAll('owner_repo_1_old', 'owner_other_1_old') };
  const fork = pull(old); fork.head.repo.full_name = 'fork/repo';
  const snapshot = await apiFixture({ comments: [comment(other)], pulls: [fork] }).api.snapshot(1, branchName(config, 1));
  assert.equal(snapshot.task.key, taskKey(config, 1)); assert.equal(snapshot.pr, null);
});
test('GitHub adapter snapshots config and pins a verified repository ID within a run', async () => {
  const selected = structuredClone(config);
  let repoId = 123;
  const api = new GitHub(selected, { token: 'fixture-only', fetchImpl: async url => ({ status: 200, ok: true, json: async () => url.endsWith('/user') ? { login: 'actor' } : { full_name: 'owner/repo', id: repoId, permissions: { push: true } } }) });
  selected.agent.expectedLogin = 'mutated'; selected.repo = 'mutated';
  await api.verify(); repoId = 456;
  await assert.rejects(api.verify(), /repository ID changed/);
});
test('a valid legacy executor ending in .session is not mistaken for a receipt', t => {
  const path = scratch(t), old = legacy('old.session');
  const state = { key: old.key, branch: old.branch, sessionId: 'original-session', task: { ...taskIdentity(config, 1), repositoryId: 123 } };
  writeFileSync(join(path, `${old.key}.json`), JSON.stringify(state));
  writeFileSync(join(path, `${old.key}.session.json`), JSON.stringify({ taskKey: old.key, sessionId: state.sessionId }));
  const result = readLocalTask(path, config, 1);
  assert.equal(result.state.key, old.key); assert.equal(result.session.sessionId, state.sessionId);
  assert.equal(result.state.task.repositoryId, 123, 'local selection must retain verified repository binding');
});
test('missing durable session identity and conflicting repository IDs fail closed', async t => {
  const missing = legacy('old', { sessionId: undefined });
  await assert.rejects(apiFixture({ pulls: [pull(missing)] }).api.snapshot(1, branchName(config, 1)), /checkpoint\/session/);
  const first = legacy('old', { task: { ...taskIdentity(config, 1), repositoryId: 123 } });
  const second = legacy('old', { task: { ...taskIdentity(config, 1), repositoryId: 456 } });
  await assert.rejects(apiFixture({ comments: [comment(first)], pulls: [pull(second)] }).api.snapshot(1, branchName(config, 1)), /Conflicting task repository IDs/);
  const path = scratch(t), old = legacy();
  writeFileSync(join(path, `${old.key}.session.json`), JSON.stringify({ taskKey: old.key }));
  assert.throws(() => readLocalTask(path, config, 1), /receipt identity mismatch/);
});
test('waiting checkpoint operator changes or untrusted checkpoint authors require reconciliation', async () => {
  const previous = legacy('old', { phase: 'waiting', operator: 'previous-operator' });
  await assert.rejects(apiFixture({ comments: [{ ...comment(previous), user: { login: 'previous-operator' } }] }).api.snapshot(1, branchName(config, 1)), /operator changed/);
  const spoofed = legacy('old', { phase: 'waiting' });
  await assert.rejects(apiFixture({ comments: [{ ...comment(spoofed), user: { login: 'not-actor' } }] }).api.snapshot(1, branchName(config, 1)), /checkpoint author mismatch/);
});
test('parallel project calls keep config and credential selection stable while awaiting getToken', async t => {
  const originalFetch = globalThis.fetch, originalCwd = process.cwd(), requests = [], credentials = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, 'GET');
    const path = new URL(url).pathname; requests.push(path);
    let body;
    if (path === '/user') body = { login: 'actor' };
    else if (/^\/repos\/owner\/[^/]+$/.test(path)) body = { full_name: path.slice('/repos/'.length), private: true };
    else if (path.endsWith('/branches/main')) body = { name: 'main', commit: { sha: 'a'.repeat(40) } };
    else if (path.endsWith('/check-runs')) body = { check_runs: [] };
    else body = [];
    return { status: 200, ok: true, json: async () => body };
  };
  const projects = ['project-a', 'project-b'].map(repo => {
    const cwd = scratch(t), selected = { ...config, repo }, path = join(cwd, 'harness.config.json');
    writeFileSync(path, JSON.stringify(selected));
    return { cwd, selected, path };
  });
  const signal = new AbortController().signal;
  const results = await Promise.all(projects.map(({ cwd, selected, path }) => execute(['doctor'], { cwd, signal, async getToken(options) {
    credentials.push({ project: selected.repo, ...options });
    // Disk config can be edited during credential acquisition, but only the NEXT invocation sees it.
    writeFileSync(path, JSON.stringify({ ...selected, repo: 'changed', agent: { id: 'changed', expectedLogin: 'changed' }, dsh: { command: ['must-not-execute'] } }));
    await Promise.resolve();
    return 'fixture-only';
  } })));
  assert.equal(credentials.length, 2);
  for (const item of credentials) { assert.equal(item.expectedLogin, 'actor'); assert.equal(item.signal, signal); }
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i].repository, `owner/${projects[i].selected.repo}`);
    assert.equal(results[i].agentId, config.agent.id); assert.equal(results[i].cwd, projects[i].cwd); assert.equal(results[i].dshHelpExit, 0);
    assert(results[i].diagnosticFile.startsWith(projects[i].cwd));
  }
  assert(!requests.some(path => path.includes('/changed'))); assert.equal(process.cwd(), originalCwd);
});
