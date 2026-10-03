#!/usr/bin/env bash
# Trusted gate creates a new private evidence directory; it never uploads raw proof.
set -euo pipefail
: "${RUNNER_TEMP:?runner temp required}"
umask 077
proof_root=$(mktemp -d "$RUNNER_TEMP/scai-agents-os-proof.XXXXXXXX")
export SCAI_OS_DURABLE_UI_PROOF_ROOT
SCAI_OS_DURABLE_UI_PROOF_ROOT=$(realpath "$proof_root")
exec node scripts/lib/agent-operations-os-durable-proof.mjs
