/**
 * Sample HTTP GET scenario — safe public demo against httpbin.org
 *
 * Override the target with BASE_URL in .env, e.g.:
 *   BASE_URL=https://httpbin.org
 *
 * This ships as a working example for open-source installs.
 * Import your own APIs via the UI (cURL Import) or add scripts under tests/scenarios/.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://httpbin.org';

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/get`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fastertest/k6',
    },
    tags: { name: 'sample_get' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is not empty': (r) => r.body && r.body.length > 0,
  });

  sleep(1);
}
