/**
 * Create / upgrade MySQL schema for users, invites, resets, audit, access control.
 */

import { getPool } from './pool.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(128) NOT NULL,
    email VARCHAR(255) NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'developer',
    token_version INT NOT NULL DEFAULT 1,
    banned TINYINT(1) NOT NULL DEFAULT 0,
    permissions_json JSON NOT NULL,
    limits_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_users_username (username),
    UNIQUE KEY uk_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS invites (
    token CHAR(64) NOT NULL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'developer',
    permissions_json JSON NOT NULL,
    limits_json JSON NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used TINYINT(1) NOT NULL DEFAULT 0,
    used_at DATETIME(3) NULL,
    KEY idx_invites_email (email),
    KEY idx_invites_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS password_resets (
    token CHAR(64) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    username VARCHAR(128) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    KEY idx_resets_user (user_id),
    CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id CHAR(36) NOT NULL PRIMARY KEY,
    created_at DATETIME(3) NOT NULL,
    type VARCHAR(64) NOT NULL,
    username VARCHAR(128) NULL,
    payload JSON NOT NULL,
    KEY idx_audit_created (created_at),
    KEY idx_audit_type (type),
    KEY idx_audit_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS access_control (
    id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
    global_login_ban TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function migrate() {
  const pool = getPool();
  for (const sql of STATEMENTS) {
    // eslint-disable-next-line no-await-in-loop -- sequential DDL is intentional
    await pool.query(sql);
  }
  // Ensure singleton access-control row exists
  await pool.query(
    `INSERT IGNORE INTO access_control (id, global_login_ban, updated_at)
     VALUES (1, 0, UTC_TIMESTAMP(3))`
  );
}
