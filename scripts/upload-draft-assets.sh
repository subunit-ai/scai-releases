#!/usr/bin/env bash
set -euo pipefail

: "${REPO:?REPO muss gesetzt sein}"
: "${TAG:?TAG muss gesetzt sein}"
: "${SOURCE_SHA:?SOURCE_SHA muss gesetzt sein}"
: "${RELEASE_ID:?RELEASE_ID muss gesetzt sein}"
: "${DISTRIBUTION_POLICY:?DISTRIBUTION_POLICY muss gesetzt sein}"

if [ "$#" -eq 0 ]; then
  echo "::error::Mindestens ein Draft-Asset ist erforderlich."
  exit 1
fi
if ! printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$'; then
  echo "::error::Ungültiger Release-Tag: $TAG"
  exit 1
fi
if ! printf '%s' "$SOURCE_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "::error::Ungültiger Source-SHA."
  exit 1
fi
if ! printf '%s' "$RELEASE_ID" | grep -Eq '^scai-candidate-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$'; then
  echo "::error::Ungültige Fleet-Release-ID: $RELEASE_ID"
  exit 1
fi
case "$DISTRIBUTION_POLICY" in
  market-ready|legacy-v0.125) ;;
  *) echo "::error::Ungültige Distribution-Policy: $DISTRIBUTION_POLICY"; exit 1 ;;
esac

RELEASE=$(gh release view "$TAG" -R "$REPO" --json isDraft,tagName,body)
if [ "$(jq -r .isDraft <<<"$RELEASE")" != "true" ]; then
  echo "::error::Release $TAG ist bereits veröffentlicht — Assets werden niemals überschrieben."
  exit 1
fi
if [ "$(jq -r .tagName <<<"$RELEASE")" != "$TAG" ]; then
  echo "::error::Release-Tag stimmt nicht mit $TAG überein."
  exit 1
fi
BODY=$(jq -r .body <<<"$RELEASE")
for binding in \
  "Source-SHA: $SOURCE_SHA" \
  "Fleet-Release-ID: $RELEASE_ID" \
  "Distribution-Policy: $DISTRIBUTION_POLICY"; do
  if ! printf '%s' "$BODY" | grep -Fq "$binding"; then
    echo "::error::Draft $TAG besitzt nicht die erwartete Bindung: $binding"
    exit 1
  fi
done

for asset in "$@"; do
  if [ ! -f "$asset" ] || [[ "$asset" == -* ]] || [[ "$asset" == *$'\n'* ]]; then
    echo "::error::Ungültiger Draft-Asset-Pfad."
    exit 1
  fi
done

gh release upload "$TAG" "$@" -R "$REPO" --clobber
