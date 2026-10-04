import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { GitHub } from './github.mjs';
import { Repo, remoteMatches } from './repo.mjs';
import { load, save, acquire, unlock } from './state.mjs';
import { runDsh } from './dsh.mjs';
import { runTask } from './core.mjs';
import { createRunContext, readLocalTask, isTaskBranch } from './identity.mjs';
import { command, git } from './process.mjs';

export function validateConfig(c) {
  for (const [key, value] of [['owner', c.owner], ['repo', c.repo], ['agent.id', c.agent?.id], ['agent.expectedLogin', c.agent?.expectedLogin]]) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) || value.includes('..')) throw Error(`Invalid config ${key}`);
  }
  if (typeof c.base !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(c.base) || c.base.includes('..')) throw Error('Invalid base branch');
  if (!Array.isArray(c.dsh?.command) || !c.dsh.command.length || c.dsh.command.some(x => typeof x !== 'string')) throw Error('dsh.command must be an argv array');
  if (!Array.isArray(c.verify) || !c.verify.length || c.verify.some(x => !Array.isArray(x) || !x.length || x.some(a => typeof a !== 'string'))) throw Error('verify must contain explicit argv arrays');
  return c;
}
export const usage = 'Usage: node src/cli.mjs [--config harness.local.json] doctor|bootstrap|run ISSUE|status ISSUE|unlock|issue-create TITLE BODY_FILE|comment ISSUE BODY_FILE';

// Explicit workspace and return value: safe to share with a desktop Host tool without chdir/stdout interception.
export async function execute(argv = [], { cwd = process.cwd(), signal, getToken } = {}) {
  signal?.throwIfAborted();
  argv = [...argv]; cwd = resolve(cwd);
  let configPath = 'harness.config.json';
  const index = argv.indexOf('--config');
  if (index >= 0) {
    if (!argv[index + 1]) throw Error('--config requires a path');
    configPath = argv[index + 1]; argv.splice(index, 2);
  }
  const [action = 'help', rawIssue, ...extra] = argv;
  if (action === 'help') return usage;
  if (!['doctor', 'bootstrap', 'run', 'status', 'unlock', 'issue-create', 'comment'].includes(action)) throw Error('Unknown action');
  let parsed;
  try { parsed = JSON.parse(readFileSync(resolve(cwd, configPath), 'utf8')); }
  catch { throw Error(`Cannot read valid harness configuration: ${resolve(cwd, configPath)}. Copy harness.config.json to your workspace and configure repository, operator and DSH command; never put a token in it.`); }
  const issue = Number(rawIssue);
  if (['run', 'status', 'comment'].includes(action) && (!Number.isSafeInteger(issue) || issue < 1)) throw Error('Issue number must be a positive integer');
  const context = createRunContext(validateConfig(parsed), { cwd, action, issue: ['run', 'status', 'comment'].includes(action) ? issue : undefined });
  const config = context.config, root = join(context.project.workdir, '.harness');
  if (action === 'unlock') { unlock(root); return { status: 'unlocked' }; }
  if (action === 'status') {
    const local = readLocalTask(root, config, issue);
    return { task: local.known ? local.state : null, session: local.session, lock: load(join(root, 'lock.json')) };
  }
  const token = getToken ? await getToken({ expectedLogin: config.agent.expectedLogin, signal }) : process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const github = new GitHub(config, { token, signal });
  if (action === 'doctor') {
    const access = await github.diagnose();
    const dsh = await command([...config.dsh.command, '--help'], { cwd, signal });
    return { cwd, expectedOwner: config.owner, repository: access.repository.full_name, actualOperator: access.login, agentId: config.agent.id, github: access, dshHelpExit: dsh.code, diagnosticFile: dsh.err };
  }
  signal?.throwIfAborted();
  mkdirSync(root, { recursive: true });
  const lock = acquire(root);
  try {
    const onSpawn = pid => lock.child(pid);
    const options = { cwd, signal, onSpawn };
    if (action === 'bootstrap') {
      if ((await git(['rev-parse', '--show-toplevel'], options)).replaceAll('\\', '/').toLowerCase() !== cwd.replaceAll('\\', '/').toLowerCase()) throw Error('Run bootstrap at project repository root');
      const remotes = await git(['remote'], options);
      if (remotes.split('\n').includes('origin')) {
        for (const args of [['remote', 'get-url', 'origin'], ['remote', 'get-url', '--push', 'origin']]) if (!remoteMatches(await git(args, options), config)) throw Error('Existing origin does not match config');
      }
      const repository = await github.createRepository();
      if (!remotes.split('\n').includes('origin')) await git(['remote', 'add', 'origin', repository.clone_url], options);
      return { repository: repository.full_name, private: repository.private, url: repository.html_url };
    }
    if (action === 'issue-create' || action === 'comment') {
      await github.verify();
      if (!rawIssue || !extra[0]) throw Error(`${action} requires a title/number and BODY_FILE`);
      const result = await github.request(`${github.root}/issues${action === 'comment' ? `/${issue}/comments` : ''}`, { method: 'POST', body: { ...(action === 'issue-create' ? { title: rawIssue } : {}), body: readFileSync(resolve(cwd, extra[0]), 'utf8') } });
      return { ...(action === 'issue-create' ? { issue: result.number } : {}), url: result.html_url };
    }
    const local = readLocalTask(root, config, issue), state = local.state;
    // Read-only branch discovery catches cache loss even before a PR/checkpoint existed.
    const refs = await git(['for-each-ref', '--format=%(refname)', 'refs/heads/harness/', 'refs/remotes/origin/harness/'], options);
    const branches = refs.split('\n').map(x => x.replace(/^refs\/(?:heads|remotes\/origin)\//, '')).filter(x => isTaskBranch(x, issue));
    // The unique legacy alias can be adopted during remote recovery; persist to THAT path.
    const persist = () => save(join(root, `${state.key}.json`), state);
    const repo = new Repo(config, cwd, onSpawn, github.token, signal);
    const agent = prompt => runDsh({ config, state, prompt, root, cwd, onSpawn, persist, signal });
    return await runTask({ config, context, issue, state, github, repo, agent, persist, taskKnown: local.known, branches });
  } finally { lock.release(); }
}
export function diagnosisFailed(result) { return result?.github?.status === 'failed' || (result?.dshHelpExit !== undefined && result.dshHelpExit !== 0); }
