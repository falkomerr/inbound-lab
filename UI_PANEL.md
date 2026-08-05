# FasterTest Panel

Web dashboard for running k6 load tests, managing users, and viewing live results. The UI talks to a
Node server on your machine; **k6 runs locally on that same host** (not in the browser).

For setup, environment variables, and deployment, see [README.md](./README.md). For the full REST
reference, see [docs/API.md](./docs/API.md).

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Start the UI](#start-the-ui)
- [Sign in](#sign-in)
- [Dashboard overview](#dashboard-overview)
- [Run a scenario test](#run-a-scenario-test)
- [Pause, resume, stop, and update load](#pause-resume-stop-and-update-load)
- [Import from cURL](#import-from-curl)
- [Roles and visibility](#roles-and-visibility)
- [Admin panel](#admin-panel)
- [Real-time updates (WebSocket)](#real-time-updates-websocket)
- [History and results](#history-and-results)
- [API quick reference](#api-quick-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool    | Version |
| ------- | ------- |
| Node.js | ≥ 18    |
| npm     | ≥ 8     |
| k6      | ≥ 1.7   |

```bash
npm run install:k6    # installs k6 + npm dependencies
cp env.example .env   # set JWT_SECRET, APP_BASE_URL, ALLOWED_ORIGINS
npm run seed:admin -- admin 'YourStr0ng!Pass'   # once per machine
```

The server **exits** if `JWT_SECRET` is missing. Password policy: 8+ chars, one uppercase, one
digit, one special character.

---

## Start the UI

```bash
npm run ui
# alias: npm run ui:start
```

Default URL: **http://localhost:3001** (override with `UI_PORT` in `.env`).

LAN access: set `APP_BASE_URL` and `ALLOWED_ORIGINS` to the host IP, open port `3001`, and ensure k6
on that machine can reach `BASE_URL`.

---

## Sign in

| Route             | Purpose                     |
| ----------------- | --------------------------- |
| `/login`          | Sign in (JWT, 24h lifetime) |
| `/invite?token=…` | Accept admin invite         |
| `/reset?token=…`  | Reset password              |

Unauthenticated visits to `/` redirect to `/login`.

After login, the token is stored in the browser and sent as `Authorization: Bearer …` on API calls.
WebSocket upgrades require `?token=<jwt>` on the connection URL.

**Lockout:** 5 failed logins → 15 minute lockout. Admins can suspend non-admin logins globally.

---

## Dashboard overview

The UI is a **Vue 3** dashboard (`public/app.js` + modules, `public/styles.css`).

| Mode | Assets |
| ---- | ------ |
| **Development** (`npm run ui`) | Vue/Chart UMD from `/vendor/*` + classic scripts |
| **Production** | `npm run build:ui` → `public/dist/dashboard.js` when `NODE_ENV=production` |
with:

- **Test Scenarios** tab — built-in and imported k6 scenarios (team-filtered by role)
- **Import cURL** tab — parse cURL (single request or multi-step chain) into a new scenario
- Live **metrics charts** (Chart.js), terminal output, and run history
- Nav actions: **Pause**, **Resume**, **Stop**, **New Test** (when applicable)

Shipped scenario example: **Sample: HTTP GET** (`sample-http-get`).

Only **one k6 process** runs at a time. A **preparing lock** shows when another user clicked **New
Test**; admins and tech-leads can release it.

---

## Run a scenario test

1. Open **Test Scenarios**.
2. Pick a scenario (e.g. **Sample: HTTP GET**).
3. Configure **environment** (`staging` / `production`), **VUs**, and **duration**.
4. Optional: add **custom environment variables** for k6 (allowlisted keys only—see README).
5. Click **Start**.

`POST /api/tests/start` requires `mode: scenario` permission (or unrestricted modes). Team access is
enforced on both listing and start.

---

## Pause, resume, stop, and update load

Applies to **scenario** mode only (not cURL-only accounts).

| Action                   | Behavior                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| **Pause**                | Sends SIGTERM to k6; remaining duration stored for resume (`pausedForResume`)               |
| **Resume**               | Relaunches k6 with remaining duration; NDJSON segments merge into one logical run           |
| **Stop** (while running) | Ends the run                                                                                |
| **Stop** (while paused)  | Discards the paused session (cannot resume)                                                 |
| **Update load**          | Change VUs and/or duration on a **running** test (restarts k6 segment; same logical run id) |

**Idle expiry:** A paused session unused for **5 minutes** appears as `paused` in history; the
exclusive lock uses the same window.

**Exclusive lock:** For 5 minutes after a user stop or while paused-for-resume, only the original
starter, `admin`, or `tech-lead` may prepare or start another scenario test (others get HTTP 403).

Pause/resume/stop/update-load are restricted to the starter, `admin`, or `tech-lead` (same rules as
documented in README).

---

## Import from cURL

1. Copy **Copy as cURL** from browser DevTools.
2. Open **Import cURL**.
3. **Parse** → name the test → set VUs/duration → **Create & Run** (or create without running).

Endpoints: `POST /api/tests/curl` (single step) or `POST /api/tests/curl-chain` (multi-step).

Generated scripts are saved under `tests/scenarios/` and appear in the scenario list **without
restarting** the server.

Requires `curl` mode permission. cURL-created tests do not use the scenario pause/resume API.

---

## Roles and visibility

| Role                    | Scenarios      | cURL import     | Admin panel | VU/duration limits |
| ----------------------- | -------------- | --------------- | ----------- | ------------------ |
| `admin`                 | All teams      | Yes             | Full        | None               |
| `tech-lead`             | Assigned teams | Per permissions | —           | Per user limits    |
| `developer`, `qa`, `pm` | Assigned teams | Per permissions | —           | Per user limits    |

Permissions include `teams[]` and `modes[]` (`scenario`, `curl`). Empty `modes` means both; empty
`teams` for non-admins means all teams.

---

## Admin panel

Available to `admin` only (gear / Admin in the UI):

- **Users** — create, edit, ban, delete; password reset links
- **Invites** — time-limited invite URLs (`/invite?token=…`)
- **Audit log** — login and admin actions (`data/audit.json`)
- **Access** — global login suspension for non-admins

User data: `data/users.json` (gitignored, per machine).

---

## Real-time updates (WebSocket)

Connect with a valid JWT: `ws://<host>:<port>?token=<jwt>`.

**Client → server**

```json
{ "type": "subscribe" }
```

Sent automatically on connect.

**Server → client (main events)**

| Event             | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `status`          | Full run state (progress, options, metrics snapshot) |
| `test-started`    | Run began                                            |
| `test-paused`     | Run paused for resume                                |
| `test-stopped`    | Run stopped or session discarded                     |
| `test-complete`   | Run finished with results                            |
| `metrics`         | Live k6 metrics (throttled on the client)            |
| `output`          | stdout/stderr lines                                  |
| `test-preparing`  | Another user is preparing a new test                 |
| `history-updated` | History list changed                                 |
| `force-logout`    | Token invalid or user updated—redirect to login      |

State-change events also trigger a fresh `status` broadcast.

---

## History and results

- History is persisted to **`data/test-history.json`** (not only in memory).
- Result files (NDJSON/JSON) live under **`reports/`**; retention is controlled by `REPORT_MAX_*` in
  `.env`.
- Admins can clear all history via `POST /api/history/clear` or `DELETE /api/history`.
- Per-run results: `GET /api/results/:testId`.

---

## API quick reference

All `/api/*` routes except login, invite, and reset require JWT.

| Method       | Path                        | Description                         |
| ------------ | --------------------------- | ----------------------------------- |
| `POST`       | `/api/auth/login`           | Obtain JWT                          |
| `GET`        | `/api/auth/me`              | Current user                        |
| `GET`        | `/api/tests`                | List scenarios (team-filtered)      |
| `GET`        | `/api/status`               | Current run + pause/resume state    |
| `POST`       | `/api/tests/prepare`        | Mark user as preparing **New Test** |
| `POST`       | `/api/tests/cancel-prepare` | Clear preparing lock                |
| `POST`       | `/api/tests/start`          | Start scenario test                 |
| `POST`       | `/api/tests/pause`          | Pause running scenario              |
| `POST`       | `/api/tests/resume`         | Resume paused session               |
| `POST`       | `/api/tests/stop`           | Stop or discard paused session      |
| `POST`       | `/api/tests/update-load`    | Change VUs/duration while running   |
| `POST`       | `/api/tests/curl`           | Create from single cURL             |
| `POST`       | `/api/tests/curl-chain`     | Create from cURL chain              |
| `GET`        | `/api/history`              | Past runs (`?limit=`)               |
| `GET`        | `/api/results/:testId`      | Results for a run                   |
| `DELETE`     | `/api/history/:testId`      | Remove one history entry            |
| `GET/POST/…` | `/api/admin/*`              | Users, invites, audit, global ban   |

Example start body:

```json
{
  "testId": "sample-http-get",
  "options": {
    "environment": "staging",
    "vus": 20,
    "duration": "5m"
  }
}
```

---

## Operations (production VMs)

| Topic        | Guidance                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Health       | `GET /api/health` — no JWT; use for nginx, systemd, and uptime checks        |
| Node deps    | `npm install` + `npm run build:ui` on production VMs (see `deploy/install-vm.sh`) |
| Reports disk | `REPORT_MAX_AGE_DAYS`, `REPORT_MAX_TOTAL_MB`, `REPORT_MAX_FILE_MB` in `.env` |
| Audit log    | `data/audit.json` auto-trimmed to 5000 entries                               |
| Log rotation | Optional: `deploy/logrotate.conf.example` → `/etc/logrotate.d/`              |
| Logo asset   | `public/assets/logo.jpg` is in git — include when rsyncing to VMs        |

---

## Troubleshooting

| Issue                   | What to check                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Server won't start      | `JWT_SECRET` in `.env`; port `3001` free — `EADDRINUSE` means another instance is already running         |
| Blank dashboard         | Don't run Prettier on `index.html`; hard-refresh; check browser console                                   |
| Can't log in            | Run `npm run seed:admin`; lockout wait; global ban; CORS / `ALLOWED_ORIGINS`                              |
| WebSocket closes (1008) | Logged in; `?token=` on WS URL; token not expired                                                         |
| Test won't start        | `k6 version`; scenario file in `tests/scenarios/`; team/mode permissions; exclusive lock after pause/stop |
| No output               | k6 on PATH; server logs; `BASE_URL` reachable from the host                                               |
| Wrong invite/reset link | `APP_BASE_URL` matches the URL users actually open                                                        |

See [README.md § Troubleshooting](./README.md#troubleshooting) for more detail.

---

## Project layout (UI-related)

```
load-test-platform/
├── public/           # Vue dashboard, login, invite, reset pages
│   ├── modules/      # apiClient.js, icon.js (loaded before app.js)
│   └── curlParser.js
├── server/
│   ├── index.js      # Express + WebSocket (Vue/Chart from node_modules)
│   ├── testManager.js
│   └── routes/
│       ├── api.js
│       └── helpers/routeHelpers.js
├── tests/scenarios/  # k6 scripts (built-in + cURL imports)
├── data/             # users, history, audit (gitignored)
└── reports/          # k6 output (gitignored)
```

**Health check:** `GET /api/health` returns `{ status: "ok" }` without auth — suitable for load
balancers and uptime probes.
