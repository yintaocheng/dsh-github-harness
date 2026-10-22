import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDsh } from '../src/dsh.mjs';
import { taskKey, readLocalTask } from '../src/identity.mjs';
import { command } from '../src/process.mjs';

const config = { owner: 'owner', repo: 'repo', agent: { id: 'solo', expectedLogin: 'actor' }, dsh: { command: ['fixture-dsh'] } };
function fixture(t) {
  const parent = fileURLToPath(new URL('../.harness/', import.meta.url)); mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, 'receipt-restart-')), root = join(cwd, '.harness'); mkdirSync(root);
  t.after(() => { assert.equal(dirname(cwd), parent.replace(/[\\/]$/, '')); assert(basename(cwd).startsWith('receipt-restart-')); rmSync(cwd, { recursive: true, force: true }); });
  const state = { key: taskKey(config, 1) }, stateFile = join(root, `${state.key}.json`), receiptFile = join(root, `${state.key}.session.json`);
  const persist = () => writeFileSync(stateFile, JSON.stringify(state)); persist();
  const args = { config, state, cwd, root, prompt: 'fixture only', persist };
  return { cwd, root, state, stateFile, receiptFile, args };
}
const stream = (cwd, id = 'root-a') => [{ type: 'session', sessionId: id, cwd }, { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } }, { type: 'final', text: 'done' }].map(x => JSON.stringify(x)).join('\n') + '\n';
function emit(f, argv, options, overrides = {}, stdout = stream(f.cwd)) {
  const patch = readFileSync(argv[argv.lastIndexOf('--patch') + 1], 'utf8');
  const link = JSON.parse(/\n      config: ([^\n]+)\n$/.exec(patch)[1]);
  assert.equal(options.logId, link.runId);
  mkdirSync(options.logDir, { recursive: true });
  const out = join(options.logDir, `${options.logId}.stdout`), err = join(options.logDir, `${options.logId}.stderr`);
  writeFileSync(out, stdout); writeFileSync(err, '');
  writeFileSync(link.receipt, JSON.stringify({ taskKey: link.taskKey, sessionId: 'root-a', cwd: f.cwd, root: true, runId: link.runId, phase: 'turn/start', ...overrides }));
  return { code: 0, out, err, stdout };
}
for (const kind of ['conflicting root', 'missing root marker', 'malformed successful stream', 'unmarked failure', 'unmarked cancellation', 'unmarked nonzero']) {
  test(`restart cannot promote a rejected ${kind}`, async t => {
    const f = fixture(t);
    await assert.rejects(runDsh({ ...f.args, run: async (argv, options) => {
      const overrides = kind === 'conflicting root' ? { sessionId: 'wrong-root' } : kind.includes('unmarked') || kind === 'missing root marker' ? { root: undefined } : {};
      const result = emit(f, argv, options, overrides, kind === 'malformed successful stream' ? 'broken' : stream(f.cwd));
      if (kind === 'unmarked failure') throw Error('fixture interrupted');
      if (kind === 'unmarked cancellation') throw new DOMException('fixture cancelled', 'AbortError');
      if (kind === 'unmarked nonzero') result.code = 17;
      return result;
    } }), /receipt|NDJSON|root/);
    assert.equal(f.state.sessionId, undefined);
    assert.equal(JSON.parse(readFileSync(f.receiptFile, 'utf8')).rejected, true);
    const persisted = readFileSync(f.stateFile, 'utf8');
    assert.equal(JSON.parse(persisted).sessionId, undefined);
    assert.throws(() => readLocalTask(f.root, config, 1), /receipt|root/);
    assert.equal(readFileSync(f.stateFile, 'utf8'), persisted, 'status/admission must not write');
    await assert.rejects(runDsh({ ...f.args, state: JSON.parse(persisted), run: async () => assert.fail('rejected identity must not reach a child command') }), /receipt|root/);
  });
}
test('receipt-only interrupted root is recoverable only with matching invocation-bound stdout', async t => {
  const f = fixture(t), runId = 'interrupted-run';
  const receipt = { taskKey: f.state.key, sessionId: 'root-a', root: true, runId, cwd: f.cwd };
  writeFileSync(f.receiptFile, JSON.stringify(receipt)); mkdirSync(join(f.root, 'logs'));
  const out = join(f.root, 'logs', `${runId}.stdout`);
  assert.throws(() => readLocalTask(f.root, config, 1), /opening NDJSON/);
  writeFileSync(out, stream(f.cwd, 'different-root'));
  assert.throws(() => readLocalTask(f.root, config, 1), /identity mismatch/);
  writeFileSync(out, stream(f.cwd));
  const selected = readLocalTask(f.root, config, 1);
  assert.equal(selected.state.sessionId, 'root-a');
  const text = await runDsh({ ...f.args, state: selected.state, run: async (argv, options) => {
    assert.equal(argv[argv.indexOf('--session-id') + 1], 'root-a'); return emit(f, argv, options);
  } });
  assert.equal(text, 'done');
});
test('a modern receipt is never treated as legacy when its root marker is missing', t => {
  const f = fixture(t); f.state.sessionId = 'root-a'; f.args.persist();
  writeFileSync(f.receiptFile, JSON.stringify({ taskKey: f.state.key, sessionId: 'root-a', runId: 'modern' }));
  assert.throws(() => readLocalTask(f.root, config, 1), /incomplete modern/);
});
test('legacy receipt-only identity must be reconciled before starting a model', async t => {
  const f = fixture(t);
  writeFileSync(f.receiptFile, JSON.stringify({ taskKey: f.state.key, sessionId: 'root-a', phase: 'turn/start' }));
  assert.equal(readLocalTask(f.root, config, 1).state.sessionId, undefined);
  await assert.rejects(runDsh({ ...f.args, run: async () => assert.fail('unverified legacy identity must not boot') }), /independently recorded/);
  f.state.sessionId = 'root-a'; f.args.persist();
  assert.equal(readLocalTask(f.root, config, 1).state.sessionId, 'root-a');
});
test('process log binding rejects path traversal and never overwrites or removes old evidence', async t => {
  const f = fixture(t), logDir = join(f.root, 'logs');
  await assert.rejects(command([process.execPath, '--version'], { cwd: f.cwd, logDir, logId: '../escape' }), /Invalid process log ID/);
  assert.equal(existsSync(join(f.root, 'escape.stdout')), false);
  const first = await command([process.execPath, '--version'], { cwd: f.cwd, logDir, logId: 'fixed-run' });
  const contents = readFileSync(first.out, 'utf8');
  await assert.rejects(command([process.execPath, '--version'], { cwd: f.cwd, logDir, logId: 'fixed-run', discardLogs: true }), error => error.code === 'EEXIST');
  assert.equal(readFileSync(first.out, 'utf8'), contents); assert(existsSync(first.err));
});
