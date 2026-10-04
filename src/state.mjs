import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function load(path) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }
export function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}
export function acquire(root) {
  mkdirSync(root, { recursive: true });
  const path = join(root, 'lock.json');
  let fd;
  try { fd = openSync(path, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw Error('Workspace locked. Inspect status; after verifying both runner and child stopped, use unlock.'); throw e; }
  closeSync(fd);
  const value = { pid: process.pid, childPid: null, startedAt: new Date().toISOString() };
  save(path, value);
  return { child(pid) { value.childPid = pid ?? null; save(path, value); }, release() { unlinkSync(path); } };
}
export function unlock(root) {
  const path = join(root, 'lock.json'), value = load(path);
  if (!value) return;
  for (const pid of [value.pid, value.childPid].filter(Boolean)) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') continue; throw Error(`Cannot establish whether process ${pid} is stopped`); }
    throw Error(`Process ${pid} is still alive; refusing to unlock`);
  }
  unlinkSync(path);
}
