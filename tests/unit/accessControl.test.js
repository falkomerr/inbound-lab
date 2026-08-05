/**
 * Global login ban store unit tests
 * @module tests/unit/accessControl
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadWithIsolatedData } from '../helpers/isolatedData.js';

describe('accessControlStore', () => {
  /** @type {() => void} */
  let cleanup;
  /** @type {string} */
  let dataDir;

  after(() => {
    if (cleanup) {
      cleanup();
    }
    delete process.env.B2B_TEST_DATA_DIR;
  });

  async function accessControl() {
    const {
      mod,
      cleanup: removeDir,
      dir,
    } = await loadWithIsolatedData('../../server/stores/json/accessControlStore.js');
    cleanup = removeDir;
    dataDir = dir;
    return mod;
  }

  it('defaults globalLoginBan to false when file is missing', async () => {
    const { getGlobalLoginBan } = await accessControl();
    assert.equal(getGlobalLoginBan(), false);
  });

  it('persists and reads globalLoginBan flag', async () => {
    const { getGlobalLoginBan, setGlobalLoginBan } = await accessControl();
    assert.equal(setGlobalLoginBan(true), true);
    assert.equal(getGlobalLoginBan(), true);

    const file = join(dataDir, 'access-control.json');
    assert.ok(existsSync(file));
    const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
    assert.equal(onDisk.globalLoginBan, true);
    assert.ok(onDisk.updatedAt);

    setGlobalLoginBan(false);
    assert.equal(getGlobalLoginBan(), false);
  });
});
