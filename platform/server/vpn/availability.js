import { isIP } from 'node:net';
import { availabilityTtl } from './availability-ui.js';

/** Выбирает только проверенные записи неизменной версии подписки и сохраняет отдельные идентификаторы одинаковых выходов. */
export function selectVerifiedProfiles(
  profiles,
  check,
  subscriptionId,
  fingerprint,
  now = Date.now()
) {
  const ids = new Set(profiles.map((p) => p.id));
  const results = check?.results || [];
  if (
    !check?.complete ||
    check.subscriptionId !== subscriptionId ||
    check.fingerprint !== fingerprint ||
    !Number.isFinite(check.checkedAt) ||
    check.checkedAt > now ||
    now - check.checkedAt > availabilityTtl ||
    results.length !== profiles.length ||
    new Set(results.map((r) => r.id)).size !== ids.size ||
    results.some(
      (r) =>
        !ids.has(r.id) ||
        !['ready', 'failed'].includes(r.status) ||
        (r.status === 'ready' && !isIP(r.ip || ''))
    )
  ) {
    throw Error(
      'Подписка: проверьте VPN на первом шаге. Нужна полная проверка этой версии и отпечатка не старше 15 минут.'
    );
  }
  const ready = new Map(results.filter((r) => r.status === 'ready').map((r) => [r.id, r.ip]));
  const selected = profiles.filter((p) => ready.has(p.id));
  if (!selected.length) {
    throw Error('Подписка: нет доступных VPN. Повторите проверку на первом шаге.');
  }
  return { profiles: selected, ips: Object.fromEntries(ready) };
}

/** Проверяет подписку отдельной задачей без возобновления k6; отменённая проверка не пригодна для допуска нагрузки. */
export async function checkSubscription(run, store, adapter, clock = { now: Date.now }) {
  const results = new Map();
  let progress = Promise.resolve();
  const summary = () => ({
    total: run.profiles.length,
    checked: results.size,
    ready: [...results.values()].filter((r) => r.status === 'ready').length,
    failed: [...results.values()].filter((r) => r.status === 'failed').length,
    complete: results.size === run.profiles.length,
    results: [...results.values()],
  });
  const cancelled = async () => {
    if (await store.cancelled(run.id)) {
      throw Object.assign(Error('cancelled'), { cancelled: true });
    }
  };
  let state = 'completed',
    reason = null;
  try {
    await cancelled();
    const capacity = Math.min(16, await adapter.probeCapacity(run));
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw Error('resources');
    }
    for (let offset = 0; offset < run.profiles.length; offset += capacity) {
      await cancelled();
      await adapter.inspectConnections(
        { ...run, profiles: run.profiles.slice(offset, offset + capacity) },
        (result) => {
          results.set(result.id, result);
          progress = progress.then(() => store.update(run.id, { connectionCheck: summary() }));
          return progress;
        },
        cancelled
      );
    }
    await progress;
    await cancelled();
    if (results.size !== run.profiles.length) {
      throw Error('incomplete');
    }
  } catch (error) {
    state = error.cancelled ? 'cancelled' : 'failed';
    reason = error.cancelled
      ? 'Проверка остановлена пользователем'
      : 'Не удалось полностью проверить подписку. Нагрузка не запускалась.';
  }
  return {
    state,
    reason,
    workers: [],
    finishedAt: clock.now(),
    connectionCheck: { ...summary(), complete: state === 'completed' && summary().complete },
  };
}
