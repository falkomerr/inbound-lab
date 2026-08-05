# Framework assessment (honest)

This is an internal B2B **load-test platform**: a Vue UI + Express API that runs **k6 on the host
VM**, plus a small k6 script library and shared utilities. It is **not** a full enterprise load-test
product like Grafana Cloud k6, BlazeMeter, or a multi-region distributed grid.

For current setup and commands see [README.md](../README.md). For a feature checklist see
[ENTERPRISE_COMPARISON.md](./ENTERPRISE_COMPARISON.md).

---

## What works well

| Area               | Reality                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| **UI + API**       | JWT auth, RBAC, invites, password reset, admin audit, live WebSocket metrics |
| **Test control**   | Start/stop/pause/resume, history, report retention, cURL import              |
| **k6 integration** | Spawns k6 locally; one shipped scenario; CLI profiles vary VUs/duration      |
| **Utilities**      | Metrics, thresholds, auth helpers, request builder, logging, baselines       |
| **Ops**            | systemd/nginx examples, health endpoint, structured logs                     |
| **Quality**        | `npm test` (146 tests), lint, Prettier, isolated test data dirs              |

---

## Gaps (known)

| Gap                     | Notes                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| **Scenario library**    | Only `sample-http-get.js` in git; more via UI import or new files               |
| **Protocol scenarios**  | WebSocket/gRPC/browser **helpers** exist; no runnable `test:websocket` etc. yet |
| **Distributed load**    | Single-machine k6; `k6 cloud` script optional, not wired to UI                  |
| **Observability stack** | InfluxDB/Grafana helpers + npm scripts; no bundled Docker Compose               |
| **CI**                  | No pipeline in repo (run `npm test` locally or add your own)                    |
| **Frontend**            | `app.js` still large; production uses Vite bundle (`npm run build:ui`)          |
| **Scale-out**           | JSON file stores + in-memory rate limits = one Node process per VM              |

---

## Ratings (subjective, for planning)

| Dimension                           | Score   | Comment                                   |
| ----------------------------------- | ------- | ----------------------------------------- |
| Internal team tooling               | **4/5** | Solid for a dedicated VM + browser UI     |
| Scenario breadth                    | **2/5** | One built-in script; cURL import helps    |
| Protocol coverage (WS/gRPC/browser) | **2/5** | Helpers only until scenarios exist        |
| Production deploy story             | **4/5** | VM install docs, health checks, logrotate |
| Test automation (Node)              | **4/5** | Broad API + testManager + WS tests        |
| “Matches Amazon/Microsoft”          | **N/A** | Not a meaningful comparison for this repo |

---

## Recommended next steps

1. Add k6 scenarios you actually need (or import via UI cURL).
2. Keep [README.md](../README.md) scenario table updated when scripts change.
3. Add CI in your GitLab project (`npm test`, `npm run lint`, `npm run format:check`).
4. Add optional Docker Compose only if the team runs Influx/Grafana locally.

---

## References

- [k6 documentation](https://k6.io/docs/)
- [k6 customers](https://k6.io/customers/) (who uses k6 in general — not a claim about this repo)
