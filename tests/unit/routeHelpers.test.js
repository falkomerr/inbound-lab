/**
 * Route helper unit tests
 * @module tests/unit/routeHelpers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePasswordStrength,
  safeError,
  checkLimits,
  createPausedExclusiveHelpers,
} from '../../server/routes/helpers/routeHelpers.js';

describe('routeHelpers', () => {
  describe('validatePasswordStrength', () => {
    it('accepts strong passwords', () => {
      assert.equal(validatePasswordStrength('Secret1!'), null);
    });

    it('rejects short or weak passwords', () => {
      assert.match(validatePasswordStrength('short'), /8 characters/);
      assert.match(validatePasswordStrength('alllower1!'), /uppercase/);
      assert.match(validatePasswordStrength('NoDigits!'), /digit/);
      assert.match(validatePasswordStrength('NoSpecial1'), /special/);
    });
  });

  describe('safeError', () => {
    it('hides stack traces and file paths', () => {
      const err = new Error('ENOENT: no such file at /secret/path.js:12');
      assert.equal(safeError(err), 'An error occurred');
      assert.equal(safeError(new Error('Username already exists')), 'Username already exists');
    });
  });

  describe('checkLimits', () => {
    it('enforces VU and duration caps for limited users', () => {
      const user = {
        role: 'developer',
        limits: { enabled: true, maxVus: 10, maxDurationMinutes: 5 },
      };
      assert.match(checkLimits(user, { vus: 20 }), /VU limit/);
      assert.match(checkLimits(user, { duration: '10m' }), /duration limit/);
      assert.equal(checkLimits(user, { vus: 5, duration: '3m' }), null);
      assert.equal(checkLimits({ role: 'admin', limits: { enabled: true } }, { vus: 500 }), null);
    });
  });

  describe('createPausedExclusiveHelpers', () => {
    it('blocks non-privileged users during fresh pause window', () => {
      const { pausedExclusiveBlockMessage } = createPausedExclusiveHelpers();
      const status = {
        running: false,
        pausedForResume: true,
        endTime: new Date().toISOString(),
      };
      const msg = pausedExclusiveBlockMessage({ role: 'developer' }, status);
      assert.ok(msg);
      assert.equal(pausedExclusiveBlockMessage({ role: 'admin' }, status), null);
    });
  });
});
