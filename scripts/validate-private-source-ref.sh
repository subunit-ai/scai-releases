#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error::Ungültige Source-Referenz. Erlaubt sind main, session/*, Tags und vollständige 40-Zeichen-SHAs." >&2
  exit 2
}

[[ $# -eq 1 ]] || fail
source_ref=$1
[[ -n "$source_ref" && "$source_ref" != -* ]] || fail

case "$source_ref" in
  main)
    ;;
  refs/tags/*)
    [[ "$source_ref" =~ ^refs/tags/[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || fail
    git check-ref-format "$source_ref" >/dev/null 2>&1 || fail
    ;;
  session/*)
    [[ "$source_ref" =~ ^session/[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || fail
    git check-ref-format --branch "$source_ref" >/dev/null 2>&1 || fail
    ;;
  v[0-9]*)
    [[ "$source_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9][A-Za-z0-9.-]*)?$ ]] || fail
    git check-ref-format "refs/tags/$source_ref" >/dev/null 2>&1 || fail
    ;;
  *)
    [[ "$source_ref" =~ ^[0-9a-f]{40}$ ]] || fail
    ;;
esac
