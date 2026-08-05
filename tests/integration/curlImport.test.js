/**
 * cURL import API integration tests
 * @module tests/integration/curlImport
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createIntegrationServer } from '../helpers/integrationServer.js';

const scenariosDir = join(dirname(fileURLToPath(import.meta.url)), '../../tests/scenarios');

describe('cURL import integration', () => {
  /** @type {Awaited<ReturnType<typeof createIntegrationServer>>} */
  let ctx;
  /** @type {string[]} */
  const createdTests = [];

  before(async () => {
    ctx = await createIntegrationServer();
  });

  after(async () => {
    for (const name of createdTests) {
      const filePath = join(scenariosDir, `${name}.js`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
    await ctx.close();
  });

  it('POST /tests/curl creates a runnable scenario file', async () => {
    const user = await ctx.createUser(`curl-user-${Date.now()}`, 'ValidPass123!', 'developer');
    const token = ctx.signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const testName = `curl-int-${Date.now()}`;
    createdTests.push(testName);

    const res = await fetch(`${ctx.baseUrl}/tests/curl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        testName,
        request: {
          method: 'POST',
          url: 'https://httpbin.org/post',
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
        },
        options: { vus: 2, duration: '30s' },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.testId, testName);
    assert.equal(existsSync(join(scenariosDir, `${testName}.js`)), true);

    const listRes = await fetch(`${ctx.baseUrl}/tests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    assert.ok(listBody.data.some((t) => t.id === testName && t.mode === 'curl'));
  });

  it('POST /tests/curl rejects invalid test names', async () => {
    const user = await ctx.createUser(`curl-bad-${Date.now()}`, 'ValidPass123!', 'developer');
    const token = ctx.signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const res = await fetch(`${ctx.baseUrl}/tests/curl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        testName: 'Invalid Name!',
        request: { method: 'GET', url: 'https://example.com' },
      }),
    });
    assert.equal(res.status, 400);
  });
});
