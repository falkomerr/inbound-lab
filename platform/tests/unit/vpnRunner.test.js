import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeRun } from '../../server/vpn/runner.js';
import {
  workerSpec,
  makeOptions,
  makeScenario,
  sharedXrayConfig,
  DockerAdapter,
  classifyXrayError,
} from '../../server/vpn/docker.js';
import { parseSubscription } from '../../server/vpn/core.js';

test('diagnostics retain only fixed categories even if Xray error includes secrets', () => {
  const codes = [
    classifyXrayError(
      'REALITY: invalid connection uuid=private-secret https://host.example/private-token'
    ),
    classifyXrayError('unrecognized error with private-secret'),
    classifyXrayError('x509 certificate validation failed for private-secret'),
  ];
  assert.deepEqual(codes, ['REALITY_AUTH', 'XRAY_ERROR', 'TLS_CERTIFICATE']);
  assert.ok(!JSON.stringify(codes).includes('private'));
});

test('shared Xray routes each of 200 independent proxies only to its assigned VPN', () => {
  const profiles = parseSubscription(
    Array(200)
      .fill('vless://11111111-1111-4111-8111-111111111111@vpn.example:443?security=none')
      .join('\n')
  );
  const config = sharedXrayConfig(profiles);
  assert.equal(new Set(config.inbounds.map((inbound) => inbound.port)).size, 200);
  for (const [index, profile] of profiles.entries()) {
    assert.equal(config.inbounds[index].tag, profile.id);
    assert.equal(config.routing.rules[index].outboundTag, profile.id);
    assert.equal(config.outbounds[index].tag, profile.id);
  }
  assert.ok(!config.outbounds.some((outbound) => outbound.protocol === 'freedom'));
});

test('explicit REALITY compatibility override keeps stored subscription and credentials intact', () => {
  const profiles = parseSubscription(
    'vless://11111111-1111-4111-8111-111111111111@vpn.example:443?security=reality&pbk=public-key&sni=example.org&fp=qq'
  );
  const original = JSON.stringify(profiles);
  const config = sharedXrayConfig(profiles, { realityFingerprint: 'firefox' });
  assert.equal(config.outbounds[0].streamSettings.realitySettings.fingerprint, 'firefox');
  assert.equal(config.outbounds[0].settings.vnext[0].users[0].id, profiles[0].uuid);
  assert.equal(JSON.stringify(profiles), original);
  assert.equal(
    sharedXrayConfig(profiles).outbounds[0].streamSettings.realitySettings.fingerprint,
    'qq'
  );
});

test('capacity accounts for active budget, shared process and memory before admission', async () => {
  const adapter = new DockerAdapter();
  adapter.availableMemory = async () => 250 * 1024 * 1024;
  const run = { profiles: Array(200).fill({}), load: { mode: 'rps', budget: 200 } };
  const count = await adapter.capacity(run);
  assert.ok(count > 0 && count < 200);
  await adapter.preflight(
    run,
    Array.from({ length: count }, (_, i) => Math.floor(200 / count) + Number(i < 200 % count))
  );
  adapter.availableMemory = async () => 100 * 1024 * 1024;
  await assert.rejects(adapter.capacity(run), /resources/);
});

test('health does not mistake a normally finishing k6 for a lost tunnel', async () => {
  const adapter = new DockerAdapter();
  let inspections = 0;
  const worker = {
    container: { inspect: async () => ({ State: { Running: ++inspections === 1, ExitCode: 0 } }) },
    xray: { inspect: async () => ({ State: { Running: true } }) },
  };
  adapter.probe = async () => {
    throw Error('container_exited');
  };
  await adapter.health(worker);
  worker.container.inspect = async () => ({ State: { Running: true, ExitCode: 0 } });
  await assert.rejects(adapter.health(worker), /container_exited/);
  worker.xray.inspect = async () => ({ State: { Running: false } });
  await assert.rejects(adapter.health(worker), /tunnel/);
});

test('stop tolerates a k6 that exits between list and stop while retaining real Docker errors', async () => {
  let statusCode = 304;
  const adapter = new DockerAdapter({
    docker: {
      getContainer: () => ({
        stop: async () => {
          throw Object.assign(Error('stop'), { statusCode });
        },
      }),
    },
  });
  adapter.owned = async () => [{ Id: 'k6', Names: ['/inbound-lab-k6-test'], State: 'running' }];
  await adapter.stopAll('run');
  statusCode = 500;
  await assert.rejects(adapter.stopAll('run'), /stop/);
});

function harness({ badPrepare = false, badHealth = false, cancel = false } = {}) {
  const calls = [];
  let cycle = 0;
  const adapter = {
    preflight: async () => calls.push('resources'),
    prepare: async (record, budget) => {
      calls.push(`prepare:${record.id}:${budget}`);
      if (badPrepare && record.id === 'b') {
        throw Error('secret-error');
      }
      return { id: record.id, ip: '203.0.113.1' };
    },
    ready: async () => true,
    resume: async (worker) => calls.push(`resume:${worker.id}`),
    health: async () => {
      if (badHealth) {
        throw Error('secret-error');
      }
      return true;
    },
    status: async () => ({ running: ++cycle < 3, exitCode: 0 }),
    collect: async (worker) => ({ id: worker.id, requests: 10, errors: 0 }),
    cleanup: async () => calls.push('cleanup'),
  };
  const store = { update: async (id, patch) => calls.push(patch), cancelled: async () => cancel };
  const run = {
    id: 'run',
    profiles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    load: { budget: 12, duration: 1 },
    scenario: {},
  };
  const clock = { sleep: async () => {}, now: () => Date.now() };
  return { calls, adapter, store, run, clock };
}

test('verified jobs do not inspect subscriptions again before load', async () => {
  const h = harness();
  h.run.load.prechecked = { checkedAt: Date.now(), ips: { a: '1.1.1.1' } };
  h.adapter.inspectConnections = () => assert.fail('subscription inspection repeated');
  assert.equal((await executeRun(h.run, h.store, h.adapter, h.clock)).state, 'completed');
});

test('a verified job waiting beyond the freshness limit cannot start load', async () => {
  const h = harness();
  h.run.load.prechecked = { checkedAt: Date.now() - 16 * 60000, ips: { a: '1.1.1.1' } };
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'failed');
  assert.match(result.reason, /устарела/);
  assert.ok(!h.calls.some((x) => typeof x === 'string' && x.startsWith('resume:')));
});

test('every inbound prepares before any resumes, with equal IPs allowed', async () => {
  const h = harness();
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'completed');
  assert.equal(h.calls.filter((x) => typeof x === 'string' && x.startsWith('resume:')).length, 4);
  const lastPrepare = h.calls.findLastIndex(
    (x) => typeof x === 'string' && x.startsWith('prepare:')
  );
  const firstResume = h.calls.findIndex((x) => typeof x === 'string' && x.startsWith('resume:'));
  assert.ok(lastPrepare < firstResume);
  assert.equal(result.workers.length, 4);
  assert.ok(h.calls.includes('cleanup'));
});

test('one preparation failure prevents all load and cleans up even partially created workers', async () => {
  const h = harness({ badPrepare: true });
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'failed');
  assert.ok(!JSON.stringify(result).includes('secret-error'));
  assert.ok(!h.calls.some((x) => typeof x === 'string' && x.startsWith('resume:')));
  assert.ok(h.calls.includes('cleanup'));
});

test('tunnel loss stops the whole run and preserves every partial report', async () => {
  const h = harness({ badHealth: true });
  let now = Date.now();
  h.clock.now = () => (now += 20000);
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'failed');
  assert.equal(result.workers.length, 4);
  assert.ok(h.calls.includes('cleanup'));
});

test('cancellation during preparation never resumes workers', async () => {
  const h = harness({ cancel: true });
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'cancelled');
  assert.ok(!h.calls.some((x) => typeof x === 'string' && x.startsWith('resume:')));
});

test('resource rejection reports the actual admission failure without creating workers', async () => {
  const h = harness();
  h.adapter.preflight = async () => {
    throw Error('resources');
  };
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'failed');
  assert.match(result.reason, /Недостаточно памяти/);
  assert.equal(result.workers.length, 0);
  assert.ok(!h.calls.some((x) => typeof x === 'string' && x.startsWith('prepare:')));
});

test('rotation visits every connection, persists completed batches and redistributes active budget', async () => {
  const h = harness();
  h.adapter.capacity = async () => 2;
  h.adapter.status = async () => ({ running: false, exitCode: 0 });
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'completed');
  assert.equal(result.workers.length, 4);
  assert.deepEqual(
    h.calls.filter((c) => typeof c === 'string' && c.startsWith('prepare:')),
    ['prepare:a:6', 'prepare:b:6', 'prepare:c:6', 'prepare:d:6']
  );
  const secondBatch = h.calls.indexOf('prepare:c:6');
  assert.ok(
    h.calls
      .slice(0, secondBatch)
      .some((c) => c?.workers?.filter((w) => w.status === 'completed').length === 2)
  );
  assert.ok(h.calls.slice(0, secondBatch).includes('cleanup'));
  assert.equal(result.rotation.completed, 4);
});

test('available mode reports every rejected VPN and runs only ready connections with redistributed budgets', async () => {
  const h = harness();
  h.adapter.capacity = async () => 2;
  h.adapter.probeCapacity = async () => 16;
  h.adapter.status = async () => ({ running: false, exitCode: 0 });
  h.adapter.inspectConnections = async (run, result) => {
    for (const profile of run.profiles) {
      await result({
        id: profile.id,
        status: profile.id === 'a' ? 'failed' : 'ready',
        ip: '203.0.113.1',
      });
    }
  };
  const report = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(report.state, 'completed');
  assert.equal(report.connectionCheck.checked, 4);
  assert.equal(report.connectionCheck.failed, 1);
  assert.equal(report.workers.length, 4);
  assert.equal(report.workers.find((worker) => worker.id === 'a').status, 'failed');
  assert.equal(report.rotation.completed, 3);
  assert.ok(!h.calls.includes('prepare:a:6'));
  assert.ok(h.calls.includes('prepare:b:6'));
  assert.ok(h.calls.includes('prepare:d:12'));
});

test('available mode fails clearly without load when all VPN checks fail', async () => {
  const h = harness();
  h.adapter.capacity = async () => 4;
  h.adapter.probeCapacity = async () => 16;
  h.adapter.inspectConnections = async (run, result) => {
    for (const profile of run.profiles) {
      await result({ id: profile.id, status: 'failed' });
    }
  };
  const report = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(report.state, 'failed');
  assert.equal(report.connectionCheck.failed, 4);
  assert.match(report.reason, /Ни одно VPN/);
  assert.ok(!h.calls.some((call) => typeof call === 'string' && call.startsWith('resume:')));
});

test('a failure in a later batch keeps earlier reports and never starts remaining connections', async () => {
  const h = harness();
  h.adapter.capacity = async () => 1;
  h.adapter.status = async () => ({ running: false, exitCode: 0 });
  const { prepare } = h.adapter;
  h.adapter.prepare = async (record, ...args) => {
    if (record.id === 'b') {
      throw Error('prepare');
    }
    return prepare(record, ...args);
  };
  const result = await executeRun(h.run, h.store, h.adapter, h.clock);
  assert.equal(result.state, 'failed');
  assert.equal(result.workers[0].id, 'a');
  assert.equal(result.workers[0].requests, 10);
  assert.ok(!h.calls.some((c) => typeof c === 'string' && c.startsWith('prepare:c:')));
});

test('worker has no external network, DNS, privileges or secret-bearing system tags', () => {
  const spec = workerSpec({
    name: 'worker',
    image: 'worker:local',
    network: 'isolated',
    volume: 'data',
    proxy: '172.20.0.2',
    metrics: '172.20.0.3',
    runId: 'r',
    inboundId: 'i',
  });
  assert.equal(spec.HostConfig.NetworkMode, 'isolated');
  assert.deepEqual(spec.HostConfig.Dns, ['127.0.0.1']);
  assert.deepEqual(spec.HostConfig.CapDrop, ['ALL']);
  assert.equal(spec.HostConfig.ReadonlyRootfs, true);
  assert.ok(spec.Env.includes('NO_PROXY=172.20.0.3'));
  assert.ok(!spec.Env.some((x) => x.startsWith('K6_SYSTEM_TAGS=') && x.includes('url')));
  assert.ok(!spec.Env.some((x) => /PASSWORD|SECRET|UUID/.test(x)));
  assert.ok(spec.Cmd.includes('run_id=r'));
  assert.ok(spec.Cmd.includes('inbound_id=i'));
  assert.ok(!spec.Env.some((x) => x.startsWith('K6_TAGS=')));
});

test('generated request has no redirect amplification and no credential tags', () => {
  const source = makeScenario({
    kind: 'curl',
    request: {
      method: 'POST',
      url: 'https://example.org',
      headers: { Authorization: 'secret' },
      body: 'value',
    },
  });
  assert.ok(source.includes('redirects: 0'));
  assert.ok(source.includes("name: 'request'"));
  const options = makeOptions({ mode: 'rps', duration: 60 }, 30);
  assert.equal(options.scenarios.load.rate, 30);
  assert.equal(options.scenarios.load.executor, 'constant-arrival-rate');
  assert.equal(options.scenarios.load.preAllocatedVUs, 1);
  assert.equal(options.scenarios.load.maxVUs, 20);
  assert.equal(makeOptions({ mode: 'vus', duration: 60 }, 5).scenarios.load.vus, 5);
});
