/**
 * Authentication Middleware
 * JWT-based authentication with role support.
 */

// Load .env before checking JWT_SECRET — in ESM all imports are hoisted before
// the parent module's dotenv.config() call, so we load it here explicitly.
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { findById } from '../userStore.js';
import { getGlobalLoginBan } from '../accessControlStore.js';

// SECURITY: No fallback secret — the server refuses to start without a real value.
const { JWT_SECRET } = process.env;
if (!JWT_SECRET) {
  console.error(
    'FATAL: JWT_SECRET environment variable is not set. Set it in your .env file before starting the server.'
  );
  process.exit(1);
}
const JWT_EXPIRES_IN = '24h';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function extractToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return req.headers['x-api-token'] || null;
}

/** Require a valid JWT — blocks with 401 if missing/invalid/stale. */
export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }

  // Check tokenVersion: if an admin updated this user, their tokenVersion
  // in the store will be higher than the one embedded in the JWT.
  // This forces a re-login so they get a fresh token with updated data.
  const freshUser = findById(payload.id);
  if (!freshUser) {
    return res.status(401).json({ success: false, error: 'User not found' });
  }
  if (freshUser.banned && freshUser.role !== 'admin') {
    return res.status(401).json({ success: false, error: 'Account suspended' });
  }
  if (getGlobalLoginBan() && freshUser.role !== 'admin') {
    return res.status(401).json({
      success: false,
      error: 'Logins are temporarily suspended. Only administrators may use the platform.',
    });
  }
  const jwtVersion = payload.tokenVersion ?? 1;
  const storeVersion = freshUser.tokenVersion ?? 1;
  if (jwtVersion !== storeVersion) {
    return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }

  // Use fresh data from store so limits/role/permissions are always current
  req.user = freshUser;
  next();
}

/** Require admin role — must be used after requireAuth. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

/** Legacy alias used in index.js. */
export const checkAuth = requireAuth;

export default { requireAuth, requireAdmin, checkAuth, signToken, verifyToken };
