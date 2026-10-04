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

test('rejects non-strings without coercing them', () => {
  for (const input of [undefined, null, 123, true, 1n, Symbol('ref'), [], {}, new String('a/b#1'), { toString() { throw Error('must not coerce'); } }]) {
    assert.throws(() => parseIssueRef(input), TypeError);
  }
});

test('rejects missing or malformed reference components', () => {
  for (const input of ['', ' \t\n', '#123', '/repo#123', 'owner/#123', 'owner/repo', 'owner/repo#', 'repo#123', 'owner/repo/extra#123', 'owner/repo#1#2', 'https://github.com/owner/repo/issues/123', 'own er/repo#1', 'owner/re po#1', 'owner/./#1', 'owner/.#1', 'owner/..#1']) {
    assert.throws(() => parseIssueRef(input), /Invalid issue reference/, input);
  }
});

test('rejects zero, negative, non-decimal, and unsafe issue numbers', () => {
  for (const number of ['0', '000', '-1', '+1', '1.5', '1e3', '0x10', 'NaN', 'Infinity', '9007199254740992', '9007199254740993', '9'.repeat(400)]) {
    assert.throws(() => parseIssueRef(`owner/repo#${number}`), /Invalid issue reference|positive safe integer/, number);
  }
});

test('rejects command punctuation and embedded control characters throughout references', () => {
  for (const character of [';', '&', '|', '$', '`', '"', "'", '<', '>', '(', ')', '{', '}', '[', ']', '*', '?', '!', '%', '^', '\\', ':', '@', '\n', '\r', '\t', '\0']) {
    for (const input of [`own${character}er/repo#1`, `owner/re${character}po#1`, `owner/repo#1${character}2`]) {
      assert.throws(() => parseIssueRef(input), /Invalid issue reference/, JSON.stringify(input));
    }
  }
  for (const input of ['owner/repo#1; echo unsafe', 'owner/repo#1 && echo unsafe', 'owner/repo#1$(echo unsafe)', 'owner/repo#1\necho unsafe']) {
    assert.throws(() => parseIssueRef(input), /Invalid issue reference/, input);
  }
});
