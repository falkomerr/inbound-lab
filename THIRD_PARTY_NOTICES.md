# Third-Party Notices

FasterTest is an **independent open-source project**.

FasterTest uses **k6** as its load-generation engine. FasterTest is **not** affiliated with,
sponsored by, or endorsed by Grafana Labs. **k6** and **Grafana** are trademarks of their respective
owners.

- FasterTest application source code is licensed under the **ISC License** (see
  [LICENSE](./LICENSE)).
- Bundled or separately installed third-party software remains subject to its own license terms.

## k6 (load-generation engine)

| Field              | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| Software           | k6                                                                             |
| Upstream           | https://github.com/grafana/k6                                                  |
| License            | GNU Affero General Public License v3.0 (AGPL-3.0)                              |
| Copyright          | Copyright (c) Grafana Labs and k6 contributors                                 |
| Docker image pin   | **v1.8.0** (override with build-arg `K6_VERSION`)                              |
| Source (exact pin) | https://github.com/grafana/k6/tree/v1.8.0                                      |
| Release assets     | https://github.com/grafana/k6/releases/tag/v1.8.0                              |
| Checksums          | https://github.com/grafana/k6/releases/download/v1.8.0/k6-v1.8.0-checksums.txt |

k6 is installed into FasterTest Docker images as a **prebuilt binary** verified by SHA256. It is not
part of the FasterTest ISC-licensed source tree. Operators who redistribute container images that
include k6 should review AGPL-3.0 obligations for that binary.

Local development typically installs k6 separately (`npm run install:k6` or
https://grafana.com/docs/k6/latest/set-up/install-k6/).

## Notable npm runtime dependencies

Licenses below are as declared by upstream packages at the time of writing. Always verify with the
installed `node_modules` / SBOM for a given release.

| Package      | Typical license | Project                                    |
| ------------ | --------------- | ------------------------------------------ |
| express      | MIT             | https://github.com/expressjs/express       |
| ws           | MIT             | https://github.com/websockets/ws           |
| jsonwebtoken | MIT             | https://github.com/auth0/node-jsonwebtoken |
| bcryptjs     | MIT             | https://github.com/dcodeIO/bcrypt.js       |
| mysql2       | MIT             | https://github.com/sidorares/node-mysql2   |
| helmet       | MIT             | https://github.com/helmetjs/helmet         |
| cors         | MIT             | https://github.com/expressjs/cors          |
| dotenv       | BSD-2-Clause    | https://github.com/motdotla/dotenv         |
| pino         | MIT             | https://github.com/pinojs/pino             |
| vue          | MIT             | https://github.com/vuejs/core              |
| chart.js     | MIT             | https://github.com/chartjs/Chart.js        |

DevDependencies (ESLint, Prettier, Vite, etc.) are used for development and CI builds and are not
required at container runtime when images are built with `npm ci --omit=dev`.

## Trademark notice

Grafana Labs, Grafana, and k6 names and logos are trademarks or registered trademarks of Grafana
Labs or their respective owners. FasterTest’s logo and visual identity are independent and are not
copies of Grafana or k6 branding.
