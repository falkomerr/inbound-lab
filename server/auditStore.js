/**
 * Audit store facade — MySQL when configured, JSON files otherwise.
 */

import { useMysqlStorage } from './db/config.js';
import * as json from './stores/json/auditStore.js';
import * as mysql from './stores/mysql/auditStore.js';

function store() {
  return useMysqlStorage() ? mysql : json;
}

export function parseOs(ua) {
  return store().parseOs(ua);
}

export function parseBrowser(ua) {
  return store().parseBrowser(ua);
}

export function getClientIp(req) {
  return store().getClientIp(req);
}

export async function appendAudit(entry) {
  return store().appendAudit(entry);
}

export async function clearAuditLog() {
  return store().clearAuditLog();
}

export async function getAuditLog(opts) {
  return store().getAuditLog(opts);
}
