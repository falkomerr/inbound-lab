/**
 * Load Test UI Panel - Vue.js Application
 */

// Store charts outside Vue reactivity to prevent infinite loops
const chartInstances = {
  requests: null,
  responseTime: null,
  distribution: null,
};

const app = Vue.createApp({
  data() {
    return {
      // Tests
      availableTests: [],
      selectedTest: '',
      testDescription: '',
      testSteps: [],

      // Configuration
      config: {
        environment: 'staging',
        vus: 10,
        duration: '5m',
      },
      currentTestVus: null, // actual VUs used for the current/last test
      pendingChartMetrics: null, // single-snapshot metrics queued while charts initialise
      pendingChartSeries: null, // full time-series queued while charts initialise
      chartsGeneration: 0, // incremented on each initializeCharts() call; stale loops abort when mismatched
      /** Prevents duplicate /results fetches when history pre-hydration set testCompleted before updateStatus */
      _lastChartHydrateTestId: null,
      _lastReqCount: null, // cumulative http_reqs count — used only when server omits http_reqs.rate
      _lastMetricsMs: null, // wall-clock ms when metrics were last received

      // Test Status
      isRunning: false,
      isLoading: false,
      isStoppingTest: false,
      currentTestId: null,
      currentTestName: '',
      startedByUsername: null,
      startedById: null, // user ID of test starter — used for canStop comparison
      stoppedByUsername: null,
      stoppedById: null, // user who clicked Stop / Discard (shown when status is Stopped or Paused)
      statusText: 'Idle',
      progress: 0,
      elapsedTime: '-',
      startTime: null,
      elapsedInterval: null,
      testCompleted: false, // Track if test has completed to preserve data
      endTime: null, // Store end time when test completes
      testDuration: null, // Store test duration in seconds for progress calculation
      showConfigPanel: true, // Controls Test Configuration sidebar visibility
      preparingUser: null, // { id, username } — user who clicked "New Test" but hasn't started yet
      pausedLockTick: 0, // bumped so canSeeConfig recomputes when the 5min post-pause gate expires
      pausedForResume: false, // server: k6 paused mid-run; same logical test can resume
      resumeInfo: null, // { remainingMs, originalDuration, options, ... } from GET /status
      isPausingTest: false,
      isApplyingLoadUpdate: false,
      /** Baseline for partial load updates — only fields that differ from these are sent */
      _loadUpdateSnapshotVus: null,
      _loadUpdateSnapshotDur: null,
      /** Wall-clock ms spent in “paused for resume” — excluded from client elapsed/progress */
      runWallOffsetMs: 0,
      /** When the UI entered paused-for-resume (to accumulate runWallOffsetMs on resume) */
      pauseHoldStartedAt: null,

      // Metrics
      metrics: [
        { key: 'requests', label: 'Requests/s', value: '-', icon: 'requests' },
        { key: 'response', label: 'Avg Response', value: '-', icon: 'lightning' },
        { key: 'errors', label: 'Errors', value: '-', icon: 'x-circle' },
        { key: 'data', label: 'Data Transferred', value: '-', icon: 'package' },
        { key: 'users', label: 'Active Users', value: '-', icon: 'users' },
        { key: 'failures', label: 'Failure Rate', value: '-', icon: 'alert-triangle' },
      ],

      // Request Statistics
      requestStats: [],
      failureDetails: {},

      // Chart Data
      chartData: {
        requests: { labels: [], data: [] },
        responseTime: { labels: [], data: [] },
        distribution: { labels: [], data: [] },
      },

      // Charts
      charts: {
        requests: null,
        responseTime: null,
        distribution: null,
      },
      chartsInitializing: false, // Track if charts are being initialized

      // Output
      outputLines: [],
      autoScroll: true,
      outputDisplay: null,

      // History
      testHistory: [],
      historyFilter: 'all',

      // Modal
      showModal: false,
      modalLoading: false,
      testResults: null,
      // Confirmation Modal
      showConfirmModal: false,
      confirmTitle: '',
      confirmMessage: '',
      confirmPrimaryLabel: 'Confirm',
      confirmCallback: null,

      // Toasts
      toasts: [],
      toastId: 0,

      // WebSocket
      ws: null,

      // Performance optimization flags
      lastMetricsUpdate: 0,
      metricsUpdateThrottle: 200, // Update metrics max once per 200ms
      pendingMetrics: null,
      chartUpdatePending: false,
      chartUpdateRAF: null,
      latestChartMetrics: null,
      lastStatsUpdate: 0,
      statsUpdateThrottle: 1000, // Update stats table max once per second
      maxVisibleOutputLines: 200, // Only render last 200 lines
      isPageVisible: true,

      // Dark mode
      isDarkMode: false,

      // Tabs
      activeTab: 'dashboard',
      _syncDashChartsTimer: null,

      // Built-in tests that cannot be deleted (empty — all built-ins have been removed)
      builtInTests: [],

      // Auth
      authUser: null,

      // Admin Panel
      showAdminPanel: false,
      adminTab: 'users',
      adminUsers: [],
      adminUserSearch: '',
      adminUserFilterRole: 'all',
      adminUserFilterStatus: 'all',
      adminForm: {
        email: '',
        username: '',
        password: '',
        role: 'developer',
        emailLinked: false,
        permissions: { teams: [], modes: [] },
        limits: { enabled: false, maxVus: 50, maxDurationMinutes: 30 },
      },
      adminEditId: null,
      adminLoading: false,
      adminError: '',
      adminSuccess: '',
      showAdminPassword: false,

      // Audit Log
      auditLog: [],
      auditLoading: false,
      auditFilter: { type: '', search: '' },
      auditPage: 1,
      auditPageSize: 15,
      expandedAuditId: null,
      _auditDebounceTimer: null,

      // Invite
      adminInvites: [],
      inviteForm: {
        email: '',
        role: 'developer',
        permissions: { teams: [], modes: [] },
        limits: { enabled: false, maxVus: 50, maxDurationMinutes: 30 },
      },
      generatedInviteLink: '',
      inviteCopied: false,
      expandedInviteToken: null,
      copiedExpandedToken: null,

      // Password reset
      resetLinks: {}, // { [userId]: { link, expiresAt } }
      copiedResetId: null,

      // Confirm dialog
      confirmDialog: {
        show: false,
        title: '',
        message: '',
        confirmLabel: 'Confirm',
        confirmStyle: 'danger',
        resolve: null,
      },

      // cURL Import
      curlTestName: '',
      curlVus: 10,
      showVusTip: false,
      showCurlVusTip: false,
      curlDuration: '5m',
      curlTeam: '',
      /** Debug: log req/response for VU 1, first iteration only (no load impact). */
      curlDebugLog: false,
      testNameValid: true,
      testNameError: '',
      curlSteps: [
        {
          id: 1,
          label: '',
          curlCommand: '',
          parsedCurl: null,
          extractVars: false,
          varName: '',
          varPath: '',
        },
      ],
      curlStepCounter: 1,
      teams: [
        { id: 'api', label: 'API' },
        { id: 'backend', label: 'Backend' },
        { id: 'frontend', label: 'Frontend' },
        { id: 'platform', label: 'Platform' },
        { id: 'qa', label: 'QA' },
      ],
    };
  },

  computed: {
    selectedTestDefinition() {
      if (!this.selectedTest) {
        return null;
      }
      return this.availableTests.find((t) => t.id === this.selectedTest) || null;
    },

    selectedTestIsCurl() {
      const test = this.selectedTestDefinition;
      if (!test) {
        return false;
      }
      if (test.mode === 'curl') {
        return true;
      }

      // Backward compatibility: older imported scenarios may not have `mode`.
      const id = String(test.id || this.selectedTest || '').toLowerCase();
      const name = String(test.name || '').toLowerCase();
      if (name.startsWith('chain:') || name.startsWith('curl:')) {
        return true;
      }
      if (id.startsWith('curl-') || id.includes('-curl-') || id.includes('curl')) {
        return true;
      }
      return false;
    },

    canStart() {
      return this.selectedTest && !this.isRunning && !this.pausedForResume;
    },

    /** Lock scenario / env / VUs / duration while k6 runs or a resume session is waiting */
    configLocked() {
      return this.isRunning || this.pausedForResume;
    },

    /** Locust-style: allow editing VUs + duration while a scenario test is running (same auth as Stop) */
    canEditLoadWhileRunning() {
      return this.isRunning && !this.pausedForResume && this.canSeeScenarios && this.canStop;
    },

    /** VUs/duration inputs: unlocked only when ramping load mid-run */
    vusDurationLocked() {
      return this.configLocked && !this.canEditLoadWhileRunning;
    },

    canPause() {
      return this.isRunning && this.canStop;
    },

    canResume() {
      if (!this.pausedForResume || this.isRunning) {
        return false;
      }
      const role = this.authUser?.role;
      if (role === 'admin' || role === 'tech-lead') {
        return true;
      }
      const myId = this.authUser?.id;
      if (myId != null && this.startedById != null) {
        return this.sameUserId(myId, this.startedById);
      }
      return Boolean(this.startedByUsername && this.authUser?.username === this.startedByUsername);
    },

    canStop() {
      // Allow Stop while k6 runs, and Discard while paused-for-resume (not isRunning but session active).
      if (!this.isRunning && !this.pausedForResume) {
        return false;
      }
      const role = this.authUser?.role;
      if (role === 'admin' || role === 'tech-lead') {
        return true;
      }
      // Match by user ID (same field the server uses) — falls back to username
      // for legacy status entries that predate the ID field.
      const myId = this.authUser?.id;
      if (myId != null && this.startedById != null) {
        return this.sameUserId(myId, this.startedById);
      }
      return this.startedByUsername && this.authUser?.username === this.startedByUsername;
    },

    canSeeConfig() {
      void this.pausedLockTick; // depend so UI unlocks after the post-pause window
      if (!this.authUser) {
        return false;
      }
      // Built-in "Test Configuration" is the scenario dashboard — curl-only users never see it
      // (they use Import cURL; they may still land on dashboard for metrics after a cURL run).
      if (!this.canSeeScenarios) {
        return false;
      }

      // Paused-for-resume: only the original starter (or admin/TL) sees Test Configuration for 5 minutes.
      // User-stopped runs use status Stopped — no scenario sidebar until New Test.
      const pausedExclusive = this.pausedForResume && !this.isRunning;
      if (pausedExclusive) {
        const { role } = this.authUser;
        if (this.endTime) {
          const ageMs = Date.now() - this.endTime.getTime();
          if (ageMs >= PAUSED_RESUME_IDLE_MS) {
            return false;
          }
        }
        if (role === 'admin' || role === 'tech-lead') {
          return true;
        }
        const myId = this.authUser.id;
        if (myId != null && this.startedById != null) {
          return this.sameUserId(myId, this.startedById);
        }
        return Boolean(this.startedByUsername) && this.authUser.username === this.startedByUsername;
      }

      // When no test is running (non-paused-exclusive), everyone can see the config panel
      if (!this.isRunning) {
        return true;
      }
      // While running: only admin, tech-lead, or the user who started the test
      const { role } = this.authUser;
      if (role === 'admin' || role === 'tech-lead') {
        return true;
      }
      const myId = this.authUser.id;
      if (myId != null && this.startedById != null) {
        return this.sameUserId(myId, this.startedById);
      }
      return this.startedByUsername && this.authUser.username === this.startedByUsername;
    },

    /** New Test in the top bar when the run is done or the post-pause config lock has expired. */
    showNavNewTestButton() {
      void this.pausedLockTick;
      if (this.isRunning) {
        return false;
      }
      const onSurface =
        this.activeTab === 'dashboard' ||
        (this.activeTab === 'curl-import' && this.canSeeCurl && !this.canSeeScenarios);
      if (!onSurface) {
        return false;
      }
      if (this.pausedForResume && this.pausedResumeIdle) {
        return true;
      }
      if (!this.testCompleted) {
        return false;
      }
      if (
        this.pausedForResume &&
        this.endTime &&
        Date.now() - this.endTime.getTime() >= PAUSED_RESUME_IDLE_MS
      ) {
        return true;
      }
      return !this.showConfigPanel;
    },

    /**
     * True when a pause-for-resume session is past the 5-minute idle window (same as server/API).
     * Depends on `pausedLockTick` so the UI updates on the periodic tick while paused.
     */
    pausedResumeIdle() {
      void this.pausedLockTick;
      if (!this.pausedForResume || this.isRunning) {
        return false;
      }
      const refIso =
        this.resumeInfo?.pausedAt || (this.endTime ? this.endTime.toISOString() : null);
      if (!refIso) {
        return false;
      }
      const age = Date.now() - new Date(refIso).getTime();
      return age >= PAUSED_RESUME_IDLE_MS;
    },

    /** Pause UI that implies resume/stop/progress — hidden after the idle window. */
    pausedForResumeActive() {
      return Boolean(this.pausedForResume && !this.pausedResumeIdle);
    },

    someoneElsePreparing() {
      if (!this.preparingUser) {
        return false;
      }
      const myId = this.authUser?.id;
      if (myId != null && this.preparingUser.id != null) {
        return !this.sameUserId(myId, this.preparingUser.id);
      }
      return this.preparingUser.username !== this.authUser?.username;
    },

    /** Admins can release another user's preparing lock or take over via New Test / prepare (see API). */
    canOverridePreparingLock() {
      return this.authUser?.role === 'admin';
    },

    /** True when another user holds preparing and this user cannot bypass (blocks New Test / cURL run). */
    blockedByOthersPreparing() {
      return this.someoneElsePreparing && !this.canOverridePreparingLock;
    },

    /** Duration for last run (status strip + nav) — recomputes if elapsedTime was never set */
    headerRunDuration() {
      if (this.statusText === 'Idle' || this.statusText === 'Running') {
        return '';
      }
      if (this.elapsedTime && this.elapsedTime !== '-') {
        return this.elapsedTime;
      }
      if (this.startTime && this.endTime) {
        const raw = Math.floor((this.endTime.getTime() - this.startTime.getTime()) / 1000);
        const elapsed = this.testDuration
          ? Math.min(Math.max(0, raw), this.testDuration)
          : Math.max(0, raw);
        return this.formatDuration(elapsed);
      }
      return '';
    },

    /** Wall-clock time the last run finished */
    headerRunEndedAt() {
      if (!this.endTime) {
        return '';
      }
      if (
        this.statusText !== 'Completed' &&
        this.statusText !== 'Failed' &&
        this.statusText !== 'Paused' &&
        this.statusText !== 'Stopped'
      ) {
        return '';
      }
      return new Date(this.endTime).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    },

    roleLabels() {
      return {
        admin: 'Admin',
        'tech-lead': 'Tech Lead',
        developer: 'Developer',
        qa: 'QA',
        pm: 'PM',
      };
    },

    /** Admin user list after search + role + suspension filters */
    adminPanelTitle() {
      return (
        {
          users: 'User Management',
          invite: 'Invite Links',
          audit: 'Audit Log',
        }[this.adminTab] || 'Admin Panel'
      );
    },

    paginatedAuditLog() {
      const start = (this.auditPage - 1) * this.auditPageSize;
      return this.auditLog.slice(start, start + this.auditPageSize);
    },

    auditTotalPages() {
      return Math.max(1, Math.ceil(this.auditLog.length / this.auditPageSize));
    },

    auditPageStart() {
      if (!this.auditLog.length) {
        return 0;
      }
      return (this.auditPage - 1) * this.auditPageSize + 1;
    },

    auditPageEnd() {
      return Math.min(this.auditPage * this.auditPageSize, this.auditLog.length);
    },

    filteredAdminUsers() {
      let list = this.adminUsers || [];
      const q = (this.adminUserSearch || '').trim().toLowerCase();
      if (q) {
        list = list.filter((u) => {
          const name = (u.username || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          return name.includes(q) || email.includes(q);
        });
      }
      if (this.adminUserFilterRole && this.adminUserFilterRole !== 'all') {
        list = list.filter((u) => u.role === this.adminUserFilterRole);
      }
      if (this.adminUserFilterStatus === 'active') {
        list = list.filter((u) => !u.banned);
      } else if (this.adminUserFilterStatus === 'suspended') {
        list = list.filter((u) => u.banned && u.role !== 'admin');
      }
      return list;
    },

    adminUserFiltersActive() {
      return (
        Boolean((this.adminUserSearch || '').trim()) ||
        this.adminUserFilterRole !== 'all' ||
        this.adminUserFilterStatus !== 'all'
      );
    },

    /** True if at least one non-admin can still be suspended (hide bulk suspend when everyone else is already banned). */
    canBulkSuspendNonAdmins() {
      const users = this.adminUsers || [];
      return users.some((u) => u.role !== 'admin' && !u.banned);
    },

    availableModes() {
      return [
        { id: 'scenario', label: 'Test Scenarios' },
        { id: 'curl', label: 'cURL Import' },
      ];
    },

    availableTeams() {
      return [
        { id: 'api', label: 'API' },
        { id: 'backend', label: 'Backend' },
        { id: 'frontend', label: 'Frontend' },
        { id: 'platform', label: 'Platform' },
        { id: 'qa', label: 'QA' },
      ];
    },

    /** True if current user can see the Test Scenarios tab */
    userLimits() {
      // Use actual user limits from server; disabled = no cap enforced client-side
      return this.authUser?.limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 };
    },

    canSeeScenarios() {
      if (!this.authUser) {
        return false;
      }
      if (this.authUser.role === 'admin') {
        return true;
      }
      const modes = this.authUser.permissions?.modes || [];
      return modes.length === 0 || modes.includes('scenario');
    },

    /** True if current user can see the cURL Import tab */
    canSeeCurl() {
      if (!this.authUser) {
        return false;
      }
      if (this.authUser.role === 'admin') {
        return true;
      }
      const modes = this.authUser.permissions?.modes || [];
      return modes.length === 0 || modes.includes('curl');
    },

    /**
     * Hide Import cURL after a finished run (Completed, Failed, Stopped, or Paused-for-resume) until New Test.
     */
    showCurlImportTab() {
      if (!this.canSeeCurl) {
        return false;
      }
      // Paused-for-resume: hide cURL for scenario users so they stay on the run (watcher moves tab off cURL).
      // Curl-only accounts keep the tab so the nav is not empty during someone else's paused run.
      if (this.pausedForResume && this.canSeeScenarios) {
        return false;
      }
      const terminal = ['Completed', 'Failed', 'Stopped', 'Paused'].includes(this.statusText);
      if (!this.isRunning && this.testCompleted && terminal) {
        return false;
      }
      return true;
    },

    // Tests grouped by team; teams with no files are omitted
    testsByTeam() {
      const ORDER = ['api', 'backend', 'frontend', 'platform', 'qa'];
      const groups = {};
      for (const t of this.availableTests) {
        const key = t.team || '__none__';
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(t);
      }
      const result = ORDER.filter((k) => groups[k] && groups[k].length > 0).map((k) => ({
        id: k,
        label: this.teams.find((t) => t.id === k)?.label || k,
        tests: groups[k],
      }));
      if (groups['__none__'] && groups['__none__'].length > 0) {
        result.push({ id: '__none__', label: 'Other', tests: groups['__none__'] });
      }
      return result;
    },

    statusClass() {
      if (this.isRunning) {
        return 'running';
      }
      if (this.statusText === 'Completed') {
        return 'completed';
      }
      if (this.statusText === 'Failed') {
        return 'failed';
      }
      if (this.statusText === 'Paused') {
        return 'paused';
      }
      if (this.statusText === 'Stopped') {
        return 'stopped';
      }
      return 'idle';
    },

    resumeRemainingLabel() {
      if (this.pausedResumeIdle) {
        return '';
      }
      const ms = this.resumeInfo?.remainingMs;
      if (ms == null || ms <= 0) {
        return '';
      }
      // Floor so displayed “Runs after Resume” + ceil’d “Finished before pause” does not exceed
      // the plan (e.g. 57153ms → 57s with 3s ran on a 1m plan; ceil here wrongly showed 58s).
      return this.formatDuration(Math.max(0, Math.floor(ms / 1000)));
    },

    /** Total planned run length (e.g. 30s) for progress copy — from server options */
    plannedTotalLabel() {
      if (!this.testDuration || this.testDuration <= 0) {
        return '';
      }
      return this.formatDuration(this.testDuration);
    },

    /**
     * Active k6 time completed before pause (server `consumedMs`), never wall start→end.
     * Avoids bogus values like "1m 5s / 30s" when client dates/skew drift from the real segment.
     */
    pausedActiveElapsedLabel() {
      const ms = this.resumeInfo?.consumedMs;
      if (this.pausedForResume && ms != null) {
        let sec = Math.max(0, Math.ceil(ms / 1000));
        if (this.testDuration != null && this.testDuration > 0) {
          sec = Math.min(sec, this.testDuration);
        }
        return this.formatDuration(sec);
      }
      return this.elapsedTime;
    },

    pauseTimingAriaLabel() {
      if (!this.pausedForResume) {
        return '';
      }
      const plan = this.plannedTotalLabel;
      const ran = this.pausedActiveElapsedLabel;
      const left = this.resumeRemainingLabel;
      if (!plan || !left) {
        return 'Test paused.';
      }
      return `Paused. Finished before pause ${ran} of ${plan}. Runs after Resume ${left}.`;
    },

    hasFailureDetails() {
      return Object.keys(this.failureDetails).length > 0;
    },

    filteredHistory() {
      if (this.historyFilter === 'all') {
        return this.testHistory;
      }
      return this.testHistory.filter((test) => test.status === this.historyFilter);
    },

    visibleOutputLines() {
      // Only show last N lines for performance
      if (this.outputLines.length <= this.maxVisibleOutputLines) {
        return this.outputLines;
      }
      return this.outputLines.slice(-this.maxVisibleOutputLines);
    },

    resultsSummary() {
      if (!this.testResults || !this.testResults.metrics) {
        return {};
      }

      const m = this.testResults.metrics;
      const httpReqs = m.http_reqs || {};
      const httpReqDuration = m.http_req_duration || {};
      const httpReqFailed = m.http_req_failed || {};
      const dataReceived = m.data_received || {};
      const dataSent = m.data_sent || {};

      return {
        'Total Requests': httpReqs.count || 0,
        'Requests/s': (httpReqs.rate || 0).toFixed(2),
        'Avg Response Time': `${(httpReqDuration.avg || 0).toFixed(0)}ms`,
        'P95 Response Time': `${(httpReqDuration.values?.p95 || 0).toFixed(0)}ms`,
        'P99 Response Time': `${(httpReqDuration.values?.p99 || 0).toFixed(0)}ms`,
        'Error Rate': `${((httpReqFailed.rate || 0) * 100).toFixed(2)}%`,
        'Data Received': this.formatBytes(dataReceived.count || 0),
        'Data Sent': this.formatBytes(dataSent.count || 0),
      };
    },
  },

  async mounted() {
    // Load `/me` first — `canSeeConfig` / `canStop` need `authUser` on the same tick as `/status`,
    // otherwise the starter briefly (or stuck without a re-render) sees no Test Configuration.
    await this.checkAuthOrRedirect();
    this.initializeDarkMode();
    this.initializeWebSocket();
    this.loadAvailableTests();
    await this.loadStatus();
    // Metrics/charts are v-if gated on testCompleted — wait so canvases exist before Chart.js init
    await this.$nextTick();
    this.loadHistory();
    this.setupKeyboardShortcuts();
    this.initializeCharts();
    this.setupVisibilityHandlers();

    // Cancel preparing state on tab close or refresh
    this._beforeUnloadHandler = () => {
      if (!this.someoneElsePreparing && this.preparingUser) {
        const token = localStorage.getItem('authToken');
        if (token) {
          fetch(`${API_BASE}/tests/cancel-prepare`, {
            method: 'POST',
            keepalive: true,
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    this._pausedLockInterval = setInterval(() => {
      if (this.pausedForResume && !this.isRunning) {
        this.pausedLockTick += 1;
      }
    }, 15000);
  },

  beforeUnmount() {
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }
    if (this._pausedLockInterval) {
      clearInterval(this._pausedLockInterval);
      this._pausedLockInterval = null;
    }
    if (this.ws) {
      this.ws.close();
    }
    if (this.elapsedInterval) {
      clearInterval(this.elapsedInterval);
    }
    if (this.chartUpdateRAF) {
      cancelAnimationFrame(this.chartUpdateRAF);
    }
    if (this._syncDashChartsTimer) {
      clearTimeout(this._syncDashChartsTimer);
      this._syncDashChartsTimer = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  },

  watch: {
    adminSuccess(val) {
      if (val) {
        clearTimeout(this._adminSuccessTimer);
        this._adminSuccessTimer = setTimeout(() => {
          this.adminSuccess = '';
        }, 10000);
      }
    },
    outputLines: {
      handler() {
        if (this.autoScroll && this.isPageVisible) {
          this.$nextTick(() => {
            if (this.$refs.outputDisplay) {
              this.$refs.outputDisplay.scrollTop = this.$refs.outputDisplay.scrollHeight;
            }
          });
        }
      },
      deep: true,
    },
    showCurlImportTab(visible) {
      if (!visible && this.activeTab === 'curl-import') {
        this.activeTab = 'dashboard';
      }
    },
    activeTab(to, from) {
      if (to === 'dashboard' && from === 'curl-import' && (this.isRunning || this.testCompleted)) {
        this.scheduleSyncDashboardCharts();
      }
    },
  },

  methods: {
    /** True when two user ids refer to the same person (JSON may mix number vs string). */
    sameUserId(a, b) {
      if (a == null || b == null) {
        return false;
      }
      return String(a) === String(b);
    },

    // ─── Auth ───────────────────────────────────────────────────────────────
    async checkAuthOrRedirect() {
      const token = localStorage.getItem('authToken');
      if (!token) {
        location.replace('/login');
        return;
      }
      try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.success) {
          this.authUser = data.data;
          // Auto-select first allowed tab
          const modes = this.authUser.permissions?.modes || [];
          const isAdmin = this.authUser.role === 'admin';
          if (
            !isAdmin &&
            modes.length > 0 &&
            !modes.includes('scenario') &&
            modes.includes('curl')
          ) {
            this.activeTab = 'curl-import';
          }
        } else {
          localStorage.removeItem('authToken');
          localStorage.removeItem('authUser');
          location.replace('/login');
        }
      } catch {
        location.replace('/login');
      }
    },

    async refreshAuthUser() {
      const token = localStorage.getItem('authToken');
      if (!token) {
        return;
      }
      try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.success) {
          this.authUser = data.data;
        }
      } catch {
        // silently ignore — stale data is better than crashing
      }
    },

    async logout() {
      // Cancel preparing state before leaving so other users aren't blocked
      if (this.preparingUser && !this.someoneElsePreparing) {
        try {
          await apiFetch(`${API_BASE}/tests/cancel-prepare`, { method: 'POST' });
        } catch {
          /* ignore */
        }
      }
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      location.replace('/login');
    },

    // ─── Admin Panel ─────────────────────────────────────────────────────────
    async openAdminPanel() {
      this.showAdminPanel = true;
      this.adminError = '';
      this.adminSuccess = '';
      this.resetAdminForm();
      await this.loadAdminUsers();
    },

    closeAdminPanel() {
      this.showAdminPanel = false;
      this.adminTab = 'users';
      this.adminError = '';
      this.adminSuccess = '';
      this.generatedInviteLink = '';
      this.inviteCopied = false;
      this.expandedInviteToken = null;
      this.copiedExpandedToken = null;
      this.inviteForm = {
        email: '',
        role: 'developer',
        permissions: { teams: [], modes: [] },
        limits: { enabled: false, maxVus: 50, maxDurationMinutes: 30 },
      };
      this.resetAdminForm();
      this.adminUserSearch = '';
      this.adminUserFilterRole = 'all';
      this.adminUserFilterStatus = 'all';
      this.auditPage = 1;
      this.expandedAuditId = null;
    },

    clearAdminUserFilters() {
      this.adminUserSearch = '';
      this.adminUserFilterRole = 'all';
      this.adminUserFilterStatus = 'all';
    },

    switchAdminTab(tab) {
      this.adminTab = tab;
      this.adminError = '';
      this.adminSuccess = '';
      // Clear generated link when leaving the invite tab
      this.generatedInviteLink = '';
      this.inviteCopied = false;
      this.expandedInviteToken = null;
      this.copiedExpandedToken = null;
      if (tab === 'invite') {
        this.loadAdminInvites();
      }
      if (tab === 'audit') {
        this.auditPage = 1;
        this.expandedAuditId = null;
        this.loadAuditLog();
      }
    },

    resetAdminForm() {
      this.adminForm = {
        email: '',
        username: '',
        password: '',
        role: 'developer',
        emailLinked: false,
        permissions: { teams: [], modes: [] },
        limits: { enabled: false, maxVus: 50, maxDurationMinutes: 30 },
      };
      this.adminEditId = null;
      this.showAdminPassword = false;
    },

    onEmailInput() {
      const email = this.adminForm.email.trim().toLowerCase();
      const local = email.includes('@') ? email.split('@')[0] : email;
      if (this.adminForm.emailLinked || !this.adminForm.username) {
        this.adminForm.username = local;
        this.adminForm.emailLinked = Boolean(local);
      }
    },

    async loadAdminUsers() {
      this.adminLoading = true;
      try {
        const res = await apiFetch(`${API_BASE}/admin/users`);
        const data = await res.json();
        if (data.success) {
          this.adminUsers = data.data;
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Failed to load users';
      } finally {
        this.adminLoading = false;
      }
    },

    async suspendAllNonAdmins() {
      const ok = await this.showConfirm({
        title: 'Suspend all non-admin users?',
        message:
          'This single step suspends every account except administrators: they are signed out and cannot log in until you restore them (per user or “Restore all”).',
        confirmLabel: 'Suspend all non-admins',
        confirmStyle: 'danger',
      });
      if (!ok) {
        return;
      }
      this.adminError = '';
      this.adminSuccess = '';
      this.adminLoading = true;
      try {
        const res = await apiFetch(`${API_BASE}/admin/users/ban-all`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          const n = data.data?.bannedCount ?? 0;
          this.adminSuccess =
            n === 0
              ? 'No non-admin users were suspended (they were already suspended, or only admins exist).'
              : `Suspended ${n} non-admin account(s). Administrator accounts were not changed.`;
          await this.loadAdminUsers();
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      } finally {
        this.adminLoading = false;
      }
    },

    async unbanAllUsersAdmin() {
      const ok = await this.showConfirm({
        title: 'Restore all suspended accounts?',
        message:
          'Clears the suspended flag on every user at once so they can log in again (admin accounts were never suspended).',
        confirmLabel: 'Restore all accounts',
      });
      if (!ok) {
        return;
      }
      this.adminError = '';
      this.adminSuccess = '';
      this.adminLoading = true;
      try {
        const res = await apiFetch(`${API_BASE}/admin/users/unban-all`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          const n = data.data?.unbannedCount ?? 0;
          this.adminSuccess =
            n === 0
              ? 'No accounts were suspended, so nothing changed.'
              : `Removed suspension from ${n} account(s).`;
          await this.loadAdminUsers();
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      } finally {
        this.adminLoading = false;
      }
    },

    async toggleUserBan(user) {
      const willBan = !user.banned;
      if (willBan) {
        const ok = await this.showConfirm({
          title: `Suspend ${user.username}?`,
          message:
            'They will be signed out immediately and cannot log in until you remove the suspension.',
          confirmLabel: 'Suspend user',
          confirmStyle: 'danger',
        });
        if (!ok) {
          return;
        }
      } else {
        const ok = await this.showConfirm({
          title: `Remove suspension for ${user.username}?`,
          message: 'They will be allowed to log in again.',
          confirmLabel: 'Unban user',
        });
        if (!ok) {
          return;
        }
      }
      this.adminError = '';
      this.adminSuccess = '';
      this.adminLoading = true;
      try {
        // PUT (not PATCH) so suspend works behind proxies and on servers without the /suspension route.
        const res = await apiFetch(`${API_BASE}/admin/users/${user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banned: Boolean(willBan) }),
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        let data;
        if (ct.includes('application/json')) {
          try {
            data = await res.json();
          } catch {
            this.adminError = `Server returned invalid JSON (${res.status}). Restart the app server if you just updated code.`;
            return;
          }
        } else {
          const snippet = (await res.text()).trim().slice(0, 180);
          this.adminError =
            snippet ||
            `Request failed (${res.status} ${res.statusText || ''}). The API may be unreachable or returning HTML instead of JSON.`;
          return;
        }
        if (data.success) {
          this.adminSuccess = willBan ? 'User suspended' : 'Suspension removed';
          await this.loadAdminUsers();
          await this.refreshAuthUser();
        } else {
          this.adminError = data.error || `Error (${res.status})`;
        }
      } catch (e) {
        this.adminError =
          e instanceof Error && e.message ? e.message : 'Network error — request did not complete.';
      } finally {
        this.adminLoading = false;
      }
    },

    editAdminUser(user) {
      this.adminEditId = user.id;
      this.adminForm = {
        email: user.email || '',
        username: user.username,
        password: '',
        role: user.role,
        emailLinked: Boolean(user.email),
        permissions: {
          teams: [...(user.permissions?.teams || [])],
          modes: [...(user.permissions?.modes || [])],
        },
        limits: {
          enabled: user.limits?.enabled ?? false,
          maxVus: user.limits?.maxVus ?? 50,
          maxDurationMinutes: user.limits?.maxDurationMinutes ?? 30,
        },
      };
      this.adminError = '';
      this.adminSuccess = '';
      this.showAdminPassword = false;
      this.$nextTick(() => {
        const form = document.getElementById('admin-user-form');
        if (form) {
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          form.classList.add('admin-form--highlight');
          setTimeout(() => form.classList.remove('admin-form--highlight'), 1200);
        }
      });
    },

    async saveAdminUser() {
      this.adminError = '';
      this.adminSuccess = '';
      const { email, username, password, role, permissions, limits } = this.adminForm;
      if (!username) {
        this.adminError = 'Username is required';
        return;
      }
      if (!this.adminEditId && !password) {
        this.adminError = 'Password is required';
        return;
      }

      const normalizedEmail = email.trim() ? email.trim().toLowerCase() : '';

      this.adminLoading = true;
      try {
        let res;
        if (this.adminEditId) {
          const body = { username, role, email: normalizedEmail, permissions, limits };
          if (password) {
            body.password = password;
          }
          res = await apiFetch(`${API_BASE}/admin/users/${this.adminEditId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else {
          res = await apiFetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username,
              password,
              role,
              email: normalizedEmail,
              permissions,
              limits,
            }),
          });
        }
        const data = await res.json();
        if (data.success) {
          this.adminSuccess = this.adminEditId ? 'User updated' : 'User created';
          this.resetAdminForm();
          await this.loadAdminUsers();
          // Always refresh authUser so that limits, role badges and tab
          // visibility update immediately for the currently logged-in user.
          await this.refreshAuthUser();
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      } finally {
        this.adminLoading = false;
      }
    },

    async deleteAdminUser(userId) {
      const ok = await this.showConfirm({
        title: 'Delete user',
        message:
          'This user will be permanently removed and will lose access. This cannot be undone.',
        confirmLabel: 'Delete user',
      });
      if (!ok) {
        return;
      }
      this.adminError = '';
      this.adminSuccess = '';
      this.adminLoading = true;
      try {
        const res = await apiFetch(`${API_BASE}/admin/users/${userId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.adminSuccess = 'User deleted';
          await this.loadAdminUsers();
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      } finally {
        this.adminLoading = false;
      }
    },

    // ─── Confirm dialog ──────────────────────────────────────────────────────
    showConfirm({ title, message, confirmLabel = 'Confirm', confirmStyle = 'danger' }) {
      return new Promise((resolve) => {
        this.confirmDialog = { show: true, title, message, confirmLabel, confirmStyle, resolve };
      });
    },
    confirmDialogOk() {
      if (this.confirmDialog.resolve) {
        this.confirmDialog.resolve(true);
      }
      this.confirmDialog.show = false;
    },
    confirmDialogCancel() {
      if (this.confirmDialog.resolve) {
        this.confirmDialog.resolve(false);
      }
      this.confirmDialog.show = false;
    },

    // ─── Invites ─────────────────────────────────────────────────────────────
    async loadAdminInvites() {
      this.adminLoading = true;
      try {
        const res = await apiFetch(`${API_BASE}/admin/invites`);
        const data = await res.json();
        if (data.success) {
          this.adminInvites = data.data;
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Failed to load invites';
      } finally {
        this.adminLoading = false;
      }
    },

    async generateInvite() {
      this.adminError = '';
      this.adminSuccess = '';
      this.generatedInviteLink = '';
      const email = this.inviteForm.email.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        this.adminError = 'A valid email is required';
        return;
      }
      this.adminLoading = true;
      try {
        const res = await apiFetch(`${API_BASE}/admin/invites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            role: this.inviteForm.role,
            permissions: this.inviteForm.permissions,
            limits: this.inviteForm.limits,
          }),
        });
        const data = await res.json();
        if (data.success) {
          this.generatedInviteLink = data.data.link;
          this.inviteCopied = false;
          this.adminSuccess = `Invite created for ${email}`;
          await this.loadAdminInvites();
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      } finally {
        this.adminLoading = false;
      }
    },

    async copyInviteLink() {
      try {
        await navigator.clipboard.writeText(this.generatedInviteLink);
        this.inviteCopied = true;
        setTimeout(() => {
          this.inviteCopied = false;
        }, 2500);
      } catch {
        this.adminError = 'Could not copy to clipboard';
      }
    },

    buildInviteLink(token) {
      return `${location.origin}/invite?token=${token}`;
    },

    toggleInviteLink(token) {
      this.expandedInviteToken = this.expandedInviteToken === token ? null : token;
      this.copiedExpandedToken = null;
    },

    async copyExpandedLink(token) {
      try {
        await navigator.clipboard.writeText(this.buildInviteLink(token));
        this.copiedExpandedToken = token;
        setTimeout(() => {
          if (this.copiedExpandedToken === token) {
            this.copiedExpandedToken = null;
          }
        }, 2500);
      } catch {
        this.adminError = 'Could not copy to clipboard';
      }
    },

    async revokeInvite(token) {
      const ok = await this.showConfirm({
        title: 'Revoke invite',
        message:
          'The invite link will be invalidated immediately. The recipient will no longer be able to use it.',
        confirmLabel: 'Revoke',
        confirmStyle: 'warning',
      });
      if (!ok) {
        return;
      }
      this.adminError = '';
      try {
        const res = await apiFetch(`${API_BASE}/admin/invites/${token}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.adminSuccess = 'Invite revoked';
          await this.loadAdminInvites();
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      }
    },

    // ── Password Reset ────────────────────────────────────────────────────────

    async generateResetLink(user) {
      this.adminError = '';
      try {
        const res = await apiFetch(`${API_BASE}/admin/users/${user.id}/reset-link`, {
          method: 'POST',
        });
        const data = await res.json();
        if (data.success) {
          this.resetLinks = { ...this.resetLinks, [user.id]: data.data };
          this.adminSuccess = `Reset link created for ${user.username}`;
        } else {
          this.adminError = data.error;
        }
      } catch {
        this.adminError = 'Request failed';
      }
    },

    clearResetLink(userId) {
      const links = { ...this.resetLinks };
      delete links[userId];
      this.resetLinks = links;
    },

    async copyResetLink(userId) {
      try {
        await navigator.clipboard.writeText(this.resetLinks[userId]?.link || '');
        this.copiedResetId = userId;
        setTimeout(() => {
          if (this.copiedResetId === userId) {
            this.copiedResetId = null;
          }
        }, 2500);
      } catch {
        this.adminError = 'Could not copy to clipboard';
      }
    },

    dismissResetLink(userId) {
      const links = { ...this.resetLinks };
      delete links[userId];
      this.resetLinks = links;
    },

    formatResetExpiry(iso) {
      return `${new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })} · ${new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
    },

    // ── Audit Log ──────────────────────────────────────────────────────────────

    async loadAuditLog() {
      this.auditLoading = true;
      this.auditPage = 1;
      this.expandedAuditId = null;
      try {
        const params = new URLSearchParams({ limit: 100 });
        if (this.auditFilter.type) {
          params.set('type', this.auditFilter.type);
        }
        if (this.auditFilter.search) {
          params.set('search', this.auditFilter.search);
        }
        const res = await apiFetch(`${API_BASE}/admin/audit?${params}`);
        const data = await res.json();
        if (data.success) {
          this.auditLog = data.data;
        }
      } catch {
        /* ignore */
      } finally {
        this.auditLoading = false;
      }
    },

    downloadAuditLog() {
      const cols = [
        'timestamp',
        'type',
        'username',
        'role',
        'ip',
        'os',
        'browser',
        'testName',
        'testType',
        'vus',
        'duration',
        'url',
        'method',
        'stepCount',
      ];
      const escape = (v) => {
        if (v === null || v === undefined) {
          return '';
        }
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const rows = this.auditLog.map((e) =>
        [
          e.timestamp,
          e.type,
          e.username || '',
          e.role || '',
          e.ip || '',
          e.os || '',
          e.browser || '',
          e.details?.testName || '',
          e.details?.testType || '',
          e.details?.vus || '',
          e.details?.duration || '',
          e.details?.url || '',
          e.details?.method || '',
          e.details?.stepCount || '',
        ]
          .map(escape)
          .join(',')
      );

      const csv = [cols.join(','), ...rows].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `audit-log-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },

    async clearAuditLog() {
      const ok = await this.showConfirm({
        title: 'Clear audit log',
        message: 'This will permanently delete all log entries. This action cannot be undone.',
        confirmLabel: 'Clear all',
        confirmStyle: 'danger',
      });
      if (!ok) {
        return;
      }
      try {
        const res = await apiFetch(`${API_BASE}/admin/audit?confirm=yes`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          await this.loadAuditLog();
        }
      } catch {
        /* ignore */
      }
    },

    debouncedAuditLoad() {
      clearTimeout(this._auditDebounceTimer);
      this._auditDebounceTimer = setTimeout(() => this.loadAuditLog(), 350);
    },

    toggleAuditExpand(id) {
      this.expandedAuditId = this.expandedAuditId === id ? null : id;
    },

    auditPrevPage() {
      if (this.auditPage > 1) {
        this.auditPage -= 1;
        this.expandedAuditId = null;
      }
    },

    auditNextPage() {
      if (this.auditPage < this.auditTotalPages) {
        this.auditPage += 1;
        this.expandedAuditId = null;
      }
    },

    auditEntrySummary(entry) {
      const d = entry.details || {};
      if (d.testName) {
        return d.testName;
      }
      if (d.targetUsername) {
        return d.targetUsername;
      }
      if (d.targetEmail) {
        return d.targetEmail;
      }
      if (d.testId) {
        return d.testId;
      }
      if (entry.type === 'login') {
        return 'Signed in';
      }
      if (entry.type === 'login_failed') {
        return 'Authentication failed';
      }
      if (entry.type === 'history_cleared') {
        const n = d.deletedCount;
        return n != null ? `${n} history entries removed` : 'Run history cleared';
      }
      if (entry.type === 'audit_cleared') {
        return 'All log entries removed';
      }
      return 'Click to view details';
    },

    formatAuditDate(ts) {
      const d = new Date(ts);
      const day = String(d.getDate()).padStart(2, '0');
      const mon = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ][d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${mon} ${year}`;
    },

    formatAuditTime(ts) {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    },

    auditTypeLabel(type) {
      return (
        {
          login: '🔑 Login',
          login_failed: '⛔ Failed login',
          test_run: '▶ Test run',
          test_load_update: '📶 Load update',
          curl_upload: '📤 cURL upload',
          user_created: '➕ User created',
          user_updated: '✏️ User updated',
          user_deleted: '🗑 User deleted',
          invite_created: '✉️ Invite created',
          invite_revoked: '🚫 Invite revoked',
          invite_accepted: '✅ Invite accepted',
          audit_cleared: '🧹 Log cleared',
          history_cleared: '🗂️ History cleared',
          test_pause: '⏸ Test paused',
          test_resume: '▶ Test resumed',
          reset_link_created: '🔑 Reset link sent',
          password_reset: '✅ Password reset',
        }[type] || type
      );
    },

    /** Human-readable test kind for audit Details chips */
    auditTestTypeLabel(type) {
      if (!type) {
        return '';
      }
      const map = {
        scenario: 'Scenario',
        curl: 'cURL',
        'curl-chain': 'cURL chain',
      };
      return map[type] || String(type);
    },

    /** Maps HTTP verb to existing `.method-*` badge classes */
    auditHttpMethodClass(method) {
      if (!method || typeof method !== 'string') {
        return 'method-get';
      }
      const key = method.toLowerCase();
      const allowed = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
      if (!allowed.includes(key)) {
        return 'method-unknown';
      }
      return key === 'patch' ? 'method-patch' : `method-${key}`;
    },

    osIcon(os) {
      if (!os) {
        return '';
      }
      if (/win/i.test(os)) {
        return '🪟';
      }
      if (/mac/i.test(os)) {
        return '🍎';
      }
      if (/linux/i.test(os)) {
        return '🐧';
      }
      if (/android/i.test(os)) {
        return '🤖';
      }
      if (/ios|ipad/i.test(os)) {
        return '📱';
      }
      return '💻';
    },

    // Dark Mode
    initializeDarkMode() {
      // Check localStorage for saved preference
      const savedMode = localStorage.getItem('darkMode');
      if (savedMode !== null) {
        this.isDarkMode = savedMode === 'true';
      } else {
        // Check system preference
        this.isDarkMode =
          window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      this.applyDarkMode();
    },

    toggleDarkMode() {
      this.isDarkMode = !this.isDarkMode;
      localStorage.setItem('darkMode', this.isDarkMode.toString());
      this.applyDarkMode();
      this.$nextTick(() => {
        if (typeof Chart !== 'undefined') {
          this.applyDashboardChartTheme();
        }
      });
    },

    applyDarkMode() {
      if (this.isDarkMode) {
        document.documentElement.classList.add('dark-mode');
      } else {
        document.documentElement.classList.remove('dark-mode');
      }
    },

    // WebSocket
    initializeWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = localStorage.getItem('authToken') || '';
      // Token is sent as a query param for the HTTP upgrade request (only option
      // the WS spec allows for auth at connection time in browsers).
      const wsUrl = `${protocol}//${window.location.host}?token=${encodeURIComponent(token)}`;

      this.ws = new WebSocket(wsUrl);
      this._wsReconnectDelay = this._wsReconnectDelay || 1000; // start at 1 s

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this._wsReconnectDelay = 1000; // reset backoff on successful connect
        this.ws.send(JSON.stringify({ type: 'subscribe' }));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        // Code 1008 = server kicked this session (admin updated the user).
        // Clear credentials and go to login immediately — no reconnect.
        if (event.code === 1008) {
          localStorage.removeItem('authToken');
          localStorage.removeItem('authUser');
          location.replace('/login');
          return;
        }
        // Exponential backoff: 1 s → 2 s → 4 s → … capped at 30 s
        const delay = this._wsReconnectDelay;
        this._wsReconnectDelay = Math.min(delay * 2, 30000);
        console.log(`WebSocket disconnected, reconnecting in ${delay / 1000}s…`);
        setTimeout(() => this.initializeWebSocket(), delay);
      };
    },

    handleWebSocketMessage(message) {
      // Admin updated this user — log out immediately
      if (message.type === 'force-logout') {
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        location.replace('/login');
        return;
      }

      // Skip expensive updates if page is not visible
      if (!this.isPageVisible && (message.type === 'metrics' || message.type === 'output')) {
        return;
      }

      switch (message.type) {
        case 'status':
          this.updateStatus(message.data);
          if (message.data.metrics) {
            this.updateMetricsThrottled(message.data.metrics);
          }
          break;
        case 'test-started':
          void this.onTestStarted(message.data);
          break;
        case 'test-stopped':
          this.onTestStopped(message.data);
          break;
        case 'test-complete':
          this.onTestComplete(message.data);
          if (message.data.metrics) {
            this.updateMetrics(message.data.metrics);
          }
          break;
        case 'metrics':
          this.updateMetricsThrottled(message.data);
          break;
        case 'output':
          this.appendOutput(message.data.message, message.data.type);
          break;
        case 'test-preparing':
          this.preparingUser = message.data.preparingUser || null;
          break;
        default:
          break;
      }
    },

    setupVisibilityHandlers() {
      this.handleVisibilityChange = () => {
        this.isPageVisible = !document.hidden;
        // When page becomes visible, update immediately
        if (this.isPageVisible && this.isRunning) {
          this.loadStatus();
        }
      };
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    },

    updateMetricsThrottled(metrics) {
      const now = Date.now();
      if (now - this.lastMetricsUpdate < this.metricsUpdateThrottle) {
        // Store latest metrics for next update
        this.pendingMetrics = metrics;
        return;
      }

      this.lastMetricsUpdate = now;
      this.updateMetrics(metrics);

      // Process any pending metrics
      if (this.pendingMetrics) {
        const pending = this.pendingMetrics;
        this.pendingMetrics = null;
        setTimeout(() => this.updateMetricsThrottled(pending), this.metricsUpdateThrottle);
      }
    },

    // API Calls
    async loadAvailableTests() {
      try {
        const response = await apiFetch(`${API_BASE}/tests`);
        const result = await response.json();

        if (result.success) {
          this.availableTests = result.data;
        }
      } catch (error) {
        console.error('Error loading tests:', error);
        this.showToast('Failed to load available tests', 'error');
      }
    },

    async loadStatus() {
      try {
        const response = await apiFetch(`${API_BASE}/status`);
        const result = await response.json();

        if (result.success) {
          // Check if there's a recent paused test in history
          if (
            !result.data.pausedForResume &&
            result.data.history &&
            result.data.history.length > 0
          ) {
            const lastTest = result.data.history[0];
            const histSt = String(lastTest.status || '').toLowerCase();
            if ((histSt === 'stopped' || histSt === 'paused') && !result.data.running) {
              // User-stopped / discarded run (history used "paused" before server used "stopped")
              this.statusText = 'Stopped';
              this.testCompleted = true;
              this.isRunning = false;
              this.showConfigPanel = false;
              // History `id` is the unique run id (report filename); `testId` is the scenario slug.
              if (lastTest.id) {
                this.currentTestId = lastTest.id;
              }
              if (lastTest.startTime) {
                this.startTime = new Date(lastTest.startTime);
              }
              if (lastTest.endTime) {
                this.endTime = new Date(lastTest.endTime);
              }
              // Calculate elapsed time from startTime to endTime (fixed when paused)
              if (this.startTime && this.endTime) {
                const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
                this.elapsedTime = this.formatDuration(elapsed);
              } else if (this.startTime) {
                // If no endTime, calculate from startTime to now
                const elapsed = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
                this.elapsedTime = this.formatDuration(elapsed);
              }
              // Don't start timer for paused tests - elapsed time is fixed
              this.progress = 100;

              this.stoppedById = lastTest.stoppedBy ?? null;
              this.stoppedByUsername = lastTest.stoppedByUsername || null;
              // Chart data: load in updateStatus "already completed" branch (history sets testCompleted
              // before updateStatus, which skips the branch that calls autoLoadLastMetrics).
            }
          }
          this.updateStatus(result.data);

          // Who started the last finished run — history is authoritative after refresh (in-memory
          // `status` may omit `startedBy` / `endTime` after restart). Apply whenever idle on server.
          if (result.data.history?.[0] && !result.data.running) {
            const h0 = result.data.history[0];
            if (h0.startedBy != null) {
              this.startedById = h0.startedBy;
            }
            if (h0.startedByUsername) {
              this.startedByUsername = h0.startedByUsername;
            }
          }

          // If I was the preparingUser before a refresh/re-login, clear stale queue
          const p = result.data.preparingUser;
          if (p && this.authUser) {
            const myId = this.authUser.id;
            const isMe = myId ? p.id === myId : p.username === this.authUser.username;
            if (isMe) {
              apiFetch(`${API_BASE}/tests/cancel-prepare`, { method: 'POST' }).catch(() => {});
            }
          }

          this.pausedLockTick += 1;

          // Persisted console tail (saved when the run finished) — fills Test Output after
          // refresh/login when in-memory `status.output` is empty (e.g. server restart).
          const hist0 = result.data.history?.[0];
          const snap = hist0?.outputSnapshot;
          const showLastRun =
            !result.data.running &&
            !result.data.pausedForResume &&
            (this.statusText === 'Stopped' ||
              this.statusText === 'Completed' ||
              this.statusText === 'Failed');
          if (showLastRun && snap?.length && this.outputLines.length === 0) {
            this.replayStatusOutputLines(snap);
          }
        }
      } catch (error) {
        console.error('Error loading status:', error);
      }
    },

    async loadHistory() {
      try {
        const response = await apiFetch(`${API_BASE}/history?limit=50`);
        const result = await response.json();

        if (result.success) {
          this.testHistory = result.data.map((test) => {
            const st = String(test.status || '').toLowerCase();
            return {
              ...test,
              status: st === 'paused' ? 'stopped' : test.status,
              // Prefer configured k6 duration (e.g. 30s) so pause/resume does not inflate
              // the value with wall-clock gaps. Fall back to start→end for legacy rows.
              duration: this.historyDisplayDuration(test),
            };
          });
        }
      } catch (error) {
        console.error('Error loading history:', error);
      }
    },

    async startTest() {
      if (!this.selectedTest) {
        this.showToast('Please select a test scenario', 'warning');
        return;
      }

      if (this.config.vus < 1) {
        this.showToast('Virtual Users must be at least 1', 'error');
        return;
      }

      if (!this.config.duration || !/^\d+[smh]$/i.test(this.config.duration)) {
        this.showToast('Invalid duration format. Use format like: 30s, 5m, 1h', 'error');
        return;
      }

      try {
        this.isLoading = true;
        this.preparingUser = null; // Clear locally — server clears it when test starts

        // Clear previous test data when starting a new test
        this.testCompleted = false;
        this._lastChartHydrateTestId = null;
        this.endTime = null;
        this.statusText = 'Running';
        this.progress = 0;
        this.elapsedTime = '-';
        this.startTime = null;
        this.testDuration = this.parseDuration(this.config.duration); // Store duration in seconds
        this.currentTestVus = this.config.vus; // remember actual VUs for metric display
        this.stopElapsedTimer();

        // Reset metrics when starting a new test
        // Don't reset charts here - they will be reset/initialized in onTestStarted
        // when the canvas elements are actually in the DOM
        this.resetMetrics();

        const startOptions = {
          vus: this.config.vus,
          duration: this.config.duration,
        };
        // cURL-generated scenarios derive the target directly from the imported URL,
        // so environment selection is irrelevant and omitted from start payload.
        if (!this.selectedTestIsCurl) {
          startOptions.environment = this.config.environment;
        }

        const response = await apiFetch(`${API_BASE}/tests/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            testId: this.selectedTest,
            options: startOptions,
          }),
        });

        const result = await response.json();

        if (result.success) {
          this.currentTestId = result.data.testId;
          this.runWallOffsetMs = 0;
          this.pauseHoldStartedAt = null;
          this.showToast(`Test "${result.data.message}" started`, 'success');
          this.clearOutput();
        } else {
          this.showToast(result.error || 'Failed to start test', 'error');
          this.loadStatus();
        }
      } catch (error) {
        console.error('Error starting test:', error);
        this.showToast(`Failed to start test: ${error.message}`, 'error');
        this.loadStatus();
      } finally {
        this.isLoading = false;
      }
    },

    async pauseTest() {
      if (!this.canPause) {
        return;
      }
      try {
        this.isPausingTest = true;
        this.isLoading = true;
        const response = await apiFetch(`${API_BASE}/tests/pause`, { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          this.showToast('Pausing test…', 'info');
        } else {
          this.showToast(result.error || 'Failed to pause test', 'error');
        }
      } catch (error) {
        console.error('Error pausing test:', error);
        this.showToast(`Failed to pause test: ${error.message}`, 'error');
      } finally {
        this.isPausingTest = false;
        this.isLoading = false;
      }
    },

    async resumeTest() {
      if (!this.canResume) {
        return;
      }
      try {
        this.isLoading = true;
        const response = await apiFetch(`${API_BASE}/tests/resume`, { method: 'POST' });
        const result = await response.json();
        if (!result.success) {
          this.showToast(result.error || 'Failed to resume test', 'error');
          this.loadStatus();
        }
      } catch (error) {
        console.error('Error resuming test:', error);
        this.showToast(`Failed to resume test: ${error.message}`, 'error');
        this.loadStatus();
      } finally {
        this.isLoading = false;
      }
    },

    _refreshLoadUpdateSnapshot() {
      this._loadUpdateSnapshotVus = Number(this.config.vus);
      this._loadUpdateSnapshotDur = String(this.config.duration).trim();
    },

    /**
     * Ramp up/down: new VUs and segment duration while running (k6 restarts; same logical run).
     * Sends only fields that changed vs. last sync so a duration-only edit does not resend VUs (and vice versa).
     */
    async applyLoadUpdate() {
      if (!this.canEditLoadWhileRunning || this.isApplyingLoadUpdate) {
        return;
      }
      const snapV = this._loadUpdateSnapshotVus;
      const snapD = this._loadUpdateSnapshotDur;
      const curV = Number(this.config.vus);
      const curD = String(this.config.duration).trim();
      const payload = {};
      if (snapV === null || snapD === null) {
        payload.vus = curV;
        payload.duration = curD;
      } else {
        if (curV !== Number(snapV)) {
          payload.vus = curV;
        }
        if (curD !== String(snapD).trim()) {
          payload.duration = curD;
        }
      }
      if (Object.keys(payload).length === 0) {
        this.showToast('Change VUs or segment duration before applying', 'info');
        return;
      }
      try {
        this.isApplyingLoadUpdate = true;
        const response = await apiFetch(`${API_BASE}/tests/update-load`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result.success) {
          this.showToast(result.error || 'Failed to update load', 'error');
          return;
        }
        this.showToast(result.data?.message || 'Load updated', 'success');
        await this.loadStatus();
        this._refreshLoadUpdateSnapshot();
      } catch (error) {
        console.error('Error updating load:', error);
        this.showToast(error.message || 'Failed to update load', 'error');
        await this.loadStatus();
      } finally {
        this.isApplyingLoadUpdate = false;
      }
    },

    async stopTest() {
      try {
        this.isStoppingTest = true;
        this.isLoading = true;
        const response = await apiFetch(`${API_BASE}/tests/stop`, {
          method: 'POST',
        });

        const result = await response.json();

        if (result.success) {
          this.runWallOffsetMs = 0;
          this.pauseHoldStartedAt = null;
          if (result.data?.status === 'discarded') {
            this.showToast(result.data.message || 'Paused session discarded.', 'success');
          } else {
            this.showToast('Test stopped successfully', 'success');
          }
        } else {
          this.showToast(result.error || 'Failed to stop test', 'error');
        }
      } catch (error) {
        console.error('Error stopping test:', error);
        this.showToast(`Failed to stop test: ${error.message}`, 'error');
      } finally {
        this.isStoppingTest = false;
        this.isLoading = false;
      }
    },

    showConfirmDialog(title, message, callback, options = {}) {
      this.confirmTitle = title;
      this.confirmMessage = message;
      this.confirmCallback = callback;
      this.confirmPrimaryLabel = options.primaryLabel || 'Confirm';
      this.showConfirmModal = true;
    },

    confirmAction() {
      if (this.confirmCallback) {
        this.confirmCallback();
      }
      this.showConfirmModal = false;
      this.confirmCallback = null;
      this.confirmPrimaryLabel = 'Confirm';
    },

    cancelConfirm() {
      this.showConfirmModal = false;
      this.confirmCallback = null;
      this.confirmPrimaryLabel = 'Confirm';
    },

    // Status Updates
    updateStatus(status) {
      // Sync preparing user from every status update
      if ('preparingUser' in status) {
        this.preparingUser = status.preparingUser || null;
      }
      if ('pausedForResume' in status) {
        this.pausedForResume = Boolean(status.pausedForResume);
      }
      if ('resumeInfo' in status) {
        this.resumeInfo = status.resumeInfo || null;
      }

      if (status.running) {
        this.pausedForResume = false;
        this.resumeInfo = null;
        if (this.pauseHoldStartedAt != null) {
          this.runWallOffsetMs =
            (this.runWallOffsetMs || 0) + (Date.now() - this.pauseHoldStartedAt);
          this.pauseHoldStartedAt = null;
        }
        const wasAlreadyRunning = this.isRunning;
        const incomingTestId = status.testId || null;
        const prevTestId = this.currentTestId;
        const isNewRun =
          !wasAlreadyRunning ||
          Boolean(incomingTestId && prevTestId && incomingTestId !== prevTestId);

        if (incomingTestId) {
          this.currentTestId = incomingTestId;
        }
        this.isRunning = true;
        this.syncLockedRunConfigFromStatus(status);
        // Total planned wall time for progress — must refresh after load update (same startTime / testId).
        if (status.options?.duration) {
          const totalSec = this.parseDuration(status.options.duration);
          if (totalSec != null && totalSec > 0) {
            this.testDuration = totalSec;
          }
        }
        this.testCompleted = false;
        this.stoppedById = null;
        this.stoppedByUsername = null;
        this.statusText = 'Running';
        this.showConfigPanel = this.canSeeScenarios; // Scenario sidebar only for users with that tab
        this.currentTestName = status.testName || this.currentTestName || '-';
        this.startedByUsername = status.startedByUsername || null;
        this.startedById = status.startedBy != null ? status.startedBy : null;

        if (isNewRun) {
          this._loadUpdateSnapshotVus = null;
          this._loadUpdateSnapshotDur = null;
          this.endTime = null;
          this.progress = status.progress !== undefined ? Number(status.progress) : 0;
          this.resetMetrics();
        } else if (status.progress !== undefined) {
          this.progress = Math.min(100, Math.max(0, Number(status.progress)));
        }

        if (status.startTime) {
          const st = new Date(status.startTime);
          const startChanged = !this.startTime || st.getTime() !== this.startTime.getTime();
          if (isNewRun || startChanged) {
            this.stopElapsedTimer();
            this.startTime = st;
            if (status.options) {
              if (status.options.duration) {
                const totalSec = this.parseDuration(status.options.duration);
                if (totalSec != null && totalSec > 0) {
                  this.testDuration = totalSec;
                }
              }
              if (status.options.vus) {
                this.currentTestVus = status.options.vus;
              }
            }
            this.startElapsedTimer();
          }
        }

        if (!this.testDuration && status.options?.duration) {
          const totalSec = this.parseDuration(status.options.duration);
          if (totalSec != null && totalSec > 0) {
            this.testDuration = totalSec;
          }
        }

        // Replay buffered output for users who connect/refresh while a test is already running
        if (!wasAlreadyRunning) {
          this.replayStatusOutputLines(status.output);
        }

        // Update metrics if provided
        if (status.metrics) {
          this.updateMetrics(status.metrics);
        }

        // If we just transitioned to running (page load/refresh while test in progress),
        // ensure charts are initialised — they won't get onTestStarted in this case.
        if (!wasAlreadyRunning) {
          this.$nextTick(() => {
            let retries = 0;
            const tryInit = () => {
              if (!this.isRunning) {
                return;
              }
              const r = document.getElementById('requestsChart');
              const t = document.getElementById('responseTimeChart');
              const d = document.getElementById('distributionChart');
              if (r && t && d && r.getContext) {
                const rect = r.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  this.resetCharts();
                  this.initializeCharts();
                  return;
                }
              }
              if (retries++ < 20) {
                setTimeout(tryInit, 150);
              }
            };
            setTimeout(tryInit, 200);
          });
        }

        if (
          this.canEditLoadWhileRunning &&
          this._loadUpdateSnapshotVus === null &&
          this._loadUpdateSnapshotDur === null
        ) {
          this._refreshLoadUpdateSnapshot();
        }
      } else {
        // Test is not running
        this.isRunning = false;
        this._loadUpdateSnapshotVus = null;
        this._loadUpdateSnapshotDur = null;

        if (status.pausedForResume) {
          this.testCompleted = false;
          this.statusText = 'Paused';
          if (status.testId) {
            this.currentTestId = status.testId;
          }
          if (status.testName) {
            this.currentTestName = status.testName;
          }
          if (status.startTime) {
            this.startTime = new Date(status.startTime);
          }
          if (status.endTime) {
            this.endTime = new Date(status.endTime);
          }
          if (status.startedByUsername) {
            this.startedByUsername = status.startedByUsername;
          }
          if (status.startedBy != null) {
            this.startedById = status.startedBy;
          }
          this.stoppedById = status.stoppedBy ?? null;
          this.stoppedByUsername = status.stoppedByUsername ?? null;
          this.progress = status.progress !== undefined ? Number(status.progress) : 0;
          this.stopElapsedTimer();
          if (status.options?.duration) {
            this.testDuration = this.parseDuration(status.options.duration);
          }
          if (status.resumeInfo?.consumedMs != null) {
            let sec = Math.max(0, Math.ceil(status.resumeInfo.consumedMs / 1000));
            if (this.testDuration != null && this.testDuration > 0) {
              sec = Math.min(sec, this.testDuration);
            }
            this.elapsedTime = this.formatDuration(sec);
          } else if (this.startTime && this.endTime) {
            const skewMs = Number(this.runWallOffsetMs) || 0;
            const elapsed = Math.max(
              0,
              Math.floor((this.endTime - this.startTime - skewMs) / 1000)
            );
            this.elapsedTime = this.formatDuration(elapsed);
          }
          if (status.options?.vus) {
            this.currentTestVus = status.options.vus;
          }
          this.syncLockedRunConfigFromStatus(status);
          if (this.pauseHoldStartedAt == null) {
            this.pauseHoldStartedAt = Date.now();
          }
          this.showConfigPanel = this.canSeeScenarios;
          this.replayStatusOutputLines(status.output, true);
          if (status.metrics) {
            this.updateMetrics(status.metrics);
          }
          if (status.testId) {
            void (async () => {
              await this.autoLoadLastMetrics(status.testId);
              await this.$nextTick();
              await new Promise((resolve) => {
                setTimeout(resolve, 400);
              });
              let retries = 0;
              const tryInitChartsPaused = () => {
                if (!this.pausedForResume) {
                  return;
                }
                const r = document.getElementById('requestsChart');
                const t = document.getElementById('responseTimeChart');
                const d = document.getElementById('distributionChart');
                if (r && t && d && r.getContext) {
                  const rect = r.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    if (!chartInstances.requests || !chartInstances.responseTime) {
                      this.resetCharts();
                      this.initializeCharts();
                    }
                    return;
                  }
                }
                if (retries++ < 30) {
                  setTimeout(tryInitChartsPaused, 150);
                }
              };
              tryInitChartsPaused();
            })();
          }
          return;
        }

        this.stoppedById = status.stoppedBy ?? null;
        this.stoppedByUsername = status.stoppedByUsername ?? null;
        // Always sync from server so a page-refresh after completion still shows the runner
        if (status.startedByUsername) {
          this.startedByUsername = status.startedByUsername;
        }
        if (status.startedBy != null) {
          this.startedById = status.startedBy;
        }

        // Rehydrate console after refresh / login when the run is already finished (e.g. Stopped).
        this.replayStatusOutputLines(status.output);

        // If test was running and now stopped, mark as completed
        if (this.testCompleted === false && (this.startTime || status.endTime)) {
          this.testCompleted = true;

          // Update metric cards instantly from the status payload (fast path).
          if (status.metrics) {
            this.updateMetrics(status.metrics);
          }
          // Always fetch the full results file to get the proper time-series for
          // charts. The in-memory status.metrics only gives a single snapshot,
          // so we always need the NDJSON-derived chartSeries.
          if (status.testId) {
            this.currentTestId = status.testId;
            this._lastChartHydrateTestId = status.testId;
            this.autoLoadLastMetrics(status.testId);
          }

          // Preserve test name if available
          if (status.testName) {
            this.currentTestName = status.testName;
          }

          // Set status based on exit code or error
          if (status.error) {
            // Check if test was manually stopped by user
            if (isTerminalPauseStopError(status.error)) {
              this.statusText = 'Stopped';
            } else {
              this.statusText = 'Failed';
              this.appendOutput(`Error: ${status.error}`, 'error');
            }
          } else if (status.endTime) {
            this.statusText = 'Completed';
          }

          // Sync end time + duration for Completed, Failed, Stopped, or Paused (server sets endTime on exit)
          if (status.endTime) {
            this.endTime = new Date(status.endTime);
            if (status.startTime && !this.startTime) {
              this.startTime = new Date(status.startTime);
            }
            if (this.startTime && this.endTime) {
              const raw = Math.floor((this.endTime - this.startTime) / 1000);
              const elapsed = this.testDuration
                ? Math.min(Math.max(0, raw), this.testDuration)
                : Math.max(0, raw);
              this.elapsedTime = this.formatDuration(elapsed);
            }
          }

          if (!status.error && !status.endTime) {
            this.statusText = 'Completed';
            // Calculate elapsed time from current time if we have startTime
            if (this.startTime) {
              const raw = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
              const elapsed = this.testDuration ? Math.min(raw, this.testDuration) : raw;
              this.elapsedTime = this.formatDuration(elapsed);
            }
          }

          // Stop the timer but keep the elapsed time
          this.stopElapsedTimer();

          // Hide Test Configuration when the run is finished (including user-stopped).
          if (
            this.statusText === 'Completed' ||
            this.statusText === 'Failed' ||
            this.statusText === 'Stopped'
          ) {
            this.showConfigPanel = false;
          }

          // Stopped tests: elapsed from startTime to endTime (fixed), not capped to configured duration
          if (this.statusText === 'Stopped' && this.startTime && this.endTime) {
            const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
            this.elapsedTime = this.formatDuration(elapsed);
          }

          // Set progress to 100% if test completed
          if (
            this.statusText === 'Completed' ||
            this.statusText === 'Failed' ||
            this.statusText === 'Stopped' ||
            this.statusText === 'Paused'
          ) {
            this.progress = 100;
          }
        } else if (this.testCompleted && (status.endTime || this.endTime)) {
          // Test already completed on server — sync both timestamps (fixes missing duration after refresh).
          // After a server restart `status.endTime` may be null while we already hydrated `endTime` from history.
          if (status.endTime) {
            this.endTime = new Date(status.endTime);
          } else if (this.endTime && !(this.endTime instanceof Date)) {
            this.endTime = new Date(this.endTime);
          }
          if (status.startTime) {
            this.startTime = new Date(status.startTime);
          }
          if (status.options?.duration && !this.testDuration) {
            this.testDuration = this.parseDuration(status.options.duration);
          }
          if (this.startTime && this.endTime) {
            const raw = Math.floor((this.endTime - this.startTime) / 1000);
            const elapsed = this.testDuration
              ? Math.min(Math.max(0, raw), this.testDuration)
              : Math.max(0, raw);
            this.elapsedTime = this.formatDuration(elapsed);
          }
          if (this.statusText === 'Stopped') {
            this.showConfigPanel = false;
            if (this.startTime && this.endTime) {
              const wall = Math.floor((this.endTime - this.startTime) / 1000);
              this.elapsedTime = this.formatDuration(wall);
            }
          }
          // Preserve test name if available
          if (status.testName) {
            this.currentTestName = status.testName;
          }
          // History pre-block sets testCompleted before updateStatus, so the branch above never runs
          // and never calls autoLoadLastMetrics — fetch NDJSON chart series here for Stopped/Completed/Failed.
          {
            const tid = status.testId || this.currentTestId;
            if (tid && this._lastChartHydrateTestId !== tid) {
              this._lastChartHydrateTestId = tid;
              if (status.testId) {
                this.currentTestId = status.testId;
              }
              void this.autoLoadLastMetrics(tid);
            }
          }
          // Keep terminal label when in-memory already says so (server may omit `error` after restart).
          if (this.statusText === 'Stopped' || this.statusText === 'Paused') {
            if (this.startTime && this.endTime) {
              const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
              this.elapsedTime = this.formatDuration(elapsed);
            }
          }
        } else if (!this.testCompleted) {
          // Check if there's an error indicating a paused test
          if (status.error && isTerminalPauseStopError(status.error)) {
            this.statusText = 'Stopped';
            this.testCompleted = true;
            if (status.testName) {
              this.currentTestName = status.testName;
            }
            if (status.endTime) {
              this.endTime = new Date(status.endTime);
            }
            if (status.startTime) {
              this.startTime = new Date(status.startTime);
              if (this.endTime) {
                const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
                this.elapsedTime = this.formatDuration(elapsed);
              }
              // Don't start timer — elapsed time is fixed
            }
            this.progress = 100;
            this.showConfigPanel = false;
            if (status.testId) {
              this.currentTestId = status.testId;
              if (this._lastChartHydrateTestId !== status.testId) {
                this._lastChartHydrateTestId = status.testId;
                void this.autoLoadLastMetrics(status.testId);
              }
            }
          } else {
            // Only reset if no test has completed (initial state)
            const wasPaused = this.statusText === 'Paused' || this.statusText === 'Stopped';
            this.statusText = 'Idle';
            this.currentTestName = '-';
            this.progress = 0;
            this.elapsedTime = '-';
            this.stopElapsedTimer();
            this.startTime = null;
            this.endTime = null;
            this.testDuration = null;

            if (!wasPaused) {
              this.resetCharts();
            }
          }
        }
        // If testCompleted is true, preserve all the data
      }

      if (status.error && this.isRunning) {
        this.statusText = 'Error';
        this.appendOutput(`Error: ${status.error}`, 'error');
      }
    },

    // Silently fetch the saved metrics for a completed test, populate the
    // metrics cards, and replay the full time-series into the charts.
    // Called when any user loads the page after a test has already finished.
    async autoLoadLastMetrics(testId) {
      try {
        const response = await apiFetch(`${API_BASE}/results/${testId}`);
        if (!response.ok) {
          return;
        }
        const result = await response.json();
        if (!result.success || !result.data?.metrics) {
          return;
        }

        const { metrics, chartSeries } = result.data;

        // Update metric cards immediately
        this.updateMetrics(metrics);

        // Wait for Vue to render the metrics panel (v-if="isRunning || testCompleted")
        await this.$nextTick();

        let retries = 0;
        const pushToCharts = () => {
          if (chartInstances.requests && chartInstances.responseTime) {
            // Charts ready — replay full time-series or fall back to single snapshot
            if (chartSeries && chartSeries.times && chartSeries.times.length > 0) {
              this.replayChartSeries(chartSeries);
              this.syncDistributionChart(metrics);
            } else {
              this.updateCharts(metrics);
            }
          } else if (!this.chartsInitializing) {
            this.destroyChartJsInstances();
            this.initializeCharts();
            // Queue data for when init finishes — replayChartSeries will be called
            // from inside initializeCharts via pendingChartMetrics flush path
            this.pendingChartSeries = chartSeries || null;
            this.pendingChartMetrics = metrics;
          } else if (retries++ < 40) {
            setTimeout(pushToCharts, 150);
          }
        };

        setTimeout(pushToCharts, 300);
      } catch {
        // Non-critical — metrics panel simply stays at '-' if fetch fails
      }
    },

    // Replay a saved per-second time-series into the live charts.
    replayChartSeries(series) {
      if (!chartInstances.requests || !chartInstances.responseTime) {
        return;
      }
      if (!series || !series.times || series.times.length === 0) {
        return;
      }

      const reqChart = chartInstances.requests;
      const rtChart = chartInstances.responseTime;

      // Clear existing data
      reqChart.data.labels = [];
      reqChart.data.datasets[0].data = [];
      rtChart.data.labels = [];
      rtChart.data.datasets[0].data = [];

      for (let i = 0; i < series.times.length; i++) {
        reqChart.data.labels.push(series.times[i]);
        reqChart.data.datasets[0].data.push(Number((series.rps[i] || 0).toFixed(2)));
        rtChart.data.labels.push(series.times[i]);
        rtChart.data.datasets[0].data.push(Math.round(series.avgResponseTime[i] || 0));
      }

      reqChart.update('none');
      rtChart.update('none');
    },

    /** Tear down Chart.js instances only (keeps requestStats / failureDetails intact). */
    destroyChartJsInstances() {
      if (chartInstances.requests) {
        try {
          if (chartInstances.requests.destroy) {
            chartInstances.requests.destroy();
          }
        } catch (e) {
          console.warn('Error destroying requests chart:', e);
        }
        chartInstances.requests = null;
        this.charts.requests = null;
      }
      if (chartInstances.responseTime) {
        try {
          if (chartInstances.responseTime.destroy) {
            chartInstances.responseTime.destroy();
          }
        } catch (e) {
          console.warn('Error destroying response time chart:', e);
        }
        chartInstances.responseTime = null;
        this.charts.responseTime = null;
      }
      if (chartInstances.distribution) {
        try {
          if (chartInstances.distribution.destroy) {
            chartInstances.distribution.destroy();
          }
        } catch (e) {
          console.warn('Error destroying distribution chart:', e);
        }
        chartInstances.distribution = null;
        this.charts.distribution = null;
      }
    },

    /**
     * After leaving cURL (or any path where the dashboard was display:none), canvases had
     * no layout so charts never initialised. Rebuild charts and reload saved series.
     */
    scheduleSyncDashboardCharts() {
      if (this._syncDashChartsTimer) {
        clearTimeout(this._syncDashChartsTimer);
      }
      this._syncDashChartsTimer = setTimeout(() => {
        this._syncDashChartsTimer = null;
        this.syncDashboardChartsFromVisibleLayout();
      }, 80);
    },

    syncDashboardChartsFromVisibleLayout() {
      if (this.activeTab !== 'dashboard') {
        return;
      }
      if (!this.isRunning && !this.testCompleted) {
        return;
      }
      let retries = 0;
      const tick = () => {
        if (this.activeTab !== 'dashboard') {
          return;
        }
        const r = document.getElementById('requestsChart');
        const t = document.getElementById('responseTimeChart');
        const d = document.getElementById('distributionChart');
        if (!r || !t || !d) {
          if (retries++ < 40) {
            requestAnimationFrame(tick);
          }
          return;
        }
        const rect = r.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
          if (retries++ < 50) {
            requestAnimationFrame(tick);
            return;
          }
        }
        this.destroyChartJsInstances();
        this.chartsInitializing = false;
        this.initializeCharts();
        if (this.currentTestId && this.testCompleted) {
          void this.autoLoadLastMetrics(this.currentTestId);
        }
      };
      requestAnimationFrame(tick);
    },

    resetCharts() {
      // Safely reset charts only if they exist
      try {
        if (this.charts.requests && this.charts.requests.data) {
          this.charts.requests.data.labels = [];
          this.charts.requests.data.datasets[0].data = [];
          this.charts.requests.update('none');
        }

        if (this.charts.responseTime && this.charts.responseTime.data) {
          this.charts.responseTime.data.labels = [];
          this.charts.responseTime.data.datasets[0].data = [];
          this.charts.responseTime.update('none');
        }

        if (this.charts.distribution && this.charts.distribution.data) {
          this.charts.distribution.data.datasets[0].data = [0, 0, 0, 0, 0, 0];
          this.charts.distribution.update('none');
        }
      } catch (error) {
        console.warn('Error resetting charts:', error);
        // If charts don't exist or are being destroyed, that's okay
      }

      this.requestStats = [];
      this.failureDetails = {};
    },

    resetMetrics() {
      // Reset metric values to defaults
      this.metrics[0].value = '-'; // Requests/s
      this.metrics[1].value = '-'; // Avg Response
      this.metrics[2].value = '-'; // Errors
      this.metrics[3].value = '-'; // Data Transferred
      this.metrics[4].value = '-'; // Active Users
      this.metrics[5].value = '-'; // Failure Rate

      // Reset chart data
      this.chartData = {
        requests: { labels: [], data: [] },
        responseTime: { labels: [], data: [] },
        distribution: { labels: [], data: [] },
      };

      // Clear latest chart metrics
      this.latestChartMetrics = null;
    },

    startElapsedTimer() {
      if (this.elapsedInterval) {
        clearInterval(this.elapsedInterval);
      }

      this.elapsedInterval = setInterval(() => {
        // Stop self if the test is no longer running (belt-and-suspenders guard)
        if (!this.isRunning || this.statusText === 'Paused' || this.statusText === 'Stopped') {
          this.stopElapsedTimer();
          return;
        }

        if (this.startTime) {
          const skewMs = Number(this.runWallOffsetMs) || 0;
          const rawElapsed = Math.floor((Date.now() - this.startTime.getTime() - skewMs) / 1000);
          const elapsed = this.testDuration
            ? Math.min(Math.max(0, rawElapsed), this.testDuration)
            : Math.max(0, rawElapsed);
          this.elapsedTime = this.formatDuration(elapsed);

          // Calculate progress based on elapsed time vs total duration
          if (this.testDuration) {
            this.progress = this.calculateProgress(elapsed, this.testDuration);
          } else {
            // Without duration the timer used to leave progress stuck at 100% from the prior run.
            this.progress = 0;
          }
        }
      }, 1000);
    },

    stopElapsedTimer() {
      if (this.elapsedInterval) {
        clearInterval(this.elapsedInterval);
        this.elapsedInterval = null;
      }
    },

    syncLockedRunConfigFromStatus(status) {
      if (!status?.options) {
        return;
      }
      const o = status.options;
      if (o.testId != null && o.testId !== '') {
        this.selectedTest = o.testId;
      }
      if (o.environment) {
        this.config.environment = o.environment;
      }
      if (o.vus != null && !Number.isNaN(Number(o.vus))) {
        this.config.vus = Number(o.vus);
      }
      // `duration` is total planned time for the run; `segmentDuration` is the active k6 segment (after pause/resume or load update).
      if (o.segmentDuration) {
        this.config.duration = o.segmentDuration;
      } else if (o.duration) {
        this.config.duration = o.duration;
      }
      const test = this.availableTests.find((t) => t.id === this.selectedTest);
      if (test) {
        this.testDescription = test.description || '';
        this.testSteps = test.steps || [];
      }
    },

    async onTestStarted(data) {
      this.currentTestId = data.testId;
      this.isRunning = true; // Ensure isRunning is set so canvas elements are rendered
      if (data.loadUpdate) {
        this.pausedForResume = false;
        this.resumeInfo = null;
        this.testCompleted = false;
        this.statusText = 'Running';
        this.endTime = null;
        this._lastReqCount = null;
        this._lastMetricsMs = null;
        this.stopElapsedTimer();
        await this.loadStatus();
        this.startElapsedTimer();
        return;
      }
      if (data.resumed) {
        this.pausedForResume = false;
        this.resumeInfo = null;
        this.testCompleted = false;
        this.statusText = 'Running';
        this.endTime = null;
        this.showToast('Test resumed', 'success');
        this._lastReqCount = null;
        this._lastMetricsMs = null;
        this.stopElapsedTimer();
        await this.loadStatus();
        this.startElapsedTimer();
        return;
      }
      this.runWallOffsetMs = 0;
      this.pauseHoldStartedAt = null;
      // Clear last-run terminal UI before the follow-up `status` WebSocket message.
      // (Otherwise testCompleted/endTime stay set and the header can stick on "Completed".)
      this.testCompleted = false;
      this.statusText = 'Running';
      this.endTime = null;
      this.startTime = null;
      this.testDuration = null; // must clear so elapsed timer does not reuse last run's duration
      this.progress = 0;
      this.elapsedTime = '-';
      this.stopElapsedTimer();
      this.showConfigPanel = this.canSeeScenarios;
      this.stoppedById = null;
      this.stoppedByUsername = null;
      if (data.startedByUsername) {
        this.startedByUsername = data.startedByUsername;
      }
      if (data.startedBy != null) {
        this.startedById = data.startedBy;
      }
      this.showToast(`Test "${data.testName}" started`, 'success');

      // Reset per-second delta trackers so the first chart point is clean
      this._lastReqCount = null;
      this._lastMetricsMs = null;

      // Reset chart data before initializing
      this.resetMetrics();

      // Reinitialize charts after test starts (when metrics panel is visible)
      // Wait for isRunning to be true so metrics panel is rendered
      this.$nextTick(() => {
        let retryCount = 0;
        const maxRetries = 30; // 3 seconds max wait

        const checkAndInit = () => {
          if (this.isRunning && typeof Chart !== 'undefined' && !this.chartsInitializing) {
            // Check if chart canvas elements exist and are in the DOM
            const requestsCtx = document.getElementById('requestsChart');
            const responseCtx = document.getElementById('responseTimeChart');
            const distCtx = document.getElementById('distributionChart');

            if (requestsCtx && responseCtx && distCtx && requestsCtx.getContext) {
              try {
                // Verify we can get 2D context and canvas has dimensions (v-show may hide dashboard)
                const testCtx = requestsCtx.getContext('2d');
                const rect = requestsCtx.getBoundingClientRect();
                if (testCtx && rect.width > 0 && rect.height > 0) {
                  // Reset existing charts first if they exist
                  this.resetCharts();
                  // Then initialize new charts
                  this.initializeCharts();
                  return;
                }
              } catch (e) {
                console.warn('Canvas not ready yet:', e);
              }
            }
          }
          // Retry if not ready yet
          if (!this.chartsInitializing && retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkAndInit, 100);
          }
        };
        // Start checking after a short delay to ensure DOM is updated
        setTimeout(checkAndInit, 200);
      });

      this.loadStatus();
    },

    onTestStopped(_data) {
      this.statusText = 'Stopped';
      this.isRunning = false;
      this.testCompleted = true;
      this.showConfigPanel = false;
      this.runWallOffsetMs = 0;
      this.pauseHoldStartedAt = null;
      this.stopElapsedTimer();
      // Calculate fixed elapsed time if we have startTime and endTime
      if (this.startTime && this.endTime) {
        const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
        this.elapsedTime = this.formatDuration(elapsed);
      }
      this.loadStatus();
      this.loadHistory();
    },

    onTestComplete(data) {
      // Stop the timer immediately — don't wait for the async loadStatus() to resolve
      this.isRunning = false;
      this.stopElapsedTimer();
      this.runWallOffsetMs = 0;
      this.pauseHoldStartedAt = null;
      this.testCompleted = true;
      this.progress = 100;
      this.endTime = new Date();

      // Fix the final elapsed time right now (loadStatus will refine it with the
      // server's endTime, but this prevents the display from continuing to tick)
      if (this.startTime) {
        const raw = Math.floor((this.endTime - this.startTime) / 1000);
        const elapsed = this.testDuration ? Math.min(raw, this.testDuration) : raw;
        this.elapsedTime = this.formatDuration(elapsed);
      }

      if (data.status === 'completed') {
        this.statusText = 'Completed';
        this.showConfigPanel = false;
        this.showToast('Test completed successfully', 'success');
      } else if (data.status === 'stopped' || data.status === 'paused') {
        this.statusText = 'Stopped';
        this.showConfigPanel = false;
        this.showToast('Test stopped', 'warning');
      } else if (data.status === 'failed') {
        this.statusText = 'Failed';
        this.showConfigPanel = false;
        this.showToast('Test failed', 'error');
      }

      this.loadStatus();
      this.loadHistory();
    },

    async startNewTest() {
      if (this.blockedByOthersPreparing) {
        this.showToast(`${this.preparingUser.username} is preparing a test`, 'warning');
        return;
      }

      let prepareRes;
      try {
        prepareRes = await apiFetch(`${API_BASE}/tests/prepare`, { method: 'POST' });
      } catch (e) {
        console.warn('Could not set preparing state:', e);
        this.showToast('Could not start preparing a new test', 'error');
        return;
      }
      if (!prepareRes.ok) {
        let msg = 'Cannot prepare a new test yet';
        try {
          const body = await prepareRes.json();
          if (body.error) {
            msg = body.error;
          }
        } catch {
          /* ignore */
        }
        this.showToast(msg, 'warning');
        return;
      }

      // Reset all test state to a clean slate (only after server accepted prepare)
      this.pausedForResume = false;
      this.resumeInfo = null;
      this.testCompleted = false;
      this._lastChartHydrateTestId = null;
      this.isRunning = false;
      this.statusText = 'Idle';
      this.progress = 0;
      this.elapsedTime = '-';
      this.startTime = null;
      this.endTime = null;
      this.testDuration = null;
      this.currentTestId = null;
      this.currentTestName = '';
      this.startedByUsername = null;
      this.startedById = null;
      this.stoppedByUsername = null;
      this.stoppedById = null;
      this.isStoppingTest = false;
      this.requestStats = [];
      this.failureDetails = {};
      this.stopElapsedTimer();
      this.resetMetrics();
      this.clearOutput();
      this.showConfigPanel = this.canSeeScenarios;
      if (!this.canSeeScenarios && this.canSeeCurl) {
        this.activeTab = 'curl-import';
      }
      this.pausedLockTick += 1;
    },

    /** Clear preparing lock (self, or admin/tech-lead clearing another user's lock). */
    async releasePreparingLock() {
      try {
        const res = await apiFetch(`${API_BASE}/tests/cancel-prepare`, { method: 'POST' });
        if (!res.ok) {
          let msg = 'Could not release preparing lock';
          try {
            const body = await res.json();
            if (body.error) {
              msg = body.error;
            }
          } catch {
            /* ignore */
          }
          this.showToast(msg, 'error');
          return;
        }
        this.preparingUser = null;
        this.showToast('Preparing lock released', 'success');
      } catch (e) {
        console.warn('releasePreparingLock:', e);
        this.showToast('Could not release preparing lock', 'error');
      }
    },

    onTestChange() {
      if (this.configLocked) {
        return;
      }
      const test = this.availableTests.find((t) => t.id === this.selectedTest);
      if (test) {
        this.testDescription = test.description || '';
        this.testSteps = test.steps || [];
        if (!this.config.vus || this.config.vus === 10) {
          this.config.vus = test.defaultVUs || 10;
        }
        if (!this.config.duration || this.config.duration === '5m') {
          this.config.duration = test.defaultDuration || '5m';
        }
      } else {
        this.testDescription = '';
        this.testSteps = [];
      }
    },

    // Output
    /** Replay server-stored output lines (status.output or history.outputSnapshot). */
    replayStatusOutputLines(output, force = false) {
      if (!output || !output.length) {
        return;
      }
      if (!force && this.outputLines.length > 0) {
        return;
      }
      if (force) {
        this.outputLines = [];
      }
      output.forEach((line) => {
        let msg = '';
        if (typeof line === 'string') {
          msg = line;
        } else if (line && typeof line === 'object') {
          msg = line.message ?? line.text ?? (line.output != null ? String(line.output) : '') ?? '';
        }
        if (!String(msg).trim()) {
          return;
        }
        this.appendOutput(msg, typeof line === 'object' && line.type ? line.type : 'stdout');
      });
    },

    appendOutput(message, type = 'stdout') {
      const text = String(message ?? '').trim();
      this.outputLines.push({
        text,
        type: type === 'error' || type === 'stderr' ? 'error' : 'stdout',
      });

      // Keep only last 1000 lines in memory, but only render last 200
      if (this.outputLines.length > 1000) {
        this.outputLines = this.outputLines.slice(-1000);
      }

      // Auto-scroll to bottom when new output is added
      if (this.autoScroll && this.isPageVisible) {
        this.$nextTick(() => {
          if (this.$refs.outputDisplay) {
            this.$refs.outputDisplay.scrollTop = this.$refs.outputDisplay.scrollHeight;
          }
        });
      }
    },

    clearOutput() {
      this.outputLines = [];
    },

    async copyOutput() {
      try {
        // Get all output text
        const outputText = this.outputLines.map((line) => line.text).join('\n');

        if (!outputText || outputText.trim().length === 0) {
          this.showToast('No output to copy', 'info');
          return;
        }

        // Copy to clipboard
        await navigator.clipboard.writeText(outputText);
        this.showToast('Output copied to clipboard', 'success');
      } catch (error) {
        console.error('Error copying output:', error);
        // Fallback for older browsers
        try {
          const textArea = document.createElement('textarea');
          textArea.value = this.outputLines.map((line) => line.text).join('\n');
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          this.showToast('Output copied to clipboard', 'success');
        } catch {
          this.showToast('Failed to copy output', 'error');
        }
      }
    },

    toggleAutoScroll() {
      this.autoScroll = !this.autoScroll;
    },

    // History
    async viewTestResults(testId) {
      try {
        this.showModal = true;
        this.modalLoading = true;
        this.currentTestId = testId;

        const response = await apiFetch(`${API_BASE}/results/${testId}`);
        const result = await response.json();

        if (result.success && result.data) {
          this.testResults = result.data;
        } else {
          this.testResults = null;
        }
      } catch (error) {
        console.error('Error loading test results:', error);
        this.testResults = null;
      } finally {
        this.modalLoading = false;
      }
    },

    async deleteTestHistory(testId) {
      const ok = await this.showConfirm({
        title: 'Delete test history',
        message: `Remove "${testId}" from history? The test results file will also be deleted.`,
        confirmLabel: 'Delete',
      });
      if (!ok) {
        return;
      }

      try {
        const response = await apiFetch(`${API_BASE}/history/${testId}`, {
          method: 'DELETE',
        });
        const result = await response.json();

        if (result.success) {
          this.showToast('Test history deleted successfully', 'success');
          this.loadHistory();
        } else {
          this.showToast(result.error || 'Failed to delete test history', 'error');
        }
      } catch (error) {
        console.error('Error deleting test history:', error);
        this.showToast(`Failed to delete test history: ${error.message}`, 'error');
      }
    },

    async deleteAllTestHistory() {
      if (!this.authUser || this.authUser.role !== 'admin') {
        return;
      }
      const n = this.testHistory.length;
      if (!n) {
        return;
      }
      const ok = await this.showConfirm({
        title: 'Delete all test history?',
        message: `This removes all ${n} recorded run(s) from the list and deletes their saved result files on the server. Other users will see an empty history. This cannot be undone.`,
        confirmLabel: 'Delete all',
        confirmStyle: 'danger',
      });
      if (!ok) {
        return;
      }
      try {
        // POST avoids reverse proxies that mishandle DELETE and return HTML (breaks response.json()).
        const response = await apiFetch(`${API_BASE}/history/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const raw = await response.text();
        const ct = (response.headers.get('content-type') || '').toLowerCase();
        let result;
        if (ct.includes('application/json')) {
          try {
            result = JSON.parse(raw);
          } catch {
            this.showToast('Server returned invalid JSON for clear history.', 'error');
            return;
          }
        } else {
          this.showToast(
            `Clear history failed (${response.status}): got HTML instead of JSON. Check that requests reach this app’s /api (not only the static page).`,
            'error'
          );
          return;
        }
        if (result.success) {
          const d = result.data?.deletedCount ?? n;
          this.showToast(`Deleted ${d} history entr${d === 1 ? 'y' : 'ies'}`, 'success');
          await this.loadHistory();
          if (this.currentTestId && !this.testHistory.find((t) => t.id === this.currentTestId)) {
            this.closeModal();
          }
        } else {
          this.showToast(result.error || 'Failed to clear history', 'error');
        }
      } catch (error) {
        console.error('Error clearing test history:', error);
        this.showToast(`Failed to clear history: ${error.message}`, 'error');
      }
    },

    closeModal() {
      this.showModal = false;
      this.testResults = null;
      this.currentTestId = null;
    },

    async exportResults() {
      // Check if we have test results already loaded
      if (this.testResults && this.currentTestId) {
        try {
          const dataStr = JSON.stringify(this.testResults, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `test-results-${this.currentTestId}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          this.showToast('Results exported successfully', 'success');
          return;
        } catch (error) {
          this.showToast('Failed to export results', 'error');
          console.error(error);
          return;
        }
      }

      // If no test results loaded, check if we have a test ID
      if (!this.currentTestId) {
        this.showToast('No test selected. Please select a test first.', 'warning');
        return;
      }

      try {
        const response = await apiFetch(`${API_BASE}/results/${this.currentTestId}`);
        const result = await response.json();

        if (result.success && result.data) {
          const dataStr = JSON.stringify(result.data, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `test-results-${this.currentTestId}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          this.showToast('Results exported successfully', 'success');
        } else {
          this.showToast(result.error || 'Failed to load test results', 'error');
        }
      } catch (error) {
        this.showToast(`Failed to export results: ${error.message}`, 'error');
        console.error(error);
      }
    },

    async exportHTMLReport() {
      let results = this.testResults;

      // If no test results loaded, fetch them
      if (!results && this.currentTestId) {
        try {
          const response = await apiFetch(`${API_BASE}/results/${this.currentTestId}`);
          const result = await response.json();

          if (result.success && result.data) {
            results = result.data;
          } else {
            this.showToast(result.error || 'Failed to load test results', 'error');
            return;
          }
        } catch (error) {
          this.showToast(`Failed to load test results: ${error.message}`, 'error');
          console.error(error);
          return;
        }
      }

      if (!results) {
        this.showToast('No test selected. Please select a test first.', 'warning');
        return;
      }

      try {
        let logoDataUri = await this.fetchAssetAsDataUrl('assets/logo.svg');
        if (!logoDataUri) {
          logoDataUri = await this.fetchAssetAsDataUrl('assets/favicon.svg');
        }
        const html = await this.generateHTMLReport(results, { logoDataUri });
        const dataBlob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        const { run } = results;
        const slug = (run && run.scenarioSlug) || 'scenario';
        const st = (run && run.status) || 'export';
        const idPart = this.currentTestId || run?.runId || 'run';
        const fileSafe = `${slug}__load-test__${st}__${idPart}`
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .replace(/-+/g, '-');
        link.download = `${fileSafe}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.showToast('HTML report exported successfully', 'success');
      } catch (error) {
        this.showToast(`Failed to export HTML report: ${error.message}`, 'error');
        console.error(error);
      }
    },

    /**
     * Embed panel logo (or other static asset) as a data URL so downloaded HTML works as file://
     */
    async fetchAssetAsDataUrl(relativePath) {
      try {
        const url = new URL(relativePath, window.location.href).href;
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) {
          return null;
        }
        const blob = await r.blob();
        return await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    },

    /** Full Chart.js UMD source for self-contained HTML (file:// cannot load CDN scripts). */
    async loadChartUmdForReport() {
      const tryFetch = async (url) => {
        try {
          const r = await fetch(url, { cache: 'force-cache' });
          if (r.ok) {
            return await r.text();
          }
        } catch {
          /* ignore */
        }
        return '';
      };
      const base = window.location.href;
      let text = await tryFetch(new URL('vendor/chart.js/chart.umd.js', base).href);
      if (!text) {
        text = await tryFetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
      }
      return text;
    },

    escHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    async generateHTMLReport(results, options = {}) {
      const theme = await import(new URL('reportHtmlTheme.js', window.location.href).href);
      const logoDataUri = options.logoDataUri || theme.REPORT_LOGO_DATA_URI;
      const run = results.run || null;
      const chartSeries = results.chartSeries || null;
      const m = results.metrics || {};
      const httpReqs = m.http_reqs || {};
      const httpReqDuration = m.http_req_duration || {};
      const httpReqFailed = m.http_req_failed || {};
      const dataReceived = m.data_received || {};
      const dataSent = m.data_sent || {};
      const checks = m.checks || {};
      const iterationDuration = m.iteration_duration || {};
      const iterations = m.iterations || {};
      const vus = m.vus || {};

      const totalRequests = httpReqs.count || 0;
      const requestsPerSec = (httpReqs.rate || 0).toFixed(2);
      const avgResponseTime = Math.round(httpReqDuration.avg || 0);
      const p95ResponseTime = Math.round(httpReqDuration.values?.p95 || 0);
      const p99ResponseTime = Math.round(httpReqDuration.values?.p99 || 0);
      const minResponseTime = Math.round(httpReqDuration.min || 0);
      const maxResponseTime = Math.round(httpReqDuration.max || 0);

      // Calculate error rate from count if available, otherwise use rate
      let errorRate = '0.00';
      if (httpReqFailed.count !== undefined && httpReqs.count !== undefined && httpReqs.count > 0) {
        errorRate = ((httpReqFailed.count / httpReqs.count) * 100).toFixed(2);
      } else if (httpReqFailed.rate !== undefined) {
        const { rate } = httpReqFailed;
        errorRate = (rate > 1 ? rate : rate * 100).toFixed(2);
      } else if (httpReqFailed.values && httpReqFailed.values.rate !== undefined) {
        const { rate } = httpReqFailed.values;
        errorRate = (rate > 1 ? rate : rate * 100).toFixed(2);
      }

      const failureRate =
        checks.failRate !== undefined
          ? (checks.failRate * 100).toFixed(2)
          : checks.failed && checks.count
            ? ((checks.failed / checks.count) * 100).toFixed(2)
            : errorRate;
      const dataReceivedFormatted = this.formatBytes(dataReceived.count || 0);
      const dataSentFormatted = this.formatBytes(dataSent.count || 0);
      const checksPassed = checks.passes || 0;
      const checksFailed = checks.failed || 0;
      const checksTotal = checks.count || 0;
      const checksRate = (checks.rate || 0).toFixed(2);

      // Extract individual check results
      const individualChecks = [];
      if (checks && typeof checks === 'object') {
        for (const [checkName, checkData] of Object.entries(checks)) {
          if (
            checkName !== 'passes' &&
            checkName !== 'fails' &&
            checkName !== 'count' &&
            checkName !== 'rate' &&
            checkName !== 'failed' &&
            checkName !== 'failRate' &&
            checkData &&
            typeof checkData === 'object'
          ) {
            const passes = checkData.passes || checkData.pass || 0;
            const fails = checkData.fails || checkData.fail || 0;
            const total = passes + fails;
            if (total > 0) {
              individualChecks.push({
                name: checkName,
                passes,
                fails,
                total,
                passRate: ((passes / total) * 100).toFixed(1),
              });
            }
          }
        }
      }

      // Extract threshold information if available
      const thresholds = [];
      if (m.thresholds) {
        for (const [metricName, thresholdData] of Object.entries(m.thresholds)) {
          if (thresholdData && typeof thresholdData === 'object') {
            thresholds.push({
              metric: metricName,
              ...thresholdData,
            });
          }
        }
      }

      // Check for threshold status in individual metrics
      const checkThresholds = (metricName, metricData) => {
        if (metricData && metricData.thresholds) {
          for (const [thresholdName, thresholdResult] of Object.entries(metricData.thresholds)) {
            if (thresholdResult && typeof thresholdResult === 'object') {
              thresholds.push({
                metric: metricName,
                threshold: thresholdName,
                ok: thresholdResult.ok !== false,
                ...thresholdResult,
              });
            }
          }
        }
      };

      // Check common metrics for thresholds
      checkThresholds('http_req_duration', httpReqDuration);
      checkThresholds('http_req_failed', httpReqFailed);
      checkThresholds('http_reqs', httpReqs);
      checkThresholds('data_received', dataReceived);
      checkThresholds('data_sent', dataSent);
      checkThresholds('iteration_duration', iterationDuration);

      // If no thresholds found, create default ones based on values
      if (thresholds.length === 0) {
        thresholds.push(
          {
            metric: 'http_req_duration',
            threshold: 'p(95)<2000',
            ok: p95ResponseTime < 2000,
            value: `${p95ResponseTime}ms`,
          },
          {
            metric: 'http_req_failed',
            threshold: 'rate<0.05',
            ok: parseFloat(errorRate) < 5,
            value: `${errorRate}%`,
          },
          {
            metric: 'http_reqs',
            threshold: 'rate>1',
            ok: parseFloat(requestsPerSec) > 1,
            value: `${requestsPerSec}/s`,
          }
        );
      }

      const scenarioTitle = run?.scenarioSlug
        ? theme.formatScenarioTitle(run.scenarioSlug)
        : this.currentTestName || this.currentTestId || 'Load test run';
      const testName = this.escHtml(scenarioTitle);
      const docTitle = theme.escapeHtml(theme.reportDocumentTitle(run));
      const generatedStamp =
        typeof theme.formatNowInReportTz === 'function'
          ? `${theme.formatNowInReportTz()} · Asia/Tehran`
          : new Date().toISOString();
      // generatedStamp used in report header; reportDate alias removed (unused)
      const chartJsInline = await this.loadChartUmdForReport();

      const errNum = parseFloat(errorRate);
      const errTile = errNum < 1 ? '' : errNum < 5 ? ' accent-warn' : ' accent-danger';
      const errValCls = errNum < 1 ? ' ok' : errNum < 5 ? ' warn' : ' bad';
      const avgCls = avgResponseTime < 200 ? ' ok' : avgResponseTime < 500 ? ' warn' : ' bad';
      const p95Cls = p95ResponseTime < 500 ? ' ok' : p95ResponseTime < 1000 ? ' warn' : ' bad';
      const p99Cls = p99ResponseTime < 1000 ? ' ok' : p99ResponseTime < 2000 ? ' warn' : ' bad';

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTitle}</title>
  <style>${theme.REPORT_PANEL_CSS}</style>
</head>
<body>
  <div class="report-wrap">
    <div class="report-shell">
      ${theme.reportHeaderHtml({
        logoDataUri,
        metaTitle: scenarioTitle,
        metaCaption: `Generated ${generatedStamp}`,
      })}
      <div class="report-body">
        <div class="report-title-block">
          <h1 class="report-title">${testName}</h1>
          <p class="report-subtitle">k6 metrics export · same layout as the app dashboard</p>
        </div>
        ${theme.reportRunSectionHtml(run)}
        ${theme.buildReportChartsBlock(chartSeries, m, { chartJsInline })}
        <div class="summary-grid">
          <div class="metric-tile">
            <div class="metric-label">Total requests</div>
            <div class="metric-value">${totalRequests.toLocaleString()}</div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">Requests / second</div>
            <div class="metric-value ok">${requestsPerSec}</div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">Avg response time</div>
            <div class="metric-value${avgCls}">${avgResponseTime}<span style="font-size:0.85rem;font-weight:600;color:var(--slate-500)">ms</span></div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">P95 response</div>
            <div class="metric-value${p95Cls}">${p95ResponseTime}<span style="font-size:0.85rem;font-weight:600;color:var(--slate-500)">ms</span></div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">P99 response</div>
            <div class="metric-value${p99Cls}">${p99ResponseTime}<span style="font-size:0.85rem;font-weight:600;color:var(--slate-500)">ms</span></div>
          </div>
          <div class="metric-tile${errTile}">
            <div class="metric-label">Error rate</div>
            <div class="metric-value${errValCls}">${errorRate}%</div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">Data received</div>
            <div class="metric-value">${dataReceivedFormatted}</div>
          </div>
          <div class="metric-tile">
            <div class="metric-label">Data sent</div>
            <div class="metric-value">${dataSentFormatted}</div>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">Response time statistics</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Minimum</td>
                  <td>${minResponseTime}ms</td>
                </tr>
                <tr>
                  <td>Average</td>
                  <td>${avgResponseTime}ms</td>
                </tr>
                <tr>
                  <td>P95 (95th percentile)</td>
                  <td>${p95ResponseTime}ms</td>
                </tr>
                <tr>
                  <td>P99 (99th percentile)</td>
                  <td>${p99ResponseTime}ms</td>
                </tr>
                <tr>
                  <td>Maximum</td>
                  <td>${maxResponseTime}ms</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">Check results summary</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                  <th>Percentage</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span class="badge success">Passed</span></td>
                  <td>${checksPassed}</td>
                  <td>${checksTotal > 0 ? ((checksPassed / checksTotal) * 100).toFixed(2) : 0}%</td>
                  <td>${checksRate}/s</td>
                </tr>
                <tr>
                  <td><span class="badge error">Failed</span></td>
                  <td>${checksFailed}</td>
                  <td>${checksTotal > 0 ? ((checksFailed / checksTotal) * 100).toFixed(2) : 0}%</td>
                  <td>-</td>
                </tr>
                <tr>
                  <td><strong>Total</strong></td>
                  <td><strong>${checksTotal}</strong></td>
                  <td><strong>100%</strong></td>
                  <td><strong>${checksRate}/s</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        ${
          individualChecks.length > 0
            ? `
        <div class="section">
          <h2 class="section-title">Individual check results</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Check name</th>
                  <th>Pass rate</th>
                  <th>Passed</th>
                  <th>Failed</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${individualChecks
                  .map(
                    (check) => `
                <tr>
                  <td><code>${this.escHtml(check.name)}</code></td>
                  <td>${this.escHtml(check.passRate)}%</td>
                  <td><span class="badge success">✓ ${this.escHtml(check.passes)}</span></td>
                  <td><span class="badge ${check.fails > 0 ? 'error' : 'success'}">✗ ${this.escHtml(check.fails)}</span></td>
                  <td>${this.escHtml(check.total)}</td>
                  <td><span class="badge ${parseFloat(check.passRate) >= 100 ? 'success' : parseFloat(check.passRate) >= 90 ? 'warning' : 'error'}">${parseFloat(check.passRate) >= 100 ? 'Pass' : parseFloat(check.passRate) >= 90 ? 'Warning' : 'Fail'}</span></td>
                </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
        `
            : ''
        }

        ${
          thresholds.length > 0
            ? `
        <div class="section">
          <h2 class="section-title">Threshold status</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Threshold</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${thresholds
                  .map((threshold) => {
                    const thresholdName = threshold.threshold || threshold.metric || 'N/A';
                    const thresholdValue = threshold.value || threshold.actual || 'N/A';
                    const isOk = threshold.ok !== false;
                    return `
                <tr>
                  <td><code>${this.escHtml(threshold.metric)}</code></td>
                  <td>${this.escHtml(thresholdName)}</td>
                  <td>${this.escHtml(thresholdValue)}</td>
                  <td><span class="badge ${isOk ? 'success' : 'error'}">${isOk ? '✓ Pass' : '✗ Fail'}</span></td>
                </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
        `
            : ''
        }

        <div class="section">
          <h2 class="section-title">Execution information</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Total iterations</td>
                  <td>${iterations.count || 0}</td>
                </tr>
                <tr>
                  <td>Iterations per second</td>
                  <td>${(iterations.rate || 0).toFixed(2)}/s</td>
                </tr>
                <tr>
                  <td>Avg iteration duration</td>
                  <td>${iterationDuration.avg ? `${(iterationDuration.avg / 1000).toFixed(2)}s` : 'N/A'}</td>
                </tr>
                <tr>
                  <td>P95 iteration duration</td>
                  <td>${iterationDuration.values?.p95 ? `${(iterationDuration.values.p95 / 1000).toFixed(2)}s` : 'N/A'}</td>
                </tr>
                <tr>
                  <td>Max virtual users</td>
                  <td>${vus.max || 0}</td>
                </tr>
                <tr>
                  <td>Min virtual users</td>
                  <td>${vus.min || 0}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">Performance summary</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Requests per second</td>
                  <td>${requestsPerSec}</td>
                  <td><span class="badge success">Good</span></td>
                </tr>
                <tr>
                  <td>Average response time</td>
                  <td>${avgResponseTime}ms</td>
                  <td><span class="badge ${avgResponseTime < 200 ? 'success' : avgResponseTime < 500 ? 'warning' : 'error'}">${avgResponseTime < 200 ? 'Excellent' : avgResponseTime < 500 ? 'Good' : 'Needs improvement'}</span></td>
                </tr>
                <tr>
                  <td>Error rate</td>
                  <td>${errorRate}%</td>
                  <td><span class="badge ${parseFloat(errorRate) < 1 ? 'success' : parseFloat(errorRate) < 5 ? 'warning' : 'error'}">${parseFloat(errorRate) < 1 ? 'Low' : parseFloat(errorRate) < 5 ? 'Moderate' : 'High'}</span></td>
                </tr>
                <tr>
                  <td>Failure rate</td>
                  <td>${failureRate}%</td>
                  <td><span class="badge ${parseFloat(failureRate) < 1 ? 'success' : parseFloat(failureRate) < 5 ? 'warning' : 'error'}">${parseFloat(failureRate) < 1 ? 'Low' : parseFloat(failureRate) < 5 ? 'Moderate' : 'High'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <footer class="report-footer">
        <p>Load Test UI · Load Test Platform · ${generatedStamp}</p>
      </footer>
    </div>
  </div>
</body>
</html>`;
    },

    // Toasts
    showToast(message, type = 'info', duration = 3000) {
      const id = this.toastId++;
      this.toasts.push({ id, message, type });

      setTimeout(() => {
        const index = this.toasts.findIndex((t) => t.id === id);
        if (index > -1) {
          this.toasts.splice(index, 1);
        }
      }, duration);
    },

    // Keyboard Shortcuts
    setupKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          if (this.canStart && !this.isLoading) {
            e.preventDefault();
            this.startTest();
          }
        }
        if (e.key === 'Escape' && this.showModal) {
          this.closeModal();
        }
      });
    },

    // Utilities
    formatDuration(seconds) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;

      if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
      }
      return `${secs}s`;
    },

    statusCodeClass(status) {
      const code = parseInt(status, 10);
      if (!code || code === 0) {
        return 'status-unknown';
      }
      if (code < 300) {
        return 'status-2xx';
      }
      if (code < 400) {
        return 'status-3xx';
      }
      if (code < 500) {
        return 'status-4xx';
      }
      return 'status-5xx';
    },

    formatDate(dateString) {
      return new Date(dateString).toLocaleString('en-US', {
        timeZone: 'Asia/Tehran',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    },

    formatTimeTehran(date = new Date()) {
      return date.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    },

    /**
     * History duration: completed runs show configured scenario length (e.g. 10s). Stopped/failed/paused
     * use wall start→end so “Duration” matches Started/Ended when the run did not finish the plan.
     */
    historyDisplayDuration(test) {
      if (!test) {
        return '-';
      }
      const status = String(test.status || '').toLowerCase();
      if (status === 'completed' && test.configuredDuration) {
        const sec = this.parseDuration(test.configuredDuration);
        if (sec != null && sec > 0) {
          return this.formatDuration(sec);
        }
        return String(test.configuredDuration);
      }
      if (test.startTime && test.endTime) {
        return this.calculateDuration(test.startTime, test.endTime);
      }
      if (test.configuredDuration) {
        const sec = this.parseDuration(test.configuredDuration);
        if (sec != null && sec > 0) {
          return this.formatDuration(sec);
        }
        return String(test.configuredDuration);
      }
      return '-';
    },

    historyDurationTooltip(test) {
      if (!test) {
        return '';
      }
      const status = String(test.status || '').toLowerCase();
      if (status === 'completed' && test.configuredDuration) {
        const sec = this.parseDuration(test.configuredDuration);
        if (sec != null && sec > 0) {
          return 'Configured scenario duration. Started/Ended include k6 startup and teardown on the server.';
        }
      }
      if (test.startTime && test.endTime) {
        return 'Time from start to end of this run (wall clock).';
      }
      if (test.configuredDuration) {
        return 'Configured k6 run length.';
      }
      return '';
    },

    calculateDuration(start, end) {
      const startTime = new Date(start);
      const endTime = new Date(end);
      const diff = endTime - startTime;
      const seconds = Math.max(0, Math.round(diff / 1000));
      return this.formatDuration(seconds);
    },

    parseDuration(duration) {
      // Parse k6-style duration to seconds (supports ms from server _formatDurationMs)
      if (!duration) {
        return null;
      }
      const s = String(duration).trim();
      const msMatch = s.match(/^(\d+)ms$/i);
      if (msMatch) {
        return Math.max(0, Math.ceil(parseInt(msMatch[1], 10) / 1000));
      }
      const match = s.match(/^(\d+)([smh])$/i);
      if (!match) {
        return null;
      }

      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      switch (unit) {
        case 's':
          return value;
        case 'm':
          return value * 60;
        case 'h':
          return value * 3600;
        default:
          return null;
      }
    },

    calculateProgress(elapsedSeconds, totalSeconds) {
      if (!totalSeconds || totalSeconds <= 0) {
        return 0;
      }
      if (elapsedSeconds <= 0) {
        return 0;
      }
      const progress = Math.min(100, Math.round((elapsedSeconds / totalSeconds) * 100));
      return progress;
    },

    formatBytes(bytes) {
      if (bytes === 0) {
        return '0 B';
      }
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    },

    /** Theme tokens for Chart.js (synced with dark-mode UI). */
    _chartTheme() {
      const dark = this.isDarkMode;
      return {
        grid: dark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
        tick: dark ? '#cbd5e1' : '#475569',
        tickMuted: dark ? '#94a3b8' : '#64748b',
        tooltipBg: dark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.97)',
        tooltipBorder: dark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(15, 23, 42, 0.12)',
        tooltipTitle: dark ? '#f1f5f9' : '#0f172a',
        tooltipBody: dark ? '#e2e8f0' : '#334155',
        font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      };
    },

    /** Scriptable vertical gradient fill for line charts (adapts to chart area height). */
    _lineGradientFill(r, g, b) {
      return (context) => {
        const { chart } = context;
        const { ctx, chartArea } = chart;
        if (!chartArea) {
          return `rgba(${r}, ${g}, ${b}, 0.14)`;
        }
        const gFill = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        gFill.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.02)`);
        gFill.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.12)`);
        gFill.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.3)`);
        return gFill;
      };
    },

    _sharedLineChartPlugins(kind) {
      const t = this._chartTheme();
      return {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          position: 'nearest',
          backgroundColor: t.tooltipBg,
          titleColor: t.tooltipTitle,
          bodyColor: t.tooltipBody,
          borderColor: t.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          caretSize: 6,
          displayColors: true,
          boxPadding: 4,
          titleFont: { size: 11, weight: '600', family: t.font },
          bodyFont: { size: 12, family: t.font },
          callbacks: {
            title: (items) => (items[0] ? String(items[0].label) : ''),
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null || Number.isNaN(v)) {
                return '';
              }
              if (kind === 'rps') {
                return ` ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} req/s`;
              }
              return ` ${Math.round(v)} ms avg`;
            },
          },
        },
      };
    },

    _sharedLineChartScales(kind) {
      const t = this._chartTheme();
      const yGrace = kind === 'rps' ? '14%' : '12%';
      return {
        x: {
          grid: {
            display: true,
            color: t.grid,
            drawBorder: false,
            tickLength: 0,
            borderDash: [4, 4],
          },
          ticks: {
            color: t.tickMuted,
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            font: { size: 10, family: t.font },
          },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grace: yGrace,
          suggestedMin: 0,
          grid: {
            color: t.grid,
            drawBorder: false,
            lineWidth: 1,
          },
          ticks: {
            color: t.tickMuted,
            maxTicksLimit: 7,
            font: { size: 10, family: t.font },
            callback: (v) => {
              if (kind === 'rps') {
                const n = Number(v);
                if (n >= 1000) {
                  return `${(n / 1000).toFixed(1)}k`;
                }
                return Number.isInteger(n) ? String(n) : n.toFixed(2);
              }
              return `${Math.round(Number(v))}`;
            },
          },
          border: { display: false },
        },
      };
    },

    /** Re-apply grid/tick/tooltip colors after dark-mode toggle without losing series data. */
    applyDashboardChartTheme() {
      if (typeof Chart === 'undefined') {
        return;
      }
      const t = this._chartTheme();
      const patch = (chart, _kind) => {
        if (!chart?.options?.scales) {
          return;
        }
        const s = chart.options.scales;
        ['x', 'y'].forEach((axis) => {
          if (!s[axis]) {
            return;
          }
          if (s[axis].grid) {
            s[axis].grid.color = t.grid;
          }
          if (s[axis].ticks) {
            s[axis].ticks.color = t.tickMuted;
          }
          if (s[axis].title) {
            s[axis].title.color = t.tickMuted;
          }
        });
        const tip = chart.options.plugins?.tooltip;
        if (tip) {
          tip.backgroundColor = t.tooltipBg;
          tip.titleColor = t.tooltipTitle;
          tip.bodyColor = t.tooltipBody;
          tip.borderColor = t.tooltipBorder;
          if (tip.titleFont) {
            tip.titleFont.family = t.font;
          }
          if (tip.bodyFont) {
            tip.bodyFont.family = t.font;
          }
        }
        chart.update('none');
      };
      patch(chartInstances.requests, 'rps');
      patch(chartInstances.responseTime, 'rt');
      const d = chartInstances.distribution;
      if (d?.options?.scales) {
        const s = d.options.scales;
        const t = this._chartTheme();
        if (s.x?.ticks) {
          s.x.ticks.color = t.tickMuted;
        }
        if (s.y?.grid) {
          s.y.grid.color = t.grid;
        }
        if (s.y?.ticks) {
          s.y.ticks.color = t.tickMuted;
        }
        const tip = d.options.plugins?.tooltip;
        if (tip) {
          tip.backgroundColor = t.tooltipBg;
          tip.titleColor = t.tooltipTitle;
          tip.bodyColor = t.tooltipBody;
          tip.borderColor = t.tooltipBorder;
        }
        d.update('none');
      }
    },

    // Charts
    initializeCharts() {
      // Prevent multiple initializations
      if (this.chartsInitializing) {
        return;
      }
      this.chartsInitializing = true;
      // Bump generation so any older retry loop will self-abort when it next runs
      const myGeneration = ++this.chartsGeneration;

      let retryCount = 0;
      let layoutRetryCount = 0;
      const maxRetries = 30; // Maximum 3 seconds (30 * 100ms)
      const maxLayoutRetries = 60;

      // Wait for DOM to be ready and Chart.js to load
      const initChart = () => {
        // A newer initializeCharts() was called — stop this stale loop
        if (myGeneration !== this.chartsGeneration) {
          return;
        }
        if (typeof Chart === 'undefined') {
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(initChart, 100);
          } else {
            console.error('Chart.js failed to load after', maxRetries, 'attempts');
            this.chartsInitializing = false;
          }
          return;
        }

        // Check if chart canvas elements exist
        const requestsCanvas = document.getElementById('requestsChart');
        const responseCanvas = document.getElementById('responseTimeChart');
        const distCanvas = document.getElementById('distributionChart');

        if (!requestsCanvas || !responseCanvas || !distCanvas) {
          if (retryCount < maxRetries) {
            retryCount++;
            this.chartsInitializing = false;
            setTimeout(initChart, 100);
          } else {
            this.chartsInitializing = false;
          }
          return;
        }

        // Dashboard uses v-show — hidden panes have 0×0 layout; wait until measurable.
        const layoutRect = requestsCanvas.getBoundingClientRect();
        if (layoutRect.width < 2 || layoutRect.height < 2) {
          if (layoutRetryCount < maxLayoutRetries) {
            layoutRetryCount++;
            this.chartsInitializing = false;
            setTimeout(initChart, 100);
          } else {
            this.chartsInitializing = false;
          }
          return;
        }

        this.destroyChartJsInstances();

        // Requests per Second Chart
        const requestsCtx = requestsCanvas;
        if (requestsCtx && requestsCtx.getContext && typeof Chart !== 'undefined') {
          try {
            // Verify canvas context exists
            const ctx = requestsCtx.getContext('2d');
            if (!ctx) {
              this.chartsInitializing = false;
              return;
            }
            // Ensure canvas has proper dimensions
            const rect = requestsCtx.getBoundingClientRect();
            if (
              requestsCtx.width === 0 ||
              requestsCtx.height === 0 ||
              rect.width === 0 ||
              rect.height === 0
            ) {
              requestsCtx.width = rect.width || 400;
              requestsCtx.height = rect.height || 200;
            }
            // Create chart with plain data (not reactive)
            try {
              const chartInstance = new Chart(requestsCtx, {
                type: 'line',
                data: {
                  labels: [],
                  datasets: [
                    {
                      label: 'Throughput',
                      data: [],
                      borderColor: '#3b82f6',
                      backgroundColor: this._lineGradientFill(59, 130, 246),
                      borderWidth: 2.5,
                      tension: 0.35,
                      fill: true,
                      spanGaps: true,
                      pointBackgroundColor: '#60a5fa',
                      pointBorderColor: '#1e40af',
                      pointBorderWidth: 1,
                      pointRadius: 2,
                      pointHoverRadius: 7,
                      pointHitRadius: 12,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  resizeDelay: 0,
                  layout: { padding: { top: 6, right: 4, bottom: 0, left: 2 } },
                  interaction: { mode: 'index', intersect: false, axis: 'x' },
                  hover: { mode: 'index', intersect: false },
                  plugins: this._sharedLineChartPlugins('rps'),
                  scales: this._sharedLineChartScales('rps'),
                  animation: { duration: 0 },
                },
              });
              // Store chart outside Vue reactivity
              chartInstances.requests = chartInstance;
              this.charts.requests = chartInstance; // Keep reference for checks
            } catch (error) {
              console.error('Error initializing requests chart:', error);
              this.chartsInitializing = false;
              // Retry after a delay
              setTimeout(() => {
                if (!this.chartsInitializing) {
                  this.initializeCharts();
                }
              }, 500);
              return;
            }
          } catch (error) {
            console.error('Error setting up requests chart:', error);
            this.chartsInitializing = false;
          }
        }

        // Response Time Chart
        const responseCtx = responseCanvas;
        if (responseCtx && responseCtx.getContext && typeof Chart !== 'undefined') {
          try {
            // Verify canvas context exists
            const ctx = responseCtx.getContext('2d');
            if (!ctx) {
              this.chartsInitializing = false;
              return;
            }
            // Ensure canvas has proper dimensions
            const rect = responseCtx.getBoundingClientRect();
            if (
              responseCtx.width === 0 ||
              responseCtx.height === 0 ||
              rect.width === 0 ||
              rect.height === 0
            ) {
              responseCtx.width = rect.width || 400;
              responseCtx.height = rect.height || 200;
            }
            // Create chart with plain data (not reactive)
            try {
              const chartInstance = new Chart(responseCtx, {
                type: 'line',
                data: {
                  labels: [],
                  datasets: [
                    {
                      label: 'Avg response time',
                      data: [],
                      borderColor: '#22c55e',
                      backgroundColor: this._lineGradientFill(34, 197, 94),
                      borderWidth: 2.5,
                      tension: 0.35,
                      fill: true,
                      spanGaps: true,
                      pointBackgroundColor: '#4ade80',
                      pointBorderColor: '#15803d',
                      pointBorderWidth: 1,
                      pointRadius: 2,
                      pointHoverRadius: 7,
                      pointHitRadius: 12,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  resizeDelay: 0,
                  layout: { padding: { top: 6, right: 4, bottom: 0, left: 2 } },
                  interaction: { mode: 'index', intersect: false, axis: 'x' },
                  hover: { mode: 'index', intersect: false },
                  plugins: this._sharedLineChartPlugins('rt'),
                  scales: this._sharedLineChartScales('rt'),
                  animation: { duration: 0 },
                },
              });
              // Store chart outside Vue reactivity
              chartInstances.responseTime = chartInstance;
              this.charts.responseTime = chartInstance; // Keep reference for checks
            } catch (error) {
              console.error('Error initializing response time chart:', error);
              this.chartsInitializing = false;
              return;
            }
          } catch (error) {
            console.error('Error setting up response time chart:', error);
            this.chartsInitializing = false;
          }
        }

        // Distribution Chart
        const distCtx = distCanvas;
        if (distCtx && distCtx.getContext && typeof Chart !== 'undefined') {
          try {
            // Verify canvas context exists
            const ctx = distCtx.getContext('2d');
            if (!ctx) {
              this.chartsInitializing = false;
              return;
            }
            // Ensure canvas has proper dimensions
            const rect = distCtx.getBoundingClientRect();
            if (
              distCtx.width === 0 ||
              distCtx.height === 0 ||
              rect.width === 0 ||
              rect.height === 0
            ) {
              distCtx.width = rect.width || 400;
              distCtx.height = rect.height || 200;
            }
            // Create chart with plain data (not reactive)
            try {
              const dt = this._chartTheme();
              const chartInstance = new Chart(distCtx, {
                type: 'bar',
                data: {
                  labels: ['<100ms', '100-200ms', '200-500ms', '500-1000ms', '1-2s', '>2s'],
                  datasets: [
                    {
                      label: 'Requests',
                      data: [0, 0, 0, 0, 0, 0],
                      backgroundColor: [
                        'rgba(34, 197, 94, 0.85)',
                        'rgba(59, 130, 246, 0.85)',
                        'rgba(251, 191, 36, 0.85)',
                        'rgba(249, 115, 22, 0.85)',
                        'rgba(239, 68, 68, 0.85)',
                        'rgba(220, 38, 38, 0.85)',
                      ],
                      borderRadius: 4,
                      borderSkipped: false,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  layout: { padding: { top: 4, right: 4, bottom: 0, left: 2 } },
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: dt.tooltipBg,
                      titleColor: dt.tooltipTitle,
                      bodyColor: dt.tooltipBody,
                      borderColor: dt.tooltipBorder,
                      borderWidth: 1,
                      padding: 10,
                      cornerRadius: 8,
                    },
                  },
                  scales: {
                    x: {
                      grid: { display: false },
                      ticks: {
                        color: dt.tickMuted,
                        font: { size: 10, family: dt.font },
                        maxRotation: 45,
                      },
                      border: { display: false },
                    },
                    y: {
                      beginAtZero: true,
                      grace: '8%',
                      grid: { color: dt.grid, drawBorder: false },
                      ticks: {
                        color: dt.tickMuted,
                        maxTicksLimit: 6,
                        font: { size: 10, family: dt.font },
                      },
                      border: { display: false },
                    },
                  },
                },
              });
              // Store chart outside Vue reactivity
              chartInstances.distribution = chartInstance;
              this.charts.distribution = chartInstance; // Keep reference for checks
            } catch (error) {
              console.error('Error initializing distribution chart:', error);
              this.chartsInitializing = false;
              return;
            }
          } catch (error) {
            console.error('Error setting up distribution chart:', error);
            this.chartsInitializing = false;
          }
        }

        this.chartsInitializing = false;

        // Apply any metrics / time-series that arrived while charts were not ready
        let replayedSeries = false;
        if (this.pendingChartSeries) {
          const series = this.pendingChartSeries;
          this.pendingChartSeries = null;
          this.replayChartSeries(series);
          replayedSeries = true;
        }
        if (this.pendingChartMetrics) {
          const pending = this.pendingChartMetrics;
          this.pendingChartMetrics = null;
          if (replayedSeries) {
            this.syncDistributionChart(pending);
          } else {
            this.updateCharts(pending);
          }
        }
      };

      // Try to initialize immediately, then retry if needed
      this.$nextTick(() => {
        setTimeout(initChart, 100);
      });
    },

    updateCharts(metrics) {
      if (!metrics) {
        return;
      }

      // Always update charts, even if page not visible (for final results)
      // Store latest metrics
      this.latestChartMetrics = metrics;

      // Batch chart updates using requestAnimationFrame
      if (this.chartUpdatePending) {
        return;
      }

      this.chartUpdatePending = true;
      this.chartUpdateRAF = requestAnimationFrame(() => {
        this.chartUpdatePending = false;
        if (this.latestChartMetrics) {
          this.performChartUpdate(this.latestChartMetrics);
          this.latestChartMetrics = null;
        }
      });
    },

    performChartUpdate(metrics) {
      if (!metrics) {
        return;
      }

      // Ensure charts are initialized
      if (!chartInstances.requests || !chartInstances.responseTime) {
        // Persist metrics so they are applied the moment init finishes
        this.pendingChartMetrics = metrics;
        if (!this.chartsInitializing && typeof Chart !== 'undefined') {
          this.initializeCharts();
        }
        return;
      }

      // Check if charts are valid
      if (!chartInstances.requests.canvas || !chartInstances.responseTime.canvas) {
        // Reinitialize charts if canvas is missing
        if (typeof Chart !== 'undefined' && !this.chartsInitializing) {
          this.initializeCharts();
        }
        return;
      }

      const now = this.formatTimeTehran();

      // Prefer the server's rolling-window RPS (same as the "Requests/s" card). Plotting
      // delta(count)/delta(poll interval) makes the line sawtooth when polls are uneven.
      const nowMs = Date.now();
      const cumulativeCount = Number(metrics.http_reqs?.count || 0);
      const serverRps = metrics.http_reqs?.rate;
      let rpsForChart;
      if (serverRps != null && Number.isFinite(Number(serverRps))) {
        rpsForChart = Number(Number(serverRps).toFixed(2));
      } else if (this._lastReqCount === null) {
        const elapsedSinceStart = this.startTime
          ? Math.max(0.5, (nowMs - this.startTime.getTime()) / 1000)
          : 1;
        rpsForChart = Number((cumulativeCount / elapsedSinceStart).toFixed(2));
      } else {
        const countDelta = Math.max(0, cumulativeCount - this._lastReqCount);
        const elapsedSec = this._lastMetricsMs
          ? Math.max(0.1, (nowMs - this._lastMetricsMs) / 1000)
          : 1;
        rpsForChart = Number((countDelta / elapsedSec).toFixed(2));
      }
      this._lastReqCount = cumulativeCount;
      this._lastMetricsMs = nowMs;

      // Update Requests Chart
      try {
        const rps = rpsForChart;
        const chart = chartInstances.requests;
        if (chart && chart.data && chart.data.datasets && chart.data.datasets[0]) {
          // Always update chart, even if rate is 0, to show the chart is working
          // Use direct array access to avoid reactivity issues
          const { labels } = chart.data;
          const { data } = chart.data.datasets[0];

          labels.push(now);
          data.push(rps);

          // Keep only last 30 data points
          if (labels.length > 30) {
            labels.shift();
            data.shift();
          }

          // Use silent update to avoid animation issues
          chart.update('none');
        }
      } catch (error) {
        console.error('Error updating requests chart:', error);
        // Try to reinitialize if chart is corrupted
        if (chartInstances.requests) {
          try {
            chartInstances.requests.destroy();
          } catch {
            // Ignore
          }
          chartInstances.requests = null;
          this.charts.requests = null;
          if (typeof Chart !== 'undefined') {
            this.initializeCharts();
          }
        }
      }

      // Update Response Time Chart
      try {
        const avg = Number(metrics.http_req_duration?.avg || 0); // Ensure primitive value
        const chart = chartInstances.responseTime;
        if (chart && chart.data && chart.data.datasets && chart.data.datasets[0]) {
          // Always update chart, even if avg is 0, to show the chart is working
          // Use direct array access to avoid reactivity issues
          const { labels } = chart.data;
          const { data } = chart.data.datasets[0];

          labels.push(now);
          data.push(avg);

          // Keep only last 30 data points
          if (labels.length > 30) {
            labels.shift();
            data.shift();
          }

          // Use silent update to avoid animation issues
          chart.update('none');
        }
      } catch (error) {
        console.error('Error updating response time chart:', error);
        // Try to reinitialize if chart is corrupted
        if (chartInstances.responseTime) {
          try {
            chartInstances.responseTime.destroy();
          } catch {
            // Ignore
          }
          chartInstances.responseTime = null;
          this.charts.responseTime = null;
          if (typeof Chart !== 'undefined') {
            this.initializeCharts();
          }
        }
      }

      this.syncDistributionChart(metrics);
    },

    syncDistributionChart(metrics) {
      if (!metrics || !chartInstances.distribution || !metrics.http_req_duration) {
        return;
      }
      try {
        const distribution = this.calculateDistribution(metrics);
        const chart = chartInstances.distribution;
        if (chart && chart.data && chart.data.datasets && chart.data.datasets[0]) {
          chart.data.datasets[0].data = [...distribution];
          chart.update('none');
        }
      } catch (error) {
        console.error('Error updating distribution chart:', error);
      }
    },

    calculateDistribution(metrics) {
      // Use actual distribution from server if available
      const distribution = metrics.http_req_duration?.distribution;
      if (distribution) {
        // Return distribution in the order expected by the chart
        return [
          distribution['<100ms'] || 0,
          distribution['100-200ms'] || 0,
          distribution['200-500ms'] || 0,
          distribution['500-1000ms'] || 0,
          distribution['1-2s'] || 0,
          distribution['>2s'] || 0,
        ];
      }

      // Fallback: use total count if distribution not available
      const total = metrics.http_reqs?.count || 0;
      if (total === 0) {
        return [0, 0, 0, 0, 0, 0];
      }

      // Estimate distribution from request volume (fallback when histogram unavailable)
      return [
        Math.floor(total * 0.3), // <100ms
        Math.floor(total * 0.25), // 100-200ms
        Math.floor(total * 0.2), // 200-500ms
        Math.floor(total * 0.15), // 500-1000ms
        Math.floor(total * 0.08), // 1-2s
        Math.floor(total * 0.02), // >2s
      ];
    },

    updateRequestStats(metrics) {
      if (!metrics) {
        return;
      }

      const httpReqs = metrics.http_reqs || {};
      const httpReqDuration = metrics.http_req_duration || {};
      const httpReqFailed = metrics.http_req_failed || {};
      const checks = metrics.checks || {};

      const avg = httpReqDuration.avg || 0;
      const min = httpReqDuration.min || 0;
      const max = httpReqDuration.max || 0;

      const median = httpReqDuration.values?.p50 || (avg > 0 ? Math.round(avg) : 0);
      const p95 =
        httpReqDuration.values?.p95 || (avg > 0 ? Math.round(avg + (max - avg) * 0.7) : 0);
      const p99 =
        httpReqDuration.values?.p99 || (avg > 0 ? Math.round(avg + (max - avg) * 0.9) : 0);

      let failures = 0;
      if (checks.failed !== undefined) {
        failures = checks.failed;
      } else if (httpReqFailed.count !== undefined) {
        failures = httpReqFailed.count;
      } else {
        failures = Math.floor((httpReqFailed.rate || 0) * (httpReqs.count || 0));
      }

      const totalRow = {
        name: 'Total',
        type: 'HTTP',
        isTotal: true,
        requests: httpReqs.count || 0,
        failures,
        median,
        p95,
        p99,
        avg: Math.round(avg),
        min: Math.round(min),
        max: Math.round(max),
        rps: (httpReqs.rate || 0).toFixed(2),
      };

      this.failureDetails = metrics.failure_details || {};
      const urlStats = metrics.url_stats || {};
      const urlNames = Object.keys(urlStats);

      if (urlNames.length >= 1) {
        // Multi-URL scenario: show one row per URL then a Total row
        const rows = urlNames.map((urlName) => {
          const u = urlStats[urlName];
          const uDur = u.http_req_duration || {};
          const uReqs = u.http_reqs || {};
          const uFailed = u.http_req_failed || {};
          const uAvg = uDur.avg || 0;
          const uMin = uDur.min || 0;
          const uMax = uDur.max || 0;
          const uMedian = uDur.values?.p50 || (uAvg > 0 ? Math.round(uAvg) : 0);
          const uP95 = uDur.values?.p95 || (uAvg > 0 ? Math.round(uAvg + (uMax - uAvg) * 0.7) : 0);
          const uP99 = uDur.values?.p99 || (uAvg > 0 ? Math.round(uAvg + (uMax - uAvg) * 0.9) : 0);
          const uFailures = uFailed.count || Math.floor((uFailed.rate || 0) * (uReqs.count || 0));
          return {
            name: urlName,
            type: 'HTTP',
            isTotal: false,
            requests: uReqs.count || 0,
            failures: uFailures,
            median: uMedian,
            p95: uP95,
            p99: uP99,
            avg: Math.round(uAvg),
            min: Math.round(uMin),
            max: Math.round(uMax),
            rps: (uReqs.rate || 0).toFixed(2),
          };
        });
        if (urlNames.length > 1) {
          rows.push(totalRow);
        }
        this.requestStats = rows;
      } else {
        this.requestStats = [totalRow];
      }
    },

    // Test Management Methods
    canDeleteTest(testId) {
      // Check if test is a built-in test
      return !this.builtInTests.includes(testId);
    },

    confirmDeleteTest(testId) {
      const test = this.availableTests.find((t) => t.id === testId);
      const testName = test ? test.name : testId;

      this.showConfirmDialog(
        'Delete Test Scenario',
        `Are you sure you want to delete "${testName}"? This action cannot be undone.`,
        () => this.deleteTest(testId),
        { primaryLabel: 'Delete' }
      );
    },

    async deleteTest(testId) {
      try {
        this.isLoading = true;

        const response = await apiFetch(`${API_BASE}/tests/${testId}`, {
          method: 'DELETE',
        });

        const result = await response.json();

        if (result.success) {
          this.showToast(`Test "${testId}" deleted successfully`, 'success');

          // Reload available tests
          await this.loadAvailableTests();

          // Clear selection if deleted test was selected
          if (this.selectedTest === testId) {
            this.selectedTest = '';
            this.testDescription = '';
            this.testSteps = [];
          }
        } else {
          this.showToast(result.error || 'Failed to delete test', 'error');
        }
      } catch (error) {
        console.error('Error deleting test:', error);
        this.showToast(`Failed to delete test: ${error.message}`, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // cURL Import Methods
    /** Users with only the cURL tab have no nav link to the dashboard; use this to view last run on the main page. */
    async backToDashboardFromCurl() {
      this.activeTab = 'dashboard';
      await this.loadStatus();
      await this.$nextTick();
      this.scheduleSyncDashboardCharts();
    },

    clearCurlInput() {
      this.curlTestName = '';
      this.curlTeam = '';
      this.curlDebugLog = false;
      this.testNameValid = true;
      this.testNameError = '';
      this.curlStepCounter = 1;
      this.curlSteps = [
        {
          id: 1,
          label: '',
          curlCommand: '',
          parsedCurl: null,
          extractVars: false,
          varName: '',
          varPath: '',
        },
      ];
    },

    addCurlStep() {
      this.curlStepCounter += 1;
      this.curlSteps.push({
        id: this.curlStepCounter,
        label: '',
        curlCommand: '',
        parsedCurl: null,
        extractVars: false,
        varName: '',
        varPath: '',
      });
    },

    removeCurlStep(id) {
      if (this.curlSteps.length <= 1) {
        return;
      }
      this.curlSteps = this.curlSteps.filter((s) => s.id !== id);
    },

    parseCurlStep(id) {
      const step = this.curlSteps.find((s) => s.id === id);
      if (!step || !step.curlCommand) {
        this.showToast('Please enter a cURL command for this step', 'warning');
        return;
      }
      const parse = typeof window !== 'undefined' ? window.extractCurlData : null;
      if (typeof parse !== 'function') {
        this.showToast('Failed to parse cURL: parser not loaded — refresh the page', 'error');
        return;
      }
      try {
        step.parsedCurl = parse(step.curlCommand);
        if (!step.label) {
          try {
            const urlObj = new URL(step.parsedCurl.url);
            const parts = urlObj.pathname.split('/').filter((p) => p);
            step.label = parts.length
              ? parts[parts.length - 1]
              : step.parsedCurl.method.toLowerCase();
          } catch {
            step.label = `Step ${this.curlSteps.indexOf(step) + 1}`;
          }
        }
        this.showToast('Step parsed successfully', 'success');
      } catch (error) {
        this.showToast(`Failed to parse cURL: ${error.message}`, 'error');
      }
    },

    validateTestName() {
      if (!this.curlTestName) {
        this.testNameValid = true;
        this.testNameError = '';
        return;
      }

      const validPattern = /^[a-z0-9-]+$/;
      if (validPattern.test(this.curlTestName)) {
        this.testNameValid = true;
        this.testNameError = '';
      } else {
        this.testNameValid = false;
        this.testNameError = 'Only lowercase letters, numbers, and hyphens allowed';
      }
    },

    sanitizeTestName() {
      if (!this.curlTestName) {
        return;
      }

      // Convert to lowercase
      let sanitized = this.curlTestName.toLowerCase();

      // Replace spaces and underscores with hyphens
      sanitized = sanitized.replace(/[\s_]+/g, '-');

      // Remove any characters that aren't lowercase letters, numbers, or hyphens
      sanitized = sanitized.replace(/[^a-z0-9-]/g, '');

      // Remove consecutive hyphens
      sanitized = sanitized.replace(/-+/g, '-');

      // Remove leading/trailing hyphens
      sanitized = sanitized.replace(/^-+|-+$/g, '');

      this.curlTestName = sanitized;
      this.validateTestName();
    },

    autoGenerateTestName() {
      if (this.curlTestName) {
        return;
      }
      const firstParsed = this.curlSteps.find((s) => s.parsedCurl);
      if (!firstParsed) {
        return;
      }
      try {
        const urlObj = new URL(firstParsed.parsedCurl.url);
        const parts = urlObj.pathname.split('/').filter((p) => p);
        let name = `curl-${parts.join('-') || 'test'}-${Date.now()}`;
        name = name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
        this.curlTestName = name;
        this.validateTestName();
      } catch {
        // ignore parse errors — test name stays as-is
      }
    },

    async createCurlChainTest() {
      // Block if a test is running or someone else is preparing
      if (this.isRunning) {
        this.showToast('A test is already running', 'warning');
        return;
      }
      if (this.blockedByOthersPreparing) {
        this.showToast(`${this.preparingUser.username} is preparing a test`, 'warning');
        return;
      }

      const unparsed = this.curlSteps.filter((s) => !s.parsedCurl);
      if (unparsed.length > 0) {
        this.showToast(
          `Parse all steps before creating the test (${unparsed.length} step(s) not yet parsed)`,
          'warning'
        );
        return;
      }

      this.autoGenerateTestName();

      if (!this.curlTestName) {
        this.showToast('Please enter a test name', 'warning');
        return;
      }

      this.sanitizeTestName();

      if (!this.testNameValid || !/^[a-z0-9-]+$/.test(this.curlTestName)) {
        this.showToast(
          'Test name must contain only lowercase letters, numbers, and hyphens. Click the ✓ button to auto-format.',
          'error'
        );
        return;
      }

      if (this.curlVus < 1) {
        this.showToast('Virtual Users must be at least 1', 'error');
        return;
      }

      if (!this.curlDuration || !/^\d+[smh]$/i.test(this.curlDuration)) {
        this.showToast('Invalid duration format. Use format like: 30s, 5m, 1h', 'error');
        return;
      }

      // Enforce per-user limits
      if (this.userLimits.enabled) {
        if (this.curlVus > this.userLimits.maxVus) {
          this.showToast(
            `Your VU limit is ${this.userLimits.maxVus}. Requested: ${this.curlVus}`,
            'error'
          );
          return;
        }
        const val = parseInt(this.curlDuration, 10);
        const unit = this.curlDuration.slice(-1).toLowerCase();
        const mins = unit === 'h' ? val * 60 : unit === 'm' ? val : Math.ceil(val / 60);
        if (mins > this.userLimits.maxDurationMinutes) {
          this.showToast(
            `Your duration limit is ${this.userLimits.maxDurationMinutes} min. Requested: ${mins} min`,
            'error'
          );
          return;
        }
      }

      try {
        this.isLoading = true;

        // Notify server so other clients see this user is preparing
        try {
          await apiFetch(`${API_BASE}/tests/prepare`, { method: 'POST' });
        } catch (e) {
          console.warn('Could not set preparing state:', e);
        }

        const steps = this.curlSteps.map((s, i) => ({
          label: s.label || `Step ${i + 1}`,
          ...s.parsedCurl,
          extractVars: s.extractVars,
          varName: s.varName,
          varPath: s.varPath,
        }));

        const response = await apiFetch(`${API_BASE}/tests/curl-chain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            testName: this.curlTestName,
            steps,
            options: {
              vus: this.curlVus,
              duration: this.curlDuration,
              team: this.curlTeam,
              debugLog: Boolean(this.curlDebugLog),
            },
          }),
        });

        const result = await response.json();

        if (result.success) {
          this.showToast(`Test "${this.curlTestName}" created successfully`, 'success');
          this.activeTab = 'dashboard';
          await this.loadAvailableTests();
          this.selectedTest = this.curlTestName;
          this.config.vus = this.curlVus;
          this.config.duration = this.curlDuration;
          this.onTestChange();
          this.clearCurlInput();
          this.showToast('Starting test...', 'info');
          setTimeout(() => {
            this.startTest();
          }, 1000);
        } else {
          // Cancel prepare state so other users aren't blocked
          apiFetch(`${API_BASE}/tests/cancel-prepare`, { method: 'POST' }).catch(() => {});
          this.showToast(result.error || 'Failed to create test', 'error');
        }
      } catch (error) {
        // Cancel prepare state on unexpected failure
        apiFetch(`${API_BASE}/tests/cancel-prepare`, { method: 'POST' }).catch(() => {});
        console.error('Error creating cURL chain test:', error);
        this.showToast(`Failed to create test: ${error.message}`, 'error');
      } finally {
        this.isLoading = false;
      }
    },

    updateMetrics(metrics) {
      if (!metrics) {
        return;
      }

      // Always update metrics even if page is not visible (for final results)
      const httpReqs = metrics.http_reqs || {};
      const httpReqDuration = metrics.http_req_duration || {};
      const httpReqFailed = metrics.http_req_failed || {};
      const checks = metrics.checks || {};
      const dataReceived = metrics.data_received || {};

      // Calculate HTTP request error rate (for "Errors" metric)
      // http_req_failed shows HTTP request failures (4xx, 5xx, timeouts, network errors)
      // Calculate percentage from count if available, otherwise use rate
      let errorRate = 0;
      if (httpReqFailed.count !== undefined && httpReqs.count !== undefined && httpReqs.count > 0) {
        // Calculate error rate as percentage: (failed / total) * 100
        errorRate = (httpReqFailed.count / httpReqs.count) * 100;
      } else if (httpReqFailed.rate !== undefined) {
        // Fallback: if rate is provided, it might be a decimal (0.1 = 10%)
        // Check if it's already a percentage (> 1) or a decimal (< 1)
        errorRate = httpReqFailed.rate > 1 ? httpReqFailed.rate : httpReqFailed.rate * 100;
      } else if (httpReqFailed.values && httpReqFailed.values.rate !== undefined) {
        // Some k6 outputs have rate nested in values
        const { rate } = httpReqFailed.values;
        errorRate = rate > 1 ? rate : rate * 100;
      }

      // Calculate check failure rate (for "Failure Rate" metric)
      // checks_failed shows check assertion failures (more accurate for business logic)
      let failureRate = 0;
      if (checks.failRate !== undefined) {
        // Use check failure rate if available (already a decimal, e.g., 0.15 for 15%)
        failureRate = checks.failRate * 100;
      } else if (checks.failed !== undefined && checks.count !== undefined && checks.count > 0) {
        // Calculate from failed/count if failRate not available
        failureRate = (checks.failed / checks.count) * 100;
      } else {
        // Fallback to HTTP request failure rate if no check data
        failureRate = errorRate;
      }

      // Update metric cards (batch updates)
      this.$nextTick(() => {
        this.metrics[0].value = (httpReqs.rate || 0).toFixed(2);
        this.metrics[1].value = `${Math.round(httpReqDuration.avg || 0)}ms`;
        this.metrics[2].value = `${errorRate.toFixed(2)}%`; // Errors: HTTP request failures
        this.metrics[3].value = this.formatBytes(dataReceived.count || 0);
        // Use actual VU count from k6 metrics (vus = live gauge, vus_max = peak).
        // Fall back to the VUs that were actually passed at test start — NOT the
        // current UI form value, which may have drifted back to the default 10.
        const liveVus = metrics.vus?.value ?? metrics.vus?.max ?? null;
        const peakVus = metrics.vus_max?.value ?? metrics.vus_max?.max ?? null;
        const vuDisplay = liveVus ?? peakVus ?? this.currentTestVus ?? this.config.vus ?? '-';
        this.metrics[4].value =
          vuDisplay !== null && vuDisplay !== undefined ? String(vuDisplay) : '-';
        this.metrics[5].value = `${failureRate.toFixed(2)}%`; // Failure Rate: Check failures
      });

      // Update charts (batched via requestAnimationFrame)
      // Don't update charts if test is paused (keep last data visible)
      if (this.statusText !== 'Paused' && this.statusText !== 'Stopped') {
        this.updateCharts(metrics);
      }

      // Update statistics table (throttled to once per second)
      const now = Date.now();
      if (now - this.lastStatsUpdate >= this.statsUpdateThrottle) {
        this.lastStatsUpdate = now;
        this.updateRequestStats(metrics);
      }
    },
  },
});

// Register Icon component globally
app.component('Icon', window.Icon);

app.mount('#app');
