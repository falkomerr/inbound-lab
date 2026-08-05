/**
 * Pure helper utility unit tests (no k6 runtime)
 * @module tests/unit/helpers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  calculatePercentile,
  generateRandomString,
  randomInt,
  validateResponse,
} from '../../utils/pureHelpers.js';

describe('helpers', () => {
  describe('formatDuration', () => {
    it('formats sub-second, second, minute, and hour ranges', () => {
      assert.equal(formatDuration(250), '250ms');
      assert.equal(formatDuration(1500), '1.50s');
      assert.equal(formatDuration(90_000), '1.50m');
      assert.equal(formatDuration(7_200_000), '2.00h');
    });
  });

  describe('calculatePercentile', () => {
    it('returns correct percentile for sorted input', () => {
      const values = [10, 20, 30, 40, 50];
      assert.equal(calculatePercentile(values, 50), 30);
      assert.equal(calculatePercentile(values, 100), 50);
    });

    it('returns 0 for empty input', () => {
      assert.equal(calculatePercentile([], 50), 0);
    });
  });

  describe('generateRandomString', () => {
    it('returns string of requested length using alphanumeric charset', () => {
      const s = generateRandomString(16);
      assert.equal(s.length, 16);
      assert.match(s, /^[A-Za-z0-9]+$/);
    });
  });

  describe('randomInt', () => {
    it('returns integers within inclusive bounds', () => {
      for (let i = 0; i < 50; i += 1) {
        const n = randomInt(5, 10);
        assert.ok(n >= 5 && n <= 10);
      }
    });
  });

  describe('validateResponse', () => {
    it('validates JSON body against a simple schema', () => {
      const ok = validateResponse(
        { body: JSON.stringify({ id: 1, name: 'x' }) },
        {
          id: 'number',
          name: 'string',
        }
      );
      assert.equal(ok, true);

      const bad = validateResponse({ body: JSON.stringify({ id: '1' }) }, { id: 'number' });
      assert.equal(bad, false);

      const missing = validateResponse({ body: JSON.stringify({}) }, { id: 'number' });
      assert.equal(missing, false);
    });

    it('returns false for invalid JSON', () => {
      assert.equal(validateResponse({ body: 'not-json' }, { id: 'number' }), false);
    });
  });
});
