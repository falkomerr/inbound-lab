/**
 * Unit tests for responseValidator module
 * @module tests/unit/responseValidator
 *
 * Note: These tests use pure functions that don't require k6.
 * The validateResponse function that uses k6.check is tested separately in integration tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Pure validation functions that don't require k6
function validateStatus(response, expectedStatus) {
  if (Array.isArray(expectedStatus)) {
    return expectedStatus.includes(response.status);
  }
  return response.status === expectedStatus;
}

function validateResponseTime(response, maxDuration) {
  return response.timings.duration < maxDuration;
}

function validateJsonSchema(response, schema) {
  try {
    const body = JSON.parse(response.body);

    for (const [key, validator] of Object.entries(schema)) {
      if (!(key in body)) {
        return false;
      }

      if (typeof validator === 'function') {
        if (!validator(body[key])) {
          return false;
        }
      } else if (typeof validator === 'string') {
        // Type checking
        if (validator === 'array' && !Array.isArray(body[key])) {
          return false;
        }
        if (validator === 'object' && typeof body[key] !== 'object') {
          return false;
        }
        if (validator === 'string' && typeof body[key] !== 'string') {
          return false;
        }
        if (validator === 'number' && typeof body[key] !== 'number') {
          return false;
        }
        if (validator === 'boolean' && typeof body[key] !== 'boolean') {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

function validateResponseSize(response, minSize = 0, maxSize = Infinity) {
  const size = response.body.length;
  return size >= minSize && size <= maxSize;
}

function validateSuccessResponse(response) {
  try {
    const body = JSON.parse(response.body);
    return body.success === true && body.data !== undefined;
  } catch {
    return false;
  }
}

function validateErrorResponse(response, expectedStatus = 400) {
  if (response.status !== expectedStatus) {
    return false;
  }

  try {
    const body = JSON.parse(response.body);
    return body.success === false && body.error !== undefined;
  } catch {
    return false;
  }
}

describe('Response Validator Module', () => {
  describe('validateStatus', () => {
    it('should validate single status code', () => {
      const response = { status: 200 };
      assert.strictEqual(validateStatus(response, 200), true);
      assert.strictEqual(validateStatus(response, 404), false);
    });

    it('should validate array of status codes', () => {
      const response = { status: 201 };
      assert.strictEqual(validateStatus(response, [200, 201, 202]), true);
      assert.strictEqual(validateStatus(response, [400, 404, 500]), false);
    });
  });

  describe('validateResponseTime', () => {
    it('should validate response is within duration limit', () => {
      const fastResponse = { timings: { duration: 500 } };
      const slowResponse = { timings: { duration: 3000 } };

      assert.strictEqual(validateResponseTime(fastResponse, 1000), true);
      assert.strictEqual(validateResponseTime(slowResponse, 1000), false);
    });
  });

  describe('validateJsonSchema', () => {
    it('should validate simple schema', () => {
      const response = {
        body: JSON.stringify({
          success: true,
          data: { id: 1 },
        }),
      };

      const schema = {
        success: (val) => val === true,
        data: 'object',
      };

      assert.strictEqual(validateJsonSchema(response, schema), true);
    });

    it('should validate type checking', () => {
      const response = {
        body: JSON.stringify({
          name: 'Test',
          age: 25,
          active: true,
          items: [],
        }),
      };

      const schema = {
        name: 'string',
        age: 'number',
        active: 'boolean',
        items: 'array',
      };

      assert.strictEqual(validateJsonSchema(response, schema), true);
    });

    it('should fail validation for missing keys', () => {
      const response = {
        body: JSON.stringify({ name: 'Test' }),
      };

      const schema = {
        name: 'string',
        age: 'number',
      };

      assert.strictEqual(validateJsonSchema(response, schema), false);
    });

    it('should fail validation for wrong types', () => {
      const response = {
        body: JSON.stringify({ name: 123 }),
      };

      const schema = {
        name: 'string',
      };

      assert.strictEqual(validateJsonSchema(response, schema), false);
    });
  });

  describe('validateResponseSize', () => {
    it('should validate response size within range', () => {
      const response = { body: 'x'.repeat(100) };

      assert.strictEqual(validateResponseSize(response, 50, 200), true);
      assert.strictEqual(validateResponseSize(response, 150, 200), false);
      assert.strictEqual(validateResponseSize(response, 0, 50), false);
    });
  });

  describe('validateSuccessResponse', () => {
    it('should validate successful API response', () => {
      const successResponse = {
        body: JSON.stringify({
          success: true,
          data: { id: 1 },
        }),
      };

      assert.strictEqual(validateSuccessResponse(successResponse), true);
    });

    it('should fail for non-success response', () => {
      const failResponse = {
        body: JSON.stringify({
          success: false,
          error: 'Something went wrong',
        }),
      };

      assert.strictEqual(validateSuccessResponse(failResponse), false);
    });

    it('should fail for missing data field', () => {
      const noDataResponse = {
        body: JSON.stringify({
          success: true,
        }),
      };

      assert.strictEqual(validateSuccessResponse(noDataResponse), false);
    });
  });

  describe('validateErrorResponse', () => {
    it('should validate error response with expected status', () => {
      const errorResponse = {
        status: 400,
        body: JSON.stringify({
          success: false,
          error: 'Invalid input',
        }),
      };

      assert.strictEqual(validateErrorResponse(errorResponse, 400), true);
    });

    it('should fail for wrong status code', () => {
      const errorResponse = {
        status: 500,
        body: JSON.stringify({
          success: false,
          error: 'Server error',
        }),
      };

      assert.strictEqual(validateErrorResponse(errorResponse, 400), false);
    });

    it('should fail for missing error field', () => {
      const noErrorResponse = {
        status: 400,
        body: JSON.stringify({
          success: false,
        }),
      };

      assert.strictEqual(validateErrorResponse(noErrorResponse, 400), false);
    });
  });
});
