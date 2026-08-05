/**
 * Optional email domain restriction for invites and user emails.
 * Set ALLOWED_EMAIL_DOMAIN=example.com to require @example.com addresses.
 * Leave unset to allow any valid email (recommended for open-source installs).
 */

export function getAllowedEmailDomain() {
  const raw = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
  return raw.replace(/^@/, '');
}

/**
 * @param {string} email
 * @returns {boolean}
 */
export function isEmailAllowed(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const domain = getAllowedEmailDomain();
  if (!domain) {
    return email.includes('@');
  }
  return email.toLowerCase().endsWith(`@${domain}`);
}

/**
 * @param {string} email
 * @throws {Error}
 */
export function assertEmailAllowed(email) {
  const domain = getAllowedEmailDomain();
  if (!domain) {
    return;
  }
  if (!isEmailAllowed(email)) {
    throw new Error(`Email must be a @${domain} address`);
  }
}
