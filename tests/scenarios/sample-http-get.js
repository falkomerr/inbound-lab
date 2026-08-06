/**
 * Sample HTTP GET — built-in FasterTest demo scenario.
 *
 * Hits a public echo API so a fresh install can Start → see live metrics
 * without configuring your own backend first.
 *
 * Default target: https://httpbingo.org (httpbin-compatible; more reliable than httpbin.org)
 * Override with BASE_URL in .env or the UI custom environment, e.g.:
 *   BASE_URL=https://postman-echo.com
 *
 * Replace this file (or add new scripts under tests/scenarios/) for real APIs.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = String(__ENV.BASE_URL || 'https://httpbingo.org').replace(/\/$/, '');

export const options = {
  // FasterTest CLI flags (--vus / --duration) override these when launched from the UI.
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
    checks: ['rate>0.9'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/get`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fastertest/sample-http-get',
    },
    tags: { name: 'sample_get' },
    timeout: '10s',
  });

  let jsonOk = false;
  try {
    const body = res.json();
    jsonOk = body !== null && typeof body === 'object';
  } catch {
    jsonOk = false;
  }

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body is not empty': (r) => Boolean(r.body) && String(r.body).length > 0,
    'response is JSON': () => jsonOk,
  });

  sleep(1);
}
