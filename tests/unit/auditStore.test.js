/**
 * Audit store unit tests
 * @module tests/unit/auditStore
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithIsolatedData } from '../helpers/isolatedData.js';

describe('auditStore', () => {
  /** @type {() => void} */
  let cleanup;

  after(() => {
    if (cleanup) {
      cleanup();
    }
    delete process.env.B2B_TEST_DATA_DIR;
  });

  async function audit() {
    const { mod, cleanup: removeDir } = await loadWithIsolatedData('../../server/auditStore.js');
    cleanup = removeDir;
    return mod;
  }

  it('appendAudit and getAuditLog persist entries', async () => {
    const { appendAudit, getAuditLog } = await audit();
    appendAudit({ type: 'login', username: 'tester', userId: '1' });
    appendAudit({ type: 'login_failed', username: 'bad' });
    const all = getAuditLog({ limit: 10 });
    assert.equal(all.length, 2);
    const failed = getAuditLog({ type: 'login_failed' });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].username, 'bad');
  });

  it('clearAuditLog removes all entries', async () => {
    const { appendAudit, getAuditLog, clearAuditLog } = await audit();
    appendAudit({ type: 'login', username: 'x' });
    clearAuditLog();
    assert.equal(getAuditLog().length, 0);
  });
});
