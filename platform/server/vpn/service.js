import { createClient } from 'redis';
import { VpnStore } from './store.js';
import { Metrics } from './metrics.js';

export async function vpnService() {
  const store = new VpnStore();
  await store.init();
  const metrics = new Metrics();
  const queue = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
    disableOfflineQueue: true,
    socket: { connectTimeout: 3000 },
  });
  queue.on('error', () => {});
  void queue.connect().catch(() => {});
  return {
    store,
    metrics: (id) => metrics.live(id),
    notify: async (id) => {
      if (!queue.isReady) {
        return;
      }
      await queue.xAdd(
        'vpn:runs',
        '*',
        { id },
        { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 1000 } }
      );
    },
    close: () => {
      if (queue.isOpen) {
        queue.destroy();
      }
    },
  };
}
