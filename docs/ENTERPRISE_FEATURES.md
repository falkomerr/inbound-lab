# Optional k6 protocols & utilities

This guide describes **helper modules** for WebSocket, gRPC, and browser testing. They are intended
for **new k6 scenario files** you add under `tests/scenarios/`.

> **Important:** There is **no** shipped WebSocket, gRPC, or browser scenario in git today.  
> `npm run test:websocket`, `test:grpc`, and `test:browser` **exit with an error** until you create
> those scenarios (or import tests via the UI cURL flow).  
> See [README.md](../README.md#test-scenarios) and
> [ENTERPRISE_COMPARISON.md](./ENTERPRISE_COMPARISON.md).

The **platform WebSocket** (`server/index.js`) is for **live UI metrics**, not for load-testing your
product’s WebSocket API — that uses k6’s `k6/ws` via `utils/websocketHelper.js` inside a scenario.

---

## Adding a new scenario (recommended path)

1. Copy `tests/scenarios/sample-http-get.js` or import a request in the **UI → cURL import**.
2. Import helpers from `utils/` as needed.
3. Register in UI automatically (file scan) or via cURL import metadata.
4. Add an npm script in `package.json` if you want a dedicated CLI entry point.

---

## WebSocket load testing (k6)

**Helper:** `utils/websocketHelper.js` (uses `k6/ws` — runs inside k6, not Node).

```javascript
import { testWebSocketConnection } from '../../utils/websocketHelper.js';

export default function () {
  testWebSocketConnection('wss://your-service.example/ws');
}
```

**Extensions:** Standard k6 includes WebSocket support; no xk6 plugin required for basic WS.

**CLI today:**

```bash
# Fails until you add e.g. tests/scenarios/websocket-health.js and wire package.json
npm run test:websocket
```

---

## gRPC load testing (k6)

**Helper:** `utils/grpcHelper.js`

Requires a k6 build with the gRPC extension:

```bash
# Example — use the extension build your org standardizes on
k6 install github.com/grafana/xk6-grpc
```

```javascript
import { createGrpcClient, invokeGrpcMethod } from '../../utils/grpcHelper.js';
```

**CLI today:** `npm run test:grpc` is a placeholder.

---

## Browser testing (k6)

Uses [k6 browser](https://k6.io/docs/javascript-api/k6-browser/) (`xk6-browser` or k6 v0.52+ with
browser enabled, depending on your k6 version).

**Helper:** `utils/browserHelper.js`

**CLI today:** `npm run test:browser` is a placeholder.

---

## Grafana & InfluxDB (metrics export)

These are **k6 output backends**, not features of the UI server.

```bash
# Influx (needs running InfluxDB)
npm run report:influxdb

# Or any k6 run with --out
k6 run --out influxdb=http://localhost:8086/k6 tests/scenarios/sample-http-get.js
```

See [ADVANCED_FEATURES.md](./ADVANCED_FEATURES.md) for baselines and report scripts.

---

## Performance baselines

**Helper:** `utils/baselineHelper.js` — **works today** via CLI:

```bash
npm run test:load
npm run baseline:save
# later
npm run baseline:compare
```

---

## Distributed execution

- **This platform:** one k6 process on the VM where Node runs.
- **Higher load:** run k6 on stronger hardware, use k6 Cloud, or split scenarios — not orchestrated
  by this UI.

```bash
npm run test:cloud   # k6 Cloud CLI wrapper — optional
```

---

## Related docs

- [ADVANCED_FEATURES.md](./ADVANCED_FEATURES.md) — baselines, reports, Influx/Grafana usage
- [BEST_PRACTICES.md](./BEST_PRACTICES.md) — scenario design
- [API.md](./API.md) — `POST /api/tests/curl` for UI-driven imports
