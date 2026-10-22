import { openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export const validSessionId = value => typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value);
export const validRunId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
export const directoryIdentity = value => {
  const path = realpathSync(value);
  return process.platform === 'win32' ? path.toLowerCase() : path;
};
function conflict(detail) { throw Error(`DSH recovery receipt conflicts with the task root; ${detail}; reconcile before retrying`); }
function openingFrame(root, runId) {
  let fd;
  try {
    fd = openSync(join(root, 'logs', `${runId}.stdout`), 'r');
    const buffer = Buffer.alloc(65536);
    const text = buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0));
    const line = text.split(/\r?\n/).find(x => x.trim());
    return JSON.parse(line);
  } catch { conflict('missing or invalid invocation-bound opening NDJSON'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

// The same admission rule is used on initial execution AND process restart.
// A receipt alone is not proof of the headless root: another root can emit events first.
export function admitSessionReceipt(receipt, { taskKey, knownSessionId, cwd, root, deferLegacy = false } = {}) {
  if (!receipt) return undefined;
  if (receipt.taskKey !== taskKey || !validSessionId(receipt.sessionId) || receipt.rejected || receipt.root === false) conflict('invalid, rejected, or foreign receipt');
  if (knownSessionId && knownSessionId !== receipt.sessionId) conflict('Conflicting task sessions');
  const modern = ['runId', 'root', 'cwd'].some(key => Object.hasOwn(receipt, key));
  if (!modern) {
    // Legacy receipt-only aliases may be selected, but cannot establish a session identity.
    // Core can recover a known identity from an authenticated PR/Issue checkpoint first.
    if (!knownSessionId) {
      if (deferLegacy) return undefined;
      conflict('legacy receipt needs an independently recorded session identity');
    }
    return receipt.sessionId;
  }
  if (receipt.root !== true || !validRunId(receipt.runId) || typeof receipt.cwd !== 'string' || !isAbsolute(receipt.cwd)) conflict('incomplete modern root receipt');
  const opening = openingFrame(root, receipt.runId);
  if (opening?.type !== 'session' || opening.sessionId !== receipt.sessionId || typeof opening.cwd !== 'string' || !isAbsolute(opening.cwd)) conflict('opening NDJSON root identity mismatch');
  try {
    if (directoryIdentity(receipt.cwd) !== directoryIdentity(cwd) || directoryIdentity(opening.cwd) !== directoryIdentity(cwd)) conflict('working directory mismatch');
  } catch { conflict('working directory mismatch'); }
  return receipt.sessionId;
}
