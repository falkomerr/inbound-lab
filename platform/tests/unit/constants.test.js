/**
 * Unit tests for constants module
 * @module tests/unit/constants
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as constants from '../../utils/constants.js';

describe('Constants Module', () => {
  describe('PERFORMANCE_THRESHOLDS', () => {
    it('should have valid performance threshold values', () => {
      const { PERFORMANCE_THRESHOLDS } = constants;

      assert.strictEqual(typeof PERFORMANCE_THRESHOLDS.SLOW_REQUEST_MS, 'number');
      assert.strictEqual(typeof PERFORMANCE_THRESHOLDS.FAST_REQUEST_MS, 'number');
      assert.ok(PERFORMANCE_THRESHOLDS.SLOW_REQUEST_MS > PERFORMANCE_THRESHOLDS.FAST_REQUEST_MS);
    });
  });

  describe('ERROR_THRESHOLDS', () => {
    it('should have valid error rate thresholds', () => {
      const { ERROR_THRESHOLDS } = constants;

      assert.ok(ERROR_THRESHOLDS.MAX_ERROR_RATE >= 0 && ERROR_THRESHOLDS.MAX_ERROR_RATE <= 1);
      assert.ok(ERROR_THRESHOLDS.MAX_STRESS_ERROR_RATE > ERROR_THRESHOLDS.MAX_ERROR_RATE);
      assert.ok(ERROR_THRESHOLDS.MAX_SPIKE_ERROR_RATE > ERROR_THRESHOLDS.MAX_STRESS_ERROR_RATE);
    });
  });

  describe('TEST_LIMITS', () => {
    it('should have valid test limits', () => {
      const { TEST_LIMITS } = constants;

      assert.ok(TEST_LIMITS.MAX_VUS > TEST_LIMITS.MIN_VUS);
      assert.ok(TEST_LIMITS.MAX_VUS === 1000);
      assert.ok(TEST_LIMITS.MIN_VUS === 1);
      assert.ok(TEST_LIMITS.MAX_WEBSOCKET_SUBSCRIBERS > 0);
      assert.ok(TEST_LIMITS.MAX_TEST_HISTORY > 0);
    });
  });

  describe('HTTP_STATUS', () => {
    it('should have valid HTTP status codes', () => {
      const { HTTP_STATUS } = constants;

      assert.strictEqual(HTTP_STATUS.OK, 200);
      assert.strictEqual(HTTP_STATUS.BAD_REQUEST, 400);
      assert.strictEqual(HTTP_STATUS.SERVER_ERROR, 500);
    });
  });

  describe('TEST_TYPES', () => {
    it('should have valid test types', () => {
      const { TEST_TYPES } = constants;

      assert.ok(TEST_TYPES.SMOKE);
      assert.ok(TEST_TYPES.LOAD);
      assert.ok(TEST_TYPES.STRESS);
      assert.strictEqual(typeof TEST_TYPES.SMOKE, 'string');
    });
  });

  describe('ENVIRONMENTS', () => {
    it('should have valid environment types', () => {
      const { ENVIRONMENTS } = constants;

      assert.strictEqual(ENVIRONMENTS.STAGING, 'staging');
      assert.strictEqual(ENVIRONMENTS.PRODUCTION, 'production');
      assert.deepStrictEqual(Object.keys(ENVIRONMENTS).sort(), ['PRODUCTION', 'STAGING']);
    });
  });
});
