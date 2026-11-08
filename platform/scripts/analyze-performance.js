/**
 * Performance Analysis Script
 * Analyzes k6 test results and provides insights
 * @module analyze-performance
 */

import { readFileSync, existsSync } from 'fs';

/**
 * Analyze performance metrics from k6 results
 * @param {string} jsonPath - Path to JSON results file
 */
function analyzePerformance(jsonPath = 'reports/results.json') {
  try {
    if (!existsSync(jsonPath)) {
      console.error(`❌ Results file not found: ${jsonPath}`);
      process.exit(1);
    }

    const results = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const metrics = results.metrics || {};

    console.log('\n📊 Performance Analysis Report\n');
    console.log('='.repeat(60));

    // Analyze response times
    analyzeResponseTimes(metrics);

    // Analyze error rates
    analyzeErrorRates(metrics);

    // Analyze throughput
    analyzeThroughput(metrics);

    // Analyze system metrics
    analyzeSystemMetrics(metrics);

    // Provide recommendations
    provideRecommendations(metrics);

    console.log('='.repeat(60));
    console.log('\n✅ Analysis complete\n');
  } catch (error) {
    console.error(`❌ Error analyzing performance: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Analyze response time metrics
 * @param {Object} metrics - Metrics object
 */
function analyzeResponseTimes(metrics) {
  const httpReqDuration = metrics['http_req_duration'] || {};
  const values = httpReqDuration.values || {};

  console.log('\n⏱️  Response Time Analysis:');
  console.log(`   Average: ${(values.avg || 0).toFixed(2)}ms`);
  console.log(`   Min: ${(values.min || 0).toFixed(2)}ms`);
  console.log(`   Max: ${(values.max || 0).toFixed(2)}ms`);
  console.log(`   P95: ${(values['p(95)'] || 0).toFixed(2)}ms`);
  console.log(`   P99: ${(values['p(99)'] || 0).toFixed(2)}ms`);

  // Performance assessment
  const p95 = values['p(95)'] || 0;
  if (p95 < 1000) {
    console.log('   ✅ Excellent: P95 < 1s');
  } else if (p95 < 2000) {
    console.log('   ✅ Good: P95 < 2s');
  } else if (p95 < 5000) {
    console.log('   ⚠️  Warning: P95 > 2s, consider optimization');
  } else {
    console.log('   ❌ Critical: P95 > 5s, immediate action required');
  }
}

/**
 * Analyze error rates
 * @param {Object} metrics - Metrics object
 */
function analyzeErrorRates(metrics) {
  const httpReqFailed = metrics['http_req_failed'] || {};
  const values = httpReqFailed.values || {};
  const errorRate = (values.rate || 0) * 100;

  console.log('\n❌ Error Rate Analysis:');
  console.log(`   Error Rate: ${errorRate.toFixed(2)}%`);
  console.log(`   Total Errors: ${values.passes || 0}`);
  console.log(`   Total Requests: ${values.count || 0}`);

  // Error assessment
  if (errorRate < 0.1) {
    console.log('   ✅ Excellent: Error rate < 0.1%');
  } else if (errorRate < 1) {
    console.log('   ✅ Good: Error rate < 1%');
  } else if (errorRate < 5) {
    console.log('   ⚠️  Warning: Error rate > 1%, investigate failures');
  } else {
    console.log('   ❌ Critical: Error rate > 5%, system may be unstable');
  }
}

/**
 * Analyze throughput
 * @param {Object} metrics - Metrics object
 */
function analyzeThroughput(metrics) {
  const httpReqs = metrics['http_reqs'] || {};
  const values = httpReqs.values || {};
  const rate = values.rate || 0;

  console.log('\n🚀 Throughput Analysis:');
  console.log(`   Request Rate: ${rate.toFixed(2)} req/s`);
  console.log(`   Total Requests: ${values.count || 0}`);

  // Throughput assessment
  if (rate > 500) {
    console.log('   ✅ Excellent: > 500 req/s');
  } else if (rate > 100) {
    console.log('   ✅ Good: > 100 req/s');
  } else if (rate > 50) {
    console.log('   ⚠️  Warning: < 100 req/s, may need optimization');
  } else {
    console.log('   ❌ Critical: < 50 req/s, significant performance issues');
  }
}

/**
 * Analyze system metrics
 * @param {Object} metrics - Metrics object
 */
function analyzeSystemMetrics(metrics) {
  const vus = metrics['vus'] || {};
  const iterations = metrics['iterations'] || {};
  const dataReceived = metrics['data_received'] || {};
  const dataSent = metrics['data_sent'] || {};

  console.log('\n💻 System Metrics:');
  console.log(`   Max VUs: ${vus.values?.max || 0}`);
  console.log(`   Total Iterations: ${iterations.values?.count || 0}`);
  console.log(
    `   Data Received: ${((dataReceived.values?.count || 0) / 1024 / 1024).toFixed(2)} MB`
  );
  console.log(`   Data Sent: ${((dataSent.values?.count || 0) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Data Rate: ${((dataReceived.values?.rate || 0) / 1024).toFixed(2)} KB/s`);
}

/**
 * Provide recommendations based on metrics
 * @param {Object} metrics - Metrics object
 */
function provideRecommendations(metrics) {
  console.log('\n💡 Recommendations:');

  const httpReqDuration = metrics['http_req_duration'] || {};
  const httpReqFailed = metrics['http_req_failed'] || {};
  const httpReqs = metrics['http_reqs'] || {};

  const p95 = httpReqDuration.values?.['p(95)'] || 0;
  const errorRate = (httpReqFailed.values?.rate || 0) * 100;
  const throughput = httpReqs.values?.rate || 0;

  const recommendations = [];

  if (p95 > 2000) {
    recommendations.push('   • Optimize response times: P95 > 2s detected');
    recommendations.push('   • Consider caching, database optimization, or CDN');
  }

  if (errorRate > 1) {
    recommendations.push('   • Investigate error rate: > 1% errors detected');
    recommendations.push('   • Check server logs, database connections, and API health');
  }

  if (throughput < 100) {
    recommendations.push('   • Improve throughput: < 100 req/s detected');
    recommendations.push('   • Consider horizontal scaling or performance optimization');
  }

  if (recommendations.length === 0) {
    console.log('   ✅ No critical issues detected. System performance is good!');
  } else {
    recommendations.forEach((rec) => console.log(rec));
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const jsonPath = process.argv[2] || 'reports/results.json';
  analyzePerformance(jsonPath);
}

export { analyzePerformance };
