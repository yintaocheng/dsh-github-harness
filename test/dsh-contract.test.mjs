import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { apply, inject, name } from '../src/plugin.mjs';
import { parseRun, runDsh } from '../src/dsh.mjs';
import { sanitizedDshEnv } from '../src/environment.mjs';
import { taskKey, readLocalTask } from '../src/identity.mjs';
const identityConfig = { owner: 'owner', repo: 'repo', agent: { id: 'solo', expectedLogin: 'actor' } };

const project = fileURLToPath(new URL('../', import.meta.url));
function scratch(t) {
  const parent = resolve(project, '.harness'); mkdirSync(parent, { recursive: true });
  const path = mkdtempSync(join(parent, 'dsh-contract-test-'));
  t.after(() => {
    const target = resolve(path);
    assert.equal(dirname(target), parent);
    assert(basename(target).startsWith('dsh-contract-test-'));
    rmSync(target, { recursive: true, force: true });
  });
  return path;
}
function fixture(t, sessionId) {
  const path = scratch(t), cwd = join(path, 'work tree #fixture'), root = join(path, 'state #fixture'), foreign = join(path, 'foreign');
  for (const directory of [cwd, root, foreign]) mkdirSync(directory);
  const state = { key: taskKey(identityConfig, 42), ...(sessionId ? { sessionId } : {}) }, snapshots = [];
  const args = {
    config: { dsh: { command: ['fixture-dsh', 'headless', '--profile', 'fixture profile'] } },
    state, root, cwd, prompt: 'Implement the fixture only.\nKeep the same root session.\n',
    persist() { snapshots.push(structuredClone(state)); },
  };
  return { path, cwd, root, foreign, state, snapshots, args };
}
function pluginFixture(t, expectedSessionId) {
  const f = fixture(t), config = { receipt: join(f.root, 'session.json'), cwd: f.cwd, taskKey: f.state.key, runId: 'run-fixture', ...(expectedSessionId ? { sessionId: expectedSessionId } : {}) };
  const registrations = [];
  apply({ on(event, listener) { registrations.push({ event, listener }); } }, config);
  assert.equal(registrations.length, 1); assert.equal(registrations[0].event, 'session/event');
  return { ...f, config, emit: registrations[0].listener, receipt: () => JSON.parse(readFileSync(config.receipt, 'utf8')) };
}
const session = (cwd, id = 'root-a', header = {}) => ({ id, header: { cwd, ...header } });
const end = kind => ({ type: 'status', phase: 'turn_end', reason: { kind } });
const ndjson = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const completed = (cwd, sessionId = 'root-a', text = 'Fixture completed.') => ndjson([
  { type: 'session', sessionId, cwd }, end('completed'), { type: 'final', text },
]);
function patchFrom(argv) {
  const index = argv.lastIndexOf('--patch'); assert(index >= 0);
  const path = argv[index + 1]; assert(isAbsolute(path));
  const text = readFileSync(path, 'utf8');
  const match = /^- insert:\n    - id: github-harness-session-link\n      name: (.+)\n      config: (.+)\n$/.exec(text);
  assert(match, 'generated patch must embed JSON scalars in the YAML insertion');
  assert.equal(JSON.parse(match[1]), fileURLToPath(new URL('../src/plugin.mjs', import.meta.url)).replaceAll('\\', '/'));
  return { path, link: JSON.parse(match[2]) };
}
function receipt(link, overrides = {}) {
  const value = { sessionId: 'root-a', taskKey: link.taskKey, runId: link.runId, cwd: link.cwd, root: true, phase: 'turn/end', reason: { kind: 'completed' }, ...overrides };
  writeFileSync(link.receipt, JSON.stringify(value));
  const logs = join(dirname(link.receipt), 'logs'); mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, `${link.runId}.stdout`), ndjson([{ type: 'session', sessionId: link.sessionId || 'root-a', cwd: link.cwd }]));
  return value;
}
function result(f, overrides = {}) {
  const patch = readFileSync(join(f.root, `${f.state.key}.patch.yml`), 'utf8');
  const link = JSON.parse(/\n      config: ([^\n]+)\n$/.exec(patch)[1]);
  const logs = join(f.root, 'logs'); mkdirSync(logs, { recursive: true });
  const output = { code: 0, stdout: completed(f.cwd), out: join(logs, `${link.runId}.stdout`), err: join(logs, `${link.runId}.stderr`), ...overrides };
  writeFileSync(output.out, output.stdout);
  return output;
}
function assertUnpublishedIdentity(f, expected = undefined) {
  assert.equal(f.state.sessionId, expected, 'rejected identity must not be adopted in memory');
  assert(f.snapshots.every(snapshot => snapshot.sessionId === expected), 'rejected identity must never be published by persist');
}

test('session-link registers the root event contract and writes invocation-bound receipts', t => {
  assert.equal(name, 'dsh-github-harness-session-link'); assert.deepEqual(inject, ['sessions']);
  const f = pluginFixture(t);
  f.emit(session(f.cwd), { type: 'turn/start' });
  assert.deepEqual(f.receipt(), { sessionId: 'root-a', taskKey: f.state.key, runId: 'run-fixture', cwd: f.cwd, root: true, phase: 'turn/start' });
  f.emit(session(f.cwd), { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.deepEqual(f.receipt(), { sessionId: 'root-a', taskKey: f.state.key, runId: 'run-fixture', cwd: f.cwd, root: true, phase: 'turn/end', reason: { kind: 'completed' } });
});
test('session-link ignores children, defined parentSession, foreign cwd and unrelated events', t => {
  const f = pluginFixture(t);
  const ignored = [
    session(f.cwd, 'child', { origin: 'subagent' }),
    ...['root-a', null, false, ''].map(parentSession => session(f.cwd, 'child', { parentSession })),
    session(f.foreign), session('relative-cwd'), session(join(f.path, 'does-not-exist')),
    session(f.cwd, ''), session(f.cwd, 'bad\nidentity'), { id: 'root-a' }, null,
  ];
  for (const candidate of ignored) {
    for (const type of ['turn/start', 'turn/end']) f.emit(candidate, { type });
    assert.equal(existsSync(f.config.receipt), false, 'ignored events must not bind a root');
  }
  f.emit(session(f.cwd), { type: 'message' });
  assert.equal(existsSync(f.config.receipt), false);
  f.emit(session(f.cwd), { type: 'turn/start' });
  const first = f.receipt();
  f.emit(session(f.cwd, 'foreign-root'), { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  f.emit(session(f.foreign), { type: 'turn/end' });
  assert.deepEqual(f.receipt(), first, 'the first valid root cannot be replaced');
});
test('session-link resumes only the configured root even before its first event', t => {
  const f = pluginFixture(t, 'expected-root');
  f.emit(session(f.cwd, 'another-root'), { type: 'turn/start' });
  assert.equal(existsSync(f.config.receipt), false);
  f.emit(session(f.cwd, 'expected-root'), { type: 'turn/start' });
  assert.equal(f.receipt().sessionId, 'expected-root');
});
test('session-link rejects invalid configuration before registering a listener', t => {
  const f = fixture(t), valid = { receipt: join(f.root, 'receipt.json'), cwd: f.cwd, taskKey: f.state.key, runId: 'run-a' };
  const invalid = [undefined, {}, { ...valid, receipt: 'relative.json' }, { ...valid, cwd: 'relative' },
    ...['taskKey', 'runId', 'sessionId'].flatMap(key => ['', 7, null, 'bad\nvalue', 'bad\rvalue', 'bad\0value'].map(value => ({ ...valid, [key]: value })))];
  for (const config of invalid) assert.throws(() => apply({ on() { assert.fail('invalid config must not register'); } }, config), /session-link requires/);
});

test('parseRun accepts CRLF/blank lines, duplicate consistent root events, and the last final', t => {
  const f = fixture(t), root = { type: 'session', sessionId: 'root-a', cwd: f.cwd };
  const text = '\r\n' + [root, end('completed'), { type: 'final', text: 'old' }, root, end('completed'), { type: 'final', text: '' }].map(JSON.stringify).join('\r\n') + '\r\n\r\n';
  assert.deepEqual(parseRun(text, { expectedSessionId: 'root-a', cwd: f.cwd }), { sessionId: 'root-a', text: '' });
});
test('parseRun rejects malformed NDJSON and non-object events', () => {
  for (const text of ['not-json', '{"type":', '{}\n{', 'null', '[]', '1', '"event"']) assert.throws(() => parseRun(text), /malformed NDJSON|invalid event/);
});
test('parseRun rejects missing, invalid and conflicting root identities or workdirs', t => {
  const f = fixture(t), root = { type: 'session', sessionId: 'root-a', cwd: f.cwd }, tail = [end('completed'), { type: 'final', text: 'done' }];
  for (const events of [tail, ...['', 4, null, 'bad\nroot'].map(sessionId => [{ ...root, sessionId }, ...tail]),
    [root, { ...root, sessionId: 'other-root' }, ...tail], [root, { ...root, cwd: f.foreign }, ...tail]]) {
    assert.throws(() => parseRun(ndjson(events)), /root session identity mismatch/);
  }
  assert.throws(() => parseRun(completed(f.cwd), { expectedSessionId: 'other-root' }), /root session identity mismatch/);
  for (const cwd of [undefined, 'relative', f.foreign]) {
    assert.throws(() => parseRun(ndjson([{ ...root, cwd }, ...tail]), { cwd: f.cwd }), /working directory mismatch/);
  }
});
test('parseRun rejects incomplete/error turns and nonstring final output', () => {
  const root = { type: 'session', sessionId: 'root-a' }, final = { type: 'final', text: 'done' };
  const invalid = [[root], [root, final], [root, end('completed')], [root, end('cancelled'), final],
    [root, end('completed'), final, { type: 'error', message: 'fixture failure' }],
    ...[undefined, null, 7, {}, []].map(text => [root, end('completed'), { type: 'final', text }])];
  for (const events of invalid) assert.throws(() => parseRun(ndjson(events)), /did not complete a successful turn/);
});
test('parseRun never lets an earlier completed turn mask the latest failed turn', () => {
  for (const kind of ['cancelled', 'error', 'interrupted']) {
    const events = [{ type: 'session', sessionId: 'root-a' }, end('completed'), { type: 'final', text: 'old success' }, end(kind), { type: 'final', text: 'not success' }];
    assert.throws(() => parseRun(ndjson(events)), /did not complete a successful turn/);
  }
});

test('runDsh builds JSON-as-YAML, ordered argv and prompt input with a sanitized child env', async t => {
  const f = fixture(t), before = { ...process.env }, originalCwd = process.cwd(), controller = new AbortController(), spawned = [];
  const customPatch = join(f.path, 'user preset #quoted.yml'); writeFileSync(customPatch, '- insert: []\n');
  f.args.config.dsh.patch = customPatch;
  const onSpawn = pid => spawned.push(pid), beforeConfig = structuredClone(f.args.config);
  let calls = 0;
  const text = await runDsh({ ...f.args, signal: controller.signal, onSpawn, run: async (argv, options) => {
    calls++; const { path, link } = patchFrom(argv);
    assert.deepEqual(argv, [...f.args.config.dsh.command, '--patch', customPatch, '--patch', path, '--json', '-']);
    assert.deepEqual(link, { receipt: join(f.root, `${f.state.key}.session.json`), taskKey: f.state.key, cwd: f.cwd, runId: link.runId });
    assert.match(link.runId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    assert.equal(options.cwd, f.cwd); assert.equal(options.signal, controller.signal); assert.equal(options.onSpawn, onSpawn);
    assert.equal(options.logDir, join(f.root, 'logs')); assert.equal(options.input, join(f.root, `${f.state.key}.prompt.txt`));
    assert.equal(readFileSync(options.input, 'utf8'), f.args.prompt); assert(!argv.includes(f.args.prompt));
    assert.notEqual(options.env, process.env);
    assert(!Object.keys(options.env).some(key => /^(GH_TOKEN|GITHUB_TOKEN)$/i.test(key)));
    assert(isDeepStrictEqual(options.env, sanitizedDshEnv(before)), 'child environment must match sanitized parent');
    options.onSpawn(12345); receipt(link);
    return result(f);
  } });
  assert.equal(calls, 1); assert.equal(text, 'Fixture completed.'); assert.equal(f.state.sessionId, 'root-a');
  assert.deepEqual(spawned, [12345]); assert.deepEqual(f.state.dshLogs, { stdout: result(f).out, stderr: result(f).err });
  assert.equal(f.snapshots.at(-1).sessionId, 'root-a'); assert.deepEqual(f.args.config, beforeConfig);
  assert(isDeepStrictEqual({ ...process.env }, before), 'runDsh must not mutate process.env'); assert.equal(process.cwd(), originalCwd);
});
test('runDsh recovers an existing receipt and resumes the same root with fresh invocation IDs', async t => {
  const f = fixture(t), prior = { receipt: join(f.root, `${f.state.key}.session.json`), taskKey: f.state.key, cwd: f.cwd, runId: 'previous-run' };
  receipt(prior); const runIds = [];
  for (let turn = 0; turn < 2; turn++) {
    const text = await runDsh({ ...f.args, run: async argv => {
      const { path, link } = patchFrom(argv); runIds.push(link.runId);
      assert.deepEqual(argv, [...f.args.config.dsh.command, '--patch', path, '--json', '--session-id', 'root-a', '-']);
      assert.equal(link.sessionId, 'root-a'); assert.equal(f.state.sessionId, 'root-a');
      receipt(link); return result(f, { stdout: completed(f.cwd, 'root-a', `turn ${turn}`) });
    } });
    assert.equal(text, `turn ${turn}`);
  }
  assert.notEqual(runIds[0], prior.runId); assert.notEqual(runIds[0], runIds[1]);
  assertUnpublishedIdentity(f, 'root-a');
});
for (const mode of ['execution error', 'cancellation']) {
  test(`runDsh recovers the current root on ${mode} and rethrows the original error`, async t => {
    const f = fixture(t), controller = new AbortController(), failure = mode === 'cancellation' ? new DOMException('fixture cancelled', 'AbortError') : Error('fixture command failed');
    await assert.rejects(runDsh({ ...f.args, signal: controller.signal, run: async (argv, options) => {
      assert.equal(options.signal, controller.signal); receipt(patchFrom(argv).link, { phase: 'turn/start', reason: undefined });
      if (mode === 'cancellation') controller.abort(failure);
      throw failure;
    } }), error => error === failure);
    assert.equal(f.state.sessionId, 'root-a'); assert.equal(f.snapshots.at(-1).sessionId, 'root-a');
  });
}
test('runDsh preserves current recovery identity and log locations on a nonzero exit', async t => {
  const f = fixture(t);
  await assert.rejects(runDsh({ ...f.args, run: async argv => {
    receipt(patchFrom(argv).link); return result(f, { code: 17, stdout: ndjson([{ type: 'session', sessionId: 'root-a', cwd: f.cwd }, end('error')]) });
  } }), /DSH exited 17/);
  assert.equal(f.state.sessionId, 'root-a'); assert.equal(f.snapshots.at(-1).sessionId, 'root-a');
  assert.deepEqual(f.state.dshLogs, { stdout: result(f).out, stderr: result(f).err });
});
for (const kind of ['missing', 'stale']) {
  test(`runDsh rejects successful stdout with a ${kind} current receipt`, async t => {
    const f = fixture(t);
    await assert.rejects(runDsh({ ...f.args, run: async argv => {
      const { link } = patchFrom(argv); if (kind === 'stale') receipt(link, { runId: 'obsolete-run' });
      return result(f);
    } }), /Missing or conflicting current root receipt/);
    assertUnpublishedIdentity(f);
  });
  test(`runDsh cannot recover a first-turn identity from a ${kind} receipt on command failure`, async t => {
    const f = fixture(t), failure = Error('fixture interrupted');
    await assert.rejects(runDsh({ ...f.args, run: async argv => {
      const { link } = patchFrom(argv); if (kind === 'stale') receipt(link, { runId: 'obsolete-run' });
      throw failure;
    } }), error => error === failure);
    assertUnpublishedIdentity(f);
  });
}
test('runDsh does not adopt or persist a first-turn receipt that conflicts with successful NDJSON', async t => {
  const f = fixture(t);
  await assert.rejects(runDsh({ ...f.args, run: async argv => {
    receipt(patchFrom(argv).link, { sessionId: 'conflicting-root' }); return result(f);
  } }), /receipt|identity mismatch/i);
  assertUnpublishedIdentity(f);
});
test('runDsh does not adopt or persist a current receipt lacking the positive root marker', async t => {
  const f = fixture(t);
  await assert.rejects(runDsh({ ...f.args, run: async argv => {
    receipt(patchFrom(argv).link, { root: undefined }); return result(f);
  } }), /receipt|root/i);
  assertUnpublishedIdentity(f);
});
for (const mode of ['execution error', 'cancellation', 'nonzero exit']) {
  test(`runDsh does not publish an unmarked current receipt after ${mode}`, async t => {
    const f = fixture(t), controller = new AbortController();
    const failure = mode === 'cancellation' ? new DOMException('fixture cancelled', 'AbortError') : Error('fixture command failed');
    await assert.rejects(runDsh({ ...f.args, signal: controller.signal, run: async argv => {
      receipt(patchFrom(argv).link, { root: undefined });
      if (mode === 'nonzero exit') return result(f, { code: 17 });
      if (mode === 'cancellation') controller.abort(failure);
      throw failure;
    } }), /fixture|DSH exited 17|receipt|root/i);
    assertUnpublishedIdentity(f);
  });
}
test('runDsh rejects a resumed stdout session mismatch without replacing the existing root', async t => {
  const f = fixture(t, 'root-a');
  await assert.rejects(runDsh({ ...f.args, run: async argv => {
    const { link } = patchFrom(argv); assert.equal(link.sessionId, 'root-a'); receipt(link);
    return result(f, { stdout: completed(f.cwd, 'foreign-root') });
  } }), /root session identity mismatch/);
  assertUnpublishedIdentity(f, 'root-a');
});
test('runDsh rejects malformed or incomplete successful stdout even with a current root receipt', async t => {
  for (const kind of ['malformed', 'incomplete']) {
    const f = fixture(t), stdout = kind === 'malformed' ? 'broken-json' : ndjson([{ type: 'session', sessionId: 'root-a', cwd: f.cwd }]);
    await assert.rejects(runDsh({ ...f.args, run: async argv => {
      receipt(patchFrom(argv).link); return result(f, { stdout });
    } }), kind === 'malformed' ? /malformed NDJSON/ : /did not complete a successful turn/);
    assertUnpublishedIdentity(f);
  }
});
for (const kind of ['task', 'session', 'child', 'cwd', 'invalid identity']) {
  test(`runDsh rejects a conflicting previous ${kind} receipt before invoking DSH`, async t => {
    const f = fixture(t, 'root-a'), link = { receipt: join(f.root, `${f.state.key}.session.json`), taskKey: f.state.key, cwd: f.cwd, runId: 'previous' };
    const overrides = { task: { taskKey: 'other-task' }, session: { sessionId: 'other-root' }, child: { root: false }, cwd: { cwd: f.foreign }, 'invalid identity': { sessionId: 'bad\nroot' } };
    receipt(link, overrides[kind]);
    await assert.rejects(runDsh({ ...f.args, run: async () => assert.fail('conflicting receipt must stop before DSH') }), /recovery receipt conflicts/);
    assertUnpublishedIdentity(f, 'root-a'); assert.equal(f.snapshots.length, 0);
  });
}
for (const kind of ['task', 'child', 'cwd']) {
  test(`runDsh rejects a foreign current ${kind} receipt without publishing a root`, async t => {
    const f = fixture(t), overrides = { task: { taskKey: 'other-task' }, child: { root: false }, cwd: { cwd: f.foreign } };
    await assert.rejects(runDsh({ ...f.args, run: async argv => {
      receipt(patchFrom(argv).link, overrides[kind]); return result(f);
    } }), /recovery receipt conflicts/);
    assertUnpublishedIdentity(f);
  });
}
for (const sessionId of ['', 5, null, 'bad\0root']) {
  test(`runDsh rejects invalid persisted session identity ${JSON.stringify(sessionId)}`, async t => {
    const f = fixture(t); f.state.sessionId = sessionId;
    await assert.rejects(runDsh({ ...f.args, run: async () => assert.fail('invalid session must not invoke DSH') }), /Invalid task root session/);
    assert.equal(f.state.sessionId, sessionId); assert.equal(f.snapshots.length, 0);
  });
}