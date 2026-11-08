# FasterTest — Node UI + pinned k6
# Load is generated FROM this container (not from the browser).
#
# Build:
#   docker build -t fastertest:local .
# Override k6 (also update checksum ARGs + THIRD_PARTY_NOTICES.md):
#   docker build --build-arg K6_VERSION=1.8.0 -t fastertest:local .
#
# Image license note: FasterTest application code is ISC; the bundled k6 binary
# is AGPL-3.0. See THIRD_PARTY_NOTICES.md and /usr/share/licenses/.

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:ui

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime

ARG K6_VERSION=1.8.0
# Official checksums from:
# https://github.com/grafana/k6/releases/download/v1.8.0/k6-v1.8.0-checksums.txt
ARG K6_SHA256_AMD64=a16c98a1b02a5f96cf834d0d03ceeaa974ab25874531f2a494a76bc975dc78a7
ARG K6_SHA256_ARM64=90cc61ec7f05a2764485861095cae343ccab64d30100482236b839292cb5828d
ARG TARGETARCH
ARG APP_VERSION=1.0.0
ARG VCS_REF=unknown
# SPDX expression for the image as a whole (multiple components).
# Upstream GitHub license metadata for grafana/k6@v1.8.0 reports AGPL-3.0.
ARG IMAGE_LICENSES="ISC AND AGPL-3.0"
ARG K6_SOURCE_URL="https://github.com/grafana/k6/tree/v${K6_VERSION}"
ARG K6_SOURCE_ARCHIVE_URL="https://github.com/grafana/k6/archive/refs/tags/v${K6_VERSION}.tar.gz"

LABEL org.opencontainers.image.title="FasterTest" \
  org.opencontainers.image.description="Self-hosted web control plane for running and observing k6 performance tests. Application: ISC. Bundled k6 binary: AGPL-3.0." \
  org.opencontainers.image.source="https://github.com/alirezaedalat/fastertest" \
  org.opencontainers.image.url="https://github.com/alirezaedalat/fastertest" \
  org.opencontainers.image.version="${APP_VERSION}" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.licenses="${IMAGE_LICENSES}" \
  org.opencontainers.image.vendor="FasterTest Contributors" \
  io.fastertest.k6.version="${K6_VERSION}" \
  io.fastertest.k6.license="AGPL-3.0" \
  io.fastertest.k6.source="${K6_SOURCE_URL}"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --create-home --uid 10001 loadtest

# Install pinned k6 binary with SHA256 verification (amd64 / arm64).
RUN set -eux; \
  arch="${TARGETARCH:-}"; \
  if [ -z "$arch" ]; then arch="$(dpkg --print-architecture)"; fi; \
  case "$arch" in \
    amd64|x86_64) k6_arch=amd64; expect_sha="${K6_SHA256_AMD64}" ;; \
    arm64|aarch64) k6_arch=arm64; expect_sha="${K6_SHA256_ARM64}" ;; \
    *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;; \
  esac; \
  url="https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-${k6_arch}.tar.gz"; \
  curl -fsSL "$url" -o /tmp/k6.tar.gz; \
  echo "${expect_sha}  /tmp/k6.tar.gz" | sha256sum -c -; \
  tar -xzf /tmp/k6.tar.gz -C /tmp; \
  install -m 0755 "/tmp/k6-v${K6_VERSION}-linux-${k6_arch}/k6" /usr/local/bin/k6; \
  rm -rf /tmp/k6.tar.gz "/tmp/k6-v${K6_VERSION}-linux-${k6_arch}"; \
  k6 version

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY package.json package-lock.json ./
COPY config ./config
COPY server ./server
COPY scripts ./scripts
COPY utils ./utils
COPY tests/scenarios ./tests/scenarios
COPY env.example ./env.example
COPY LICENSE ./LICENSE
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY licenses ./licenses

# License texts for redistributors (FasterTest ISC + bundled k6 AGPL-3.0).
RUN mkdir -p /usr/share/licenses/fastertest /usr/share/licenses/k6 \
  && cp /app/licenses/fastertest/ISC.txt /usr/share/licenses/fastertest/ISC.txt \
  && cp /app/licenses/k6/AGPL-3.0.txt /usr/share/licenses/k6/AGPL-3.0.txt \
  && cp /app/THIRD_PARTY_NOTICES.md /usr/share/licenses/THIRD_PARTY_NOTICES.md \
  && mkdir -p reports logs data \
  && chown -R loadtest:loadtest /app

ENV NODE_ENV=production \
  UI_PORT=3001 \
  STORAGE_BACKEND=mysql \
  K6_VERSION=${K6_VERSION} \
  APP_VERSION=${APP_VERSION} \
  K6_SOURCE_URL=${K6_SOURCE_URL} \
  K6_SOURCE_ARCHIVE_URL=${K6_SOURCE_ARCHIVE_URL}

USER loadtest
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${UI_PORT:-3001}/api/health" || exit 1

# dumb-init forwards signals to Node and reaps zombies (including k6 children).
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
