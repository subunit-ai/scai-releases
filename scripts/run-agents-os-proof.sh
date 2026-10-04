#!/usr/bin/env bash
# Trusted gate creates a new private evidence directory; it never uploads raw proof.
set -euo pipefail
: "${RUNNER_TEMP:?runner temp required}"
umask 077
proof_root=$(mktemp -d "$RUNNER_TEMP/scai-agents-os-proof.XXXXXXXX")
proof_root=$(realpath "$proof_root")
export SCAI_OS_DURABLE_UI_PROOF_ROOT
SCAI_OS_DURABLE_UI_PROOF_ROOT=$(realpath "$proof_root")
status=0
node scripts/lib/agent-operations-os-durable-proof.mjs || status=$?
# New source revisions retain the historical gate and add the standalone stage.
if [[ -f scripts/verify-karte-stage.mjs ]]; then
  export SCAI_KARTE_STAGE_PROOF_ROOT="$proof_root/karte-stage"
  stage_status=0
  node scripts/verify-karte-stage.mjs || stage_status=$?
  # Preserve the first OS failure; a stage failure must also fail the gate.
  if [[ "$status" == 0 && "$stage_status" != 0 ]]; then status=$stage_status; fi
fi
if [[ -n "${SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:-}" ]]; then
  seal_status=0
  node "$(dirname -- "$0")/seal-private-proof.mjs" "$proof_root" agents-os "$status" || seal_status=$?
  if [[ "$seal_status" == 0 && -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'encrypted_visual_receipt=true\n' >> "$GITHUB_OUTPUT" || seal_status=$?
  fi
  # A failed proof remains failed, even if sealing also failed.
  if [[ "$status" == 0 && "$seal_status" != 0 ]]; then status=$seal_status; fi
fi
exit "$status"
