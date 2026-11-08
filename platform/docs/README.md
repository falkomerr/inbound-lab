# Documentation index

Use this map to find the right guide. **Authoritative behavior** for the UI and API is always
[README.md](../README.md), [UI_PANEL.md](../UI_PANEL.md), and [API.md](./API.md).

## Start here

| Document                      | Use when                                               |
| ----------------------------- | ------------------------------------------------------ |
| [README.md](../README.md)     | Setup, CLI scripts, deploy, scenario list              |
| [UI_PANEL.md](../UI_PANEL.md) | Running tests from the browser, roles, troubleshooting |
| [API.md](./API.md)            | REST routes, WebSocket events, auth                    |

## k6 load testing

| Document                                           | Use when                                             |
| -------------------------------------------------- | ---------------------------------------------------- |
| [BEST_PRACTICES.md](./BEST_PRACTICES.md)           | Writing scenarios, thresholds, think time            |
| [ADVANCED_FEATURES.md](./ADVANCED_FEATURES.md)     | Baselines, HTML reports, InfluxDB/Grafana CLI output |
| [ENTERPRISE_FEATURES.md](./ENTERPRISE_FEATURES.md) | Optional protocol helpers (WebSocket, gRPC, browser) |

## Inventory & history (not marketing)

| Document                                               | Use when                                        |
| ------------------------------------------------------ | ----------------------------------------------- |
| [ENTERPRISE_COMPARISON.md](./ENTERPRISE_COMPARISON.md) | Feature matrix: shipped vs helpers vs not built |
| [IMPROVEMENTS.md](./IMPROVEMENTS.md)                   | Historical changelog of suite improvements      |

## What is actually shipped today

- **One built-in k6 scenario:** `tests/scenarios/sample-http-get.js`
- **Six CLI “profiles”** (smoke, load, stress, spike, soak, volume) = same script, different
  VUs/duration
- **UI cURL import** creates additional scenario files at runtime
- **`npm test`** = 146 Node unit/integration tests (no k6 required)
- **`npm run test:k6`** / `test:smoke` = real k6 run (k6 must be installed)

Scripts `test:websocket`, `test:grpc`, and `test:browser` are **placeholders** until you add
matching scenario files under `tests/scenarios/`.

**UI:** `npm run build:ui` bundles the dashboard for production (`public/dist/dashboard.js`);
`npm run ui` uses classic Vue/Chart vendor scripts in development.
