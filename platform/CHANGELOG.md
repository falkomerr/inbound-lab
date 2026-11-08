# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Full k6 AGPL-3.0 text (`licenses/k6/AGPL-3.0.txt`) and FasterTest ISC copy under `licenses/`
- Docker image ships licenses at `/usr/share/licenses/{fastertest,k6}/` plus notices
- OCI labels: `ISC AND AGPL-3.0`, `io.fastertest.k6.license`, `io.fastertest.k6.source`
- Compliance docs: `docs/LEGAL.md`, `docs/TRADEMARKS.md`, `docs/RELEASE_COMPLIANCE.md`
- Automated license compliance tests + optional `scripts/check-image-licenses.sh`
- `THIRD_PARTY_NOTICES.md` and Grafana/k6 trademark disclaimer in README
- Pinned k6 **v1.8.0** in Docker (SHA256-verified GitHub release binary, amd64/arm64)
- OCI image labels, `dumb-init`, graceful SIGTERM/SIGINT shutdown
- `/api/health` and `/api/version` now report k6 / app version metadata
- Compose hardening: required DB passwords, `cap_drop`, `no-new-privileges`, read-only app rootfs,
  resource limits

### Changed

- README independence notice clarified (not an official Grafana/k6 product)
- `org.opencontainers.image.licenses` no longer ISC-only when k6 is bundled
- Docker no longer installs unpinned `apt` k6 from `dl.k6.io` (that path failed on some arches)

### Added (earlier)

- **FasterTest** branding and official logo assets
- MySQL storage backend for users, invites, password resets, audit log, and access control
- Automatic schema migration on server start (`npm run db:migrate`)
- JSON → MySQL import (`npm run db:migrate-json`)
- Docker Compose MySQL service (host port `3307` by default)
- Optional full-stack Docker profile (`app` + `mysql`)
- GitHub Actions CI (lint, tests, UI build)
- Open-source community files (`SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates)

### Changed (earlier)

- Store APIs are async; JSON files remain available when MySQL is not configured

## [1.0.0] - 2026-08-05

### Added

- Initial open-source release: k6 UI, JWT/RBAC, invites, audit log, cURL import, VM deploy scripts
