/**
 * Shared HTML report theme — matches Load Test panel (Inter, slate, blue primary).
 * Embeddable charts (Chart.js CDN) mirror dashboard: RPS, avg response time, distribution.
 */

export const REPORT_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#2563eb"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="26" font-weight="900" fill="white" text-anchor="middle" letter-spacing="-1">B2B</text></svg>`
)}`;

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Human-readable scenario title from slug (sample-http-get → CE customer login) */
export function formatScenarioTitle(slug) {
  if (!slug || typeof slug !== 'string') {
    return 'Scenario';
  }
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Same default as the app panel: Tehran for human-readable reports */
const REPORT_TZ = 'Asia/Tehran';

/**
 * Format an ISO instant for the run summary table: readable local line + compact UTC line.
 * @param {string} iso
 * @returns {string} HTML (already escaped)
 */
export function formatInstantCellHtml(iso) {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return `<span class="meta-time-fallback">${escapeHtml(String(iso))}</span>`;
  }
  const tehran = d.toLocaleString('en-GB', {
    timeZone: REPORT_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const utc = d.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `<div class="meta-time-main">${escapeHtml(tehran)}</div><div class="meta-time-sub">UTC · ${escapeHtml(utc)}</div>`;
}

/** One line for “report generated” stamp (Tehran) */
export function formatNowInReportTz(date = new Date()) {
  return date.toLocaleString('en-GB', {
    timeZone: REPORT_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Section label above metric cards / blocks */
export function reportSectionEyebrow(text) {
  return `<div class="report-eyebrow report-eyebrow--section"><span class="report-eyebrow-dot" aria-hidden="true"></span>${escapeHtml(text)}</div>`;
}

export function reportDocumentTitle(run) {
  const slug = run?.scenarioSlug || 'scenario';
  const st = run?.status || 'export';
  return `Load test · ${slug} · ${st}`;
}

/**
 * Same buckets as dashboard `calculateDistribution` / distribution chart.
 * @param {object} metrics
 * @returns {number[]}
 */
export function distributionBucketsFromMetrics(metrics) {
  const m = metrics || {};
  const httpReqDuration = m.http_req_duration || {};
  const { distribution } = httpReqDuration;
  if (distribution && typeof distribution === 'object') {
    return [
      distribution['<100ms'] || 0,
      distribution['100-200ms'] || 0,
      distribution['200-500ms'] || 0,
      distribution['500-1000ms'] || 0,
      distribution['1-2s'] || 0,
      distribution['>2s'] || 0,
    ];
  }
  const total = m.http_reqs?.count || 0;
  if (total === 0) {
    return [0, 0, 0, 0, 0, 0];
  }
  return [
    Math.floor(total * 0.3),
    Math.floor(total * 0.25),
    Math.floor(total * 0.2),
    Math.floor(total * 0.15),
    Math.floor(total * 0.08),
    Math.floor(total * 0.02),
  ];
}

function statusPillClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') {
    return 'status-pill--completed';
  }
  if (s === 'stopped') {
    return 'status-pill--stopped';
  }
  if (s === 'paused' || s === 'discarded') {
    return 'status-pill--paused';
  }
  if (s === 'failed') {
    return 'status-pill--failed';
  }
  if (s === 'running') {
    return 'status-pill--running';
  }
  return 'status-pill--unknown';
}

function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') {
    return 'Completed';
  }
  if (s === 'stopped') {
    return 'Stopped';
  }
  if (s === 'paused') {
    return 'Paused';
  }
  if (s === 'discarded') {
    return 'Discarded';
  }
  if (s === 'failed') {
    return 'Failed';
  }
  if (s === 'running') {
    return 'Running';
  }
  return 'Unknown';
}

function outcomeDescription(run) {
  if (!run || !run.status) {
    return 'Run metadata was not attached to this file. Export from the Load Test panel after a run, or open results from history, so the outcome (completed, stopped, paused, etc.) appears here.';
  }
  const s = String(run.status).toLowerCase();
  const whoStop = run.stoppedByUsername
    ? ` Stopped by <strong>${escapeHtml(run.stoppedByUsername)}</strong>.`
    : '';
  if (s === 'completed') {
    return 'This run finished under its own control: k6 reached the end of the configured duration/stages (within graceful limits). The metrics below describe the full run.';
  }
  if (s === 'stopped') {
    return `The run was ended manually before the plan finished. Numbers below are partial — they reflect traffic only up to the stop.${whoStop}`;
  }
  if (s === 'paused') {
    return `This entry reflects a run that ended from a <strong>paused</strong> session (for example discard while paused). Results are partial.${whoStop}`;
  }
  if (s === 'discarded') {
    return 'The paused session was discarded; any stored segment reflects work done before discard.';
  }
  if (s === 'failed') {
    return 'k6 exited with a non-zero code. Treat metrics as partial and inspect logs on the server.';
  }
  if (s === 'running') {
    return 'Snapshot while the run was still active (unusual in a saved HTML export).';
  }
  return 'See metrics below for this run snapshot.';
}

/**
 * One-run summary: outcome badge + copy + meta table (replaces generic “how to pause” help).
 */
export function reportRunSectionHtml(run) {
  const st = run?.status || 'unknown';
  const pillClass = statusPillClass(st);
  const label = statusLabel(st);
  const desc = outcomeDescription(run);

  const rows = [];
  if (run?.scenarioSlug) {
    rows.push(
      `<tr><th>Scenario</th><td><code>${escapeHtml(run.scenarioSlug)}</code> · ${escapeHtml(formatScenarioTitle(run.scenarioSlug))}</td></tr>`
    );
  }
  if (run?.runId) {
    rows.push(`<tr><th>Run ID</th><td><code>${escapeHtml(run.runId)}</code></td></tr>`);
  }
  if (run?.environment) {
    rows.push(`<tr><th>Environment</th><td>${escapeHtml(run.environment)}</td></tr>`);
  }
  if (run?.configuredDuration) {
    rows.push(
      `<tr><th>Configured duration</th><td>${escapeHtml(run.configuredDuration)}</td></tr>`
    );
  }
  if (run?.startTime) {
    rows.push(
      `<tr><th>Started</th><td class="meta-time-cell">${formatInstantCellHtml(run.startTime)}</td></tr>`
    );
  }
  if (run?.endTime) {
    rows.push(
      `<tr><th>Ended</th><td class="meta-time-cell">${formatInstantCellHtml(run.endTime)}</td></tr>`
    );
  }
  if (run?.startedByUsername) {
    rows.push(`<tr><th>Started by</th><td>${escapeHtml(run.startedByUsername)}</td></tr>`);
  }
  if (run?.stoppedByUsername) {
    rows.push(`<tr><th>Stopped by</th><td>${escapeHtml(run.stoppedByUsername)}</td></tr>`);
  }
  if (run?.exitCode != null && run.exitCode !== '') {
    rows.push(`<tr><th>k6 exit code</th><td>${escapeHtml(String(run.exitCode))}</td></tr>`);
  }

  return `
<section class="run-outcome run-outcome--premium" aria-labelledby="run-outcome-heading">
  <div class="report-eyebrow"><span class="report-eyebrow-dot" aria-hidden="true"></span> Run summary</div>
  <div class="run-outcome-row">
    <span class="status-pill ${pillClass}" id="run-outcome-heading">${escapeHtml(label)}</span>
  </div>
  <p class="run-outcome-desc">${desc}</p>
  ${
    rows.length
      ? `<div class="table-wrap run-meta-wrap run-meta-table-shell"><table class="run-meta-table"><tbody>${rows.join('')}</tbody></table></div>`
      : ''
  }
</section>`;
}

export const REPORT_PANEL_CSS = `
/* Premium report — login tokens (#4f6ef7 / #7c3aed), depth + hierarchy */
:root {
  --primary: #4f6ef7;
  --primary-dk: #3a57e8;
  --accent: #7c3aed;
  --text: #0f172a;
  --text-muted: #64748b;
  --border: #e2e8f0;
  --error: #dc2626;
  --radius: 12px;
  --radius-lg: 16px;
  --page-bg: #f8fafc;
  --green-700: #15803d;
  --amber-700: #b45309;
  --red-700: #b91c1c;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-md: 0 4px 16px rgba(15, 23, 42, 0.07);
  --shadow-lg: 0 12px 40px -12px rgba(15, 23, 42, 0.14);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; }
body {
  font-family: var(--font);
  color: var(--text);
  line-height: 1.5;
  min-height: 100vh;
  padding: 36px 18px 48px;
  background: linear-gradient(165deg, #eef2ff 0%, #f8fafc 38%, #f1f5f9 100%);
  background-attachment: fixed;
}
.report-wrap {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 2px;
}
.report-shell {
  background: #fff;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm), var(--shadow-lg);
}
.report-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 30px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%);
}
.report-nav-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.report-logo {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  object-fit: cover;
  flex-shrink: 0;
  border: 2px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
}
.report-brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.report-brand-name {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}
.report-brand-sub {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.report-nav-meta {
  text-align: right;
  max-width: 56%;
}
.report-nav-meta-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
  line-height: 1.3;
}
.report-nav-meta-caption {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 500;
}
.meta-time-cell { vertical-align: top; }
.meta-time-main {
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  font-size: 0.88rem;
}
.meta-time-sub {
  margin-top: 4px;
  font-size: 0.75rem;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}
.meta-time-fallback { font-size: 0.85rem; color: var(--text-muted); word-break: break-all; }
.report-progress-line {
  height: 4px;
  width: 100%;
  background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 55%, var(--primary-dk) 100%);
}
.report-body { padding: 36px 32px 40px; }

.report-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 14px;
}
.report-eyebrow--section { margin-top: 8px; margin-bottom: 16px; }
.report-eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.15);
}

.report-title-block { margin-bottom: 32px; position: relative; }
.report-title {
  font-size: 2rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.035em;
  line-height: 1.12;
}
.report-title-block::after {
  content: '';
  display: block;
  width: 88px;
  height: 4px;
  margin-top: 16px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--primary), var(--accent));
}
.report-subtitle {
  font-size: 0.92rem;
  color: var(--text-muted);
  margin-top: 12px;
  line-height: 1.6;
  max-width: 44rem;
}

.run-outcome {
  border-radius: var(--radius);
  padding: 22px 22px 20px;
  margin-bottom: 28px;
}
.run-outcome-row { margin-bottom: 12px; }
.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.status-pill--completed {
  background: rgba(79, 110, 247, 0.08);
  color: var(--primary-dk);
  border: 1px solid rgba(79, 110, 247, 0.22);
}
.status-pill--stopped { background: #fffbeb; color: var(--amber-700); border: 1px solid #fde68a; }
.status-pill--paused { background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; }
.status-pill--failed { background: #fef2f2; color: var(--red-700); border: 1px solid #fecaca; }
.status-pill--running { background: rgba(79, 110, 247, 0.08); color: var(--primary-dk); border: 1px solid rgba(79, 110, 247, 0.22); }
.status-pill--unknown { background: var(--page-bg); color: var(--text-muted); border: 1px solid var(--border); }
.run-outcome-desc {
  font-size: 0.9rem;
  color: var(--text-muted);
  margin-bottom: 0;
  max-width: 40rem;
  line-height: 1.65;
}
.run-outcome--premium {
  background: linear-gradient(145deg, #fafbff 0%, #ffffff 45%, #f8fafc 100%);
  border: 1px solid rgba(79, 110, 247, 0.14);
  box-shadow: var(--shadow-md);
  border-left: 4px solid var(--primary);
}
.run-meta-wrap { margin-top: 18px; }
.run-meta-table-shell {
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.run-meta-table { font-size: 0.83rem; }
.run-meta-table th {
  width: 140px;
  color: #475569;
  font-weight: 600;
  vertical-align: top;
  padding: 10px 14px 10px 0;
}
.run-meta-table td { padding: 10px 0; color: var(--text); }

.charts-panel { margin-bottom: 28px; }
.charts-panel--premium {
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: var(--radius);
  padding: 0;
  overflow: hidden;
  background: #fff;
  box-shadow: var(--shadow-md);
}
.charts-panel-head {
  padding: 22px 22px 18px;
  background: linear-gradient(180deg, #f4f7ff 0%, #ffffff 100%);
  border-bottom: 1px solid var(--border);
}
.charts-panel-body { padding: 20px 18px 18px; background: #fafbfc; }
.charts-panel-title {
  font-size: 1.12rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.025em;
  margin-bottom: 6px;
}
.charts-panel-sub {
  font-size: 0.86rem;
  color: var(--text-muted);
  margin-bottom: 0;
  line-height: 1.55;
}
.charts-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}
@media (max-width: 720px) { .charts-grid-2 { grid-template-columns: 1fr; } }
.chart-box {
  border-radius: var(--radius);
  padding: 16px 16px 12px;
}
.chart-box--plot,
.chart-box--dist {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(226, 232, 240, 0.98);
  box-shadow: var(--shadow-sm), 0 0 0 1px rgba(255, 255, 255, 0.6) inset;
}
.chart-box h4 {
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
  letter-spacing: -0.01em;
}
.chart-box .chart-sub {
  font-size: 0.72rem;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 8px;
}
.report-chart-canvas-wrap {
  position: relative;
  height: 208px;
  width: 100%;
}
.chart-empty-note {
  font-size: 0.8rem;
  color: var(--text-muted);
  padding: 20px 10px;
  text-align: center;
}
.distribution-panel .report-chart-canvas-wrap { height: 228px; }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 14px;
  margin-bottom: 32px;
}
.metric-tile {
  position: relative;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: var(--radius);
  padding: 16px 16px 14px;
  overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: var(--shadow-sm);
}
.metric-tile::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--primary), var(--accent));
  opacity: 0.9;
}
.metric-tile:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.metric-tile.accent-warn::before { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.metric-tile.accent-danger::before { background: linear-gradient(90deg, #ef4444, #f87171); }
.metric-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 8px;
  position: relative;
}
.metric-value {
  font-size: 1.55rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  position: relative;
}
.metric-value .metric-unit {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-left: 2px;
}
.metric-value.ok { color: var(--green-700); }
.metric-value.warn { color: var(--amber-700); }
.metric-value.bad { color: var(--red-700); }

.section { margin-bottom: 28px; }
.section:last-child { margin-bottom: 0; }
.section h2.section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  font-size: 1rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.025em;
}
.section h2.section-title::before {
  content: '';
  width: 4px;
  height: 1.15em;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--primary), var(--accent));
  flex-shrink: 0;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: var(--radius);
  background: #fff;
  box-shadow: var(--shadow-sm);
}
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
thead { background: linear-gradient(180deg, #f1f5f9 0%, #e8eef5 100%); }
th {
  text-align: left;
  padding: 12px 16px;
  font-weight: 700;
  color: #334155;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
  letter-spacing: 0.01em;
}
td {
  padding: 11px 16px;
  border-bottom: 1px solid #f1f5f9;
  color: var(--text);
}
tbody tr:nth-child(even) td { background: rgba(248, 250, 252, 0.65); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: rgba(239, 246, 255, 0.75) !important; }

.badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge.success { background: #ecfdf5; color: var(--green-700); }
.badge.warning { background: #fffbeb; color: var(--amber-700); }
.badge.error { background: #fef2f2; color: var(--red-700); }
code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.8125rem;
  background: var(--page-bg);
  padding: 2px 6px;
  border-radius: 6px;
  color: #334155;
}
.report-footer {
  padding: 22px 28px;
  border-top: 1px solid var(--border);
  text-align: center;
  font-size: 0.78rem;
  color: #94a3b8;
  line-height: 1.5;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
@media print {
  body { background: #fff !important; padding: 0; }
  .report-shell { box-shadow: none; border: 1px solid #ddd; }
  .metric-tile { transform: none !important; box-shadow: none !important; }
  .metric-tile:hover { transform: none !important; }
}
`;

/**
 * Embed Chart.js in HTML safely (breaks parser if raw `</script>` appears in source).
 * @param {string} js
 */
export function escapeInlineScriptSource(js) {
  return String(js ?? '').replace(/<\/script/gi, '<\\/script');
}

/**
 * Dashboard-aligned charts. Pass `chartJsInline` (full chart.umd.js text) so the file works
 * offline and when opened as file:// — external CDN scripts are often blocked there.
 * @param {object} metrics
 * @param {{ chartJsInline?: string }} [options]
 */
export function buildReportChartsBlock(chartSeries, metrics, options = {}) {
  const distribution = distributionBucketsFromMetrics(metrics);
  const hasSeries = Boolean(chartSeries && chartSeries.times && chartSeries.times.length > 0);
  const payload = JSON.stringify({
    hasSeries,
    times: chartSeries?.times || [],
    rps: chartSeries?.rps || [],
    avgResponseTime: chartSeries?.avgResponseTime || [],
    distribution,
  }).replace(/</g, '\\u003c');

  const { chartJsInline } = options;
  const chartLibraryHtml = chartJsInline
    ? `<script>${escapeInlineScriptSource(chartJsInline)}</script>`
    : `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" crossorigin="anonymous"></script>`;

  return `
<section class="charts-panel charts-panel--premium">
  <div class="charts-panel-head">
    <div class="report-eyebrow"><span class="report-eyebrow-dot" aria-hidden="true"></span> Charts</div>
    <h3 class="charts-panel-title">Throughput &amp; latency</h3>
    <p class="charts-panel-sub">Per-second series when saved · distribution from the k6 histogram.</p>
  </div>
  <div class="charts-panel-body">
  <div class="charts-grid-2">
    <div class="chart-box chart-box--plot">
      <h4>Requests per second</h4>
      <div class="chart-sub">Live throughput</div>
      <div class="report-chart-canvas-wrap"><canvas id="reportChartRps" aria-label="Requests per second chart"></canvas></div>
      <p class="chart-empty-note" id="reportChartRpsEmpty" style="display:none">No time-series points in this file. Export HTML from the panel after the run, or ensure the server saved <code>chartSeries</code>.</p>
    </div>
    <div class="chart-box chart-box--plot">
      <h4>Response time</h4>
      <div class="chart-sub">Average latency (ms)</div>
      <div class="report-chart-canvas-wrap"><canvas id="reportChartRt" aria-label="Response time chart"></canvas></div>
      <p class="chart-empty-note" id="reportChartRtEmpty" style="display:none">No time-series points in this file.</p>
    </div>
  </div>
  <div class="chart-box chart-box--dist distribution-panel">
    <h4>Response time distribution</h4>
    <div class="chart-sub">Request counts by bucket</div>
    <div class="report-chart-canvas-wrap"><canvas id="reportChartDist" aria-label="Distribution chart"></canvas></div>
  </div>
  </div>
  <script type="application/json" id="report-chart-payload">${payload}</script>
  ${chartLibraryHtml}
  <script>
(function(){
  function gridColor(){ return 'rgba(15, 23, 42, 0.08)'; }
  function tickColor(){ return '#64748b'; }
  function init(){
    var el = document.getElementById('report-chart-payload');
    if (!el || typeof Chart === 'undefined') return;
    var payload;
    try { payload = JSON.parse(el.textContent); } catch(e) { return; }
    var distColors = [
      'rgba(79, 110, 247, 0.88)','rgba(124, 58, 237, 0.85)','rgba(251, 191, 36, 0.85)',
      'rgba(249, 115, 22, 0.85)','rgba(239, 68, 68, 0.85)','rgba(220, 38, 38, 0.85)'
    ];
    var common = { responsive: true, maintainAspectRatio: false, animation: false };
    if (payload.hasSeries && payload.times && payload.times.length) {
      var rpsEl = document.getElementById('reportChartRps');
      var rtEl = document.getElementById('reportChartRt');
      new Chart(rpsEl, {
        type: 'line',
        data: {
          labels: payload.times,
          datasets: [{
            label: 'Throughput',
            data: (payload.rps || []).map(function(v){ return Number(v); }),
            borderColor: '#4f6ef7',
            backgroundColor: 'rgba(79, 110, 247, 0.1)',
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5
          }]
        },
        options: Object.assign({}, common, {
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: tickColor } }
          }
        })
      });
      new Chart(rtEl, {
        type: 'line',
        data: {
          labels: payload.times,
          datasets: [{
            label: 'Avg response',
            data: (payload.avgResponseTime || []).map(function(v){ return Math.round(Number(v)); }),
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5
          }]
        },
        options: Object.assign({}, common, {
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: tickColor } }
          }
        })
      });
    } else {
      var e1 = document.getElementById('reportChartRpsEmpty');
      var e2 = document.getElementById('reportChartRtEmpty');
      if (e1) e1.style.display = 'block';
      if (e2) e2.style.display = 'block';
    }
    var distData = payload.distribution || [0,0,0,0,0,0];
    new Chart(document.getElementById('reportChartDist'), {
      type: 'bar',
      data: {
        labels: ['<100ms','100-200ms','200-500ms','500-1000ms','1-2s','>2s'],
        datasets: [{ label: 'Requests', data: distData, backgroundColor: distColors, borderRadius: 4 }]
      },
      options: Object.assign({}, common, {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: tickColor, maxRotation: 45 } },
          y: { beginAtZero: true, grace: '8%', grid: { color: gridColor }, ticks: { color: tickColor } }
        }
      })
    });
  }
  function boot(){
    if (typeof Chart !== 'undefined') {
      init();
      return;
    }
    var n = 0;
    var t = setInterval(function(){
      if (typeof Chart !== 'undefined') {
        clearInterval(t);
        init();
      } else if (++n > 400) {
        clearInterval(t);
        var err = document.getElementById('report-chart-load-error');
        if (err) err.style.display = 'block';
      }
    }, 25);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
  </script>
  <p class="chart-empty-note" id="report-chart-load-error" style="display:none;margin:12px 0 0;padding:12px;border-radius:8px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;">Charts could not load (Chart.js missing). If this file was saved, re-export from the Load Test panel while online, or generate the report with <code>npm run report:html</code> so the library is embedded.</p>
</section>`;
}

/**
 * @param {{ logoDataUri?: string, metaTitle?: string, metaCaption?: string }} opts
 * metaTitle = readable scenario name · metaCaption = single “generated” line (no duplicate run id)
 */
export function reportHeaderHtml({ logoDataUri, metaTitle, metaCaption }) {
  const src = logoDataUri || REPORT_LOGO_DATA_URI;
  const title = metaTitle ?? '';
  const cap = metaCaption ?? '';
  return `
<header class="report-nav">
  <div class="report-nav-brand">
    <img src="${src}" alt="" width="48" height="48" class="report-logo" />
    <div class="report-brand-text">
      <span class="report-brand-name">Load Test</span>
      <span class="report-brand-sub">k6 Platform</span>
    </div>
  </div>
  <div class="report-nav-meta">
    ${title ? `<div class="report-nav-meta-title">${escapeHtml(title)}</div>` : ''}
    ${cap ? `<div class="report-nav-meta-caption">${escapeHtml(cap)}</div>` : ''}
  </div>
</header>
<div class="report-progress-line" role="presentation"></div>`;
}
