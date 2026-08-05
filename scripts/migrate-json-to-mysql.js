#!/usr/bin/env node
/**
 * Import existing data/*.json into MySQL (one-shot migration).
 *
 * Requires MYSQL_* / MYSQL_URL configured in .env.
 * Usage: node scripts/migrate-json-to-mysql.js
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getMysqlConfig, initStorage, getPool, closePool } from '../server/db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR || join(__dirname, '../data');

function readJson(name, fallback) {
  const file = join(DATA_ROOT, name);
  if (!existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function toMysqlDatetime(iso) {
  if (!iso) {
    return new Date().toISOString().slice(0, 23).replace('T', ' ');
  }
  return new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
}

async function main() {
  const cfg = getMysqlConfig();
  if (!cfg.enabled) {
    console.error('MySQL is not configured. Set MYSQL_HOST or MYSQL_URL in .env');
    process.exit(1);
  }

  // Force MySQL even if STORAGE_BACKEND=json
  process.env.STORAGE_BACKEND = 'mysql';
  delete process.env.B2B_TEST_DATA_DIR;

  await initStorage();
  const pool = getPool();

  const users = readJson('users.json', []);
  const invites = readJson('invites.json', []);
  const resets = readJson('resets.json', []);
  const audit = readJson('audit.json', []);
  const access = readJson('access-control.json', { globalLoginBan: false });

  let userCount = 0;
  for (const u of users) {
    await pool.execute(
      `INSERT INTO users
        (id, username, email, password_hash, role, token_version, banned, permissions_json, limits_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         password_hash = VALUES(password_hash),
         role = VALUES(role),
         token_version = VALUES(token_version),
         banned = VALUES(banned),
         permissions_json = VALUES(permissions_json),
         limits_json = VALUES(limits_json)`,
      [
        u.id,
        u.username,
        u.email || null,
        u.password,
        u.role || 'developer',
        u.tokenVersion ?? 1,
        u.banned ? 1 : 0,
        JSON.stringify(u.permissions || { teams: [], modes: [] }),
        JSON.stringify(u.limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 }),
        toMysqlDatetime(u.createdAt),
      ]
    );
    userCount += 1;
  }

  let inviteCount = 0;
  for (const i of invites) {
    await pool.execute(
      `INSERT INTO invites
        (token, email, role, permissions_json, limits_json, created_by, created_at, expires_at, used, used_at)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE used = VALUES(used), used_at = VALUES(used_at)`,
      [
        i.token,
        i.email,
        i.role || 'developer',
        JSON.stringify(i.permissions || { teams: [], modes: [] }),
        JSON.stringify(i.limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 }),
        i.createdBy || 'admin',
        toMysqlDatetime(i.createdAt),
        toMysqlDatetime(i.expiresAt),
        i.used ? 1 : 0,
        i.usedAt ? toMysqlDatetime(i.usedAt) : null,
      ]
    );
    inviteCount += 1;
  }

  let resetCount = 0;
  for (const r of resets) {
    await pool.execute(
      `INSERT INTO password_resets (token, user_id, username, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
      [r.token, r.userId, r.username, toMysqlDatetime(r.createdAt), toMysqlDatetime(r.expiresAt)]
    );
    resetCount += 1;
  }

  let auditCount = 0;
  for (const e of audit) {
    const { id, timestamp, type, username, ...rest } = e;
    await pool.execute(
      `INSERT INTO audit_log (id, created_at, type, username, payload)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
      [
        id,
        toMysqlDatetime(timestamp),
        type || 'unknown',
        username || null,
        JSON.stringify({ type, username, ...rest }),
      ]
    );
    auditCount += 1;
  }

  await pool.execute(
    `INSERT INTO access_control (id, global_login_ban, updated_at)
     VALUES (1, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE global_login_ban = VALUES(global_login_ban),
                             updated_at = VALUES(updated_at)`,
    [access.globalLoginBan ? 1 : 0]
  );

  console.log(
    `Migrated to MySQL (${cfg.host}/${cfg.database}): users=${userCount}, invites=${inviteCount}, resets=${resetCount}, audit=${auditCount}`
  );
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
