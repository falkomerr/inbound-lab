/**
 * HTML Report Generator
 * Generates HTML report from k6 JSON output
 * @module generate-html-report
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  REPORT_LOGO_DATA_URI,
  REPORT_PANEL_CSS,
  buildReportChartsBlock,
  escapeHtml,
  formatNowInReportTz,
  reportDocumentTitle,
  reportHeaderHtml,
  reportRunSectionHtml,
} from '../public/reportHtmlTheme.js';

/** Same build as the UI app — embed so charts work when the HTML is opened from disk (file://). */
function loadChartUmdInline() {
  const candidates = [
    join(process.cwd(), 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
    join(process.cwd(), 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        return readFileSync(p, 'utf8');
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

function loadLogoDataUri() {
  const candidates = [
    join(process.cwd(), 'public', 'assets', 'favicon.jpg'),
    join(process.cwd(), 'public', 'assets', 'logo.jpg'),
  ];
  try {
    for (const file of candidates) {
      if (existsSync(file)) {
        const buf = readFileSync(file);
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    }
  } catch {
    /* ignore */
  }
  return REPORT_LOGO_DATA_URI;
}
  return REPORT_LOGO_DATA_URI;
}

/**
 * Generate HTML report from JSON results
 * @param {string} jsonPath - Path to JSON results file
 * @param {string} outputPath - Path to output HTML file
 */
function generateHTMLReport(jsonPath = 'reports/results.json', outputPath = 'reports/report.html') {
  try {
    const results = JSON.parse(readFileSync(jsonPath, 'utf8'));

    const reportsDir = join(process.cwd(), 'reports');
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const metrics = results.metrics || {};
    const chartSeries = results.chartSeries || null;
    const run = results.run || null;
    const logoDataUri = loadLogoDataUri();
    const chartJsInline = loadChartUmdInline();
    const httpReqDuration = metrics['http_req_duration'] || {};
    const httpReqFailed = metrics['http_req_failed'] || {};
    const httpReqs = metrics['http_reqs'] || {};
    const iterations = metrics['iterations'] || {};
    const vus = metrics['vus'] || {};

    const totalReq = httpReqs.values?.count ?? httpReqs.count ?? 0;
    const errRate = httpReqFailed.values?.rate ?? httpReqFailed.rate ?? 0;
    const errPct = (typeof errRate === 'number' && errRate <= 1 ? errRate * 100 : errRate).toFixed(
      2
    );
    const p95 = httpReqDuration.values?.['p(95)'] ?? httpReqDuration.values?.p95 ?? 0;
    const p99 = httpReqDuration.values?.['p(99)'] ?? httpReqDuration.values?.p99 ?? 0;
    const avg = httpReqDuration.values?.avg ?? httpReqDuration.avg ?? 0;
    const min = httpReqDuration.values?.min ?? httpReqDuration.min ?? 0;
    const max = httpReqDuration.values?.max ?? httpReqDuration.max ?? 0;
    const reqPerSec = httpReqs.values?.rate ?? httpReqs.rate ?? 0;

    const title = 'k6 load test (CLI)';
    const docTitle = escapeHtml(reportDocumentTitle(run));
    const generatedStamp = `${formatNowInReportTz()} · Asia/Tehran`;

    const errTileClass =
      parseFloat(errPct) < 1 ? '' : parseFloat(errPct) < 5 ? ' accent-warn' : ' accent-danger';
    const errValClass = parseFloat(errPct) < 1 ? ' ok' : parseFloat(errPct) < 5 ? ' warn' : ' bad';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTitle}</title>
  <style>${REPORT_PANEL_CSS}</style>
</head>
<body>
  <div class="report-wrap">
    <div class="report-shell">
      ${reportHeaderHtml({
        logoDataUri,
        metaTitle: 'k6 CLI report',
        metaCaption: `Generated ${generatedStamp}`,
      })}
      <div class="report-body">
        <div class="report-title-block">
          <h1 class="report-title">${title}</h1>
          <p class="report-subtitle">From k6 JSON · use the panel export for run outcome + your logo</p>
        </div>

        ${reportRunSectionHtml(run)}
        ${buildReportChartsBlock(chartSeries, metrics, { chartJsInline })}

        <div class="summary-grid">
          <div class="metric-tile">
            <div class="metric-label">Total requests</div>
            <div class="metric-value">${totalReq}</div>
          </div>
          <div class="metric-tile${errTileClass}">
            <div class="metric-label">Error rate</div>
            <div class="metric-value${errValClass}">${errPct}%</div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">P95 response</div>
            <div class="metric-value">${Number(p95).toFixed(0)}<span style="font-size:0.85rem;font-weight:600;color:var(--slate-500)">ms</span></div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">P99 response</div>
            <div class="metric-value">${Number(p99).toFixed(0)}<span style="font-size:0.85rem;font-weight:600;color:var(--slate-500)">ms</span></div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">Iterations</div>
            <div class="metric-value">${iterations.values?.count ?? iterations.count ?? 0}</div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">Max VUs</div>
            <div class="metric-value">${vus.values?.max ?? vus.max ?? 0}</div>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">Performance metrics</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Average response time</td>
                  <td>${Number(avg).toFixed(2)}ms</td>
                  <td><span class="badge ${avg < 2000 ? 'success' : 'warning'}">${avg < 2000 ? 'Good' : 'Slow'}</span></td>
                </tr>
                <tr>
                  <td>Min response time</td>
                  <td>${Number(min).toFixed(2)}ms</td>
                  <td><span class="badge success">Good</span></td>
                </tr>
                <tr>
                  <td>Max response time</td>
                  <td>${Number(max).toFixed(2)}ms</td>
                  <td><span class="badge ${max < 5000 ? 'success' : 'warning'}">${max < 5000 ? 'Good' : 'Slow'}</span></td>
                </tr>
                <tr>
                  <td>P95 response time</td>
                  <td>${Number(p95).toFixed(2)}ms</td>
                  <td><span class="badge ${p95 < 2000 ? 'success' : 'warning'}">${p95 < 2000 ? 'Good' : 'Slow'}</span></td>
                </tr>
                <tr>
                  <td>P99 response time</td>
                  <td>${Number(p99).toFixed(2)}ms</td>
                  <td><span class="badge ${p99 < 5000 ? 'success' : 'warning'}">${p99 < 5000 ? 'Good' : 'Slow'}</span></td>
                </tr>
                <tr>
                  <td>Request rate</td>
                  <td>${Number(reqPerSec).toFixed(2)} req/s</td>
                  <td><span class="badge ${reqPerSec > 100 ? 'success' : 'warning'}">${reqPerSec > 100 ? 'Good' : 'Low'}</span></td>
                </tr>
                <tr>
                  <td>Error rate</td>
                  <td>${errPct}%</td>
                  <td><span class="badge ${parseFloat(errPct) < 1 ? 'success' : 'error'}">${parseFloat(errPct) < 1 ? 'Good' : 'High'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">Thresholds</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Check</th><th>Expected</th><th>Actual</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${generateThresholdsRowsHTML(metrics)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <footer class="report-footer">
        <p>FasterTest · ${generatedStamp}</p>
      </footer>
    </div>
  </div>
</body>
</html>`;

    writeFileSync(outputPath, html, 'utf8');
    console.log(`✅ HTML report generated: ${outputPath}`);
  } catch (error) {
    console.error(`❌ Error generating HTML report: ${error.message}`);
    process.exit(1);
  }
}

function generateThresholdsRowsHTML(metrics) {
  const thresholds = [
    {
      name: 'http_req_duration',
      label: 'Response time (P95)',
      expected: '< 2000ms',
      getValue: (m) =>
        m['http_req_duration']?.values?.['p(95)'] ?? m['http_req_duration']?.values?.p95,
    },
    {
      name: 'http_req_failed',
      label: 'Error rate',
      expected: '< 1%',
      getValue: (m) => {
        const r = m['http_req_failed']?.values?.rate ?? m['http_req_failed']?.rate ?? 0;
        return r <= 1 ? r * 100 : r;
      },
    },
    {
      name: 'http_reqs',
      label: 'Request rate',
      expected: '> 100 req/s',
      getValue: (m) => m['http_reqs']?.values?.rate ?? m['http_reqs']?.rate,
    },
  ];

  return thresholds
    .map((threshold) => {
      const value = threshold.getValue(metrics);
      const num = value == null ? NaN : Number(value);
      const status =
        threshold.name === 'http_req_failed'
          ? !Number.isNaN(num) && num < 1
            ? 'success'
            : 'error'
          : threshold.name === 'http_reqs'
            ? !Number.isNaN(num) && num > 100
              ? 'success'
              : 'warning'
            : !Number.isNaN(num) && num < 2000
              ? 'success'
              : 'warning';

      const display =
        value == null || Number.isNaN(Number(value))
          ? 'N/A'
          : threshold.name === 'http_req_failed'
            ? `${Number(value).toFixed(2)}%`
            : threshold.name === 'http_reqs'
              ? `${Number(value).toFixed(2)} req/s`
              : `${Number(value).toFixed(2)}ms`;

      return `
      <tr>
        <td>${threshold.label}</td>
        <td>${threshold.expected}</td>
        <td>${display}</td>
        <td><span class="badge ${status}">${status === 'success' ? 'Pass' : status === 'warning' ? 'Warning' : 'Fail'}</span></td>
      </tr>`;
    })
    .join('');
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const jsonPath = process.argv[2] || 'reports/results.json';
  const outputPath = process.argv[3] || 'reports/report.html';
  generateHTMLReport(jsonPath, outputPath);
}

export { generateHTMLReport };
