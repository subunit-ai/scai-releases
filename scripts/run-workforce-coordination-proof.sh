#!/usr/bin/env bash
# Trusted gate creates a new private evidence directory; it never uploads raw proof.
set -euo pipefail
: "${RUNNER_TEMP:?runner temp required}"
umask 077
proof_root=$(mktemp -d "$RUNNER_TEMP/scai-workforce-coordination-proof.XXXXXXXX")
proof_root=$(realpath "$proof_root")
export SCAI_W3C_COORDINATION_PROOF_ROOT
SCAI_W3C_COORDINATION_PROOF_ROOT=$(realpath "$proof_root")
status=0
node scripts/verify-workforce-coordination.mjs || status=$?
if [[ -n "${SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:-}" ]]; then
  seal_status=0
  node "$(dirname -- "$0")/seal-private-proof.mjs" "$proof_root" workforce-coordination "$status" || seal_status=$?
  if [[ "$seal_status" == 0 && -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'encrypted_visual_receipt=true\n' >> "$GITHUB_OUTPUT" || seal_status=$?
  fi
  # A failed proof remains failed, even if sealing also failed.
  if [[ "$status" == 0 && "$seal_status" != 0 ]]; then status=$seal_status; fi
fi
exit "$status"
