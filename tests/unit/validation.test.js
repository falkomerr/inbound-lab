/**
 * Unit tests for validation middleware
 * @module tests/unit/validation
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
  validateStartTest,
  validateUpdateLoad,
  validateHistoryQuery,
  validateTestId,
  sanitizeBody,
} from '../../server/middleware/validation.js';

describe('Validation Middleware', () => {
  describe('validateUpdateLoad', () => {
    it('should pass for valid vus and duration', () => {
      const req = { body: { vus: 20, duration: '3m' } };
      const res = { status: mock.fn(() => res), json: mock.fn() };
      const next = mock.fn();
      validateUpdateLoad(req, res, next);
      assert.strictEqual(next.mock.calls.length, 1);
      assert.strictEqual(req.body.vus, 20);
    });

    it('should pass when only duration is sent', () => {
      const req = { body: { duration: '1m' } };
      const res = { status: mock.fn(() => res), json: mock.fn() };
      const next = mock.fn();
      validateUpdateLoad(req, res, next);
      assert.strictEqual(next.mock.calls.length, 1);
      assert.strictEqual(req.body.duration, '1m');
    });

    it('should pass when only vus is sent', () => {
      const req = { body: { vus: 15 } };
      const res = { status: mock.fn(() => res), json: mock.fn() };
      const next = mock.fn();
      validateUpdateLoad(req, res, next);
      assert.strictEqual(next.mock.calls.length, 1);
      assert.strictEqual(req.body.vus, 15);
    });

    it('should fail when both vus and duration are missing', () => {
      const req = { body: {} };
      const res = { status: mock.fn(() => res), json: mock.fn() };
      const next = mock.fn();
      validateUpdateLoad(req, res, next);
      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
    });
  });

  describe('validateStartTest', () => {
    it('should pass validation for valid test start request', () => {
      const req = {
        body: {
          testId: 'load',
          options: {
            environment: 'staging',
            vus: 10,
            duration: '5m',
          },
        },
      };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateStartTest(req, res, next);

      assert.strictEqual(next.mock.calls.length, 1);
      assert.strictEqual(res.status.mock.calls.length, 0);
    });

    it('should fail validation for missing testId', () => {
      const req = { body: {} };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateStartTest(req, res, next);

      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls.length, 1);
      assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
    });

    it('should fail validation for invalid VUs', () => {
      const req = {
        body: {
          testId: 'load',
          options: {
            vus: 5000, // exceeds MAX_VUS
          },
        },
      };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateStartTest(req, res, next);

      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls.length, 1);
    });

    it('should fail validation for invalid duration format', () => {
      const req = {
        body: {
          testId: 'load',
          options: {
            duration: 'invalid',
          },
        },
      };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateStartTest(req, res, next);

      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls.length, 1);
    });

    it('should fail validation for invalid environment', () => {
      const req = {
        body: {
          testId: 'load',
          options: {
            environment: 'development',
          },
        },
      };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateStartTest(req, res, next);

      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls.length, 1);
      assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
    });
  });

  describe('validateHistoryQuery', () => {
    it('should pass validation for valid limit', () => {
      const req = { query: { limit: '25' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateHistoryQuery(req, res, next);

      assert.strictEqual(next.mock.calls.length, 1);
      assert.strictEqual(req.query.limit, 25);
    });

    it('should fail validation for invalid limit', () => {
      const req = { query: { limit: '10000' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateHistoryQuery(req, res, next);

      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls.length, 1);
    });
  });

  describe('validateTestId', () => {
    it('should pass validation for valid testId', () => {
      const req = { params: { testId: 'load-1234567890' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateTestId(req, res, next);

      assert.strictEqual(next.mock.calls.length, 1);
    });

    it('should fail validation for invalid characters', () => {
      const req = { params: { testId: 'load@test#123' } };
      const res = {
        status: mock.fn(() => res),
        json: mock.fn(),
      };
      const next = mock.fn();

      validateTestId(req, res, next);

      assert.strictEqual(next.mock.calls.length, 0);
      assert.strictEqual(res.status.mock.calls.length, 1);
    });
  });

  describe('sanitizeBody', () => {
    it('should strip null bytes and C0 control characters from strings', () => {
      const req = {
        body: {
          testId: `lo\x00ad`,
          note: 'a\x1b\x7Fb',
        },
      };
      const res = {};
      const next = mock.fn();

      sanitizeBody(req, res, next);

      assert.strictEqual(req.body.testId, 'load');
      assert.strictEqual(req.body.note, 'ab');
      assert.strictEqual(next.mock.calls.length, 1);
    });

    it('should not strip HTML or angle brackets (JSON API + CSP; avoids corrupting payloads)', () => {
      const req = {
        body: {
          testId: '<script>alert("xss")</script>load',
          name: 'javascript:alert(1)',
        },
      };
      const res = {};
      const next = mock.fn();

      sanitizeBody(req, res, next);

      assert.strictEqual(req.body.testId, '<script>alert("xss")</script>load');
      assert.strictEqual(req.body.name, 'javascript:alert(1)');
      assert.strictEqual(next.mock.calls.length, 1);
    });

    it('should sanitize nested objects and arrays', () => {
      const req = {
        body: {
          options: {
            customEnv: {
              KEY: 'va\x00lue',
            },
            tags: ['ok\x01', { nested: 'x\x7F' }],
          },
        },
      };
      const res = {};
      const next = mock.fn();

      sanitizeBody(req, res, next);

      assert.strictEqual(req.body.options.customEnv.KEY, 'value');
      assert.strictEqual(req.body.options.tags[0], 'ok');
      assert.strictEqual(req.body.options.tags[1].nested, 'x');
      assert.strictEqual(next.mock.calls.length, 1);
    });
  });
});
