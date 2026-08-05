/**
 * Input Validation Middleware
 * Provides request validation for API endpoints
 * @module middleware/validation
 */

import { TEST_LIMITS, ENVIRONMENTS } from '../../utils/constants.js';

/** Same cap as validateTestId (URL param) — scenario slugs and cURL-generated names */
const MAX_TEST_ID_LENGTH = 100;

/**
 * Validate test start request
 */
export function validateStartTest(req, res, next) {
  const { testId, options } = req.body;

  // Validate testId
  if (!testId || typeof testId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'testId is required and must be a string',
    });
  }

  if (testId.length > MAX_TEST_ID_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `testId must be ${MAX_TEST_ID_LENGTH} characters or fewer`,
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(testId)) {
    return res.status(400).json({
      success: false,
      error: 'testId must contain only alphanumeric characters, hyphens, and underscores',
    });
  }

  // Validate options if provided
  if (options) {
    if (typeof options !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'options must be an object',
      });
    }

    // Validate environment
    if (options.environment) {
      const validEnvs = Object.values(ENVIRONMENTS);
      if (!validEnvs.includes(options.environment)) {
        return res.status(400).json({
          success: false,
          error: `environment must be one of: ${validEnvs.join(', ')}`,
        });
      }
    }

    // Validate VUs
    if (options.vus !== undefined) {
      const vus = parseInt(options.vus, 10);
      if (isNaN(vus) || vus < TEST_LIMITS.MIN_VUS || vus > TEST_LIMITS.MAX_VUS) {
        return res.status(400).json({
          success: false,
          error: `vus must be a number between ${TEST_LIMITS.MIN_VUS} and ${TEST_LIMITS.MAX_VUS}`,
        });
      }
      req.body.options.vus = vus;
    }

    // Validate duration format
    if (options.duration !== undefined) {
      if (typeof options.duration !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'duration must be a string (e.g., "30s", "5m", "1h")',
        });
      }

      const durationRegex = /^\d+[smh]$/;
      if (!durationRegex.test(options.duration)) {
        return res.status(400).json({
          success: false,
          error: 'duration must be in format: number + unit (s/m/h). Example: "30s", "5m", "1h"',
        });
      }

      // Validate duration doesn't exceed maximum
      const value = parseInt(options.duration, 10);
      const unit = options.duration.slice(-1);
      const hours = unit === 'h' ? value : unit === 'm' ? value / 60 : value / 3600;

      if (hours > TEST_LIMITS.MAX_DURATION_HOURS) {
        return res.status(400).json({
          success: false,
          error: `duration cannot exceed ${TEST_LIMITS.MAX_DURATION_HOURS} hours`,
        });
      }
    }

    // Validate customEnv if provided
    if (options.customEnv) {
      if (typeof options.customEnv !== 'object' || Array.isArray(options.customEnv)) {
        return res.status(400).json({
          success: false,
          error: 'customEnv must be a plain object',
        });
      }

      // SECURITY: Use an allowlist pattern — only safe env var names are permitted.
      // A blocklist is always incomplete; allowlist prevents LD_PRELOAD, NODE_OPTIONS,
      // DYLD_INSERT_LIBRARIES, and similar dangerous overrides.
      const SAFE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
      const BLOCKED_PREFIXES = ['LD_', 'DYLD_', 'NODE_', 'PYTHON', 'RUBY', 'PERL', 'PHP'];
      const BLOCKED_EXACT = [
        'PATH',
        'HOME',
        'USER',
        'SHELL',
        'IFS',
        'CDPATH',
        // Proxy vars — would redirect k6 traffic through attacker-controlled proxy
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'NO_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy',
        'no_proxy',
      ];
      const BLOCKED_PROXY_PREFIXES = ['PROXY', 'CURL_', 'GIT_', 'NPM_', 'PIP_'];

      for (const key of Object.keys(options.customEnv)) {
        if (!SAFE_KEY_PATTERN.test(key)) {
          return res.status(400).json({
            success: false,
            error: `customEnv key "${key}" is invalid. Keys must start with an uppercase letter and contain only A-Z, 0-9, and underscores (max 64 chars).`,
          });
        }
        if (
          BLOCKED_EXACT.includes(key) ||
          BLOCKED_PREFIXES.some((p) => key.startsWith(p)) ||
          BLOCKED_PROXY_PREFIXES.some((p) => key.startsWith(p))
        ) {
          return res.status(400).json({
            success: false,
            error: `customEnv key "${key}" is not allowed.`,
          });
        }
        const val = options.customEnv[key];
        if (typeof val !== 'string' && typeof val !== 'number') {
          return res.status(400).json({
            success: false,
            error: `customEnv value for "${key}" must be a string or number.`,
          });
        }
      }
    }
  }

  next();
}

/**
 * Validate history query parameters
 */
/**
 * Validate POST /api/tests/update-load — send **vus** and/or **duration** (at least one).
 * Omitted fields are merged from the active run on the server.
 */
export function validateUpdateLoad(req, res, next) {
  const { vus, duration } = req.body;

  const hasVus = vus !== undefined && vus !== null && vus !== '';
  const hasDur = duration !== undefined && duration !== null && String(duration).trim() !== '';

  if (!hasVus && !hasDur) {
    return res.status(400).json({
      success: false,
      error: 'Send at least one of vus or duration',
    });
  }

  if (hasVus) {
    const v = parseInt(vus, 10);
    if (isNaN(v) || v < TEST_LIMITS.MIN_VUS || v > TEST_LIMITS.MAX_VUS) {
      return res.status(400).json({
        success: false,
        error: `vus must be a number between ${TEST_LIMITS.MIN_VUS} and ${TEST_LIMITS.MAX_VUS}`,
      });
    }
    req.body.vus = v;
  }

  if (hasDur) {
    const d = String(duration).trim();
    const durationRegex = /^\d+[smh]$/;
    if (!durationRegex.test(d)) {
      return res.status(400).json({
        success: false,
        error: 'duration must be in format: number + unit (s/m/h). Example: "30s", "5m", "1h"',
      });
    }

    const value = parseInt(d, 10);
    const unit = d.slice(-1);
    const hours = unit === 'h' ? value : unit === 'm' ? value / 60 : value / 3600;

    if (hours > TEST_LIMITS.MAX_DURATION_HOURS) {
      return res.status(400).json({
        success: false,
        error: `duration cannot exceed ${TEST_LIMITS.MAX_DURATION_HOURS} hours`,
      });
    }
    req.body.duration = d;
  }

  next();
}

export function validateHistoryQuery(req, res, next) {
  if (req.query.limit !== undefined) {
    const limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1 || limit > TEST_LIMITS.MAX_TEST_HISTORY) {
      return res.status(400).json({
        success: false,
        error: `limit must be a number between 1 and ${TEST_LIMITS.MAX_TEST_HISTORY}`,
      });
    }
    req.query.limit = limit;
  }

  next();
}

/**
 * Validate test ID parameter
 */
export function validateTestId(req, res, next) {
  const { testId } = req.params;

  if (!testId || typeof testId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'testId is required and must be a string',
    });
  }

  if (testId.length > MAX_TEST_ID_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `testId must be ${MAX_TEST_ID_LENGTH} characters or fewer`,
    });
  }

  // Validate testId format (alphanumeric, hyphens, underscores)
  const testIdRegex = /^[a-zA-Z0-9_-]+$/;
  if (!testIdRegex.test(testId)) {
    return res.status(400).json({
      success: false,
      error: 'testId must contain only alphanumeric characters, hyphens, and underscores',
    });
  }

  next();
}

/**
 * Sanitize request body to prevent XSS and injection attacks
 */
export function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

/**
 * Recursively sanitize an object
 * @param {*} obj - Object to sanitize
 * @returns {*} Sanitized object
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
}

/**
 * Sanitize a string: remove null bytes and ASCII control characters only.
 *
 * SECURITY NOTE: We intentionally do NOT strip HTML/JS patterns here because:
 *  1. The API returns JSON — content is never rendered as raw HTML by the server.
 *  2. Vue.js escapes all interpolated values on the client, preventing XSS.
 *  3. Stripping tags/attributes would silently corrupt legitimate test payloads
 *     (e.g., request bodies that intentionally contain HTML or script content).
 * Content-Security-Policy headers are the correct server-side XSS control.
 *
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') {
    return str;
  }
  // Only remove null bytes and non-printable ASCII control characters
  // eslint-disable-next-line no-control-regex
  return str.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export default {
  validateStartTest,
  validateUpdateLoad,
  validateHistoryQuery,
  validateTestId,
  sanitizeBody,
};
