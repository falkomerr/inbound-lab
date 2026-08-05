/**
 * Storage backend bootstrap.
 */

import { getMysqlConfig, useMysqlStorage } from './config.js';
import { closePool, getPool, pingPool } from './pool.js';
import { migrate } from './migrate.js';

export { getMysqlConfig, useMysqlStorage, closePool, getPool, pingPool, migrate };

/**
 * Connect + migrate when MySQL storage is active.
 * No-op for JSON backend.
 */
export async function initStorage() {
  if (!useMysqlStorage()) {
    return { backend: 'json' };
  }
  const cfg = getMysqlConfig();
  getPool();
  await migrate();
  return {
    backend: 'mysql',
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
  };
}
