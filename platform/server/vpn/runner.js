import { distribute } from './core.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { executeAvailableRun } from './scheduler.js';
import { availabilityTtl } from './availability-ui.js';

/** Дожидается подготовки всех записей; частично созданные контейнеры убираются даже при ошибке одного подключения. */
async function executeBatch(run, store, adapter, clock) {
  const workers = [];
  let progress = Promise.resolve();
  let phase = 'preparing';
  let failedPositions = [];
  let state = 'completed',
    reason = null,
    startAt = null;
  const cancelled = async () => {
    if (await store.cancelled(run.id)) {
      throw Object.assign(new Error(), { cancelled: true });
    }
  };
  try {
    await store.update(run.id, { state: 'preparing' });
    await cancelled();
    const budgets = distribute(run.load.budget, run.profiles.length);
    await adapter.preflight(run, budgets);
    if (adapter.beginBatch) {
      await adapter.beginBatch(run);
    }
    const prepared = [];
    for (let i = 0; i < run.profiles.length; i += 4) {
      await cancelled();
      const group = await Promise.allSettled(
        run.profiles.slice(i, i + 4).map(async (profile, index) => {
          const worker = await adapter.prepare(profile, budgets[i + index], run);
          workers.push(worker);
          progress = progress.then(() =>
            store.update(run.id, {
              preparedCount: workers.length,
              workers: workers.map((current) => ({
                id: current.id,
                ip: current.ip,
                status: 'preparing',
              })),
            })
          );
          await progress;
          return worker;
        })
      );
      prepared.push(...group);
      await store.update(run.id, {
        preparedCount: workers.length,
        workers: workers.map((worker) => ({ id: worker.id, ip: worker.ip, status: 'preparing' })),
      });
      if (group.some((result) => result.status === 'rejected')) {
        break;
      }
    }
    await cancelled();
    failedPositions = prepared.flatMap((x, i) =>
      x.status === 'rejected' ? [(run.profileOffset || 0) + i + 1] : []
    );
    if (failedPositions.length) {
      throw Error('prepare');
    }
    await cancelled();
    const ready = await Promise.all(workers.map((w) => adapter.ready(w)));
    if (ready.some((x) => !x)) {
      throw Error('prepare');
    }
    startAt = clock.now() + 2000;
    await store.update(run.id, { startAt, workers: workers.map((w) => ({ id: w.id, ip: w.ip })) });
    await clock.sleep(Math.max(0, startAt - clock.now()));
    await cancelled();
    phase = 'starting';
    await Promise.all(workers.map((w) => adapter.resume(w)));
    phase = 'running';
    await store.update(run.id, { state: 'running' });
    const deadline = startAt + (run.load.duration + 60) * 1000;
    let lastHealth = clock.now();
    while (true) {
      await cancelled();
      const statuses = await Promise.all(workers.map((w) => adapter.status(w)));
      if (statuses.some((s) => !s.running && s.exitCode !== 0)) {
        throw Error('worker');
      }
      if (statuses.every((s) => !s.running)) {
        break;
      }
      if (clock.now() - lastHealth >= 15000) {
        const running = workers.filter((_, i) => statuses[i].running);
        for (let i = 0; i < running.length; i += 8) {
          await Promise.all(running.slice(i, i + 8).map((w) => adapter.health(w)));
        }
        lastHealth = clock.now();
      }
      if (clock.now() > deadline) {
        throw Error('timeout');
      }
      await clock.sleep(3000);
    }
  } catch (error) {
    state = error.cancelled ? 'cancelled' : 'failed';
    const reasons = {
      resources: 'Недостаточно памяти для партии. Результаты завершённых партий сохранены.',
      images: 'Не найдены образы Xray или k6. Соберите и загрузите образы перед запуском.',
      timeout: 'Превышено время выполнения. Все воркеры остановлены.',
      worker: 'Один из k6 завершился с ошибкой. Все воркеры остановлены.',
    };
    reason = error.cancelled
      ? 'Остановлено пользователем'
      : reasons[error.message] ||
        (failedPositions.length
          ? `Не удалось подготовить подключения ${failedPositions.join(', ')}. Партия не запущена.`
          : phase === 'starting'
            ? 'Ошибка общего старта. Все воркеры остановлены.'
            : phase === 'running'
              ? 'Недоступен VPN-туннель или инфраструктура. Все воркеры остановлены.'
              : 'Не удалось подготовить все подключения. Нагрузка не запущена.');
  }
  let reports;
  try {
    if (adapter.stopAll) {
      await adapter.stopAll(run.id);
    }
    reports = await Promise.all(
      workers.map(async (w) => {
        try {
          return { id: w.id, ip: w.ip, ...(await adapter.collect(w)) };
        } catch {
          return { id: w.id, ip: w.ip, unavailable: true };
        }
      })
    );
    if (state === 'completed' && reports.some((r) => r.unavailable)) {
      state = 'failed';
      reason = 'Не удалось сохранить все итоговые отчёты';
    }
    await store.update(run.id, {
      workers: reports.map((report) => ({
        ...report,
        status: state === 'completed' ? 'completed' : 'interrupted',
      })),
    });
  } finally {
    await adapter.cleanup(run.id);
  }
  return {
    state,
    reason,
    startAt,
    finishedAt: clock.now(),
    workers: reports || [],
    connectionDiagnostics: [...(adapter.diagnosticCodes || [])],
    loadStarted: phase !== 'preparing',
    preparationFailures: failedPositions
      .map((position) => run.profiles[position - 1 - (run.profileOffset || 0)]?.id)
      .filter(Boolean),
  };
}

/** Ротирует подключения без повторного запуска нагрузки и сохраняет результаты каждой партии отдельно. */
export async function executeRun(run, store, adapter, clock = { now: Date.now, sleep }) {
  if (
    run.load.prechecked &&
    (!Number.isFinite(run.load.prechecked.checkedAt) ||
      clock.now() < run.load.prechecked.checkedAt ||
      clock.now() - run.load.prechecked.checkedAt > availabilityTtl)
  ) {
    return {
      state: 'failed',
      reason: 'Проверка VPN устарела в очереди. Повторите её на первом шаге.',
      workers: [],
      finishedAt: clock.now(),
    };
  }
  if (run.purpose === 'subscription-check') {
    const { checkSubscription } = await import('./availability.js');
    return checkSubscription(run, store, adapter, clock);
  }
  if (!run.load.prechecked && run.load.skipUnavailable !== false && adapter.inspectConnections) {
    return executeAvailableRun(run, store, adapter, clock, executeBatch);
  }
  const reports = [];
  if (await store.cancelled(run.id)) {
    return {
      state: 'cancelled',
      reason: 'Остановлено пользователем',
      workers: [],
      finishedAt: clock.now(),
    };
  }
  let capacity;
  try {
    capacity = Math.min(
      run.profiles.length,
      run.load.budget,
      adapter.capacity ? await adapter.capacity(run) : run.profiles.length
    );
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw Error('resources');
    }
  } catch (error) {
    return {
      state: 'failed',
      reason:
        error.message === 'images'
          ? 'Не найдены образы Xray или k6.'
          : error.message === 'cgroups'
            ? 'В ядре отключён контроль памяти cgroup. Docker не может ограничить RAM воркеров.'
            : 'Недостаточно памяти даже для одного подключения.',
      workers: [],
      finishedAt: clock.now(),
    };
  }
  let rotation = {
    capacity,
    batch: 0,
    totalBatches: Math.ceil(run.profiles.length / capacity),
    completed: 0,
    total: run.profiles.length,
    activeIds: [],
    durationPerConnection: run.load.duration,
  };
  let firstStart = null;
  for (let offset = 0; offset < run.profiles.length;) {
    if (offset && adapter.capacity) {
      try {
        capacity = Math.min(
          run.load.budget,
          run.profiles.length - offset,
          await adapter.capacity({ ...run, profiles: run.profiles.slice(offset) })
        );
        if (!Number.isInteger(capacity) || capacity < 1) {
          throw Error('resources');
        }
      } catch {
        return {
          state: 'failed',
          reason:
            'Недостаточно памяти даже для одного подключения следующей партии. Предыдущие результаты сохранены.',
          startAt: firstStart,
          finishedAt: clock.now(),
          rotation,
          workers: reports,
        };
      }
    }
    const remaining = run.profiles.length - offset;
    const batchSize = Math.ceil(remaining / Math.ceil(remaining / capacity));
    const profiles = run.profiles.slice(offset, offset + batchSize);
    rotation = {
      ...rotation,
      capacity,
      batch: rotation.batch + 1,
      totalBatches: rotation.batch + Math.ceil((run.profiles.length - offset) / capacity),
      activeIds: profiles.map((p) => p.id),
    };
    await store.update(run.id, { rotation: { ...rotation }, workers: [...reports] });
    const batchStore = {
      cancelled: (...args) => store.cancelled(...args),
      update: (id, patch) =>
        store.update(id, {
          ...patch,
          ...(patch.startAt
            ? { startAt: firstStart || patch.startAt, batchStartAt: patch.startAt }
            : {}),
          ...(patch.workers
            ? {
                workers: [
                  ...reports,
                  ...patch.workers.map((w) => ({ ...w, status: w.status || 'running' })),
                ],
              }
            : {}),
        }),
    };
    const result = await executeBatch(
      { ...run, profiles, profileOffset: offset },
      batchStore,
      adapter,
      clock
    );
    firstStart ||= result.startAt;
    const status = result.state === 'completed' ? 'completed' : 'interrupted';
    reports.push(...result.workers.map((w) => ({ ...w, status, batch: rotation.batch })));
    rotation = {
      ...rotation,
      completed: reports.filter((w) => w.status === 'completed').length,
      activeIds: [],
    };
    await store.update(run.id, { workers: [...reports], rotation: { ...rotation } });
    if (result.state !== 'completed') {
      return { ...result, startAt: firstStart, rotation, workers: reports };
    }
    offset += profiles.length;
  }
  return {
    state: 'completed',
    reason: null,
    startAt: firstStart,
    finishedAt: clock.now(),
    rotation,
    workers: reports,
  };
}
