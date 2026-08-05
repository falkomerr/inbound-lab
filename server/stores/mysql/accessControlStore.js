/**
 * MySQL-backed global login ban flag.
 */

import { getPool } from '../../db/pool.js';

export async function getGlobalLoginBan() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT global_login_ban FROM access_control WHERE id = 1 LIMIT 1`
  );
  return Boolean(rows[0]?.global_login_ban);
}

/** @returns {Promise<boolean>} new value */
export async function setGlobalLoginBan(enabled) {
  const pool = getPool();
  const value = Boolean(enabled);
  await pool.execute(
    `INSERT INTO access_control (id, global_login_ban, updated_at)
     VALUES (1, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE global_login_ban = VALUES(global_login_ban),
                             updated_at = VALUES(updated_at)`,
    [value ? 1 : 0]
  );
  return value;
}
