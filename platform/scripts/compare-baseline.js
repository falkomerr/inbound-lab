#!/usr/bin/env node

/**
 * Compare Baseline Script
 * Compares current test results with saved baseline
 * @module compare-baseline
 */

import { readFileSync, existsSync } from 'fs';
import {
  compareWithBaseline,
  generateBaselineReport,
  loadBaseline,
} from '../utils/baselineHelper.js';

/**
 * Compare current results with baseline
 * @param {string} resultsPath - Path to test results JSON file
 * @param {string} [environment] - Environment name
 * @param {number} [tolerance] - Tolerance percentage
 */
function comparePerformanceBaseline(
  resultsPath = 'reports/results.json',
  environment = null,
  tolerance = 10
) {
  try {
    if (!existsSync(resultsPath)) {
      console.error(`❌ Results file not found: ${resultsPath}`);
      console.log('💡 Run a test first to generate results: npm run test:load');
      process.exit(1);
    }

    const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const metrics = results.metrics || {};

    if (Object.keys(metrics).length === 0) {
      console.error('❌ No metrics found in results file');
      process.exit(1);
    }

    const env = environment || process.env.ENV || 'staging';
    const comparison = compareWithBaseline(metrics, loadBaseline(env), tolerance);

    if (!comparison.hasBaseline) {
      console.log('⚠️  No baseline found for comparison');
      console.log(`💡 Create a baseline first: npm run baseline:save`);
      process.exit(0);
    }

    const report = generateBaselineReport(comparison);
    console.log(report);

    // Exit with error code if regression detected
    if (comparison.status === 'regression') {
      console.log('\n❌ Performance regression detected!');
      process.exit(1);
    } else {
      console.log('\n✅ Performance is stable');
      process.exit(0);
    }
  } catch (error) {
    console.error(`❌ Error comparing baseline: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const resultsPath = process.argv[2] || 'reports/results.json';
  const environment = process.argv[3] || null;
  const tolerance = parseFloat(process.argv[4]) || 10;
  comparePerformanceBaseline(resultsPath, environment, tolerance);
}

export { comparePerformanceBaseline };
