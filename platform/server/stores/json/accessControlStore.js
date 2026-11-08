/**
 * Global login suspension (non-admins only).
 * Stored separately from users.json so it survives user list edits.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJSON } from '../../utils/atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR
  ? process.env.B2B_TEST_DATA_DIR
  : join(__dirname, '../../../data');
const ACCESS_FILE = join(DATA_ROOT, 'access-control.json');

export function getGlobalLoginBan() {
  if (!existsSync(ACCESS_FILE)) {
    return false;
  }
  try {
    const data = JSON.parse(readFileSync(ACCESS_FILE, 'utf-8'));
    return Boolean(data.globalLoginBan);
  } catch {
    return false;
  }
}

/** @returns {boolean} new value */
export function setGlobalLoginBan(enabled) {
  const value = Boolean(enabled);
  atomicWriteJSON(ACCESS_FILE, {
    globalLoginBan: value,
    updatedAt: new Date().toISOString(),
  });
  return value;
}
