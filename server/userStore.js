/**
 * User Store
 * Manages users in a JSON file with bcrypt password hashing.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { atomicWriteJSON } from './utils/atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR
  ? process.env.B2B_TEST_DATA_DIR
  : join(__dirname, '../data');
const USERS_FILE = join(DATA_ROOT, 'users.json');

function readUsers() {
  if (!existsSync(USERS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  atomicWriteJSON(USERS_FILE, users);
}

/** Strip bcrypt hash before returning user records to clients. */
export function omitPassword(user) {
  const { password: _, ...safe } = user;
  return safe;
}

/** Admins must never remain suspended (policy + self-heal legacy data). */
function ensureAdminNeverBannedOnDisk(userId) {
  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(userId));
  if (idx === -1) {
    return;
  }
  if (users[idx].role === 'admin' && users[idx].banned) {
    users[idx].banned = false;
    users[idx].tokenVersion = (users[idx].tokenVersion ?? 1) + 1;
    writeUsers(users);
  }
}

// Fill in any missing fields for legacy users loaded from disk
function withDefaults({ permissions, limits, tokenVersion, banned, ...rest }) {
  return {
    ...rest,
    tokenVersion: tokenVersion ?? 1,
    banned: banned === true,
    permissions: { ...DEFAULT_PERMISSIONS, ...(permissions || {}) },
    limits: { ...DEFAULT_LIMITS, ...(limits || {}) },
  };
}

export function getAllUsers() {
  return readUsers().map((u) => {
    const out = withDefaults(omitPassword(u));
    if (out.role === 'admin') {
      return { ...out, banned: false };
    }
    return out;
  });
}

export function findByUsername(username) {
  return readUsers().find((u) => u.username === username) || null;
}

export function findById(id) {
  const user = readUsers().find((u) => String(u.id) === String(id));
  if (!user) {
    return null;
  }
  ensureAdminNeverBannedOnDisk(user.id);
  const fresh = readUsers().find((u) => String(u.id) === String(id));
  if (!fresh) {
    return null;
  }
  return withDefaults(omitPassword(fresh));
}

const DEFAULT_PERMISSIONS = { teams: [], modes: [] };
const DEFAULT_LIMITS = { enabled: false, maxVus: 50, maxDurationMinutes: 30 };

export async function createUser(
  username,
  password,
  role = 'developer',
  email = '',
  permissions = DEFAULT_PERMISSIONS,
  limits = DEFAULT_LIMITS
) {
  const users = readUsers();

  if (users.find((u) => u.username === username)) {
    throw new Error(`Username "${username}" already exists`);
  }
  if (email && users.find((u) => u.email === email)) {
    throw new Error(`Email "${email}" already exists`);
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    username,
    email: email || '',
    password: hashed,
    role,
    tokenVersion: 1,
    banned: false,
    permissions: permissions || DEFAULT_PERMISSIONS,
    limits: limits || DEFAULT_LIMITS,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  writeUsers(users);

  return omitPassword(user);
}

/** Interpret JSON `banned` (boolean or legacy string) without treating "false" as true. */
function coerceBannedFlag(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (value === false || value === 0 || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1') {
      return true;
    }
    if (s === 'false' || s === '0' || s === '') {
      return false;
    }
  }
  return Boolean(value);
}

/**
 * Set suspended flag only (invalidates JWT). Prefer over full PUT for ban toggles.
 * @param {string} id
 * @param {boolean} wantBan
 */
/**
 * Increment tokenVersion so all existing JWTs for this user become invalid.
 * Used on login so only one active session per account (new login revokes prior).
 * @param {string} id
 * @returns {object} User object without password, with updated tokenVersion
 */
export function bumpTokenVersion(id) {
  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) {
    throw new Error('User not found');
  }
  users[idx].tokenVersion = (users[idx].tokenVersion ?? 1) + 1;
  writeUsers(users);
  return withDefaults(omitPassword(users[idx]));
}

export function setUserBanned(id, wantBan) {
  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) {
    throw new Error('User not found');
  }
  if (wantBan && users[idx].role === 'admin') {
    throw new Error('Administrator accounts cannot be suspended');
  }
  users[idx].banned = Boolean(wantBan);
  users[idx].tokenVersion = (users[idx].tokenVersion ?? 1) + 1;
  writeUsers(users);
  return withDefaults(omitPassword(users[idx]));
}

export async function updateUser(id, updates) {
  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) {
    throw new Error('User not found');
  }

  if (updates.username && updates.username !== users[idx].username) {
    if (users.find((u) => u.username === updates.username)) {
      throw new Error(`Username "${updates.username}" already exists`);
    }
    users[idx].username = updates.username;
  }

  if (updates.email !== undefined) {
    const email = updates.email || '';
    if (email && email !== users[idx].email && users.find((u) => u.email === email)) {
      throw new Error(`Email "${email}" already exists`);
    }
    users[idx].email = email;
  }

  if (updates.role) {
    const VALID_ROLES = ['admin', 'tech-lead', 'developer', 'qa', 'pm'];
    if (!VALID_ROLES.includes(updates.role)) {
      throw new Error(`Invalid role "${updates.role}". Must be one of: ${VALID_ROLES.join(', ')}`);
    }
    users[idx].role = updates.role;
  }

  if (updates.permissions !== undefined) {
    users[idx].permissions = updates.permissions;
  }

  if (updates.limits !== undefined) {
    users[idx].limits = { ...DEFAULT_LIMITS, ...updates.limits };
  }

  if (updates.password) {
    users[idx].password = await bcrypt.hash(updates.password, 10);
  }

  if (updates.banned !== undefined) {
    const wantBan = coerceBannedFlag(updates.banned);
    if (wantBan && users[idx].role === 'admin') {
      throw new Error('Administrator accounts cannot be suspended');
    }
    users[idx].banned = wantBan;
  }

  // Increment tokenVersion so any existing JWT for this user becomes invalid,
  // forcing them to re-login and receive fresh role/permissions/limits.
  users[idx].tokenVersion = (users[idx].tokenVersion ?? 1) + 1;

  writeUsers(users);

  return omitPassword(users[idx]);
}

export function deleteUser(id) {
  const users = readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) {
    throw new Error('User not found');
  }

  // Prevent deleting the last admin
  const admins = users.filter((u) => u.role === 'admin');
  if (users[idx].role === 'admin' && admins.length === 1) {
    throw new Error('Cannot delete the last admin account');
  }

  const deleted = users.splice(idx, 1)[0];
  writeUsers(users);
  return deleted;
}

export async function verifyPassword(username, password) {
  const user = findByUsername(username);
  if (!user) {
    return null;
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return null;
  }
  if (user.role === 'admin' && user.banned) {
    ensureAdminNeverBannedOnDisk(user.id);
    user.banned = false;
  }
  return withDefaults(omitPassword(user));
}

/** Suspend every non-admin account (administrator role is never banned). */
export function banAllNonAdminUsers() {
  const users = readUsers();
  let bannedCount = 0;
  for (const u of users) {
    if (u.role === 'admin') {
      continue;
    }
    if (!u.banned) {
      u.banned = true;
      u.tokenVersion = (u.tokenVersion ?? 1) + 1;
      bannedCount += 1;
    }
  }
  writeUsers(users);
  return { bannedCount };
}

/** Clear the banned flag on every user (does not change global login ban). */
export function unbanAllUsers() {
  const users = readUsers();
  let unbannedCount = 0;
  for (const u of users) {
    if (u.banned) {
      u.banned = false;
      unbannedCount += 1;
    }
  }
  writeUsers(users);
  return { unbannedCount };
}
