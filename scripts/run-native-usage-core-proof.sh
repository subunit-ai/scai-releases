#!/usr/bin/env bash
# Locked production modules in an isolated target directory; no backend-proof feature.
set -euo pipefail
: "${RUNNER_TEMP:?runner temp required}"
umask 077
proof_root=$(mktemp -d "$RUNNER_TEMP/scai-native-usage-core.XXXXXXXX")
export CARGO_TARGET_DIR CARGO_BUILD_JOBS=1
CARGO_TARGET_DIR=$(realpath "$proof_root")
exec cargo test --locked --manifest-path src-tauri/crates/native-usage-harness/Cargo.toml -- --test-threads=1
