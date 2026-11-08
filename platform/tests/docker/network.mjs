import Docker from 'dockerode';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSubscription } from '../../server/vpn/core.js';
import { DockerAdapter } from '../../server/vpn/docker.js';
import { executeRun } from '../../server/vpn/runner.js';

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || `${process.env.HOME}/.colima/default/docker.sock`,
});
const fixtures = await docker.listContainers();
const collector = fixtures.find((c) => c.Names.some((n) => n.includes('fixture-http')));
assert.ok(collector);
const adapter = new DockerAdapter({ docker, probeUrl: 'http://fixture-http:8080/ip' });
if (process.env.FIXTURE_BATCH_SIZE) {
  const capacity = adapter.capacity.bind(adapter);
  adapter.capacity = async (run) => Math.min(Number(process.env.FIXTURE_BATCH_SIZE), await capacity(run));
}
let isolationChecked = false;
const ready = adapter.ready.bind(adapter);
adapter.ready = async (worker) => {
  if (!isolationChecked) {
    isolationChecked = true;
    await assert.rejects(
      adapter.command(worker.container, [
        'curl',
        '-fsS',
        '--max-time',
        '2',
        '--noproxy',
        '*',
        'http://1.1.1.1',
      ])
    );
    assert.equal(
      (
        await adapter.command(worker.container, ['cat', '/proc/sys/net/ipv6/conf/all/disable_ipv6'])
      ).trim(),
      '1'
    );
    await adapter.command(worker.container, ['nslookup', 'proxy', '127.0.0.11']);
    await assert.rejects(
      adapter.command(worker.container, ['timeout', '3', 'nslookup', 'example.org', '127.0.0.11'])
    );
  }
  return ready(worker);
};
for (const method of ['preflight', 'prepare']) {
  const original = adapter[method].bind(adapter);
  adapter[method] = async (...args) => {
    try {
      return await original(...args);
    } catch (error) {
      console.error(`${method}: ${error.message}`);
      throw error;
    }
  };
}
const run = {
  id: randomUUID(),
  profiles: parseSubscription(
    Array.from({ length: Number(process.env.FIXTURE_CONNECTIONS || 4) }, (_, index) => [10001, 10002, 10003, 10001][index % 4])
      .map(
        (port) =>
          `vless://11111111-1111-4111-8111-111111111111@fixture-xray:${port}?security=none&type=tcp`
      )
      .join('\n')
  ),
  load: { mode: 'rps', budget: Math.max(12, Number(process.env.FIXTURE_CONNECTIONS || 4)), duration: Number(process.env.FIXTURE_DURATION || 8) },
  scenario: {
    kind: 'curl',
    request: {
      method: 'GET',
      url: `http://fixture-http:8080/${process.env.FIXTURE_FAILURE ? 'failure' : 'target'}`,
      headers: {},
      body: null,
    },
  },
};
let memorySample;
const store = {
  update: async (id, patch) => {
    console.log(JSON.stringify({ state: patch.state || 'ready', workers: patch.workers?.length }));
    if (patch.state === 'running') {
      const containers = await adapter.owned(id);
      const usage = await Promise.all(containers.map(async (container) => {
        const stats = await docker.getContainer(container.Id).stats({ stream: false });
        return { xray: container.Names.some((name) => name.includes('-xray-')), bytes: (stats.memory_stats?.usage || 0) - (stats.memory_stats?.stats?.inactive_file || 0) };
      }));
      memorySample = { k6Count: usage.filter((c) => !c.xray).length, k6MiB: usage.filter((c) => !c.xray).reduce((sum, c) => sum + c.bytes, 0) / 1048576, xrayMiB: usage.filter((c) => c.xray).reduce((sum, c) => sum + c.bytes, 0) / 1048576 };
      console.log(JSON.stringify({ memorySample }));
    }
  },
  cancelled: async () => false,
};
const result = await executeRun(run, store, adapter);
writeFileSync('/tmp/inbound-lab-network-report.json', JSON.stringify(result));
assert.equal(result.state, 'completed', JSON.stringify({ reason: result.reason, count: result.workers.length }));
assert.equal(result.workers.length, run.profiles.length);
assert.ok(result.workers.every((w) => w.requests > 0));
if (process.env.FIXTURE_FAILURE)
  assert.ok(result.workers.every((w) => w.errors > 0 && w.errorRate === 1));
console.log(
  JSON.stringify({
    networkExecution: result.state,
    inbounds: result.workers.length,
    requests: result.workers.reduce((sum, w) => sum + w.requests, 0),
    isolationChecked,
    rotation: result.rotation,
    memorySample,
    metricsCollectorTested: false,
  })
);
