#!/usr/bin/env bash
# Optional: verify license files + OCI labels inside a built image.
# Usage: ./scripts/check-image-licenses.sh fastertest:audit
set -euo pipefail

IMAGE="${1:-fastertest:audit}"

echo "Checking image: ${IMAGE}"

docker image inspect "${IMAGE}" --format '{{index .Config.Labels "org.opencontainers.image.licenses"}}' | tee /tmp/ft-lic.txt
grep -q 'AGPL-3.0' /tmp/ft-lic.txt
grep -q 'ISC' /tmp/ft-lic.txt
if grep -qx 'ISC' /tmp/ft-lic.txt; then
  echo "ERROR: org.opencontainers.image.licenses is ISC-only" >&2
  exit 1
fi

docker image inspect "${IMAGE}" --format '{{index .Config.Labels "io.fastertest.k6.version"}}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$'
docker image inspect "${IMAGE}" --format '{{index .Config.Labels "io.fastertest.k6.license"}}' | grep -q 'AGPL-3.0'
docker image inspect "${IMAGE}" --format '{{index .Config.Labels "io.fastertest.k6.source"}}' | grep -q 'grafana/k6'

docker run --rm --entrypoint sh "${IMAGE}" -c '
  test -f /usr/share/licenses/fastertest/ISC.txt &&
  test -f /usr/share/licenses/k6/AGPL-3.0.txt &&
  test -f /usr/share/licenses/THIRD_PARTY_NOTICES.md &&
  test -f /app/THIRD_PARTY_NOTICES.md &&
  grep -q "GNU AFFERO GENERAL PUBLIC LICENSE" /usr/share/licenses/k6/AGPL-3.0.txt &&
  k6 version
'

echo "Image license compliance checks passed."
