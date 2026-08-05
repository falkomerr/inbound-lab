/**
 * Password-reset store facade — MySQL when configured, JSON files otherwise.
 */

import { useMysqlStorage } from './db/config.js';
import * as json from './stores/json/resetStore.js';
import * as mysql from './stores/mysql/resetStore.js';

function store() {
  return useMysqlStorage() ? mysql : json;
}

export async function createReset(userId, username) {
  return store().createReset(userId, username);
}

export async function getResetByToken(token) {
  return store().getResetByToken(token);
}

export async function consumeReset(token) {
  return store().consumeReset(token);
}
