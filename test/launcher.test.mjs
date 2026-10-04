import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../src/process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Windows launcher selects config and propagates failure without credentials', { skip: process.platform !== 'win32' }, async t => {
  const scratch = join(root, '.harness');
  mkdirSync(scratch, { recursive: true });
  const fixture = mkdtempSync(join(scratch, 'launcher with spaces-'));
  t.after(() => {
    assert.equal(dirname(fixture), scratch);
    assert(basename(fixture).startsWith('launcher with spaces-'));
    rmSync(fixture, { recursive: true, force: true });
  });
  copyFileSync(join(root, 'harness.cmd'), join(fixture, 'harness.cmd'));
  mkdirSync(join(fixture, 'scripts'));
  // A local stub, not the real credential bridge: no Git, network or model calls.
  writeFileSync(join(fixture, 'scripts', 'run.ps1'), '[Console]::WriteLine($args[1])\nif ($args -contains "fail") { exit 1 }\nexit 0\n');
  writeFileSync(join(fixture, 'harness.config.json'), '{}');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(Path|SystemRoot|WINDIR|TEMP|TMP)$/i.test(key)));
  const run = arg => command([join(fixture, 'harness.cmd'), arg], { cwd: fixture, env, logDir: join(fixture, 'logs') });
  const fallback = await run('help');
  assert.equal(fallback.code, 0);
  assert.equal(fallback.stdout.trim(), join(fixture, 'harness.config.json'));
  writeFileSync(join(fixture, 'harness.local.json'), '{}');
  const local = await run('help');
  assert.equal(local.code, 0);
  assert.equal(local.stdout.trim(), join(fixture, 'harness.local.json'));
  const failure = await run('fail');
  assert.equal(failure.code, 1, 'a failing CLI must never look successful');
  assert.equal(readFileSync(join(fixture, 'harness.local.json'), 'utf8'), '{}');
  await t.test('external target uses its own config instead of the installed plugin config', async () => {
    const target = join(fixture, 'another target with spaces');
    mkdirSync(target);
    writeFileSync(join(target, 'harness.config.json'), '{}');
    const invoke = () => command([join(fixture, 'harness.cmd'), 'help'], { cwd: target, env, logDir: join(fixture, 'logs') });
    const targetFallback = await invoke();
    assert.equal(targetFallback.code, 0);
    assert.equal(targetFallback.stdout.trim(), join(target, 'harness.config.json'));
    writeFileSync(join(target, 'harness.local.json'), '{}');
    const targetLocal = await invoke();
    assert.equal(targetLocal.code, 0);
    assert.equal(targetLocal.stdout.trim(), join(target, 'harness.local.json'));
  });
});
