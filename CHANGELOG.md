# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MySQL storage backend for users, invites, password resets, audit log, and access control
- Automatic schema migration on server start (`npm run db:migrate`)
- JSON → MySQL import (`npm run db:migrate-json`)
- Docker Compose MySQL service (host port `3307` by default)
- Optional full-stack Docker profile (`app` + `mysql`)
- GitHub Actions CI (lint, tests, UI build)
- Open-source community files (`SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates)

### Changed

- Store APIs are async; JSON files remain available when MySQL is not configured

## [1.0.0] - 2026-08-05

### Added

- Initial open-source release: k6 UI, JWT/RBAC, invites, audit log, cURL import, VM deploy scripts
