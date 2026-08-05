/**
 * Performance Analyzer Module
 * Provides advanced performance analysis utilities
 * @module performanceAnalyzer
 */

/**
 * Analyze response time distribution
 * @param {Array<number>} responseTimes - Array of response times
 * @returns {Object} Distribution analysis
 */
export function analyzeResponseTimeDistribution(responseTimes) {
  if (!responseTimes || responseTimes.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      median: 0,
      p95: 0,
      p99: 0,
      stdDev: 0,
    };
  }

  const sorted = [...responseTimes].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const median = sorted[Math.floor(count / 2)];
  const p95 = sorted[Math.floor(count * 0.95)];
  const p99 = sorted[Math.floor(count * 0.99)];

  // Calculate standard deviation
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    min,
    max,
    avg,
    median,
    p95,
    p99,
    stdDev,
  };
}

/**
 * Detect performance anomalies
 * @param {Array<number>} responseTimes - Array of response times
 * @param {number} threshold - Threshold for anomaly detection (default: 3 standard deviations)
 * @returns {Array<Object>} Array of anomalies
 */
export function detectAnomalies(responseTimes, threshold = 3) {
  if (!responseTimes || responseTimes.length === 0) {
    return [];
  }

  const distribution = analyzeResponseTimeDistribution(responseTimes);
  const anomalies = [];
  const upperBound = distribution.avg + threshold * distribution.stdDev;

  responseTimes.forEach((time, index) => {
    if (time > upperBound) {
      anomalies.push({
        index,
        value: time,
        deviation: time - distribution.avg,
        severity: time > distribution.p99 ? 'critical' : 'warning',
      });
    }
  });

  return anomalies;
}

/**
 * Calculate throughput efficiency
 * @param {number} requestRate - Request rate (req/s)
 * @param {number} avgResponseTime - Average response time (ms)
 * @returns {Object} Throughput efficiency metrics
 */
export function calculateThroughputEfficiency(requestRate, avgResponseTime) {
  const theoreticalMax = 1000 / avgResponseTime; // Theoretical max requests per second
  const efficiency = (requestRate / theoreticalMax) * 100;

  return {
    requestRate,
    avgResponseTime,
    theoreticalMax: theoreticalMax.toFixed(2),
    efficiency: efficiency.toFixed(2),
    status:
      efficiency > 80 ? 'excellent' : efficiency > 60 ? 'good' : efficiency > 40 ? 'fair' : 'poor',
  };
}

/**
 * Analyze error patterns
 * @param {Array<Object>} errors - Array of error objects
 * @returns {Object} Error pattern analysis
 */
export function analyzeErrorPatterns(errors) {
  if (!errors || errors.length === 0) {
    return {
      total: 0,
      byType: {},
      byEndpoint: {},
      byStatus: {},
      mostCommon: null,
    };
  }

  const byType = {};
  const byEndpoint = {};
  const byStatus = {};

  errors.forEach((error) => {
    // Count by type
    const type = error.type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;

    // Count by endpoint
    const endpoint = error.endpoint || 'unknown';
    byEndpoint[endpoint] = (byEndpoint[endpoint] || 0) + 1;

    // Count by status
    const status = error.status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  });

  // Find most common error
  const mostCommon = Object.entries(byType).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    total: errors.length,
    byType,
    byEndpoint,
    byStatus,
    mostCommon: mostCommon ? { type: mostCommon[0], count: mostCommon[1] } : null,
  };
}

/**
 * Calculate performance score
 * @param {Object} metrics - Performance metrics
 * @returns {Object} Performance score
 */
export function calculatePerformanceScore(metrics) {
  const {
    p95ResponseTime = 0,
    errorRate = 0,
    throughput = 0,
    p95Threshold = 2000,
    errorThreshold = 0.01,
    throughputThreshold = 100,
  } = metrics;

  // Response time score (0-40 points)
  const responseTimeScore =
    p95ResponseTime < p95Threshold
      ? 40 - (p95ResponseTime / p95Threshold) * 20
      : Math.max(0, 20 - ((p95ResponseTime - p95Threshold) / p95Threshold) * 20);

  // Error rate score (0-30 points)
  const errorScore =
    errorRate < errorThreshold
      ? 30 - (errorRate / errorThreshold) * 15
      : Math.max(0, 15 - ((errorRate - errorThreshold) / errorThreshold) * 15);

  // Throughput score (0-30 points)
  const throughputScore =
    throughput > throughputThreshold ? 30 : (throughput / throughputThreshold) * 30;

  const totalScore = responseTimeScore + errorScore + throughputScore;

  return {
    total: Math.round(totalScore),
    responseTime: Math.round(responseTimeScore),
    errorRate: Math.round(errorScore),
    throughput: Math.round(throughputScore),
    grade:
      totalScore >= 90
        ? 'A'
        : totalScore >= 80
          ? 'B'
          : totalScore >= 70
            ? 'C'
            : totalScore >= 60
              ? 'D'
              : 'F',
  };
}

/**
 * Generate performance insights
 * @param {Object} metrics - Performance metrics
 * @returns {Array<string>} Array of insights
 */
export function generateInsights(metrics) {
  const insights = [];
  const { p95ResponseTime, errorRate, throughput, anomalies } = metrics;

  // Response time insights
  if (p95ResponseTime > 5000) {
    insights.push('⚠️ Critical: P95 response time exceeds 5s. Immediate optimization required.');
  } else if (p95ResponseTime > 2000) {
    insights.push('⚠️ Warning: P95 response time exceeds 2s. Consider optimization.');
  } else {
    insights.push('✅ Good: Response times are within acceptable range.');
  }

  // Error rate insights
  if (errorRate > 0.05) {
    insights.push('❌ Critical: Error rate exceeds 5%. System may be unstable.');
  } else if (errorRate > 0.01) {
    insights.push('⚠️ Warning: Error rate exceeds 1%. Investigate failures.');
  } else {
    insights.push('✅ Good: Error rate is within acceptable range.');
  }

  // Throughput insights
  if (throughput < 50) {
    insights.push('⚠️ Warning: Throughput is low. Consider scaling or optimization.');
  } else if (throughput > 200) {
    insights.push('✅ Excellent: High throughput achieved.');
  } else {
    insights.push('✅ Good: Throughput is within acceptable range.');
  }

  // Anomaly insights
  if (anomalies && anomalies.length > 0) {
    const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical').length;
    if (criticalAnomalies > 0) {
      insights.push(`⚠️ Warning: ${criticalAnomalies} critical performance anomalies detected.`);
    }
  }

  return insights;
}

export default {
  analyzeResponseTimeDistribution,
  detectAnomalies,
  calculateThroughputEfficiency,
  analyzeErrorPatterns,
  calculatePerformanceScore,
  generateInsights,
};
