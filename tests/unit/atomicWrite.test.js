/**
 * Atomic JSON writer unit tests
 * @module tests/unit/atomicWrite
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { atomicWriteJSON } from '../../server/utils/atomicWrite.js';

describe('atomicWriteJSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b2b-atomic-write-'));
  const filePath = join(dir, 'nested', 'data.json');

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates parent directories and writes pretty JSON', () => {
    const payload = { hello: 'world', count: 2 };
    atomicWriteJSON(filePath, payload);

    assert.ok(existsSync(filePath));
    assert.equal(existsSync(`${filePath}.tmp`), false);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert.deepEqual(parsed, payload);
  });

  it('overwrites existing file atomically', () => {
    atomicWriteJSON(filePath, { version: 1 });
    atomicWriteJSON(filePath, { version: 2 });
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert.equal(parsed.version, 2);
  });
});
