/**
 * Test start/stop lifecycle via HTTP API
 * @module tests/integration/testLifecycle
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationServer } from '../helpers/integrationServer.js';
import { waitFor } from '../helpers/waitFor.js';

describe('Test lifecycle integration', () => {
  /** @type {Awaited<ReturnType<typeof createIntegrationServer>>} */
  let ctx;

  before(async () => {
    ctx = await createIntegrationServer();
  });

  after(async () => {
    await ctx.close();
  });

  async function devToken() {
    const user = await ctx.createUser(`runner-${Date.now()}`, 'ValidPass123!', 'developer');
    const token = ctx.signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
      permissions: user.permissions,
      limits: user.limits,
    });
    return { user, token };
  }

  it('POST /tests/start runs fake k6 and POST /tests/stop ends the run', async () => {
    const { user, token } = await devToken();

    const startRes = await fetch(`${ctx.baseUrl}/tests/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        testId: 'sample-http-get',
        options: { vus: 1, duration: '2s', environment: 'staging' },
      }),
    });
    assert.equal(startRes.status, 200);
    const startBody = await startRes.json();
    assert.equal(startBody.success, true);

    await waitFor(() => ctx.testManager.getStatus().running === true);

    const statusRes = await fetch(`${ctx.baseUrl}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusBody = await statusRes.json();
    assert.equal(statusBody.data.running, true);
    assert.equal(statusBody.data.startedByUsername, user.username);

    const stopRes = await fetch(`${ctx.baseUrl}/tests/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(stopRes.status, 200);
    assert.equal((await stopRes.json()).data.status, 'stopped');

    await waitFor(() => ctx.testManager.getStatus().running === false);
  });

  it('non-starter cannot stop another users run', async () => {
    const starter = await devToken();
    const other = await devToken();

    const startRes = await fetch(`${ctx.baseUrl}/tests/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${starter.token}`,
      },
      body: JSON.stringify({
        testId: 'sample-http-get',
        options: { vus: 1, duration: '5s', environment: 'staging' },
      }),
    });
    assert.equal(startRes.status, 200);
    await waitFor(() => ctx.testManager.getStatus().running === true);

    const stopRes = await fetch(`${ctx.baseUrl}/tests/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.token}` },
    });
    assert.equal(stopRes.status, 403);

    await fetch(`${ctx.baseUrl}/tests/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${starter.token}` },
    });
    await waitFor(() => ctx.testManager.getStatus().running === false);
  });

  it('GET /history returns entries after a completed run', async () => {
    const { token } = await devToken();

    await fetch(`${ctx.baseUrl}/tests/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        testId: 'sample-http-get',
        options: { vus: 1, duration: '1s', environment: 'staging' },
      }),
    });
    await waitFor(() => ctx.testManager.getStatus().running === true);
    await waitFor(() => ctx.testManager.getStatus().running === false, 8000);

    const historyRes = await fetch(`${ctx.baseUrl}/history?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(historyRes.status, 200);
    const historyBody = await historyRes.json();
    assert.ok(historyBody.data.length >= 1);
    assert.ok(['completed', 'stopped', 'failed'].includes(historyBody.data[0].status));
  });
});
