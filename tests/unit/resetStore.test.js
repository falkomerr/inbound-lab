/**
 * Reset store unit tests
 * @module tests/unit/resetStore
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithIsolatedData } from '../helpers/isolatedData.js';

describe('resetStore', () => {
  /** @type {() => void} */
  let cleanup;

  after(() => {
    if (cleanup) {
      cleanup();
    }
    delete process.env.B2B_TEST_DATA_DIR;
  });

  async function resets() {
    const { mod, cleanup: removeDir } = await loadWithIsolatedData(
      '../../server/stores/json/resetStore.js'
    );
    cleanup = removeDir;
    return mod;
  }

  it('createReset and getResetByToken round-trip', async () => {
    const { createReset, getResetByToken, consumeReset } = await resets();
    const entry = createReset('user-1', 'alice');
    assert.ok(entry.token);
    const found = getResetByToken(entry.token);
    assert.equal(found.username, 'alice');
    consumeReset(entry.token);
    assert.equal(getResetByToken(entry.token), null);
  });
});
