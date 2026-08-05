/**
 * ESM apiClient — used by Vite production bundle only.
 */
export const API_BASE = '/api';

export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    location.replace('/login');
    return res;
  }
  return res;
}

export const PAUSED_RESUME_IDLE_MS = 5 * 60 * 1000;

export function isTerminalPauseStopError(err) {
  return (
    err === 'Test stopped by user' ||
    (typeof err === 'string' && err.includes('stopped by user')) ||
    err === 'Paused session expired after 5 minutes.'
  );
}

window.API_BASE = API_BASE;
window.apiFetch = apiFetch;
window.PAUSED_RESUME_IDLE_MS = PAUSED_RESUME_IDLE_MS;
window.isTerminalPauseStopError = isTerminalPauseStopError;
