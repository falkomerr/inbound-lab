import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { makeScenario } from '../../server/vpn/docker.js';
import { validateRequest } from '../../server/vpn/core.js';

test('curl templates are regenerated per request, shared between fields and never become metric tags', () => {
  const request = validateRequest({
    url: 'https://example.org/login/{{random.uuid}}?value={{random.int}}#ignored',
    method: 'POST',
    headers: { 'X-Request-ID': '{{random.uuid}}' },
    body: '{"id":"{{random.uuid}}","time":{{timestamp}}}',
    cacheBust: true,
    expectedStatus: 401,
  });
  const generated = makeScenario({ kind: 'curl', request });
  const requests = [];
  const http = {
    expectedStatuses: (status) => status,
    request: (...args) => {
      requests.push(args);
      return { status: 401 };
    },
  };
  const context = vm.createContext({
    http,
    randomBytes: (size) => Uint8Array.from(randomBytes(size)).buffer,
  });
  vm.runInContext(
    `${generated.replace(/^import .*;$/gm, '').replace('export default function', 'function execute')}\nexecute();execute();`,
    context
  );
  assert.equal(requests.length, 2);
  const [method, url, body, options] = requests[0];
  const id = options.headers['X-Request-ID'];
  assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(method, 'POST');
  assert.ok(url.includes(id));
  assert.ok(!url.includes('#'));
  assert.match(url, /__inbound_nonce=/);
  assert.equal(JSON.parse(body).id, id);
  assert.equal(typeof JSON.parse(body).time, 'number');
  assert.notEqual(requests[0][1], requests[1][1]);
  assert.equal(options.responseCallback, 401);
  assert.equal(options.headers['Cache-Control'], 'no-cache, no-store');
  assert.equal(options.tags.name, 'request');
  assert.ok(!JSON.stringify(options.tags).includes(id));
  assert.ok(request.body.includes('{{random.uuid}}'));
});

test('unknown variables, invalid expected status and invalid cache controls are rejected', () => {
  const request = { url: 'https://example.org', method: 'GET', headers: {}, body: null };
  assert.throws(() => validateRequest({ ...request, body: '{{unknown}}' }), /переменн/);
  assert.throws(() => validateRequest({ ...request, expectedStatus: 999 }));
  assert.throws(() => validateRequest({ ...request, cacheBust: 'yes' }));
});
