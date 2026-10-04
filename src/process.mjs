import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// File descriptors, not captured named pipes: supported by the Windows DSH sandbox.
export async function command(argv, { cwd = process.cwd(), env = process.env, input, onSpawn, logDir = join(cwd, '.harness', 'logs') } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) throw Error('Command must be a nonempty string array');
  mkdirSync(logDir, { recursive: true });
  const id = randomUUID();
  const out = join(logDir, `${id}.stdout`), err = join(logDir, `${id}.stderr`);
  const fds = [input ? openSync(input, 'r') : 'ignore', openSync(out, 'w', 0o600), openSync(err, 'w', 0o600)];
  let [exe, ...args] = argv;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    if (argv.some(x => /["%\r\n!^&|<>]/.test(x))) throw Error('Unsafe Windows command argument');
    args = ['/d', '/s', '/c', `"${argv.map(x => `"${x}"`).join(' ')}"`];
    exe = process.env.ComSpec || 'cmd.exe';
  }
  try {
    const child = spawn(exe, args, { cwd, env, stdio: fds, windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' && /(?:^|[\\/])cmd\.exe$/i.test(exe) });
    onSpawn?.(child.pid);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1))); });
    return { code, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8'), out, err };
  } finally { for (const fd of fds) if (typeof fd === 'number') closeSync(fd); }
}

export async function git(args, options = {}) {
  const result = await command(['git', ...args], options);
  if (result.code !== 0) throw Error(`git ${args[0]} failed (${result.code}); inspect local log ${result.err}`);
  return result.stdout.trim();
}
