import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createVpnRouter } from '../../server/vpn/routes.js';

test('subscription preflight is queued separately and verified admission excludes failures', async () => {
  const profiles = ['a', 'b'].map((id) => ({ id, host: 'vpn.example', port: 443 }));
  let availability = [];
  const jobs = [];
  const store = {
    get: async (_, kind) =>
      kind === 'subscription'
        ? { metadata: { id: 'sub', profiles, count: 2 }, payload: { records: profiles } }
        : {
            metadata: { id: 'scenario', name: 'test' },
            payload: { kind: 'curl', request: { url: 'https://example.org' } },
          },
    list: async () => availability,
    enqueue: async (job) => {
      jobs.push(job);
      return { id: 'job', ...job.metadata };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/vpn',
    createVpnRouter({ store, auth: (_, __, next) => next(), admin: (_, __, next) => next() })
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/vpn${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const preflight = await post('/subscriptions/sub/check', { fingerprint: 'firefox' });
    assert.equal(preflight.status, 202);
    assert.equal(jobs[0].metadata.purpose, 'subscription-check');
    assert.equal(jobs[0].profiles.length, 2);
    const body = {
      subscriptionId: 'sub',
      scenarioId: 'scenario',
      requireVerified: true,
      load: { mode: 'rps', budget: 1, duration: 5, realityFingerprint: 'firefox' },
    };
    assert.equal((await post('/runs', body)).status, 400);
    availability = [
      {
        subscriptionId: 'sub',
        fingerprint: 'firefox',
        checkedAt: Date.now(),
        complete: true,
        total: 2,
        checked: 2,
        ready: 1,
        failed: 1,
        results: [
          { id: 'a', status: 'ready', ip: '1.1.1.1' },
          { id: 'b', status: 'failed' },
        ],
      },
    ];
    const accepted = await post('/runs', body);
    assert.equal(accepted.status, 202);
    assert.deepEqual(
      jobs[1].profiles.map((p) => p.id),
      ['a']
    );
    assert.deepEqual(jobs[1].load.prechecked.ips, { a: '1.1.1.1' });
    assert.equal(jobs[1].metadata.connectionCheck.failed, 1);
    assert.equal(jobs[1].metadata.profiles.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('multiple subscriptions are one atomic snapshot with indexed errors and preserved duplicates', async () => {
  const saved = [];
  const link = 'vless://11111111-1111-4111-8111-111111111111@vpn.example:443?security=none';
  const app = express();
  app.use(express.json());
  app.use(
    '/api/vpn',
    createVpnRouter({
      store: {
        get: async (id) => ({
          payload: saved[id === 'duplicate' ? 2 : 0].payload,
          groupId: 'existing-group',
        }),
        save: async (value) => {
          saved.push(value);
          return value.metadata;
        },
      },
      auth: (req, res, next) => next(),
      admin: (req, res, next) => next(),
      fetchSubscription: async (url) => (url.endsWith('/bad') ? 'invalid' : link),
    })
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (urls) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/vpn/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
  try {
    const failed = await post(['https://example.org/one', 'https://example.org/bad']);
    assert.equal(failed.status, 400);
    const message = await failed.text();
    assert.match(message, /Подписка 2/);
    assert.ok(!message.includes('example.org'));
    assert.equal(saved.length, 0);
    const success = await post(['https://example.org/one', 'https://example.org/two']);
    assert.equal(success.status, 201);
    assert.equal(saved[0].metadata.count, 2);
    assert.equal(saved[0].metadata.sources.length, 2);
    assert.equal(saved[0].payload.urls.length, 2);
    assert.equal(new Set(saved[0].payload.records.map((p) => p.id)).size, 2);
    assert.deepEqual(
      saved[0].metadata.profiles.map((p) => p.source),
      [1, 2]
    );
    const refreshed = await fetch(
      `http://127.0.0.1:${server.address().port}/api/vpn/subscriptions/existing/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    );
    assert.equal(refreshed.status, 201);
    assert.equal(saved[1].groupId, 'existing-group');
    assert.equal(saved[1].metadata.count, 2);
    assert.equal(saved[1].metadata.sourceConfigurations, 2);
    const duplicated = await fetch(
      `http://127.0.0.1:${server.address().port}/api/vpn/subscriptions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { url: 'https://example.org/one', copies: 2 },
            { url: 'https://example.org/two', copies: 1 },
          ],
        }),
      }
    );
    assert.equal(duplicated.status, 201);
    assert.equal(saved[2].metadata.count, 3);
    assert.deepEqual(
      saved[2].metadata.profiles.map((p) => p.copy),
      [1, 2, 1]
    );
    assert.equal(new Set(saved[2].payload.records.map((p) => p.id)).size, 3);
    assert.equal(saved[2].payload.sources[0].copies, 2);
    const duplicateRefresh = await fetch(
      `http://127.0.0.1:${server.address().port}/api/vpn/subscriptions/duplicate/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    );
    assert.equal(duplicateRefresh.status, 201);
    assert.equal(saved[3].metadata.count, 3);
    assert.equal(saved[3].metadata.sources[0].copies, 2);
    assert.ok(
      saved[3].payload.records.every(
        (record) => !saved[2].payload.records.some((old) => old.id === record.id)
      )
    );
    const invalidCopies = await fetch(
      `http://127.0.0.1:${server.address().port}/api/vpn/subscriptions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [{ url: 'https://example.org/one', copies: 0 }] }),
      }
    );
    assert.equal(invalidCopies.status, 400);
    assert.equal(saved.length, 4);
    assert.equal((await post([])).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('VPN API authenticates every route and rejects malformed imports without leaking source URLs', async () => {
  const app = express();
  app.use(express.json());
  const objects = [];
  const store = {
    list: async () => objects,
    save: async (object) => {
      objects.push(object);
      return object.metadata;
    },
  };
  const auth = (req, res, next) =>
    req.headers.authorization === 'Bearer test' ? next() : res.sendStatus(401);
  app.use(
    '/api/vpn',
    createVpnRouter({
      store,
      auth,
      admin: (req, res, next) => next(),
      fetchSubscription: async () => 'broken-secret-value',
    })
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/vpn`;
  try {
    assert.equal((await fetch(`${base}/subscriptions`)).status, 401);
    const response = await fetch(`${base}/subscriptions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.org/private-token' }),
    });
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.ok(!text.includes('private-token'));
    assert.ok(!text.includes('broken-secret-value'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('scenario import returns editable request and never executes cURL', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/vpn',
    createVpnRouter({
      store: {},
      auth: (req, res, next) => next(),
      admin: (req, res, next) => next(),
    })
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vpn/parse-curl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curl: "curl 'https://example.org' -H 'X-Test: value'" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.headers['X-Test'], 'value');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
