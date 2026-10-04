import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIssueRef } from '../src/issue-ref.mjs';

test('parses manual issue references and preserves owner/repo spelling', () => {
  assert.deepEqual(parseIssueRef('owner/repo#123'), { owner: 'owner', repo: 'repo', issue: 123 });
  assert.deepEqual(parseIssueRef(' \tOwner-Name/Repo_Name.v2#42\r\n'), { owner: 'Owner-Name', repo: 'Repo_Name.v2', issue: 42 });
  assert.deepEqual(parseIssueRef('a/b#1'), { owner: 'a', repo: 'b', issue: 1 });
  assert.deepEqual(parseIssueRef('a/b#000123'), { owner: 'a', repo: 'b', issue: 123 });
  assert.deepEqual(parseIssueRef('a/b#9007199254740991'), { owner: 'a', repo: 'b', issue: Number.MAX_SAFE_INTEGER });
});

test('parses canonical HTTPS GitHub Issue URLs with the same value rules', () => {
  assert.deepEqual(parseIssueRef('https://github.com/DeepSeek-AI/deepseek-harness/issues/123'), { owner: 'DeepSeek-AI', repo: 'deepseek-harness', issue: 123 });
  for (const number of ['1', '000123', '9007199254740991']) {
    assert.deepEqual(parseIssueRef(` \thttps://github.com/Owner-Name/Repo_Name.v2/issues/${number}\r\n`), parseIssueRef(`Owner-Name/Repo_Name.v2#${number}`));
  }
});

test('rejects non-canonical or unsafe Issue URLs', () => {
  for (const input of [
    'http://github.com/owner/repo/issues/123',
    'https://example.com/owner/repo/issues/123',
    'https://github.com.example.com/owner/repo/issues/123',
    'https://www.github.com/owner/repo/issues/123',
    'https://user@github.com/owner/repo/issues/123',
    'https://user:password@github.com/owner/repo/issues/123',
    'https://github.com@evil.example/owner/repo/issues/123',
    'https://github.com:443/owner/repo/issues/123',
    'https://github.com/owner/repo/issues/123?view=1',
    'https://github.com/owner/repo/issues/123?',
    'https://github.com/owner/repo/issues/123#comment',
    'https://github.com/owner/repo/issues/123#',
    'https://github.com/owner/repo/pull/123',
    'https://github.com/owner/repo/issues/123/extra',
    'https://github.com/owner/repo/issues/123/',
    'https://github.com/owner/repo/extra/../issues/123',
    'https://github.com//repo/issues/123',
    'https://github.com/owner//issues/123',
    'https://github.com/owner/./issues/123',
    'https://github.com/owner/../issues/123',
    'https://github.com/owner/repo/issues/',
    'https://github.com/owner/repo/issues/%31',
    'https://github.com/own%65r/repo/issues/123',
    'https://github.com/owner/repo#123',
    'owner/repo/issues/123',
  ]) {
    assert.throws(() => parseIssueRef(input), /Invalid issue reference/, input);
  }
});

test('rejects non-strings without coercing them', () => {
  for (const input of [undefined, null, 123, true, 1n, Symbol('ref'), [], {}, new String('a/b#1'), { toString() { throw Error('must not coerce'); } }]) {
    assert.throws(() => parseIssueRef(input), TypeError);
  }
});

test('rejects missing or malformed reference components', () => {
  for (const input of ['', ' \t\n', '#123', '/repo#123', 'owner/#123', 'owner/repo', 'owner/repo#', 'repo#123', 'owner/repo/extra#123', 'owner/repo#1#2', 'own er/repo#1', 'owner/re po#1', 'owner/./#1', 'owner/.#1', 'owner/..#1']) {
    assert.throws(() => parseIssueRef(input), /Invalid issue reference/, input);
  }
});

test('rejects zero, negative, non-decimal, and unsafe issue numbers', () => {
  for (const number of ['0', '000', '-1', '+1', '1.5', '1e3', '0x10', 'NaN', 'Infinity', '9007199254740992', '9007199254740993', '9'.repeat(400)]) {
    for (const input of [`owner/repo#${number}`, `https://github.com/owner/repo/issues/${number}`]) {
      assert.throws(() => parseIssueRef(input), /Invalid issue reference|positive safe integer/, input);
    }
  }
});

test('rejects command punctuation and embedded control characters throughout references', () => {
  for (const character of [';', '&', '|', '$', '`', '"', "'", '<', '>', '(', ')', '{', '}', '[', ']', '*', '?', '!', '%', '^', '\\', ':', '@', '\n', '\r', '\t', '\0']) {
    for (const input of [`own${character}er/repo#1`, `owner/re${character}po#1`, `owner/repo#1${character}2`, `https://github.com/own${character}er/repo/issues/1`, `https://github.com/owner/re${character}po/issues/1`, `https://github.com/owner/repo/issues/1${character}2`]) {
      assert.throws(() => parseIssueRef(input), /Invalid issue reference/, JSON.stringify(input));
    }
  }
  for (const input of ['owner/repo#1; echo unsafe', 'owner/repo#1 && echo unsafe', 'owner/repo#1$(echo unsafe)', 'owner/repo#1\necho unsafe']) {
    assert.throws(() => parseIssueRef(input), /Invalid issue reference/, input);
  }
});
