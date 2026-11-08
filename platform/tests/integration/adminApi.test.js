/**
 * Admin audit + user management integration tests
 * @module tests/integration/adminApi
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationServer } from '../helpers/integrationServer.js';

describe('Admin API integration', () => {
  /** @type {Awaited<ReturnType<typeof createIntegrationServer>>} */
  let ctx;

  before(async () => {
    ctx = await createIntegrationServer();
  });

  after(async () => {
    await ctx.close();
  });

  async function adminAuth() {
    const admin = await ctx.createUser(`admin-${Date.now()}`, 'AdminPass123!', 'admin');
    const token = ctx.signToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
    });
    return { admin, token };
  }

  it('GET /admin/audit returns login events', async () => {
    const { token } = await adminAuth();
    const username = `audit-login-${Date.now()}`;
    await ctx.createUser(username, 'ValidPass123!', 'developer');

    await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'ValidPass123!' }),
    });

    const res = await fetch(`${ctx.baseUrl}/admin/audit?limit=50&type=login`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.some((e) => e.type === 'login' && e.username === username));
  });

  it('PATCH /admin/users/:id/suspension bans and unbans user', async () => {
    const { token } = await adminAuth();
    const target = await ctx.createUser(`ban-target-${Date.now()}`, 'ValidPass123!', 'developer');

    const banRes = await fetch(`${ctx.baseUrl}/admin/users/${target.id}/suspension`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ banned: true }),
    });
    assert.equal(banRes.status, 200);

    const loginRes = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: target.username, password: 'ValidPass123!' }),
    });
    assert.equal(loginRes.status, 403);

    await fetch(`${ctx.baseUrl}/admin/users/${target.id}/suspension`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ banned: false }),
    });

    const loginAgain = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: target.username, password: 'ValidPass123!' }),
    });
    assert.equal(loginAgain.status, 200);
  });

  it('DELETE /admin/audit requires confirm=yes', async () => {
    const { token } = await adminAuth();

    const deny = await fetch(`${ctx.baseUrl}/admin/audit`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deny.status, 400);

    const ok = await fetch(`${ctx.baseUrl}/admin/audit?confirm=yes`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);
  });
});
