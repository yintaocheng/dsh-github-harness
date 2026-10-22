import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { SUPPORTED_DSH_VERSIONS, DSH_ENGINE_RANGE, parseDshVersion, assertSafeDshCommand, inspectDsh, requireCompatibleDsh } from '../src/compatibility.mjs';
import { sanitizedDshEnv } from '../src/environment.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
function scratch(t) {
  const parent = resolve(project, '.harness'); mkdirSync(parent, { recursive: true });
  const path = mkdtempSync(join(parent, 'compatibility-test-'));
  t.after(() => {
    const target = resolve(path);
    assert.equal(dirname(target), parent);
    assert(basename(target).startsWith('compatibility-test-'));
    rmSync(target, { recursive: true, force: true });
  });
  return path;
}
function config() {
  return { dsh: { command: ['fixture-dsh', 'headless', '--profile', 'fixture profile'] } };
}
const output = (stdout, code = 0) => ({ code, stdout, out: 'fixture.stdout', err: 'fixture.stderr' });
function untilAborted(signal) {
  return new Promise((resolve, reject) => {
    // AbortSignal.timeout is unref'ed; the watchdog keeps the fixture alive and bounds a broken probe.
    const watchdog = setTimeout(() => { signal.removeEventListener('abort', onAbort); reject(Error('fixture probe did not abort')); }, 2000);
    function onAbort() { clearTimeout(watchdog); reject(signal.reason); }
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
}

test('compatibility exports exactly the qualified release candidates and engine range', () => {
  assert.deepEqual(SUPPORTED_DSH_VERSIONS, ['0.2.0-rc.2', '0.2.1-rc.2']);
  assert.equal(DSH_ENGINE_RANGE, '0.2.0-rc.2 || 0.2.1-rc.2');
  assert(Object.isFrozen(SUPPORTED_DSH_VERSIONS));
});
test('parseDshVersion accepts only a single standalone version, not diagnostic chatter', () => {
  for (const [text, expected] of [['0.2.0-rc.2', '0.2.0-rc.2'], ['v0.2.1-rc.2\r\n', '0.2.1-rc.2'], [' \t0.2.1-rc.2\n', '0.2.1-rc.2'], ['99.0.0', '99.0.0'], ['v22.19.0\n', '22.19.0']]) {
    assert.equal(parseDshVersion(text), expected);
  }
  for (const text of [undefined, null, 7, {}, '', '   ', 'DSH 0.2.1-rc.2', '0.2.1-rc.2\nextra', '0.2.1-rc.2\n0.2.1-rc.2', '0.2', 'v', '0.2.1-']) {
    assert.equal(parseDshVersion(text), null);
  }
});
test('assertSafeDshCommand requires a nonempty string argv array without mutating it', () => {
  for (const argv of [undefined, null, 'dsh', [], [''], ['dsh', null], ['dsh', 1], ['dsh', '']]) assert.throws(() => assertSafeDshCommand(argv), /nonempty argv array/);
  const argv = Object.freeze(['fixture-dsh', 'headless', '--profile', 'fixture profile', '--patch', 'fixture patch.yml']);
  assert.doesNotThrow(() => assertSafeDshCommand(argv));
});
for (const flag of ['--from-default-profile', '--from-default-profile=default', '--from-default-profile=']) {
  test(`destructive ${flag} is rejected before even --version or --help`, async () => {
    const selected = config(); selected.dsh.command.push(flag);
    assert.throws(() => assertSafeDshCommand(selected.dsh.command), /--from-default-profile.*delete and replace/);
    await assert.rejects(inspectDsh(selected, { run: async () => assert.fail('destructive command must never run') }), /--from-default-profile/);
  });
}
test('sanitizedDshEnv removes case-insensitive token names from a copy without global mutation', () => {
  const before = { ...process.env };
  const parent = Object.freeze({ GH_TOKEN: 'fixture-upper', gh_token: 'fixture-lower', Gh_ToKeN: 'fixture-mixed', GITHUB_TOKEN: 'fixture-upper', github_token: 'fixture-lower', GitHub_Token: 'fixture-mixed', Path: 'fixture-path', HOME: 'fixture-home', GITHUB_TOKEN_EXTRA: 'keep-suffix' });
  const child = sanitizedDshEnv(parent);
  assert.deepEqual(child, { Path: 'fixture-path', HOME: 'fixture-home', GITHUB_TOKEN_EXTRA: 'keep-suffix' });
  assert.notEqual(child, parent); assert.equal(parent.GH_TOKEN, 'fixture-upper');
  assert(isDeepStrictEqual({ ...process.env }, before), 'environment sanitization must not change process.env');
});
for (const version of ['0.2.0-rc.2', '0.2.1-rc.2']) {
  test(`inspectDsh qualifies ${version} using exact argv, bounded signals and sanitized child env`, async t => {
    const selected = config(), beforeConfig = structuredClone(selected), cwd = scratch(t), before = { ...process.env }, originalCwd = process.cwd();
    const controller = new AbortController(), calls = [], spawned = [], onSpawn = pid => spawned.push(pid);
    const report = await inspectDsh(selected, { cwd, signal: controller.signal, onSpawn, run: async (argv, options) => {
      calls.push(argv);
      assert.equal(options.cwd, cwd); assert.equal(options.onSpawn, onSpawn);
      assert(options.signal instanceof AbortSignal); assert.notEqual(options.signal, controller.signal); assert.equal(options.signal.aborted, false);
      assert.notEqual(options.env, process.env);
      assert(!Object.keys(options.env).some(key => /^(GH_TOKEN|GITHUB_TOKEN)$/i.test(key)));
      assert(isDeepStrictEqual(options.env, sanitizedDshEnv(before)), 'probe must use sanitized parent env');
      options.onSpawn(12345 + calls.length);
      return argv.at(-1) === '--version' ? output(`v${version}\r\n`) : output('fixture help');
    } });
    assert.deepEqual(calls, [[...selected.dsh.command, '--version'], [...selected.dsh.command, '--help']]);
    assert.deepEqual(report, { status: 'ok', version, supported: true, supportedVersions: SUPPORTED_DSH_VERSIONS, versionExit: 0, helpExit: 0, diagnosticFile: 'fixture.stderr', reason: null });
    assert.equal(requireCompatibleDsh(report), report); assert.deepEqual(spawned, [12346, 12347]);
    assert.deepEqual(selected, beforeConfig); assert.equal(controller.signal.aborted, false);
    assert(isDeepStrictEqual({ ...process.env }, before), 'qualification must not mutate process.env'); assert.equal(process.cwd(), originalCwd);
  });
}
for (const scenario of [
  { name: 'unknown newer DSH', version: output('0.99.0\n'), expectedVersion: '0.99.0', supported: false, reason: 'unsupported_version' },
  { name: 'fake Node version despite successful help', version: output('v22.19.0\n'), expectedVersion: '22.19.0', supported: false, reason: 'unsupported_version' },
  { name: 'nonzero version exit despite known text', version: output('0.2.1-rc.2\n', 9), expectedVersion: null, supported: false, reason: 'unrecognized_version' },
  { name: 'unrecognized version text', version: output('DSH fixture diagnostics\n'), expectedVersion: null, supported: false, reason: 'unrecognized_version' },
  { name: 'empty version output', version: output(''), expectedVersion: null, supported: false, reason: 'unrecognized_version' },
  { name: 'nonzero help exit', version: output('0.2.1-rc.2\n'), help: output('fixture help failed', 3), expectedVersion: '0.2.1-rc.2', supported: true, reason: 'help_failed' },
]) {
  test(`inspectDsh fails closed for ${scenario.name}`, async () => {
    const selected = config(), calls = [];
    const report = await inspectDsh(selected, { run: async argv => { calls.push(argv); return argv.at(-1) === '--version' ? scenario.version : (scenario.help || output('fixture help')); } });
    assert.equal(report.status, 'failed'); assert.equal(report.version, scenario.expectedVersion); assert.equal(report.supported, scenario.supported);
    assert.equal(report.reason, scenario.reason); assert.equal(report.versionExit, scenario.version.code); assert.equal(report.helpExit, scenario.help?.code);
    assert.deepEqual(report.supportedVersions, SUPPORTED_DSH_VERSIONS);
    assert.deepEqual(calls, [[...selected.dsh.command, '--version'], ...(scenario.supported ? [[...selected.dsh.command, '--help']] : [])]);
    assert.throws(() => requireCompatibleDsh(report), /Unsupported or unavailable DSH/);
  });
}
for (const stage of ['--version', '--help']) {
  test(`inspectDsh reports command failure during ${stage} without leaking the thrown detail`, async () => {
    const before = { ...process.env }, calls = [], detail = 'fixture-private-command-detail';
    const report = await inspectDsh(config(), { run: async argv => {
      calls.push(argv.at(-1)); if (argv.at(-1) === stage) throw Error(detail);
      return output('0.2.1-rc.2');
    } });
    assert.deepEqual(report, { status: 'failed', version: stage === '--version' ? null : '0.2.1-rc.2', supported: stage === '--help', supportedVersions: SUPPORTED_DSH_VERSIONS, reason: 'command_failed' });
    assert.deepEqual(calls, stage === '--version' ? ['--version'] : ['--version', '--help']);
    assert(!JSON.stringify(report).includes(detail)); assert(isDeepStrictEqual({ ...process.env }, before), 'failed probe must not mutate process.env');
  });
  test(`inspectDsh bounds a stalled ${stage} probe and reports probe_timeout`, async () => {
    const calls = [], signals = [];
    const report = await inspectDsh(config(), { timeoutMs: 20, run: async (argv, options) => {
      calls.push(argv.at(-1)); signals.push(options.signal);
      return argv.at(-1) === stage ? untilAborted(options.signal) : output('0.2.1-rc.2');
    } });
    assert.deepEqual(report, { status: 'failed', version: stage === '--version' ? null : '0.2.1-rc.2', supported: stage === '--help', supportedVersions: SUPPORTED_DSH_VERSIONS, reason: 'probe_timeout' });
    assert.deepEqual(calls, stage === '--version' ? ['--version'] : ['--version', '--help']);
    assert.equal(signals.at(-1).aborted, true); assert.equal(signals.at(-1).reason.name, 'TimeoutError');
    if (signals.length === 2) assert.equal(signals[0], signals[1], 'one deadline must bound the whole inspection');
  });
  test(`inspectDsh propagates caller cancellation during ${stage} rather than swallowing it`, async () => {
    const controller = new AbortController(), reason = new DOMException('fixture cancellation', 'AbortError'), calls = [];
    await assert.rejects(inspectDsh(config(), { signal: controller.signal, timeoutMs: 1000, run: async (argv, options) => {
      calls.push(argv.at(-1));
      if (argv.at(-1) !== stage) return output('0.2.1-rc.2');
      queueMicrotask(() => controller.abort(reason));
      return untilAborted(options.signal);
    } }), error => error === reason);
    assert.deepEqual(calls, stage === '--version' ? ['--version'] : ['--version', '--help']);
  });
}
test('inspectDsh honors an already aborted caller without invoking a command', async () => {
  const controller = new AbortController(), reason = Error('fixture already cancelled'); controller.abort(reason);
  await assert.rejects(inspectDsh(config(), { signal: controller.signal, run: async () => assert.fail('aborted probe must not run') }), error => error === reason);
});
test('requireCompatibleDsh rejects absent and failed reports with actionable qualified-version guidance', () => {
  for (const report of [undefined, null, {}, { status: 'failed', reason: 'command_failed' }, { status: 'failed', version: '99.0.0' }]) {
    assert.throws(() => requireCompatibleDsh(report), error => {
      assert.match(error.message, /Unsupported or unavailable DSH/);
      assert(error.message.includes(DSH_ENGINE_RANGE));
      assert.match(error.message, /run doctor; do not bypass compatibility checks/);
      return true;
    });
  }
});

test('task preflight never boots a supported profile outside its task lock', async () => {
  const calls = [];
  const report = await inspectDsh(config(), { probeHelp: false, run: async argv => { calls.push(argv.at(-1)); return output('0.2.1-rc.2'); } });
  assert.deepEqual(calls, ['--version']); assert.equal(report.status, 'ok'); assert.equal(report.helpSkipped, true);
  assert.equal(requireCompatibleDsh(report), report);
});

// Every command above is injected. No real DSH profile, executable, credential, or network is used.