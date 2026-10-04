import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from './state.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const projectKey = c => `github:${c.owner.toLowerCase()}/${c.repo.toLowerCase()}`;
// Business identity never contains an executor, operator, branch, workdir or verification policy.
export const taskKey = (c, issue) => `task-${digest([projectKey(c), issue])}`;
export const branchName = (_c, issue) => `harness/issue-${issue}`;
export const markerFor = key => `<!-- dsh-github-harness:${key} -->`;
export const taskIdentity = (c, issue) => ({ key: taskKey(c, issue), repository: projectKey(c), issue });

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
export const snapshotConfig = config => freeze(structuredClone(config));

// Invocation-local data boundary. Future executor roles/governance belong in data here,
// NOT in GitHub permission assignment, scheduling, voting or automatic merge behavior.
// The current run selects exactly one executor; the checkout lock still serializes all tasks.
export function createRunContext(config, { cwd = process.cwd(), issue, action = 'run' } = {}) {
  const snapshot = snapshotConfig(config);
  return freeze({
    id: randomUUID(), action, config: snapshot,
    project: { key: projectKey(snapshot), owner: snapshot.owner, repo: snapshot.repo, workdir: resolve(cwd), base: snapshot.base },
    task: issue === undefined ? null : taskIdentity(snapshot, issue),
    executor: { id: snapshot.agent.id }, operator: { expectedLogin: snapshot.agent.expectedLogin },
    verification: { commands: snapshot.verify, hash: digest(snapshot.verify) },
  });
}

// Old keys remain artifact aliases, so DSH receipts, markers and branches need no rename.
// They must never again be used as business task identity.
export function artifactIdentity(config, issue, key) {
  if (key === taskKey(config, issue)) return { key, branch: branchName(config, issue) };
  if (typeof key !== 'string') return null;
  const prefix = `${config.owner}_${config.repo}_${issue}_`;
  if (!key.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const executor = key.slice(prefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(executor) || executor.includes('..')) return null;
  return { key, branch: `harness/${executor}/issue-${issue}` };
}
export function isTaskBranch(branch, issue) {
  return branch === `harness/issue-${issue}` || (typeof branch === 'string' && new RegExp(`^harness/[A-Za-z0-9][A-Za-z0-9_.-]*/issue-${issue}$`).test(branch));
}
export function validateTaskIdentity(config, issue, task) {
  const expected = taskIdentity(config, issue);
  if (task && (task.key !== expected.key || task.repository !== expected.repository || task.issue !== issue)) throw Error('Task repository/Issue identity mismatch');
  if (task?.repositoryId !== undefined && (!Number.isSafeInteger(task.repositoryId) || task.repositoryId < 1)) throw Error('Invalid task repository ID');
  return { ...expected, ...(task?.repositoryId !== undefined ? { repositoryId: task.repositoryId } : {}) };
}
export function validateArtifact(config, issue, value) {
  const expected = artifactIdentity(config, issue, value?.key);
  if (!expected || (value.branch !== undefined && value.branch !== expected.branch)) throw Error('Local or durable task identity mismatch');
  validateTaskIdentity(config, issue, value.task);
  return expected;
}
export function selectArtifact(config, issue, candidates) {
  const groups = new Map();
  for (const candidate of candidates.filter(Boolean)) {
    const identity = validateArtifact(config, issue, candidate);
    const previous = groups.get(identity.key);
    if (previous?.sessionId && candidate.sessionId && previous.sessionId !== candidate.sessionId) throw Error('Conflicting task sessions; resolve manually');
    const repositoryId = candidate.task?.repositoryId ?? previous?.task?.repositoryId;
    if (previous?.task?.repositoryId !== undefined && candidate.task?.repositoryId !== undefined && previous.task.repositoryId !== candidate.task.repositoryId) throw Error('Conflicting task repository IDs; resolve manually');
    groups.set(identity.key, { ...identity, sessionId: candidate.sessionId || previous?.sessionId, task: { ...taskIdentity(config, issue), ...(repositoryId !== undefined ? { repositoryId } : {}) } });
  }
  if (groups.size > 1) throw Error('Ambiguous task candidates for this repository/Issue; resolve manually');
  return groups.values().next().value || null;
}
export function metadata(body) {
  const match = body?.match(/<!-- dsh-gh-state (\{[^\n]+\}) -->/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
export function taskReport(body, config, issue) {
  const key = body?.match(/^<!-- dsh-github-harness:([^\s]+) -->/)?.[1];
  const identity = artifactIdentity(config, issue, key);
  if (!identity) return null;
  const data = metadata(body);
  if (!data || data.key !== key || typeof data.sessionId !== 'string' || !data.sessionId) throw Error('Invalid durable task checkpoint/session; resolve manually');
  validateArtifact(config, issue, { ...data, branch: data.branch ?? identity.branch });
  if (typeof data.operator !== 'string' || data.operator.toLowerCase() !== config.agent.expectedLogin.toLowerCase()) throw Error('Task operator changed; reconcile the existing task manually');
  return { ...identity, sessionId: data.sessionId, task: data.task, data, body };
}

export function taskCheckpoints(comments, config, issue) {
  const records = comments.map(comment => ({ comment, report: taskReport(comment.body, config, issue) })).filter(x => x.report);
  for (const { comment } of records) {
    if (comment.user?.login?.toLowerCase() !== config.agent.expectedLogin.toLowerCase()) throw Error('Task checkpoint author mismatch; reconcile the existing task manually');
  }
  if (new Set(records.map(x => x.report.key)).size !== records.length) throw Error('Multiple task checkpoints; resolve manually');
  return records;
}

// Read-only selection for status and run, including receipt-only interrupted sessions.
// A second legacy executor key is NOT silently folded into the first task.
export function readLocalTask(root, config, issue) {
  const candidates = new Map();
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    if (!name.endsWith('.json')) continue;
    const stateKey = name.slice(0, -'.json'.length);
    const receiptKey = name.endsWith('.session.json') ? name.slice(0, -'.session.json'.length) : null;
    if (!artifactIdentity(config, issue, stateKey) && !artifactIdentity(config, issue, receiptKey)) continue;
    const value = load(join(root, name));
    // A valid old executor can itself end in ".session"; content disambiguates the filename.
    const session = receiptKey !== null && value?.taskKey === receiptKey;
    const key = session ? receiptKey : stateKey;
    if (!value || (session ? typeof value.sessionId !== 'string' || !value.sessionId : value.key !== key) || !artifactIdentity(config, issue, key)) throw Error('Local task/receipt identity mismatch');
    const candidate = candidates.get(key) || { ...artifactIdentity(config, issue, key) };
    if (session) candidate.receipt = value;
    else { validateArtifact(config, issue, value); candidate.state = value; }
    candidates.set(key, candidate);
  }
  const records = [...candidates.values()];
  selectArtifact(config, issue, records.flatMap(x => [x.state, x.receipt && { ...x, sessionId: x.receipt.sessionId }]));
  const record = records[0];
  const state = record?.state || { version: 3, ...(record || { key: taskKey(config, issue), branch: branchName(config, issue) }) };
  if (record?.receipt?.sessionId) state.sessionId ||= record.receipt.sessionId;
  delete state.receipt;
  state.task = validateTaskIdentity(config, issue, state.task);
  return { state, known: Boolean(record), session: record?.receipt || null };
}
