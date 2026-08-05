/**
 * Auth lockout + invite/reset HTTP integration tests
 * @module tests/integration/authFlows
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationServer } from '../helpers/integrationServer.js';

describe('Auth flows integration', () => {
  /** @type {Awaited<ReturnType<typeof createIntegrationServer>>} */
  let ctx;

  before(async () => {
    ctx = await createIntegrationServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('POST /auth/login locks account after repeated failures', async () => {
    const username = `lockout-${Date.now()}`;
    await ctx.createUser(username, 'ValidPass123!', 'developer');

    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential lockout attempts
      const res = await fetch(`${ctx.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'WrongPass1!' }),
      });
      assert.equal(res.status, 401);
    }

    const locked = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'ValidPass123!' }),
    });
    assert.equal(locked.status, 429);
    const body = await locked.json();
    assert.match(body.error, /too many failed attempts/i);
  });

  it('invite accept flow creates user and allows login', async () => {
    const admin = await ctx.createUser(`admin-inv-${Date.now()}`, 'AdminPass123!', 'admin');
    const adminToken = ctx.signToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
    });

    const email = `new.hire.${Date.now()}@example.com`;
    const inviteRes = await fetch(`${ctx.baseUrl}/admin/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ email, role: 'developer' }),
    });
    assert.equal(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    const { token } = inviteBody.data;

    const peek = await fetch(`${ctx.baseUrl}/invite/${token}`);
    assert.equal(peek.status, 200);
    const peekBody = await peek.json();
    assert.equal(peekBody.data.email, email);

    const acceptRes = await fetch(`${ctx.baseUrl}/invite/${token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `invited-${Date.now()}`,
        password: 'InvitePass123!',
      }),
    });
    assert.equal(acceptRes.status, 201);
    const acceptBody = await acceptRes.json();
    assert.equal(typeof acceptBody.data.token, 'string');
    assert.equal(acceptBody.data.user.role, 'developer');
  });

  it('password reset flow updates credentials', async () => {
    const admin = await ctx.createUser(`admin-reset-${Date.now()}`, 'AdminPass123!', 'admin');
    const target = await ctx.createUser(`reset-target-${Date.now()}`, 'OldPass123!', 'developer');
    const adminToken = ctx.signToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
    });

    const linkRes = await fetch(`${ctx.baseUrl}/admin/users/${target.id}/reset-link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(linkRes.status, 200);
    const linkBody = await linkRes.json();
    const resetToken = new URL(linkBody.data.link).searchParams.get('token');
    assert.ok(resetToken);

    const validate = await fetch(`${ctx.baseUrl}/reset/${resetToken}`);
    assert.equal(validate.status, 200);
    assert.equal((await validate.json()).data.username, target.username);

    const resetRes = await fetch(`${ctx.baseUrl}/reset/${resetToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'NewPass123!' }),
    });
    assert.equal(resetRes.status, 200);

    const loginOld = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: target.username, password: 'OldPass123!' }),
    });
    assert.equal(loginOld.status, 401);

    const loginNew = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: target.username, password: 'NewPass123!' }),
    });
    assert.equal(loginNew.status, 200);
  });
});
