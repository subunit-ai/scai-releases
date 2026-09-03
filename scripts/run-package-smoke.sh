#!/usr/bin/env bash
# Install and execute the actual macOS/Linux installer and updater payloads.

set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: run-package-smoke.sh <target> <bundle-root> <version> <source-sha> <output>" >&2
  exit 64
fi

target=$1
bundle_root=$2
version=$3
source_sha=$4
output=$5

test -d "$bundle_root"
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$'
printf '%s' "$source_sha" | grep -Eq '^[0-9a-f]{40}$'
test -n "${RUNNER_TEMP:-}"
mkdir -p "$(dirname "$output")"

# Aufrufer nutzen diese Funktion ausschliesslich in einer Kommandosubstitution
# ("x=$(find_exactly_one ...)"). Darin greift set -e NICHT: ein fehlschlagendes
# `test` beendet die Funktion nicht, sie lief weiter und endete mit dem Status
# des letzten Befehls - also 0. Die Zusicherungen waren damit tot und die
# Schiene nahm bei mehreren Treffern stillschweigend den ersten. Der Ausstieg
# muss deshalb ein explizites `return` sein, das den Status der Substitution
# setzt. Kein `shopt -s inherit_errexit`: die Schiene muss unter Bash 3.2 laufen.
find_exactly_one() {
  root=$1
  kind=$2
  pattern=$3
  count=$(find "$root" -type "$kind" -name "$pattern" -print | awk 'END { print NR + 0 }')
  if [ "$count" -ne 1 ]; then
    echo "run-package-smoke: erwartet genau ein '$pattern' unter $root, gefunden $count" >&2
    return 1
  fi
  candidate=$(find "$root" -type "$kind" -name "$pattern" -print -quit)
  if [ -z "$candidate" ]; then
    echo "run-package-smoke: '$pattern' unter $root nicht auflösbar" >&2
    return 1
  fi
  printf '%s\n' "$candidate"
}

run_product() {
  binary=$1
  evidence=$2
  shift 2
  test -x "$binary"
  if [ "$target" = "x86_64-apple-darwin" ]; then
    test -x /usr/bin/arch
    SCAI_RELEASE_SMOKE_EVIDENCE="$evidence" \
    SCAI_EXPECTED_VERSION="$version" \
    SCAI_EXPECTED_SOURCE_SHA="$source_sha" \
      /usr/bin/arch -x86_64 "$binary" "$@" --release-smoke
  else
    SCAI_RELEASE_SMOKE_EVIDENCE="$evidence" \
    SCAI_EXPECTED_VERSION="$version" \
    SCAI_EXPECTED_SOURCE_SHA="$source_sha" \
      "$binary" "$@" --release-smoke
  fi
  test -s "$evidence"
}

installer_proof="$RUNNER_TEMP/runtime-installer-$target.json"
updater_proof="$RUNNER_TEMP/runtime-updater-$target.json"

case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin)
    installer_artifact=$(find_exactly_one "$bundle_root/dmg" f '*.dmg')
    updater_artifact=$(find_exactly_one "$bundle_root/macos" f '*.app.tar.gz')

    mount_point="$RUNNER_TEMP/scai-dmg-$target"
    install_root="$RUNNER_TEMP/scai-install-$target"
    mkdir -p "$mount_point" "$install_root"
    attached=false
    detach_dmg() {
      if [ "$attached" = true ]; then
        hdiutil detach "$mount_point" >/dev/null
        attached=false
      fi
    }
    trap detach_dmg EXIT
    hdiutil attach -readonly -nobrowse -mountpoint "$mount_point" "$installer_artifact" >/dev/null
    attached=true
    mounted_app=$(find_exactly_one "$mount_point" d '*.app')
    ditto "$mounted_app" "$install_root/SCAI.app"
    detach_dmg
    run_product "$install_root/SCAI.app/Contents/MacOS/subunit-scai" "$installer_proof"

    updater_root="$RUNNER_TEMP/scai-updater-$target"
    mkdir -p "$updater_root"
    tar -xzf "$updater_artifact" -C "$updater_root"
    updater_app=$(find_exactly_one "$updater_root" d '*.app')
    run_product "$updater_app/Contents/MacOS/subunit-scai" "$updater_proof"
    ;;
  x86_64-unknown-linux-gnu)
    installer_artifact=$(find_exactly_one "$bundle_root/deb" f '*.deb')
    updater_artifact=$(find_exactly_one "$bundle_root/appimage" f '*.AppImage')

    install_root="$RUNNER_TEMP/scai-install-$target"
    mkdir -p "$install_root"
    dpkg-deb --extract "$installer_artifact" "$install_root"
    installed_binary=$(find_exactly_one "$install_root" f 'subunit-scai')
    run_product "$installed_binary" "$installer_proof"
    run_product "$updater_artifact" "$updater_proof" --appimage-extract-and-run
    ;;
  *)
    echo "unsupported non-Windows package-smoke target: $target" >&2
    exit 65
    ;;
esac

python3 - "$target" "$version" "$source_sha" "$installer_artifact" "$installer_proof" "$updater_artifact" "$updater_proof" "$output" <<'PY'
import hashlib
import json
import os
import sys

target, version, source_sha, installer, installer_proof, updater, updater_proof, output = sys.argv[1:]

def digest(path):
    result = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()

def package(role, artifact, proof_path):
    with open(proof_path, encoding="utf-8") as handle:
        proof = json.load(handle)
    return {
        "role": role,
        "artifact_basename": os.path.basename(artifact),
        "artifact_sha256": digest(artifact),
        "evidence": proof,
    }

report = {
    "schema_version": "1.0",
    "status": "pass",
    "target": target,
    "version": version,
    "source_sha": source_sha,
    "packages": [
        package("installer", installer, installer_proof),
        package("updater", updater, updater_proof),
    ],
}
with open(output, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")
PY

echo "PASS packaged runtime $target: installer + updater payload started"
