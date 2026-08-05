/**
 * Auth middleware unit tests
 * @module tests/unit/auth
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_SECRET = 'unit-test-jwt-secret-at-least-32-characters-long';

describe('Auth middleware', () => {
  let signToken;
  let verifyToken;
  let requireAuth;
  let requireAdmin;
  /** @type {string | undefined} */
  let dataDir;

  before(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    dataDir = mkdtempSync(join(tmpdir(), 'b2b-auth-unit-'));
    process.env.B2B_TEST_DATA_DIR = dataDir;
    ({ signToken, verifyToken, requireAuth, requireAdmin } = await import(
      `../../server/middleware/auth.js?auth=${Date.now()}`
    ));
  });

  after(() => {
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
    delete process.env.B2B_TEST_DATA_DIR;
  });

  describe('signToken / verifyToken', () => {
    it('round-trips a JWT payload including tokenVersion', () => {
      const payload = {
        id: 'test-user-1',
        username: 'tester',
        role: 'developer',
        tokenVersion: 3,
      };
      const token = signToken(payload);
      assert.equal(typeof token, 'string');
      const decoded = verifyToken(token);
      assert.equal(decoded.id, payload.id);
      assert.equal(decoded.username, payload.username);
      assert.equal(decoded.role, payload.role);
      assert.equal(decoded.tokenVersion, 3);
    });

    it('returns null for invalid tokens', () => {
      assert.equal(verifyToken('not-a-jwt'), null);
      assert.equal(verifyToken(''), null);
    });
  });

  describe('requireAuth', () => {
    it('returns 401 when Authorization header is missing', () => {
      const req = { headers: {} };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAuth(req, res, next);

      assert.equal(res.status.mock.calls.length, 1);
      assert.equal(res.status.mock.calls[0].arguments[0], 401);
      assert.equal(next.mock.calls.length, 0);
    });

    it('returns 401 for an invalid bearer token', () => {
      const req = { headers: { authorization: 'Bearer invalid.token.here' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAuth(req, res, next);

      assert.equal(res.status.mock.calls[0].arguments[0], 401);
      assert.equal(next.mock.calls.length, 0);
    });

    it('accepts x-api-token header and attaches fresh user from store', async () => {
      const userStore = await import(`../../server/userStore.js?authStore=${Date.now()}`);
      const created = await userStore.createUser('auth-user', 'AuthPass123!', 'developer');
      const token = signToken({
        id: created.id,
        username: created.username,
        role: created.role,
        tokenVersion: created.tokenVersion,
      });

      const req = { headers: { 'x-api-token': token } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAuth(req, res, next);

      assert.equal(next.mock.calls.length, 1);
      assert.equal(req.user.username, 'auth-user');
      assert.equal(req.user.role, 'developer');
      assert.equal('password' in req.user, false);
    });

    it('returns 401 when tokenVersion is stale after user update', async () => {
      const userStore = await import(`../../server/userStore.js?stale=${Date.now()}`);
      const created = await userStore.createUser('stale-user', 'AuthPass123!', 'qa');
      const token = signToken({
        id: created.id,
        username: created.username,
        role: created.role,
        tokenVersion: created.tokenVersion,
      });
      userStore.bumpTokenVersion(created.id);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAuth(req, res, next);

      assert.equal(res.status.mock.calls[0].arguments[0], 401);
      assert.match(res.json.mock.calls[0].arguments[0].error, /session expired/i);
      assert.equal(next.mock.calls.length, 0);
    });

    it('returns 401 for suspended non-admin accounts', async () => {
      const userStore = await import(`../../server/userStore.js?banned=${Date.now()}`);
      const created = await userStore.createUser('banned-user', 'AuthPass123!', 'developer');
      userStore.setUserBanned(created.id, true);
      const fresh = userStore.findById(created.id);
      const token = signToken({
        id: fresh.id,
        username: fresh.username,
        role: fresh.role,
        tokenVersion: fresh.tokenVersion,
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAuth(req, res, next);

      assert.equal(res.status.mock.calls[0].arguments[0], 401);
      assert.match(res.json.mock.calls[0].arguments[0].error, /suspended/i);
    });
  });

  describe('requireAdmin', () => {
    it('returns 403 when user is not admin', () => {
      const req = { user: { role: 'developer' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAdmin(req, res, next);

      assert.equal(res.status.mock.calls[0].arguments[0], 403);
      assert.equal(next.mock.calls.length, 0);
    });

    it('calls next for admin role', () => {
      const req = { user: { role: 'admin' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      requireAdmin(req, res, next);

      assert.equal(next.mock.calls.length, 1);
    });
  });
});
