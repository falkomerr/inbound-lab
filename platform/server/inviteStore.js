/**
 * Invite store facade — MySQL when configured, JSON files otherwise.
 */

import { useMysqlStorage } from './db/config.js';
import * as json from './stores/json/inviteStore.js';
import * as mysql from './stores/mysql/inviteStore.js';

function store() {
  return useMysqlStorage() ? mysql : json;
}

export async function getAllInvites() {
  return store().getAllInvites();
}

export async function createInvite(...args) {
  return store().createInvite(...args);
}

export async function getInviteByToken(token) {
  return store().getInviteByToken(token);
}

export async function peekInviteByToken(token) {
  return store().peekInviteByToken(token);
}

export async function consumeInvite(token) {
  return store().consumeInvite(token);
}

export async function revokeInvite(token) {
  return store().revokeInvite(token);
}
