/**
 * MySQL-backed password-reset tokens.
 */

import crypto from 'crypto';
import { getPool } from '../../db/pool.js';

const RESET_TTL_MS = 2 * 60 * 60 * 1000;

function toIso(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toMysqlDatetime(d) {
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

function rowToReset(row) {
  if (!row) {
    return null;
  }
  return {
    token: row.token,
    userId: row.user_id,
    username: row.username,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}

async function purgeExpired() {
  const pool = getPool();
  await pool.execute(`DELETE FROM password_resets WHERE expires_at < UTC_TIMESTAMP(3)`);
}

export async function createReset(userId, username) {
  await purgeExpired();
  const pool = getPool();
  await pool.execute(`DELETE FROM password_resets WHERE user_id = ?`, [userId]);

  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  const entry = {
    token,
    userId,
    username,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await pool.execute(
    `INSERT INTO password_resets (token, user_id, username, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, userId, username, toMysqlDatetime(createdAt), toMysqlDatetime(expiresAt)]
  );

  return entry;
}

export async function getResetByToken(token) {
  await purgeExpired();
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT * FROM password_resets WHERE token = ? LIMIT 1`, [
    token,
  ]);
  return rowToReset(rows[0]);
}

export async function consumeReset(token) {
  await purgeExpired();
  const pool = getPool();
  await pool.execute(`DELETE FROM password_resets WHERE token = ?`, [token]);
}
