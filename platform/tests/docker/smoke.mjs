import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import Docker from 'dockerode';

const base = process.env.LAB_URL || 'http://127.0.0.1:8080';
const socketPath = process.env.DOCKER_SOCKET || `${process.env.HOME}/.colima/default/docker.sock`;
const docker = new Docker({ socketPath });
let token;
async function api(path, body, key) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${response.status}: ${data.error}`);
  return data.data;
}

const password = readFileSync(
  new URL('../../../secrets/admin_password', import.meta.url),
  'utf8'
).trim();
token = (await api('/auth/login', { username: 'admin', password })).token;
if (process.env.BROWSER_STATE_FILE) writeFileSync(process.env.BROWSER_STATE_FILE, JSON.stringify({ cookies: [], origins: [{ origin: base, localStorage: [{ name: 'authToken', value: token }] }] }), { mode: 0o600 });
const subscription = await api('/vpn/subscriptions', {
  url: 'http://fixture-http:8080/subscription',
});
assert.equal(subscription.count, 4);
assert.equal(new Set(subscription.profiles.map((p) => p.id)).size, 4);
const scenario = await api('/vpn/scenarios', {
  name: 'Контейнерная проверка',
  kind: 'curl',
  request: { method: 'GET', url: 'http://fixture-http:8080/target', headers: {}, body: null },
});
const key = crypto.randomUUID();
const params = {
  subscriptionId: subscription.id,
  scenarioId: scenario.id,
  load: { mode: 'rps', budget: 12, duration: 20 },
};
const run = await api('/vpn/runs', params, key);
assert.equal((await api('/vpn/runs', params, key)).id, run.id);
const refreshed = await api(`/vpn/subscriptions/${subscription.id}/refresh`, {});
assert.notEqual(refreshed.id, subscription.id);
assert.deepEqual(
  (await api(`/vpn/runs/${run.id}`)).profiles.map((p) => p.id),
  subscription.profiles.map((p) => p.id)
);
let sawWorkers = false,
  report;
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  report = await api(`/vpn/runs/${run.id}`);
  if (report.state === 'running' && !sawWorkers) {
    const workers = (
      await docker.listContainers({
        filters: JSON.stringify({ label: [`io.inbound-lab.run=${run.id}`] }),
      })
    ).filter((c) => c.Names.some((n) => n.includes('-k6-')));
    assert.equal(workers.length, 4);
    const worker = docker.getContainer(workers[0].Id);
    const exec = await worker.exec({
      Cmd: [
        'curl',
        '-fsS',
        '--noproxy',
        '*',
        '--connect-timeout',
        '2',
        '--max-time',
        '3',
        'http://1.1.1.1',
      ],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({});
    stream.resume();
    await new Promise((resolve) => stream.on('end', resolve));
    assert.notEqual((await exec.inspect()).ExitCode, 0);
    sawWorkers = true;
  }
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(report.state)) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(report.state, 'completed', JSON.stringify(report));
assert.equal(sawWorkers, true);
assert.equal(report.workers.length, 4);
assert.ok(report.workers.every((w) => w.ip === '203.0.113.1' && w.requests > 0));
assert.ok(report.aggregate.requests >= 200 && report.aggregate.requests <= 280);
assert.equal(report.aggregate.thresholds.status, 'passed');
assert.equal(
  (
    await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`io.inbound-lab.run=${run.id}`] }),
    })
  ).length,
  0
);
console.log(
  JSON.stringify({
    state: report.state,
    inbounds: report.count,
    requests: report.aggregate.requests,
    thresholds: report.aggregate.thresholds.status,
    directEgressBlocked: true,
    idempotencyVerified: true,
  })
);

const failedRun = await api(
  '/vpn/runs',
  { ...params, load: { mode: 'rps', budget: 12, duration: 60 } },
  crypto.randomUUID()
);
let stoppedTunnel = false;
let tunnelFailureVerified = false;
const queued = await api(
  '/vpn/runs',
  { ...params, load: { mode: 'rps', budget: 12, duration: 60 } },
  crypto.randomUUID()
);
await api(`/vpn/runs/${queued.id}/stop`, {});
while (Date.now() < deadline + 120000) {
  const current = await api(`/vpn/runs/${failedRun.id}`);
  if (current.state === 'running' && !stoppedTunnel) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const containers = await docker.listContainers({
      filters: JSON.stringify({ label: [`io.inbound-lab.run=${failedRun.id}`] }),
    });
    const xray = containers.find((c) => c.Names.some((n) => n.includes('-xray-')));
    assert.ok(xray);
    await docker.getContainer(xray.Id).stop({ t: 1 });
    stoppedTunnel = true;
  }
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(current.state)) {
    assert.equal(current.state, 'failed');
    assert.equal(stoppedTunnel, true);
    assert.equal(current.workers.length, 4);
    assert.equal((await api(`/vpn/runs/${queued.id}`)).state, 'cancelled');
    tunnelFailureVerified = true;
    console.log(
      JSON.stringify({ tunnelLossStopsAll: true, partialReports: current.workers.length })
    );
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(tunnelFailureVerified, true, 'Tunnel failure was not observed before deadline');

const resourceRun = await api(
  '/vpn/runs',
  { ...params, load: { mode: 'vus', budget: 10000, duration: 1 } },
  crypto.randomUUID()
);
for (let attempt = 0; attempt < 30; attempt++) {
  const current = await api(`/vpn/runs/${resourceRun.id}`);
  if (current.state === 'failed') {
    assert.equal(
      (
        await docker.listContainers({
          all: true,
          filters: JSON.stringify({ label: [`io.inbound-lab.run=${resourceRun.id}`] }),
        })
      ).length,
      0
    );
    console.log(JSON.stringify({ resourceFailurePreventsPartialRun: true }));
    break;
  }
  assert.notEqual(current.state, 'running');
  if (attempt === 29) assert.fail('Resource rejection timed out');
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
