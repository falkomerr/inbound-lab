#!/usr/bin/env bash
# Install B2B Load Test Platform on a Linux VM (Ubuntu/Debian).
# Tests run ON this VM via k6 — users only open the web UI in a browser.
#
# Usage (on the VM):
#   curl -fsSL .../install-vm.sh | bash
#   # or from a cloned repo:
#   sudo bash deploy/install-vm.sh /opt/load-test-platform
#
set -euo pipefail

INSTALL_DIR="${1:-/opt/load-test-platform}"
SERVICE_USER="${SERVICE_USER:-loadtest}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "==> B2B Load Test Platform — VM install"
echo "    Install dir: ${INSTALL_DIR}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-vm.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git gnupg

# Node.js LTS
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi

echo "==> Node $(node -v), npm $(npm -v)"

# Service user
if ! id "${SERVICE_USER}" &>/dev/null; then
  useradd --system --home-dir "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

# App directory
mkdir -p "${INSTALL_DIR}"
if [[ -f "${INSTALL_DIR}/package.json" ]]; then
  echo "==> Using existing app at ${INSTALL_DIR}"
else
  echo "==> Copy project files into ${INSTALL_DIR} (git clone or rsync) before re-running."
  echo "    Example: git clone <repo-url> ${INSTALL_DIR}"
  exit 1
fi

cd "${INSTALL_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

# Vue + Chart.js: dev uses import map + /vendor; production uses `npm run build:ui` bundle
sudo -u "${SERVICE_USER}" npm ci
sudo -u "${SERVICE_USER}" npm run build:ui
sudo -u "${SERVICE_USER}" npm prune --omit=dev 2>/dev/null || true
sudo -u "${SERVICE_USER}" node scripts/install-k6.js

mkdir -p reports logs data
chown -R "${SERVICE_USER}:${SERVICE_USER}" reports logs data

if [[ ! -f .env ]]; then
  cp deploy/env.vm.example .env
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i "s/REPLACE_WITH_LONG_RANDOM_SECRET/${JWT}/" .env
  chown "${SERVICE_USER}:${SERVICE_USER}" .env
  echo "==> Created .env — edit APP_BASE_URL and ALLOWED_ORIGINS for your VM IP/hostname"
fi

# systemd
cp deploy/load-test-platform.service /etc/systemd/system/load-test-platform.service
systemctl daemon-reload
systemctl enable load-test-platform
systemctl restart load-test-platform

HEALTH_PORT=$(grep -E '^UI_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '"' || echo 3001)
if curl -sf "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null; then
  echo "==> Health check OK: http://127.0.0.1:${HEALTH_PORT}/api/health"
else
  echo "==> WARNING: health check failed — see: journalctl -u load-test-platform -n 50"
fi

echo ""
echo "Optional: install log rotation for logs/ and reports/"
echo "  sudo cp deploy/logrotate.conf.example /etc/logrotate.d/load-test-platform"

echo ""
echo "==> Service status:"
systemctl --no-pager status load-test-platform || true

VM_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "================================================================"
echo " Platform is running on this VM."
echo " 1. Edit ${INSTALL_DIR}/.env:"
echo "      APP_BASE_URL=http://${VM_IP:-YOUR_IP}:3001"
echo "      ALLOWED_ORIGINS=http://${VM_IP:-YOUR_IP}:3001"
echo " 2. Create admin (once):"
echo "      cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} node scripts/seed-admin.js admin 'YourStr0ng!Pass'"
echo " 3. Open in browser: http://${VM_IP:-YOUR_IP}:3001"
echo " 4. Optional nginx + HTTPS: see deploy/nginx-loadtest.conf.example"
echo "================================================================"
