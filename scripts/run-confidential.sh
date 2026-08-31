#!/usr/bin/env bash
# Execute a command without copying its potentially source-bearing output into a
# public GitHub Actions log. The temporary log exists only for the lifetime of
# this process and is removed on both success and failure.

set -u
set +x

if [ "$#" -lt 2 ]; then
  echo "usage: run-confidential.sh <label> <command> [args...]" >&2
  exit 64
fi

label=$1
shift

case "$label" in
  *[!A-Za-z0-9._-]*|'')
    echo "invalid confidential command label" >&2
    exit 64
    ;;
esac

temp_root=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
log_dir="$temp_root/scai-confidential-logs"
mkdir -p "$log_dir"
log_file="$log_dir/${label}-$$.log"
diagnostic_path=${SCAI_ENCRYPTED_DIAGNOSTIC_PATH:-}
diagnostic_key=${SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:-}

if { [ -n "$diagnostic_path" ] && [ -z "$diagnostic_key" ]; } \
  || { [ -z "$diagnostic_path" ] && [ -n "$diagnostic_key" ]; }; then
  echo "encrypted diagnostic path and public key must be configured together" >&2
  exit 64
fi
if [ -n "$diagnostic_path" ]; then
  case "$diagnostic_path" in
    "$temp_root"/*) ;;
    *) echo "encrypted diagnostic path must stay below RUNNER_TEMP" >&2; exit 64 ;;
  esac
  if [ -L "$diagnostic_path" ]; then
    echo "encrypted diagnostic path must not be a symlink" >&2
    exit 64
  fi
fi

# shellcheck disable=SC2329 # invoked by trap
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT HUP INT TERM

"$@" >"$log_file" 2>&1
status=$?

if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum <"$log_file" | cut -d ' ' -f 1)
else
  digest=$(shasum -a 256 <"$log_file" | cut -d ' ' -f 1)
fi
bytes=$(wc -c <"$log_file" | tr -d '[:space:]')

if [ "$status" -eq 0 ]; then
  echo "PASS $label (private-log-sha256=$digest, bytes=$bytes)"
else
  if [ -n "$diagnostic_path" ]; then
    if ! node "$(dirname -- "$0")/encrypt-confidential-log.mjs" \
      "$log_file" "$diagnostic_path" "$diagnostic_key"; then
      echo "::error title=Encrypted diagnostic unavailable::Failed to seal $label; private output remains suppressed and no diagnostic may be uploaded."
      exit 70
    fi
    echo "PASS $label: private failure log sealed to the supplied one-time public key."
  fi
  echo "::error title=Confidential check failed::$label failed with exit $status; private output suppressed (sha256=$digest, bytes=$bytes). Reproduce at the pinned source SHA in the private worktree."
fi

exit "$status"
