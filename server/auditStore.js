/**
 * Audit Store
 * Append-only audit log stored in data/audit.json.
 * Tracks: logins, test runs, curl uploads.
 */

import { readFileSync, existsSync } from 'fs';
import { atomicWriteJSON } from './utils/atomicWrite.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.B2B_TEST_DATA_DIR
  ? process.env.B2B_TEST_DATA_DIR
  : join(__dirname, '../data');
const AUDIT_FILE = join(DATA_ROOT, 'audit.json');
const MAX_ENTRIES = 5000; // keep last 5000 entries

function readLog() {
  if (!existsSync(AUDIT_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(AUDIT_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeLog(entries) {
  // Trim to max size
  const trimmed = entries.slice(-MAX_ENTRIES);
  atomicWriteJSON(AUDIT_FILE, trimmed);
}

/** Parse a minimal OS name from user-agent string */
export function parseOs(ua = '') {
  if (!ua) {
    return 'Unknown';
  }
  if (/Windows NT 10/i.test(ua)) {
    return 'Windows 10';
  }
  if (/Windows NT 11/i.test(ua)) {
    return 'Windows 11';
  }
  if (/Windows/i.test(ua)) {
    return 'Windows';
  }
  if (/iPhone/i.test(ua)) {
    return 'iOS';
  }
  if (/iPad/i.test(ua)) {
    return 'iPadOS';
  }
  if (/Mac OS X/i.test(ua)) {
    return 'macOS';
  }
  if (/Android/i.test(ua)) {
    return 'Android';
  }
  if (/Linux/i.test(ua)) {
    return 'Linux';
  }
  return 'Unknown';
}

/** Parse browser name from user-agent */
export function parseBrowser(ua = '') {
  if (!ua) {
    return 'Unknown';
  }
  if (/Edg\//i.test(ua)) {
    return 'Edge';
  }
  if (/Chrome\//i.test(ua)) {
    return 'Chrome';
  }
  if (/Safari\//i.test(ua)) {
    return 'Safari';
  }
  if (/Firefox\//i.test(ua)) {
    return 'Firefox';
  }
  if (/curl\//i.test(ua)) {
    return 'cURL';
  }
  return 'Unknown';
}

/** Get client IP from request, respecting X-Forwarded-For */
export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

/** Append one audit event */
export function appendAudit(entry) {
  const log = readLog();
  log.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  writeLog(log);
}

/** Wipe the entire audit log */
export function clearAuditLog() {
  writeLog([]);
}

/** Get audit entries, newest first, with optional filters */
export function getAuditLog({ limit = 200, type, username, search } = {}) {
  let entries = readLog().reverse();
  if (type) {
    entries = entries.filter((e) => e.type === type);
  }
  if (username) {
    entries = entries.filter((e) => e.username === username);
  }
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.username?.toLowerCase().includes(q) ||
        e.details?.testName?.toLowerCase().includes(q) ||
        e.ip?.includes(q) ||
        e.os?.toLowerCase().includes(q)
    );
  }
  return entries.slice(0, limit);
}
