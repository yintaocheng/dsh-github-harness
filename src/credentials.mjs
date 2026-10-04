import { homedir } from 'node:os';
import { managedSpawn } from './process.mjs';

// Called only by the permission-gated desktop adapter, never during plugin activation.
// Credential-protocol output is captured in memory; it must NOT use the logging command() helper.
export async function credentialToken({ expectedLogin, signal, env = process.env } = {}) {
  signal?.throwIfAborted();
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return env.GH_TOKEN || env.GITHUB_TOKEN;
  if (process.platform !== 'win32') throw Error('Provide GH_TOKEN or GITHUB_TOKEN through your credential manager before using the desktop tool');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(expectedLogin || '')) throw Error('Configure agent.expectedLogin before looking up a credential');
  const childEnv = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of Object.keys(childEnv)) if (/^GIT_TRACE|^GIT_CURL_VERBOSE$/i.test(key)) delete childEnv[key];
  let output = '', overflow = false;
  let code;
  try {
    code = await managedSpawn('git', ['credential', 'fill'], {
      cwd: homedir(), env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], signal,
      onChild(child) {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => { if (output.length + chunk.length > 65536) overflow = true; else output += chunk; });
        child.stderr.resume(); // Never echo credential-helper output or errors into a tool result.
        child.stdin.on('error', () => {});
        child.stdin.end(`protocol=https\nhost=github.com\nusername=${expectedLogin}\n\n`);
      },
    });
  } catch {
    signal?.throwIfAborted();
    throw Error('Git Credential Manager lookup failed; log in with the configured account outside the model tool');
  }
  const token = code === 0 && !overflow ? output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9) : undefined;
  output = '';
  if (!token) throw Error('No GitHub credential. Log in with Git Credential Manager, then retry doctor; never paste a token into chat');
  return token;
}
