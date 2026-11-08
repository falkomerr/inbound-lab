/**
 * Application logger (Pino) — structured JSON in production, optional pretty stream in dev.
 *
 * Env:
 *   LOG_LEVEL     — trace | debug | info | warn | error | fatal (default: info prod, debug dev)
 *   LOG_PRETTY    — 0 = JSON in dev; unset/1 = colorized pretty in dev only (production is always JSON)
 *   NODE_ENV      — production → JSON logs by default
 *
 * Redacts common secret field names on any logged object (defense-in-depth).
 */
import 'dotenv/config';
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const defaultLevel = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// Pretty stream uses pino-pretty (devDependency) — never in production so `npm ci --omit=dev` still starts.
const usePretty = !isProd && (process.env.LOG_PRETTY === '1' || process.env.LOG_PRETTY !== '0');

const redact = {
  paths: [
    'req.headers.authorization',
    'password',
    '*.password',
    'token',
    '*.token',
    'body.token',
    'body.password',
    'authorization',
  ],
  censor: '[Redacted]',
};

const base = {
  level: defaultLevel,
  base: { service: 'fastertest-ui' },
  redact,
  serializers: {
    err: pino.stdSerializers.err,
  },
};

/** Root logger — use `logger.child({ reqId, ... })` for request-scoped logs */
export const logger = usePretty
  ? pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    })
  : pino(base);
