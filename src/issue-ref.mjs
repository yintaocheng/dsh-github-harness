/** Parse a manual reference or canonical HTTPS GitHub Issue URL, throwing on invalid input. */
export function parseIssueRef(text) {
  if (typeof text !== 'string') throw new TypeError('Issue reference must be a string');
  const reference = text.trim();
  // Match the literal URL syntax; URL normalization could hide forbidden input.
  const match = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)#([0-9]+)$/.exec(reference)
    || /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)\/issues\/([0-9]+)$/.exec(reference);
  if (!match || match[2] === '.' || match[2] === '..') throw new Error('Invalid issue reference: expected owner/repo#number or https://github.com/owner/repo/issues/number');
  const issue = Number(match[3]);
  if (!Number.isSafeInteger(issue) || issue < 1) throw new Error('Issue number must be a positive safe integer');
  return { owner: match[1], repo: match[2], issue };
}
