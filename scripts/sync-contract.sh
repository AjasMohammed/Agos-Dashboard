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
EVENTS_DEST="$(dirname "$0")/../contract/events.json"

if [[ -n "${API_URL:-}" ]]; then
  echo "Fetching contract from ${API_URL}/api/v1/openapi.json"
  curl -fsSL "${API_URL}/api/v1/openapi.json" -o "$DEST"
  echo "note: events catalog not served over HTTP — keeping committed contract/events.json" >&2
else
  AGOS_DIR="${AGOS_DIR:-../agos}"
  SRC="${AGOS_DIR}/crates/agentos-api/openapi.json"
  EVENTS_SRC="${AGOS_DIR}/crates/agentos-api/events.json"
  if [[ ! -f "$SRC" ]]; then
    echo "error: contract not found at $SRC — set AGOS_DIR or API_URL" >&2
    exit 1
  fi
  echo "Copying contract from $SRC"
  cp "$SRC" "$DEST"
  if [[ -f "$EVENTS_SRC" ]]; then
    echo "Copying events catalog from $EVENTS_SRC"
    cp "$EVENTS_SRC" "$EVENTS_DEST"
  else
    echo "note: $EVENTS_SRC missing — run 'cargo run -p agentos-api --bin gen-events' in agos first" >&2
  fi
fi

echo "Wrote $DEST"
echo "Next: npm run generate && npm run generate:events"
