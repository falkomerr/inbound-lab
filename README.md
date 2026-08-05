# Load Test Platform

Open-source **k6** load & stress testing platform with a secure web UI — run scenarios, import cURL, manage users, and watch live metrics without living in the CLI.

**k6 runs on the machine where you start the server** (laptop, VM, or CI). Browsers only talk to the Node UI; HTTP load is generated locally by k6.

---

## Features

- **Web UI** — Start tests, watch live metrics, browse history
- **cURL import** — Turn a cURL command or multi-step chain into a k6 scenario
- **Pause & resume** — Scenario tests can pause, then resume with merged output
- **JWT auth + RBAC** — Roles: `admin`, `tech-lead`, `developer`, `qa`, `pm`
- **User management** — Invites, password resets, audit log
- **Report retention** — Automatic cleanup under `reports/`
- **CLI & integrations** — k6 scripts, HTML reports, baselines, optional InfluxDB/Grafana

---

## Quick Start

### Prerequisites

| Tool    | Version                                   |
| ------- | ----------------------------------------- |
| Node.js | ≥ 18                                      |
| npm     | ≥ 8                                       |
| k6      | ≥ 1.7 (installed by `npm run install:k6`) |

### 1. Install

```bash
git clone https://github.com/YOUR_USERNAME/load-test-platform.git
cd load-test-platform
npm run install:k6
```

### 2. Configure environment

```bash
cp env.example .env
```

Generate a **new** secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Edit `.env` and set at minimum:

```dotenv
JWT_SECRET=<paste-generated-secret>
APP_BASE_URL=http://localhost:3001
ALLOWED_ORIGINS=http://localhost:3001
UI_PORT=3001
ENV=staging
BASE_URL=https://httpbin.org
```

Optional: restrict invite/user emails to one domain:

```dotenv
ALLOWED_EMAIL_DOMAIN=example.com
```

Leave `ALLOWED_EMAIL_DOMAIN` unset to allow any email address.

### 3. Create the first admin

```bash
npm run seed:admin -- admin 'YourStr0ng!Pass'
```

Password rules: 8+ characters, one uppercase, one digit, one special character.

### 4. Start the UI

```bash
npm run ui
```

Open **http://localhost:3001** → sign in at `/login`.

### 5. Run a test

1. Log in as admin.
2. Select **Sample: HTTP GET** (demo against httpbin.org) or import your own cURL.
3. Set VUs and duration → **Start**.

CLI smoke test:

```bash
npm run test:smoke
```

---

## Deploy on a Linux VM

```bash
git clone https://github.com/YOUR_USERNAME/load-test-platform.git /opt/load-test-platform
cd /opt/load-test-platform
sudo bash deploy/install-vm.sh /opt/load-test-platform
```

Then set `APP_BASE_URL` / `ALLOWED_ORIGINS` in `.env` and seed an admin.

Service name: `load-test-platform`

```bash
sudo systemctl status load-test-platform
sudo journalctl -u load-test-platform -f
```

---

## Test scenarios

| ID                | File                                   | Team  | Description                                      |
| ----------------- | -------------------------------------- | ----- | ------------------------------------------------ |
| `sample-http-get` | `tests/scenarios/sample-http-get.js` | `api` | Demo GET against httpbin.org (or your `BASE_URL`) |

Add your own scripts under `tests/scenarios/`, or use **cURL Import** in the UI.

Teams (configurable in UI / `server/testManager.js`): `api`, `backend`, `frontend`, `platform`, `qa`.

---

## Security notes for publishers

- Never commit `.env`, `data/*.json`, or `reports/`
- Rotate `JWT_SECRET` on every deployment
- Point `BASE_URL` at **your** APIs only — the shipped sample uses the public httpbin.org demo
- Optional `ALLOWED_EMAIL_DOMAIN` for corporate installs

---

## npm Scripts

| Script                 | Description                          |
| ---------------------- | ------------------------------------ |
| `npm run ui`           | Start UI server                      |
| `npm run seed:admin`   | Create first admin                   |
| `npm run test:smoke`   | Sample k6 smoke test                 |
| `npm test`             | Node unit + integration tests        |
| `npm run lint`         | ESLint                               |
| `npm run build:ui`     | Production dashboard bundle          |

---

## Documentation

| Document | Description |
| -------- | ----------- |
| [UI_PANEL.md](./UI_PANEL.md) | Web dashboard guide |
| [docs/API.md](./docs/API.md) | REST + WebSocket reference |
| [docs/BEST_PRACTICES.md](./docs/BEST_PRACTICES.md) | Load testing practices |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guide |

---

## License

ISC — see [LICENSE](./LICENSE).

## Authors

Load Test Platform Contributors
