import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomicReplace } from '../src/state.mjs';

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows atomic checkpoint retries transient ${code} without changing paths`, () => {
    let calls = 0; const waits = [], paths = [];
    atomicReplace('our-snapshot.tmp', 'existing-state.json', { platform: 'win32', pause: ms => waits.push(ms), rename(a, b) { paths.push([a, b]); if (++calls < 3) throw Object.assign(Error('transient'), { code }); } });
    assert.equal(calls, 3); assert.deepEqual(waits, [10, 20]);
    assert(paths.every(([a, b]) => a === 'our-snapshot.tmp' && b === 'existing-state.json'));
  });
}
test('persistent Windows replacement denial stops after bounded retries', () => {
  let calls = 0; const waits = [];
  assert.throws(() => atomicReplace('source', 'target', { platform: 'win32', pause: ms => waits.push(ms), rename() { calls++; throw Object.assign(Error('still denied'), { code: 'EPERM' }); } }), /still denied/);
  assert.equal(calls, 6); assert.equal(waits.reduce((a, b) => a + b, 0), 310);
});
test('other failures and non-Windows denials are not retried', () => {
  for (const [platform, code] of [['linux', 'EPERM'], ['win32', 'ENOSPC']]) {
    let calls = 0;
    assert.throws(() => atomicReplace('source', 'target', { platform, pause() { assert.fail('must not pause'); }, rename() { calls++; throw Object.assign(Error('stop'), { code }); } }), /stop/);
    assert.equal(calls, 1);
  }
});
