#!/usr/bin/env node

/**
 * Save Baseline Script
 * Saves current test results as performance baseline
 * @module save-baseline
 */

import { readFileSync, existsSync } from 'fs';
import { saveBaseline } from '../utils/baselineHelper.js';

/**
 * Save baseline from test results
 * @param {string} resultsPath - Path to test results JSON file
 * @param {string} [environment] - Environment name
 */
function savePerformanceBaseline(resultsPath = 'reports/results.json', environment = null) {
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
    const success = saveBaseline(metrics, env);

    if (success) {
      console.log(`✅ Performance baseline saved for ${env} environment`);
      console.log(`📊 Baseline includes:`);
      console.log(`   • Response times (p50, p95, p99, avg)`);
      console.log(`   • Error rate`);
      console.log(`   • Throughput`);
      console.log(`   • Total requests`);
      console.log(`\n💡 Use this baseline for future comparisons`);
    } else {
      console.error('❌ Failed to save baseline');
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error saving baseline: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const resultsPath = process.argv[2] || 'reports/results.json';
  const environment = process.argv[3] || null;
  savePerformanceBaseline(resultsPath, environment);
}

export { savePerformanceBaseline };
