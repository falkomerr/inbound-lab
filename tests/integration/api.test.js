/**
 * API integration tests (in-process HTTP server, isolated data directory)
 * @module tests/integration/api
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_SECRET = 'integration-test-jwt-secret-min-32-chars';

describe('API integration', () => {
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let baseUrl;
  /** @type {string} */
  let dataDir;
  /** @type {(username: string, password: string, role?: string) => Promise<object>} */
  let createUser;
  /** @type {(payload: object) => string} */
  let signToken;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'b2b-api-int-'));
    process.env.B2B_TEST_DATA_DIR = dataDir;
    process.env.JWT_SECRET = TEST_SECRET;

    const stamp = Date.now();
    const { apiRouter } = await import(`../../server/routes/api.js?int=${stamp}`);
    const { TestManager } = await import(`../../server/testManager.js?int=${stamp}`);
    const { createUser: seedUser } = await import(`../../server/userStore.js?int=${stamp}`);
    const { signToken: mintToken } = await import(`../../server/middleware/auth.js?int=${stamp}`);
    createUser = seedUser;
    signToken = mintToken;

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      req.log = {
        info() {},
        warn() {},
        error() {},
      };
      next();
    });
    const testManager = new TestManager();
    const wss = { clients: new Set() };
    app.use('/api', apiRouter(testManager, wss));

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
    delete process.env.B2B_TEST_DATA_DIR;
  });

  it('GET /health returns ok without authentication', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(typeof body.data.uptime, 'number');
    assert.ok(body.data.timestamp);
  });

  it('GET /tests requires JWT', async () => {
    const res = await fetch(`${baseUrl}/tests`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /authentication/i);
  });

  it('POST /auth/login rejects missing credentials', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  it('POST /auth/login rejects invalid credentials', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'WrongPass1!' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  it('POST /auth/login succeeds and returns JWT', async () => {
    await createUser('login-user', 'ValidPass123!', 'developer');
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'login-user', password: 'ValidPass123!' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(typeof body.data.token, 'string');
    assert.equal(body.data.user.username, 'login-user');
    assert.equal('password' in body.data.user, false);
  });

  it('GET /auth/me returns current user for valid bearer token', async () => {
    const user = await createUser('me-user', 'ValidPass123!', 'qa');
    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.username, 'me-user');
    assert.equal(body.data.role, 'qa');
    assert.equal('password' in body.data, false);
  });

  it('GET /admin/users returns 403 for non-admin JWT', async () => {
    const user = await createUser('dev-user', 'ValidPass123!', 'developer');
    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /admin/i);
  });

  it('GET /admin/users lists users for admin JWT', async () => {
    const admin = await createUser('admin-user', 'AdminPass123!', 'admin');
    await createUser('other-dev', 'ValidPass123!', 'developer');
    const token = signToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
    });

    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 2);
    assert.ok(body.data.every((u) => !('password' in u)));
  });

  it('POST /auth/login rejects non-admin when global login ban is enabled', async () => {
    const { setGlobalLoginBan } = await import(
      `../../server/accessControlStore.js?ban=${Date.now()}`
    );
    await setGlobalLoginBan(true);
    await createUser('banned-login', 'ValidPass123!', 'developer');
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'banned-login', password: 'ValidPass123!' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /suspended/i);
    await setGlobalLoginBan(false);
  });

  it('GET /tests lists scenarios for authenticated developer', async () => {
    const user = await createUser('dev-tests', 'ValidPass123!', 'developer');
    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    const res = await fetch(`${baseUrl}/tests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  it('POST /tests/prepare sets preparing state', async () => {
    const user = await createUser('prep-user', 'ValidPass123!', 'developer');
    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    const res = await fetch(`${baseUrl}/tests/prepare`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const statusRes = await fetch(`${baseUrl}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = await statusRes.json();
    assert.equal(status.data.preparingUser?.username, 'prep-user');
  });
});
