/**
 * User store unit tests (isolated temp data directory)
 * @module tests/unit/userStore
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithIsolatedData } from '../helpers/isolatedData.js';

describe('userStore', () => {
  /** @type {() => void} */
  let cleanup;

  after(() => {
    if (cleanup) {
      cleanup();
    }
    delete process.env.B2B_TEST_DATA_DIR;
  });

  async function store() {
    const { mod, cleanup: removeDir } = await loadWithIsolatedData('../../server/userStore.js');
    cleanup = removeDir;
    return mod;
  }

  describe('omitPassword', () => {
    it('removes password hash without mutating the original object', async () => {
      const { omitPassword } = await store();
      const raw = { id: '1', username: 'alice', password: '$2a$10$hash' };
      const safe = omitPassword(raw);
      assert.equal('password' in safe, false);
      assert.equal('password' in raw, true);
      assert.equal(safe.username, 'alice');
    });
  });

  describe('createUser', () => {
    it('persists bcrypt hash and returns user without password', async () => {
      const { createUser, findByUsername } = await store();
      const created = await createUser('alice', 'SecretPass1!', 'developer', 'alice@example.com');
      assert.equal('password' in created, false);
      assert.equal(created.username, 'alice');
      assert.equal(created.role, 'developer');
      assert.equal(created.banned, false);
      assert.equal(created.tokenVersion, 1);

      const onDisk = findByUsername('alice');
      assert.ok(onDisk);
      assert.equal(typeof onDisk.password, 'string');
      assert.ok(onDisk.password.startsWith('$2'));
    });

    it('rejects duplicate username', async () => {
      const { createUser } = await store();
      await createUser('bob', 'SecretPass1!', 'qa');
      await assert.rejects(() => createUser('bob', 'OtherPass2!', 'qa'), /already exists/);
    });

    it('rejects duplicate email', async () => {
      const { createUser } = await store();
      await createUser('user1', 'SecretPass1!', 'qa', 'same@example.com');
      await assert.rejects(
        () => createUser('user2', 'SecretPass1!', 'qa', 'same@example.com'),
        /already exists/
      );
    });
  });

  describe('verifyPassword', () => {
    it('returns user without password on valid credentials', async () => {
      const { createUser, verifyPassword } = await store();
      await createUser('carol', 'MyPass123!', 'developer');
      const user = await verifyPassword('carol', 'MyPass123!');
      assert.ok(user);
      assert.equal('password' in user, false);
      assert.equal(user.username, 'carol');
    });

    it('returns null for wrong password or unknown user', async () => {
      const { createUser, verifyPassword } = await store();
      await createUser('dave', 'MyPass123!', 'developer');
      assert.equal(await verifyPassword('dave', 'wrong'), null);
      assert.equal(await verifyPassword('nobody', 'MyPass123!'), null);
    });
  });

  describe('getAllUsers / findById', () => {
    it('applies defaults for legacy-shaped records and strips passwords', async () => {
      const { createUser, getAllUsers, findById } = await store();
      const created = await createUser('eve', 'MyPass123!', 'pm');
      const all = getAllUsers();
      assert.equal(all.length, 1);
      assert.equal('password' in all[0], false);
      assert.deepEqual(all[0].permissions, { teams: [], modes: [] });

      const byId = findById(created.id);
      assert.ok(byId);
      assert.equal(byId.username, 'eve');
    });

    it('forces admin banned flag to false in listings', async () => {
      const { createUser, getAllUsers, setUserBanned } = await store();
      const admin = await createUser('admin1', 'AdminPass1!', 'admin');
      assert.throws(() => setUserBanned(admin.id, true), /cannot be suspended/);
      const listed = getAllUsers().find((u) => u.id === admin.id);
      assert.equal(listed.banned, false);
    });
  });

  describe('bumpTokenVersion', () => {
    it('increments tokenVersion and invalidates prior JWT version', async () => {
      const { createUser, bumpTokenVersion, findById } = await store();
      const user = await createUser('frank', 'MyPass123!', 'developer');
      assert.equal(user.tokenVersion, 1);
      const bumped = bumpTokenVersion(user.id);
      assert.equal(bumped.tokenVersion, 2);
      assert.equal(findById(user.id).tokenVersion, 2);
    });
  });

  describe('setUserBanned / banAllNonAdminUsers', () => {
    it('suspends non-admin and blocks admin suspension', async () => {
      const { createUser, setUserBanned, findById } = await store();
      const dev = await createUser('grace', 'MyPass123!', 'developer');
      const admin = await createUser('root', 'AdminPass1!', 'admin');

      const banned = setUserBanned(dev.id, true);
      assert.equal(banned.banned, true);
      assert.equal(findById(dev.id).banned, true);

      assert.throws(() => setUserBanned(admin.id, true), /cannot be suspended/);
    });

    it('banAllNonAdminUsers suspends every non-admin account', async () => {
      const { createUser, banAllNonAdminUsers, getAllUsers } = await store();
      await createUser('hank', 'MyPass123!', 'developer');
      await createUser('root2', 'AdminPass1!', 'admin');
      const { bannedCount } = banAllNonAdminUsers();
      assert.equal(bannedCount, 1);
      const users = getAllUsers();
      assert.equal(users.find((u) => u.username === 'hank').banned, true);
      assert.equal(users.find((u) => u.username === 'root2').banned, false);
    });

    it('unbanAllUsers clears banned flags', async () => {
      const { createUser, setUserBanned, unbanAllUsers, findById } = await store();
      const user = await createUser('iris', 'MyPass123!', 'qa');
      setUserBanned(user.id, true);
      const { unbannedCount } = unbanAllUsers();
      assert.equal(unbannedCount, 1);
      assert.equal(findById(user.id).banned, false);
    });
  });

  describe('updateUser', () => {
    it('updates role and bumps tokenVersion', async () => {
      const { createUser, updateUser, findById } = await store();
      const user = await createUser('jack', 'MyPass123!', 'developer');
      const updated = await updateUser(user.id, { role: 'tech-lead' });
      assert.equal(updated.role, 'tech-lead');
      assert.equal(updated.tokenVersion, 2);
      assert.equal(findById(user.id).role, 'tech-lead');
    });

    it('rejects invalid role', async () => {
      const { createUser, updateUser } = await store();
      const user = await createUser('kate', 'MyPass123!', 'developer');
      await assert.rejects(() => updateUser(user.id, { role: 'superuser' }), /Invalid role/);
    });

    it('coerces legacy string banned values', async () => {
      const { createUser, updateUser } = await store();
      const user = await createUser('leo', 'MyPass123!', 'developer');
      const banned = await updateUser(user.id, { banned: 'true' });
      assert.equal(banned.banned, true);
      const cleared = await updateUser(user.id, { banned: 'false' });
      assert.equal(cleared.banned, false);
    });
  });

  describe('deleteUser', () => {
    it('removes user but protects the last admin', async () => {
      const { createUser, deleteUser, findByUsername, getAllUsers } = await store();
      const admin = await createUser('solo-admin', 'AdminPass1!', 'admin');
      const dev = await createUser('mike', 'MyPass123!', 'developer');

      deleteUser(dev.id);
      assert.equal(findByUsername('mike'), null);

      assert.throws(() => deleteUser(admin.id), /last admin/);
      assert.equal(getAllUsers().length, 1);
    });
  });
});
