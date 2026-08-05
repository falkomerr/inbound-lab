/**
 * Response Validator Module
 * Provides comprehensive response validation utilities
 * @module responseValidator
 */

import { check } from 'k6';

/**
 * Validates HTTP response status
 * @param {Object} response - HTTP response object
 * @param {number|Array<number>} expectedStatus - Expected status code(s)
 * @returns {boolean} True if status matches
 */
export function validateStatus(response, expectedStatus) {
  if (Array.isArray(expectedStatus)) {
    return expectedStatus.includes(response.status);
  }
  return response.status === expectedStatus;
}

/**
 * Validates response time
 * @param {Object} response - HTTP response object
 * @param {number} maxDuration - Maximum duration in milliseconds
 * @returns {boolean} True if duration is within limit
 */
export function validateResponseTime(response, maxDuration) {
  return response.timings.duration < maxDuration;
}

/**
 * Validates JSON response structure
 * @param {Object} response - HTTP response object
 * @param {Object} schema - Expected schema
 * @returns {boolean} True if response matches schema
 */
export function validateJsonSchema(response, schema) {
  try {
    const body = JSON.parse(response.body);

    for (const [key, validator] of Object.entries(schema)) {
      if (!(key in body)) {
        console.warn(`⚠️ Schema validation: Missing required key "${key}"`);
        return false;
      }

      if (typeof validator === 'function') {
        if (!validator(body[key])) {
          console.warn(`⚠️ Schema validation: Custom validator failed for key "${key}"`);
          return false;
        }
      } else if (typeof validator === 'string') {
        // Type checking
        if (validator === 'array' && !Array.isArray(body[key])) {
          console.warn(
            `⚠️ Schema validation: Expected array for key "${key}", got ${typeof body[key]}`
          );
          return false;
        }
        if (validator === 'object' && typeof body[key] !== 'object') {
          console.warn(
            `⚠️ Schema validation: Expected object for key "${key}", got ${typeof body[key]}`
          );
          return false;
        }
        if (validator === 'string' && typeof body[key] !== 'string') {
          console.warn(
            `⚠️ Schema validation: Expected string for key "${key}", got ${typeof body[key]}`
          );
          return false;
        }
        if (validator === 'number' && typeof body[key] !== 'number') {
          console.warn(
            `⚠️ Schema validation: Expected number for key "${key}", got ${typeof body[key]}`
          );
          return false;
        }
        if (validator === 'boolean' && typeof body[key] !== 'boolean') {
          console.warn(
            `⚠️ Schema validation: Expected boolean for key "${key}", got ${typeof body[key]}`
          );
          return false;
        }
      } else if (typeof validator === 'object') {
        // Nested validation
        if (typeof body[key] !== 'object' || body[key] === null) {
          console.warn(`⚠️ Schema validation: Expected nested object for key "${key}"`);
          return false;
        }
        if (!validateJsonSchema({ body: JSON.stringify(body[key]) }, validator)) {
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    console.warn(`⚠️ JSON schema validation failed: ${error.message}`);
    return false;
  }
}

/**
 * Validates response headers
 * @param {Object} response - HTTP response object
 * @param {Object} expectedHeaders - Expected headers
 * @returns {boolean} True if headers match
 */
export function validateHeaders(response, expectedHeaders) {
  for (const [key, value] of Object.entries(expectedHeaders)) {
    const headerValue = response.headers[key.toLowerCase()];
    if (typeof value === 'function') {
      if (!value(headerValue)) {
        return false;
      }
    } else if (headerValue !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Validates response size
 * @param {Object} response - HTTP response object
 * @param {number} minSize - Minimum size in bytes
 * @param {number} maxSize - Maximum size in bytes
 * @returns {boolean} True if size is within range
 */
export function validateResponseSize(response, minSize = 0, maxSize = Infinity) {
  const size = response.body.length;
  return size >= minSize && size <= maxSize;
}

/**
 * Creates comprehensive response checks
 * @param {Object} response - HTTP response object
 * @param {Object} validations - Validation configuration
 * @returns {Object} Check results
 */
export function validateResponse(response, validations = {}) {
  const checks = {};

  // Status validation
  if (validations.status) {
    checks['status is valid'] = () => validateStatus(response, validations.status);
  }

  // Response time validation
  if (validations.maxDuration) {
    checks['response time is acceptable'] = () =>
      validateResponseTime(response, validations.maxDuration);
  }

  // JSON schema validation
  if (validations.schema) {
    checks['response matches schema'] = () => validateJsonSchema(response, validations.schema);
  }

  // Headers validation
  if (validations.headers) {
    checks['headers are valid'] = () => validateHeaders(response, validations.headers);
  }

  // Size validation
  if (validations.minSize || validations.maxSize) {
    checks['response size is valid'] = () =>
      validateResponseSize(response, validations.minSize, validations.maxSize);
  }

  // Custom validations
  if (validations.custom) {
    Object.assign(checks, validations.custom);
  }

  return check(response, checks);
}

/**
 * Validates API success response
 * @param {Object} response - HTTP response object
 * @returns {boolean} True if response indicates success
 */
export function validateSuccessResponse(response) {
  try {
    const body = JSON.parse(response.body);
    return body.success === true && body.data !== undefined;
  } catch (error) {
    console.warn(`⚠️ Failed to validate success response: ${error.message}`);
    return false;
  }
}

/**
 * Validates error response
 * @param {Object} response - HTTP response object
 * @param {number} expectedStatus - Expected error status code
 * @returns {boolean} True if error response is valid
 */
export function validateErrorResponse(response, expectedStatus = 400) {
  if (response.status !== expectedStatus) {
    return false;
  }

  try {
    const body = JSON.parse(response.body);
    return body.success === false && body.error !== undefined;
  } catch (error) {
    console.warn(`⚠️ Failed to validate error response: ${error.message}`);
    return false;
  }
}

export default {
  validateStatus,
  validateResponseTime,
  validateJsonSchema,
  validateHeaders,
  validateResponseSize,
  validateResponse,
  validateSuccessResponse,
  validateErrorResponse,
};
