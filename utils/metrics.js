/**
 * Metrics Management Module
 * Provides centralized metrics tracking and reporting
 * @module metrics
 */

import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import { PERFORMANCE_THRESHOLDS } from './constants.js';

/**
 * Custom metrics for load testing
 */
export const customMetrics = {
  // Response time metrics
  apiResponseTime: new Trend('api_response_time', true),
  cartOperationTime: new Trend('cart_operation_time', true),
  authOperationTime: new Trend('auth_operation_time', true),

  // Error metrics
  errorRate: new Rate('errors'),
  errorCount: new Counter('error_count'),
  timeoutCount: new Counter('timeout_count'),

  // Business metrics
  successfulOperations: new Counter('successful_operations'),
  failedOperations: new Counter('failed_operations'),
  throughput: new Counter('throughput'),

  // Performance metrics
  slowRequests: new Counter('slow_requests'),
  fastRequests: new Counter('fast_requests'),

  // Data metrics
  dataVolume: new Counter('data_volume'),
  requestSize: new Trend('request_size', true),
  responseSize: new Trend('response_size', true),

  // System metrics
  vusActive: new Gauge('vus_active'),
  vusMax: new Gauge('vus_max'),
  iterationDuration: new Trend('iteration_duration', true),
};

/**
 * Track API response time
 * @param {number} duration - Duration in milliseconds
 * @param {Object} tags - Optional tags
 */
export function trackResponseTime(duration, tags = {}) {
  customMetrics.apiResponseTime.add(duration, tags);

  // Track slow/fast requests using defined thresholds
  if (duration > PERFORMANCE_THRESHOLDS.SLOW_REQUEST_MS) {
    customMetrics.slowRequests.add(1, tags);
  } else if (duration < PERFORMANCE_THRESHOLDS.FAST_REQUEST_MS) {
    customMetrics.fastRequests.add(1, tags);
  }
}

/**
 * Track error
 * @param {boolean} isError - Whether an error occurred
 * @param {Object} tags - Optional tags
 */
export function trackError(isError, tags = {}) {
  if (isError) {
    customMetrics.errorRate.add(1, tags);
    customMetrics.errorCount.add(1, tags);
    customMetrics.failedOperations.add(1, tags);
  } else {
    customMetrics.successfulOperations.add(1, tags);
  }
}

/**
 * Track timeout
 * @param {Object} tags - Optional tags
 */
export function trackTimeout(tags = {}) {
  customMetrics.timeoutCount.add(1, tags);
  customMetrics.errorRate.add(1, tags);
}

/**
 * Track operation duration
 * @param {string} operation - Operation name
 * @param {number} duration - Duration in milliseconds
 * @param {Object} tags - Optional tags
 */
export function trackOperation(operation, duration, tags = {}) {
  const operationTags = { ...tags, operation };

  switch (operation) {
    case 'cart':
      customMetrics.cartOperationTime.add(duration, operationTags);
      break;
    case 'auth':
      customMetrics.authOperationTime.add(duration, operationTags);
      break;
    default:
      customMetrics.apiResponseTime.add(duration, operationTags);
  }

  customMetrics.iterationDuration.add(duration, operationTags);
}

/**
 * Track data volume
 * @param {number} size - Size in bytes
 * @param {string} type - 'request' or 'response'
 * @param {Object} tags - Optional tags
 */
export function trackDataVolume(size, type = 'response', tags = {}) {
  customMetrics.dataVolume.add(size, { ...tags, type });

  if (type === 'request') {
    customMetrics.requestSize.add(size, tags);
  } else {
    customMetrics.responseSize.add(size, tags);
  }
}

/**
 * Track throughput
 * @param {number} count - Number of requests
 * @param {Object} tags - Optional tags
 */
export function trackThroughput(count = 1, tags = {}) {
  customMetrics.throughput.add(count, tags);
}

/**
 * Update VU metrics
 * @param {number} active - Active VUs
 * @param {number} max - Max VUs
 */
export function updateVUMetrics(active, max) {
  customMetrics.vusActive.add(active);
  customMetrics.vusMax.add(max);
}

/**
 * Get metrics summary
 * @returns {Object} Metrics summary
 */
export function getMetricsSummary() {
  return {
    responseTime: {
      api: customMetrics.apiResponseTime,
      cart: customMetrics.cartOperationTime,
      auth: customMetrics.authOperationTime,
    },
    errors: {
      rate: customMetrics.errorRate,
      count: customMetrics.errorCount,
      timeouts: customMetrics.timeoutCount,
    },
    operations: {
      successful: customMetrics.successfulOperations,
      failed: customMetrics.failedOperations,
      throughput: customMetrics.throughput,
    },
    performance: {
      slow: customMetrics.slowRequests,
      fast: customMetrics.fastRequests,
      iteration: customMetrics.iterationDuration,
    },
    data: {
      volume: customMetrics.dataVolume,
      requestSize: customMetrics.requestSize,
      responseSize: customMetrics.responseSize,
    },
    system: {
      vusActive: customMetrics.vusActive,
      vusMax: customMetrics.vusMax,
    },
  };
}

export default customMetrics;
