import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.LAB_URL || 'http://127.0.0.1:8080';
const state = JSON.parse(readFileSync(new URL('../../../secrets/browser-state.json', import.meta.url), 'utf8'));
const token = state.origins.find(origin => origin.origin === base).localStorage.find(item => item.name === 'authToken').value;
async function api(path, body) {
  const response = await fetch(`${base}/api/vpn${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, data.error);
  return data.data;
}

const subscription = (await api('/subscriptions'))[0];
const scenario = await api('/scenarios', { name: 'JS checks отдельно от HTTP', kind: 'js', source: "import http from 'k6/http'; import { check } from 'k6'; export default function() { const response = http.get('http://fixture-http:8080/target'); check(response, { 'expected 500': r => r.status === 500 }); }" });
const run = await api('/runs', { subscriptionId: subscription.id, scenarioId: scenario.id, load: { mode: 'iterations', budget: 8, duration: 12 } });
let liveVerified = false, report;
for (let attempt = 0; attempt < 60; attempt++) {
  report = await api(`/runs/${run.id}`);
  if (report.state === 'running') {
    const live = await api(`/runs/${run.id}/metrics`);
    if (live.length === 4 && live.every(w => w.requests > 0 && w.successful === w.requests && w.checks?.some(c => c.name === 'expected 500' && c.successRate === 0))) liveVerified = true;
  }
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(report.state)) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
assert.equal(report.state, 'completed');
assert.equal(liveVerified, true);
assert.equal(report.aggregate.errors, 0);
assert.ok(report.workers.every(w => w.successful > 0 && w.checksFailed > 0 && w.checksPassed === 0));
console.log(JSON.stringify({ jsChecksSeparateFromHttpSuccess: true, liveChecksVerified: true, workers: report.workers.length }));
