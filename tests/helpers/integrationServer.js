/**
 * In-process HTTP + WebSocket server for integration tests.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_JWT_SECRET = 'integration-test-jwt-secret-min-32-chars';
export const FAKE_K6_PATH = join(__dirname, '../fixtures/fake-k6.mjs');

/**
 * @returns {Promise<{
 *   server: import('http').Server,
 *   wss: WebSocketServer,
 *   testManager: import('../../server/testManager.js').TestManager,
 *   baseUrl: string,
 *   wsBase: string,
 *   dataDir: string,
 *   reportsDir: string,
 *   createUser: Function,
 *   signToken: Function,
 *   close: () => Promise<void>,
 * }>}
 */
export async function createIntegrationServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'b2b-int-'));
  const reportsDir = mkdtempSync(join(tmpdir(), 'b2b-reports-'));
  process.env.B2B_TEST_DATA_DIR = dataDir;
  process.env.B2B_TEST_REPORTS_DIR = reportsDir;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.APP_BASE_URL = 'http://localhost:3001';
  process.env.K6_BIN = FAKE_K6_PATH;
  process.env.FAKE_K6_DELAY_MS = '50';

  const stamp = Date.now();
  const { apiRouter } = await import(`../../server/routes/api.js?int=${stamp}`);
  const { TestManager } = await import(`../../server/testManager.js?int=${stamp}`);
  const { createUser } = await import(`../../server/userStore.js?int=${stamp}`);
  const { signToken, verifyToken } = await import(`../../server/middleware/auth.js?int=${stamp}`);
  const { findById } = await import(`../../server/userStore.js?int2=${stamp}`);
  const { getGlobalLoginBan } = await import(`../../server/accessControlStore.js?int=${stamp}`);

  const testManager = new TestManager();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} };
    next();
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    void (async () => {
      try {
        const upgradeUrl = new URL(req.url, 'http://localhost');
        const token = upgradeUrl.searchParams.get('token');
        const payload = token ? verifyToken(token) : null;
        if (!payload) {
          ws.close(1008, 'Unauthorized: valid JWT required');
          return;
        }
        const freshUser = await findById(payload.id);
        if (!freshUser || (freshUser.tokenVersion ?? 1) !== (payload.tokenVersion ?? 1)) {
          ws.close(1008, 'Session expired. Please log in again.');
          return;
        }
        if (freshUser.banned && freshUser.role !== 'admin') {
          ws.close(1008, 'Account suspended');
          return;
        }
        if ((await getGlobalLoginBan()) && freshUser.role !== 'admin') {
          ws.close(1008, 'Logins suspended');
          return;
        }
        ws.user = freshUser;
        ws.traceId = randomUUID();
        ws.send(JSON.stringify({ type: 'status', data: testManager.getStatus() }));
        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message);
            if (data.type === 'subscribe') {
              testManager.addSubscriber(ws);
            }
          } catch {
            /* ignore invalid client messages */
          }
        });
        ws.on('close', () => testManager.removeSubscriber(ws));
      } catch {
        ws.close(1011, 'Internal error');
      }
    })();
  });

  app.use('/api', apiRouter(testManager, wss));

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const wsBase = `ws://127.0.0.1:${port}`;

  return {
    server,
    wss,
    testManager,
    baseUrl,
    wsBase,
    dataDir,
    reportsDir,
    createUser,
    signToken,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(reportsDir, { recursive: true, force: true });
      delete process.env.B2B_TEST_DATA_DIR;
      delete process.env.B2B_TEST_REPORTS_DIR;
    },
  };
}
