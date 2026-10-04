#!/usr/bin/env bash
# Trusted orchestration only; the pinned private Python proof owns sandbox/sentinels.
set -euo pipefail
set +x
: "${RUNNER_TEMP:?runner temp required}" "${SOURCE_SHA:?source pin required}" "${REQUEST_ID:?request id required}"
: "${SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:?explicit recipient required}"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || exit 64
[[ -z "${SOURCE_DEPLOY_KEY:-}" && -z "${GIT_SSH_COMMAND:-}" ]] || exit 65
proof_args=(--icu)
case "${SCAI_NATIVE_CLI_PROOF_MODE-success}" in
  success) ;;
  late-a-failure-discovery) proof_args+=(--late-a-failure-discovery) ;;
  *) exit 64 ;;
esac
runner_temp=$(realpath "$RUNNER_TEMP")
[[ ! -e "$runner_temp/scai-subunit-scai-deploy-key" && ! -L "$runner_temp/scai-subunit-scai-deploy-key" ]] || exit 65
umask 077
proof_root=$(mktemp -d "$runner_temp/scai-native-cli-proof.XXXXXXXX")
proof_root=$(realpath "$proof_root")
python_home=$(mktemp -d "$runner_temp/scai-native-cli-home.XXXXXXXX")
python_home=$(realpath "$python_home")
host_home=$(realpath "$HOME")
status=0
/usr/bin/env -i PATH=/usr/bin:/bin HOME="$python_home" SCAI_NATIVE_HOST_HOME="$host_home" \
  RUNNER_TEMP="$runner_temp" GITHUB_ACTIONS=true SOURCE_SHA="$SOURCE_SHA" REQUEST_ID="$REQUEST_ID" \
  SCAI_NATIVE_CLI_PROOF_ROOT="$proof_root" \
  /usr/bin/python3 scripts/verify-native-cli-hermetic.py "${proof_args[@]}" || status=$?
seal_status=0
RUNNER_TEMP="$runner_temp" node "$(dirname -- "$0")/seal-private-proof.mjs" "$proof_root" native-cli "$status" || seal_status=$?
if [[ "$seal_status" == 0 && -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'encrypted_visual_receipt=true\n' >> "$GITHUB_OUTPUT" || seal_status=$?
fi
if [[ "$status" == 0 && "$seal_status" != 0 ]]; then status=$seal_status; fi
exit "$status"
