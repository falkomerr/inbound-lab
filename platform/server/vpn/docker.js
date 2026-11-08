import Docker from 'dockerode';
import tar from 'tar-stream';
import { PassThrough } from 'node:stream';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { xrayConfig, distribute } from './core.js';
import { createVariables, materializeRequest } from './request.js';

const MiB = 1024 * 1024;
const labels = (runId) => ({ 'io.inbound-lab.owner': 'inbound-lab', 'io.inbound-lab.run': runId });
const maxVus = (load, budget) =>
  load.mode === 'vus' ? budget : Math.min(load.maxVusPerWorker || 20, Math.max(2, budget));
const sharedMemory = (count) => (128 + count * 2) * MiB;

/** Возвращает только фиксированный код ошибки; адреса, UUID и исходная строка не сохраняются. */
export function classifyXrayError(message) {
  const rules = [
    [/MLKEM|key share/i, 'TLS_KEY_SHARE'],
    [/REALITY.*(?:invalid|failed|mismatch)/i, 'REALITY_AUTH'],
    [/fingerprint/i, 'TLS_FINGERPRINT'],
    [/x509|certificate/i, 'TLS_CERTIFICATE'],
    [/handshake|tls:/i, 'TLS_HANDSHAKE'],
    [/timeout|deadline/i, 'UPSTREAM_TIMEOUT'],
    [/refused|no route|network is unreachable/i, 'UPSTREAM_CONNECT'],
    [/reset|EOF|closed pipe/i, 'CONNECTION_CLOSED'],
  ];
  return rules.find(([pattern]) => pattern.test(message))?.[1] || 'XRAY_ERROR';
}
const estimatedMemory = (load, budgets) =>
  sharedMemory(budgets.length) +
  budgets.reduce((sum, budget) => sum + (16 + maxVus(load, budget) * 2) * MiB, 0);

/** Закрепляет каждый локальный прокси за отдельным VPN-outbound без прямого резервного маршрута. */
export function sharedXrayConfig(profiles, load = {}) {
  return {
    log: { loglevel: 'none' },
    inbounds: profiles.map((profile, index) => ({
      tag: profile.id,
      listen: '0.0.0.0',
      port: 10000 + index,
      protocol: 'http',
      settings: { allowTransparent: false },
    })),
    outbounds: [
      ...profiles.map((profile) => {
        const outbound = { ...xrayConfig(profile).outbounds[0], tag: profile.id };
        if (
          load.realityFingerprint &&
          load.realityFingerprint !== 'subscription' &&
          outbound.streamSettings?.security === 'reality'
        ) {
          outbound.streamSettings.realitySettings = {
            ...outbound.streamSettings.realitySettings,
            fingerprint: load.realityFingerprint,
          };
        }
        return outbound;
      }),
      { tag: 'blocked', protocol: 'blackhole', settings: {} },
    ],
    routing: {
      rules: [
        ...profiles.map((profile) => ({
          type: 'field',
          inboundTag: [profile.id],
          outboundTag: profile.id,
        })),
        { type: 'field', network: 'tcp,udp', outboundTag: 'blocked' },
      ],
    },
  };
}

export function makeOptions(load, budget) {
  const common = { duration: `${load.duration}s`, gracefulStop: '5s' };
  return {
    discardResponseBodies: true,
    scenarios: {
      load:
        load.mode === 'vus'
          ? { executor: 'constant-vus', vus: budget, ...common }
          : {
              executor: 'constant-arrival-rate',
              rate: budget,
              timeUnit: '1s',
              preAllocatedVUs: 1,
              maxVUs: maxVus(load, budget),
              ...common,
            },
    },
    summaryTrendStats: ['avg', 'min', 'max', 'p(90)', 'p(95)', 'p(99)'],
  };
}

export function makeScenario(scenario) {
  if (scenario.kind === 'js') {
    return scenario.source;
  }
  const r = scenario.request;
  const dynamic = r.cacheBust || /\{\{/.test(JSON.stringify(r));
  return `import http from 'k6/http';\n${dynamic ? `import { randomBytes } from 'k6/crypto';\n${createVariables.toString()}\n${materializeRequest.toString()}\n` : ''}const expectedCallback = ${r.expectedStatus ? `http.expectedStatuses(${r.expectedStatus})` : 'null'};\nexport default function() { const request = ${dynamic ? `materializeRequest(${JSON.stringify(r)}, createVariables(randomBytes(20), Date.now()))` : JSON.stringify(r)}; http.request(request.method, request.url, request.body, {headers: request.headers, redirects: 0, timeout: '30s', tags: {name: 'request'}, ...(expectedCallback ? {responseCallback: expectedCallback} : {})}); }\n`;
}

export function workerSpec({
  name,
  image,
  network,
  volume,
  proxy,
  metrics,
  runId,
  inboundId,
  proxyPort = 8080,
  memory = 256 * MiB,
}) {
  return {
    name,
    Image: image,
    User: '12345:12345',
    Labels: { ...labels(runId), 'io.inbound-lab.inbound': inboundId },
    Entrypoint: ['k6'],
    Cmd: [
      'run',
      '--paused',
      '--address',
      '0.0.0.0:6565',
      '--config',
      '/work/options.json',
      '--summary-export',
      '/work/summary.json',
      '--log-output=none',
      '--out',
      'experimental-prometheus-rw',
      '--tag',
      `run_id=${runId}`,
      '--tag',
      `inbound_id=${inboundId}`,
      '/work/scenario.js',
    ],
    Env: [
      `HTTP_PROXY=http://${proxy}:${proxyPort}`,
      `HTTPS_PROXY=http://${proxy}:${proxyPort}`,
      `NO_PROXY=${metrics}`,
      `K6_PROMETHEUS_RW_SERVER_URL=http://${metrics}:9090/api/v1/write`,
      'K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true',
      'K6_PROMETHEUS_RW_PUSH_INTERVAL=2s',
      'K6_PROMETHEUS_RW_STALE_MARKERS=true',
      'K6_SYSTEM_TAGS=status,method,scenario,expected_response,check',
      'K6_NO_USAGE_REPORT=true',
      'K6_SUMMARY_MODE=compact',
      'GOGC=50',
      'GOMAXPROCS=1',
      `GOMEMLIMIT=${Math.max(24, Math.floor(memory / MiB) - 16)}MiB`,
    ],
    HostConfig: {
      NetworkMode: network,
      Dns: ['127.0.0.1'],
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: memory,
      MemorySwap: memory,
      PidsLimit: 128,
      Binds: [`${volume}:/work:rw`],
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=16m,mode=1777' },
      LogConfig: { Type: 'none' },
      Sysctls: { 'net.ipv6.conf.all.disable_ipv6': '1' },
    },
  };
}

export async function archive(files) {
  const pack = tar.pack();
  const chunks = [];
  pack.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    pack.on('end', () => resolve(Buffer.concat(chunks)));
    pack.on('error', reject);
  });
  pack.entry({ name: '.', type: 'directory', mode: 0o700, uid: 12345, gid: 12345 });
  for (const [name, data] of Object.entries(files)) {
    pack.entry({ name, mode: 0o600, uid: 12345, gid: 12345 }, data);
  }
  pack.finalize();
  return done;
}

async function extractJson(stream, filename) {
  const extract = tar.extract();
  let found,
    bytes = 0;
  extract.on('entry', (header, entry, next) => {
    const chunks = [];
    entry.on('data', (c) => {
      bytes += c.length;
      if (bytes > 10 * MiB) {
        extract.destroy(Error('archive'));
      } else if (header.name === filename) {
        chunks.push(c);
      }
    });
    entry.on('end', () => {
      if (header.name === filename) {
        try {
          found = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          extract.destroy(Error('json'));
        }
      }
      next();
    });
    entry.resume();
  });
  await new Promise((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    stream.on('error', reject);
    stream.pipe(extract);
  });
  if (!found) {
    throw Error('summary');
  }
  return found;
}

export class DockerAdapter {
  constructor({
    docker = new Docker(),
    workerImage = process.env.VPN_WORKER_IMAGE || 'inbound-lab-worker:local',
    xrayImage = process.env.XRAY_IMAGE || 'ghcr.io/xtls/xray-core:26.10.21',
    prometheus = process.env.PROMETHEUS_CONTAINER || 'inbound-lab-prometheus',
    egress = process.env.VPN_EGRESS_NETWORK || 'inbound-lab-egress',
    probeUrl = process.env.VPN_PROBE_URL || 'https://api.ipify.org?format=json',
  } = {}) {
    Object.assign(this, { docker, workerImage, xrayImage, prometheus, egress, probeUrl });
  }

  async preflight(run, budgets) {
    const available = await this.availableMemory();
    if (estimatedMemory(run.load, budgets) > available) {
      throw Error('resources');
    }
  }

  async capacity(run) {
    const available = await this.availableMemory();
    let low = 1,
      high = Math.min(run.profiles.length, run.load.budget, 8191),
      best = 0;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      if (estimatedMemory(run.load, distribute(run.load.budget, count)) <= available) {
        best = count;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (!best) {
      throw Error('resources');
    }
    return best;
  }

  async probeCapacity() {
    return Math.max(0, Math.floor(((await this.availableMemory()) - 128 * MiB) / (20 * MiB)));
  }

  async inspectConnections(run, onResult, cancelled) {
    const inspection = {
      ...run,
      probeOnce: true,
      load: { ...run.load, mode: 'vus', budget: run.profiles.length, duration: 1 },
      scenario: {
        kind: 'curl',
        request: { method: 'GET', url: this.probeUrl, headers: {}, body: null },
      },
    };
    try {
      await this.preflight(
        inspection,
        run.profiles.map(() => 1)
      );
      await this.beginBatch(inspection);
      let index = 0;
      const inspect = async () => {
        while (index < run.profiles.length) {
          await cancelled();
          const profile = run.profiles[index++];
          let result;
          try {
            const worker = await this.prepare(profile, 1, inspection);
            result = { id: profile.id, ip: worker.ip, status: 'ready' };
          } catch {
            result = {
              id: profile.id,
              status: 'failed',
              connectionError: 'VPN не прошёл проверку внешнего IP',
            };
          }
          await onResult(result);
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(16, run.profiles.length) }, inspect)
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) {
        throw failure.reason;
      }
    } finally {
      await this.stopAll(run.id);
      await this.cleanup(run.id);
    }
  }

  async availableMemory() {
    try {
      await Promise.all([
        this.docker.getImage(this.workerImage).inspect(),
        this.docker.getImage(this.xrayImage).inspect(),
      ]);
    } catch {
      throw Error('images');
    }
    const info = await this.docker.info();
    if (info.MemoryLimit === false) {
      throw Error('cgroups');
    }
    const containers = await this.docker.listContainers();
    const usage = await Promise.all(
      containers.map(async (c) => {
        const stats = await this.docker.getContainer(c.Id).stats({ stream: false });
        return Math.max(
          0,
          (stats.memory_stats?.usage || 0) -
            (stats.memory_stats?.stats?.inactive_file ||
              stats.memory_stats?.stats?.total_inactive_file ||
              0)
        );
      })
    );
    return Math.max(
      0,
      info.MemTotal - usage.reduce((a, b) => a + b, 0) - Math.max(512 * MiB, info.MemTotal * 0.1)
    );
  }

  async beginBatch(run) {
    this.diagnosticCodes = new Set();
    const config = sharedXrayConfig(run.profiles, run.load);
    const diagnostics = process.env.VPN_DIAGNOSTICS === '1';
    if (diagnostics) {
      config.log = { loglevel: 'info' };
    }
    const volume = `inbound-lab-xray-${run.id}`;
    await this.docker.createVolume({ Name: volume, Labels: labels(run.id) });
    const seed = await this.docker.createContainer({
      Image: this.workerImage,
      Labels: labels(run.id),
      Entrypoint: ['true'],
      HostConfig: {
        NetworkMode: 'none',
        Binds: [`${volume}:/work:rw`],
        CapDrop: ['ALL'],
        ReadonlyRootfs: true,
      },
    });
    try {
      await seed.putArchive(await archive({ 'xray.json': JSON.stringify(config) }), {
        path: '/work',
      });
    } finally {
      await seed.remove({ force: true });
    }
    const xray = await this.docker.createContainer({
      name: `inbound-lab-xray-${run.id}`,
      Image: this.xrayImage,
      User: '12345:12345',
      Labels: labels(run.id),
      Entrypoint: ['xray'],
      Cmd: ['run', '-config', '/work/xray.json'],
      Env: [
        'GOGC=50',
        `GOMEMLIMIT=${Math.floor((sharedMemory(run.profiles.length) / MiB) * 0.8)}MiB`,
      ],
      HostConfig: {
        NetworkMode: this.egress,
        Binds: [`${volume}:/work:ro`],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Memory: sharedMemory(run.profiles.length),
        MemorySwap: sharedMemory(run.profiles.length),
        PidsLimit: 256,
        LogConfig: { Type: 'none' },
      },
    });
    if (diagnostics) {
      this.warningStream = await xray.attach({ stream: true, stdout: true, stderr: true });
      const output = new PassThrough();
      this.docker.modem.demuxStream(this.warningStream, output, output);
      output.on('data', (chunk) => {
        const message = chunk.toString('utf8');
        if (/warning|error|failed/i.test(message)) {
          this.diagnosticCodes.add(classifyXrayError(message));
        }
      });
      this.warningStream.on('error', () => {});
    }
    await xray.start();
    const prefix = process.env.VPN_WORKER_NETWORK_PREFIX || '10.240';
    if (
      !/^\d{1,3}\.\d{1,3}$/.test(prefix) ||
      prefix.split('.').some((part) => Number(part) > 255)
    ) {
      throw Error('network');
    }
    this.shared = {
      runId: run.id,
      xray,
      prefix,
      ports: new Map(run.profiles.map((p, index) => [p.id, 10000 + index])),
      indices: new Map(run.profiles.map((p, index) => [p.id, index + 1])),
    };
  }

  async command(container, cmd) {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      User: '12345:12345',
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const output = new PassThrough(),
      errors = new PassThrough();
    this.docker.modem.demuxStream(stream, output, errors);
    let result = '',
      size = 0;
    output.on('data', (c) => {
      size += c.length;
      if (size <= MiB) {
        result += c.toString();
      }
    });
    errors.resume();
    await new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const status = await exec.inspect();
    if (status.ExitCode !== 0 || size > MiB) {
      throw Error('command');
    }
    return result;
  }

  async prepare(profile, budget, run) {
    if (this.shared?.runId !== run.id || !this.shared.ports.has(profile.id)) {
      throw Error('prepare');
    }
    const subnetIndex = this.shared.indices.get(profile.id);
    const suffix = `${run.id.slice(0, 8)}-${profile.id.slice(0, 8)}`;
    const networkName = `inbound-lab-${suffix}`;
    const network = await this.docker.createNetwork({
      Name: networkName,
      Internal: true,
      EnableIPv6: false,
      IPAM: {
        Config: [
          {
            Subnet: `${this.shared.prefix}.${Math.floor(subnetIndex / 32)}.${(subnetIndex % 32) * 8}/29`,
          },
        ],
      },
      Labels: labels(run.id),
    });
    const volumeName = `inbound-lab-${suffix}`;
    await this.docker.createVolume({ Name: volumeName, Labels: labels(run.id) });
    const { xray } = this.shared;
    const proxyPort = this.shared.ports.get(profile.id);
    await network.connect({ Container: xray.id, EndpointConfig: { Aliases: ['proxy'] } });
    await network.connect({ Container: this.prometheus });
    const members = await network.inspect();
    const proxy = 'proxy';
    const prometheusId = (await this.docker.getContainer(this.prometheus).inspect()).Id;
    const metrics = members.Containers[prometheusId].IPv4Address.split('/')[0];
    const container = await this.docker.createContainer(
      workerSpec({
        name: `inbound-lab-k6-${suffix}`,
        image: this.workerImage,
        network: networkName,
        volume: volumeName,
        proxy,
        proxyPort,
        metrics,
        runId: run.id,
        inboundId: profile.id,
        memory: (64 + maxVus(run.load, budget) * 2) * MiB,
      })
    );
    await container.putArchive(
      await archive({
        'options.json': JSON.stringify(makeOptions(run.load, budget)),
        'scenario.js': makeScenario(run.scenario),
      }),
      { path: '/work' }
    );
    await container.start();
    const worker = { id: profile.id, container, xray, proxy, proxyPort, network: networkName };
    const deadline = Date.now() + 30000;
    let attempted = false;
    while (Date.now() < deadline) {
      try {
        await this.command(container, [
          'curl',
          '-fsS',
          '--max-time',
          '2',
          '--noproxy',
          '*',
          'http://127.0.0.1:6565/v1/status',
        ]);
        attempted = true;
        if (run.load.prechecked?.ips?.[profile.id]) {
          return { ...worker, ip: run.load.prechecked.ips[profile.id] };
        }
        const output = await this.probe(worker);
        let ip;
        try {
          ({ ip } = JSON.parse(output));
        } catch {
          ip = output.trim();
        }
        if (!isIP(ip)) {
          throw Error('ip');
        }
        return { ...worker, ip };
      } catch {
        if (run.probeOnce && attempted) {
          throw Error('prepare');
        }
        if (!(await container.inspect()).State.Running || !(await xray.inspect()).State.Running) {
          throw Error('prepare');
        }
        await sleep(1000);
      }
    }
    throw Error('prepare');
  }

  async probe(worker) {
    return this.command(worker.container, [
      'curl',
      '-fsS',
      '--connect-timeout',
      '3',
      '--max-time',
      '8',
      '--proxy',
      `http://${worker.proxy}:${worker.proxyPort || 8080}`,
      '--noproxy',
      '',
      this.probeUrl,
    ]);
  }

  async ready(worker) {
    const data = JSON.parse(
      await this.command(worker.container, [
        'curl',
        '-fsS',
        '--max-time',
        '3',
        '--noproxy',
        '*',
        'http://127.0.0.1:6565/v1/status',
      ])
    );
    return data.data.attributes.paused === true;
  }

  async resume(worker) {
    await this.command(worker.container, [
      'curl',
      '-fsS',
      '--max-time',
      '5',
      '--noproxy',
      '*',
      '-X',
      'PATCH',
      '-H',
      'Content-Type: application/json',
      '--data-raw',
      '{"data":{"type":"status","id":"default","attributes":{"paused":false}}}',
      'http://127.0.0.1:6565/v1/status',
    ]);
  }

  async status(worker) {
    const { State } = await worker.container.inspect();
    return { running: State.Running, exitCode: State.ExitCode, oom: State.OOMKilled };
  }

  async health(worker) {
    const finished = async () => {
      const { State } = await worker.container.inspect();
      return !State.Running && State.ExitCode === 0;
    };
    if (await finished()) {
      return;
    }
    if (!(await worker.xray.inspect()).State.Running) {
      throw Error('tunnel');
    }
    try {
      await this.probe(worker);
    } catch (error) {
      if (!(await finished())) {
        throw error;
      }
    }
  }

  async collect(worker) {
    const summary = await extractJson(
      await worker.container.getArchive({ path: '/work/summary.json' }),
      'summary.json'
    );
    const metrics = summary.metrics || {};
    const field = (name) => metrics[name]?.values || metrics[name] || {};
    return {
      requests: field('http_reqs').count || 0,
      errors: field('http_req_failed').passes || 0,
      errorRate: field('http_req_failed').value || field('http_req_failed').rate || 0,
      successful: Math.max(
        0,
        (field('http_reqs').count || 0) - (field('http_req_failed').passes || 0)
      ),
      checksPassed: field('checks').passes ?? null,
      checksFailed: field('checks').fails ?? null,
      iterations: field('iterations').count || 0,
      droppedIterations: field('dropped_iterations').count || 0,
      latency: field('http_req_duration'),
      summaryAvailable: true,
    };
  }

  async owned(runId) {
    return this.docker.listContainers({
      all: true,
      filters: JSON.stringify({
        label: Object.entries(labels(runId)).map(([k, v]) => `${k}=${v}`),
      }),
    });
  }

  async stopAll(runId) {
    const owned = await this.owned(runId);
    await Promise.all(
      owned
        .filter((c) => c.Names.some((n) => n.includes('-k6-')))
        .map(async (c) => {
          if (c.State === 'running') {
            await this.docker
              .getContainer(c.Id)
              .stop({ t: 10 })
              .catch((error) => {
                if (![304, 404].includes(error.statusCode)) {
                  throw error;
                }
              });
          }
        })
    );
  }

  async cleanup(runId) {
    const owned = await this.owned(runId);
    await Promise.all(
      owned.map((c) => this.docker.getContainer(c.Id).remove({ force: true, v: true }))
    );
    const networks = await this.docker.listNetworks({
      filters: JSON.stringify({
        label: Object.entries(labels(runId)).map(([k, v]) => `${k}=${v}`),
      }),
    });
    for (let i = 0; i < networks.length; i += 8) {
      await Promise.all(
        networks.slice(i, i + 8).map(async (network) => {
          await this.docker
            .getNetwork(network.Id)
            .disconnect({ Container: this.prometheus, Force: true })
            .catch(() => {});
          await this.docker.getNetwork(network.Id).remove();
        })
      );
    }
    const volumes = await this.docker.listVolumes({
      filters: JSON.stringify({
        label: Object.entries(labels(runId)).map(([k, v]) => `${k}=${v}`),
      }),
    });
    await Promise.all((volumes.Volumes || []).map((v) => this.docker.getVolume(v.Name).remove()));
    this.warningStream?.destroy();
    this.warningStream = null;
    if (this.shared?.runId === runId) {
      this.shared = null;
    }
  }
}
