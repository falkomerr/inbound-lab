# Load Test Platform — Node UI + k6
# Load is generated FROM this container (not from the browser).

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:ui

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://dl.k6.io/key.gpg | gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
    > /etc/apt/sources.list.d/k6.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends k6 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --create-home --uid 10001 loadtest

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY package.json package-lock.json ./
COPY config ./config
COPY server ./server
COPY scripts ./scripts
COPY utils ./utils
COPY tests/scenarios ./tests/scenarios
COPY env.example ./env.example

RUN mkdir -p reports logs data \
  && chown -R loadtest:loadtest /app

USER loadtest
ENV NODE_ENV=production \
    UI_PORT=3001 \
    STORAGE_BACKEND=mysql

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${UI_PORT:-3001}/api/health" || exit 1

CMD ["node", "server/index.js"]
