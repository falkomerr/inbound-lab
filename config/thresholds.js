/**
 * Thresholds Configuration Module
 * Defines performance thresholds for different test scenarios
 * @module thresholds
 */

/**
 * Smoke test thresholds (light load validation)
 */
export const smokeThresholds = {
  http_req_duration: ['p(95)<1000', 'p(99)<2000'], // Very fast for smoke test
  http_req_failed: ['rate<0.01'], // < 1% errors
  http_reqs: ['rate>50'], // Minimum 50 req/s
  iteration_duration: ['p(95)<3000'],
  data_received: ['rate>50000'], // 50KB/s minimum
  data_sent: ['rate>5000'], // 5KB/s minimum
};

/**
 * Load test thresholds (normal expected load)
 */
export const loadThresholds = {
  http_req_duration: ['p(95)<2000', 'p(99)<5000'], // 95% < 2s, 99% < 5s
  http_req_failed: ['rate<0.01'], // < 1% errors
  http_reqs: ['rate>100'], // > 100 req/s
  iteration_duration: ['p(95)<5000'],
  data_received: ['rate>100000'], // 100KB/s
  data_sent: ['rate>10000'], // 10KB/s
  vus: ['value>0'], // At least 1 VU running
};

/**
 * Stress test thresholds (high load, may have higher latency)
 */
export const stressThresholds = {
  http_req_duration: ['p(95)<5000', 'p(99)<10000'], // Higher tolerance
  http_req_failed: ['rate<0.05'], // < 5% errors (higher tolerance)
  http_reqs: ['rate>200'], // > 200 req/s
  iteration_duration: ['p(95)<10000'],
  data_received: ['rate>200000'], // 200KB/s
  data_sent: ['rate>20000'], // 20KB/s
};

/**
 * Spike test thresholds (sudden load increase)
 */
export const spikeThresholds = {
  http_req_duration: ['p(95)<10000', 'p(99)<20000'], // Very high tolerance
  http_req_failed: ['rate<0.10'], // < 10% errors (spikes can cause issues)
  http_reqs: ['rate>300'], // > 300 req/s
  iteration_duration: ['p(95)<15000'],
  data_received: ['rate>300000'], // 300KB/s
  data_sent: ['rate>30000'], // 30KB/s
};

/**
 * Soak test thresholds (long duration, stability focus)
 */
export const soakThresholds = {
  http_req_duration: ['p(95)<3000', 'p(99)<6000'], // Stable performance
  http_req_failed: ['rate<0.01'], // < 1% errors (must be stable)
  http_reqs: ['rate>80'], // Consistent rate
  iteration_duration: ['p(95)<6000'],
  data_received: ['rate>80000'], // Stable data rate
  data_sent: ['rate>8000'], // Stable send rate
  http_req_connecting: ['avg<100'], // Connection time < 100ms
  http_req_waiting: ['avg<2000'], // Wait time < 2s
};

/**
 * Volume test thresholds (high data volume)
 */
export const volumeThresholds = {
  http_req_duration: ['p(95)<4000', 'p(99)<8000'],
  http_req_failed: ['rate<0.02'], // < 2% errors
  http_reqs: ['rate>150'], // > 150 req/s
  iteration_duration: ['p(95)<8000'],
  data_received: ['rate>500000'], // High data volume (500KB/s)
  data_sent: ['rate>50000'], // High send volume (50KB/s)
};

/**
 * Get thresholds for test type
 * @param {string} testType - Type of test (smoke, load, stress, spike, soak, volume)
 * @returns {Object} Thresholds configuration
 */
export function getThresholds(testType) {
  const thresholdsMap = {
    smoke: smokeThresholds,
    load: loadThresholds,
    stress: stressThresholds,
    spike: spikeThresholds,
    soak: soakThresholds,
    volume: volumeThresholds,
  };

  return thresholdsMap[testType] || loadThresholds;
}

export default {
  smoke: smokeThresholds,
  load: loadThresholds,
  stress: stressThresholds,
  spike: spikeThresholds,
  soak: soakThresholds,
  volume: volumeThresholds,
  getThresholds,
};
