#!/usr/bin/env bash
# Execute a fixed-size PASS/FAIL proof without exposing private check names,
# details, paths, or command output. Only zero-based failed check indices leave
# the confidential boundary.

set -u
set +x

if [ "$#" -lt 3 ]; then
  echo "usage: run-indexed-confidential.sh <label> <expected-count> <command> [args...]" >&2
  exit 64
fi

label=$1
expected_count=$2
shift 2

case "$label" in
  *[!A-Za-z0-9._-]*|'')
    echo "invalid confidential command label" >&2
    exit 64
    ;;
esac

case "$expected_count" in
  ''|*[!0-9]*)
    echo "invalid expected check count" >&2
    exit 64
    ;;
esac
if [ "$expected_count" -lt 1 ] || [ "$expected_count" -gt 100 ]; then
  echo "invalid expected check count" >&2
  exit 64
fi

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
  digest=$(sha256sum <"$log_file" | cut -d ' ' -f 1)
else
  digest=$(shasum -a 256 <"$log_file" | cut -d ' ' -f 1)
fi
bytes=$(wc -c <"$log_file" | tr -d '[:space:]')

summary=$(awk '
  /^(PASS|FAIL) / {
    if ($1 == "FAIL") {
      if (failed != "") failed = failed ","
      failed = failed sprintf("%d", count)
    }
    count++
  }
  END { printf "%d;%s", count, failed }
' "$log_file")
actual_count=${summary%%;*}
failed_indices=${summary#*;}

valid=true
if [ "$actual_count" -ne "$expected_count" ]; then
  valid=false
elif [ "$status" -eq 0 ] && [ -n "$failed_indices" ]; then
  valid=false
elif [ "$status" -ne 0 ] && [ -z "$failed_indices" ]; then
  valid=false
fi

if [ "$valid" != true ]; then
  echo "::error title=Indexed confidential check rejected::$label produced an invalid indexed proof; private output suppressed (sha256=$digest, bytes=$bytes)."
  exit 70
fi

if [ "$status" -eq 0 ]; then
  echo "PASS $label (private-log-sha256=$digest, bytes=$bytes, checks=$actual_count)"
else
  echo "::error title=Sanitized indexed check failed::$label failed with exit $status; failed-check-indices=$failed_indices; total=$actual_count; private output suppressed (sha256=$digest, bytes=$bytes)."
fi

exit "$status"
