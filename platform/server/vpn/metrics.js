export function workerCounters(samples) {
  const workers = {};
  for (const sample of samples) {
    const id = sample.metric.inbound_id,
      count = Number(sample.value?.[1]);
    if (!id || !Number.isFinite(count)) {
      continue;
    }
    const worker = (workers[id] ||= {
      id,
      requests: 0,
      successful: 0,
      httpErrors: 0,
      networkErrors: 0,
      errors: 0,
    });
    worker.requests += count;
    if (sample.metric.status === '0') {
      worker.networkErrors += count;
    } else if (sample.metric.expected_response === 'true') {
      worker.successful += count;
    } else {
      worker.httpErrors += count;
    }
    worker.errors = worker.httpErrors + worker.networkErrors;
  }
  return workers;
}

export class Metrics {
  constructor(base = process.env.PROMETHEUS_URL || 'http://prometheus:9090') {
    this.base = base;
  }

  async query(query) {
    const url = new URL('/api/v1/query', this.base);
    url.searchParams.set('query', query);
    const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw Error('metrics');
    }
    const data = await response.json();
    if (data.status !== 'success') {
      throw Error('metrics');
    }
    return data.data.result;
  }

  async live(id) {
    if (!/^[\w-]+$/.test(id)) {
      throw Error('id');
    }
    const select = `{run_id="${id}"}`;
    const [rate, requests, p95, checks] = await Promise.all([
      this.query(`sum by (inbound_id) (rate(k6_http_reqs_total${select}[15s]))`),
      this.query(
        `sum by (inbound_id,status,expected_response) (last_over_time(k6_http_reqs_total${select}[24h]))`
      ),
      this.query(
        `histogram_quantile(0.95, sum by (inbound_id) (last_over_time(k6_http_req_duration_seconds${select}[24h]))) * 1000`
      ),
      this.query(`last_over_time(k6_checks_rate${select}[24h])`),
    ]);
    const workers = workerCounters(requests);
    for (const [field, values] of [
      ['rps', rate],
      ['p95', p95],
    ]) {
      for (const item of values) {
        const key = item.metric.inbound_id;
        if (key) {
          (workers[key] ||= { id: key })[field] = Number.isFinite(Number(item.value[1]))
            ? Number(item.value[1])
            : null;
        }
      }
    }
    for (const sample of checks) {
      const id = sample.metric.inbound_id;
      if (!id) {
        continue;
      }
      const worker = (workers[id] ||= { id });
      (worker.checks ||= []).push({
        name: sample.metric.check || 'Проверка',
        successRate: Number(sample.value[1]),
      });
    }
    return Object.values(workers);
  }

  async evaluate(run, report) {
    const requests = report.workers.reduce((sum, w) => sum + (w.requests || 0), 0);
    const errors = report.workers.reduce((sum, w) => sum + (w.errors || 0), 0);
    const errorRate = requests ? errors / requests : null;
    let p95 = null;
    try {
      const values = await this.query(
        `histogram_quantile(0.95, sum(last_over_time(k6_http_req_duration_seconds{run_id="${run.id}"}[24h]))) * 1000`
      );
      const value = Number(values[0]?.value?.[1]);
      if (Number.isFinite(value)) {
        p95 = value;
      }
    } catch {
      p95 = null;
    }
    return {
      requests,
      successful: requests - errors,
      errors,
      errorRate,
      p95,
      thresholds: {
        status:
          p95 === null || errorRate === null
            ? 'unavailable'
            : errorRate <= run.load.maxErrorRate && p95 <= run.load.maxP95
              ? 'passed'
              : 'failed',
        maxErrorRate: run.load.maxErrorRate,
        maxP95: run.load.maxP95,
      },
    };
  }
}
