/**
 * Pure helpers usable in Node unit tests (no k6 dependency).
 * @module pureHelpers
 */

export function generateRandomString(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  if (ms < 3600000) {
    return `${(ms / 60000).toFixed(2)}m`;
  }
  return `${(ms / 3600000).toFixed(2)}h`;
}

export function calculatePercentile(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index] || 0;
}

export function validateResponse(response, schema) {
  try {
    const body = JSON.parse(response.body);
    for (const [key, type] of Object.entries(schema)) {
      if (!(key in body)) {
        return false;
      }
      if (type === 'array' && !Array.isArray(body[key])) {
        return false;
      }
      if (type === 'object' && typeof body[key] !== 'object') {
        return false;
      }
      if (type === 'string' && typeof body[key] !== 'string') {
        return false;
      }
      if (type === 'number' && typeof body[key] !== 'number') {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
