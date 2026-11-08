/**
 * Load Test Configuration Module
 * Provides centralized configuration for k6 load tests
 * @module config
 */

// Detect if we're running in k6 or Node.js environment
// In k6, __ENV is a global object; in Node.js, it's undefined
const isK6 = typeof __ENV !== 'undefined';

// Helper function to get environment variable - works in both k6 and Node.js
function getEnvVar(name, defaultValue = undefined) {
  if (isK6 && typeof __ENV !== 'undefined') {
    return __ENV[name] !== undefined ? __ENV[name] : defaultValue;
  }
  // Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] !== undefined ? process.env[name] : defaultValue;
  }
  return defaultValue;
}

// Environment validation
const validEnvironments = ['staging', 'production'];
const currentEnv = getEnvVar('ENV', 'staging');

if (!validEnvironments.includes(currentEnv)) {
  throw new Error(`Invalid ENV: ${currentEnv}. Must be one of: ${validEnvironments.join(', ')}`);
}

/**
 * Environment-specific base URLs (placeholders — override with BASE_URL in .env)
 */
const baseUrls = {
  staging: 'http://127.0.0.1:18081',
  production: 'http://127.0.0.1:18081',
};

/**
 * Environment-specific test users (placeholders — override via env)
 */
const testUsers = {
  staging: {
    phone: getEnvVar('TEST_USER_PHONE', '15550000001'),
    mobileFormat: getEnvVar('TEST_USER_MOBILE', '5550000001'),
    email: getEnvVar('TEST_USER_EMAIL', 'loadtest@example.com'),
  },
  production: {
    phone: getEnvVar('TEST_USER_PHONE', '15550000001'),
    mobileFormat: getEnvVar('TEST_USER_MOBILE', '5550000001'),
    email: getEnvVar('TEST_USER_EMAIL', 'loadtest@example.com'),
  },
};

/**
 * Main configuration object
 */
export const config = {
  ENVIRONMENT: currentEnv,
  BASE_URL: getEnvVar('BASE_URL', baseUrls[currentEnv] || baseUrls.staging),

  TEST_USER: {
    phone: getEnvVar('TEST_USER_PHONE', testUsers[currentEnv].phone),
    mobileFormat: getEnvVar('TEST_USER_MOBILE', testUsers[currentEnv].mobileFormat),
    email: getEnvVar('TEST_USER_EMAIL', testUsers[currentEnv].email),
  },

  API_TIMEOUT: parseInt(getEnvVar('API_TIMEOUT', '30000'), 10),
  MAX_REDIRECTS: parseInt(getEnvVar('MAX_REDIRECTS', '10'), 10),

  VUS: parseInt(getEnvVar('VUS', '10'), 10),
  DURATION: getEnvVar('DURATION', '30s'),
  RAMP_UP_TIME: getEnvVar('RAMP_UP_TIME', '10s'),
  RAMP_DOWN_TIME: getEnvVar('RAMP_DOWN_TIME', '10s'),

  THRESHOLDS: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>1'],
    iteration_duration: ['p(95)<5000'],
  },

  RETRY_ATTEMPTS: parseInt(getEnvVar('RETRY_ATTEMPTS', '3'), 10),
  RETRY_DELAY: parseInt(getEnvVar('RETRY_DELAY', '1000'), 10),

  MIN_THINK_TIME: parseInt(getEnvVar('MIN_THINK_TIME', '1000'), 10),
  MAX_THINK_TIME: parseInt(getEnvVar('MAX_THINK_TIME', '3000'), 10),

  RATE_LIMIT_ENABLED: getEnvVar('RATE_LIMIT_ENABLED', 'false') === 'true',
  RATE_LIMIT_RPS: parseInt(getEnvVar('RATE_LIMIT_RPS', '100'), 10),

  REPORT_FORMAT: getEnvVar('REPORT_FORMAT', 'json'),
  REPORT_PATH: getEnvVar('REPORT_PATH', 'reports/'),

  ENABLE_METRICS: getEnvVar('ENABLE_METRICS', 'true') !== 'false',
  METRICS_INTERVAL: parseInt(getEnvVar('METRICS_INTERVAL', '1000'), 10),

  ENABLE_SSL_VERIFY: getEnvVar('ENABLE_SSL_VERIFY', 'true') !== 'false',
  TLS_VERSION: getEnvVar('TLS_VERSION', '1.2'),

  ENABLE_HTTP2: getEnvVar('ENABLE_HTTP2', 'false') === 'true',

  TAGS: {
    environment: currentEnv,
    testType: getEnvVar('TEST_TYPE', 'load'),
    service: 'api',
  },
};

/**
 * Validate configuration
 */
export function validateConfig() {
  const requiredFields = ['BASE_URL', 'TEST_USER'];
  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Missing required configuration: ${field}`);
    }
  }

  const numericFields = ['API_TIMEOUT', 'VUS', 'RETRY_ATTEMPTS', 'RETRY_DELAY'];
  for (const field of numericFields) {
    if (isNaN(config[field]) || config[field] < 0) {
      throw new Error(`Invalid numeric configuration for ${field}: ${config[field]}`);
    }
  }

  if (!config.THRESHOLDS || Object.keys(config.THRESHOLDS).length === 0) {
    console.warn('⚠️ No thresholds configured, tests may not fail on performance issues');
  }

  return true;
}

/**
 * Get environment-specific configuration
 * @param {string} env - Environment name
 * @returns {Object} Environment-specific config
 */
export function getEnvironmentConfig(env) {
  return {
    BASE_URL: getEnvVar('BASE_URL', baseUrls[env] || baseUrls.staging),
    TEST_USER: testUsers[env] || testUsers.staging,
  };
}

validateConfig();

export default config;
