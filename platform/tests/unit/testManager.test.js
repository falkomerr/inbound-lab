/**
 * TestManager unit tests (isolated temp data + history file)
 * @module tests/unit/testManager
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FAKE_K6_PATH } from '../helpers/integrationServer.js';
import { waitFor } from '../helpers/waitFor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('TestManager', () => {
  /** @type {string} */
  let dataDir;
  /** @type {import('../../server/testManager.js').TestManager} */
  let TestManager;
  /** @type {import('../../server/testManager.js').TestManager} */
  let manager;

  after(() => {
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
    if (reportsDir) {
      rmSync(reportsDir, { recursive: true, force: true });
    }
    delete process.env.B2B_TEST_DATA_DIR;
    delete process.env.B2B_TEST_REPORTS_DIR;
    delete process.env.K6_BIN;
    delete process.env.FAKE_K6_DELAY_MS;
  });

  /** @type {string} */
  let reportsDir;

  async function loadManager() {
    dataDir = mkdtempSync(join(tmpdir(), 'b2b-tm-'));
    reportsDir = mkdtempSync(join(tmpdir(), 'b2b-tm-reports-'));
    process.env.B2B_TEST_DATA_DIR = dataDir;
    process.env.B2B_TEST_REPORTS_DIR = reportsDir;
    process.env.K6_BIN = FAKE_K6_PATH;
    process.env.FAKE_K6_DELAY_MS = '30';
    const mod = await import(`../../server/testManager.js?tm=${Date.now()}`);
    ({ TestManager } = mod);
    manager = new TestManager();
    return mod;
  }

  it('exports TEAMS constant', async () => {
    const { TEAMS } = await loadManager();
    assert.ok(TEAMS.includes('api'));
    assert.ok(TEAMS.length >= 3);
  });

  it('getAvailableTests lists built-in scenario when file exists', async () => {
    await loadManager();
    const tests = manager.getAvailableTests();
    assert.ok(tests.some((t) => t.id === 'sample-http-get'));
    assert.equal(tests.find((t) => t.id === 'sample-http-get').mode, 'scenario');
  });

  it('getStatus returns idle defaults', async () => {
    await loadManager();
    const status = manager.getStatus();
    assert.equal(status.running, false);
    assert.equal(status.preparingUser, null);
    assert.ok(Array.isArray(status.output));
  });

  it('setPreparing and clearPreparing update preparingUser', async () => {
    await loadManager();
    manager.setPreparing({ id: 'u1', username: 'alice' });
    assert.deepEqual(manager.getStatus().preparingUser, { id: 'u1', username: 'alice' });
    manager.clearPreparing();
    assert.equal(manager.getStatus().preparingUser, null);
  });

  it('startTest rejects when another test is already running', async () => {
    await loadManager();
    manager.status.running = true;
    await assert.rejects(
      () => manager.startTest('sample-http-get', { vus: 5, duration: '1m' }),
      /already running/
    );
  });

  it('startTest rejects unknown scenario id', async () => {
    await loadManager();
    await assert.rejects(
      () => manager.startTest('not-a-real-scenario', { vus: 5, duration: '1m' }),
      /not found/
    );
  });

  it('getHistory respects limit', async () => {
    await loadManager();
    manager.testHistory = [
      { id: 'a', testId: 'x' },
      { id: 'b', testId: 'x' },
      { id: 'c', testId: 'x' },
    ];
    assert.equal(manager.getHistory(2).length, 2);
  });

  it('deleteTestHistory removes entry by id', async () => {
    await loadManager();
    manager.testHistory = [{ id: 'run-1', testId: 'sample-http-get' }];
    manager.deleteTestHistory('run-1');
    assert.equal(manager.getHistory().length, 0);
  });

  it('stopTest when idle throws', async () => {
    await loadManager();
    assert.throws(
      () => manager.stopTest({ id: 'u1', username: 'alice' }),
      /No test is currently running/
    );
  });

  it('startTest spawns fake k6 and sets running status', async () => {
    await loadManager();
    await manager.startTest(
      'sample-http-get',
      { vus: 1, duration: '1s' },
      {
        id: 'u1',
        username: 'alice',
      }
    );
    assert.equal(manager.getStatus().running, true);
    assert.equal(manager.getStatus().startedByUsername, 'alice');
    assert.ok(manager.currentTest?.process);
    manager.stopTest({ id: 'u1', username: 'alice' });
    assert.equal(manager.getStatus().running, false);
  });

  it('notifySubscribers delivers test-started to WebSocket mock', async () => {
    await loadManager();
    const events = [];
    const ws = {
      readyState: 1,
      user: { username: 'alice', id: 'u1' },
      send(payload) {
        events.push(JSON.parse(payload));
      },
    };
    manager.addSubscriber(ws);
    await manager.startTest('sample-http-get', { vus: 1, duration: '1s' });
    assert.ok(events.some((e) => e.type === 'test-started'));
    manager.stopTest();
  });

  it('natural completion adds history entry', async () => {
    await loadManager();
    await manager.startTest('sample-http-get', { vus: 1, duration: '1s' });
    await waitFor(() => manager.getStatus().running === false, 8000);
    assert.ok(manager.getHistory(1).length >= 1);
  });
});
