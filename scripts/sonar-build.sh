#!/usr/bin/env bash
# Alle Aufrufe laufen ausschließlich unter run-confidential.sh.
set -euo pipefail
set +x
mode=${1:?}
target=${2:-}
source_root="$GITHUB_WORKSPACE/private/sonar-tauri"
case "$mode" in
  linux-deps)
    sudo apt-get update
    sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
      libxcb1-dev libxcb-render0-dev libxcb-shape0-dev libxcb-xfixes0-dev \
      libxdo-dev libpipewire-0.3-dev clang libgbm-dev libegl1-mesa-dev libwayland-dev
    ;;
  rust-target) rustup target add "$target" ;;
  layout)
    # Cargo erwartet ../trace-src relativ zu src-tauri; keine Quellenweitergabe.
    mkdir "$source_root/trace-src"
    cp -R "$GITHUB_WORKSPACE/private/trace-tauri/." "$source_root/trace-src/"
    ;;
  bridge)
    case "$target" in
      x86_64-unknown-linux-gnu) bun_target=bun-linux-x64; ext='' ;;
      x86_64-pc-windows-msvc|aarch64-pc-windows-msvc) bun_target=bun-windows-x64; ext=.exe ;;
      x86_64-apple-darwin) bun_target=bun-darwin-x64; ext='' ;;
      aarch64-apple-darwin) bun_target=bun-darwin-arm64; ext='' ;;
      *) exit 64 ;;
    esac
    cd "$GITHUB_WORKSPACE/private/bridge-tauri"
    bun install --frozen-lockfile
    mkdir -p "$source_root/src-tauri/binaries"
    out="$source_root/src-tauri/binaries/subunit-bridge-$target$ext"
    bun build src/main.ts --compile --target="$bun_target" --outfile "$out"
    chmod +x "$out"
    # Frisches Laufzeit-Integritätsmanifest wie fetch-sidecars.sh; Bun ist nicht byte-deterministisch.
    node - "$out" "$source_root/scripts/sidecar-sha256.txt" <<'NODE'
const fs = require('node:fs'), crypto = require('node:crypto'), path = require('node:path');
fs.writeFileSync(process.argv[3], `${crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex')}  ${path.basename(process.argv[2])}\n`);
NODE
    ;;
  forge)
    cd "$source_root"
    cargo build --release --locked --manifest-path forge-control/Cargo.toml --target "$target"
    ext=''; case "$target" in *windows*) ext=.exe ;; esac
    cp "forge-control/target/$target/release/forge-control$ext" "src-tauri/binaries/forge-control-$target$ext"
    ;;
  frontend)
    cd "$source_root"
    bun install --frozen-lockfile
    ;;
  mac-sign)
    test -n "${APPLE_CERTIFICATE:-}" && test -n "${APPLE_SIGNING_IDENTITY:-}"
    p12="$RUNNER_TEMP/sonar-sign.p12"
    pem="$RUNNER_TEMP/sonar-sign.pem"
    kc="$RUNNER_TEMP/sonar-build.keychain-db"
    kc_pw=$(openssl rand -hex 24)
    printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$p12"
    security create-keychain -p "$kc_pw" "$kc"
    security default-keychain -s "$kc"
    security unlock-keychain -p "$kc_pw" "$kc"
    security set-keychain-settings -lut 21600 "$kc"
    security import "$p12" -k "$kc" -P "${APPLE_CERTIFICATE_PASSWORD:-}" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kc_pw" "$kc"
    security find-certificate -c "$APPLE_SIGNING_IDENTITY" -p "$kc" > "$pem"
    subject=$(openssl x509 -in "$pem" -noout -subject -nameopt RFC2253)
    issuer=$(openssl x509 -in "$pem" -noout -issuer -nameopt RFC2253)
    # Apple-issued certificates already chain to Apple roots. Only a self-signed
    # certificate needs trustRoot; trust failures remain fatal in that branch.
    if [ "${subject#subject=}" = "${issuer#issuer=}" ]; then
      sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$pem"
    fi
    identities=$(security find-identity -v -p codesigning "$kc")
    if ! printf '%s\n' "$identities" | awk -v identity="$APPLE_SIGNING_IDENTITY" '
      /^[[:space:]]*[0-9]+\) [[:xdigit:]]+ "/ {
        name = $0
        sub(/^[^"]*"/, "", name)
        sub(/"[[:space:]]*$/, "", name)
        if (name == identity) found = 1
      }
      END { exit !found }
    '; then
      echo "::error::Requested macOS codesigning identity is not valid in the build keychain." >&2
      exit 65
    fi
    rm -f "$p12" "$pem"
    ;;
  windows-sign)
    cd "$source_root"
    pwsh -NoProfile -File scripts/win-authenticode-prep.ps1
    ;;
  tauri)
    test -n "${TAURI_SIGNING_PRIVATE_KEY:-}"
    cd "$source_root"
    case "$target" in
      *apple-darwin) bundles=app,dmg; test -n "${APPLE_SIGNING_IDENTITY:-}" ;;
      *windows-msvc) bundles=nsis ;;
      x86_64-unknown-linux-gnu) bundles=deb ;;
      *) exit 64 ;;
    esac
    bun run tauri build --target "$target" --bundles "$bundles"
    if [[ "$target" == *apple-darwin ]]; then
      codesign --verify --strict --deep "src-tauri/target/$target/release/bundle/macos/Sonar.app"
      codesign -dv "src-tauri/target/$target/release/bundle/macos/Sonar.app" 2>&1 | grep -F "Authority=$APPLE_SIGNING_IDENTITY"
    fi
    ;;
  cleanup)
    # Ausschließlich von diesem Job erzeugte temporäre Checkouts/Signierdateien entfernen.
    if [ -f "$RUNNER_TEMP/sonar-build.keychain-db" ]; then security delete-keychain "$RUNNER_TEMP/sonar-build.keychain-db"; fi
    rm -rf "$GITHUB_WORKSPACE/private"
    rm -f "$RUNNER_TEMP/sonar-sign.p12" "$RUNNER_TEMP/sonar-sign.pem"
    ;;
  *) exit 64 ;;
esac
