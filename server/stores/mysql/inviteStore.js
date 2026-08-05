/**
 * MySQL-backed invite store.
 */

import crypto from 'crypto';
import { assertEmailAllowed } from '../../emailPolicy.js';
import { getPool } from '../../db/pool.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toMysqlDatetime(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

function rowToInvite(row) {
  if (!row) {
    return null;
  }
  return {
    token: row.token,
    email: row.email,
    role: row.role,
    permissions: parseJson(row.permissions_json, { teams: [], modes: [] }),
    limits: parseJson(row.limits_json, {
      enabled: false,
      maxVus: 50,
      maxDurationMinutes: 30,
    }),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    used: Boolean(row.used),
    usedAt: toIso(row.used_at),
  };
}

async function purgeExpired() {
  const pool = getPool();
  await pool.execute(`DELETE FROM invites WHERE expires_at < UTC_TIMESTAMP(3)`);
}

export async function getAllInvites() {
  await purgeExpired();
  const pool = getPool();
  const [rows] = await pool.query(`SELECT * FROM invites WHERE used = 0 ORDER BY created_at DESC`);
  return rows.map(rowToInvite);
}

export async function createInvite(
  email,
  role = 'developer',
  createdBy = 'admin',
  permissions = { teams: [], modes: [] },
  limits = { enabled: false, maxVus: 50, maxDurationMinutes: 30 }
) {
  assertEmailAllowed(email);
  await purgeExpired();
  const pool = getPool();
  const emailNorm = email.toLowerCase();

  await pool.execute(`DELETE FROM invites WHERE email = ? AND used = 0`, [emailNorm]);

  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = {
    token,
    email: emailNorm,
    role,
    permissions,
    limits,
    createdBy,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    used: false,
  };

  await pool.execute(
    `INSERT INTO invites
      (token, email, role, permissions_json, limits_json, created_by, created_at, expires_at, used)
     VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, 0)`,
    [
      token,
      emailNorm,
      role,
      JSON.stringify(permissions),
      JSON.stringify(limits),
      createdBy,
      toMysqlDatetime(createdAt),
      toMysqlDatetime(expiresAt),
    ]
  );

  return invite;
}

export async function getInviteByToken(token) {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT * FROM invites WHERE token = ? LIMIT 1`, [token]);
  const invite = rowToInvite(rows[0]);
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

export async function peekInviteByToken(token) {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT * FROM invites WHERE token = ? LIMIT 1`, [token]);
  const invite = rowToInvite(rows[0]);
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

export async function consumeInvite(token) {
  const pool = getPool();
  const [result] = await pool.execute(
    `UPDATE invites SET used = 1, used_at = UTC_TIMESTAMP(3) WHERE token = ?`,
    [token]
  );
  return result.affectedRows > 0;
}

export async function revokeInvite(token) {
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT * FROM invites WHERE token = ? LIMIT 1`, [token]);
  const revoked = rowToInvite(rows[0]);
  if (!revoked) {
    return null;
  }
  await pool.execute(`DELETE FROM invites WHERE token = ?`, [token]);
  return revoked;
}
