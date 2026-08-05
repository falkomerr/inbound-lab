/**
 * Report retention unit tests
 * @module tests/unit/reportRetention
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getReportRetentionConfig,
  deleteReportFilesForTestId,
  compactOversizedNdjsonFiles,
  cleanupReports,
} from '../../server/reportRetention.js';

describe('reportRetention', () => {
  /** @type {string} */
  let reportsDir;

  before(() => {
    reportsDir = mkdtempSync(join(tmpdir(), 'b2b-reports-ret-'));
    process.env.REPORT_MAX_AGE_DAYS = '7';
    process.env.REPORT_MAX_TOTAL_MB = '1';
    process.env.REPORT_MAX_FILE_MB = '1';
  });

  after(() => {
    rmSync(reportsDir, { recursive: true, force: true });
    delete process.env.REPORT_MAX_AGE_DAYS;
    delete process.env.REPORT_MAX_TOTAL_MB;
    delete process.env.REPORT_MAX_FILE_MB;
  });

  it('getReportRetentionConfig reads env with sane floors', () => {
    const cfg = getReportRetentionConfig();
    assert.equal(cfg.maxAgeDays, 7);
    assert.equal(cfg.maxTotalMb, 50);
    assert.equal(cfg.maxFileMb, 10);
  });

  it('deleteReportFilesForTestId removes main, summary, and resume segments', () => {
    writeFileSync(join(reportsDir, 'run-1.json'), '{}');
    writeFileSync(join(reportsDir, 'run-1-summary.json'), '{}');
    writeFileSync(join(reportsDir, 'run-1-r1.json'), '{}');
    const removed = deleteReportFilesForTestId(reportsDir, 'run-1');
    assert.equal(removed, 3);
    assert.equal(existsSync(join(reportsDir, 'run-1.json')), false);
  });

  it('compactOversizedNdjsonFiles removes large NDJSON but keeps summaries', () => {
    const bigPath = join(reportsDir, 'big-run.json');
    const summaryPath = join(reportsDir, 'big-run-summary.json');
    writeFileSync(bigPath, 'x'.repeat(2 * 1024 * 1024));
    writeFileSync(summaryPath, '{}');
    const { removed, freedBytes } = compactOversizedNdjsonFiles(reportsDir, 1024);
    assert.equal(removed, 1);
    assert.ok(freedBytes > 0);
    assert.equal(existsSync(summaryPath), true);
  });

  it('cleanupReports deletes files older than maxAgeDays', () => {
    const oldPath = join(reportsDir, 'stale-test.json');
    writeFileSync(oldPath, '{}');
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    utimesSync(oldPath, tenDaysAgo / 1000, tenDaysAgo / 1000);
    const { deletedCount } = cleanupReports(reportsDir);
    assert.ok(deletedCount >= 1);
    assert.equal(existsSync(oldPath), false);
  });

  it('cleanupReports respects protectIds for age-based deletion', () => {
    const protectedPath = join(reportsDir, 'active-run.json');
    writeFileSync(protectedPath, '{}');
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    utimesSync(protectedPath, tenDaysAgo / 1000, tenDaysAgo / 1000);
    cleanupReports(reportsDir, { protectIds: ['active-run'] });
    assert.equal(existsSync(protectedPath), true);
  });

  it('cleanupReports leaves recent files when under age and size thresholds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'b2b-reports-ok-'));
    try {
      writeFileSync(join(dir, 'fresh-a.json'), '{}');
      writeFileSync(join(dir, 'fresh-b.json'), '{}');
      const { deletedCount } = cleanupReports(dir);
      assert.equal(deletedCount, 0);
      assert.equal(existsSync(join(dir, 'fresh-a.json')), true);
      assert.equal(existsSync(join(dir, 'fresh-b.json')), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
