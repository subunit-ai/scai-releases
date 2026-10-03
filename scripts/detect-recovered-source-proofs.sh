#!/usr/bin/env bash
# An older ref without either feature remains valid; a half contract never skips.
set -euo pipefail
[[ $# -eq 1 && -d "$1" ]] || exit 64
root=$1
while IFS='|' read -r output source_file marker harness; do
  feature=false; proof=false
  if [[ -f "$root/$source_file" ]] && grep -Fq -- "$marker" "$root/$source_file"; then feature=true; fi
  [[ ! -f "$root/$harness" ]] || proof=true
  if [[ "$feature" != "$proof" ]]; then
    printf 'Recovered source/proof pair incomplete: %s\n' "$output" >&2
    exit 65
  fi
  printf '%s=%s\n' "$output" "$feature"
done <<'CONTRACTS'
email_full_peek|src/lib/workspaceMail.ts|export async function workspaceMailFullPeek(|scripts/verify-email-full-peek.mjs
backoffice_capacity|src/lib/operations.ts|listProjectAllocations: async|scripts/verify-backoffice-capacity-list.mjs
agents_os|src/plugins/agents/index.tsx|import { OsSurface } from "./os/surface";|scripts/lib/agent-operations-os-durable-proof.mjs
workforce_coordination|src/plugins/projects/ProjectsRoot.tsx|import { CoordinationDesk } from "./CoordinationDesk";|scripts/verify-workforce-coordination.mjs
native_usage_core|src-tauri/src/lib.rs|mod native_usage;|src-tauri/crates/native-usage-harness/Cargo.toml
CONTRACTS
