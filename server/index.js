/**
 * Load Test UI Panel Server
 * Express.js server for managing and running k6 load tests via web UI
 * @module server
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { TestManager } from './testManager.js';
import { apiRouter } from './routes/api.js';
import { verifyToken } from './middleware/auth.js';
import { findById } from './userStore.js';
import { getGlobalLoginBan } from './accessControlStore.js';
import { wsRoutine, wsWarn, wsError } from '../utils/wsLog.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Correlation id for HTTP (and echoed to clients) — use in `req.log` child loggers
app.use((req, res, next) => {
  const id = req.get('x-request-id') || randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  req.log = logger.child({ reqId: id });
  next();
});

// Optional one-line access log for /api (set LOG_HTTP=1)
if (process.env.LOG_HTTP === '1') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (!req.originalUrl.startsWith('/api')) {
        return;
      }
      (req.log || logger).info(
        {
          event: 'http_request',
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'http_request'
      );
    });
    next();
  });
}

const PORT = process.env.UI_PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Trust reverse-proxy headers (X-Forwarded-For) only when explicitly configured.
// Set TRUST_PROXY=1 (or a specific IP/CIDR) in .env when running behind nginx/caddy.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);
}

// SECURITY: Restrict CORS to the configured application origin.
// Default: both localhost and 127.0.0.1 (same machine, different string origins).
// Set ALLOWED_ORIGINS (comma-separated) in .env for production.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

/** RFC1918 / loopback (and localhost) — used in dev so LAN URLs like http://172.20.x.x:PORT work without .env */
function isPrivateOrLocalHostname(hostname) {
  if (hostname === 'localhost') {
    return true;
  }
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const [a, b] = [Number(parts[0]), Number(parts[1])];
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  return false;
}

/** In non-production, allow the UI served from a private/LAN host on the same port as this server */
function isDevLanUiOrigin(origin) {
  if (isProduction) {
    return false;
  }
  try {
    const u = new URL(origin);
    const expectedPort = String(PORT);
    const originPort = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (originPort !== expectedPort) {
      return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    return isPrivateOrLocalHostname(u.hostname);
  } catch {
    return false;
  }
}

/**
 * CSP connect-src: API/WebSocket must match allowed page origins (no global ws:/wss:).
 * Add CSP_CONNECT_SRC_EXTRA (comma-separated) for extra APIs, e.g. https://metrics.internal,wss://ws.internal
 */
function buildConnectSrc(allowedOrigins) {
  const out = new Set(["'self'"]);
  const addOrigin = (value) => {
    const t = value.trim();
    if (!t) {
      return;
    }
    out.add(t);
    try {
      const u = new URL(t);
      if (u.protocol === 'https:') {
        out.add(`wss://${u.host}`);
      } else if (u.protocol === 'http:') {
        out.add(`ws://${u.host}`);
      }
    } catch {
      // already a scheme-less or custom token — keep as-is
    }
  };
  for (const o of allowedOrigins) {
    addOrigin(o);
  }
  const extra = process.env.CSP_CONNECT_SRC_EXTRA;
  if (extra) {
    for (const part of extra.split(',')) {
      addOrigin(part);
    }
  }
  return [...out];
}

// Third-party origins still used by the frontend (Google Fonts only; Vue & Chart.js are self-hosted from node_modules)
const FONT_CDN_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

// Self-hosted UI vendor scripts (avoids CDN outages, corporate blocks, and reduces third-party script exposure)
const publicRoot = join(__dirname, '../public');
const vueDist = join(__dirname, '../node_modules/vue/dist');
const chartDist = join(__dirname, '../node_modules/chart.js/dist');
const uiBundlePath = join(publicRoot, 'dist/dashboard.js');
const uiBundledIndexPath = join(publicRoot, 'index.bundled.html');

/** Production bundle from `npm run build:ui` (minified Vue + Chart + app). */
function useUiProductionBundle() {
  if (process.env.UI_USE_BUNDLE === '0') {
    return false;
  }
  if (!existsSync(uiBundlePath) || !existsSync(uiBundledIndexPath)) {
    return false;
  }
  return isProduction || process.env.UI_USE_BUNDLE === '1';
}

const uiBundleActive = useUiProductionBundle();

app.disable('x-powered-by');

// Security headers
app.use(
  helmet({
    strictTransportSecurity: isProduction ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(uiBundleActive ? [] : ["'unsafe-eval'"])], // eval only for Vue global dev build
        styleSrc: ["'self'", "'unsafe-inline'", ...FONT_CDN_HOSTS],
        fontSrc: ["'self'", ...FONT_CDN_HOSTS],
        connectSrc: buildConnectSrc(ALLOWED_ORIGINS),
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(isProduction ? {} : { upgradeInsecureRequests: null }),
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Restrict powerful browser features this app does not use (defense-in-depth).
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), xr-spatial-tracking=()'
  );
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server / curl requests (no Origin header) and whitelisted origins
      if (!origin || ALLOWED_ORIGINS.includes(origin) || isDevLanUiOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" is not allowed`));
      }
    },
    credentials: false,
  })
);

// Static files served BEFORE the rate limiter so asset requests
// (app.js, styles.css, etc.) never consume API rate-limit quota.
const VENDOR_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day; filenames are unhashed so avoid long immutable caches
app.use('/vendor/vue', express.static(vueDist, { maxAge: VENDOR_MAX_AGE_MS }));
app.use('/vendor/chart.js', express.static(chartDist, { maxAge: VENDOR_MAX_AGE_MS }));
app.use(express.static(publicRoot));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting applies only to API requests (everything after static)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

app.use((req, res, next) => {
  const clientId = req.ip || 'unknown';
  const now = Date.now();

  if (!requestCounts.has(clientId)) {
    requestCounts.set(clientId, []);
  }

  const requests = requestCounts.get(clientId);
  const recentRequests = requests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW);

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(RATE_LIMIT_WINDOW / 1000),
    });
  }

  recentRequests.push(now);
  requestCounts.set(clientId, recentRequests);

  // Clean up old entries periodically
  if (Math.random() < 0.01) {
    for (const [id, timestamps] of requestCounts.entries()) {
      const recent = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW);
      if (recent.length === 0) {
        requestCounts.delete(id);
      } else {
        requestCounts.set(id, recent);
      }
    }
  }

  next();
});

// Initialize test manager
const testManager = new TestManager();

// WebSocket connection handler
// SECURITY: Require a valid JWT passed as ?token=<jwt> in the upgrade URL.
// Unauthenticated connections are rejected immediately — this prevents anyone
// who can reach the port from subscribing to live test output (which may
// contain credentials passed via customEnv).
wss.on('connection', (ws, req) => {
  try {
    const upgradeUrl = new URL(req.url, 'http://localhost');
    const token = upgradeUrl.searchParams.get('token');
    const payload = token ? verifyToken(token) : null;

    if (!payload) {
      wsWarn('handshake_rejected', { reason: 'missing_or_invalid_token' });
      ws.close(1008, 'Unauthorized: valid JWT required');
      return;
    }

    // Verify tokenVersion against the store — rejects stale tokens
    // issued before the user's role/permissions/limits were updated.
    const freshUser = findById(payload.id);
    if (!freshUser || (freshUser.tokenVersion ?? 1) !== (payload.tokenVersion ?? 1)) {
      wsWarn('handshake_rejected', {
        reason: 'session_stale_or_unknown_user',
        username: payload.username,
        userId: payload.id,
      });
      ws.close(1008, 'Session expired. Please log in again.');
      return;
    }

    if (freshUser.banned && freshUser.role !== 'admin') {
      wsWarn('handshake_rejected', {
        reason: 'account_banned',
        username: payload.username,
        userId: payload.id,
      });
      ws.close(1008, 'Account suspended');
      return;
    }
    if (getGlobalLoginBan() && freshUser.role !== 'admin') {
      wsWarn('handshake_rejected', {
        reason: 'global_login_ban',
        username: payload.username,
        userId: payload.id,
      });
      ws.close(1008, 'Logins suspended');
      return;
    }

    ws.user = freshUser;
    ws.traceId = randomUUID();

    // Send current test status
    ws.send(
      JSON.stringify({
        type: 'status',
        data: testManager.getStatus(),
      })
    );

    // Handle messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'subscribe') {
          testManager.addSubscriber(ws);
        }
      } catch (error) {
        wsWarn('client_message_invalid_json', {
          traceId: ws.traceId,
          username: ws.user?.username,
          userId: ws.user?.id,
          error: error.message,
        });
      }
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = Buffer.isBuffer(reasonBuf)
        ? reasonBuf.toString('utf8')
        : String(reasonBuf || '');
      testManager.removeSubscriber(ws);
      const abnormal = code !== 1000 && code !== 1001;
      const fields = {
        traceId: ws.traceId,
        username: ws.user?.username,
        userId: ws.user?.id,
        closeCode: code,
        closeReason: reason.slice(0, 200),
        subscribers: testManager.getLiveSubscriberCount(),
      };
      if (abnormal) {
        wsWarn('socket_closed', { ...fields, note: 'non-normal_close_code' });
      } else {
        wsRoutine('socket_closed', fields);
      }
    });
  } catch (err) {
    wsError('connection_handler_error', { traceId: ws?.traceId, err });
    ws.close(1011, 'Internal error');
  }
});

// API routes — auth is enforced per-route inside apiRouter
app.use('/api', apiRouter(testManager, wss));

// Login page
app.get('/login', (req, res) => {
  res.sendFile(join(__dirname, '../public/login.html'));
});

// Invite acceptance page
app.get('/invite', (req, res) => {
  res.sendFile(join(__dirname, '../public/invite.html'));
});

app.get('/reset', (req, res) => {
  res.sendFile(join(__dirname, '../public/reset.html'));
});

// Main dashboard — bundled HTML in production when build:ui has been run
app.get('/', (req, res) => {
  const htmlFile = uiBundleActive ? 'index.bundled.html' : 'index.html';
  res.sendFile(join(publicRoot, htmlFile));
});

// Start server
server.listen(PORT, () => {
  logger.info(
    {
      event: 'server_listen',
      port: Number(PORT),
      url: `http://localhost:${PORT}`,
      logLevel: logger.level,
      uiBundle: uiBundleActive,
    },
    'server_listen'
  );
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.fatal(
      {
        event: 'server_port_in_use',
        port: Number(PORT),
        hint: `lsof -ti:${PORT} | xargs kill -9 or set UI_PORT in .env`,
        err: error,
      },
      'server_port_in_use'
    );
    process.exit(1);
  } else {
    logger.fatal({ event: 'server_error', err: error }, 'server_error');
    process.exit(1);
  }
});

export { app, server, testManager };
