import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerCounters } from '../../server/vpn/metrics.js';

const sample = (id, status, expected, count) => ({
  metric: { inbound_id: id, status, expected_response: expected },
  value: [0, String(count)],
});

test('sender counters separate successful HTTP, unexpected HTTP and network errors per worker', () => {
  const values = workerCounters([
    sample('a', '200', 'true', 7),
    sample('a', '500', 'false', 2),
    sample('a', '0', 'false', 1),
    sample('b', '204', 'true', 4),
  ]);
  assert.deepEqual(values.a, {
    id: 'a',
    requests: 10,
    successful: 7,
    httpErrors: 2,
    networkErrors: 1,
    errors: 3,
  });
  assert.deepEqual(values.b, {
    id: 'b',
    requests: 4,
    successful: 4,
    httpErrors: 0,
    networkErrors: 0,
    errors: 0,
  });
  assert.equal(
    values.a.requests,
    values.a.successful + values.a.httpErrors + values.a.networkErrors
  );
});

test('custom k6 expected statuses remain distinct from JS checks', () => {
  const values = workerCounters([sample('a', '404', 'true', 2), sample('a', '200', 'false', 3)]);
  assert.equal(values.a.successful, 2);
  assert.equal(values.a.httpErrors, 3);
});

test('invalid or absent samples are not shown as zero measurements', () => {
  assert.deepEqual(workerCounters([]), {});
  assert.deepEqual(workerCounters([sample('a', '200', 'true', NaN)]), {});
});
