/**
 * WebSocket channel logs — Pino child with stable `event` field for log agents.
 *
 * Env:
 *   WS_LOG=silent | 0 | off  — mute routine subscribe / normal close (warn+error still emit)
 */
import { logger } from './logger.js';

const ROUTINE_MUTED =
  process.env.WS_LOG === 'silent' || process.env.WS_LOG === '0' || process.env.WS_LOG === 'off';

const wsLogger = logger.child({ channel: 'websocket' });

/** Routine lifecycle (subscribe, clean disconnect) */
export function wsRoutine(event, fields = {}) {
  if (ROUTINE_MUTED) {
    return;
  }
  wsLogger.info({ event, ...fields }, event);
}

/** Handshake failures, capacity, parse errors, abnormal close */
export function wsWarn(event, fields = {}) {
  wsLogger.warn({ event, ...fields }, event);
}

export function wsError(event, fields = {}) {
  wsLogger.error({ event, ...fields }, event);
}
