# Advanced features (CLI & utilities)

Features in this guide run **outside** the web UI unless noted. For UI behavior see
[UI_PANEL.md](../UI_PANEL.md) and [API.md](./API.md).

**Built-in k6 scenario in git:** `tests/scenarios/sample-http-get.js` only. CLI profiles
(`test:smoke`, `test:load`, …) reuse that file with different VUs/duration.

---

## Performance baselines ✅ (works today)

Compare current k6 JSON results to a saved baseline.

### Save baseline

```bash
npm run test:load          # or any run that writes reports/results.json
npm run baseline:save
```

### Compare

```bash
npm run test:load
npm run baseline:compare
```

Tolerance via env: `BASELINE_TOLERANCE=10 npm run baseline:compare`

### In code (k6 / Node utilities)

```javascript
import { saveBaseline, compareWithBaseline } from '../../utils/baselineHelper.js';
```

---

## HTML reports & analysis ✅

```bash
npm run report:html      # k6 run + HTML generator
npm run report:analyze   # analyze existing reports/results.json
npm run report:all       # both
```

Scripts: `scripts/generate-html-report.js`, `scripts/analyze-performance.js`

---

## InfluxDB output ⚠️ (bring your own InfluxDB)

```bash
npm run report:influxdb
```

Equivalent:

```bash
k6 run --out influxdb=http://localhost:8086/k6 tests/scenarios/sample-http-get.js
```

Helper for query strings: `utils/influxdbHelper.js`. No Influx container ships with this repo.

---

## Grafana ⚠️ (bring your own Grafana)

Configure Grafana to read from your k6 output backend, then:

```bash
k6 run --out grafana tests/scenarios/sample-http-get.js
```

Helper: `utils/grafanaHelper.js` (dashboard URL helpers). Not wired to the UI panel.

---

## WebSocket / gRPC / browser k6 scenarios ❌ (placeholders)

Helper modules exist under `utils/`, but **no scenario files** are shipped for:

| npm script               | Status                                           |
| ------------------------ | ------------------------------------------------ |
| `npm run test:websocket` | Exits until you add a scenario                   |
| `npm run test:grpc`      | Exits until you add a scenario + gRPC-capable k6 |
| `npm run test:browser`   | Exits until you add a browser scenario           |

To add one: create `tests/scenarios/your-test.js`, update `package.json`, or use **UI cURL import**.
Details: [ENTERPRISE_FEATURES.md](./ENTERPRISE_FEATURES.md).

---

## k6 Cloud (optional CLI)

```bash
npm run test:cloud
npm run report:cloud
```

Requires k6 Cloud credentials. Not integrated into the UI server.

---

## Node test suite (not k6)

```bash
npm test              # unit + integration (146 tests)
npm run test:coverage
npm run test:k6       # alias for test:smoke — real k6
```

---

## Best practices

1. **Baselines** — save after a known-good run per environment (`staging` / `production`).
2. **Reports** — set `REPORT_MAX_*` in `.env` on long-lived VMs.
3. **New scenarios** — prefer UI cURL import or copy `sample-http-get.js` structure.
4. **Do not assume** `test:websocket` / `test:grpc` / `test:browser` work without new files.

---

## References

- [k6 results visualization](https://k6.io/docs/results-output/)
- [docs/README.md](./README.md) — documentation map
