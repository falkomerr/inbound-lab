/**
 * WebSocket JWT handshake integration tests
 * @module tests/integration/wsAuth
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createIntegrationServer } from '../helpers/integrationServer.js';
import { waitFor } from '../helpers/waitFor.js';

/**
 * @param {string} url
 * @returns {Promise<{ code: number, reason: string, messages: object[] }>}
 */
function connectWsUntilClose(url) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket close timeout'));
    }, 5000);

    ws.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });
    ws.on('close', (code, reasonBuf) => {
      clearTimeout(timer);
      const reason = Buffer.isBuffer(reasonBuf)
        ? reasonBuf.toString('utf8')
        : String(reasonBuf || '');
      resolve({ code, reason, messages });
    });
    ws.on('error', () => {
      /* handshake may error before close; close still follows */
    });
  });
}

/**
 * @param {string} url
 */
function connectWsOpen(url) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket open timeout'));
    }, 5000);

    ws.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ws, messages });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('WebSocket auth integration', () => {
  /** @type {Awaited<ReturnType<typeof createIntegrationServer>>} */
  let ctx;

  before(async () => {
    ctx = await createIntegrationServer();
  });

  after(async () => {
    await ctx.close();
  });

  it('rejects connection without token', async () => {
    const result = await connectWsUntilClose(ctx.wsBase);
    assert.equal(result.code, 1008);
    assert.match(result.reason, /unauthorized/i);
  });

  it('rejects invalid JWT', async () => {
    const result = await connectWsUntilClose(`${ctx.wsBase}?token=not.a.valid.jwt`);
    assert.equal(result.code, 1008);
  });

  it('accepts valid JWT and sends initial status', async () => {
    const user = await ctx.createUser(`ws-user-${Date.now()}`, 'ValidPass123!', 'developer');
    const token = ctx.signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const conn = await connectWsOpen(`${ctx.wsBase}?token=${encodeURIComponent(token)}`);
    assert.ok(conn.messages.some((m) => m.type === 'status'));
    conn.ws.close();
  });

  it('rejects stale token after tokenVersion bump', async () => {
    const user = await ctx.createUser(`ws-stale-${Date.now()}`, 'ValidPass123!', 'developer');
    const staleToken = ctx.signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    const { bumpTokenVersion } = await import(`../../server/userStore.js?ws=${Date.now()}`);
    bumpTokenVersion(user.id);

    const result = await connectWsUntilClose(
      `${ctx.wsBase}?token=${encodeURIComponent(staleToken)}`
    );
    assert.equal(result.code, 1008);
    assert.match(result.reason, /session expired/i);
  });

  it('receives test-started after subscribe when a run begins', async () => {
    const user = await ctx.createUser(`ws-live-${Date.now()}`, 'ValidPass123!', 'developer');
    const token = ctx.signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const conn = await connectWsOpen(`${ctx.wsBase}?token=${encodeURIComponent(token)}`);
    conn.ws.send(JSON.stringify({ type: 'subscribe' }));

    await fetch(`${ctx.baseUrl}/tests/start`, {
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

    await waitFor(() => conn.messages.some((m) => m.type === 'test-started'));

    await fetch(`${ctx.baseUrl}/tests/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    conn.ws.close();
  });
});
