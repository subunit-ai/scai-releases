#!/usr/bin/env bash
# All source output is captured by run-confidential.sh; only encrypted evidence is uploaded.
set -euo pipefail
: "${RUNNER_TEMP:?runner temp required}"
umask 077
work_root=$(realpath "$(mktemp -d "$RUNNER_TEMP/scai-radar-work.XXXXXXXX")")
proof_root=$(realpath "$(mktemp -d "$RUNNER_TEMP/scai-radar-proof.XXXXXXXX")")
status=0
node "$(dirname -- "$0")/run-radar-proof.mjs" "$work_root" "$proof_root" || status=$?
if [[ -n "${SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:-}" ]]; then
  seal_status=0
  node "$(dirname -- "$0")/seal-private-proof.mjs" "$proof_root" radar "$status" || seal_status=$?
  if [[ "$seal_status" == 0 && -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'encrypted_visual_receipt=true\n' >> "$GITHUB_OUTPUT" || seal_status=$?
  fi
  if [[ "$status" == 0 && "$seal_status" != 0 ]]; then status=$seal_status; fi
fi
exit "$status"
