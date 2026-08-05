/**
 * Performance Baseline Helper
 * Provides utilities for managing and comparing performance baselines
 * @module baselineHelper
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config/config.js';

/**
 * Baseline storage path
 */
const BASELINE_DIR = join(process.cwd(), 'reports', 'baselines');

/**
 * Ensure baseline directory exists
 */
function ensureBaselineDir() {
  if (!existsSync(BASELINE_DIR)) {
    mkdirSync(BASELINE_DIR, { recursive: true });
  }
}

/**
 * Load baseline from file
 * @param {string} [environment] - Environment name
 * @returns {Object|null} Baseline data or null
 */
export function loadBaseline(environment = config.ENVIRONMENT) {
  const baselineFile = join(BASELINE_DIR, `baseline-${environment}.json`);

  if (!existsSync(baselineFile)) {
    return null;
  }

  try {
    const data = readFileSync(baselineFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error loading baseline: ${error.message}`);
    return null;
  }
}

/**
 * Save baseline to file
 * @param {Object} metrics - Metrics to save as baseline
 * @param {string} [environment] - Environment name
 * @returns {boolean} True if successful
 */
export function saveBaseline(metrics, environment = config.ENVIRONMENT) {
  try {
    ensureBaselineDir();

    const baseline = {
      environment,
      timestamp: new Date().toISOString(),
      metrics: {
        http_req_duration: {
          p50: metrics.http_req_duration?.values?.['p(50)'] || 0,
          p95: metrics.http_req_duration?.values?.['p(95)'] || 0,
          p99: metrics.http_req_duration?.values?.['p(99)'] || 0,
          avg: metrics.http_req_duration?.values?.avg || 0,
        },
        http_req_failed: {
          rate: metrics.http_req_failed?.values?.rate || 0,
        },
        http_reqs: {
          rate: metrics.http_reqs?.values?.rate || 0,
          count: metrics.http_reqs?.values?.count || 0,
        },
        iterations: {
          count: metrics.iterations?.values?.count || 0,
        },
      },
    };

    const baselineFile = join(BASELINE_DIR, `baseline-${environment}.json`);
    writeFileSync(baselineFile, JSON.stringify(baseline, null, 2), 'utf8');

    console.log(`✅ Baseline saved: ${baselineFile}`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving baseline: ${error.message}`);
    return false;
  }
}

/**
 * Compare current metrics with baseline
 * @param {Object} currentMetrics - Current test metrics
 * @param {Object} [baseline] - Baseline metrics (loads from file if not provided)
 * @param {number} [tolerance] - Tolerance percentage (default: 10%)
 * @returns {Object} Comparison results
 */
export function compareWithBaseline(currentMetrics, baseline = null, tolerance = 10) {
  const baselineData = baseline || loadBaseline();

  if (!baselineData) {
    return {
      hasBaseline: false,
      message: 'No baseline found for comparison',
    };
  }

  const comparison = {
    hasBaseline: true,
    baselineTimestamp: baselineData.timestamp,
    currentTimestamp: new Date().toISOString(),
    differences: {},
    regressions: [],
    improvements: [],
    status: 'stable',
  };

  // Compare response time (p95)
  const currentP95 = currentMetrics.http_req_duration?.values?.['p(95)'] || 0;
  const baselineP95 = baselineData.metrics.http_req_duration.p95 || 0;

  if (baselineP95 > 0) {
    const p95Diff = ((currentP95 - baselineP95) / baselineP95) * 100;
    comparison.differences.p95 = {
      current: currentP95,
      baseline: baselineP95,
      difference: p95Diff,
      status:
        Math.abs(p95Diff) <= tolerance ? 'stable' : p95Diff > 0 ? 'regression' : 'improvement',
    };

    if (p95Diff > tolerance) {
      comparison.regressions.push({
        metric: 'p95_response_time',
        current: currentP95,
        baseline: baselineP95,
        difference: `${p95Diff.toFixed(2)}%`,
      });
      comparison.status = 'regression';
    } else if (p95Diff < -tolerance) {
      comparison.improvements.push({
        metric: 'p95_response_time',
        current: currentP95,
        baseline: baselineP95,
        difference: `${Math.abs(p95Diff).toFixed(2)}%`,
      });
    }
  }

  // Compare error rate
  const currentErrorRate = (currentMetrics.http_req_failed?.values?.rate || 0) * 100;
  const baselineErrorRate = (baselineData.metrics.http_req_failed.rate || 0) * 100;

  if (baselineErrorRate >= 0) {
    const errorRateDiff = currentErrorRate - baselineErrorRate;
    comparison.differences.errorRate = {
      current: currentErrorRate,
      baseline: baselineErrorRate,
      difference: errorRateDiff,
      status:
        Math.abs(errorRateDiff) <= tolerance
          ? 'stable'
          : errorRateDiff > 0
            ? 'regression'
            : 'improvement',
    };

    if (errorRateDiff > tolerance) {
      comparison.regressions.push({
        metric: 'error_rate',
        current: `${currentErrorRate.toFixed(2)}%`,
        baseline: `${baselineErrorRate.toFixed(2)}%`,
        difference: `${errorRateDiff.toFixed(2)}%`,
      });
      comparison.status = 'regression';
    }
  }

  // Compare throughput
  const currentThroughput = currentMetrics.http_reqs?.values?.rate || 0;
  const baselineThroughput = baselineData.metrics.http_reqs.rate || 0;

  if (baselineThroughput > 0) {
    const throughputDiff = ((currentThroughput - baselineThroughput) / baselineThroughput) * 100;
    comparison.differences.throughput = {
      current: currentThroughput,
      baseline: baselineThroughput,
      difference: throughputDiff,
      status:
        Math.abs(throughputDiff) <= tolerance
          ? 'stable'
          : throughputDiff < 0
            ? 'regression'
            : 'improvement',
    };

    if (throughputDiff < -tolerance) {
      comparison.regressions.push({
        metric: 'throughput',
        current: currentThroughput,
        baseline: baselineThroughput,
        difference: `${throughputDiff.toFixed(2)}%`,
      });
      comparison.status = 'regression';
    }
  }

  return comparison;
}

/**
 * Generate baseline comparison report
 * @param {Object} comparison - Comparison results
 * @returns {string} Formatted report
 */
export function generateBaselineReport(comparison) {
  if (!comparison.hasBaseline) {
    return 'No baseline available for comparison';
  }

  let report = `\n📊 Performance Baseline Comparison\n`;
  report += `=====================================\n\n`;
  report += `Baseline Date: ${comparison.baselineTimestamp}\n`;
  report += `Current Date: ${comparison.currentTimestamp}\n`;
  report += `Status: ${comparison.status.toUpperCase()}\n\n`;

  if (comparison.regressions.length > 0) {
    report += `❌ Regressions Detected:\n`;
    comparison.regressions.forEach((reg) => {
      report += `   • ${reg.metric}: ${reg.current} (baseline: ${reg.baseline}, diff: ${reg.difference})\n`;
    });
    report += `\n`;
  }

  if (comparison.improvements.length > 0) {
    report += `✅ Improvements Detected:\n`;
    comparison.improvements.forEach((imp) => {
      report += `   • ${imp.metric}: ${imp.current} (baseline: ${imp.baseline}, diff: ${imp.difference})\n`;
    });
    report += `\n`;
  }

  if (comparison.regressions.length === 0 && comparison.improvements.length === 0) {
    report += `✅ Performance is stable (within tolerance)\n`;
  }

  return report;
}

export default {
  loadBaseline,
  saveBaseline,
  compareWithBaseline,
  generateBaselineReport,
};
