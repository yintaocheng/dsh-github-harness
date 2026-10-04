import { save } from './state.mjs';

// Verified Cordis module shape and the same event used by dsh-headless/json-stream.
// No private HTTP API, no replacement Agent runtime, and no GitHub credentials here.
export const name = 'dsh-github-harness-session-link';
export const inject = ['sessions'];
export function apply(ctx, config) {
  if (!config?.receipt) throw Error('session-link requires a receipt path');
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return;
    save(config.receipt, {
      sessionId: session.id, taskKey: config.taskKey,
      phase: event.type, reason: event.data?.reason,
    });
  });
}
