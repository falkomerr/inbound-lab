/**
 * Test Manager
 * Manages k6 test execution, status tracking, and WebSocket notifications
 * @module testManager
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { atomicWriteJSON } from './utils/atomicWrite.js';
import { TEST_LIMITS } from '../utils/constants.js';
import { wsRoutine, wsWarn } from '../utils/wsLog.js';
import {
  cleanupReports,
  compactOversizedNdjsonFiles,
  deleteReportFilesForTestId,
  getReportRetentionConfig,
} from './reportRetention.js';
import { logger } from '../utils/logger.js';

export const TEAMS = ['api', 'backend', 'frontend', 'platform', 'qa'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

function getReportsDir() {
  return process.env.B2B_TEST_REPORTS_DIR || join(PROJECT_ROOT, 'reports');
}

/** Spawn k6 (or `K6_BIN` — supports a Node `.mjs` fake for tests). */
function spawnK6(k6Args, spawnEnv) {
  const k6Bin = process.env.K6_BIN || 'k6';
  const nodeScript = k6Bin.endsWith('.mjs') || k6Bin.endsWith('.js');
  if (nodeScript) {
    return spawn(process.execPath, [k6Bin, ...k6Args], { cwd: PROJECT_ROOT, env: spawnEnv });
  }
  return spawn(k6Bin, k6Args, { cwd: PROJECT_ROOT, env: spawnEnv });
}

/**
 * Minimum elapsed span (seconds) used as the denominator when inferring HTTP
 * request rate from consecutive samples. Without this, a tight cluster of early
 * points (e.g. 2 reqs in 0.2 s) reports as a huge spike (10 req/s) instead of
 * matching steady scenarios targeting ~2 req/s.
 */
const MIN_HTTP_REQ_RATE_WINDOW_SEC = 1;

/**
 * Available test scenarios
 */
/** Built-in scenarios; additional *.js files are registered via _scanScenariosDir(). */
const TEST_SCENARIOS = {
  'sample-http-get': {
    name: 'Sample: HTTP GET',
    file: 'sample-http-get.js',
    description: 'Demo GET against httpbin.org (or BASE_URL) — replace with your own scenarios',
    team: 'api',
    defaultVUs: 5,
    defaultDuration: '1m',
    steps: [{ method: 'GET', url: '/get', label: 'Sample GET' }],
  },
};

/**
 * Test Manager Class
 */
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR
  ? process.env.B2B_TEST_DATA_DIR
  : join(dirname(fileURLToPath(import.meta.url)), '../data');
const HISTORY_FILE = join(DATA_ROOT, 'test-history.json');

function loadHistoryFromDisk() {
  try {
    if (existsSync(HISTORY_FILE)) {
      return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch {
    /* corrupt or missing — start fresh */
  }
  return [];
}

function saveHistoryToDisk(history) {
  try {
    const dir = join(HISTORY_FILE, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    atomicWriteJSON(HISTORY_FILE, history);
  } catch (e) {
    logger.error({ err: e, event: 'history_persist_failed' }, 'history_persist_failed');
  }
}

/** Must match `PAUSED_EXCLUSIVE_MS` in server/routes/api.js (prepare / start lock). */
const PAUSED_RESUME_EXCLUSIVE_MS = 5 * 60 * 1000;

export class TestManager {
  constructor() {
    this.currentTest = null;
    this.testHistory = loadHistoryFromDisk();
    this.subscribers = new Set();
    this.manuallyStopped = false; // Track if test was manually stopped
    this.manuallyPaused = false; // SIGTERM from pause — close handler builds resumeSession
    this.manuallyReloading = false; // SIGTERM from update-load — close handler spawns next segment
    this.pendingLoadUpdate = null; // { vus, duration, startedBy } while k6 exits for reload
    this._loadUpdateDeferred = null; // Promise settle for POST /tests/update-load
    this.resumeSession = null; // Paused-for-resume state (in-memory only)
    this.preparingUser = null; // { id, username } — user who clicked "New Test"
    this.status = {
      running: false,
      testId: null,
      testName: null,
      startTime: null,
      endTime: null,
      progress: 0,
      output: [],
      error: null,
      stoppedBy: null,
      stoppedByUsername: null,
    };
    this._scanScenariosDir();
    this.runReportMaintenance();
  }

  /**
   * Age/size retention and removal of oversized NDJSON after metrics are in history.
   */
  runReportMaintenance() {
    const reportsDir = getReportsDir();
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }
    const { maxFileMb } = getReportRetentionConfig();
    const protectIds =
      this.status?.running && this.currentTest?.logicalTestId
        ? [this.currentTest.logicalTestId]
        : [];
    compactOversizedNdjsonFiles(reportsDir, maxFileMb * 1024 * 1024);
    cleanupReports(reportsDir, { protectIds });
  }

  /**
   * Scan the scenarios directory on startup and register any .js files
   * that aren't already in TEST_SCENARIOS, reading metadata from the
   * @meta comment block embedded in each generated file.
   */
  _scanScenariosDir() {
    const testsDir = join(PROJECT_ROOT, 'tests', 'scenarios');
    if (!existsSync(testsDir)) {
      return;
    }

    let files;
    try {
      files = readdirSync(testsDir).filter((f) => f.endsWith('.js'));
    } catch {
      return;
    }

    for (const file of files) {
      const testId = file.replace(/\.js$/, '');
      if (TEST_SCENARIOS[testId]) {
        continue;
      } // already registered

      try {
        const src = readFileSync(join(testsDir, file), 'utf8');
        // Parse embedded @meta block: // @key: value
        const meta = {};
        for (const line of src.split('\n').slice(0, 20)) {
          const m = line.match(/^\s*\*?\s*@(\w+):\s*(.+)/);
          if (m) {
            meta[m[1].trim()] = m[2].trim();
          }
        }
        const metaMode = String(meta.mode || '')
          .replace(/['"]/g, '')
          .trim()
          .toLowerCase();
        const inferredMode =
          metaMode || (/curl|chain/i.test(String(meta.name || '')) ? 'curl' : 'scenario');
        TEST_SCENARIOS[testId] = {
          name: meta.name || testId,
          file,
          description: meta.description || '',
          team: meta.team || '',
          mode: inferredMode === 'curl' ? 'curl' : 'scenario',
          defaultVUs: parseInt(meta.vus || '10', 10),
          defaultDuration: meta.duration || '5m',
        };
        logger.info(
          { event: 'scenario_registered', testId, team: meta.team || 'none' },
          'scenario_registered'
        );
      } catch {
        // skip unreadable files
      }
    }
  }

  /**
   * Parse a k6 duration string ('30s', '5m', '2h') to milliseconds.
   */
  _parseDuration(str) {
    if (!str) {
      return 0;
    }
    const m = String(str)
      .trim()
      .match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/i);
    if (!m) {
      return 0;
    }
    const n = parseFloat(m[1]);
    switch (m[2].toLowerCase()) {
      case 'ms':
        return n;
      case 's':
        return n * 1000;
      case 'm':
        return n * 60 * 1000;
      case 'h':
        return n * 3600 * 1000;
      default:
        return 0;
    }
  }

  /**
   * Format milliseconds as a k6 duration flag (ceil so remaining wall time is never under-run).
   */
  _formatDurationMs(ms) {
    const n = Math.max(0, Number(ms) || 0);
    if (n <= 0) {
      return '1ms';
    }
    if (n < 1000) {
      return `${Math.max(1, Math.round(n))}ms`;
    }
    const sec = Math.max(1, Math.ceil(n / 1000));
    if (sec < 60) {
      return `${sec}s`;
    }
    const min = Math.max(1, Math.ceil(sec / 60));
    if (min < 60) {
      return `${min}m`;
    }
    const h = Math.max(1, Math.ceil(min / 60));
    return `${h}h`;
  }

  _cloneSpawnOptions(obj) {
    try {
      return structuredClone(obj);
    } catch {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  _publicResumeSession() {
    const rs = this.resumeSession;
    if (!rs) {
      return null;
    }
    const opts = { ...rs.baseOptions };
    delete opts.customEnv;
    return {
      logicalTestId: rs.logicalTestId,
      scenarioTestId: rs.scenarioTestId,
      remainingMs: rs.remainingMs,
      consumedMs: rs.consumedMs,
      originalDurationMs: rs.originalDurationMs,
      originalDuration: rs.originalDurationStr,
      segmentIndex: rs.segmentIndex,
      pausedAt: rs.pausedAt,
      runStartTime: rs.runStartTime || null,
      options: opts,
      startedBy: rs.startedBy ?? null,
      startedByUsername: rs.startedByUsername ?? null,
    };
  }

  _parseNDJSONMerged(filePaths) {
    const lines = [];
    for (const fp of filePaths) {
      if (!fp || !existsSync(fp)) {
        continue;
      }
      try {
        const content = readFileSync(fp, 'utf-8');
        for (const line of content.trim().split('\n')) {
          if (line.trim()) {
            lines.push(line);
          }
        }
      } catch {
        /* skip unreadable segment */
      }
    }
    return this._parseNDJSONLines(lines);
  }

  /**
   * @param {string[]} lines
   */
  _parseNDJSONLines(lines) {
    if (!lines || lines.length === 0) {
      return null;
    }
    try {
      const allMetrics = {};
      const failureInfo = {};
      const chartBuckets = {};
      let validLines = 0;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          validLines++;
          if (parsed.type === 'Point' && parsed.data && parsed.metric) {
            const metricName = parsed.metric;
            const { value, time, tags } = parsed.data;

            if (!allMetrics[metricName]) {
              allMetrics[metricName] = { values: [], times: [] };
            }
            allMetrics[metricName].values.push(value);
            allMetrics[metricName].times.push(time);

            const tagName = tags && tags.name;
            if (
              tagName &&
              (metricName === 'http_req_duration' ||
                metricName === 'http_reqs' ||
                metricName === 'http_req_failed')
            ) {
              const taggedKey = `${metricName}__url__${tagName}`;
              if (!allMetrics[taggedKey]) {
                allMetrics[taggedKey] = { values: [], times: [] };
              }
              allMetrics[taggedKey].values.push(value);
              allMetrics[taggedKey].times.push(time);
            }

            if (metricName === 'http_req_failed' && value === 1) {
              this.trackFailure(failureInfo, tags);
            }

            if (metricName === 'http_reqs' || metricName === 'http_req_duration') {
              const d = new Date(time);
              const key = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
              if (!chartBuckets[key]) {
                chartBuckets[key] = { reqs: 0, durations: [] };
              }
              if (metricName === 'http_reqs') {
                chartBuckets[key].reqs += value;
              }
              if (metricName === 'http_req_duration') {
                chartBuckets[key].durations.push(value);
              }
            }
          }
        } catch {
          /* skip invalid JSON lines */
        }
      }

      if (validLines === 0) {
        return null;
      }

      const chartSeries = { times: [], rps: [], avgResponseTime: [] };
      for (const key of Object.keys(chartBuckets).sort()) {
        const b = chartBuckets[key];
        chartSeries.times.push(key);
        chartSeries.rps.push(b.reqs);
        chartSeries.avgResponseTime.push(
          b.durations.length > 0 ? b.durations.reduce((a, c) => a + c, 0) / b.durations.length : 0
        );
      }

      return {
        allMetrics,
        failureInfo,
        summary: { totalLines: lines.length, validLines },
        chartSeries,
      };
    } catch (err) {
      logger.error({ err, event: 'ndjson_parse_error' }, 'ndjson_parse_error');
      return null;
    }
  }

  /**
   * Return true when the k6 script exports an `options` object that contains
   * a `stages` array — meaning the script owns its own ramp-up profile and
   * we should not pass --vus on the CLI (which would replace the ramp with a
   * flat constant-VU scenario).
   *
   * We intentionally match only unquoted `stages` inside what looks like the
   * options export block, to avoid false positives from JSON request bodies
   * such as `const BODY = { "stages": [...] }`.
   */
  _scriptHasStages(filePath) {
    try {
      const src = readFileSync(filePath, 'utf8');
      // Only match `stages` that appears as a bare JS identifier (not quoted),
      // preceded by whitespace/opening-brace, and followed by `: [`.
      // This avoids matching `"stages":` inside body constants.
      return /(?:^|[\s{,])stages\s*:\s*\[/m.test(src);
    } catch {
      return false;
    }
  }

  /**
   * Parse a k6 NDJSON results file into structured metric data.
   * Returns { allMetrics, failureInfo, summary } or null if the file is
   * missing / empty / completely unparseable.
   */
  _readNdjsonContent(filePath) {
    const stat = statSync(filePath);
    const maxParse = TEST_LIMITS.MAX_REPORT_PARSE_BYTES;
    if (stat.size <= maxParse) {
      return readFileSync(filePath, 'utf-8');
    }
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(maxParse);
    readSync(fd, buf, 0, maxParse, stat.size - maxParse);
    closeSync(fd);
    let content = buf.toString('utf-8');
    const firstNl = content.indexOf('\n');
    if (firstNl >= 0) {
      content = content.slice(firstNl + 1);
    }
    logger.warn(
      { event: 'ndjson_tail_parse', filePath, sizeMb: Number((stat.size / 1e6).toFixed(1)) },
      'ndjson_tail_parse'
    );
    return content;
  }

  _parseNDJSONFile(filePath) {
    if (!filePath || !existsSync(filePath)) {
      return null;
    }
    try {
      const content = this._readNdjsonContent(filePath);
      const lines = content
        .trim()
        .split('\n')
        .filter((l) => l.trim());
      return this._parseNDJSONLines(lines);
    } catch (err) {
      logger.error({ err, event: 'ndjson_read_error', filePath }, 'ndjson_read_error');
      return null;
    }
  }

  /**
   * Get available test scenarios
   */
  getAvailableTests() {
    const testsDir = join(PROJECT_ROOT, 'tests', 'scenarios');
    return Object.keys(TEST_SCENARIOS)
      .filter((key) => existsSync(join(testsDir, TEST_SCENARIOS[key].file)))
      .map((key) => ({
        id: key,
        team: TEST_SCENARIOS[key].team || '',
        mode: TEST_SCENARIOS[key].mode || 'scenario',
        ...TEST_SCENARIOS[key],
      }));
  }

  /**
   * Start a test. Pass resumeMerge only from resumeTest() so remaining wall time
   * and NDJSON segments stay consistent across pause/resume.
   */
  async startTest(testId, options = {}, startedBy = null, resumeMerge = null) {
    if (this.status.running) {
      throw new Error('A test is already running. Please stop it first.');
    }
    this._expireStalePausedResumeIfNeeded();
    if (!resumeMerge && this.resumeSession) {
      throw new Error(
        'A test is paused and waiting to resume. Resume it or use Stop to discard it before starting another run.'
      );
    }

    // Clear preparing state — the test is now actually starting
    this.preparingUser = null;
    const test = TEST_SCENARIOS[testId];
    if (!test) {
      throw new Error(`Test scenario "${testId}" not found`);
    }

    const testFile = join(PROJECT_ROOT, 'tests', 'scenarios', test.file);
    if (!existsSync(testFile)) {
      logger.error({ event: 'test_file_missing', testFile }, 'test_file_missing');
      throw new Error(`Test scenario "${testId}" is unavailable on the server`);
    }

    const priorOutput =
      resumeMerge && Array.isArray(this.status?.output) ? [...this.status.output] : [];

    const runStartTime = resumeMerge?.runStartTime ?? new Date().toISOString();

    const logicalTestId = resumeMerge?.logicalTestId ?? `${testId}-${Date.now()}`;
    const segmentIndexForThisRun = resumeMerge?.segmentIndex ?? 0;
    const outputBase =
      segmentIndexForThisRun === 0 ? logicalTestId : `${logicalTestId}-r${segmentIndexForThisRun}`;

    const reportsDir = getReportsDir();
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const env = options.environment || 'staging';
    const vus = options.vus || test.defaultVUs;
    const duration = options.duration || test.defaultDuration;
    const originalDurationStr = resumeMerge?.originalDurationStr ?? duration;
    const originalDurationMs =
      resumeMerge?.originalDurationMs ?? this._parseDuration(originalDurationStr);
    const progressTotalMs = Math.max(1, originalDurationMs || this._parseDuration(duration));

    const baseOptionsClone = this._cloneSpawnOptions({ ...options });
    baseOptionsClone.environment = env;
    baseOptionsClone.vus = vus;
    baseOptionsClone.duration = originalDurationStr;

    const scriptHasStages = this._scriptHasStages(testFile);

    const k6Args = ['run', '--env', `ENV=${env}`];

    if (scriptHasStages) {
      k6Args.push('--env', `VUS=${vus}`, '--env', `DURATION=${duration}`);
      const totalSec = Math.round(this._parseDuration(duration) / 1000);
      if (totalSec <= 2) {
        k6Args.push('--stage', `${totalSec}s:${vus}`);
      } else {
        k6Args.push('--stage', `1s:${vus}`, '--stage', `${totalSec - 1}s:${vus}`);
      }
    } else {
      k6Args.push('--vus', vus.toString(), '--duration', duration);
    }

    const ndjsonPath = join(reportsDir, `${outputBase}.json`);
    const summaryPath = join(reportsDir, `${outputBase}-summary.json`);
    k6Args.push('--out', `json=${ndjsonPath}`, '--summary-export', summaryPath, testFile);

    const spawnEnv = {
      ...process.env,
      NODE_ENV: 'production',
    };
    if (options.customEnv && typeof options.customEnv === 'object') {
      for (const [key, value] of Object.entries(options.customEnv)) {
        spawnEnv[key] = String(value);
      }
    }

    this.manuallyStopped = false;
    this.manuallyPaused = false;

    const safeOptions = { ...baseOptionsClone };
    delete safeOptions.customEnv;

    const statusOptions = {
      testId,
      environment: env,
      vus,
      duration: originalDurationStr,
      ...safeOptions,
    };
    if (resumeMerge && duration !== originalDurationStr) {
      statusOptions.segmentDuration = duration;
    }

    this.status = {
      running: true,
      testId: logicalTestId,
      testName: test.name,
      startTime: runStartTime,
      endTime: null,
      progress: resumeMerge
        ? Math.min(
            99,
            Math.round(((resumeMerge.wallConsumedBeforeSegment || 0) / progressTotalMs) * 100)
          )
        : 0,
      output: priorOutput,
      error: null,
      stoppedBy: null,
      stoppedByUsername: null,
      startedBy: startedBy?.id ?? startedBy ?? null,
      startedByUsername: startedBy?.username ?? null,
      options: statusOptions,
      pausedForResume: false,
    };

    const segmentResultFiles = resumeMerge?.segmentResultFiles
      ? [...resumeMerge.segmentResultFiles]
      : [];
    const resultsFilePath = join(reportsDir, `${outputBase}.json`);
    segmentResultFiles.push(resultsFilePath);

    this.currentTest = {
      id: logicalTestId,
      scenarioTestId: testId,
      testId,
      logicalTestId,
      segmentIndexForThisRun,
      outputBase,
      process: null,
      startTime: runStartTime,
      runStartTime,
      segmentWallStart: Date.now(),
      wallConsumedBeforeSegment: resumeMerge?.wallConsumedBeforeSegment ?? 0,
      originalDurationMs: progressTotalMs,
      originalDurationStr,
      savedBaseOptions: this._cloneSpawnOptions(baseOptionsClone),
      segmentResultFiles,
      resultsFile: resultsFilePath,
      metricsInterval: null,
      progressInterval: null,
    };

    const k6Process = spawnK6(k6Args, spawnEnv);

    this.currentTest.process = k6Process;

    this.startMetricsReader(outputBase);

    this.currentTest.progressInterval = setInterval(() => {
      if (!this.status.running) {
        clearInterval(this.currentTest?.progressInterval);
        return;
      }
      const ct = this.currentTest;
      if (!ct) {
        return;
      }
      const wall = ct.wallConsumedBeforeSegment + (Date.now() - ct.segmentWallStart);
      this.status.progress = Math.min(99, Math.round((wall / progressTotalMs) * 100));
    }, 2000);

    // Handle stdout
    k6Process.stdout.on('data', (data) => {
      const output = data.toString();
      const outputEntry = {
        timestamp: new Date().toISOString(),
        type: 'stdout',
        message: output,
      };

      this.status.output.push(outputEntry);

      // Limit output array size to prevent memory issues
      if (this.status.output.length > TEST_LIMITS.MAX_OUTPUT_LINES) {
        this.status.output = this.status.output.slice(-TEST_LIMITS.MAX_OUTPUT_LINES);
      }

      this.notifySubscribers('output', { message: output });
    });

    // Handle stderr
    k6Process.stderr.on('data', (data) => {
      const output = data.toString();
      const outputEntry = {
        timestamp: new Date().toISOString(),
        type: 'stderr',
        message: output,
      };

      this.status.output.push(outputEntry);

      // Limit output array size to prevent memory issues
      if (this.status.output.length > TEST_LIMITS.MAX_OUTPUT_LINES) {
        this.status.output = this.status.output.slice(-TEST_LIMITS.MAX_OUTPUT_LINES);
      }

      this.notifySubscribers('output', { message: output, type: 'error' });
    });

    // Handle process exit
    k6Process.on('close', (code) => {
      const ct = this.currentTest;

      if (ct?.progressInterval) {
        clearInterval(ct.progressInterval);
        ct.progressInterval = null;
      }

      const capturedMetricsInterval = ct?.metricsInterval;
      const capturedResultsFile = ct?.resultsFile;

      setTimeout(() => {
        if (capturedMetricsInterval) {
          const parsed = this._parseNDJSONFile(capturedResultsFile);
          if (parsed) {
            const aggregated = this.aggregateMetrics(parsed.allMetrics, parsed.failureInfo);
            if (Object.keys(aggregated).length > 0) {
              this.status.metrics = aggregated;
              this.notifySubscribers('metrics', aggregated);
            }
          }
          clearInterval(capturedMetricsInterval);
        }
      }, 5000);

      if (this.manuallyPaused && ct) {
        this.manuallyPaused = false;
        // Freeze consumed wall time at the instant the user clicked Pause (not when k6 exits),
        // so remaining duration matches 10s − 5s = 5s without SIGTERM/teardown skew.
        const endWall =
          typeof ct.pauseRequestedWallMs === 'number' ? ct.pauseRequestedWallMs : Date.now();
        const segmentElapsed = Math.max(0, endWall - ct.segmentWallStart);
        const newConsumed = Math.min(
          ct.originalDurationMs,
          ct.wallConsumedBeforeSegment + segmentElapsed
        );
        const remainingMs = Math.max(0, ct.originalDurationMs - newConsumed);

        this.resumeSession = {
          scenarioTestId: ct.scenarioTestId,
          logicalTestId: ct.logicalTestId,
          baseOptions: this._cloneSpawnOptions(ct.savedBaseOptions),
          originalDurationStr: ct.originalDurationStr,
          originalDurationMs: ct.originalDurationMs,
          consumedMs: newConsumed,
          remainingMs,
          segmentIndex: ct.segmentIndexForThisRun + 1,
          segmentResultFiles: [...ct.segmentResultFiles],
          runStartTime: ct.runStartTime || this.status.startTime,
          startedBy: this.status.startedBy,
          startedByUsername: this.status.startedByUsername,
          pausedAt: new Date().toISOString(),
        };

        this.status.running = false;
        this.status.endTime = new Date().toISOString();
        this.status.testId = ct.logicalTestId;
        this.status.progress =
          ct.originalDurationMs > 0
            ? Math.min(99, Math.round((newConsumed / ct.originalDurationMs) * 100))
            : 0;
        this.status.error = null;
        const pubOpts = { ...this.resumeSession.baseOptions };
        delete pubOpts.customEnv;
        this.status.options = {
          testId: ct.scenarioTestId,
          ...pubOpts,
          duration: ct.originalDurationStr,
        };

        this.currentTest = null;
        this.notifySubscribers('test-paused', {
          testId: ct.logicalTestId,
          remainingMs,
        });
        return;
      }

      if (this.manuallyReloading && ct && this.pendingLoadUpdate) {
        const pending = this.pendingLoadUpdate;
        this.pendingLoadUpdate = null;
        this.manuallyReloading = false;

        if (capturedMetricsInterval) {
          clearInterval(capturedMetricsInterval);
        }

        const def = this._loadUpdateDeferred;
        this._loadUpdateDeferred = null;

        const segmentElapsed = Math.max(0, Date.now() - ct.segmentWallStart);
        const consumedMs = Math.min(
          ct.originalDurationMs,
          ct.wallConsumedBeforeSegment + segmentElapsed
        );
        const newSegMs = this._parseDuration(pending.duration);
        if (newSegMs < 200) {
          this.currentTest = null;
          this.status.running = false;
          this.status.endTime = new Date().toISOString();
          this.status.progress =
            ct.originalDurationMs > 0
              ? Math.min(99, Math.round((consumedMs / ct.originalDurationMs) * 100))
              : 0;
          this.status.error = 'Duration too short for load update (minimum ~1s).';
          def?.reject(new Error(this.status.error));
          this.notifySubscribers('test-stopped', { testId: ct.logicalTestId });
          return;
        }

        // New logical total = time already consumed + only the next segment (user's new duration).
        // e.g. started 40s, change to 10s → next k6 runs 10s; total wall ≈ elapsed + 10s (not 40s + 10s).
        const newTotalMs = consumedMs + newSegMs;
        const newTotalStr = this._formatDurationMs(newTotalMs);
        const segmentDurStr = this._formatDurationMs(newSegMs);
        const opts = {
          ...this._cloneSpawnOptions(ct.savedBaseOptions),
          vus: pending.vus,
          duration: segmentDurStr,
        };

        const starter = {
          id: this.status.startedBy ?? null,
          username: this.status.startedByUsername ?? null,
        };

        this.currentTest = null;
        this.status.running = false;

        void (async () => {
          try {
            await this.startTest(ct.scenarioTestId, opts, starter, {
              logicalTestId: ct.logicalTestId,
              segmentIndex: ct.segmentIndexForThisRun + 1,
              wallConsumedBeforeSegment: consumedMs,
              originalDurationMs: newTotalMs,
              originalDurationStr: newTotalStr,
              segmentResultFiles: [...ct.segmentResultFiles],
              runStartTime: ct.runStartTime,
              loadUpdate: true,
            });
            def?.resolve({
              status: 'updated',
              message: `Load updated to ${pending.vus} VUs for ${segmentDurStr} (new segment).`,
            });
          } catch (err) {
            this.status.running = false;
            this.status.error = err?.message || 'Failed to restart test after load update';
            def?.reject(err);
            this.notifySubscribers('test-stopped', { testId: ct.logicalTestId });
          }
        })();
        return;
      }

      this.status.running = false;
      this.status.endTime = new Date().toISOString();
      this.status.progress = 100;

      if (this.manuallyStopped) {
        this.status.error = 'Test stopped by user';
      } else if (code !== 0) {
        this.status.error = `Test exited with code ${code}`;
      } else {
        this.status.error = null;
      }

      let results = null;
      const merged = ct ? this._parseNDJSONMerged(ct.segmentResultFiles) : null;
      if (merged) {
        results = {
          metrics: this.aggregateMetrics(merged.allMetrics, merged.failureInfo),
          summary: merged.summary,
        };
      }

      let finalStatus;
      if (this.manuallyStopped) {
        finalStatus = 'stopped';
      } else {
        finalStatus = code === 0 ? 'completed' : 'failed';
      }

      if (ct) {
        this.testHistory.unshift({
          id: ct.logicalTestId,
          testId: ct.testId,
          startTime: ct.runStartTime || ct.startTime,
          endTime: this.status.endTime,
          configuredDuration: ct.originalDurationStr || this.status.options?.duration || null,
          status: finalStatus,
          exitCode: code,
          environment: this.status.options?.environment || 'staging',
          startedBy: this.status.startedBy || null,
          startedByUsername: this.status.startedByUsername || null,
          stoppedBy: this.status.stoppedBy || null,
          stoppedByUsername: this.status.stoppedByUsername || null,
          results,
          outputSnapshot: Array.isArray(this.status.output)
            ? this.status.output.slice(-TEST_LIMITS.MAX_HISTORY_OUTPUT_SNAPSHOT)
            : [],
        });
      }

      if (this.testHistory.length > TEST_LIMITS.MAX_TEST_HISTORY) {
        const dropped = this.testHistory.splice(TEST_LIMITS.MAX_TEST_HISTORY);
        const reportsDir = getReportsDir();
        for (const entry of dropped) {
          deleteReportFilesForTestId(reportsDir, entry.id);
        }
      }
      saveHistoryToDisk(this.testHistory);

      if (ct?.segmentResultFiles?.length) {
        const reportsDir = getReportsDir();
        const { maxFileMb } = getReportRetentionConfig();
        compactOversizedNdjsonFiles(reportsDir, maxFileMb * 1024 * 1024);
      }
      this.runReportMaintenance();

      const notificationStatus = this.manuallyStopped
        ? 'stopped'
        : code === 0
          ? 'completed'
          : 'failed';

      this.notifySubscribers('test-complete', {
        testId: ct?.logicalTestId,
        status: notificationStatus,
        results,
      });

      this.currentTest = null;
    });

    this.notifySubscribers('test-started', {
      testId: logicalTestId,
      testName: test.name,
      resumed: Boolean(resumeMerge),
      loadUpdate: Boolean(resumeMerge?.loadUpdate),
      startedBy: this.status.startedBy || null,
      startedByUsername: this.status.startedByUsername || null,
    });

    return {
      testId: logicalTestId,
      status: 'started',
      message: `Test "${test.name}" started`,
    };
  }

  /**
   * Change VUs and duration mid-run (Locust-style). k6 cannot adjust load live;
   * we SIGTERM the current process and start a new segment with the new settings,
   * preserving one logical run id and merging NDJSON like pause/resume.
   * @returns {Promise<{ status: string, message: string }>}
   */
  updateRunningLoad({ vus, duration }, startedBy = null) {
    if (this.manuallyReloading || this.pendingLoadUpdate) {
      return Promise.reject(new Error('A load update is already in progress.'));
    }
    if (!this.status.running || !this.currentTest?.process) {
      return Promise.reject(new Error('No test is currently running.'));
    }
    if (this.resumeSession) {
      return Promise.reject(new Error('Cannot update load while a paused session exists.'));
    }

    return new Promise((resolve, reject) => {
      this._loadUpdateDeferred = { resolve, reject };
      this.pendingLoadUpdate = {
        vus: Number(vus),
        duration: String(duration),
        startedBy: startedBy ? { id: startedBy.id, username: startedBy.username } : null,
      };
      this.manuallyReloading = true;
      this.manuallyPaused = false;
      this.manuallyStopped = false;

      const ct = this.currentTest;
      if (ct?.progressInterval) {
        clearInterval(ct.progressInterval);
        ct.progressInterval = null;
      }
      if (ct?.metricsInterval) {
        clearInterval(ct.metricsInterval);
        ct.metricsInterval = null;
      }

      ct.process.kill('SIGTERM');
    });
  }

  /**
   * Pause the running k6 process; remaining duration is computed on resume.
   */
  pauseTest(stoppedBy = null) {
    if (!this.status.running || !this.currentTest?.process) {
      throw new Error('No test is currently running');
    }
    this.manuallyPaused = true;
    this.manuallyStopped = false;

    this.status.stoppedBy = stoppedBy?.id ?? null;
    this.status.stoppedByUsername = stoppedBy?.username ?? null;

    if (this.currentTest.progressInterval) {
      clearInterval(this.currentTest.progressInterval);
      this.currentTest.progressInterval = null;
    }

    this.currentTest.pauseRequestedWallMs = Date.now();
    this.currentTest.process.kill('SIGTERM');
    // Keep status.running true until the `close` handler runs so resumeSession
    // exists before another client can pass the "no paused session" start gate.

    return {
      status: 'pausing',
      message: 'Pausing test…',
    };
  }

  /**
   * Resume a session created by pauseTest().
   */
  async resumeTest(startedBy = null) {
    this._expireStalePausedResumeIfNeeded();
    const snap = this.resumeSession;
    if (!snap) {
      throw new Error('No paused test to resume');
    }
    if (snap.remainingMs < 200) {
      this.resumeSession = null;
      throw new Error('No meaningful time left on this test. Start a new run instead.');
    }

    const nextDur = this._formatDurationMs(snap.remainingMs);
    const opts = { ...snap.baseOptions, duration: nextDur };
    this.resumeSession = null;
    try {
      return await this.startTest(snap.scenarioTestId, opts, startedBy, {
        logicalTestId: snap.logicalTestId,
        segmentIndex: snap.segmentIndex,
        wallConsumedBeforeSegment: snap.consumedMs,
        originalDurationMs: snap.originalDurationMs,
        originalDurationStr: snap.originalDurationStr,
        segmentResultFiles: snap.segmentResultFiles,
        runStartTime: snap.runStartTime,
      });
    } catch (err) {
      this.resumeSession = snap;
      throw err;
    }
  }

  /**
   * Stop current test
   * @param {{ id?: number|string, username?: string }|null} stoppedBy — user who requested stop (for UI)
   */
  stopTest(stoppedBy = null) {
    this._expireStalePausedResumeIfNeeded();
    if (this.status.running && this.currentTest?.process) {
      this.manuallyStopped = true;
      this.manuallyPaused = false;
      if (this.manuallyReloading) {
        this.manuallyReloading = false;
        this.pendingLoadUpdate = null;
        const def = this._loadUpdateDeferred;
        this._loadUpdateDeferred = null;
        def?.reject(new Error('Test stopped during load update'));
      }
      this.resumeSession = null;

      this.status.stoppedBy = stoppedBy?.id ?? null;
      this.status.stoppedByUsername = stoppedBy?.username ?? null;

      if (this.currentTest.progressInterval) {
        clearInterval(this.currentTest.progressInterval);
        this.currentTest.progressInterval = null;
      }

      this.currentTest.process.kill('SIGTERM');
      this.status.running = false;
      this.status.endTime = new Date().toISOString();
      this.status.error = 'Test stopped by user';

      this.notifySubscribers('test-stopped', {
        testId: this.status.testId,
      });

      return {
        status: 'stopped',
        message: 'Test stopped successfully',
      };
    }

    if (this.resumeSession) {
      this._discardPausedResumeSession(stoppedBy, 'Test stopped by user', {
        historyStatus: 'stopped',
      });
      return {
        status: 'discarded',
        message: 'Paused session discarded.',
      };
    }

    throw new Error('No test is currently running');
  }

  /**
   * Discard paused-for-resume state (user Stop or idle timeout).
   * @param {{ id?: number|string, username?: string }|null} stoppedBy
   * @param {string} errorMessage persisted on `status.error` for clients
   * @param {{ historyStatus?: 'stopped'|'paused' }} [opts] idle expiry uses `paused` in history; user discard uses `stopped`
   */
  _discardPausedResumeSession(stoppedBy, errorMessage, opts = {}) {
    const snap = this.resumeSession;
    if (!snap) {
      return false;
    }

    this.resumeSession = null;

    this.status.stoppedBy = stoppedBy?.id ?? null;
    this.status.stoppedByUsername = stoppedBy?.username ?? null;
    this.status.error = errorMessage;
    this.status.endTime = new Date().toISOString();
    this.status.progress = 100;

    const historyStatus = opts.historyStatus === 'paused' ? 'paused' : 'stopped';

    const existingPaths = Array.isArray(snap.segmentResultFiles)
      ? snap.segmentResultFiles.filter((p) => typeof p === 'string' && existsSync(p))
      : [];
    let merged = null;
    if (existingPaths.length > 1) {
      merged = this._parseNDJSONMerged(existingPaths);
    } else if (existingPaths.length === 1) {
      merged = this._parseNDJSONFile(existingPaths[0]);
    }
    let results = null;
    if (merged) {
      results = {
        metrics: this.aggregateMetrics(merged.allMetrics, merged.failureInfo),
        summary: merged.summary,
      };
    }

    this.testHistory.unshift({
      id: snap.logicalTestId,
      testId: snap.scenarioTestId,
      startTime: snap.runStartTime || this.status.startTime,
      endTime: this.status.endTime,
      configuredDuration: snap.originalDurationStr || null,
      status: historyStatus,
      exitCode: 130,
      environment: snap.baseOptions?.environment || this.status.options?.environment || 'staging',
      startedBy: snap.startedBy ?? this.status.startedBy ?? null,
      startedByUsername: snap.startedByUsername || this.status.startedByUsername || null,
      stoppedBy: this.status.stoppedBy || null,
      stoppedByUsername: this.status.stoppedByUsername || null,
      results,
      outputSnapshot: Array.isArray(this.status.output)
        ? this.status.output.slice(-TEST_LIMITS.MAX_HISTORY_OUTPUT_SNAPSHOT)
        : [],
    });
    if (this.testHistory.length > TEST_LIMITS.MAX_TEST_HISTORY) {
      const dropped = this.testHistory.splice(TEST_LIMITS.MAX_TEST_HISTORY);
      const reportsDir = getReportsDir();
      for (const entry of dropped) {
        deleteReportFilesForTestId(reportsDir, entry.id);
      }
    }
    saveHistoryToDisk(this.testHistory);
    this.runReportMaintenance();

    this.notifySubscribers('test-stopped', {
      testId: snap.logicalTestId,
    });

    return true;
  }

  /** Auto-close resume sessions left idle past the exclusive window (matches API prepare lock). */
  _expireStalePausedResumeIfNeeded() {
    const rs = this.resumeSession;
    if (!rs) {
      return;
    }
    const refIso = rs.pausedAt || this.status.endTime;
    if (!refIso) {
      return;
    }
    const age = Date.now() - new Date(refIso).getTime();
    if (age < PAUSED_RESUME_EXCLUSIVE_MS) {
      return;
    }
    this._discardPausedResumeSession(null, 'Paused session expired after 5 minutes.', {
      historyStatus: 'paused',
    });
  }

  /**
   * Get current status
   */
  setPreparing(user) {
    this.preparingUser = { id: user.id, username: user.username };
    this.notifySubscribers('test-preparing', { preparingUser: this.preparingUser });
  }

  clearPreparing() {
    if (!this.preparingUser) {
      return;
    }
    this.preparingUser = null;
    this.notifySubscribers('test-preparing', { preparingUser: null });
  }

  getStatus() {
    this._expireStalePausedResumeIfNeeded();
    // Create a clean status object without non-serializable properties
    // Explicitly list all properties to avoid circular references
    const cleanStatus = {
      running: this.status.running,
      preparingUser: this.preparingUser || null,
      startedBy: this.status.startedBy || null,
      startedByUsername: this.status.startedByUsername || null,
      stoppedBy: this.status.stoppedBy ?? null,
      stoppedByUsername: this.status.stoppedByUsername ?? null,
      testId: this.status.testId,
      testName: this.status.testName,
      startTime: this.status.startTime,
      endTime: this.status.endTime,
      progress: this.status.progress,
      output: this.status.output ? [...this.status.output] : [],
      error: this.status.error,
      options: this.status.options ? { ...this.status.options } : null,
      pausedForResume: Boolean(this.resumeSession),
      resumeInfo: this._publicResumeSession(),
      metrics: this.status.metrics || null,
      history: this.testHistory.slice(0, 10).map((test) => ({
        id: test.id,
        testId: test.testId,
        startTime: test.startTime,
        endTime: test.endTime,
        configuredDuration: test.configuredDuration || null,
        status: test.status,
        exitCode: test.exitCode,
        environment: test.environment || 'staging',
        startedBy: test.startedBy || null,
        startedByUsername: test.startedByUsername || null,
        stoppedBy: test.stoppedBy || null,
        stoppedByUsername: test.stoppedByUsername || null,
        results: test.results || null,
        outputSnapshot: test.outputSnapshot || null,
      })),
    };

    return cleanStatus;
  }

  /**
   * Get test history
   */
  getHistory(limit = 50) {
    return this.testHistory.slice(0, limit);
  }

  /**
   * Metadata for HTML/PDF exports: scenario, outcome (completed / stopped / paused / …), who stopped, etc.
   */
  buildRunExportMeta(testId) {
    const h = this.testHistory.find((t) => t.id === testId);
    if (h) {
      return {
        runId: h.id,
        scenarioSlug: h.testId,
        status: h.status,
        startTime: h.startTime,
        endTime: h.endTime,
        configuredDuration: h.configuredDuration,
        environment: h.environment ?? 'staging',
        startedByUsername: h.startedByUsername ?? null,
        stoppedByUsername: h.stoppedByUsername ?? null,
        exitCode: h.exitCode ?? null,
      };
    }
    const ct = this.currentTest;
    if (ct && ct.logicalTestId === testId) {
      return {
        runId: testId,
        scenarioSlug: ct.scenarioTestId || null,
        status: 'running',
        startTime: ct.runStartTime || ct.startTime || this.status.startTime,
        endTime: null,
        configuredDuration: ct.originalDurationStr || null,
        environment: this.status.options?.environment || 'staging',
        startedByUsername: this.status.startedByUsername ?? null,
        stoppedByUsername: null,
        exitCode: null,
      };
    }
    const rs = this.resumeSession;
    if (rs && rs.logicalTestId === testId) {
      return {
        runId: testId,
        scenarioSlug: rs.scenarioTestId || null,
        status: 'paused',
        startTime: rs.runStartTime || null,
        endTime: null,
        configuredDuration: rs.originalDurationStr || null,
        environment: rs.baseOptions?.environment || 'staging',
        startedByUsername: rs.startedByUsername || null,
        stoppedByUsername: null,
        exitCode: null,
      };
    }
    return {
      runId: testId,
      scenarioSlug: null,
      status: 'unknown',
      startTime: null,
      endTime: null,
      configuredDuration: null,
      environment: null,
      startedByUsername: null,
      stoppedByUsername: null,
      exitCode: null,
    };
  }

  attachRunMeta(testId, payload) {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }
    return {
      ...payload,
      run: this.buildRunExportMeta(testId),
    };
  }

  /**
   * Get test results (finished history row, or in-memory paused / active segment files).
   */
  getTestResults(testId) {
    const buildFromPaths = (segmentPaths) => {
      if (!segmentPaths || !segmentPaths.length) {
        return null;
      }
      const existing = segmentPaths.filter((p) => typeof p === 'string' && existsSync(p));
      if (!existing.length) {
        return null;
      }
      const parsed =
        existing.length > 1
          ? this._parseNDJSONMerged(existing)
          : this._parseNDJSONFile(existing[0]);
      if (!parsed) {
        return null;
      }
      return {
        metrics: this.aggregateMetrics(parsed.allMetrics, parsed.failureInfo),
        summary: parsed.summary,
        chartSeries: parsed.chartSeries || null,
      };
    };

    const test = this.testHistory.find((t) => t.id === testId);
    if (test) {
      const reportsDir = getReportsDir();
      const segmentPaths = [join(reportsDir, `${testId}.json`)];
      let i = 1;
      while (existsSync(join(reportsDir, `${testId}-r${i}.json`))) {
        segmentPaths.push(join(reportsDir, `${testId}-r${i}.json`));
        i += 1;
      }
      const fromDisk = buildFromPaths(segmentPaths);
      if (fromDisk) {
        return this.attachRunMeta(testId, fromDisk);
      }
      if (test.results) {
        return this.attachRunMeta(testId, { ...test.results });
      }
    }

    // Paused-for-resume: logical id is not in history yet, but NDJSON segments exist on disk.
    const rs = this.resumeSession;
    if (rs && rs.logicalTestId === testId && Array.isArray(rs.segmentResultFiles)) {
      const fromPause = buildFromPaths(rs.segmentResultFiles);
      if (fromPause) {
        return this.attachRunMeta(testId, fromPause);
      }
    }

    const ct = this.currentTest;
    if (ct && ct.logicalTestId === testId && Array.isArray(ct.segmentResultFiles)) {
      const fromRun = buildFromPaths(ct.segmentResultFiles);
      if (fromRun) {
        return this.attachRunMeta(testId, fromRun);
      }
    }

    // Same on-disk layout as history rows (paused run may not be in history yet).
    const reportsDir = getReportsDir();
    const diskPaths = [join(reportsDir, `${testId}.json`)];
    let j = 1;
    while (existsSync(join(reportsDir, `${testId}-r${j}.json`))) {
      diskPaths.push(join(reportsDir, `${testId}-r${j}.json`));
      j += 1;
    }
    const fromDiskOnly = buildFromPaths(diskPaths);
    if (fromDiskOnly) {
      return this.attachRunMeta(testId, fromDiskOnly);
    }

    if (this.status.testId === testId && this.status.metrics) {
      return this.attachRunMeta(testId, {
        metrics: this.status.metrics,
        summary: null,
        chartSeries: null,
      });
    }

    throw new Error(`Test "${testId}" not found in history`);
  }

  /**
   * Delete test history entry
   */
  deleteTestHistory(testId) {
    const index = this.testHistory.findIndex((t) => t.id === testId);
    if (index === -1) {
      throw new Error(`Test "${testId}" not found in history`);
    }

    this.testHistory.splice(index, 1);
    saveHistoryToDisk(this.testHistory);

    deleteReportFilesForTestId(getReportsDir(), testId);

    // Notify subscribers about history update
    this.notifySubscribers('history-updated', {
      testId,
      action: 'deleted',
    });

    return {
      status: 'deleted',
      message: `Test "${testId}" deleted from history`,
    };
  }

  /**
   * Remove every history entry and associated report files (admin-only API).
   */
  clearAllTestHistory() {
    const ids = this.testHistory.map((t) => t.id);
    const deletedCount = ids.length;
    this.testHistory = [];
    saveHistoryToDisk(this.testHistory);

    const reportsDir = getReportsDir();
    let reportFilesRemoved = 0;
    for (const testId of ids) {
      reportFilesRemoved += deleteReportFilesForTestId(reportsDir, testId);
    }

    this.notifySubscribers('history-updated', {
      action: 'cleared-all',
      deletedCount,
      reportFilesRemoved,
    });

    return { deletedCount, reportFilesRemoved };
  }

  /**
   * Start reading metrics from JSON file periodically.
   * Incrementally tails the NDJSON results file every second, accumulates
   * metric points (capped at MAX_METRIC_VALUES to bound memory), and
   * self-stops ~6 s after the test process exits so the interval never leaks.
   */
  startMetricsReader(testId) {
    const resultsFile = join(getReportsDir(), `${testId}.json`);
    const { MAX_METRIC_VALUES } = TEST_LIMITS;
    let lastPosition = 0;
    const allMetrics = {};
    const failureInfo = {};
    let testEndedAt = null; // timestamp when we first observed running=false

    const readMetricsTick = () => {
      if (!existsSync(resultsFile)) {
        return;
      }

      // Track when the test stopped so we can self-stop 6 s later
      if (!this.status.running && testEndedAt === null) {
        testEndedAt = Date.now();
      }
      if (testEndedAt !== null && Date.now() - testEndedAt > 6000) {
        clearInterval(this.currentTest.metricsInterval);
        return;
      }

      try {
        const stat = statSync(resultsFile);
        if (stat.size <= lastPosition) {
          return;
        }

        let readStart = lastPosition;
        let readLen = stat.size - lastPosition;
        if (stat.size > TEST_LIMITS.MAX_REPORT_FILE_BYTES) {
          const tail = TEST_LIMITS.MAX_REPORT_TAIL_READ_BYTES;
          readStart = Math.max(lastPosition, stat.size - tail);
          readLen = stat.size - readStart;
        }

        const buf = Buffer.alloc(readLen);
        const fd = openSync(resultsFile, 'r');
        readSync(fd, buf, 0, readLen, readStart);
        closeSync(fd);

        const newContent = buf.toString('utf-8');
        if (!newContent.trim()) {
          lastPosition = stat.size;
          return;
        }

        const lines = newContent
          .trim()
          .split('\n')
          .filter((l) => l.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'Point' && parsed.data && parsed.metric) {
              const metricName = parsed.metric;
              const { value, time, tags } = parsed.data;

              if (!allMetrics[metricName]) {
                allMetrics[metricName] = { values: [], times: [] };
              }
              const m = allMetrics[metricName];
              m.values.push(value);
              m.times.push(time);
              // Bound memory: trim to a sliding window when the cap is exceeded
              if (m.values.length > MAX_METRIC_VALUES + 500) {
                m.values = m.values.slice(-MAX_METRIC_VALUES);
                m.times = m.times.slice(-MAX_METRIC_VALUES);
              }

              const tagName = tags && tags.name;
              if (
                tagName &&
                (metricName === 'http_req_duration' ||
                  metricName === 'http_reqs' ||
                  metricName === 'http_req_failed')
              ) {
                const taggedKey = `${metricName}__url__${tagName}`;
                if (!allMetrics[taggedKey]) {
                  allMetrics[taggedKey] = { values: [], times: [] };
                }
                const tm = allMetrics[taggedKey];
                tm.values.push(value);
                tm.times.push(time);
                if (tm.values.length > MAX_METRIC_VALUES + 500) {
                  tm.values = tm.values.slice(-MAX_METRIC_VALUES);
                  tm.times = tm.times.slice(-MAX_METRIC_VALUES);
                }
              }

              if (metricName === 'http_req_failed' && value === 1) {
                this.trackFailure(failureInfo, tags);
              }
            }
          } catch {
            /* skip invalid lines */
          }
        }

        const aggregated = this.aggregateMetrics(allMetrics, failureInfo);
        if (Object.keys(aggregated).length > 0) {
          this.status.metrics = aggregated;
          this.notifySubscribers('metrics', aggregated);
        }

        lastPosition = stat.size;
      } catch {
        /* file may be locked or not yet written */
      }
    };

    readMetricsTick();
    this.currentTest.metricsInterval = setInterval(readMetricsTick, 1000);
  }

  /**
   * Calculate percentile from sorted array
   */
  calculatePercentile(sortedValues, percentile) {
    if (!sortedValues || sortedValues.length === 0) {
      return 0;
    }
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  /**
   * Track a failed request into the failureInfo map
   * failureInfo[urlName][statusCode] = { count, errors[] }
   */
  trackFailure(failureInfo, tags) {
    if (!tags) {
      return;
    }
    const urlName = tags.name || '__total__';
    const status = String(tags.status || '0');
    const error = tags.error || '';
    const errorCode = tags.error_code ? String(tags.error_code) : '';
    const endpoint = tags.url || '';
    const method = tags.method || '';

    if (!failureInfo[urlName]) {
      failureInfo[urlName] = {};
    }
    if (!failureInfo[urlName][status]) {
      failureInfo[urlName][status] = { count: 0, errors: [], endpoints: [], method, errorCode };
    }
    failureInfo[urlName][status].count++;
    if (error && !failureInfo[urlName][status].errors.includes(error)) {
      failureInfo[urlName][status].errors.push(error);
    }
    if (endpoint && !failureInfo[urlName][status].endpoints.includes(endpoint)) {
      failureInfo[urlName][status].endpoints.push(endpoint);
    }
  }

  /**
   * Aggregate metrics from raw points
   */
  aggregateMetrics(allMetrics, failureInfo = {}) {
    const aggregated = {};

    for (const [metricName, data] of Object.entries(allMetrics)) {
      if (!data.values || data.values.length === 0) {
        continue;
      }

      const { values } = data;
      const { times } = data;
      const count = values.length;

      // Strip the __url__<name> suffix so tagged metrics are handled the same as base metrics
      const baseMetricName = metricName.split('__url__')[0];

      const isCounter =
        baseMetricName.includes('_reqs') ||
        baseMetricName.includes('received') ||
        baseMetricName.includes('sent') ||
        baseMetricName.includes('iterations') ||
        baseMetricName === 'checks';

      // For counter metrics, handle differently based on metric type
      if (isCounter) {
        if (baseMetricName === 'http_reqs' || baseMetricName === 'iterations') {
          // For http_reqs and iterations, each Point with value=1 represents one event
          // Total count is the number of Points (or sum of values)
          const sum = values.reduce((a, b) => a + b, 0);
          const totalCount = sum > 0 ? sum : count;

          // Calculate rate: events per second using a rolling window
          // Use last 5 seconds of data for more accurate real-time rate
          let rate = 0;
          if (times.length >= 2) {
            const windowSeconds = 5; // 5 second window
            const lastTime = new Date(times[times.length - 1]).getTime();
            const windowStart = lastTime - windowSeconds * 1000;

            // Find points within the window (last 5 seconds)
            const windowValues = [];
            const windowTimes = [];
            for (let i = times.length - 1; i >= 0; i--) {
              const pointTime = new Date(times[i]).getTime();
              if (pointTime >= windowStart) {
                windowValues.unshift(values[i]);
                windowTimes.unshift(times[i]);
              } else {
                break; // Points are in chronological order
              }
            }

            if (windowValues.length >= 2) {
              const windowSum = windowValues.reduce((a, b) => a + b, 0);
              const firstTime = new Date(windowTimes[0]).getTime();
              const lastTimeInWindow = new Date(windowTimes[windowTimes.length - 1]).getTime();
              const timeDiff = (lastTimeInWindow - firstTime) / 1000;

              if (timeDiff > 0) {
                rate = windowSum / Math.max(timeDiff, MIN_HTTP_REQ_RATE_WINDOW_SEC);
              } else if (windowValues.length > 0) {
                // If all points have same timestamp, use count / window size
                rate = windowSum / windowSeconds;
              }
            } else if (times.length >= 2) {
              // Fallback: use last 2 points for immediate rate
              const last2Values = values.slice(-2);
              const last2Times = times.slice(-2);
              const last2Sum = last2Values.reduce((a, b) => a + b, 0);
              const t1 = new Date(last2Times[0]).getTime();
              const t2 = new Date(last2Times[1]).getTime();
              const timeDiff = (t2 - t1) / 1000;
              if (timeDiff > 0 && timeDiff <= 10) {
                rate = last2Sum / Math.max(timeDiff, MIN_HTTP_REQ_RATE_WINDOW_SEC);
              } else if (times.length >= 2) {
                // Final fallback: use all data
                const firstTime = new Date(times[0]).getTime();
                const lastTime = new Date(times[times.length - 1]).getTime();
                const totalTimeDiff = (lastTime - firstTime) / 1000;
                if (totalTimeDiff > 0) {
                  rate = totalCount / Math.max(totalTimeDiff, MIN_HTTP_REQ_RATE_WINDOW_SEC);
                }
              }
            }
          }

          aggregated[metricName] = {
            count: totalCount,
            rate,
          };
        } else {
          // For data_received and data_sent, each Point has the size of one request/response
          // Total is sum of all values, rate is sum per second
          const sum = values.reduce((a, b) => a + b, 0);

          let rate = 0;
          if (times.length >= 2) {
            const firstTime = new Date(times[0]).getTime();
            const lastTime = new Date(times[times.length - 1]).getTime();
            const timeDiff = (lastTime - firstTime) / 1000;

            if (timeDiff > 0) {
              rate = sum / timeDiff; // Bytes per second
            } else {
              // Use recent window
              const recentWindow = Math.min(10, times.length);
              if (recentWindow >= 2) {
                const recentTimes = times.slice(-recentWindow);
                const recentValues = values.slice(-recentWindow);
                const recentSum = recentValues.reduce((a, b) => a + b, 0);

                const t1 = new Date(recentTimes[0]).getTime();
                const t2 = new Date(recentTimes[recentTimes.length - 1]).getTime();
                const recentTimeDiff = (t2 - t1) / 1000;
                if (recentTimeDiff > 0) {
                  rate = recentSum / recentTimeDiff;
                }
              }
            }
          }

          aggregated[metricName] = {
            count: sum, // Total bytes
            rate, // Bytes per second
          };
        }
      } else if (baseMetricName === 'http_req_failed') {
        // For http_req_failed metric, value=0 means success, value=1 means failure
        // Calculate failure rate: (failed requests / total requests) * 100
        const totalRequests = values.length;
        const failedRequests = values.filter((v) => v === 1).length;
        const failureRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

        aggregated[metricName] = {
          count: failedRequests, // Number of failed requests
          rate: failureRate, // Failure rate as decimal (0.0 to 1.0)
        };
      } else if (baseMetricName === 'checks') {
        // For checks metric, value=0 means failed, value=1 means passed
        // Calculate total checks, passed checks, and failed checks
        const totalChecks = values.length;
        const passedChecks = values.filter((v) => v === 1).length;
        const failedChecks = values.filter((v) => v === 0).length;
        const passRate = totalChecks > 0 ? passedChecks / totalChecks : 0;
        const failRate = totalChecks > 0 ? failedChecks / totalChecks : 0;

        aggregated[metricName] = {
          count: totalChecks,
          passed: passedChecks,
          failed: failedChecks,
          passRate,
          failRate,
        };
      } else {
        // For non-counter metrics (like duration), calculate statistics
        const sum = values.reduce((a, b) => a + b, 0);
        const min = Math.min(...values);
        const max = Math.max(...values);

        // For duration metrics, calculate percentiles
        let percentiles = {};
        if (baseMetricName.includes('duration') || baseMetricName.includes('_duration')) {
          const sortedValues = [...values].sort((a, b) => a - b);
          percentiles = {
            p50: this.calculatePercentile(sortedValues, 50),
            p95: this.calculatePercentile(sortedValues, 95),
            p99: this.calculatePercentile(sortedValues, 99),
          };
        }

        aggregated[metricName] = {
          count,
          avg: sum / count,
          min: min === Infinity ? 0 : min,
          max: max === -Infinity ? 0 : max,
          // Add percentiles for duration metrics
          ...(Object.keys(percentiles).length > 0 ? { values: percentiles } : {}),
        };

        // For http_req_duration, also calculate distribution
        if (baseMetricName === 'http_req_duration') {
          const distribution = this.calculateResponseTimeDistribution(values);
          aggregated[metricName].distribution = distribution;
        }
      }
    }

    // Attach failure details (status codes + error messages per URL)
    if (Object.keys(failureInfo).length > 0) {
      aggregated.failure_details = failureInfo;
    }

    // Build per-URL stats from tagged metric keys
    const urlStats = {};
    for (const key of Object.keys(aggregated)) {
      const match = key.match(/^(.+)__url__(.+)$/);
      if (match) {
        const metricBase = match[1];
        const urlName = match[2];
        if (!urlStats[urlName]) {
          urlStats[urlName] = {};
        }
        urlStats[urlName][metricBase] = aggregated[key];
        delete aggregated[key];
      }
    }
    if (Object.keys(urlStats).length > 0) {
      aggregated.url_stats = urlStats;
    }

    return aggregated;
  }

  /**
   * Calculate response time distribution from raw values
   */
  calculateResponseTimeDistribution(values) {
    if (!values || values.length === 0) {
      return {
        '<100ms': 0,
        '100-200ms': 0,
        '200-500ms': 0,
        '500-1000ms': 0,
        '1-2s': 0,
        '>2s': 0,
      };
    }

    const distribution = {
      '<100ms': 0,
      '100-200ms': 0,
      '200-500ms': 0,
      '500-1000ms': 0,
      '1-2s': 0,
      '>2s': 0,
    };

    for (const value of values) {
      if (value < 100) {
        distribution['<100ms']++;
      } else if (value < 200) {
        distribution['100-200ms']++;
      } else if (value < 500) {
        distribution['200-500ms']++;
      } else if (value < 1000) {
        distribution['500-1000ms']++;
      } else if (value < 2000) {
        distribution['1-2s']++;
      } else {
        distribution['>2s']++;
      }
    }

    return distribution;
  }

  /** Current count of sockets subscribed for live updates (metrics/output). */
  getLiveSubscriberCount() {
    return this.subscribers.size;
  }

  /**
   * Add WebSocket subscriber
   */
  addSubscriber(ws) {
    // Check if we've reached the subscriber limit
    if (this.subscribers.size >= TEST_LIMITS.MAX_WEBSOCKET_SUBSCRIBERS) {
      wsWarn('subscriber_cap_evict', {
        max: TEST_LIMITS.MAX_WEBSOCKET_SUBSCRIBERS,
        message: 'Evicting oldest WebSocket to make room',
      });

      // Close the oldest subscriber (first one in the set)
      const iterator = this.subscribers.values();
      const oldest = iterator.next().value;
      if (oldest && oldest.readyState === 1) {
        oldest.close(1008, 'Maximum subscribers reached');
      }
      this.subscribers.delete(oldest);
    }

    this.subscribers.add(ws);
    const u = ws.user;
    wsRoutine('live_subscribed', {
      traceId: ws.traceId,
      username: u?.username,
      userId: u?.id,
      subscribers: this.subscribers.size,
      subscribersMax: TEST_LIMITS.MAX_WEBSOCKET_SUBSCRIBERS,
    });
  }

  /**
   * Remove WebSocket subscriber
   */
  removeSubscriber(ws) {
    this.subscribers.delete(ws);
  }

  /**
   * Notify all subscribers
   * State-change events (start / stop / complete / history) trigger a full
   * status broadcast so the UI stays in sync.  High-frequency events like
   * 'metrics' and 'output' do NOT re-broadcast status to avoid serialising
   * and transmitting the full output buffer (up to 1 000 lines) every second.
   */
  notifySubscribers(type, data) {
    const message = JSON.stringify({
      type,
      data,
      timestamp: new Date().toISOString(),
    });

    // All authenticated subscribers receive all events — this is a shared team tool
    // and everyone should see what test is running and its live output/metrics.
    // Access control is enforced at the WebSocket handshake (requireAuth + tokenVersion).
    this.subscribers.forEach((ws) => {
      if (ws.readyState === 1) {
        try {
          ws.send(message);
        } catch (error) {
          wsWarn('notify_send_failed', { err: error });
          this.subscribers.delete(ws);
        }
      } else {
        this.subscribers.delete(ws);
      }
    });

    // Only broadcast a full status snapshot on true state-change events
    const STATE_CHANGE_EVENTS = new Set([
      'test-started',
      'test-stopped',
      'test-complete',
      'test-paused',
      'history-updated',
    ]);
    if (STATE_CHANGE_EVENTS.has(type)) {
      this.notifySubscribers('status', this.getStatus());
    }
  }

  /**
   * Create a k6 test from cURL command
   */
  async createCurlTest(testName, request, options = {}) {
    const { writeFile } = await import('fs/promises');
    const testsDir = join(PROJECT_ROOT, 'tests', 'scenarios');

    // Sanitize testName to prevent path traversal
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (safeName !== testName) {
      throw new Error('Test name may only contain letters, numbers, hyphens, and underscores.');
    }

    // Ensure tests directory exists
    if (!existsSync(testsDir)) {
      mkdirSync(testsDir, { recursive: true });
    }

    const testFile = join(testsDir, `${testName}.js`);

    // Check if test already exists
    if (existsSync(testFile)) {
      throw new Error(`Test "${testName}" already exists. Please choose a different name.`);
    }

    const team = options.team && TEAMS.includes(options.team) ? options.team : '';
    const displayName = `cURL: ${testName}`;
    const description = `Load test for ${request.method} ${request.url}`;

    // Generate k6 test script
    const testScript = this.generateK6Script(testName, request, {
      team,
      name: displayName,
      description,
      vus: options.vus || 10,
      duration: options.duration || '5m',
    });

    // Write test file
    await writeFile(testFile, testScript, 'utf8');

    // Register the new test in TEST_SCENARIOS
    TEST_SCENARIOS[testName] = {
      name: displayName,
      file: `${testName}.js`,
      description,
      team,
      mode: 'curl',
      defaultVUs: options.vus || 10,
      defaultDuration: options.duration || '5m',
    };

    logger.info({ event: 'curl_test_created', testName }, 'curl_test_created');

    return {
      testId: testName,
      testFile,
      message: `Test "${testName}" created successfully`,
    };
  }

  /**
   * Delete a test scenario
   */
  async deleteTest(testId) {
    const { unlink } = await import('fs/promises');

    // Check if test exists
    const test = TEST_SCENARIOS[testId];
    if (!test) {
      throw new Error(`Test "${testId}" not found`);
    }

    // Get test file path
    const testsDir = join(PROJECT_ROOT, 'tests', 'scenarios');
    const testFile = join(testsDir, test.file);

    // Check if file exists
    if (!existsSync(testFile)) {
      throw new Error(`Test file not found: ${test.file}`);
    }

    // Delete the test file
    try {
      await unlink(testFile);
      logger.info({ event: 'test_file_deleted', testFile }, 'test_file_deleted');
    } catch (error) {
      throw new Error(`Failed to delete test file: ${error.message}`);
    }

    // Remove from TEST_SCENARIOS
    delete TEST_SCENARIOS[testId];

    logger.info({ event: 'test_deleted', testId }, 'test_deleted');

    return {
      testId,
      message: `Test "${testId}" deleted successfully`,
    };
  }

  /**
   * Create a multi-step chained test from cURL steps
   */
  async createCurlChainTest(testName, steps, options = {}) {
    const { writeFile } = await import('fs/promises');
    const testsDir = join(PROJECT_ROOT, 'tests', 'scenarios');

    // Sanitize testName to prevent path traversal
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (safeName !== testName) {
      throw new Error('Test name may only contain letters, numbers, hyphens, and underscores.');
    }

    if (!existsSync(testsDir)) {
      mkdirSync(testsDir, { recursive: true });
    }

    const testFile = join(testsDir, `${testName}.js`);

    if (existsSync(testFile)) {
      throw new Error(`Test "${testName}" already exists. Please choose a different name.`);
    }

    const team = options.team && TEAMS.includes(options.team) ? options.team : '';
    const displayName = `Chain: ${testName}`;
    const description = `Multi-step scenario (${steps.length} step${steps.length !== 1 ? 's' : ''})`;

    const testScript = this.generateK6ChainScript(testName, steps, {
      team,
      name: displayName,
      description,
      vus: options.vus || 10,
      duration: options.duration || '5m',
      debugLog: Boolean(options.debugLog),
    });

    await writeFile(testFile, testScript, 'utf8');

    TEST_SCENARIOS[testName] = {
      name: displayName,
      file: `${testName}.js`,
      description,
      team,
      mode: 'curl',
      steps: steps.map((s) => ({ method: s.method, url: s.url, label: s.label || '' })),
      defaultVUs: options.vus || 10,
      defaultDuration: options.duration || '5m',
    };

    logger.info(
      { event: 'curl_chain_created', testName, stepCount: steps.length },
      'curl_chain_created'
    );

    return {
      testId: testName,
      testFile,
      message: `Test "${testName}" created successfully`,
    };
  }

  /**
   * Build a JS string expression that handles {{varName}} placeholders.
   * Returns a template literal if placeholders exist, otherwise a JSON string literal.
   * Backticks and ${…} sequences are escaped so they cannot break out of the template.
   */
  _buildStringExpr(str) {
    if (!str || !str.includes('{{')) {
      return JSON.stringify(str);
    }
    // Escape backticks and existing ${ so they render literally inside the template
    const escaped = str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    // Replace {{word}} / {{ word }} placeholders with ${vars['word']} references
    const template = escaped.replace(/\{\{\s*(\w+)\s*\}\}/g, `\${vars['$1']}`);
    return `\`${template}\``;
  }

  /**
   * Generate a k6 script for multi-step (chained) requests.
   * SECURITY: All user-controlled values are serialised with JSON.stringify before
   * being embedded in generated JavaScript.  No raw string interpolation is used
   * for tag names, check keys, or any other executable code paths.
   */
  generateK6ChainScript(testName, steps, meta = {}) {
    // Safe label: strip */ sequences that could close the comment block, then JSON-encode.
    const safeLabel = (raw) => JSON.stringify(String(raw || '').replace(/\*\//g, '*\\/'));

    const stepBlocks = steps
      .map((step, i) => {
        const n = i + 1;
        const labelRaw = step.label || `Step ${n}`;
        const labelJson = safeLabel(labelRaw); // e.g. "Login"
        const checkKey = safeLabel(`${labelRaw} status 2xx`); // e.g. "Login status 2xx"

        const urlExpr = this._buildStringExpr(step.url);

        // Headers — keys and values JSON-serialised
        const headers = step.headers || {};
        const headerEntries = Object.entries(headers);
        let headersExpr;
        if (headerEntries.length === 0) {
          headersExpr = '{}';
        } else {
          const lines = headerEntries.map(
            ([k, v]) => `      ${JSON.stringify(k)}: ${this._buildStringExpr(v)}`
          );
          headersExpr = `{\n${lines.join(',\n')}\n    }`;
        }

        // Body
        let bodyExpr = 'null';
        if (step.body) {
          bodyExpr = this._buildStringExpr(step.body);
        }

        // HTTP call — tag name is JSON.stringify'd, never single-quote-interpolated
        const method = (step.method || 'GET').toUpperCase();
        let callLine;
        switch (method) {
          case 'GET':
            callLine = `  const res${n} = http.get(${urlExpr}, { headers: ${headersExpr}, tags: { name: ${labelJson} } });`;
            break;
          case 'DELETE':
            callLine = `  const res${n} = http.del(${urlExpr}, ${bodyExpr}, { headers: ${headersExpr}, tags: { name: ${labelJson} } });`;
            break;
          default:
            callLine = `  const res${n} = http.${method.toLowerCase()}(${urlExpr}, ${bodyExpr}, { headers: ${headersExpr}, tags: { name: ${labelJson} } });`;
        }

        // Check — key is a computed property so any string is safe
        const checkLine = `  check(res${n}, { [${checkKey}]: (r) => r.status >= 200 && r.status < 400 });`;

        // Variable extraction — varName/varPath already JSON-encoded by JSON.stringify
        let extractLine = '';
        if (step.extractVars && step.varName && step.varPath) {
          extractLine = `\n  vars[${JSON.stringify(step.varName)}] = res${n}.json(${JSON.stringify(step.varPath)});`;
        }

        // Debug logging — VU 1 / first iteration only (negligible load impact)
        let debugLine = '';
        if (meta.debugLog) {
          const stepTag = JSON.stringify(`Step ${n}: ${labelRaw}`);
          const methodJson = JSON.stringify(method);
          debugLine = `
  if (__VU === 1 && __ITER === 0) {
    console.log('[debug] ' + ${stepTag} + ' REQ ' + ${methodJson} + ' ' + ${urlExpr});
    if (${bodyExpr} != null) {
      console.log('[debug] ' + ${stepTag} + ' request body=' + String(${bodyExpr}).slice(0, 2000));
    }
    console.log('[debug] ' + ${stepTag} + ' RES status=' + res${n}.status + ' body=' + String(res${n}.body || '').slice(0, 2000));
  }`;
        }

        // Comment uses the raw label but with */ stripped (not executable)
        const commentLabel = labelRaw.replace(/\*\//g, '*\\/');
        return `\n  // Step ${n}: ${commentLabel}\n${callLine}\n${checkLine}${extractLine}${debugLine}`;
      })
      .join('\n');

    // Safe values for the generated file's comment block (not executable code)
    const commentName = String(meta.name || `Chain: ${testName}`).replace(/\*\//g, '*\\/');
    const commentDesc = String(meta.description || '').replace(/\*\//g, '*\\/');
    const stepList = steps
      .map((s, i) => `${i + 1}. ${String(s.label || `Step ${i + 1}`).replace(/\*\//g, '*\\/')}`)
      .join(', ');

    return `/**
 * Generated k6 multi-step load test
 * Steps: ${stepList}
 * @name: ${JSON.stringify(commentName)}
 * @description: ${JSON.stringify(commentDesc)}
 * @team: ${JSON.stringify(meta.team || '')}
 * @mode: "curl"
 * @vus: ${meta.vus || 10}
 * @duration: ${JSON.stringify(meta.duration || '5m')}
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const requestCounter = new Counter('custom_requests');
const errorRate = new Rate('custom_errors');
const requestDuration = new Trend('custom_request_duration');

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS, 10) : 10,
  duration: __ENV.DURATION || '5m',
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    'custom_errors': ['rate<0.1'],
  },
  tags: {
    test_name: ${JSON.stringify(testName)},
    source: 'curl_chain_import',
  },
};

export default function () {
  const startTime = new Date().getTime();

  // Shared variable store — populated by extraction steps and used by subsequent steps
  const vars = {};
${stepBlocks}

  const duration = new Date().getTime() - startTime;
  requestCounter.add(1);
  requestDuration.add(duration);

  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
`;
  }

  /**
   * Generate k6 test script from request data.
   * SECURITY: ALL user-controlled values (url, method, headers, body) are serialised
   * into a single JSON CONFIG constant.  No raw user string is ever interpolated
   * directly into generated JavaScript code.
   */
  generateK6Script(testName, request, meta = {}) {
    const { url, method, headers, body } = request;

    // Parse body safely — preserve the original value structure for the script
    let parsedBody = null;
    if (body) {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body; // treat as a raw string payload
      }
    }

    // Serialize ALL user-controlled request data as a single JSON literal.
    // This is the only place user data enters the generated script, and it is
    // always fully JSON-encoded — injection is structurally impossible.
    const configJson = JSON.stringify(
      {
        url: url || '',
        method: (method || 'GET').toUpperCase(),
        headers: headers || {},
        body: parsedBody,
      },
      null,
      2
    );

    // Safe values for the file's comment block (strip comment-closing sequence)
    const commentName = String(meta.name || `cURL: ${testName}`).replace(/\*\//g, '*\\/');
    const commentDesc = String(meta.description || '').replace(/\*\//g, '*\\/');

    return `/**
 * Generated k6 load test
 * @name: ${JSON.stringify(commentName)}
 * @description: ${JSON.stringify(commentDesc)}
 * @team: ${JSON.stringify(meta.team || '')}
 * @mode: "curl"
 * @vus: ${meta.vus || 10}
 * @duration: ${JSON.stringify(meta.duration || '5m')}
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const requestCounter = new Counter('custom_requests');
const errorRate = new Rate('custom_errors');
const requestDuration = new Trend('custom_request_duration');

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS, 10) : 10,
  duration: __ENV.DURATION || '5m',
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    'custom_errors': ['rate<0.1'],
  },
  tags: {
    test_name: ${JSON.stringify(testName)},
    source: 'curl_import',
  },
};

// All request data is serialised as JSON at generation time.
// No user-supplied strings are ever interpolated directly into JavaScript code.
const CONFIG = ${configJson};

export default function () {
  const startTime = new Date().getTime();

  const params = {
    headers: CONFIG.headers,
    tags: { name: CONFIG.url },
  };

  // Stringify object bodies; pass string/null bodies as-is
  const payload = (CONFIG.body !== null && CONFIG.body !== undefined)
    ? (typeof CONFIG.body === 'object' ? JSON.stringify(CONFIG.body) : String(CONFIG.body))
    : null;

  let response;
  switch (CONFIG.method) {
    case 'GET':
      response = http.get(CONFIG.url, params);
      break;
    case 'POST':
      response = http.post(CONFIG.url, payload, params);
      break;
    case 'PUT':
      response = http.put(CONFIG.url, payload, params);
      break;
    case 'PATCH':
      response = http.patch(CONFIG.url, payload, params);
      break;
    case 'DELETE':
      response = http.del(CONFIG.url, payload, params);
      break;
    default:
      response = http.get(CONFIG.url, params);
  }

  const duration = new Date().getTime() - startTime;
  requestCounter.add(1);
  requestDuration.add(duration);

  const checkResult = check(response, {
    'status is 2xx or 3xx': (r) => r.status >= 200 && r.status < 400,
    'response has body': (r) => r.body && r.body.length > 0,
    'response time < 5000ms': (r) => r.timings.duration < 5000,
  });

  if (!checkResult) {
    errorRate.add(1);
    console.error(\`Request failed: \${response.status} \${response.url}\`);
  } else {
    errorRate.add(0);
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
`;
  }
}
