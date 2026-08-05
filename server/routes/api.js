/**
 * API Routes
 * REST API endpoints for test management + auth + admin
 */

import { Router } from 'express';
import {
  validateStartTest,
  validateUpdateLoad,
  validateHistoryQuery,
  validateTestId,
  sanitizeBody,
} from '../middleware/validation.js';
import { requireAuth, requireAdmin, signToken } from '../middleware/auth.js';
import {
  getAllUsers,
  findById,
  createUser,
  updateUser,
  setUserBanned,
  deleteUser,
  verifyPassword,
  bumpTokenVersion,
  banAllNonAdminUsers,
  unbanAllUsers,
  omitPassword,
} from '../userStore.js';
import { getGlobalLoginBan, setGlobalLoginBan } from '../accessControlStore.js';
import {
  getAllInvites,
  createInvite,
  getInviteByToken,
  peekInviteByToken,
  consumeInvite,
  revokeInvite,
} from '../inviteStore.js';
import {
  appendAudit,
  getAuditLog,
  clearAuditLog,
  getClientIp,
  parseOs,
  parseBrowser,
} from '../auditStore.js';
import { createReset, getResetByToken, consumeReset } from '../resetStore.js';
import { useMysqlStorage, pingPool } from '../db/index.js';
import { assertEmailAllowed } from '../emailPolicy.js';
import { getK6Info } from '../k6Info.js';
import {
  logRouteFailure,
  validatePasswordStrength,
  checkLoginLock,
  recordLoginFailure,
  clearLoginAttempts,
  checkIpLoginLock,
  recordIpLoginFailure,
  clearIpLoginAttempts,
  APP_BASE_URL,
  requireMode,
  safeError,
  kickUser,
  kickNonAdminSockets,
  checkLimits,
  createPausedExclusiveHelpers,
} from './helpers/routeHelpers.js';

export function apiRouter(testManager, wss) {
  const router = Router();
  const { pausedExclusiveBlockMessage } = createPausedExclusiveHelpers();
  router.use(sanitizeBody);

  /** GET /api/health — public readiness probe (no auth). */
  router.get('/health', async (req, res) => {
    const k6 = await getK6Info();
    const data = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      storage: useMysqlStorage() ? 'mysql' : 'json',
      version: process.env.APP_VERSION || null,
      k6: {
        version: k6.version,
        source: k6.source,
      },
    };
    if (useMysqlStorage()) {
      try {
        data.db = (await pingPool()) ? 'up' : 'down';
      } catch {
        data.db = 'down';
        data.status = 'degraded';
      }
    }
    res.status(data.status === 'ok' ? 200 : 503).json({ success: data.status === 'ok', data });
  });

  /** GET /api/version — public build / engine metadata (no auth). */
  router.get('/version', async (req, res) => {
    const k6 = await getK6Info();
    res.json({
      success: true,
      data: {
        name: 'fastertest',
        version: process.env.APP_VERSION || null,
        k6Version: k6.version,
        k6Source: k6.source,
        node: process.version,
        storage: useMysqlStorage() ? 'mysql' : 'json',
      },
    });
  });

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /** POST /api/auth/login */
  router.post('/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' });
      }

      // SECURITY: per-IP lock first (prevents targeted account-lockout DoS)
      const clientIp = getClientIp(req);
      const ipLockMsg = checkIpLoginLock(clientIp);
      if (ipLockMsg) {
        return res.status(429).json({ success: false, error: ipLockMsg });
      }

      // SECURITY: per-username brute-force lockout
      const lockMsg = checkLoginLock(username);
      if (lockMsg) {
        return res.status(429).json({ success: false, error: lockMsg });
      }

      const user = await verifyPassword(username, password);
      if (!user) {
        recordLoginFailure(username);
        recordIpLoginFailure(clientIp);
        void appendAudit({
          type: 'login_failed',
          username,
          ip: getClientIp(req),
          os: parseOs(req.headers['user-agent']),
          browser: parseBrowser(req.headers['user-agent']),
          ua: req.headers['user-agent'] || '',
        });
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }

      if (user.banned && user.role !== 'admin') {
        void appendAudit({
          type: 'login_denied_banned',
          username: user.username,
          userId: user.id,
          ip: getClientIp(req),
          os: parseOs(req.headers['user-agent']),
          browser: parseBrowser(req.headers['user-agent']),
          ua: req.headers['user-agent'] || '',
        });
        return res.status(403).json({
          success: false,
          error: 'This account has been suspended. Contact an administrator.',
        });
      }
      if ((await getGlobalLoginBan()) && user.role !== 'admin') {
        void appendAudit({
          type: 'login_denied_global_ban',
          username: user.username,
          userId: user.id,
          role: user.role,
          ip: getClientIp(req),
          os: parseOs(req.headers['user-agent']),
          browser: parseBrowser(req.headers['user-agent']),
          ua: req.headers['user-agent'] || '',
        });
        return res.status(403).json({
          success: false,
          error:
            'Logins are temporarily suspended for your account type. Only administrators may sign in.',
        });
      }

      clearLoginAttempts(username);
      clearIpLoginAttempts(clientIp);
      // Single session per user: invalidate prior JWTs and disconnect other browsers/tabs.
      const sessionUser = await bumpTokenVersion(user.id);
      kickUser(wss, user.id, 'Signed in from another browser or device. This session was closed.');
      const token = signToken({
        id: sessionUser.id,
        username: sessionUser.username,
        role: sessionUser.role,
        tokenVersion: sessionUser.tokenVersion ?? 1,
        permissions: sessionUser.permissions || { teams: [], modes: [] },
        limits: sessionUser.limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 },
      });
      void appendAudit({
        type: 'login',
        userId: sessionUser.id,
        username: sessionUser.username,
        role: sessionUser.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        ua: req.headers['user-agent'] || '',
      });
      res.json({ success: true, data: { token, user: sessionUser } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** GET /api/auth/me — returns fresh user info from store (not stale JWT payload) */
  router.get('/auth/me', requireAuth, async (req, res) => {
    const fresh = await findById(req.user.id);
    if (!fresh) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, data: omitPassword(fresh) });
  });

  // ─── Admin: user management (admin role only) ──────────────────────────────

  /** GET /api/admin/users */
  router.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json({ success: true, data: await getAllUsers() });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** GET /api/admin/access — global login suspension flag */
  router.get('/admin/access', requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json({ success: true, data: { globalLoginBan: await getGlobalLoginBan() } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** PUT /api/admin/access/global-ban — suspend logins for everyone except admins */
  router.put('/admin/access/global-ban', requireAuth, requireAdmin, async (req, res) => {
    try {
      const enabled = Boolean(req.body?.enabled);
      await setGlobalLoginBan(enabled);
      void appendAudit({
        type: enabled ? 'global_login_ban_enabled' : 'global_login_ban_disabled',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { enabled },
      });
      if (enabled) {
        kickNonAdminSockets(wss);
      }
      res.json({ success: true, data: { globalLoginBan: enabled } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** POST /api/admin/users/ban-all — suspend all non-admin accounts (admin role is never banned) */
  router.post('/admin/users/ban-all', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { bannedCount } = await banAllNonAdminUsers();
      void appendAudit({
        type: 'users_ban_all',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { bannedCount, scope: 'non_admin_only' },
      });
      const suspendMsg =
        'Your account has been suspended. You cannot use this platform until an administrator removes the ban.';
      for (const u of await getAllUsers()) {
        if (u.role !== 'admin' && u.banned) {
          kickUser(wss, u.id, suspendMsg);
        }
      }
      res.json({ success: true, data: { bannedCount } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** POST /api/admin/users/unban-all — clear banned on every account */
  router.post('/admin/users/unban-all', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { unbannedCount } = await unbanAllUsers();
      void appendAudit({
        type: 'users_unban_all',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { unbannedCount },
      });
      res.json({ success: true, data: { unbannedCount } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** POST /api/admin/users */
  router.post('/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { username, password, role, email, permissions, limits } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' });
      }
      const pwErr = validatePasswordStrength(password);
      if (pwErr) {
        return res.status(400).json({ success: false, error: pwErr });
      }
      const VALID_ROLES = ['admin', 'tech-lead', 'developer', 'qa', 'pm'];
      if (!VALID_ROLES.includes(role)) {
        return res
          .status(400)
          .json({ success: false, error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
      }
      if (email) {
        try {
          assertEmailAllowed(email);
        } catch (e) {
          return res.status(400).json({ success: false, error: e.message });
        }
      }
      const user = await createUser(
        username,
        password,
        role,
        email || '',
        permissions || { teams: [], modes: [] },
        limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 }
      );
      void appendAudit({
        type: 'user_created',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetUsername: username, targetRole: role, targetEmail: email || '' },
      });
      res.status(201).json({ success: true, data: user });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  /** PATCH /api/admin/users/:id/suspension — toggle banned only (avoids full PUT + id/boolean edge cases). */
  router.patch('/admin/users/:id/suspension', requireAuth, requireAdmin, async (req, res) => {
    try {
      const raw = req.body?.banned;
      if (typeof raw !== 'boolean') {
        return res
          .status(400)
          .json({ success: false, error: 'Body must include banned as a boolean' });
      }
      const user = await setUserBanned(req.params.id, raw);
      void appendAudit({
        type: 'user_updated',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetUsername: user.username, targetRole: user.role, banned: user.banned },
      });
      const suspendMsg =
        'Your account has been suspended. You cannot use this platform until an administrator removes the ban.';
      kickUser(wss, req.params.id, user.banned ? suspendMsg : undefined);
      res.json({ success: true, data: user });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  /** PUT /api/admin/users/:id */
  router.put('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      if (email) {
        try {
          assertEmailAllowed(email);
        } catch (e) {
          return res.status(400).json({ success: false, error: e.message });
        }
      }
      const user = await updateUser(req.params.id, req.body);
      void appendAudit({
        type: 'user_updated',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetUsername: user.username, targetRole: user.role, banned: user.banned },
      });
      // Immediately close any open WebSocket for the updated user so their
      // browser receives the close event and redirects to the login page.
      const suspendMsg =
        'Your account has been suspended. You cannot use this platform until an administrator removes the ban.';
      kickUser(wss, req.params.id, user.banned ? suspendMsg : undefined);
      res.json({ success: true, data: user });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  /** DELETE /api/admin/users/:id */
  router.delete('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      // Prevent self-delete
      if (req.params.id === req.user.id) {
        return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
      }
      const targetUser = await deleteUser(req.params.id);
      void appendAudit({
        type: 'user_deleted',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: {
          targetUsername: targetUser?.username || req.params.id,
          targetRole: targetUser?.role,
        },
      });
      res.json({ success: true });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  // ─── Password reset ───────────────────────────────────────────────────────

  /** POST /api/admin/users/:id/reset-link — admin generates a reset link */
  router.post('/admin/users/:id/reset-link', requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = await findById(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const entry = await createReset(user.id, user.username);
      // SECURITY: Use APP_BASE_URL (set via env) to prevent Host-header injection.
      const link = `${APP_BASE_URL}/reset?token=${entry.token}`;
      void appendAudit({
        type: 'reset_link_created',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetUsername: user.username },
      });
      res.json({ success: true, data: { link, expiresAt: entry.expiresAt } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** GET /api/reset/:token — validate a reset token (public) */
  router.get('/reset/:token', async (req, res) => {
    const entry = await getResetByToken(req.params.token);
    if (!entry) {
      return res.status(400).json({ success: false, error: 'Reset link is invalid or expired' });
    }
    res.json({ success: true, data: { username: entry.username } });
  });

  /** POST /api/reset/:token — submit new password (public) */
  router.post('/reset/:token', async (req, res) => {
    try {
      const entry = await getResetByToken(req.params.token);
      if (!entry) {
        return res.status(400).json({ success: false, error: 'Reset link is invalid or expired' });
      }
      const acct = await findById(entry.userId);
      if (acct?.banned) {
        return res.status(403).json({
          success: false,
          error:
            'This account is suspended. Password cannot be changed until an administrator removes the suspension.',
        });
      }
      const { password } = req.body;
      const pwErr = validatePasswordStrength(password);
      if (pwErr) {
        return res.status(400).json({ success: false, error: pwErr });
      }
      await updateUser(entry.userId, { password });
      await consumeReset(entry.token);
      void appendAudit({
        type: 'password_reset',
        userId: entry.userId,
        username: entry.username,
        role: '',
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
      });
      res.json({ success: true });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  // ─── Invites (admin only to create/list/revoke; public to validate/accept) ─

  /** GET /api/admin/invites — list all pending invites */
  router.get('/admin/invites', requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json({ success: true, data: await getAllInvites() });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** POST /api/admin/invites — create invite link */
  router.post('/admin/invites', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { email, role, permissions, limits } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }
      const INVITE_VALID_ROLES = ['admin', 'tech-lead', 'developer', 'qa', 'pm'];
      const inviteRole = role || 'developer';
      if (!INVITE_VALID_ROLES.includes(inviteRole)) {
        return res
          .status(400)
          .json({ success: false, error: `Role must be one of: ${INVITE_VALID_ROLES.join(', ')}` });
      }
      const invite = await createInvite(
        email,
        inviteRole,
        req.user.username,
        permissions || { teams: [], modes: [] },
        limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 }
      );
      // SECURITY: Use APP_BASE_URL (set via env) to prevent Host-header injection.
      const link = `${APP_BASE_URL}/invite?token=${invite.token}`;
      void appendAudit({
        type: 'invite_created',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetEmail: email, targetRole: role || 'developer' },
      });
      res.status(201).json({ success: true, data: { ...invite, link } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  /** DELETE /api/admin/invites/:token — revoke an invite */
  router.delete('/admin/invites/:token', requireAuth, requireAdmin, async (req, res) => {
    try {
      const revoked = await revokeInvite(req.params.token);
      void appendAudit({
        type: 'invite_revoked',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetEmail: revoked?.email, targetRole: revoked?.role },
      });
      res.json({ success: true });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  /** GET /api/invite/:token — validate token (public) */
  router.get('/invite/:token', async (req, res) => {
    const peek = await peekInviteByToken(req.params.token);
    if (peek.status === 'missing' || peek.status === 'expired') {
      return res.status(404).json({ success: false, error: 'Invite link is invalid or expired' });
    }
    if (peek.status === 'used') {
      return res.json({
        success: true,
        data: {
          email: peek.invite.email,
          role: peek.invite.role,
          alreadyUsed: true,
        },
      });
    }
    res.json({ success: true, data: { email: peek.invite.email, role: peek.invite.role } });
  });

  /** POST /api/invite/:token/accept — complete registration (public) */
  router.post('/invite/:token/accept', async (req, res) => {
    try {
      const invite = await getInviteByToken(req.params.token);
      if (!invite) {
        return res.status(400).json({ success: false, error: 'Invite link is invalid or expired' });
      }

      const { username, password } = req.body;
      if (!username || !password) {
        return res
          .status(400)
          .json({ success: false, error: 'Username and password are required' });
      }
      // Username: 3-32 chars, letters/numbers/dot/underscore/hyphen only
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
        return res.status(400).json({
          success: false,
          error:
            'Username must be 3–32 characters and may only contain letters, numbers, dots, underscores, and hyphens.',
        });
      }
      const pwErr = validatePasswordStrength(password);
      if (pwErr) {
        return res.status(400).json({ success: false, error: pwErr });
      }

      const user = await createUser(
        username,
        password,
        invite.role,
        invite.email,
        invite.permissions || { teams: [], modes: [] },
        invite.limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 }
      );
      await consumeInvite(invite.token);
      void appendAudit({
        type: 'invite_accepted',
        userId: user.id,
        username: user.username,
        role: user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { targetEmail: invite.email, invitedBy: invite.createdBy },
      });

      const sessionUser = await bumpTokenVersion(user.id);
      const token = signToken({
        id: sessionUser.id,
        username: sessionUser.username,
        role: sessionUser.role,
        tokenVersion: sessionUser.tokenVersion ?? 1,
        permissions: sessionUser.permissions || { teams: [], modes: [] },
        limits: sessionUser.limits || { enabled: false, maxVus: 50, maxDurationMinutes: 30 },
      });
      res.status(201).json({ success: true, data: { token, user: sessionUser } });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  // ─── Audit log (admin only) ───────────────────────────────────────────────

  /** GET /api/admin/audit */
  router.get('/admin/audit', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { limit, type, username, search } = req.query;
      const parsedLimit = parseInt(limit, 10);
      const entries = await getAuditLog({
        limit: limit && !isNaN(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 200,
        type: type || undefined,
        username: username || undefined,
        search: search || undefined,
      });
      res.json({ success: true, data: entries });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  /** DELETE /api/admin/audit — clear all log entries (requires ?confirm=yes) */
  router.delete('/admin/audit', requireAuth, requireAdmin, async (req, res) => {
    try {
      // SECURITY: Require explicit confirmation to prevent accidental (or malicious)
      // log deletion. Pass ?confirm=yes in the query string to proceed.
      if (req.query.confirm !== 'yes') {
        return res.status(400).json({
          success: false,
          error: 'Pass ?confirm=yes to permanently delete all audit log entries.',
        });
      }
      await clearAuditLog();
      void appendAudit({
        type: 'audit_cleared',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
      });
      res.json({ success: true });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  // ─── Test management (requires auth) ──────────────────────────────────────

  router.get('/tests', requireAuth, (req, res) => {
    try {
      let tests = testManager.getAvailableTests();
      const { role, permissions } = req.user;
      // Admins bypass all filters
      if (role !== 'admin') {
        const allowedTeams = permissions?.teams || [];
        if (allowedTeams.length > 0) {
          tests = tests.filter((t) => allowedTeams.includes(t.team));
        }
      }
      res.json({ success: true, data: tests });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  router.get('/status', requireAuth, (req, res) => {
    try {
      res.json({ success: true, data: testManager.getStatus() });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  // Mark current user as preparing a new test (clicked "New Test")
  router.post('/tests/prepare', requireAuth, (req, res) => {
    const status = testManager.getStatus();
    if (status.running) {
      return res.status(409).json({ success: false, error: 'A test is already running' });
    }
    const pausedBlock = pausedExclusiveBlockMessage(req.user, status);
    if (pausedBlock) {
      return res.status(403).json({ success: false, error: pausedBlock });
    }
    testManager.setPreparing({ id: req.user.id, username: req.user.username });
    res.json({ success: true });
  });

  // Cancel preparing state (user navigated away or cancelled; admin may clear anyone's lock)
  router.post('/tests/cancel-prepare', requireAuth, (req, res) => {
    const preparing = testManager.preparingUser;
    const privileged = req.user.role === 'admin';
    if (preparing && (privileged || preparing.id === req.user.id)) {
      testManager.clearPreparing();
    }
    res.json({ success: true });
  });

  router.post(
    '/tests/start',
    requireAuth,
    requireMode('scenario'),
    validateStartTest,
    async (req, res) => {
      try {
        const { testId, options } = req.body;

        // SECURITY: Re-validate team access on start, not only on GET /tests.
        // Without this a user could start a test they cannot see in the list.
        if (req.user.role !== 'admin') {
          const allTests = testManager.getAvailableTests();
          const target = allTests.find((t) => t.id === testId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'Test not found' });
          }
          const allowedTeams = req.user.permissions?.teams || [];
          if (target.team) {
            // Scenario has a team — enforce access
            if (allowedTeams.length > 0 && !allowedTeams.includes(target.team)) {
              return res
                .status(403)
                .json({ success: false, error: 'You do not have access to this test' });
            }
          } else {
            // Scenario has no team — only allowed if user has unrestricted access (empty allowedTeams = all teams)
            if (allowedTeams.length > 0) {
              return res
                .status(403)
                .json({ success: false, error: 'You do not have access to this test' });
            }
          }
        }

        const limitErr = checkLimits(req.user, options);
        if (limitErr) {
          return res.status(403).json({ success: false, error: limitErr });
        }

        const status = testManager.getStatus();
        const pausedBlock = pausedExclusiveBlockMessage(req.user, status);
        if (pausedBlock) {
          return res.status(403).json({ success: false, error: pausedBlock });
        }

        const result = await testManager.startTest(testId, options || {}, {
          id: req.user.id,
          username: req.user.username,
        });
        void appendAudit({
          type: 'test_run',
          userId: req.user.id,
          username: req.user.username,
          role: req.user.role,
          ip: getClientIp(req),
          os: parseOs(req.headers['user-agent']),
          browser: parseBrowser(req.headers['user-agent']),
          details: {
            testName: testId,
            testType: 'scenario',
            vus: options?.vus,
            duration: options?.duration,
            env: options?.environment,
          },
        });
        res.json({ success: true, data: result });
      } catch (error) {
        logRouteFailure(req, error, 'api_handler_error', 400);
        res.status(400).json({ success: false, error: safeError(error) });
      }
    }
  );

  router.post('/tests/stop', requireAuth, (req, res) => {
    try {
      const status = testManager.getStatus();
      const STOP_ROLES = ['admin', 'tech-lead'];
      const isPrivileged = STOP_ROLES.includes(req.user.role);
      const isStarter =
        status.startedBy != null && String(status.startedBy) === String(req.user.id);
      const needsStopAuth = status.running || status.pausedForResume;
      if (needsStopAuth && !isPrivileged && !isStarter) {
        return res.status(403).json({
          success: false,
          error:
            'Only the user who started the test, a tech-lead, or an admin can stop or discard it.',
        });
      }
      res.json({
        success: true,
        data: testManager.stopTest({ id: req.user.id, username: req.user.username }),
      });
    } catch (error) {
      logRouteFailure(req, error, 'api_stop_test_error', 400);
      res.status(400).json({ success: false, error: 'Failed to stop test' });
    }
  });

  /**
   * Merge partial POST /tests/update-load body with the active run's `status.options`
   * so changing only VUs or only duration keeps the other dimension from the server.
   */
  function mergeLoadUpdatePayload(body, status) {
    const o = status.options || {};
    let vus;
    if (body.vus !== undefined && body.vus !== null && body.vus !== '') {
      vus = Number(body.vus);
      if (!Number.isFinite(vus)) {
        throw new Error('Invalid vus');
      }
    } else if (o.vus != null && o.vus !== '') {
      vus = Number(o.vus);
    }
    if (vus === undefined || !Number.isFinite(vus)) {
      throw new Error('Could not determine VUs. Send vus or ensure the run has VUs set.');
    }

    let duration;
    if (
      body.duration !== undefined &&
      body.duration !== null &&
      String(body.duration).trim() !== ''
    ) {
      duration = String(body.duration).trim();
    } else {
      const fromOpts = o.segmentDuration || o.duration;
      duration =
        fromOpts != null && String(fromOpts).trim() !== '' ? String(fromOpts).trim() : null;
    }
    if (!duration) {
      throw new Error(
        'Could not determine segment duration. Send duration or ensure the run is active.'
      );
    }

    return { vus: Math.trunc(vus), duration };
  }

  /**
   * POST /api/tests/update-load — ramp up/down: new VUs + duration for the next k6 segment
   * (restarts the process; same logical run / merged results).
   * Body may include **vus** and/or **duration**; omitted fields are taken from the active run.
   */
  router.post(
    '/tests/update-load',
    requireAuth,
    requireMode('scenario'),
    validateUpdateLoad,
    async (req, res) => {
      try {
        const status = testManager.getStatus();
        const STOP_ROLES = ['admin', 'tech-lead'];
        const isPrivileged = STOP_ROLES.includes(req.user.role);
        const isStarter =
          status.startedBy != null && String(status.startedBy) === String(req.user.id);
        if (!status.running || status.pausedForResume) {
          return res.status(400).json({
            success: false,
            error: 'No active running test to update.',
          });
        }
        if (!isPrivileged && !isStarter) {
          return res.status(403).json({
            success: false,
            error:
              'Only the user who started the test, a tech-lead, or an admin can change load while running.',
          });
        }
        const merged = mergeLoadUpdatePayload(req.body, status);
        const limitErr = checkLimits(req.user, {
          vus: merged.vus,
          duration: merged.duration,
        });
        if (limitErr) {
          return res.status(403).json({ success: false, error: limitErr });
        }
        const data = await testManager.updateRunningLoad(merged, {
          id: req.user.id,
          username: req.user.username,
        });
        void appendAudit({
          type: 'test_load_update',
          userId: req.user.id,
          username: req.user.username,
          role: req.user.role,
          ip: getClientIp(req),
          os: parseOs(req.headers['user-agent']),
          browser: parseBrowser(req.headers['user-agent']),
          details: {
            vus: merged.vus,
            duration: merged.duration,
            testId: status.testId,
          },
        });
        res.json({ success: true, data });
      } catch (error) {
        logRouteFailure(req, error, 'api_handler_error', 400);
        res.status(400).json({ success: false, error: safeError(error) });
      }
    }
  );

  router.post('/tests/pause', requireAuth, requireMode('scenario'), (req, res) => {
    try {
      const status = testManager.getStatus();
      const STOP_ROLES = ['admin', 'tech-lead'];
      const isPrivileged = STOP_ROLES.includes(req.user.role);
      const isStarter =
        status.startedBy != null && String(status.startedBy) === String(req.user.id);
      if (status.running && !isPrivileged && !isStarter) {
        return res.status(403).json({
          success: false,
          error: 'Only the user who started the test, a tech-lead, or an admin can pause it.',
        });
      }
      const data = testManager.pauseTest({ id: req.user.id, username: req.user.username });
      void appendAudit({
        type: 'test_pause',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { testId: status.testId },
      });
      res.json({ success: true, data });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  router.post('/tests/resume', requireAuth, requireMode('scenario'), async (req, res) => {
    try {
      const status = testManager.getStatus();
      if (!status.pausedForResume) {
        return res.status(400).json({ success: false, error: 'No paused test to resume.' });
      }
      const STOP_ROLES = ['admin', 'tech-lead'];
      const isPrivileged = STOP_ROLES.includes(req.user.role);
      const isStarter =
        status.startedBy != null && String(status.startedBy) === String(req.user.id);
      if (!isPrivileged && !isStarter) {
        return res.status(403).json({
          success: false,
          error: 'Only the user who started the test, a tech-lead, or an admin can resume it.',
        });
      }

      const limitErr = checkLimits(req.user, status.resumeInfo?.options || {});
      if (limitErr) {
        return res.status(403).json({ success: false, error: limitErr });
      }

      const result = await testManager.resumeTest({ id: req.user.id, username: req.user.username });
      void appendAudit({
        type: 'test_resume',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: {
          testName: status.resumeInfo?.scenarioTestId,
          vus: status.resumeInfo?.options?.vus,
          remainingMs: status.resumeInfo?.remainingMs,
        },
      });
      res.json({ success: true, data: result });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  router.get('/history', requireAuth, validateHistoryQuery, (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      res.json({ success: true, data: testManager.getHistory(limit) });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  });

  function clearAllHistoryHandler(req, res) {
    try {
      const data = testManager.clearAllTestHistory();
      void appendAudit({
        type: 'history_cleared',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: {
          deletedCount: data.deletedCount,
          reportFilesRemoved: data.reportFilesRemoved,
        },
      });
      res.json({ success: true, data });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 500);
      res.status(500).json({ success: false, error: safeError(error) });
    }
  }

  /**
   * POST /api/history/clear — wipe all entries and report files (admin only).
   * Prefer this over DELETE /history: many reverse proxies return HTML for bare DELETE.
   */
  router.post('/history/clear', requireAuth, requireAdmin, clearAllHistoryHandler);

  /** DELETE /api/history — same as POST /history/clear (admin only). */
  router.delete('/history', requireAuth, requireAdmin, clearAllHistoryHandler);

  function getHistoryEntry(testId) {
    return testManager.getHistory(1000).find((t) => t.id === testId) || null;
  }

  // View: any authenticated user may read results (team tool).
  router.get('/results/:testId', requireAuth, validateTestId, (req, res) => {
    try {
      res.json({ success: true, data: testManager.getTestResults(req.params.testId) });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 404);
      res.status(404).json({ success: false, error: safeError(error) });
    }
  });

  // Delete: only admin, tech-lead, or the user who started the test.
  function canDeleteHistoryEntry(req, entry) {
    if (!entry) {
      return false;
    }
    const { role } = req.user;
    if (role === 'admin' || role === 'tech-lead') {
      return true;
    }
    return entry.startedBy === req.user.id || entry.startedByUsername === req.user.username;
  }

  router.delete('/history/:testId', requireAuth, validateTestId, (req, res) => {
    try {
      const entry = getHistoryEntry(req.params.testId);
      if (!canDeleteHistoryEntry(req, entry)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      res.json({ success: true, data: testManager.deleteTestHistory(req.params.testId) });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 404);
      res.status(404).json({ success: false, error: safeError(error) });
    }
  });

  router.post('/tests/curl', requireAuth, requireMode('curl'), async (req, res) => {
    try {
      const { testName, request, options } = req.body;
      if (!testName || !request) {
        return res
          .status(400)
          .json({ success: false, error: 'Test name and request data are required' });
      }
      if (!/^[a-z0-9-]+$/.test(testName)) {
        return res.status(400).json({
          success: false,
          error: 'Test name must contain only lowercase letters, numbers, and hyphens',
        });
      }
      const limitErr = checkLimits(req.user, options);
      if (limitErr) {
        return res.status(403).json({ success: false, error: limitErr });
      }

      const result = await testManager.createCurlTest(testName, request, options || {});
      void appendAudit({
        type: 'curl_upload',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: { testName, testType: 'curl', url: request?.url, method: request?.method },
      });
      res.json({ success: true, data: result });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  router.post('/tests/curl-chain', requireAuth, requireMode('curl'), async (req, res) => {
    try {
      const { testName, steps, options } = req.body;
      if (!testName || !Array.isArray(steps) || steps.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Test name and at least one step are required' });
      }
      if (!/^[a-z0-9-]+$/.test(testName)) {
        return res.status(400).json({
          success: false,
          error: 'Test name must contain only lowercase letters, numbers, and hyphens',
        });
      }
      for (const [i, step] of steps.entries()) {
        if (!step.url || !step.method) {
          return res
            .status(400)
            .json({ success: false, error: `Step ${i + 1} is missing url or method.` });
        }
      }
      const limitErr = checkLimits(req.user, options);
      if (limitErr) {
        return res.status(403).json({ success: false, error: limitErr });
      }

      const result = await testManager.createCurlChainTest(testName, steps, options || {});
      void appendAudit({
        type: 'curl_upload',
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role,
        ip: getClientIp(req),
        os: parseOs(req.headers['user-agent']),
        browser: parseBrowser(req.headers['user-agent']),
        details: {
          testName,
          testType: 'curl-chain',
          stepCount: steps.length,
          steps: steps.map((s) => ({ url: s.url, method: s.method })),
        },
      });
      res.json({ success: true, data: result });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  router.delete('/tests/:testId', requireAuth, requireAdmin, validateTestId, async (req, res) => {
    try {
      res.json({ success: true, data: await testManager.deleteTest(req.params.testId) });
    } catch (error) {
      logRouteFailure(req, error, 'api_handler_error', 400);
      res.status(400).json({ success: false, error: safeError(error) });
    }
  });

  return router;
}
