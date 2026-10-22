import { writeFileSync, realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { command } from './process.mjs';
import { load, save } from './state.mjs';
import { sanitizedDshEnv } from './environment.mjs';
import { admitSessionReceipt, validSessionId as sessionId } from './session-receipt.mjs';
export { sanitizedDshEnv } from './environment.mjs';

const directory = value => { const path = realpathSync(value); return process.platform === 'win32' ? path.toLowerCase() : path; };
export function parseRun(text, { expectedSessionId, cwd } = {}) {
  let events;
  try { events = text.split(/\r?\n/).filter(x => x.trim()).map(line => JSON.parse(line)); } catch { throw Error('DSH returned malformed NDJSON'); }
  if (events.some(e => !e || typeof e !== 'object' || Array.isArray(e))) throw Error('DSH returned an invalid event');
  const sessions = events.filter(e => e.type === 'session');
  const session = sessions[0];
  if (!sessionId(session?.sessionId) || sessions.some(e => e.sessionId !== session.sessionId || e.cwd !== session.cwd) || (expectedSessionId && session.sessionId !== expectedSessionId)) throw Error('DSH root session identity mismatch');
  if (cwd && (!isAbsolute(session.cwd || '') || directory(session.cwd) !== directory(cwd))) throw Error('DSH root session working directory mismatch');
  const final = events.findLast(e => e.type === 'final');
  const end = events.findLast(e => e.type === 'status' && e.phase === 'turn_end');
  if (events.some(e => e.type === 'error') || typeof final?.text !== 'string' || end?.reason?.kind !== 'completed') throw Error('DSH did not complete a successful turn');
  return { sessionId: session.sessionId, text: final.text };
}
export async function runDsh({ config, state, prompt, root, cwd, onSpawn, persist, signal, run = command }) {
  if (state.sessionId !== undefined && !sessionId(state.sessionId)) throw Error('Invalid task root session');
  const receiptPath = join(root, `${state.key}.session.json`), previous = load(receiptPath);
  const admission = () => ({ taskKey: state.key, knownSessionId: state.sessionId, root, cwd });
  const previousId = admitSessionReceipt(previous, admission());
  if (previousId) state.sessionId = previousId;
  const expectedSessionId = state.sessionId, runId = randomUUID(), logDir = join(root, 'logs');
  const patch = join(root, `${state.key}.patch.yml`);
  const plugin = fileURLToPath(new URL('./plugin.mjs', import.meta.url)).replaceAll('\\', '/');
  const link = { receipt: receiptPath, taskKey: state.key, cwd, runId, ...(expectedSessionId ? { sessionId: expectedSessionId } : {}) };
  writeFileSync(patch, '- insert:\n    - id: github-harness-session-link\n      name: ' + JSON.stringify(plugin) + '\n      config: ' + JSON.stringify(link) + '\n');
  const input = join(root, `${state.key}.prompt.txt`);
  writeFileSync(input, prompt, { mode: 0o600 });
  const args = [...config.dsh.command, ...(config.dsh.patch ? ['--patch', config.dsh.patch] : []), '--patch', patch, '--json', ...(expectedSessionId ? ['--session-id', expectedSessionId] : []), '-'];
  const options = { cwd, env: sanitizedDshEnv(), input, onSpawn, signal, logDir, logId: runId };
  const invalidate = receipt => {
    // Keep the evidence, but never let a rejected observation become trusted on restart.
    if (receipt && JSON.stringify(receipt) !== JSON.stringify(previous)) save(receiptPath, { ...receipt, rejected: true, rejectionRunId: runId });
  };
  const recover = () => {
    const receipt = load(receiptPath);
    if (receipt?.runId !== runId) { invalidate(receipt); return; }
    try {
      const recoveredId = admitSessionReceipt(receipt, admission());
      if (recoveredId) state.sessionId = recoveredId;
    } catch (error) { invalidate(receipt); throw error; }
  };
  let result;
  try { result = await run(args, options); }
  catch (error) {
    state.dshLogs = { stdout: join(logDir, `${runId}.stdout`), stderr: join(logDir, `${runId}.stderr`) };
    recover(); persist(); throw error;
  }
  state.dshLogs = { stdout: result.out, stderr: result.err };
  if (result.code !== 0) {
    recover(); persist();
    throw Error(`DSH exited ${result.code}; inspect ${result.err}`);
  }
  persist();
  const receipt = load(receiptPath);
  let parsed;
  try {
    parsed = parseRun(result.stdout, { expectedSessionId, cwd });
    if (!receipt || receipt.runId !== runId) throw Error('Missing or conflicting current root receipt; reconcile before retrying');
    const recoveredId = admitSessionReceipt(receipt, admission());
    if (recoveredId !== parsed.sessionId) throw Error('Missing or conflicting current root receipt; reconcile before retrying');
  } catch (error) { invalidate(receipt); throw error; }
  state.sessionId = parsed.sessionId;
  persist();
  return parsed.text;
}
