/**
 * Isolated temp data directory for store unit tests.
 * Uses a cache-busted dynamic import so each suite gets a fresh module + empty JSON store.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * @template T
 * @param {string} modulePath relative path from caller (e.g. '../../server/userStore.js')
 * @returns {Promise<{ mod: T, dir: string, cleanup: () => void }>}
 */
export async function loadWithIsolatedData(modulePath) {
  const dir = mkdtempSync(join(tmpdir(), 'b2b-test-data-'));
  process.env.B2B_TEST_DATA_DIR = dir;
  const mod = await import(`${modulePath}?isolate=${Date.now()}`);
  return {
    mod,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
