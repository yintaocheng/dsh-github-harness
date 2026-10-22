import { command } from './process.mjs';
import { sanitizedDshEnv } from './environment.mjs';

// Developer-preview APIs can change between release candidates. Expand only after qualification.
export const SUPPORTED_DSH_VERSIONS = Object.freeze(['0.2.0-rc.2', '0.2.1-rc.2']);
export const DSH_ENGINE_RANGE = SUPPORTED_DSH_VERSIONS.join(' || ');
export function parseDshVersion(stdout) {
  if (typeof stdout !== 'string') return null;
  return /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(stdout.trim())?.[1] || null;
}
export function assertSafeDshCommand(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string' || !x)) throw Error('dsh.command must be a nonempty argv array');
  if (argv.some(x => /^--from-default-profile(?:=|$)/.test(x))) throw Error('Do not put --from-default-profile in dsh.command: DSH can delete and replace an existing profile, even during --help');
}
export async function inspectDsh(config, { cwd, signal, onSpawn, run = command, timeoutMs = 15000, probeHelp = true } = {}) {
  assertSafeDshCommand(config.dsh.command);
  signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(timeoutMs);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const options = { cwd, onSpawn, signal: bounded, env: sanitizedDshEnv() };
  let version, parsed = null, supported = false;
  try {
    version = await run([...config.dsh.command, '--version'], options);
    parsed = version.code === 0 ? parseDshVersion(version.stdout) : null;
    supported = SUPPORTED_DSH_VERSIONS.includes(parsed);
    const report = { version: parsed, supported, supportedVersions: SUPPORTED_DSH_VERSIONS, versionExit: version.code, diagnosticFile: version.err };
    // --help boots the configured profile: never do so for an unqualified runtime.
    if (!supported) return { ...report, status: 'failed', reason: !parsed ? 'unrecognized_version' : 'unsupported_version' };
    // Task preflight only checks the executable. Actual headless boot runs under the task lock.
    if (!probeHelp) return { ...report, status: 'ok', helpSkipped: true, reason: null };
    const help = await run([...config.dsh.command, '--help'], options);
    return { ...report, status: help.code === 0 ? 'ok' : 'failed', helpExit: help.code, diagnosticFile: help.err, reason: help.code !== 0 ? 'help_failed' : null };
  } catch {
    signal?.throwIfAborted();
    return { status: 'failed', version: parsed, supported, supportedVersions: SUPPORTED_DSH_VERSIONS, reason: deadline.aborted ? 'probe_timeout' : 'command_failed' };
  }
}
export function requireCompatibleDsh(result) {
  if (result?.status !== 'ok') throw Error(`Unsupported or unavailable DSH (${result?.version || result?.reason || 'unknown'}). Tested versions: ${DSH_ENGINE_RANGE}. Upgrade/configure dsh.command, then run doctor; do not bypass compatibility checks.`);
  return result;
}
