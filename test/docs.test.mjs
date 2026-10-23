import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../src/process.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));

for (const document of ['README.md', 'docs/setup.md', 'docs/operations.md']) {
  test(`${document}: relative Markdown links point to repository files`, () => {
    const file = join(root, document);
    const markdown = readFileSync(file, 'utf8');
    // Inline links (with optional titles) and reference-link definitions.
    const links = /\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)|^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
    let checked = 0;
    for (const match of markdown.matchAll(links)) {
      const href = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
      const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      if (!target) continue;
      const resolved = resolve(dirname(file), target);
      const context = `${document}: ${href}`;
      for (const path of [resolved, realpathSync(resolved)]) {
        const local = relative(root, path);
        assert(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`), `${context} escapes the repository`);
      }
      assert(statSync(resolved).isFile(), `${context} must point to a file`);
      checked++;
    }
    assert(checked > 0, `${document} must contain relative file links`);
  });
}

test('quick-start entry files exist', () => {
  for (const entry of ['harness.cmd', 'scripts/run.ps1', 'src/cli.mjs']) {
    assert(statSync(join(root, entry)).isFile(), `${entry} must exist as a file`);
  }
});

test('CLI help succeeds without GitHub credentials', async t => {
  const logDir = mkdtempSync(join(root, 'test', '.docs-help-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));
  // Pass only OS essentials: no tokens, credential helpers, or NODE_OPTIONS.
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (/^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key)) env[key] = process.env[key];
  }
  // Direct CLI invocation bypasses the credential bridge. File descriptors
  // avoid captured named pipes, which the Windows DSH sandbox disallows.
  const result = await command([process.execPath, 'src/cli.mjs', 'help'], {
    cwd: root, env, logDir,
  });
  assert.equal(result.code, 0, 'CLI help must exit successfully without credentials');
  assert.match(result.stdout, /\bUsage\b/);
});
