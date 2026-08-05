# FasterTest

<p align="center">
  <img src="public/assets/logo.jpg" alt="FasterTest logo" width="520" />
</p>

<p align="center">
  <b>Open-source k6 load &amp; stress testing — with a real web UI</b><br />
  Start tests from the browser · live metrics · cURL import · users &amp; RBAC · MySQL
</p>

<p align="center">
  <a href="https://github.com/alirezaedalat/fastertest/actions/workflows/ci.yml"><img src="https://github.com/alirezaedalat/fastertest/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue.svg" alt="License: ISC" /></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js" /></a>
  <a href="https://k6.io"><img src="https://img.shields.io/badge/engine-k6-7D64FF" alt="k6" /></a>
  <a href="https://github.com/alirezaedalat/fastertest/stargazers"><img src="https://img.shields.io/github/stars/alirezaedalat/fastertest?style=social" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="#quick-start"><b>Quick Start</b></a> ·
  <a href="#features">Features</a> ·
  <a href="#docker">Docker</a> ·
  <a href="docs/API.md">API</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## Why FasterTest?

Most people run k6 from the CLI. **FasterTest** gives your team a secure panel on top of k6:

| Without FasterTest | With FasterTest |
| --- | --- |
| Everyone shares scripts + CLI flags | One UI: pick scenario, VUs, duration, **Start** |
| Hard to invite non-CLI users | JWT login, roles, invites, audit log |
| Live output = terminal scrollback | Live metrics over WebSocket |
| cURL → k6 by hand | **cURL import** (single or chain) |

> **k6 still generates the load on the machine (or container) where the server runs.** Browsers only talk to the UI.

---

## Features

- **Web UI** — start / stop / pause / resume, live metrics, history
- **cURL import** — paste a cURL (or multi-step chain) → runnable k6 scenario
- **Auth & RBAC** — `admin`, `tech-lead`, `developer`, `qa`, `pm`
- **User management** — invites, password resets, audit log
- **MySQL storage** (recommended) — JSON file fallback for quick demos
- **Report retention** — automatic cleanup under `reports/`
- **Deploy-ready** — Docker Compose, Linux VM + systemd, nginx examples

---

## Quick Start

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | ≥ 18 (20 LTS — see `.nvmrc`) |
| npm | ≥ 8 |
| k6 | ≥ 1.7 (`npm run install:k6`) |
| Docker | Optional (MySQL) |

### 1. Clone & install

```bash
git clone https://github.com/alirezaedalat/fastertest.git
cd fastertest
npm ci
npm run install:k6
```

### 2. Configure

```bash
cp env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the printed value into `.env` as `JWT_SECRET`, then set:

```dotenv
JWT_SECRET=<paste-here>
APP_BASE_URL=http://localhost:3001
ALLOWED_ORIGINS=http://localhost:3001
UI_PORT=3001
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_USER=loadtest
MYSQL_PASSWORD=loadtest
MYSQL_DATABASE=loadtest
```

```bash
docker compose up -d mysql
```

### 3. Seed admin & run

```bash
npm run seed:admin -- admin 'YourStr0ng!Pass'
npm run ui
```

Open **http://localhost:3001** → login → run **Sample: HTTP GET**.

```bash
npm test          # unit + integration
npm run test:smoke  # k6 smoke (needs k6)
```

---

## Docker

**MySQL only** (best for local app development):

```bash
docker compose up -d mysql
npm run ui
```

**Full stack** (app + MySQL):

```bash
docker compose --profile full up -d --build
docker compose --profile full exec app node scripts/seed-admin.js admin 'YourStr0ng!Pass'
```

---

## Deploy on a Linux VM

```bash
git clone https://github.com/alirezaedalat/fastertest.git /opt/fastertest
cd /opt/fastertest
sudo bash deploy/install-vm.sh /opt/fastertest
```

```bash
sudo systemctl status fastertest
sudo journalctl -u fastertest -f
```

---

## Project layout

```text
public/          Web UI (Vue)
server/          Express API + WebSocket + stores
tests/scenarios/ k6 scripts (sample included)
deploy/          systemd, nginx, VM install
docs/            API & guides
```

---

## Documentation

| Doc | Description |
| --- | --- |
| [UI_PANEL.md](./UI_PANEL.md) | Dashboard guide |
| [docs/API.md](./docs/API.md) | REST + WebSocket |
| [docs/BEST_PRACTICES.md](./docs/BEST_PRACTICES.md) | Load-testing practices |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](./SECURITY.md) | Vulnerability reporting |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | Community standards |
| [docs/GROWTH.md](./docs/GROWTH.md) | How to publish & grow stars |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes |

---

## Contributing

PRs and issues are welcome — especially:

- Better sample scenarios
- UI/UX polish
- Docs & translations
- Integrations (Grafana, Slack, etc.)

```bash
npm run lint
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Security notes

- Never commit `.env` or database dumps
- Rotate `JWT_SECRET` per deployment
- Only load-test systems you are authorized to test
- Prefer MySQL for shared / production installs

---

## License

ISC — see [LICENSE](./LICENSE).

## Authors

FasterTest Contributors
