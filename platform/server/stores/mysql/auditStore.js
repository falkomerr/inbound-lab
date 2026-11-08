/**
 * MySQL-backed audit store.
 */

import crypto from 'crypto';
import { getPool } from '../../db/pool.js';

const MAX_ENTRIES = 5000;

/** Parse a minimal OS name from user-agent string */
export function parseOs(ua = '') {
  if (!ua) {
    return 'Unknown';
  }
  if (/Windows NT 10/i.test(ua)) {
    return 'Windows 10';
  }
  if (/Windows NT 11/i.test(ua)) {
    return 'Windows 11';
  }
  if (/Windows/i.test(ua)) {
    return 'Windows';
  }
  if (/iPhone/i.test(ua)) {
    return 'iOS';
  }
  if (/iPad/i.test(ua)) {
    return 'iPadOS';
  }
  if (/Mac OS X/i.test(ua)) {
    return 'macOS';
  }
  if (/Android/i.test(ua)) {
    return 'Android';
  }
  if (/Linux/i.test(ua)) {
    return 'Linux';
  }
  return 'Unknown';
}

/** Parse browser name from user-agent */
export function parseBrowser(ua = '') {
  if (!ua) {
    return 'Unknown';
  }
  if (/Edg\//i.test(ua)) {
    return 'Edge';
  }
  if (/Chrome\//i.test(ua)) {
    return 'Chrome';
  }
  if (/Safari\//i.test(ua)) {
    return 'Safari';
  }
  if (/Firefox\//i.test(ua)) {
    return 'Firefox';
  }
  if (/curl\//i.test(ua)) {
    return 'cURL';
  }
  return 'Unknown';
}

/** Get client IP from request, respecting X-Forwarded-For */
export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
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

function parsePayload(value) {
  if (value == null) {
    return {};
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function rowToEntry(row) {
  const payload = parsePayload(row.payload);
  return {
    ...payload,
    id: row.id,
    timestamp: toIso(row.created_at),
    type: row.type,
    username: row.username ?? payload.username,
  };
}

async function trimToMax(pool) {
  const [[{ c }]] = await pool.query(`SELECT COUNT(*) AS c FROM audit_log`);
  const excess = Number(c) - MAX_ENTRIES;
  if (excess <= 0) {
    return;
  }
  await pool.execute(
    `DELETE FROM audit_log ORDER BY created_at ASC LIMIT ${Math.min(excess, 1000)}`
  );
}

export async function appendAudit(entry) {
  const pool = getPool();
  const id = crypto.randomUUID();
  const timestamp = new Date();
  const type = entry?.type || 'unknown';
  const username = entry?.username ?? null;
  const payload = { ...entry };

  await pool.execute(
    `INSERT INTO audit_log (id, created_at, type, username, payload)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [
      id,
      timestamp.toISOString().slice(0, 23).replace('T', ' '),
      type,
      username,
      JSON.stringify(payload),
    ]
  );

  const [[{ c }]] = await pool.query(`SELECT COUNT(*) AS c FROM audit_log`);
  if (Number(c) > MAX_ENTRIES) {
    await trimToMax(pool);
  }
}

export async function clearAuditLog() {
  const pool = getPool();
  await pool.query(`DELETE FROM audit_log`);
}

export async function getAuditLog({ limit = 200, type, username, search } = {}) {
  const pool = getPool();
  const clauses = [];
  const params = [];

  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  if (username) {
    clauses.push('username = ?');
    params.push(username);
  }
  if (search) {
    clauses.push(
      `(LOWER(IFNULL(username,'')) LIKE ? OR LOWER(CAST(payload AS CHAR)) LIKE ? OR IFNULL(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.ip')),'') LIKE ?)`
    );
    const q = `%${String(search).toLowerCase()}%`;
    params.push(q, q, `%${search}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), MAX_ENTRIES);

  const [rows] = await pool.execute(
    `SELECT id, created_at, type, username, payload
     FROM audit_log ${where}
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    params
  );

  return rows.map(rowToEntry);
}
