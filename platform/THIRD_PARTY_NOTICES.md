# Third-Party Notices

FasterTest is an **independent open-source project**.

FasterTest uses **k6** as its load-generation engine. FasterTest is **not** affiliated with,
sponsored by, or endorsed by Grafana Labs. FasterTest is **not** an official Grafana or k6 product.
**k6** and **Grafana** are trademarks of their respective owners.

- FasterTest application source code is licensed under the **ISC License** (see [LICENSE](./LICENSE)
  and [licenses/fastertest/ISC.txt](./licenses/fastertest/ISC.txt)).
- Bundled or separately installed third-party software remains subject to its own license terms.
- Different components inside the FasterTest Docker image are covered by **different licenses**
  (FasterTest: ISC; bundled k6 binary: AGPL-3.0).

## k6 (load-generation engine)

| Field                                 | Value                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Software                              | k6                                                                                                     |
| Upstream                              | https://github.com/grafana/k6                                                                          |
| License                               | GNU Affero General Public License v3.0 (SPDX: **AGPL-3.0**, per upstream GitHub metadata for this tag) |
| Copyright                             | Copyright (c) Grafana Labs and k6 contributors                                                         |
| Bundled version (Docker)              | **v1.8.0** (`ARG K6_VERSION` in the Dockerfile)                                                        |
| Git tag (immutable)                   | https://github.com/grafana/k6/tree/v1.8.0                                                              |
| Source archive (corresponding source) | https://github.com/grafana/k6/archive/refs/tags/v1.8.0.tar.gz                                          |
| Release / binary downloads            | https://github.com/grafana/k6/releases/tag/v1.8.0                                                      |
| Checksums                             | https://github.com/grafana/k6/releases/download/v1.8.0/k6-v1.8.0-checksums.txt                         |
| Full AGPL text (this repository)      | [licenses/k6/AGPL-3.0.txt](./licenses/k6/AGPL-3.0.txt)                                                 |
| Full AGPL text (Docker image)         | `/usr/share/licenses/k6/AGPL-3.0.txt`                                                                  |
| Upstream license file                 | https://github.com/grafana/k6/blob/v1.8.0/LICENSE.md                                                   |

### Redistribution statement

The FasterTest container image redistributes an **unmodified** k6 binary obtained from the official
GitHub release assets for the pinned version above, verified with SHA256 checksums during the Docker
build. FasterTest does not modify k6 source code and does not link against k6 as a library; it
executes the binary as a separate child process.

The corresponding source code and the AGPL-3.0 license for the bundled k6 version are available
through the references listed above (Git tag, source archive URL, and the AGPL text shipped in this
repository and in the image under `/usr/share/licenses/k6/`).

**While a FasterTest Docker image that contains this k6 binary is distributed, the corresponding
source for that exact k6 version must remain available** (for example via the immutable GitHub tag /
source archive links above, or by attaching/mirroring `k6-v1.8.0` source archives in FasterTest
GitHub Release assets). Do not rely only on a floating “latest” branch.

FasterTest’s own application code remains ISC-licensed and is separately licensed from k6. This
notice does **not** transfer away FasterTest’s redistribution responsibilities for the bundled
binary; anyone who redistributes the FasterTest image that includes k6 must also respect AGPL-3.0
for that binary.

Local development typically installs k6 separately (`npm run install:k6` or
https://grafana.com/docs/k6/latest/set-up/install-k6/), which may install a different version than
the Docker pin.

## Notable npm runtime dependencies

Licenses below are as declared by upstream packages at the time of writing. Always verify with the
installed `node_modules` / SBOM for a given release. These packages are **not** covered by the
FasterTest ISC license.

| Package      | Typical license | Project                                    |
| ------------ | --------------- | ------------------------------------------ |
| express      | MIT             | https://github.com/expressjs/express       |
| ws           | MIT             | https://github.com/websockets/ws           |
| jsonwebtoken | MIT             | https://github.com/auth0/node-jsonwebtoken |
| bcryptjs     | BSD-3-Clause    | https://github.com/dcodeIO/bcrypt.js       |
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
copies of Grafana or k6 branding. See [docs/TRADEMARKS.md](./docs/TRADEMARKS.md).
