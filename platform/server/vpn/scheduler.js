function interleave(profiles) {
  const groups = new Map();
  for (const profile of profiles) {
    const key = profile.outbound?.protocol || 'vless';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(profile);
  }
  const result = [];
  for (let index = 0; result.length < profiles.length; index++) {
    for (const group of groups.values()) {
      if (group[index]) {
        result.push(group[index]);
      }
    }
  }
  return result;
}

/** Проверяет все записи окна, сохраняет отказы и запускает нагрузку только через готовые VPN. */
export async function executeAvailableRun(run, store, adapter, clock, executeBatch) {
  const reports = new Map(),
    checked = new Map();
  let startAt = null,
    batchNumber = 0,
    progress = Promise.resolve();
  const connectionCheck = () => ({
    total: run.profiles.length,
    checked: checked.size,
    ready: [...checked.values()].filter((result) => result.status === 'ready').length,
    failed: [...checked.values()].filter((result) => result.status === 'failed').length,
    complete: checked.size === run.profiles.length,
    results: [...checked.values()],
  });
  const workers = () => [...reports.values()];
  const cancelled = async () => {
    if (await store.cancelled(run.id)) {
      throw Object.assign(Error('cancelled'), { cancelled: true });
    }
  };
  let rotation = {
    capacity: 0,
    batch: 0,
    completed: 0,
    activeIds: [],
    durationPerConnection: run.load.duration,
  };
  const finish = (state, reason = null) => ({
    state,
    reason,
    startAt,
    finishedAt: clock.now(),
    workers: workers(),
    connectionCheck: connectionCheck(),
    rotation: { ...rotation, activeIds: [] },
  });
  try {
    await cancelled();
    const capacity = Math.min(run.load.budget, await adapter.capacity(run));
    const windowSize = Math.min(Math.max(capacity, 16), await adapter.probeCapacity(run));
    if (
      !Number.isInteger(capacity) ||
      !Number.isInteger(windowSize) ||
      capacity < 1 ||
      windowSize < 1
    ) {
      throw Error('resources');
    }
    const ordered = interleave(run.profiles);
    for (let offset = 0; offset < ordered.length; offset += windowSize) {
      await cancelled();
      await store.update(run.id, {
        state: 'preparing',
        preparedCount: 0,
        rotation: { ...rotation, activeIds: [] },
      });
      const window = ordered.slice(offset, offset + windowSize);
      const onResult = (result) => {
        checked.set(result.id, result);
        if (result.status === 'failed') {
          reports.set(result.id, {
            ...result,
            requests: 0,
            successful: 0,
            errors: 0,
            loadStarted: false,
          });
        }
        progress = progress.then(() =>
          store.update(run.id, { connectionCheck: connectionCheck(), workers: workers() })
        );
        return progress;
      };
      await adapter.inspectConnections({ ...run, profiles: window }, onResult, cancelled);
      let ready = window.filter((profile) => checked.get(profile.id)?.status === 'ready');
      while (ready.length) {
        await cancelled();
        const count = Math.min(
          ready.length,
          run.load.budget,
          await adapter.capacity({ ...run, profiles: ready })
        );
        const profiles = ready.slice(0, count);
        batchNumber++;
        rotation = {
          ...rotation,
          capacity: count,
          batch: batchNumber,
          totalBatches: batchNumber + Math.ceil((ready.length - count) / capacity),
          eligible: connectionCheck().ready,
          completed: workers().filter((worker) => worker.status === 'completed').length,
          activeIds: profiles.map((profile) => profile.id),
        };
        await store.update(run.id, {
          rotation,
          connectionCheck: connectionCheck(),
          workers: workers(),
        });
        const batchStore = {
          cancelled: (...args) => store.cancelled(...args),
          update: (id, patch) =>
            store.update(id, {
              ...patch,
              ...(patch.startAt
                ? { startAt: startAt || patch.startAt, batchStartAt: patch.startAt }
                : {}),
              ...(patch.workers ? { workers: [...workers(), ...patch.workers] } : {}),
            }),
        };
        const result = await executeBatch({ ...run, profiles }, batchStore, adapter, clock);
        if (
          result.state === 'failed' &&
          !result.loadStarted &&
          result.preparationFailures?.length
        ) {
          for (const id of result.preparationFailures) {
            const failed = {
              id,
              status: 'failed',
              connectionError: 'VPN недоступен при подготовке нагрузки',
            };
            checked.set(id, failed);
            reports.set(id, {
              ...failed,
              requests: 0,
              successful: 0,
              errors: 0,
              loadStarted: false,
            });
          }
          ready = ready.filter((profile) => !result.preparationFailures.includes(profile.id));
          await store.update(run.id, { workers: workers(), connectionCheck: connectionCheck() });
          continue;
        }
        startAt ||= result.startAt;
        for (const worker of result.workers) {
          reports.set(worker.id, {
            ...worker,
            status: result.state === 'completed' ? 'completed' : 'interrupted',
            batch: batchNumber,
          });
        }
        rotation = {
          ...rotation,
          activeIds: [],
          completed: workers().filter((worker) => worker.status === 'completed').length,
        };
        await store.update(run.id, {
          workers: workers(),
          rotation,
          connectionCheck: connectionCheck(),
        });
        if (result.state !== 'completed') {
          return {
            ...finish(result.state, result.reason),
            connectionDiagnostics: result.connectionDiagnostics,
          };
        }
        ready = ready.slice(count);
      }
    }
    return rotation.completed
      ? finish('completed')
      : finish(
          'failed',
          'Ни одно VPN-подключение не прошло проверку. Нагрузочные запросы не отправлялись.'
        );
  } catch (error) {
    return finish(
      error.cancelled ? 'cancelled' : 'failed',
      error.cancelled
        ? 'Остановлено пользователем'
        : error.message === 'cgroups'
          ? 'В ядре отключён контроль памяти cgroup.'
          : error.message === 'resources'
            ? 'Недостаточно памяти для подготовки подключений.'
            : 'Техническая ошибка проверки VPN. Частичные результаты сохранены.'
    );
  }
}
