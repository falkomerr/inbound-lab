import 'dotenv/config';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from 'redis';
import { initStorage, getPool, closePool } from '../db/index.js';
import { VpnStore } from './store.js';
import { DockerAdapter } from './docker.js';
import { executeRun } from './runner.js';
import { Metrics } from './metrics.js';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

async function main() {
  await initStorage();
  const store = new VpnStore();
  await store.init();
  const adapter = new DockerAdapter();
  const metrics = new Metrics();
  const lock = await getPool().getConnection();
  const [[owner]] = await lock.query("SELECT GET_LOCK('inbound-lab-orchestrator',0) AS acquired");
  if (owner.acquired !== 1) {
    throw Error('orchestrator_exists');
  }
  const [[connection]] = await lock.query('SELECT CONNECTION_ID() AS id');
  const ownership = async () => {
    const [[row]] = await lock.query("SELECT IS_USED_LOCK('inbound-lab-orchestrator') AS id");
    if (row.id !== connection.id) {
      throw Error('ownership_lost');
    }
  };
  const queue = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
    disableOfflineQueue: true,
    socket: { connectTimeout: 3000 },
  });
  queue.on('error', () => {});
  void queue.connect().catch(() => {});
  let active = null;
  try {
    const staleIds = new Set(await store.active());
    const containers = await adapter.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: ['io.inbound-lab.owner=inbound-lab'] }),
    });
    for (const c of containers) {
      staleIds.add(c.Labels['io.inbound-lab.run']);
    }
    for (const id of staleIds) {
      await adapter.stopAll(id);
      const previous = await store.run(id).catch(() => null);
      const partial = [
        ...(previous?.workers || []).filter((worker) =>
          ['completed', 'failed'].includes(worker.status)
        ),
      ];
      for (const c of await adapter.owned(id)) {
        if (c.Names.some((n) => n.includes('-k6-'))) {
          if (
            partial.some((worker) => worker.id && worker.id === c.Labels['io.inbound-lab.inbound'])
          ) {
            continue;
          }
          try {
            partial.push({
              id: c.Labels['io.inbound-lab.inbound'],
              ...(await adapter.collect({ container: adapter.docker.getContainer(c.Id) })),
              recovered: true,
              status: 'interrupted',
            });
          } catch {
            partial.push({ unavailable: true });
          }
        }
      }
      await store
        .update(id, {
          state: 'interrupted',
          reason: 'Orchestrator перезапущен. Нагрузка не повторялась.',
          workers: partial,
          ...(previous?.rotation
            ? {
                rotation: {
                  ...previous.rotation,
                  activeIds: [],
                  completed: partial.filter((worker) => worker.status === 'completed').length,
                },
              }
            : {}),
        })
        .catch(() => {});
      await adapter.cleanup(id);
    }
    while (!stopping) {
      await ownership();
      if (!queue.isReady) {
        await sleep(1000);
        continue;
      }
      try {
        await queue.xGroupCreate('vpn:runs', 'orchestrator', '0', { MKSTREAM: true });
      } catch (e) {
        if (!e.message.includes('BUSYGROUP')) {
          throw e;
        }
      }
      for (const id of await store.pending()) {
        await queue.xAdd(
          'vpn:runs',
          '*',
          { id },
          { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 1000 } }
        );
      }
      const entries = await queue.xReadGroup(
        'orchestrator',
        hostname(),
        { key: 'vpn:runs', id: '>' },
        { COUNT: 1, BLOCK: 1000 }
      );
      for (const entry of entries || []) {
        for (const message of entry.messages) {
          const { id } = message.message;
          await ownership();
          if (!(await store.claim(id))) {
            await queue.xAck('vpn:runs', 'orchestrator', message.id);
            continue;
          }
          active = id;
          const run = await store.run(id, true);
          const guarded = {
            update: async (...args) => {
              await ownership();
              return store.update(...args);
            },
            cancelled: async (key) => {
              await ownership();
              return stopping || store.cancelled(key);
            },
          };
          await guarded.update(id, { runtime: { xrayImage: adapter.xrayImage } });
          const report = await executeRun(run, guarded, adapter);
          if (stopping) {
            report.state = 'interrupted';
            report.reason = 'Orchestrator остановлен. Нагрузка не повторялась.';
          }
          if (run.purpose === 'subscription-check' && report.state === 'completed') {
            await ownership();
            await store.save({
              kind: 'availability',
              groupId: run.subscriptionId,
              metadata: {
                subscriptionId: run.subscriptionId,
                fingerprint: run.load.realityFingerprint,
                checkedAt: report.finishedAt,
                ...report.connectionCheck,
              },
              payload: {},
            });
          }
          const aggregate = await metrics.evaluate(run, report);
          try {
            const samples = await metrics.live(id);
            report.workers = report.workers.map((worker) => {
              const sample = samples.find((s) => s.id === worker.id);
              return sample?.requests === worker.requests ? { ...sample, ...worker } : worker;
            });
          } catch {
            report.liveMetricsUnavailable = true;
          }
          await ownership();
          await store.update(id, { ...report, aggregate });
          active = null;
          if (queue.isReady) {
            await queue.xAck('vpn:runs', 'orchestrator', message.id);
          }
        }
      }
      await store.prune();
    }
  } finally {
    if (active) {
      await adapter.stopAll(active);
      await adapter.cleanup(active);
    }
    if (queue.isOpen) {
      queue.destroy();
    }
    await lock.query("SELECT RELEASE_LOCK('inbound-lab-orchestrator')").catch(() => {});
    lock.release();
    await closePool();
  }
}

main().catch(() => {
  console.error(
    'Orchestrator остановлен из-за ошибки инфраструктуры. Секретные данные исключены из сообщения.'
  );
  process.exitCode = 1;
});
