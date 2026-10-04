import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, watch } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopTool } from '../src/desktop-tool.mjs';
import { execute } from '../src/runner.mjs';
import { command } from '../src/process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const scratch = join(root, '.harness'); mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, 'desktop-test-'));
  t.after(() => { assert.equal(dirname(cwd), scratch); assert(basename(cwd).startsWith('desktop-test-')); rmSync(cwd, { recursive: true, force: true }); });
  const config = { owner: 'fixture', repo: 'repo', base: 'main', agent: { id: 'solo', expectedLogin: 'actor' }, dsh: { command: [process.execPath] }, verify: [[process.execPath, '-e', 'process.exit(0)']] };
  writeFileSync(join(cwd, 'harness.local.json'), JSON.stringify(config));
  return cwd;
}
const gate = async ({ effectiveMode }, { signal }) => { signal.throwIfAborted(); if (effectiveMode !== 'danger-full-access') throw Error('Approval disabled; refusing escalation'); };
function context(cwd, mode = 'danger-full-access') { return { sandboxPolicy: { resolve: () => ({ workspaceRoot: cwd, mode }) }, get: () => undefined }; }
function execution() { return { signal: new AbortController().signal, callId: 'unit', agent: undefined }; }

test('desktop bundle manifest has a separate loadable host entry and no install scripts', () => {
  const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(p.dsh.bundle.patch, './cordis.patch.yml'); assert.notEqual(p.exports['.'], p.exports['./plugin']);
  assert(existsSync(join(root, p.exports['.']))); assert.match(readFileSync(join(root, p.dsh.bundle.patch), 'utf8'), /name: dsh-github-harness/);
  assert(!p.files.some(x => x.startsWith('.harness') || x.includes('.local.')));
  assert(!p.scripts.prepare && !p.scripts.postinstall);
});
test('declaring desktop tool is inert; unavailable config/credentials do not break activation', () => {
  let calls = 0;
  const tool = desktopTool(context('/not-read'), { approveEscalation: async () => { calls++; }, run: async () => { calls++; } });
  assert.equal(tool.name, 'github_harness'); assert.equal(calls, 0);
});
test('desktop adapter rejects read-only/never before any runner or credential lookup', async t => {
  const cwd = fixture(t); let calls = 0;
  const tool = desktopTool(context(cwd, 'read-only'), { approveEscalation: gate, run: async () => { calls++; }, getToken: () => { calls++; } });
  await assert.rejects(tool.execute({ action: 'run', issue: 1 }, execution()), /refusing escalation/);
  assert.equal(calls, 0); assert(!existsSync(join(cwd, '.harness')));
});
test('desktop status uses workspace-local config, not plugin cwd, and remains read-only', async t => {
  const cwd = fixture(t), original = process.cwd(); let credentials = 0;
  const tool = desktopTool(context(cwd), { approveEscalation: gate, getToken: () => { credentials++; throw Error('must not read credentials'); } });
  const value = JSON.parse(await tool.execute({ action: 'status', issue: 3 }, execution()));
  assert.equal(value.ok, true); assert.deepEqual(value.result, { task: null, session: null, lock: null });
  assert.equal(credentials, 0); assert.equal(process.cwd(), original); assert(!existsSync(join(cwd, '.harness')));
});
test('desktop workdir is relative to session workspace and signal is forwarded', async t => {
  const cwd = fixture(t), exec = execution(); let observed;
  const tool = desktopTool(context(cwd), { approveEscalation: gate, run: async (argv, options) => { observed = { argv, options }; return { status: 'waiting' }; } });
  const value = JSON.parse(await tool.execute({ action: 'run', issue: 5, workdir: 'project', config: 'custom.json' }, exec));
  assert.equal(observed.options.cwd, resolve(cwd, 'project')); assert.equal(observed.options.signal, exec.signal);
  assert.deepEqual(observed.argv, ['--config', 'custom.json', 'run', '5']); assert.equal(value.result.status, 'waiting');
});
test('pre-aborted desktop call never enters runner; disposal aborts an active call', async t => {
  const cwd = fixture(t), lifetime = new AbortController(), active = new Set();
  let started;
  const ready = new Promise(resolveReady => { started = resolveReady; });
  const tool = desktopTool(context(cwd), { approveEscalation: gate, lifetime: lifetime.signal, active, run: (_argv, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started(); }) });
  const work = tool.execute({ action: 'run', issue: 1 }, execution());
  await ready; assert.equal(active.size, 1); lifetime.abort();
  await assert.rejects(work, { name: 'AbortError' }); assert.equal(active.size, 0);
  await assert.rejects(tool.execute({ action: 'run', issue: 1 }, execution()), { name: 'AbortError' });
});
test('shared runner releases its lock after an aborted GitHub request', async t => {
  const cwd = fixture(t), originalFetch = globalThis.fetch, controller = new AbortController();
  let started; const ready = new Promise(done => { started = done; });
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started(); });
  t.after(() => { globalThis.fetch = originalFetch; controller.abort(); });
  const work = execute(['--config', 'harness.local.json', 'issue-create', 'title', 'unused.md'], { cwd, signal: controller.signal, getToken: async () => 'test-only' });
  await ready; assert(existsSync(join(cwd, '.harness', 'lock.json')));
  controller.abort(); await assert.rejects(work);
  assert(!existsSync(join(cwd, '.harness', 'lock.json')));
});
test('a failed spawn checkpoint does not leave its child running', async t => {
  const cwd = fixture(t); let pid;
  await assert.rejects(command([process.execPath, '-e', 'setInterval(()=>{},1000)'], { cwd, onSpawn(value) { if (value) { pid = value; throw Error('checkpoint failed'); } } }), /checkpoint failed/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('cancelling a foreground command terminates its child process tree', { timeout: 15000 }, async t => {
  const cwd = fixture(t), controller = new AbortController(), marker = join(cwd, 'children.json');
  let timer, watcher;
  const ready = new Promise((resolveReady, reject) => {
    watcher = watch(cwd, () => { try { if (existsSync(marker)) resolveReady(JSON.parse(readFileSync(marker, 'utf8'))); } catch {} });
    timer = setTimeout(() => reject(Error('Child did not become ready')), 8000);
  });
  t.after(() => { controller.abort(); watcher.close(); clearTimeout(timer); });
  const program = "const{spawn}=require('node:child_process');const{writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync('children.json',JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000)";
  const work = command([process.execPath, '-e', program], { cwd, signal: controller.signal });
  work.catch(() => {});
  let pids;
  try { pids = await ready; } finally { controller.abort(); clearTimeout(timer); }
  await assert.rejects(work, { name: 'AbortError' });
  for (const pid of Object.values(pids)) {
    try {
      process.kill(pid, 0);
      // A reparented POSIX child may briefly be a zombie, which cannot execute code.
      if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) continue;
      assert.fail(`Cancelled child ${pid} is still running`);
    } catch (error) { if (!['ESRCH', 'ENOENT'].includes(error.code)) throw error; }
  }
});
