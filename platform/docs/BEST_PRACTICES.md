# FasterTest & k6 best practices

Practical guidance for running load tests **through FasterTest** and writing solid k6 scenarios.
This is engineering guidance, not a guarantee of production readiness.

---

## 1. Use FasterTest the right way

1. **Authorize targets** — Traffic leaves the FasterTest host/container. Only hit systems you own or
   have written permission to test.
2. **Start small** — Use the Sample scenario or a 1–5 VU smoke run before large profiles.
3. **One runner** — FasterTest runs **one** k6 process at a time. Coordinate with your team; use the
   prepare lock and avoid stealing paused sessions.
4. **Prefer MySQL** for shared installs — JSON files are fine for solo demos.
5. **Protect secrets** — Put tokens in allowlisted custom env vars; never paste production secrets
   into scenario files committed to git.
6. **Read the live feed carefully** — Authenticated users share live output; do not print secrets in
   `console.log` inside scripts.

See [UI_PANEL.md](../UI_PANEL.md) for pause/resume, cURL import, and admin flows.

---

## 2. Suggested test progression

Run types in this order when exploring a new system:

| Stage  | Goal                             | Typical scale           |
| ------ | -------------------------------- | ----------------------- |
| Smoke  | Script + auth + happy path works | 1–5 VUs, 1–5 min        |
| Load   | Normal expected traffic          | 10–50 VUs, 5–15 min     |
| Stress | Find breaking points             | 50–200+ VUs, 15–30 min  |
| Spike  | Sudden surge handling            | Short bursts, high VUs  |
| Soak   | Stability / leaks                | Low–moderate VUs, 1–4 h |

In FasterTest, set VUs and duration in the UI (respect role limits and global caps).

---

## 3. Write good k6 scenarios

### Thresholds

Always define pass/fail criteria:

```javascript
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};
```

Prefer percentiles (p95/p99) over averages for latency.

### Checks and think time

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/health`, { timeout: '10s' });
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1); // or randomized think time for realism
}
```

### Environment configuration

- Use `__ENV.BASE_URL` (and other allowlisted keys) instead of hard-coding hosts.
- Keep staging and production URLs in FasterTest env / `.env`, not in git.
- Add request **timeouts** so a dead host fails fast instead of hanging the run.

### cURL import

- Great for bootstrapping; review generated scripts before large runs.
- Imported cURL scenarios **cannot** pause/resume in FasterTest today — use scenario mode for
  segmented pause/resume.
- Strip secrets from Authorization headers before committing scenarios.

---

## 4. Pause, resume, and update load

FasterTest pause/resume is **segmented**: the current k6 process is stopped and a new segment may
start with remaining duration or updated VUs.

That means:

- In-memory VU state is **not** preserved
- `setup()` / `teardown()` may run per segment
- Prefer idempotent scenarios when using pause/resume
- Paused sessions are **in-memory** — a server restart discards them

---

## 5. Reports and history

- Export JSON/HTML from the UI when you need an artifact for a ticket or release note.
- History is capped and file-backed — archive important reports outside `reports/` if you need long
  retention.
- Configure `REPORT_MAX_AGE_DAYS` / `REPORT_MAX_TOTAL_MB` so disks do not fill up.

---

## 6. Operator checklist

- [ ] Unique `JWT_SECRET`
- [ ] `APP_BASE_URL` + `ALLOWED_ORIGINS` match how users open the UI
- [ ] MySQL for multi-user installs
- [ ] TLS reverse proxy in production (`TRUST_PROXY` when needed)
- [ ] Network egress limited to intended targets
- [ ] Strong admin password; invites expire; audit periodically reviewed

---

## 7. Further reading

- [UI_PANEL.md](../UI_PANEL.md) — product usage
- [docs/API.md](./API.md) — HTTP / WebSocket API
- [k6 docs — Best practices](https://grafana.com/docs/k6/latest/testing-guides/)
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) — k6 licensing in Docker images
