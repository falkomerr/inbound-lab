#!/usr/bin/env node
/**
 * Minimal k6 stand-in for unit/integration tests.
 * Writes NDJSON + summary files and exits (or on SIGTERM).
 */

import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
if (args[0] !== 'run') {
  console.error('fake-k6: expected "run" subcommand');
  process.exit(1);
}

let jsonPath = null;
let summaryPath = null;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === '--out' && args[i + 1]?.startsWith('json=')) {
    jsonPath = args[i + 1].slice(5);
    i += 1;
  } else if (a.startsWith('--out=json=')) {
    jsonPath = a.slice('--out=json='.length);
  } else if (a === '--summary-export') {
    summaryPath = args[i + 1];
    i += 1;
  }
}

function writeOutputs() {
  const metricLine = `${JSON.stringify({
    type: 'Point',
    data: {
      time: new Date().toISOString(),
      value: 1,
      metric: 'http_reqs',
    },
  })}\n`;
  if (jsonPath) {
    writeFileSync(jsonPath, metricLine);
  }
  if (summaryPath) {
    writeFileSync(summaryPath, JSON.stringify({ metrics: { http_reqs: { count: 1 } } }));
  }
}

function shutdown(code) {
  writeOutputs();
  process.exit(code);
}

process.stdout.write('     execution: local\n     script: fake-k6\n');
process.on('SIGTERM', () => shutdown(143));
process.on('SIGINT', () => shutdown(130));

const delay = Number(process.env.FAKE_K6_DELAY_MS || '80');
setTimeout(() => shutdown(0), delay);
