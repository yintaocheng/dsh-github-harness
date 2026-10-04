import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './process.mjs';
import { load } from './state.mjs';

export function parseRun(text) {
  const events = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const session = events.find(e => e.type === 'session');
  const final = events.findLast(e => e.type === 'final');
  const end = events.findLast(e => e.type === 'status' && e.phase === 'turn_end');
  if (!session?.sessionId || !final || end?.reason?.kind !== 'completed') throw Error(`DSH did not complete a turn (${end?.reason ?? 'missing terminal event'})`);
  return { sessionId: session.sessionId, text: final.text };
}

export async function runDsh({ config, state, prompt, root, cwd, onSpawn, persist }) {
  const receipt = join(root, `${state.key}.session.json`);
  const previous = load(receipt);
  if (previous?.taskKey === state.key && previous.sessionId) state.sessionId = previous.sessionId;
  const patch = join(root, `${state.key}.patch.yml`);
  const plugin = fileURLToPath(new URL('./plugin.mjs', import.meta.url)).replaceAll('\\', '/');
  // JSON is also a YAML value; paths and config remain data, not executable YAML.
  writeFileSync(patch, '- insert:\n    - id: github-harness-session-link\n      name: ' + JSON.stringify(plugin) + '\n      config: ' + JSON.stringify({ receipt, taskKey: state.key }) + '\n');
  const input = join(root, `${state.key}.prompt.txt`);
  writeFileSync(input, prompt, { mode: 0o600 });
  const args = [...config.dsh.command, ...(config.dsh.patch ? ['--patch', config.dsh.patch] : []), '--patch', patch, '--json', ...(state.sessionId ? ['--session-id', state.sessionId] : []), '-'];
  const env = { ...process.env };
  // The trusted bridge owns outbound GitHub access. Do not hand its token to the model process.
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  const result = await command(args, { cwd, env, input, onSpawn, logDir: join(root, 'logs') });
  const recovered = load(receipt);
  if (recovered?.taskKey === state.key) state.sessionId = recovered.sessionId;
  state.dshLogs = { stdout: result.out, stderr: result.err };
  persist();
  if (result.code !== 0) throw Error(`DSH exited ${result.code}; inspect ${result.err}`);
  const parsed = parseRun(result.stdout);
  state.sessionId = parsed.sessionId;
  persist();
  return parsed.text;
}
