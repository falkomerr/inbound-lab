/**
 * Report file retention — prevents unbounded growth under reports/.
 * @module server/reportRetention
 */

import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

/**
 * @returns {{ maxAgeDays: number, maxTotalMb: number, maxFileMb: number }}
 */
export function getReportRetentionConfig() {
  const maxAgeDays = Math.max(1, parseInt(process.env.REPORT_MAX_AGE_DAYS || '14', 10) || 14);
  const maxTotalMb = Math.max(50, parseInt(process.env.REPORT_MAX_TOTAL_MB || '2048', 10) || 2048);
  const maxFileMb = Math.max(10, parseInt(process.env.REPORT_MAX_FILE_MB || '200', 10) || 200);
  return { maxAgeDays, maxTotalMb, maxFileMb };
}

function listReportJsonFiles(reportsDir) {
  if (!existsSync(reportsDir)) {
    return [];
  }
  try {
    return readdirSync(reportsDir)
      .filter((name) => name.endsWith('.json') && name !== '.gitkeep')
      .map((name) => join(reportsDir, name));
  } catch {
    return [];
  }
}

/**
 * Remove NDJSON/summary files for a logical test id (main + resume segments).
 */
export function deleteReportFilesForTestId(reportsDir, testId) {
  if (!testId || !existsSync(reportsDir)) {
    return 0;
  }
  let removed = 0;
  const candidates = [
    join(reportsDir, `${testId}.json`),
    join(reportsDir, `${testId}-summary.json`),
  ];
  let i = 1;
  while (i < 32) {
    candidates.push(join(reportsDir, `${testId}-r${i}.json`));
    i += 1;
  }
  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      unlinkSync(filePath);
      removed += 1;
    } catch (err) {
      logger.warn({ err, event: 'report_delete_failed', filePath }, 'report_delete_failed');
    }
  }
  return removed;
}

/**
 * Delete NDJSON files larger than the configured per-file cap (metrics already in history).
 */
export function compactOversizedNdjsonFiles(reportsDir, maxFileBytes) {
  if (!maxFileBytes || !existsSync(reportsDir)) {
    return { removed: 0, freedBytes: 0 };
  }
  let removed = 0;
  let freedBytes = 0;
  for (const filePath of listReportJsonFiles(reportsDir)) {
    if (filePath.endsWith('-summary.json')) {
      continue;
    }
    try {
      const { size } = statSync(filePath);
      if (size > maxFileBytes) {
        unlinkSync(filePath);
        removed += 1;
        freedBytes += size;
        logger.info(
          { event: 'report_oversized_removed', filePath, sizeMb: Number((size / 1e6).toFixed(1)) },
          'report_oversized_removed'
        );
      }
    } catch {
      /* skip */
    }
  }
  return { removed, freedBytes };
}

/**
 * Age-based and total-size retention for reports/.
 * @param {string} reportsDir
 * @param {{ protectIds?: string[] }} [opts] — logical test ids to keep even when old (active history)
 */
export function cleanupReports(reportsDir, opts = {}) {
  const { maxAgeDays, maxTotalMb } = getReportRetentionConfig();
  const protect = new Set(opts.protectIds || []);
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const maxTotalBytes = maxTotalMb * 1024 * 1024;
  const now = Date.now();

  const entries = [];
  for (const filePath of listReportJsonFiles(reportsDir)) {
    try {
      const st = statSync(filePath);
      const base = filePath.split(/[/\\]/).pop() || '';
      const logicalId = base
        .replace(/-summary\.json$/, '')
        .replace(/\.json$/, '')
        .replace(/-r\d+$/, '');
      entries.push({ filePath, size: st.size, mtime: st.mtimeMs, logicalId });
    } catch {
      /* skip */
    }
  }

  let deletedCount = 0;
  let freedBytes = 0;

  for (const entry of entries) {
    if (protect.has(entry.logicalId)) {
      continue;
    }
    if (now - entry.mtime > maxAgeMs) {
      try {
        unlinkSync(entry.filePath);
        deletedCount += 1;
        freedBytes += entry.size;
      } catch (err) {
        logger.warn(
          { err, event: 'report_age_delete_failed', filePath: entry.filePath },
          'report_age_delete_failed'
        );
      }
    }
  }

  const remaining = [];
  for (const filePath of listReportJsonFiles(reportsDir)) {
    try {
      const st = statSync(filePath);
      remaining.push({ filePath, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* skip */
    }
  }

  let total = remaining.reduce((sum, e) => sum + e.size, 0);
  if (total > maxTotalBytes) {
    remaining.sort((a, b) => a.mtime - b.mtime);
    for (const entry of remaining) {
      if (total <= maxTotalBytes) {
        break;
      }
      try {
        unlinkSync(entry.filePath);
        deletedCount += 1;
        freedBytes += entry.size;
        total -= entry.size;
      } catch (err) {
        logger.warn(
          { err, event: 'report_size_cap_delete_failed', filePath: entry.filePath },
          'report_size_cap_delete_failed'
        );
      }
    }
  }

  if (deletedCount > 0) {
    logger.info(
      {
        event: 'report_cleanup_done',
        deletedCount,
        freedMb: Number((freedBytes / 1e6).toFixed(1)),
      },
      'report_cleanup_done'
    );
  }

  return { deletedCount, freedBytes };
}
