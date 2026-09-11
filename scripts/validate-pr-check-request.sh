#!/usr/bin/env bash
# Optional correlation contract. Existing callers without request_id keep ref support.
set -euo pipefail
SOURCE_REF="${1:-}"
REQUEST_ID="${2:-}"
if [ -z "$REQUEST_ID" ]; then exit 0; fi
if ! [[ "$SOURCE_REF" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' '::error::request_id requires an exact 40-character private source SHA.' >&2
  exit 1
fi
if ! [[ "$REQUEST_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  printf '%s\n' '::error::request_id must be a lowercase UUIDv4.' >&2
  exit 1
fi
