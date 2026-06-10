#!/usr/bin/env bash
# Sync the vendored OpenAPI contract from a running agentos-api or a local agos checkout.
#
#   ./scripts/sync-contract.sh                      # copy from ../agos checkout (default)
#   AGOS_DIR=/path/to/agos ./scripts/sync-contract.sh
#   API_URL=http://localhost:8080 ./scripts/sync-contract.sh   # curl a running server
#
# After syncing, run `npm run generate` to regenerate the typed client.
set -euo pipefail

DEST="$(dirname "$0")/../contract/openapi.json"

if [[ -n "${API_URL:-}" ]]; then
  echo "Fetching contract from ${API_URL}/api/v1/openapi.json"
  curl -fsSL "${API_URL}/api/v1/openapi.json" -o "$DEST"
else
  AGOS_DIR="${AGOS_DIR:-../agos}"
  SRC="${AGOS_DIR}/crates/agentos-api/openapi.json"
  if [[ ! -f "$SRC" ]]; then
    echo "error: contract not found at $SRC — set AGOS_DIR or API_URL" >&2
    exit 1
  fi
  echo "Copying contract from $SRC"
  cp "$SRC" "$DEST"
fi

echo "Wrote $DEST"
echo "Next: npm run generate"
