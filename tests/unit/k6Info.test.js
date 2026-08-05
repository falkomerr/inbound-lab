import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getK6Info, resetK6InfoCache } from '../../server/k6Info.js';

describe('k6Info', () => {
  beforeEach(() => {
    resetK6InfoCache();
    delete process.env.K6_VERSION;
  });

  it('returns structured info without throwing when k6 is missing', async () => {
    process.env.K6_BIN = 'k6-definitely-not-installed-xyz';
    const info = await getK6Info();
    assert.equal(info.bin, 'k6-definitely-not-installed-xyz');
    assert.equal(info.version, null);
    assert.equal(info.source, 'unavailable');
    delete process.env.K6_BIN;
  });

  it('falls back to K6_VERSION env when binary is unavailable', async () => {
    process.env.K6_BIN = 'k6-definitely-not-installed-xyz';
    process.env.K6_VERSION = '1.8.0';
    const info = await getK6Info();
    assert.equal(info.version, '1.8.0');
    assert.equal(info.source, 'env');
    delete process.env.K6_BIN;
    delete process.env.K6_VERSION;
  });
});
