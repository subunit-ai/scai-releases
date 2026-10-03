#!/usr/bin/env bash
# Trusted gate creates a new private evidence directory; it never uploads raw proof.
set -euo pipefail
: "${RUNNER_TEMP:?runner temp required}"
umask 077
proof_root=$(mktemp -d "$RUNNER_TEMP/scai-workforce-coordination-proof.XXXXXXXX")
export SCAI_W3C_COORDINATION_PROOF_ROOT
SCAI_W3C_COORDINATION_PROOF_ROOT=$(realpath "$proof_root")
exec node scripts/verify-workforce-coordination.mjs
