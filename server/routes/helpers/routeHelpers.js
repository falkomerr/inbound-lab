/**
 * Shared helpers for API route modules (auth, admin, tests).
 */

import { logger } from '../../../utils/logger.js';

/** Structured log for route handler failures (4xx → warn, 5xx → error). */
export function logRouteFailure(req, error, event, statusCode) {
  const log = req.log || logger;
  const payload = { err: error, event, statusCode };
  if (statusCode >= 500) {
    log.error(payload, event);
  } else {
    log.warn(payload, event);
  }
}

export function validatePasswordStrength(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one digit';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character';
  }
  return null;
}

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED_USERNAMES = 5000;

export function checkLoginLock(username) {
  const now = Date.now();
  const entry = loginAttempts.get(username);
  if (!entry) {
    return null;
  }
  if (entry.lockedUntil && now < entry.lockedUntil) {
    const minsLeft = Math.ceil((entry.lockedUntil - now) / 60000);
    return `Too many failed attempts. Try again in ${minsLeft} minute(s).`;
  }
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    loginAttempts.delete(username);
  }
  return null;
}

export function recordLoginFailure(username) {
  if (loginAttempts.size >= MAX_TRACKED_USERNAMES) {
    loginAttempts.delete(loginAttempts.keys().next().value);
  }
  const entry = loginAttempts.get(username) || { count: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(username, entry);
}

export function clearLoginAttempts(username) {
  loginAttempts.delete(username);
}

const ipLoginAttempts = new Map();
const IP_MAX_ATTEMPTS = 20;
const IP_LOCKOUT_MS = 15 * 60 * 1000;

export function checkIpLoginLock(ip) {
  const now = Date.now();
  const entry = ipLoginAttempts.get(ip);
  if (!entry) {
    return null;
  }
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return 'Too many login attempts from your network. Try again later.';
  }
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    ipLoginAttempts.delete(ip);
  }
  return null;
}

export function recordIpLoginFailure(ip) {
  if (ipLoginAttempts.size >= 10000) {
    ipLoginAttempts.delete(ipLoginAttempts.keys().next().value);
  }
  const entry = ipLoginAttempts.get(ip) || { count: 0 };
  entry.count += 1;
  if (entry.count >= IP_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + IP_LOCKOUT_MS;
  }
  ipLoginAttempts.set(ip, entry);
}

export function clearIpLoginAttempts(ip) {
  ipLoginAttempts.delete(ip);
}

export const APP_BASE_URL = (
  process.env.APP_BASE_URL || `http://localhost:${process.env.UI_PORT || 3001}`
).replace(/\/$/, '');

export function requireMode(mode) {
  return (req, res, next) => {
    const { role, permissions } = req.user;
    if (role === 'admin' || role === 'tech-lead') {
      return next();
    }
    const allowed = permissions?.modes;
    if (!allowed || allowed.length === 0) {
      return next();
    }
    if (allowed.includes(mode)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: `Access denied: your account does not have permission to use ${mode} tests`,
    });
  };
}

export function safeError(error, fallback = 'An error occurred') {
  if (!(error instanceof Error) || !error.message) {
    return fallback;
  }
  const msg = error.message;
  if (msg.length >= 200) {
    return fallback;
  }
  if (/at\s+\w|\(.*\.js:\d+/i.test(msg)) {
    return fallback;
  }
  if (/\/[a-z0-9_\-/.]+\.(js|json|ts|env)\b/i.test(msg)) {
    return fallback;
  }
  if (/\b(ENOENT|EACCES|EEXIST|EPERM|EMFILE|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b/.test(msg)) {
    return fallback;
  }
  return msg;
}

export function kickUser(wss, userId, reason) {
  if (!wss) {
    return;
  }
  const defaultReason = 'Your account was updated by an admin. Please log in again.';
  const msg = reason || defaultReason;
  for (const client of wss.clients) {
    if (client.readyState === 1 && String(client.user?.id) === String(userId)) {
      try {
        client.send(JSON.stringify({ type: 'force-logout', reason: msg }));
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          client.close(1008, 'Session expired. Please log in again.');
        } catch {
          /* ignore */
        }
      }, 200);
    }
  }
}

export function kickNonAdminSockets(wss) {
  if (!wss) {
    return;
  }
  const reason =
    'Administrator has suspended logins for all non-admin accounts. Only administrators may use the platform until this is lifted.';
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.user?.role && client.user.role !== 'admin') {
      try {
        client.send(JSON.stringify({ type: 'force-logout', reason }));
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          client.close(1008, 'Logins suspended');
        } catch {
          /* ignore */
        }
      }, 200);
    }
  }
}

/** Shared limit check — returns error string or null */
export function checkLimits(user, options) {
  const { limits } = user;
  if (!limits?.enabled || user.role === 'admin') {
    return null;
  }
  if (options?.vus !== undefined && options.vus > limits.maxVus) {
    return `Your VU limit is ${limits.maxVus}. Requested: ${options.vus}`;
  }
  if (options?.duration !== undefined) {
    const val = parseInt(options.duration, 10);
    const unit = options.duration.slice(-1);
    const mins = unit === 'h' ? val * 60 : unit === 'm' ? val : Math.ceil(val / 60);
    if (mins > limits.maxDurationMinutes) {
      return `Your duration limit is ${limits.maxDurationMinutes} min. Requested: ${mins} min`;
    }
  }
  return null;
}

export function createPausedExclusiveHelpers() {
  const PAUSED_EXCLUSIVE_MS = 5 * 60 * 1000;

  function isPausedForResumeStatus(status) {
    return Boolean(status && !status.running && status.pausedForResume);
  }

  function pausedExclusiveBlockMessage(user, status) {
    if (!isPausedForResumeStatus(status)) {
      return null;
    }
    const refTime = status.endTime || status.resumeInfo?.pausedAt;
    if (!refTime) {
      return null;
    }
    const age = Date.now() - new Date(refTime).getTime();
    if (age < 0 || age >= PAUSED_EXCLUSIVE_MS) {
      return null;
    }
    if (['admin', 'tech-lead'].includes(user.role)) {
      return null;
    }
    return 'Only administrators and tech leads can prepare or start a new test while a paused session is active (first five minutes).';
  }

  return { isPausedForResumeStatus, pausedExclusiveBlockMessage };
}
