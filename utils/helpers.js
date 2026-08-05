/**
 * Helper Utilities Module
 * Provides common utility functions for load tests
 * @module helpers
 */

import { config } from '../config/config.js';
import { sleep } from 'k6';
import {
  generateRandomString,
  randomInt,
  formatDuration,
  calculatePercentile,
  validateResponse,
} from './pureHelpers.js';

export { generateRandomString, randomInt, formatDuration, calculatePercentile, validateResponse };

/**
 * Random think time to simulate real user behavior
 * @param {number} [min=config.MIN_THINK_TIME] - Minimum think time in ms
 * @param {number} [max=config.MAX_THINK_TIME] - Maximum think time in ms
 */
export function randomThinkTime(min = config.MIN_THINK_TIME, max = config.MAX_THINK_TIME) {
  const thinkTime = Math.floor(Math.random() * (max - min + 1)) + min;
  sleep(thinkTime / 1000);
}

/**
 * Sleep for specified duration
 * @param {number} ms - Duration in milliseconds
 */
export function sleepMs(ms) {
  sleep(ms / 1000);
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise} Function result
 */
export function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        sleep(delay / 1000);
      }
    }
  }
  throw lastError;
}

/**
 * Rate limiter
 * @param {number} requestsPerSecond - Maximum requests per second
 * @returns {Function} Rate limiter function
 */
export function createRateLimiter(requestsPerSecond) {
  let lastRequestTime = 0;
  const minInterval = 1000 / requestsPerSecond;

  return function rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      sleep(waitTime / 1000);
    }

    lastRequestTime = Date.now();
  };
}

export default {
  randomThinkTime,
  sleepMs,
  generateRandomString,
  randomInt,
  formatDuration,
  calculatePercentile,
  retryWithBackoff,
  createRateLimiter,
  validateResponse,
};
