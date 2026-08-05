/**
 * Shared mysql2 connection pool.
 */

import mysql from 'mysql2/promise';
import { getMysqlConfig } from './config.js';

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

export function getPool() {
  if (!pool) {
    const cfg = getMysqlConfig();
    if (!cfg.enabled) {
      throw new Error('MySQL is not configured (set MYSQL_HOST or MYSQL_URL)');
    }
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: cfg.connectionLimit,
      namedPlaceholders: true,
      dateStrings: false,
      timezone: 'Z',
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Lightweight connectivity check for health probes. */
export async function pingPool() {
  const p = getPool();
  const [rows] = await p.query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}
