#!/usr/bin/env node
/**
 * Create the first admin user when the user store is empty.
 * Usage: node scripts/seed-admin.js [username] [password]
 */
import 'dotenv/config';
import { initStorage } from '../server/db/index.js';
import { createUser, getAllUsers } from '../server/userStore.js';

const username = process.argv[2] || process.env.ADMIN_USERNAME || 'admin';
const password = process.argv[3] || process.env.ADMIN_PASSWORD;

async function main() {
  await initStorage();
  const users = await getAllUsers();
  if (users.length > 0) {
    console.log(`Users already exist (${users.length}). Skipping seed.`);
    process.exit(0);
  }
  if (!password || password.length < 8) {
    console.error(
      'Usage: node scripts/seed-admin.js <username> <password>\nPassword must be at least 8 characters with upper, digit, and special char.'
    );
    process.exit(1);
  }
  await createUser(
    username,
    password,
    'admin',
    '',
    { teams: [], modes: [] },
    { enabled: false, maxVus: 1000, maxDurationMinutes: 1440 }
  );
  console.log(`Admin user "${username}" created. Log in at your APP_BASE_URL.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
