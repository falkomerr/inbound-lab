/**
 * Access-control store facade — MySQL when configured, JSON files otherwise.
 */

import { useMysqlStorage } from './db/config.js';
import * as json from './stores/json/accessControlStore.js';
import * as mysql from './stores/mysql/accessControlStore.js';

function store() {
  return useMysqlStorage() ? mysql : json;
}

export async function getGlobalLoginBan() {
  return store().getGlobalLoginBan();
}

export async function setGlobalLoginBan(enabled) {
  return store().setGlobalLoginBan(enabled);
}
