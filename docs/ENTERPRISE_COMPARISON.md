# Feature inventory

**Purpose:** Accurate checklist of what this repository includes. It does **not** compare feature
parity with Amazon, Microsoft, Netflix, or other companies.

Last aligned with repo layout: one built-in scenario, UI cURL import, 146 Node tests.

---

## Platform (UI + server)

| Feature                              | Status     | Where                                            |
| ------------------------------------ | ---------- | ------------------------------------------------ |
| Web dashboard                        | ✅ Shipped | `public/`, `UI_PANEL.md`                         |
| JWT login + RBAC                     | ✅ Shipped | `server/routes/api.js`, `docs/API.md`            |
| User invites (optional email domain) | ✅ Shipped | `server/inviteStore.js` + `ALLOWED_EMAIL_DOMAIN` |
| Password reset links                 | ✅ Shipped | `server/resetStore.js`                           |
| Admin audit log (cap 5000)           | ✅ Shipped | `server/auditStore.js`                           |
| Global / per-user ban                | ✅ Shipped | `server/accessControlStore.js`                   |
| Live metrics WebSocket               | ✅ Shipped | `server/index.js` (`?token=`)                    |
| k6 child process control             | ✅ Shipped | `server/testManager.js`                          |
| cURL → k6 script import              | ✅ Shipped | UI + `POST /api/tests/curl`                      |
| Health probe                         | ✅ Shipped | `GET /api/health`                                |
| VM deploy (systemd/nginx)            | ✅ Shipped | `deploy/`                                        |

---

## k6 scenarios & CLI

| Feature                             | Status         | Notes                                               |
| ----------------------------------- | -------------- | --------------------------------------------------- |
| Built-in scenario in git            | ✅ **1 file**  | `tests/scenarios/sample-http-get.js`                |
| Load profiles (smoke/load/stress/…) | ✅ Same script | Different `npm run test:*` VU/duration              |
| Extra scenarios                     | ⚠️ Manual / UI | Add `.js` under `tests/scenarios/` or cURL import   |
| `test:websocket`                    | ❌ Placeholder | Exits until `tests/scenarios/*websocket*.js` exists |
| `test:grpc`                         | ❌ Placeholder | Exits until a gRPC scenario exists                  |
| `test:browser`                      | ❌ Placeholder | Exits until a browser scenario exists               |
| k6 Cloud                            | ⚠️ Script only | `npm run test:cloud` — not integrated in UI         |

---

## k6 utilities (`utils/`)

| Module                                      | Status         | Used by shipped scenario?                |
| ------------------------------------------- | -------------- | ---------------------------------------- |
| `helpers.js`, `metrics.js`, `authHelper.js` | ✅             | Yes (CE login)                           |
| `responseValidator.js`, `requestBuilder.js` | ✅             | Yes / shared                             |
| `baselineHelper.js`                         | ✅             | CLI `baseline:save` / `baseline:compare` |
| `performanceAnalyzer.js`, `logger.js`       | ✅             | Reports / scripts                        |
| `websocketHelper.js`                        | ⚠️ Helper only | Needs a WS k6 scenario                   |
| `grpcHelper.js`                             | ⚠️ Helper only | Needs xk6-grpc + scenario                |
| `browserHelper.js`                          | ⚠️ Helper only | Needs xk6-browser + scenario             |
| `grafanaHelper.js`, `influxdbHelper.js`     | ⚠️ Helper only | Optional `k6 run --out …`                |

---

## Reporting & analysis

| Feature                     | Status         | Command / path                               |
| --------------------------- | -------------- | -------------------------------------------- |
| k6 JSON / summary export    | ✅             | UI run → `reports/`                          |
| HTML report generator       | ✅             | `npm run report:html`                        |
| Performance analysis script | ✅             | `npm run report:analyze`                     |
| Report disk retention       | ✅             | `REPORT_*` env + `reportRetention.js`        |
| Grafana live dashboard      | ❌ Not bundled | Bring your own Grafana + `k6 run --out`      |
| InfluxDB stack              | ❌ Not bundled | `npm run report:influxdb` needs local Influx |

---

## Testing (Node, not k6)

| Feature                                    | Status         |
| ------------------------------------------ | -------------- |
| Unit tests (stores, parsers, testManager)  | ✅             |
| API integration tests                      | ✅             |
| WebSocket auth integration tests           | ✅             |
| UI static smoke tests (Vue mustache guard) | ✅             |
| Playwright / browser E2E                   | ❌ Not in repo |

---

## Summary

| Category        | Shipped           | Helpers / partial  | Not built               |
| --------------- | ----------------- | ------------------ | ----------------------- |
| Platform UI/API | 11                | —                  | —                       |
| k6 scenarios    | 1                 | cURL import        | WS/gRPC/browser scripts |
| Observability   | HTML/JSON reports | Influx/Grafana CLI | Managed dashboards      |
| Automated tests | 146 Node tests    | —                  | k6 in CI, E2E           |

**Verdict:** Production-ready **internal load-test control plane** on a single VM. Expand scenario
coverage and observability as your teams need them — do not assume multi-protocol or multi-region
testing is already implemented.
