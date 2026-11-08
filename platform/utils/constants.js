/**
 * Constants Module
 * Centralized constants for the load testing framework
 * @module constants
 */

/**
 * Performance thresholds (milliseconds)
 */
export const PERFORMANCE_THRESHOLDS = {
  SLOW_REQUEST_MS: 5000,
  FAST_REQUEST_MS: 500,
  ACCEPTABLE_RESPONSE_MS: 2000,
  MAX_RESPONSE_MS: 5000,
  HEALTH_CHECK_MS: 1000,
};

/**
 * Error rate thresholds (percentage)
 */
export const ERROR_THRESHOLDS = {
  MAX_ERROR_RATE: 0.01, // 1%
  MAX_STRESS_ERROR_RATE: 0.05, // 5%
  MAX_SPIKE_ERROR_RATE: 0.1, // 10%
};

/**
 * Data volume thresholds (bytes)
 */
export const DATA_THRESHOLDS = {
  MIN_DATA_RATE: 50000, // 50KB/s
  NORMAL_DATA_RATE: 100000, // 100KB/s
  HIGH_DATA_RATE: 200000, // 200KB/s
  VERY_HIGH_DATA_RATE: 500000, // 500KB/s
};

/**
 * Request rate thresholds (requests per second)
 */
export const REQUEST_RATE_THRESHOLDS = {
  MIN_SMOKE_RPS: 50,
  MIN_LOAD_RPS: 100,
  MIN_STRESS_RPS: 200,
  MIN_SPIKE_RPS: 300,
};

/**
 * Test limits and boundaries
 */
export const TEST_LIMITS = {
  MAX_VUS: 1000,
  MIN_VUS: 1,
  MAX_DURATION_HOURS: 24,
  MAX_RETRY_ATTEMPTS: 5,
  MIN_RETRY_DELAY_MS: 100,
  MAX_RETRY_DELAY_MS: 10000,
  MAX_WEBSOCKET_SUBSCRIBERS: 100,
  MAX_TEST_HISTORY: 50,
  MAX_OUTPUT_LINES: 1000,
  /** Lines of k6 console output stored on each history row for UI rehydrate after refresh/restart */
  MAX_HISTORY_OUTPUT_SNAPSHOT: 400,
  MAX_METRIC_VALUES: 10000,
  /** Stop reading full NDJSON into memory beyond this size; tail-read instead */
  MAX_REPORT_FILE_BYTES: 200 * 1024 * 1024,
  /** Bytes read per metrics tick when the NDJSON file exceeds MAX_REPORT_FILE_BYTES */
  MAX_REPORT_TAIL_READ_BYTES: 2 * 1024 * 1024,
  /** Max bytes of NDJSON parsed for final history merge on very large files */
  MAX_REPORT_PARSE_BYTES: 50 * 1024 * 1024,
};

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Test types
 */
export const TEST_TYPES = {
  SMOKE: 'smoke',
  LOAD: 'load',
  STRESS: 'stress',
  SPIKE: 'spike',
  SOAK: 'soak',
  VOLUME: 'volume',
  WEBSOCKET: 'websocket',
  GRPC: 'grpc',
  BROWSER: 'browser',
};

/**
 * Environment types
 */
export const ENVIRONMENTS = {
  STAGING: 'staging',
  PRODUCTION: 'production',
};

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  HEALTH: '/health',
  LOGIN: '/auth/login',
  VERIFY: '/auth/verify',
  CART: '/cart',
  CART_ADD: '/cart/add',
  ADDRESSES: '/addresses',
};

/**
 * Metric names
 */
export const METRIC_NAMES = {
  API_RESPONSE_TIME: 'api_response_time',
  CART_OPERATION_TIME: 'cart_operation_time',
  AUTH_OPERATION_TIME: 'auth_operation_time',
  ERROR_RATE: 'errors',
  ERROR_COUNT: 'error_count',
  TIMEOUT_COUNT: 'timeout_count',
  SUCCESSFUL_OPERATIONS: 'successful_operations',
  FAILED_OPERATIONS: 'failed_operations',
  THROUGHPUT: 'throughput',
  SLOW_REQUESTS: 'slow_requests',
  FAST_REQUESTS: 'fast_requests',
  DATA_VOLUME: 'data_volume',
  REQUEST_SIZE: 'request_size',
  RESPONSE_SIZE: 'response_size',
  VUS_ACTIVE: 'vus_active',
  VUS_MAX: 'vus_max',
  ITERATION_DURATION: 'iteration_duration',
};

export default {
  PERFORMANCE_THRESHOLDS,
  ERROR_THRESHOLDS,
  DATA_THRESHOLDS,
  REQUEST_RATE_THRESHOLDS,
  TEST_LIMITS,
  HTTP_STATUS,
  TEST_TYPES,
  ENVIRONMENTS,
  API_ENDPOINTS,
  METRIC_NAMES,
};
