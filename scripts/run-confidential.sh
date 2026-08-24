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

# shellcheck disable=SC2329 # invoked by trap
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT HUP INT TERM

"$@" >"$log_file" 2>&1
status=$?

if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$log_file" | cut -d ' ' -f 1)
else
  digest=$(shasum -a 256 "$log_file" | cut -d ' ' -f 1)
fi
bytes=$(wc -c <"$log_file" | tr -d '[:space:]')

if [ "$status" -eq 0 ]; then
  echo "PASS $label (private-log-sha256=$digest, bytes=$bytes)"
else
  echo "::error title=Confidential check failed::$label failed with exit $status; private output suppressed (sha256=$digest, bytes=$bytes). Reproduce at the pinned source SHA in the private worktree."
fi

exit "$status"
