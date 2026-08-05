/**
 * Detect installed k6 binary version for health / startup diagnostics.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let cached = null;

/**
 * @returns {Promise<{ version: string | null, bin: string, source: string }>}
 */
export async function getK6Info() {
  if (cached) {
    return cached;
  }

  const bin = process.env.K6_BIN || 'k6';
  const fromEnv = process.env.K6_VERSION?.trim();

  try {
    const { stdout } = await execFileAsync(bin, ['version'], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    const text = String(stdout || '').trim();
    // Examples: "k6 v1.8.0 ..." or "k6.exe v1.8.0"
    const match = text.match(/\bv(\d+\.\d+\.\d+[^\s]*)/i);
    const next = {
      version: match ? match[1] : fromEnv || null,
      bin,
      source: match ? 'binary' : fromEnv ? 'env' : 'unknown',
      raw: text.split('\n')[0] || text,
    };
    // eslint-disable-next-line require-atomic-updates -- module-level cache after await is intentional
    cached = next;
    return next;
  } catch {
    const next = {
      version: fromEnv || null,
      bin,
      source: fromEnv ? 'env' : 'unavailable',
      raw: null,
    };
    cached = next;
    return next;
  }
}

/** Clear cache (tests). */
export function resetK6InfoCache() {
  cached = null;
}
