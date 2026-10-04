import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { execute, diagnosisFailed } from './runner.mjs';
import { credentialToken } from './credentials.mjs';

// Pure declaration/registration. No config, credential or repository is touched until execute().
export function desktopTool(ctx, { approveEscalation, run = execute, getToken = credentialToken, lifetime, active = new Set() } = {}) {
  return {
    name: 'github_harness',
    description: 'Run one GitHub Issue through an independent DSH headless session, tests and a reviewable PR; or diagnose/status its workspace. Uses the explicit trusted harness config in that repository. run may edit code, commit, push and update GitHub, never merge. All actions require full-access permission or approval; no background scheduler. Use workdir when the repository is below the session workspace.',
    parameters: {
      action: { type: 'string', required: true, enum: ['doctor', 'status', 'run'], description: 'doctor checks identity/read access/DSH command; status only reads local task state; run executes or resumes an Issue.' },
      issue: { type: 'number', description: 'Positive Issue number; required for run/status.' },
      workdir: { type: 'string', description: 'Target Git repository directory. Absolute or relative to the session workspace; never the installed plugin directory.' },
      config: { type: 'string', description: 'Config path relative to workdir (or absolute). Defaults to harness.local.json when present, otherwise harness.config.json. Never supply a token here.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!['doctor', 'status', 'run'].includes(args.action)) throw Error('Unsupported GitHub harness action');
      if (args.action !== 'doctor' && (!Number.isSafeInteger(args.issue) || args.issue < 1)) throw Error('A positive Issue number is required');
      const policy = ctx.sandboxPolicy.resolve(exec.agent ? { session: exec.agent.session } : {});
      const workspace = policy.workspaceRoot || exec.agent?.session?.header?.cwd;
      if (!workspace && !isAbsolute(args.workdir || '')) throw Error('Supply an absolute workdir or open a session in the target repository');
      const cwd = isAbsolute(args.workdir || '') ? resolve(args.workdir) : resolve(workspace, args.workdir || '.');
      const signal = lifetime ? AbortSignal.any([exec.signal, lifetime]) : exec.signal;
      await approveEscalation({ requestedMode: 'danger-full-access', effectiveMode: policy.mode, subject: 'GitHub harness operation', justification: `github_harness ${args.action} in ${cwd}. Host code reads local configuration; doctor/run access GitHub credentials; run executes code and publishes a PR.` }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: 'github_harness', signal });
      signal.throwIfAborted();
      const config = args.config || (existsSync(join(cwd, 'harness.local.json')) ? 'harness.local.json' : 'harness.config.json');
      const argv = ['--config', config, args.action, ...(args.action === 'doctor' ? [] : [String(args.issue)])];
      const work = run(argv, { cwd, signal, getToken });
      active.add(work);
      try {
        const result = await work;
        return JSON.stringify({ ok: !diagnosisFailed(result), action: args.action, result }, null, 2);
      } finally { active.delete(work); }
    },
    presentCall: args => ({ card: 'generic', title: 'GitHub Issue harness', kind: args.action === 'status' ? 'read' : 'other', rawInput: { action: args.action, ...(args.issue === undefined ? {} : { issue: args.issue }), ...(args.workdir === undefined ? {} : { workdir: args.workdir }) } }),
  };
}
