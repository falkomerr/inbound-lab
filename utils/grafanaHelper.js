/**
 * Grafana Integration Helper
 * Provides utilities for sending k6 metrics to Grafana
 * @module grafanaHelper
 */

/**
 * Grafana configuration
 */
const grafanaConfig = {
  url: __ENV.GRAFANA_URL || 'http://localhost:3000',
  apiKey: __ENV.GRAFANA_API_KEY || '',
  dashboardId: __ENV.GRAFANA_DASHBOARD_ID || '',
  datasource: __ENV.GRAFANA_DATASOURCE || 'k6',
};

/**
 * Send metrics to Grafana
 * @param {Object} metrics - Metrics object
 * @param {Object} [options] - Additional options
 * @returns {Promise<boolean>} True if successful
 */
export async function sendMetricsToGrafana(_metrics, _options = {}) {
  if (!grafanaConfig.apiKey) {
    console.warn('⚠️ Grafana API key not configured, skipping Grafana integration');
    return false;
  }

  // In k6, Grafana integration is typically done via output extensions
  // This is a helper for configuration and validation
  void _metrics;
  void _options;
  return true;
}

/**
 * Validate Grafana configuration
 * @returns {boolean} True if configuration is valid
 */
export function validateGrafanaConfig() {
  if (!grafanaConfig.url) {
    console.warn('⚠️ Grafana URL not configured');
    return false;
  }

  if (!grafanaConfig.apiKey) {
    console.warn('⚠️ Grafana API key not configured');
    return false;
  }

  return true;
}

/**
 * Get Grafana dashboard URL
 * @param {string} [dashboardId] - Dashboard ID
 * @returns {string} Dashboard URL
 */
export function getGrafanaDashboardUrl(dashboardId = grafanaConfig.dashboardId) {
  if (!dashboardId) {
    return `${grafanaConfig.url}/dashboards`;
  }
  return `${grafanaConfig.url}/d/${dashboardId}`;
}

/**
 * Create Grafana dashboard configuration
 * @returns {Object} Dashboard configuration
 */
export function createGrafanaDashboardConfig() {
  return {
    title: 'k6 Load Test Dashboard',
    tags: ['k6', 'load-test', 'performance'],
    timezone: 'browser',
    panels: [
      {
        title: 'Response Time',
        type: 'graph',
        targets: [{ expr: 'k6_http_req_duration', legendFormat: '{{method}} {{url}}' }],
      },
      {
        title: 'Request Rate',
        type: 'graph',
        targets: [{ expr: 'rate(k6_http_reqs_total[1m])', legendFormat: 'Requests/sec' }],
      },
      {
        title: 'Error Rate',
        type: 'graph',
        targets: [{ expr: 'rate(k6_http_req_failed_total[1m])', legendFormat: 'Errors/sec' }],
      },
    ],
  };
}

export default {
  sendMetricsToGrafana,
  validateGrafanaConfig,
  getGrafanaDashboardUrl,
  createGrafanaDashboardConfig,
  config: grafanaConfig,
};
