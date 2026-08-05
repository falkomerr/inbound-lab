# Load Test API Reference

REST and WebSocket API for the Load Test Platform.

**Base URL:** `http://localhost:3001/api` (or your `APP_BASE_URL` + `/api`)

**Related docs:** [README.md](../README.md) · [UI_PANEL.md](../UI_PANEL.md)

---

## Table of Contents

- [Authentication](#authentication)
- [Roles and permissions](#roles-and-permissions)
- [Response format](#response-format)
- [Auth endpoints](#auth-endpoints)
- [Test management](#test-management)
- [History and results](#history-and-results)
- [cURL import](#curl-import)
- [Admin endpoints](#admin-endpoints)
- [Public invite and reset](#public-invite-and-reset)
- [WebSocket](#websocket)
- [Error codes](#error-codes)

---

## Authentication

All `/api/*` routes **except** `GET /api/health`, login, invite validation/accept, and password
reset require a valid JWT.

The server **exits at startup** if `JWT_SECRET` is not set in `.env`.

| Setting    | Value                                                             |
| ---------- | ----------------------------------------------------------------- |
| Secret     | `JWT_SECRET` in `.env` (generate per deployment)                  |
| Lifetime   | 24 hours                                                          |
| Revocation | `tokenVersion` on user record — bumped on login and admin updates |

### Providing the token

**Header (recommended):**

```http
Authorization: Bearer <jwt>
```

**Alternative header:**

```http
X-Api-Token: <jwt>
```

REST endpoints do **not** accept `?token=` query parameters. WebSocket upgrades require
`?token=<jwt>` on the connection URL (see [WebSocket](#websocket)).

### Login flow

1. `POST /api/auth/login` with username/password → receive `{ token, user }`.
2. Store the token client-side (browser uses `localStorage`).
3. Send the token on every API request and WebSocket upgrade.
4. On `401` or WebSocket close code `1008`, redirect to `/login`.

### Lockout

- **Per username:** 5 failed attempts → 15 minute lockout (`429`).
- **Per IP:** 20 failed attempts → 15 minute lockout (`429`).
- Banned users and global login suspension return `403` on login or `401` on authenticated routes.

---

## Roles and permissions

| Role                    | Admin panel | Team filter         | VU/duration limits  |
| ----------------------- | ----------- | ------------------- | ------------------- |
| `admin`                 | Full        | None (all teams)    | None                |
| `tech-lead`             | —           | `permissions.teams` | `limits` if enabled |
| `developer`, `qa`, `pm` | —           | `permissions.teams` | `limits` if enabled |

**Permissions object:**

```json
{
  "teams": ["api", "backend"],
  "modes": ["scenario", "curl"]
}
```

- Empty `teams` = all teams (non-admin).
- Empty `modes` = both scenario and cURL modes.
- `requireMode('scenario')` / `requireMode('curl')` enforced server-side; admins and tech-leads
  bypass mode checks.

**Pause/stop/resume/update-load:** Only the user who started the test, `admin`, or `tech-lead` may
perform these actions (unless noted otherwise).

**Exclusive lock:** While a pause-for-resume session is active (first 5 minutes), only starter /
`admin` / `tech-lead` may `POST /tests/prepare` or `POST /tests/start`.

---

## Response format

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": "Human-readable message"
}
```

---

## Auth endpoints

### `GET /api/health`

**Auth:** Public

Readiness probe for load balancers, systemd (`ExecStartPost` in `deploy/load-test-platform.service`), and
uptime monitors.

```bash
curl -sf http://127.0.0.1:3001/api/health
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 123.45,
    "timestamp": "2024-07-01T12:00:00.000Z"
  }
}
```

---

### `POST /api/auth/login`

**Auth:** Public

**Body:**

```json
{
  "username": "admin",
  "password": "YourStr0ng!Pass"
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": {
      "id": "...",
      "username": "admin",
      "role": "admin",
      "email": "",
      "permissions": { "teams": [], "modes": [] },
      "limits": { "enabled": false, "maxVus": 50, "maxDurationMinutes": 30 }
    }
  }
}
```

| Status | Reason                             |
| ------ | ---------------------------------- |
| `400`  | Missing username/password          |
| `401`  | Invalid credentials                |
| `403`  | Account banned or global login ban |
| `429`  | Username or IP lockout             |

---

### `GET /api/auth/me`

**Auth:** JWT

Returns fresh user record from `data/users.json` (not stale JWT payload).

---

## Test management

### `GET /api/tests`

**Auth:** JWT

List available k6 scenarios. Non-admins are filtered by `permissions.teams`.

**Example entry:**

```json
{
  "id": "sample-http-get",
  "name": "Sample: HTTP GET",
  "file": "sample-http-get.js",
  "description": "Login load test for CE platform — supports staging & production",
  "team": "ce",
  "defaultVUs": 20,
  "defaultDuration": "5m",
  "steps": [{ "method": "POST", "url": "/api/v1/customer/login", "label": "Customer Login" }]
}
```

Imported cURL scenarios appear automatically after creation (no server restart).

---

### `GET /api/status`

**Auth:** JWT

Current run state, including:

| Field                | Description                      |
| -------------------- | -------------------------------- |
| `running`            | k6 process active                |
| `pausedForResume`    | Paused mid-run; can resume       |
| `testId`, `testName` | Logical run id and scenario name |
| `progress`           | 0–100                            |
| `output`             | Recent stdout/stderr lines       |
| `metrics`            | Aggregated k6 metrics snapshot   |
| `options`            | VUs, duration, environment, etc. |
| `resumeInfo`         | Present when `pausedForResume`   |
| `preparingUser`      | User who clicked **New Test**    |

---

### `POST /api/tests/prepare`

**Auth:** JWT

Mark current user as preparing a new test (UI **New Test** flow).

| Status | Reason                        |
| ------ | ----------------------------- |
| `409`  | A test is already running     |
| `403`  | Paused-session exclusive lock |

---

### `POST /api/tests/cancel-prepare`

**Auth:** JWT

Clear preparing lock. Owner or `admin` may cancel.

---

### `POST /api/tests/start`

**Auth:** JWT · **Mode:** `scenario`

**Body:**

```json
{
  "testId": "sample-http-get",
  "options": {
    "environment": "staging",
    "vus": 20,
    "duration": "5m",
    "customEnv": {
      "MY_FLAG": "1"
    }
  }
}
```

**`customEnv` rules:** Keys `[A-Z][A-Z0-9_]{0,63}`; blocked prefixes `LD_`, `DYLD_`, `NODE_`, etc.;
blocked names `PATH`, `HOME`, `USER`, `SHELL`, …

| Status | Reason                                                   |
| ------ | -------------------------------------------------------- |
| `400`  | Validation / k6 spawn error                              |
| `403`  | Team access, mode, VU/duration limits, or exclusive lock |
| `404`  | Unknown `testId`                                         |

Only one k6 process runs at a time.

---

### `POST /api/tests/pause`

**Auth:** JWT · **Mode:** `scenario`

Sends SIGTERM to k6; stores remaining duration for resume.

---

### `POST /api/tests/resume`

**Auth:** JWT · **Mode:** `scenario`

Relaunches k6 with remaining duration; merges NDJSON segments.

| Status | Reason            |
| ------ | ----------------- |
| `400`  | No paused session |

---

### `POST /api/tests/stop`

**Auth:** JWT

Stops a running test **or** discards a paused-for-resume session.

---

### `POST /api/tests/update-load`

**Auth:** JWT · **Mode:** `scenario`

Change VUs and/or duration on a **running** test (restarts k6 segment; same logical run id).

**Body** (at least one field):

```json
{
  "vus": 50,
  "duration": "3m"
}
```

Omitted fields are taken from the active run's options.

| Status | Reason                                                 |
| ------ | ------------------------------------------------------ |
| `400`  | No active running test                                 |
| `403`  | Not starter / admin / tech-lead, or VU/duration limits |

---

## History and results

### `GET /api/history`

**Auth:** JWT

**Query:** `limit` (default `50`)

History is persisted in `data/test-history.json`.

**Example entry:**

```json
{
  "id": "sample-http-get-1719859200000",
  "testId": "sample-http-get",
  "startTime": "2024-07-01T12:00:00.000Z",
  "endTime": "2024-07-01T12:05:00.000Z",
  "status": "completed",
  "exitCode": 0,
  "startedBy": "...",
  "startedByUsername": "admin"
}
```

Statuses include `completed`, `stopped`, `failed`, `paused`, `discarded`.

---

### `GET /api/results/:testId`

**Auth:** JWT

Returns k6 results JSON for a finished or in-progress logical run id.

---

### `DELETE /api/history/:testId`

**Auth:** JWT

Delete one history entry. Allowed for `admin`, `tech-lead`, or the user who started the run.

---

### `POST /api/history/clear`

**Auth:** Admin

Wipe all history entries and associated report files.

---

### `DELETE /api/history`

**Auth:** Admin

Same as `POST /api/history/clear` (prefer POST behind strict reverse proxies).

---

### `DELETE /api/tests/:testId`

**Auth:** Admin

Remove an imported scenario file from `tests/scenarios/`.

---

## cURL import

### `POST /api/tests/curl`

**Auth:** JWT · **Mode:** `curl`

**Body:**

```json
{
  "testName": "my-api-test",
  "request": {
    "method": "GET",
    "url": "https://api.example.com/v1/items",
    "headers": {},
    "body": ""
  },
  "options": {
    "vus": 10,
    "duration": "1m",
    "environment": "staging"
  }
}
```

`testName` must match `^[a-z0-9-]+$`.

---

### `POST /api/tests/curl-chain`

**Auth:** JWT · **Mode:** `curl`

**Body:**

```json
{
  "testName": "login-then-fetch",
  "steps": [
    { "method": "POST", "url": "https://api.example.com/login", "headers": {}, "body": "{}" },
    { "method": "GET", "url": "https://api.example.com/me", "headers": {}, "body": "" }
  ],
  "options": { "vus": 5, "duration": "30s" }
}
```

cURL-imported tests do not support pause/resume.

---

## Admin endpoints

All require **JWT** + **`admin`** role.

| Method   | Path                          | Description                                              |
| -------- | ----------------------------- | -------------------------------------------------------- |
| `GET`    | `/admin/users`                | List users                                               |
| `POST`   | `/admin/users`                | Create user                                              |
| `PUT`    | `/admin/users/:id`            | Update user (role, permissions, limits, email, password) |
| `PATCH`  | `/admin/users/:id/suspension` | `{ "banned": true \| false }`                            |
| `DELETE` | `/admin/users/:id`            | Delete user (not self)                                   |
| `POST`   | `/admin/users/ban-all`        | Ban all non-admin accounts                               |
| `POST`   | `/admin/users/unban-all`      | Unban all accounts                                       |
| `POST`   | `/admin/users/:id/reset-link` | Generate password reset URL                              |
| `GET`    | `/admin/access`               | `{ globalLoginBan: boolean }`                            |
| `PUT`    | `/admin/access/global-ban`    | `{ "enabled": true \| false }`                           |
| `GET`    | `/admin/invites`              | List pending invites                                     |
| `POST`   | `/admin/invites`              | Create invite link                                       |
| `DELETE` | `/admin/invites/:token`       | Revoke invite                                            |
| `GET`    | `/admin/audit`                | Audit log (`limit`, `type`, `username`, `search`)        |
| `DELETE` | `/admin/audit`                | Clear audit log (`?confirm=yes`)                         |

Invite and reset links use `APP_BASE_URL` from `.env` (not the request `Host` header).

**Password policy:** 8+ characters, one uppercase, one digit, one special character.

**Valid roles:** `admin`, `tech-lead`, `developer`, `qa`, `pm`

**Email (when provided):** any address by default. If `ALLOWED_EMAIL_DOMAIN` is set, must end with that domain.

---

## Public invite and reset

### `GET /api/invite/:token`

Validate invite. Returns `{ email, role }` or `{ alreadyUsed: true }`.

### `POST /api/invite/:token/accept`

**Body:** `{ "username": "...", "password": "..." }`

Creates account and returns `{ token, user }` (auto-login).

### `GET /api/reset/:token`

Validate reset token. Returns `{ username }`.

### `POST /api/reset/:token`

**Body:** `{ "password": "..." }`

Sets new password and consumes token.

---

## WebSocket

**URL:** `ws://<host>:<UI_PORT>?token=<jwt>`

Unauthenticated upgrades are rejected with close code **1008**.

### Client → server

On connect, send:

```json
{ "type": "subscribe" }
```

### Server → client

| Event             | Description                                       |
| ----------------- | ------------------------------------------------- |
| `status`          | Full run state                                    |
| `test-started`    | Run began                                         |
| `test-paused`     | Run paused for resume                             |
| `test-stopped`    | Run stopped or session discarded                  |
| `test-complete`   | Run finished                                      |
| `metrics`         | Live k6 metrics                                   |
| `output`          | `{ message, type? }` stdout/stderr                |
| `test-preparing`  | `{ preparingUser }` or `null`                     |
| `history-updated` | History changed                                   |
| `force-logout`    | `{ reason }` — session invalid; redirect to login |

State-change events (`test-started`, `test-paused`, `test-stopped`, `test-complete`,
`test-preparing`, `history-updated`) also trigger a fresh `status` broadcast.

All authenticated subscribers receive all events (shared team dashboard). Access control is enforced
at the HTTP API and WebSocket handshake.

---

## Error codes

| HTTP  | Meaning                                              |
| ----- | ---------------------------------------------------- |
| `400` | Bad request / validation                             |
| `401` | Missing, invalid, or revoked JWT                     |
| `403` | Forbidden (role, team, mode, limits, exclusive lock) |
| `404` | Not found                                            |
| `409` | Conflict (e.g. test already running)                 |
| `429` | Rate limit / login lockout                           |
| `500` | Server error (message sanitized via `safeError`)     |

---

## Environment variables (server)

| Variable          | Required     | Description                                   |
| ----------------- | ------------ | --------------------------------------------- |
| `JWT_SECRET`      | **Yes**      | Signing secret                                |
| `APP_BASE_URL`    | Recommended  | Public URL for invite/reset links             |
| `ALLOWED_ORIGINS` | Recommended  | CORS allowlist                                |
| `UI_PORT`         | No           | Default `3001`                                |
| `TRUST_PROXY`     | Behind proxy | Set `1` for nginx/HTTPS                       |
| `REPORT_MAX_*`    | No           | Disk cleanup under `reports/` on server start |
| `LOG_HTTP`        | No           | Set `1` for one-line `/api` access logs       |

### Operations notes

- **UI vendor scripts:** Vue and Chart.js are served from `node_modules` at runtime — run
  `npm install` on every deployment (see README § Deploy on a Linux VM).
- **Audit log:** `data/audit.json` is trimmed to the last **5000** entries by the server.
- **Optional log rotation:** `deploy/logrotate.conf.example` for `logs/` and `reports/` on
  long-lived VMs.

See [env.example](../env.example) for the full list.
