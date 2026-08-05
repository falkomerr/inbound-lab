/**
 * MySQL-backed user store (same API as JSON store).
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPool } from '../../db/pool.js';

const DEFAULT_PERMISSIONS = { teams: [], modes: [] };
const DEFAULT_LIMITS = { enabled: false, maxVus: 50, maxDurationMinutes: 30 };
const VALID_ROLES = ['admin', 'tech-lead', 'developer', 'qa', 'pm'];

/** Strip bcrypt hash before returning user records to clients. */
export function omitPassword(user) {
  if (!user) {
    return user;
  }
  const { password: _, ...safe } = user;
  return safe;
}

function parseJson(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value) {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function rowToUser(row, { includePassword = false } = {}) {
  if (!row) {
    return null;
  }
  const user = {
    id: row.id,
    username: row.username,
    email: row.email || '',
    role: row.role,
    tokenVersion: row.token_version ?? 1,
    banned: Boolean(row.banned),
    permissions: { ...DEFAULT_PERMISSIONS, ...parseJson(row.permissions_json, {}) },
    limits: { ...DEFAULT_LIMITS, ...parseJson(row.limits_json, {}) },
    createdAt: toIso(row.created_at),
  };
  if (includePassword) {
    user.password = row.password_hash;
  }
  if (user.role === 'admin') {
    user.banned = false;
  }
  return user;
}

async function ensureAdminNeverBanned(userId) {
  const pool = getPool();
  await pool.execute(
    `UPDATE users SET banned = 0, token_version = token_version + 1
     WHERE id = ? AND role = 'admin' AND banned = 1`,
    [userId]
  );
}

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

export async function getAllUsers() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, username, email, role, token_version, banned, permissions_json, limits_json, created_at
     FROM users ORDER BY created_at ASC`
  );
  return rows.map((r) => rowToUser(r));
}

export async function findByUsername(username) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, username, email, password_hash, role, token_version, banned,
            permissions_json, limits_json, created_at
     FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rowToUser(rows[0], { includePassword: true });
}

export async function findById(id) {
  const pool = getPool();
  await ensureAdminNeverBanned(id);
  const [rows] = await pool.execute(
    `SELECT id, username, email, role, token_version, banned, permissions_json, limits_json, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [String(id)]
  );
  return rowToUser(rows[0]);
}

export async function createUser(
  username,
  password,
  role = 'developer',
  email = '',
  permissions = DEFAULT_PERMISSIONS,
  limits = DEFAULT_LIMITS
) {
  const pool = getPool();
  const emailNorm = email || null;

  const [dupUser] = await pool.execute(`SELECT id FROM users WHERE username = ? LIMIT 1`, [
    username,
  ]);
  if (dupUser.length) {
    throw new Error(`Username "${username}" already exists`);
  }
  if (emailNorm) {
    const [dupEmail] = await pool.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [
      emailNorm,
    ]);
    if (dupEmail.length) {
      throw new Error(`Email "${email}" already exists`);
    }
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

  await pool.execute(
    `INSERT INTO users
      (id, username, email, password_hash, role, token_version, banned, permissions_json, limits_json, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, CAST(? AS JSON), CAST(? AS JSON), ?)`,
    [
      user.id,
      user.username,
      emailNorm,
      hashed,
      role,
      JSON.stringify(user.permissions),
      JSON.stringify(user.limits),
      user.createdAt.slice(0, 23).replace('T', ' '),
    ]
  );

  return omitPassword(user);
}

export async function bumpTokenVersion(id) {
  const pool = getPool();
  const [result] = await pool.execute(
    `UPDATE users SET token_version = token_version + 1 WHERE id = ?`,
    [String(id)]
  );
  if (result.affectedRows === 0) {
    throw new Error('User not found');
  }
  return findById(id);
}

export async function setUserBanned(id, wantBan) {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT role FROM users WHERE id = ? LIMIT 1`, [String(id)]);
  if (!rows.length) {
    throw new Error('User not found');
  }
  if (wantBan && rows[0].role === 'admin') {
    throw new Error('Administrator accounts cannot be suspended');
  }
  await pool.execute(
    `UPDATE users SET banned = ?, token_version = token_version + 1 WHERE id = ?`,
    [wantBan ? 1 : 0, String(id)]
  );
  return findById(id);
}

export async function updateUser(id, updates) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, username, email, password_hash, role, token_version, banned,
            permissions_json, limits_json, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [String(id)]
  );
  if (!rows.length) {
    throw new Error('User not found');
  }
  const current = rows[0];

  let { username } = current;
  let email = current.email || '';
  let { role } = current;
  let permissions = parseJson(current.permissions_json, DEFAULT_PERMISSIONS);
  let limits = { ...DEFAULT_LIMITS, ...parseJson(current.limits_json, {}) };
  let passwordHash = current.password_hash;
  let banned = Boolean(current.banned);

  if (updates.username && updates.username !== current.username) {
    const [dup] = await pool.execute(`SELECT id FROM users WHERE username = ? LIMIT 1`, [
      updates.username,
    ]);
    if (dup.length) {
      throw new Error(`Username "${updates.username}" already exists`);
    }
    ({ username } = updates);
  }

  if (updates.email !== undefined) {
    const nextEmail = updates.email || '';
    if (nextEmail && nextEmail !== (current.email || '')) {
      const [dup] = await pool.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [nextEmail]);
      if (dup.length) {
        throw new Error(`Email "${nextEmail}" already exists`);
      }
    }
    email = nextEmail;
  }

  if (updates.role) {
    if (!VALID_ROLES.includes(updates.role)) {
      throw new Error(`Invalid role "${updates.role}". Must be one of: ${VALID_ROLES.join(', ')}`);
    }
    ({ role } = updates);
  }

  if (updates.permissions !== undefined) {
    ({ permissions } = updates);
  }
  if (updates.limits !== undefined) {
    limits = { ...DEFAULT_LIMITS, ...updates.limits };
  }
  if (updates.password) {
    passwordHash = await bcrypt.hash(updates.password, 10);
  }
  if (updates.banned !== undefined) {
    const wantBan = coerceBannedFlag(updates.banned);
    if (wantBan && role === 'admin') {
      throw new Error('Administrator accounts cannot be suspended');
    }
    banned = wantBan;
  }

  await pool.execute(
    `UPDATE users SET
      username = ?, email = ?, password_hash = ?, role = ?, banned = ?,
      permissions_json = CAST(? AS JSON), limits_json = CAST(? AS JSON),
      token_version = token_version + 1
     WHERE id = ?`,
    [
      username,
      email || null,
      passwordHash,
      role,
      banned ? 1 : 0,
      JSON.stringify(permissions),
      JSON.stringify(limits),
      String(id),
    ]
  );

  return findById(id);
}

export async function deleteUser(id) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, username, email, password_hash, role, token_version, banned,
            permissions_json, limits_json, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [String(id)]
  );
  if (!rows.length) {
    throw new Error('User not found');
  }
  const target = rows[0];
  if (target.role === 'admin') {
    const [admins] = await pool.query(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`);
    if (Number(admins[0].c) <= 1) {
      throw new Error('Cannot delete the last admin account');
    }
  }
  await pool.execute(`DELETE FROM users WHERE id = ?`, [String(id)]);
  return rowToUser(target, { includePassword: true });
}

export async function verifyPassword(username, password) {
  const user = await findByUsername(username);
  if (!user) {
    return null;
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return null;
  }
  if (user.role === 'admin' && user.banned) {
    await ensureAdminNeverBanned(user.id);
    user.banned = false;
  }
  return omitPassword(user);
}

export async function banAllNonAdminUsers() {
  const pool = getPool();
  const [result] = await pool.execute(
    `UPDATE users SET banned = 1, token_version = token_version + 1
     WHERE role <> 'admin' AND banned = 0`
  );
  return { bannedCount: result.affectedRows };
}

export async function unbanAllUsers() {
  const pool = getPool();
  const [result] = await pool.execute(`UPDATE users SET banned = 0 WHERE banned = 1`);
  return { unbannedCount: result.affectedRows };
}
