import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVerifiedProfiles, checkSubscription } from '../../server/vpn/availability.js';

const profiles = [{ id: 'a' }, { id: 'b' }];
const check = {
  subscriptionId: 'sub',
  fingerprint: 'firefox',
  checkedAt: 1000,
  complete: true,
  results: [
    { id: 'a', status: 'ready', ip: '1.1.1.1' },
    { id: 'b', status: 'failed' },
  ],
};
test('availability retains failures and selects only independently checked ready profiles', () => {
  const selected = selectVerifiedProfiles(profiles, check, 'sub', 'firefox', 2000);
  assert.deepEqual(selected.profiles, [profiles[0]]);
  assert.deepEqual(selected.ips, { a: '1.1.1.1' });
  assert.equal(check.results.length, 2);
});
test('availability rejects stale, incomplete, foreign and differently configured checks', () => {
  for (const patch of [
    { checkedAt: -1000000 },
    { complete: false },
    { subscriptionId: 'other' },
    { fingerprint: 'chrome' },
    { results: [check.results[0]] },
    { results: [check.results[0], check.results[0]] },
    { checkedAt: 3000 },
  ]) {
    assert.throws(() =>
      selectVerifiedProfiles(profiles, { ...check, ...patch }, 'sub', 'firefox', 2000)
    );
  }
});
test('availability rejects a complete check with no available connections', () => {
  assert.throws(
    () =>
      selectVerifiedProfiles(
        profiles,
        {
          ...check,
          results: profiles.map((p) => ({ id: p.id, status: 'failed' })),
        },
        'sub',
        'firefox',
        2000
      ),
    /доступных/
  );
});
test('subscription checking checks every record without executing load', async () => {
  const changes = [];
  let inspected = 0;
  const result = await checkSubscription(
    { id: 'run', profiles, load: {} },
    {
      cancelled: async () => false,
      update: async (_, patch) => changes.push(patch),
    },
    {
      probeCapacity: async () => 1,
      inspectConnections: async (run, onResult) => {
        inspected += run.profiles.length;
        for (const p of run.profiles) {
          await onResult({
            id: p.id,
            status: p.id === 'a' ? 'ready' : 'failed',
            ip: p.id === 'a' ? '1.1.1.1' : undefined,
          });
        }
      },
      resume: () => assert.fail('preflight must never start load'),
    },
    { now: () => 2000 }
  );
  assert.equal(inspected, 2);
  assert.equal(result.state, 'completed');
  assert.equal(result.connectionCheck.ready, 1);
  assert.equal(result.connectionCheck.failed, 1);
  assert.equal(result.connectionCheck.checked, 2);
  assert.equal(changes.at(-1).connectionCheck.checked, 2);
});
test('cancelled subscription checking cannot publish a complete availability result', async () => {
  const result = await checkSubscription(
    { id: 'run', profiles, load: {} },
    {
      cancelled: async () => true,
      update: async () => {},
    },
    { probeCapacity: async () => 1, inspectConnections: () => assert.fail() },
    { now: () => 2000 }
  );
  assert.equal(result.state, 'cancelled');
  assert.equal(result.connectionCheck.complete, false);
});
