/**
 * InfluxDB Integration Helper
 * Provides utilities for sending k6 metrics to InfluxDB
 * @module influxdbHelper
 */

/**
 * InfluxDB configuration
 */
const influxdbConfig = {
  url: __ENV.INFLUXDB_URL || 'http://localhost:8086',
  database: __ENV.INFLUXDB_DATABASE || 'k6',
  username: __ENV.INFLUXDB_USERNAME || '',
  password: __ENV.INFLUXDB_PASSWORD || '',
  retentionPolicy: __ENV.INFLUXDB_RETENTION_POLICY || 'autogen',
  precision: __ENV.INFLUXDB_PRECISION || 'ns',
};

/**
 * Validate InfluxDB configuration
 * @returns {boolean} True if configuration is valid
 */
export function validateInfluxdbConfig() {
  if (!influxdbConfig.url) {
    console.warn('⚠️ InfluxDB URL not configured');
    return false;
  }

  if (!influxdbConfig.database) {
    console.warn('⚠️ InfluxDB database not configured');
    return false;
  }

  return true;
}

/**
 * Get InfluxDB connection string
 * @returns {string} InfluxDB connection string
 */
export function getInfluxdbConnectionString() {
  const { url, database, username, password, retentionPolicy, precision } = influxdbConfig;

  let connectionString = `${url}/${database}`;

  if (retentionPolicy) {
    connectionString += `/${retentionPolicy}`;
  }

  if (precision) {
    connectionString += `?precision=${precision}`;
  }

  if (username && password) {
    const auth = `${username}:${password}@`;
    connectionString = connectionString.replace('://', `://${auth}`);
  }

  return connectionString;
}

/**
 * Create InfluxDB query for metrics
 * @param {string} measurement - Measurement name
 * @param {Object} [tags] - Tags to filter by
 * @param {string} [timeRange] - Time range (e.g., '1h', '24h')
 * @returns {string} InfluxDB query
 */
export function createInfluxdbQuery(measurement, tags = {}, timeRange = '1h') {
  let query = `SELECT * FROM "${measurement}"`;

  const tagConditions = Object.entries(tags)
    .map(([key, value]) => `"${key}"='${value}'`)
    .join(' AND ');

  if (tagConditions) {
    query += ` WHERE ${tagConditions}`;
  }

  query += ` AND time >= now() - ${timeRange}`;

  return query;
}

/**
 * Get InfluxDB dashboard URL
 * @returns {string} Dashboard URL
 */
export function getInfluxdbDashboardUrl() {
  return `${influxdbConfig.url.replace('/:8086', '')}/chronograf/v1/dashboards`;
}

export default {
  validateInfluxdbConfig,
  getInfluxdbConnectionString,
  createInfluxdbQuery,
  getInfluxdbDashboardUrl,
  config: influxdbConfig,
};
