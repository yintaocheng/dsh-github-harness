import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../src/github.mjs';
import { sanitizedDshEnv } from '../src/dsh.mjs';

const config = { owner: 'owner', repo: 'repo', base: 'main', agent: { id: 'solo', expectedLogin: 'actor' } };
const root = '/repos/owner/repo';
const sha = 'a'.repeat(40);
const statusesPath = `${root}/commits/${sha}/statuses?per_page=1`;
const checksPath = `${root}/commits/${sha}/check-runs?per_page=1`;
const issuesPath = `${root}/issues?state=all&per_page=1`;
const pullsPath = `${root}/pulls?state=all&per_page=1`;
const token = 'test-only-auth-secret';
const bodyMarker = 'DO_NOT_REPORT_RESPONSE_BODY';

function fixture({ privateRepo = true, selectedConfig = config, overrides = {} } = {}) {
  const routes = new Map([
    ['/user', { body: { login: 'actor', ignored: bodyMarker } }],
    [root, { body: { full_name: 'owner/repo', private: privateRepo, permissions: { push: false }, ignored: bodyMarker } }],
    [issuesPath, { body: [{ number: 1, body: bodyMarker }] }],
    [pullsPath, { body: [{ number: 2, body: bodyMarker }] }],
    [`${root}/branches/${encodeURIComponent(selectedConfig.base)}`, { body: { name: selectedConfig.base, commit: { sha } } }],
    [statusesPath, { body: [{ state: 'success', description: bodyMarker }] }],
    [checksPath, { body: { check_runs: [{ name: bodyMarker }] } }],
    ...Object.entries(overrides),
  ]);
  const calls = [];
  let errorBodyReads = 0;
  const api = new GitHub(selectedConfig, {
    token,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url), path = `${parsed.pathname}${parsed.search}`;
      assert.equal(parsed.origin, 'https://api.github.com');
      // Deliberately do not record Authorization or the credential in test output.
      calls.push({ path, method: init.method, body: init.body });
      const route = routes.get(path);
      assert.ok(route, `Unexpected request: ${path}`);
      if (route.error) throw route.error;
      const status = route.status ?? 200;
      return {
        status, ok: status >= 200 && status < 300,
        json: async () => {
          if (status >= 400) { errorBodyReads++; throw Error(bodyMarker); }
          if (route.jsonError) throw route.jsonError;
          return structuredClone(route.body);
        },
      };
    },
  });
  return { api, calls, errorBodyReads: () => errorBodyReads };
}
function assertReadOnly(calls) {
  assert(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.method, 'GET', call.path);
    assert.equal(call.body, undefined, call.path);
  }
}
function assertSafe(value) {
  const text = JSON.stringify(value);
  for (const hidden of [token, bodyMarker, 'Authorization']) assert(!text.includes(hidden), 'diagnostics must not expose credentials or response bodies');
}

test('sanitizedDshEnv removes all actual token key casings without changing input', () => {
  // A plain object is intentional: this exercises mixed keys on Windows AND POSIX,
  // without relying on platform-specific process.env normalization or real secrets.
  const parent = Object.freeze({
    GH_TOKEN: 'fake-upper', gh_token: 'fake-lower', Gh_ToKeN: 'fake-mixed',
    GITHUB_TOKEN: 'fake-upper', github_token: 'fake-lower', GitHub_Token: 'fake-mixed',
    PATH: 'keep-uppercase-path', Path: 'keep-mixed-path', HOME: 'keep-home',
    GH_TOKENS: 'keep-plural', GITHUB_TOKEN_EXTRA: 'keep-suffix', MY_GH_TOKEN: 'keep-prefix',
  });
  const before = { ...parent };
  const actual = sanitizedDshEnv(parent);
  assert.notEqual(actual, parent);
  assert.deepEqual(parent, before);
  assert.deepEqual(actual, {
    PATH: 'keep-uppercase-path', Path: 'keep-mixed-path', HOME: 'keep-home',
    GH_TOKENS: 'keep-plural', GITHUB_TOKEN_EXTRA: 'keep-suffix', MY_GH_TOKEN: 'keep-prefix',
  });
});
test('sanitizedDshEnv preserves unrelated environments and null-prototype input', () => {
  const parent = Object.freeze({ PATH: 'path', NORMAL: 'value' });
  assert.deepEqual(sanitizedDshEnv(parent), parent);
  assert.notEqual(sanitizedDshEnv(parent), parent);
  assert.deepEqual(sanitizedDshEnv({}), {});
  const plain = Object.freeze(Object.assign(Object.create(null), { gItHuB_tOkEn: 'fake', NORMAL: 'value' }));
  assert.deepEqual(sanitizedDshEnv(plain), { NORMAL: 'value' });
  assert.equal(plain.gItHuB_tOkEn, 'fake');
});

test('diagnose observes private read access using only GET, regardless of push permission', async () => {
  const f = fixture();
  const report = await f.api.diagnose();
  assert.equal(report.status, 'ok');
  assert.equal(report.login, 'actor');
  assert.equal(report.repository.full_name, 'owner/repo');
  assert.equal(report.repository.private, true);
  assert.equal(report.repository.status, 'available');
  assert.equal(report.base.sha, sha);
  assert.equal(report.base.status, 'available');
  for (const item of Object.values(report.reads)) assert.equal(item.status, 'available');
  assert.equal(report.reads.commitStatuses.permission, 'Commit statuses: read');
  assert.equal(report.writes.status, 'unverified');
  assert.equal(report.tokenPermissions.status, 'unverified');
  assert.deepEqual(f.calls.map(x => x.path), ['/user', root, issuesPath, pullsPath, `${root}/branches/main`, statusesPath, checksPath]);
  assertReadOnly(f.calls);
  assertSafe(report);
});
test('private statuses 403 is an explicit failure, never successful capability or empty repository', async () => {
  const f = fixture({ overrides: { [statusesPath]: { status: 403 } } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'failed');
  assert.equal(report.reads.commitStatuses.status, 'failed');
  assert.equal(report.reads.commitStatuses.httpStatus, 403);
  assert.match(report.reads.commitStatuses.reason, /required read access is unavailable/);
  assert.equal(report.base.status, 'available');
  assert.equal(report.reads.checks.status, 'available');
  assert.equal(f.errorBodyReads(), 0);
  assertReadOnly(f.calls);
  assertSafe(report);
});
test('public GET success and repository push permission never prove token scopes or writes', async () => {
  const f = fixture({ privateRepo: false, overrides: {
    [root]: { body: { full_name: 'owner/repo', private: false, permissions: { push: true } } },
  } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'ok');
  assert.equal(report.repository.private, false);
  assert.equal(report.reads.commitStatuses.status, 'available');
  assert.equal(report.tokenPermissions.status, 'unverified');
  assert.match(report.tokenPermissions.reason, /Public resources may be readable without authentication/);
  assert.equal(report.writes.status, 'unverified');
  assert.match(report.writes.reason, /push permission does not prove token-specific write permissions/);
  assertReadOnly(f.calls);
  assertSafe(report);
});
test('Issues, Pull requests, and Checks each report actual denied read capability', async t => {
  for (const [key, path] of [['issues', issuesPath], ['pulls', pullsPath], ['checks', checksPath]]) {
    await t.test(key, async () => {
      const f = fixture({ overrides: { [path]: { status: 403 } } });
      const report = await f.api.diagnose();
      assert.equal(report.status, 'failed');
      assert.equal(report.reads[key].status, 'failed');
      assert.equal(report.reads[key].httpStatus, 403);
      assert.equal(f.errorBodyReads(), 0);
      assertReadOnly(f.calls);
      assertSafe(report);
    });
  }
});
test('identity mismatch stops diagnosis after /user, before repository access', async () => {
  const f = fixture({ overrides: { '/user': { body: { login: bodyMarker } } } });
  await assert.rejects(f.api.diagnose(), error => {
    assert.match(error.message, /GitHub identity mismatch/);
    assertSafe(error.message);
    return true;
  });
  assert.deepEqual(f.calls.map(x => x.path), ['/user']);
  assertReadOnly(f.calls);
});
test('repository mismatch stops diagnosis before any capability probe', async () => {
  const f = fixture({ overrides: { [root]: { body: { full_name: 'other-owner/repo', private: true } } } });
  await assert.rejects(f.api.diagnose(), /GitHub repository mismatch/);
  assert.deepEqual(f.calls.map(x => x.path), ['/user', root]);
  assertReadOnly(f.calls);
});
test('malformed identity responses stop before resource probes instead of implying pre-bootstrap', async t => {
  for (const [path, body] of [['/user', null], [root, null], [root, {}]]) {
    await t.test(`${path} ${JSON.stringify(body)}`, async () => {
      const f = fixture({ overrides: { [path]: { body } } });
      await assert.rejects(f.api.diagnose(), /Unexpected GitHub identity response|GitHub repository mismatch/);
      assert.deepEqual(f.calls.map(x => x.path), path === '/user' ? ['/user'] : ['/user', root]);
      assertReadOnly(f.calls);
    });
  }
});
test('GitHub account and full repository identity follow GitHub case-insensitive names', async () => {
  const f = fixture({ overrides: {
    '/user': { body: { login: 'AcToR' } }, [root]: { body: { full_name: 'OwNeR/RePo', private: true } },
  } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'ok');
  assert.equal(report.login, 'AcToR');
  assert.equal(report.repository.full_name, 'OwNeR/RePo');
  assertReadOnly(f.calls);
});
test('repository 404 supports pre-bootstrap doctor with all capabilities unverified', async () => {
  const f = fixture({ overrides: { [root]: { status: 404 } } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'unverified');
  assert.equal(report.repository.status, 'unverified');
  assert.equal(report.repository.full_name, null);
  assert.match(report.repository.reason, /not created or is not visible/);
  assert.equal(report.base.status, 'unverified');
  for (const item of Object.values(report.reads)) assert.equal(item.status, 'unverified');
  assert.deepEqual(f.calls.map(x => x.path), ['/user', root]);
  assert.equal(f.errorBodyReads(), 0);
  assertReadOnly(f.calls);
  assertSafe(report);
});
test('repository 403 is failed access, not a pre-bootstrap or empty repository', async () => {
  const f = fixture({ overrides: { [root]: { status: 403 } } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'failed');
  assert.equal(report.repository.status, 'failed');
  assert.equal(report.repository.httpStatus, 403);
  assert.doesNotMatch(report.repository.reason, /empty|not created/);
  assert.deepEqual(f.calls.map(x => x.path), ['/user', root]);
  assert.equal(f.errorBodyReads(), 0);
  assertReadOnly(f.calls);
});
test('empty repository leaves SHA-based reads unverified only after successful empty branch list', async t => {
  for (const status of [404, 409]) {
    await t.test(`base HTTP ${status}`, async () => {
      const f = fixture({ overrides: {
        [`${root}/branches/main`]: { status }, [`${root}/branches?per_page=1`]: { body: [] },
      } });
      const report = await f.api.diagnose();
      assert.equal(report.status, 'unverified');
      assert.equal(report.base.status, 'unverified');
      assert.equal(report.base.sha, null);
      assert.match(report.base.reason, /No branches\/baseline commit/);
      assert.equal(report.reads.issues.status, 'available');
      assert.equal(report.reads.pulls.status, 'available');
      assert.equal(report.reads.commitStatuses.status, 'unverified');
      assert.equal(report.reads.checks.status, 'unverified');
      assert(!f.calls.some(x => x.path.includes('/commits/')));
      assert.equal(f.errorBodyReads(), 0);
      assertReadOnly(f.calls);
    });
  }
});
test('base 403 must not fall back to an empty-repository explanation', async () => {
  const f = fixture({ overrides: { [`${root}/branches/main`]: { status: 403 } } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'failed');
  assert.equal(report.base.status, 'failed');
  assert.equal(report.base.httpStatus, 403);
  assert.doesNotMatch(report.base.reason, /empty/);
  for (const key of ['commitStatuses', 'checks']) {
    assert.equal(report.reads[key].status, 'unverified');
    assert.match(report.reads[key].reason, /HTTP 403/);
  }
  assert(!f.calls.some(x => x.path.includes('/commits/') || x.path.includes('/branches?')));
  assert.equal(f.errorBodyReads(), 0);
  assertReadOnly(f.calls);
});
test('denied branch-list fallback cannot be reported as an empty repository', async () => {
  const f = fixture({ overrides: {
    [`${root}/branches/main`]: { status: 404 }, [`${root}/branches?per_page=1`]: { status: 403 },
  } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'failed');
  assert.equal(report.base.status, 'failed');
  assert.equal(report.base.httpStatus, 403);
  assert.doesNotMatch(report.base.reason, /empty/);
  assert.equal(f.errorBodyReads(), 0);
  assertReadOnly(f.calls);
});
test('branch-list transport failure does not retain a misleading earlier HTTP status', async () => {
  const f = fixture({ overrides: {
    [`${root}/branches/main`]: { status: 404 },
    [`${root}/branches?per_page=1`]: { error: Error(`${bodyMarker} Authorization ${token}`) },
  } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'failed');
  assert.equal(report.base.status, 'failed');
  assert.equal(report.base.httpStatus, undefined);
  assert.doesNotMatch(report.base.reason, /empty/);
  assertReadOnly(f.calls);
  assertSafe(report);
});
test('missing configured base is distinguished from an empty repository', async () => {
  const f = fixture({ overrides: {
    [`${root}/branches/main`]: { status: 404 }, [`${root}/branches?per_page=1`]: { body: [{ name: 'other' }] },
  } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'unverified');
  assert.equal(report.base.status, 'unverified');
  assert.match(report.base.reason, /Configured base branch is missing/);
  assert.doesNotMatch(report.base.reason, /empty/);
  assert(!f.calls.some(x => x.path.includes('/commits/')));
  assertReadOnly(f.calls);
});
test('configured branch names are encoded and only their resolved SHA is probed', async () => {
  const f = fixture({ selectedConfig: { ...config, base: 'release/v1' } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'ok');
  assert.equal(report.base.path, `${root}/branches/release%2Fv1`);
  assert.equal(report.base.sha, sha);
  assert.equal(report.reads.commitStatuses.path, statusesPath);
  assert.equal(report.reads.checks.path, checksPath);
  assertReadOnly(f.calls);
});
test('unexpected base identity or malformed SHA fails without probing commit endpoints', async t => {
  for (const [name, body] of [
    ['redirected branch', { name: 'renamed', commit: { sha } }],
    ['missing SHA', { name: 'main', commit: {} }],
  ]) {
    await t.test(name, async () => {
      const f = fixture({ overrides: { [`${root}/branches/main`]: { body } } });
      const report = await f.api.diagnose();
      assert.equal(report.status, 'failed');
      assert.equal(report.base.status, 'failed');
      assert(!f.calls.some(x => x.path.includes('/commits/')));
      assertReadOnly(f.calls);
    });
  }
});
test('malformed successful status/check responses do not claim read capability', async () => {
  const f = fixture({ overrides: { [statusesPath]: { body: {} }, [checksPath]: { body: {} } } });
  const report = await f.api.diagnose();
  assert.equal(report.status, 'failed');
  assert.equal(report.reads.commitStatuses.status, 'failed');
  assert.equal(report.reads.checks.status, 'failed');
  assertReadOnly(f.calls);
});
test('transport and JSON parsing errors never echo body, headers, or tokens', async t => {
  for (const path of ['/user', root, statusesPath]) {
    for (const kind of ['error', 'jsonError']) {
      await t.test(`${path} ${kind}`, async () => {
        const f = fixture({ overrides: { [path]: { [kind]: Error(`${bodyMarker} Authorization ${token}`) } } });
        if (path === '/user') {
          await assert.rejects(f.api.diagnose(), error => { assertSafe(error.message); return true; });
          assert.equal(f.calls.length, 1);
        } else {
          const report = await f.api.diagnose();
          assert.equal(report.status, 'failed');
          assertSafe(report);
        }
        assertReadOnly(f.calls);
      });
    }
  }
});
