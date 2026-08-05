/**
 * MySQL connection settings from environment.
 */

/**
 * @returns {{
 *   enabled: boolean,
 *   host: string,
 *   port: number,
 *   user: string,
 *   password: string,
 *   database: string,
 *   connectionLimit: number,
 * }}
 */
export function getMysqlConfig() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL || '';
  if (url && /^mysql:\/\//i.test(url)) {
    const parsed = new URL(url);
    return {
      enabled: true,
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username || 'root'),
      password: decodeURIComponent(parsed.password || ''),
      database: (parsed.pathname || '/loadtest').replace(/^\//, '') || 'loadtest',
      connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
    };
  }

  const host = process.env.MYSQL_HOST || '';
  if (!host) {
    return {
      enabled: false,
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
      database: 'loadtest',
      connectionLimit: 10,
    };
  }

  return {
    enabled: true,
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'loadtest',
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
  };
}

/**
 * Prefer MySQL when configured. Force JSON for isolated unit/integration tests
 * (B2B_TEST_DATA_DIR) or when STORAGE_BACKEND=json.
 */
export function useMysqlStorage() {
  const forced = (process.env.STORAGE_BACKEND || '').toLowerCase();
  if (forced === 'json') {
    return false;
  }
  if (forced === 'mysql') {
    return true;
  }
  if (process.env.B2B_TEST_DATA_DIR) {
    return false;
  }
  return getMysqlConfig().enabled;
}
