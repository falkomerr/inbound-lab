/**
 * Reset Store
 * One-time password-reset tokens stored in data/resets.json.
 * Each token expires after 2 hours.
 */

import { readFileSync, existsSync } from 'fs';
import { atomicWriteJSON } from './utils/atomicWrite.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR
  ? process.env.B2B_TEST_DATA_DIR
  : join(__dirname, '../data');
const RESETS_FILE = join(DATA_ROOT, 'resets.json');
const RESET_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function readResets() {
  if (!existsSync(RESETS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(RESETS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeResets(resets) {
  atomicWriteJSON(RESETS_FILE, resets);
}

function purgeExpired(resets) {
  return resets.filter((r) => new Date(r.expiresAt) > new Date());
}

/** Create a reset token for a user. Replaces any existing token for that user. */
export function createReset(userId, username) {
  const resets = purgeExpired(readResets()).filter((r) => r.userId !== userId);
  const token = crypto.randomBytes(32).toString('hex');
  const entry = {
    token,
    userId,
    username,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  };
  resets.push(entry);
  writeResets(resets);
  return entry;
}

/** Look up a token. Returns the entry or null if missing/expired. */
export function getResetByToken(token) {
  const entry = purgeExpired(readResets()).find((r) => r.token === token);
  return entry || null;
}

/** Consume (delete) a token after use. */
export function consumeReset(token) {
  writeResets(purgeExpired(readResets()).filter((r) => r.token !== token));
}
