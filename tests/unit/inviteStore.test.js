/**
 * Invite store unit tests
 * @module tests/unit/inviteStore
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithIsolatedData } from '../helpers/isolatedData.js';

describe('inviteStore', () => {
  /** @type {() => void} */
  let cleanup;

  beforeEach(() => {
    delete process.env.ALLOWED_EMAIL_DOMAIN;
  });

  after(() => {
    if (cleanup) {
      cleanup();
    }
    delete process.env.B2B_TEST_DATA_DIR;
    delete process.env.ALLOWED_EMAIL_DOMAIN;
  });

  async function invites() {
    const { mod, cleanup: removeDir } = await loadWithIsolatedData(
      '../../server/stores/json/inviteStore.js'
    );
    cleanup = removeDir;
    return mod;
  }

  it('creates invite for any email when domain is not restricted', async () => {
    const { createInvite } = await invites();
    const invite = createInvite('new.hire@example.com', 'developer', 'admin');
    assert.equal(invite.email, 'new.hire@example.com');
    assert.equal(invite.role, 'developer');
    assert.equal(invite.used, false);
    assert.ok(invite.token.length >= 32);
    assert.ok(invite.expiresAt);

    const gmail = createInvite('user@gmail.com', 'developer');
    assert.equal(gmail.email, 'user@gmail.com');
  });

  it('rejects emails outside ALLOWED_EMAIL_DOMAIN when set', async () => {
    process.env.ALLOWED_EMAIL_DOMAIN = 'example.com';
    const { createInvite } = await invites();
    assert.throws(() => createInvite('user@gmail.com', 'developer'), /@example\.com/);
    const ok = createInvite('ok@example.com', 'qa');
    assert.equal(ok.email, 'ok@example.com');
  });

  it('replaces pending invite for the same email', async () => {
    const { createInvite, getAllInvites } = await invites();
    const first = createInvite('repeat@example.com', 'qa');
    const second = createInvite('repeat@example.com', 'developer');
    assert.notEqual(first.token, second.token);
    const pending = getAllInvites();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].role, 'developer');
  });

  it('getInviteByToken returns null for unknown or consumed tokens', async () => {
    const { createInvite, getInviteByToken, consumeInvite } = await invites();
    const invite = createInvite('consume@example.com', 'pm');
    assert.ok(getInviteByToken(invite.token));

    consumeInvite(invite.token);
    assert.equal(getInviteByToken(invite.token), null);
    assert.equal(getInviteByToken('not-a-real-token'), null);
  });

  it('peekInviteByToken reports active, used, and missing states', async () => {
    const { createInvite, consumeInvite, peekInviteByToken } = await invites();
    const invite = createInvite('peek@example.com', 'developer');

    assert.equal(peekInviteByToken(invite.token).status, 'active');
    consumeInvite(invite.token);
    assert.equal(peekInviteByToken(invite.token).status, 'used');
    assert.equal(peekInviteByToken('missing').status, 'missing');
  });

  it('revokeInvite removes pending invite', async () => {
    const { createInvite, revokeInvite, getAllInvites } = await invites();
    const invite = createInvite('revoke@example.com', 'qa');
    const revoked = revokeInvite(invite.token);
    assert.equal(revoked.email, 'revoke@example.com');
    assert.equal(getAllInvites().length, 0);
  });
});
