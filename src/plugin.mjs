import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { save } from './state.mjs';

export const name = 'dsh-github-harness-session-link';
export const inject = ['sessions'];
const identity = value => typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value);
const directory = value => { const path = realpathSync(value); return process.platform === 'win32' ? path.toLowerCase() : path; };
export function apply(ctx, config) {
  if (!isAbsolute(config?.receipt || '') || !isAbsolute(config?.cwd || '') || !identity(config?.taskKey) || !identity(config?.runId) || (config.sessionId !== undefined && !identity(config.sessionId))) throw Error('session-link requires receipt, cwd, taskKey and runId with an optional expected root session');
  const cwd = directory(config.cwd);
  let rootId = config.sessionId;
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return;
    if (!identity(session?.id) || !session.header || session.header.origin === 'subagent' || session.header.parentSession !== undefined || !isAbsolute(session.header.cwd || '')) return;
    if (rootId && session.id !== rootId) return;
    try { if (directory(session.header.cwd) !== cwd) return; } catch { return; }
    rootId ||= session.id;
    // Child/fork events and foreign roots never replace the task's recovery identity.
    save(config.receipt, { sessionId: rootId, taskKey: config.taskKey, runId: config.runId, cwd: config.cwd, root: true, phase: event.type, reason: event.data?.reason });
  });
}
