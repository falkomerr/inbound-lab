# FasterTest — Phase 0 Baseline Audit (Public Beta Prep)

**Date:** 2026-08-05  
**Repository:** https://github.com/alirezaedalat/fastertest  
**Scope:** Read-only verification of architecture, security posture, tests, Docker, and
dependencies. **No implementation in this phase.**

Status labels used against the full beta hardening plan (Phases 1–14):

| Label                                    | Meaning                                     |
| ---------------------------------------- | ------------------------------------------- |
| **Confirmed**                            | Issue exists in current code; work required |
| **Already fixed / Partially present**    | Mitigations exist; may still need hardening |
| **Not applicable**                       | Does not apply to current product shape     |
| **Requires manual GitHub configuration** | Cannot be completed by repo code alone      |

---

## 1. Validation suite results

| Command                              | Result                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `npm ci`                             | Pass (264 packages)                                                                    |
| `npm run lint`                       | Pass (0 errors / 0 warnings with local uncommitted ESLint cleanup)                     |
| `npm run format:check`               | **Fail** — Prettier issues in 11 docs/CSS files                                        |
| `npm test`                           | Pass — **154 / 154**                                                                   |
| `npm run test:coverage`              | **Hung** on `tests/integration/wsAuth.test.js` (~8+ min open TCP); aborted for audit   |
| `npm run build:ui`                   | Pass                                                                                   |
| `docker build -t fastertest:audit .` | **Fail** — `E: Unable to locate package k6` after adding `dl.k6.io` apt repo (~29 min) |
| `npm audit`                          | **3 vulnerabilities** (1 low body-parser, 2 high brace-expansion + postcss)            |

**Note:** Working tree also has uncommitted lint-warning cleanups from a prior session (10 files).
They do not change runtime behavior.

---

## 2. Current architecture

```
Browser (Vue UI)
  ├── HTTP REST  /api/*     (JWT Bearer / X-Api-Token)
  └── WebSocket  /?token=JWT  (subscribe → live status/output)

Express (server/index.js)
  ├── Helmet + CORS + CSP
  ├── In-memory API rate limit (100/min/IP)
  ├── routes/api.js  (monolithic router)
  ├── middleware/auth.js + validation.js
  ├── TestManager  (single in-process k6 runner)
  └── Stores → MySQL (if configured) or data/*.json

k6 child process
  ├── Spawned on host/container
  ├── Env = process.env + customEnv
  └── Reports under reports/
```

- **Runtime:** Node ESM (`"type": "module"`), Express, `ws`, Pino, bcryptjs, jsonwebtoken, mysql2,
  Vue 3 + Chart.js in UI.
- **Persistence:** Dual backend — MySQL tables (`users`, `invites`, `password_resets`, `audit_log`,
  `access_control`) or JSON files; scenarios on disk under `tests/scenarios/`.
- **Deployment:** Multi-stage Dockerfile (non-root `loadtest`), Compose MySQL + optional `app`
  profile, systemd example under `deploy/`.

---

## 3. Authentication flow

1. `POST /api/auth/login` — per-IP + per-username lockouts → bcrypt verify → ban / global-login-ban
   → `bumpTokenVersion` (single session) → kick other WS → JWT 24h.
2. REST: `Authorization: Bearer` or `X-Api-Token`; `requireAuth` reloads user from store and checks
   ban + `tokenVersion`.
3. Invites / password resets: `crypto.randomBytes(32)`, TTLs (7d / 2h), links built from
   `APP_BASE_URL` (not Host header).
4. `JWT_SECRET` required at process start (fail-closed).

**Strengths:** No default secret, bcrypt, tokenVersion revocation, lockouts, APP_BASE_URL-bound
links.

**Risks:** JWT in WebSocket query string; `getClientIp` always prefers `X-Forwarded-For` even when
`TRUST_PROXY` unset; invite can create `admin`.

---

## 4. Authorization / RBAC flow

| Control                             | Mechanism                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Admin APIs                          | `requireAuth` + `requireAdmin`                                                 |
| Modes                               | `requireMode('scenario'\|'curl')` — empty modes = all; admin/tech-lead bypass  |
| Teams                               | Filter list + re-check on start                                                |
| VU/duration caps                    | Optional per-user `limits`; admins exempt; global caps in `utils/constants.js` |
| Stop / pause / resume / update-load | Starter **or** admin/tech-lead (duplicated role arrays)                        |
| History/results/live output         | Any authenticated user (shared dashboard model)                                |

**Risks:** Empty teams/modes = unrestricted; read paths not team-scoped; duplicated
`STOP_ROLES`-style checks.

---

## 5. WebSocket authentication flow

- Upgrade requires `?token=<JWT>`; verifies token + store user + tokenVersion + bans.
- Client connects then sends `{ type: 'subscribe' }`.
- Cap: `MAX_WEBSOCKET_SUBSCRIBERS` (100), oldest eviction.
- **Missing:** Origin `verifyClient`, explicit `maxPayload`, short-lived tickets, query redaction in
  access logs, heartbeat/idle limits, per-user connection caps.

---

## 6. k6 process execution flow

1. `POST /tests/start` → validate → ACL → limits → `TestManager.startTest`.
2. Resolve scenario under `tests/scenarios/`, spawn `k6 run` with `--vus`/`--duration` or `--stage`,
   JSON out + summary export.
3. Live stdout/stderr + NDJSON metrics → WS subscribers.
4. On close: merge segments, history, report retention.

**Hard limit:** one active execution per process instance.

---

## 7. Pause / resume and load update

- **Not** in-process k6 pause: SIGTERM current process → start new segment with remaining duration
  (or new VUs/duration for update-load).
- `resumeSession` is **in-memory only** (lost on restart).
- Pause holds `running=true` until close (good); **stop** clears `running` immediately → race with a
  new start (old close can clobber new run).
- No `executionMode: "segmented"` API field; UI/docs do not fully warn about setup/teardown/state
  loss.

---

## 8. Scenario creation / import

- Built-ins + scanned `tests/scenarios/*.js`.
- cURL / chain import writes generated JS to disk; names sanitized (`^[a-z0-9-]+$`).
- Start `testId` pattern-restricted — path traversal largely mitigated.
- **No** target URL / SSRF policy on imported URLs or `BASE_URL`.
- Chain script embeds `http.${method}` without a strict method allowlist (single-request path uses a
  switch).

---

## 9. Persistence / storage model

| Data                                          | MySQL                                       | JSON fallback |
| --------------------------------------------- | ------------------------------------------- | ------------- |
| Users, invites, resets, audit, access control | Yes                                         | `data/*.json` |
| Scenarios                                     | Disk                                        | Disk          |
| History / reports                             | Disk (`reports/`, in-memory history cap 50) | Same          |
| Paused session                                | Memory only                                 | Memory only   |

Docker default `STORAGE_BACKEND=mysql`. CI tests force JSON.

---

## 10. Secret-handling model

| Area        | Status                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Passwords   | bcrypt; omitted from API responses                                                                    |
| JWT in REST | Header only (good)                                                                                    |
| JWT in WS   | Query string (**bad**)                                                                                |
| customEnv   | Key pattern + blocklist; stripped from published status; **full `process.env` still inherited by k6** |
| Pino redact | `authorization`, `password`, `token` paths — incomplete vs Phase 13 list                              |
| k6 stdout   | Broadcast to all WS subscribers — secrets can leak if printed by scripts                              |
| Audit       | Generally avoids customEnv values                                                                     |

---

## 11. Current security risks (prioritized)

| Sev               | Risk                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| **Critical/High** | Authenticated SSRF / internal targeting via cURL or `BASE_URL` (by design today; no egress policy) |
| **High**          | Long-lived JWT in WebSocket URL                                                                    |
| **High**          | No WS Origin check / large default `maxPayload`                                                    |
| **High**          | k6 inherits full host `process.env` (JWT_SECRET, DB password, etc.)                                |
| **High**          | Secrets in k6 output shared to all authenticated WS clients                                        |
| **High**          | Stop→start race can corrupt active run state                                                       |
| **Med**           | XFF spoofing of IP lockouts when proxy not trusted                                                 |
| **Med**           | Unpinned k6 in Docker (`apt install k6` from stable)                                               |
| **Med**           | Compose default MySQL passwords + hardcoded healthcheck `-proot`                                   |
| **Med**           | Hand-rolled single-process rate limiter; no Redis; no auth-endpoint-specific policies              |
| **Med**           | customEnv incomplete denylist / no value-size / count limits / no secret vs public split           |
| **Med**           | No graceful SIGTERM shutdown of Node → orphan k6 children                                          |
| **Low**           | Invite→admin; empty teams/modes footgun; bcrypt cost 10; client “min 6” vs server 8+               |

---

## 12. Scalability limitations

- One concurrent k6 run per FasterTest instance.
- In-memory rate limit, pause session, subscriber list — not multi-instance safe.
- History capped (50); output buffer 1000 lines; metric points 10k; WS subscribers 100.
- Global VU max 1000 / duration 24h (constants); optional per-user caps.
- No queue / worker agents / distributed k6.

---

## 13. Missing automated tests (security-relevant)

- WS: Origin, maxPayload, banned/global-ban, ticket lifecycle (N/A until Phase 3), secret-in-output.
- customEnv denylist / size limits / status redaction.
- Target/SSRF policy (none to test yet).
- Pause / resume / update-load segment merge & percentile semantics.
- Stop-then-start race; SIGTERM cleanup.
- API rate-limit 429; TRUST_PROXY / XFF behavior.
- MySQL store parity + migrate in CI.
- Logger redaction proofs.
- Docker image / compose smoke in CI.
- `npm run test:coverage` reliability (hang on wsAuth).

---

## 14. Dependency vulnerabilities (`npm audit`)

| Package                 | Severity | Notes                                                                                          |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `body-parser` `<1.20.6` | low      | DoS if invalid limit; fix via `npm audit fix`                                                  |
| `brace-expansion`       | high     | Transitive DoS; fix via audit fix                                                              |
| `postcss`               | high     | Dev/build (Vite); arbitrary `.map` read — lower runtime risk for production image (`omit=dev`) |

k6 is **not** an npm dependency; Docker installs unpinned distro package.

---

## 15. Docker and deployment risks

- Unpinned k6 from `dl.k6.io` stable; no SHA pin; no OCI labels / tini / digest-pinned base.
- **Audit `docker build` failed:** apt reports `Unable to locate package k6` after configuring the
  k6 repo (architecture/repo layout mismatch or upstream packaging change — reinforces Phase 2
  pin-via-binary approach).
- No init process; no graceful shutdown wiring.
- Compose: weak default DB passwords; MySQL port published; healthcheck ignores custom root
  password; no `read_only` / `cap_drop` / `no-new-privileges` / resource limits on app.
- CI: no Docker build job; Dependabot lacks `docker` ecosystem.
- Positive: multi-stage, non-root user, healthcheck on `/api/health`, `JWT_SECRET` required for full
  profile.

---

## 16. Plan item triage (Phases 1–14)

### Phase 1 — Legal, licensing, branding

| Item                                         | Status                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `THIRD_PARTY_NOTICES.md`                     | **Confirmed** missing                                                                             |
| Grafana/k6 affiliation disclaimer in README  | **Confirmed** missing                                                                             |
| k6 license/copyright/version pin docs        | **Confirmed** missing                                                                             |
| Independent logo (FasterTest mark)           | **Already fixed / present**                                                                       |
| ISC in LICENSE / package.json / README badge | **Already fixed / present**                                                                       |
| Do not auto-change license                   | **Not applicable** (no change proposed); human review if AGPL k6 binary bundling raises questions |

### Phase 2 — Pin k6 & harden Docker

| Item                                                 | Status                                 |
| ---------------------------------------------------- | -------------------------------------- |
| Pin `K6_VERSION` + verify checksum/signature         | **Confirmed**                          |
| Multi-arch amd64/arm64                               | **Confirmed** (not explicitly handled) |
| Record version in labels / health / logs / notices   | **Confirmed**                          |
| Pin base image digests                               | **Confirmed**                          |
| OCI labels                                           | **Confirmed** missing                  |
| tini/dumb-init + graceful shutdown                   | **Confirmed**                          |
| Non-root user                                        | **Already fixed**                      |
| Compose hardening (read_only, caps, secrets, limits) | **Confirmed**                          |
| Never ship default production passwords              | **Confirmed** (Compose defaults weak)  |
| Docker build/runtime tests                           | **Confirmed** missing                  |

### Phase 3 — WebSocket authentication

| Item                                           | Status                                          |
| ---------------------------------------------- | ----------------------------------------------- |
| Replace JWT query with one-time ticket         | **Confirmed**                                   |
| Origin validation, maxPayload, heartbeat, caps | **Confirmed**                                   |
| Redact query strings in logs                   | **Confirmed**                                   |
| Frontend + API docs update                     | **Confirmed**                                   |
| Tests listed in plan                           | **Confirmed** missing (partial JWT tests exist) |

### Phase 4 — customEnv security

| Item                                            | Status                                             |
| ----------------------------------------------- | -------------------------------------------------- |
| Key pattern `/^[A-Z][A-Z0-9_]{0,63}$/`          | **Already fixed / present**                        |
| Prefix allowlist + expanded blocklist module    | **Confirmed** (inline validation only; incomplete) |
| Value/count/size limits; secret vs public split | **Confirmed**                                      |
| Minimal spawn env (not full `process.env`)      | **Confirmed**                                      |
| Redact secrets from stdout/history/WS           | **Confirmed**                                      |
| Dedicated `customEnvPolicy.js` + tests          | **Confirmed**                                      |

### Phase 5 — Target policy / SSRF

| Item                                                       | Status                |
| ---------------------------------------------------------- | --------------------- |
| Allow/deny lists, private network blocks                   | **Confirmed** absent  |
| DNS resolve + rebinding notes                              | **Confirmed**         |
| Honest docs: JS sandbox incomplete without egress controls | **Confirmed** needed  |
| NetworkPolicy / firewall examples                          | **Confirmed** missing |

### Phase 6 — Execution limits & permissions

| Item                                           | Status                                     |
| ---------------------------------------------- | ------------------------------------------ |
| Global VU/duration caps                        | **Partially present**                      |
| Consistent limits on resume/update-load/import | **Confirmed** needs verification/hardening |
| Central permission model (replace role arrays) | **Confirmed**                              |
| Per-role authorization tests                   | **Confirmed** thin                         |

### Phase 7 — Rate limiter

| Item                                           | Status        |
| ---------------------------------------------- | ------------- |
| Replace Map limiter with maintained library    | **Confirmed** |
| Separate auth / WS-ticket / execution policies | **Confirmed** |
| Redis optional + trusted proxy                 | **Confirmed** |
| Standard rate-limit headers                    | **Confirmed** |

### Phase 8 — Pause/resume semantics

| Item                                              | Status                |
| ------------------------------------------------- | --------------------- |
| Document segmented pause                          | **Confirmed**         |
| `executionMode: "segmented"` + segment metadata   | **Confirmed**         |
| Percentile merge correctness                      | **Confirmed**         |
| Persist paused metadata safely / or document loss | **Confirmed**         |
| Tests for pause/resume cycles                     | **Confirmed** missing |

### Phase 9 — TestManager state machine

| Item                                    | Status                               |
| --------------------------------------- | ------------------------------------ |
| Explicit states + transition validation | **Confirmed** (implicit flags today) |
| Generation IDs; stop/start race         | **Confirmed**                        |
| SIGTERM then SIGKILL timeout            | **Confirmed**                        |
| State-machine + race tests              | **Confirmed**                        |

### Phase 10 — Single-runner / future queue

| Item                                                   | Status                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Document one-active-test limit                         | **Partially present** (code enforces; docs should be clearer) |
| Abstractions interfaces; 409 Conflict structured error | **Confirmed**                                                 |
| Do not build distributed system in same PR             | **Not applicable** (guidance only)                            |

### Phase 11 — Route/server refactor

| Item                                              | Status                         |
| ------------------------------------------------- | ------------------------------ |
| Split `api.js` / services / validation / AppError | **Confirmed** (monolith today) |

### Phase 12 — Input validation & file security

| Item                                     | Status                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Central schemas; path traversal defenses | **Partially present** (patterns + sanitize; needs hardening + tests) |
| Atomic writes                            | **Already fixed / present** (`server/utils/atomicWrite.js`)          |

### Phase 13 — Secret redaction & logging

| Item                                      | Status                |
| ----------------------------------------- | --------------------- |
| Expand Pino redact paths; correlation IDs | **Confirmed**         |
| Tests that secrets never appear in logs   | **Confirmed** missing |

### Phase 14 — Auth & account security (partial list in prompt)

| Item                                                      | Status                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Review bcrypt cost, password policy, reset token lifetime | **Partially present** — review/tune still **Confirmed**                                                       |
| GitHub Security Advisories private reporting              | **Already fixed** in SECURITY.md; enabling org/repo Advisories UI is **Requires manual GitHub configuration** |
| Branch protection, required CI checks, Dependabot alerts  | **Requires manual GitHub configuration**                                                                      |
| Secret scanning / push protection                         | **Requires manual GitHub configuration**                                                                      |

---

## 17. Legal uncertainty (human review)

- Bundling **k6** (AGPL-3.0) as a binary inside the Docker image may create distribution obligations
  distinct from FasterTest’s **ISC** application license. Do **not** silently relicense. Recommend
  counsel or maintainer judgment before public beta marketing that “ships with k6.”
- Ensure README disclaimer that FasterTest is **not** affiliated with Grafana Labs.

---

## 18. Recommended implementation order (after Phase 0)

1. **Phase 1** legal notices (low risk, unblock public listing)
2. **Phase 3** WS tickets + Origin + maxPayload
3. **Phase 4** spawn-env + customEnv policy + output redaction
4. **Phase 2** pin k6 + container hardening
5. **Phase 5** target policy + egress documentation
6. **Phase 7** rate limiting
7. **Phases 8–9** pause semantics + TestManager FSM (correctness)
8. **Phases 6, 10–14** permissions, queue interfaces, refactor, validation, logging, auth polish

Commit in small reviewable slices; run full validation after each phase; do not claim complete
without green tests.

---

## 19. Remaining risks even after planned work

- Arbitrary user k6 JavaScript cannot be fully sandboxed at the app layer; **network egress
  controls** remain mandatory for hostile multi-tenant use.
- Shared-dashboard model (all auth users see live output) conflicts with strict secret isolation
  unless product model changes.
- Multi-instance HA needs Redis (or similar) for tickets, rate limits, and eventually execution
  locking.

---

## Phase 0 deliverable checklist

- [x] Repository inspected (package, Docker, server, public, tests, CI, docs)
- [x] Validation commands run (coverage hang + Docker build incomplete noted)
- [x] Architecture / auth / RBAC / WS / k6 / pause / scenarios / storage / secrets documented
- [x] Risks, scale limits, test gaps, dep vulns, deploy risks listed
- [x] Plan items marked Confirmed / Already fixed / N/A / Manual GitHub
- [ ] **Implementation intentionally not started**
