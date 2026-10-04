import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function terminateTree(child, grouped) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { killer.once('error', reject); killer.once('exit', resolve); });
  } else {
    try { process.kill(grouped ? -child.pid : child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
export async function managedSpawn(exe, args, { cwd, env = process.env, stdio, signal, onSpawn, onChild, windowsVerbatimArguments = false } = {}) {
  signal?.throwIfAborted();
  const grouped = process.platform !== 'win32' && !!signal;
  const child = spawn(exe, args, { cwd, env, stdio, windowsHide: true, windowsVerbatimArguments, detached: grouped });
  let stopping;
  const abort = () => { stopping ||= terminateTree(child, grouped); stopping.catch(() => {}); };
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, reason) => resolve(code ?? (reason ? 130 : 1)));
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    onSpawn?.(child.pid);
    onChild?.(child);
    const code = await completed;
    if (stopping) await stopping;
    signal?.throwIfAborted();
    return code;
  } catch (error) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await terminateTree(child, grouped);
      await completed.catch(() => {});
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) onSpawn?.(null);
  }
}

// File descriptors, not captured named pipes: supported by the Windows DSH sandbox.
export async function command(argv, { cwd = process.cwd(), env = process.env, input, onSpawn, signal, discardLogs = false, logDir = join(cwd, '.harness', 'logs') } = {}) {
  signal?.throwIfAborted();
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) throw Error('Command must be a nonempty string array');
  let [exe, ...args] = argv;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    if (argv.some(x => /["%\r\n!^&|<>]/.test(x))) throw Error('Unsafe Windows command argument');
    args = ['/d', '/s', '/c', `"${argv.map(x => `"${x}"`).join(' ')}"`];
    exe = process.env.ComSpec || 'cmd.exe';
  }
  mkdirSync(logDir, { recursive: true });
  const id = randomUUID();
  const out = join(logDir, `${id}.stdout`), err = join(logDir, `${id}.stderr`);
  const fds = [];
  try {
    fds.push(input ? openSync(input, 'r') : 'ignore');
    fds.push(openSync(out, 'w', 0o600));
    fds.push(openSync(err, 'w', 0o600));
    const code = await managedSpawn(exe, args, { cwd, env, stdio: fds, signal, onSpawn, windowsVerbatimArguments: process.platform === 'win32' && /(?:^|[\\/])cmd\.exe$/i.test(exe) });
    return { code, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8'), out: discardLogs ? undefined : out, err: discardLogs ? undefined : err };
  } finally {
    for (const fd of fds) if (typeof fd === 'number') closeSync(fd);
    if (discardLogs) for (const path of [out, err]) { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}
export async function git(args, options = {}) {
  const result = await command(['git', ...args], options);
  if (result.code !== 0) throw Error(`git ${args[0]} failed (${result.code}); inspect local log ${result.err}`);
  return result.stdout.trim();
}
