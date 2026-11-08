/**
 * Invite Store
 * Manages one-time invite tokens stored in data/invites.json.
 * Each invite is tied to an email and a role.
 * Optional domain lock via ALLOWED_EMAIL_DOMAIN (see emailPolicy.js).
 */

import { readFileSync, existsSync } from 'fs';
import { atomicWriteJSON } from '../../utils/atomicWrite.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { assertEmailAllowed } from '../../emailPolicy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR
  ? process.env.B2B_TEST_DATA_DIR
  : join(__dirname, '../../../data');
const INVITES_FILE = join(DATA_ROOT, 'invites.json');
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readInvites() {
  if (!existsSync(INVITES_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(INVITES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeInvites(invites) {
  atomicWriteJSON(INVITES_FILE, invites);
}

function purgeExpired(invites) {
  return invites.filter((i) => !i.expiresAt || new Date(i.expiresAt) > new Date());
}

export function getAllInvites() {
  const invites = purgeExpired(readInvites());
  writeInvites(invites);
  return invites.filter((i) => !i.used);
}

export function createInvite(
  email,
  role = 'developer',
  createdBy = 'admin',
  permissions = { teams: [], modes: [] },
  limits = { enabled: false, maxVus: 50, maxDurationMinutes: 30 }
) {
  assertEmailAllowed(email);

  const invites = purgeExpired(readInvites());

  // Revoke any existing pending invite for same email
  const filtered = invites.filter((i) => i.email !== email.toLowerCase());

  const token = crypto.randomBytes(32).toString('hex');
  const invite = {
    token,
    email: email.toLowerCase(),
    role,
    permissions,
    limits,
    createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    used: false,
  };

  filtered.push(invite);
  writeInvites(filtered);
  return invite;
}

export function getInviteByToken(token) {
  const invites = readInvites();
  const invite = invites.find((i) => i.token === token);
  if (!invite) {
    return null;
  }
  if (invite.used) {
    return null;
  }
  if (new Date(invite.expiresAt) < new Date()) {
    return null;
  }
  return invite;
}

/**
 * Resolve invite token for public status (validate page).
 * Unlike getInviteByToken, still returns info for used-but-not-expired tokens.
 */
export function peekInviteByToken(token) {
  const invites = readInvites();
  const invite = invites.find((i) => i.token === token);
  if (!invite) {
    return { status: 'missing' };
  }
  if (new Date(invite.expiresAt) < new Date()) {
    return { status: 'expired' };
  }
  if (invite.used) {
    return { status: 'used', invite };
  }
  return { status: 'active', invite };
}

export function consumeInvite(token) {
  const invites = readInvites();
  const idx = invites.findIndex((i) => i.token === token);
  if (idx === -1) {
    return false;
  }
  invites[idx].used = true;
  invites[idx].usedAt = new Date().toISOString();
  writeInvites(invites);
  return true;
}

export function revokeInvite(token) {
  const invites = readInvites();
  const revoked = invites.find((i) => i.token === token);
  writeInvites(invites.filter((i) => i.token !== token));
  return revoked || null;
}
