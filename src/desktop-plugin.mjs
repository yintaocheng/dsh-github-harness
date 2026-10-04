import { defineTool } from '@deepseek-ai/dsh-tools';
import { approveEscalation } from '@deepseek-ai/dsh-sandbox';
import { desktopTool } from './desktop-tool.mjs';

export const name = 'github-harness';
export const inject = ['tools', 'sandboxPolicy'];
export function apply(ctx) {
  const lifetime = new AbortController();
  const active = new Set();
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.allSettled([...active]);
  }, 'github-harness-cancel');
  ctx.tools.register(defineTool(desktopTool(ctx, { approveEscalation, lifetime: lifetime.signal, active })));
}
