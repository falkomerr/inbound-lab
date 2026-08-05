/**
 * User store facade — MySQL when configured, JSON files otherwise.
 */

import { useMysqlStorage } from './db/config.js';
import * as json from './stores/json/userStore.js';
import * as mysql from './stores/mysql/userStore.js';

function store() {
  return useMysqlStorage() ? mysql : json;
}

export function omitPassword(user) {
  return store().omitPassword(user);
}

export async function getAllUsers() {
  return store().getAllUsers();
}

export async function findByUsername(username) {
  return store().findByUsername(username);
}

export async function findById(id) {
  return store().findById(id);
}

export async function createUser(...args) {
  return store().createUser(...args);
}

export async function bumpTokenVersion(id) {
  return store().bumpTokenVersion(id);
}

export async function setUserBanned(id, wantBan) {
  return store().setUserBanned(id, wantBan);
}

export async function updateUser(id, updates) {
  return store().updateUser(id, updates);
}

export async function deleteUser(id) {
  return store().deleteUser(id);
}

export async function verifyPassword(username, password) {
  return store().verifyPassword(username, password);
}

export async function banAllNonAdminUsers() {
  return store().banAllNonAdminUsers();
}

export async function unbanAllUsers() {
  return store().unbanAllUsers();
}
