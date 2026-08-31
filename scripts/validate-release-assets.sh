#!/usr/bin/env bash
# Print the exact, closed release-asset set for one supported Tauri target.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: validate-release-assets.sh <target> <bundle-root>" >&2
  exit 64
fi

target=$1
bundle_root=$2
test -d "$bundle_root"

assets=()
while IFS= read -r -d '' candidate; do
  test -f "$candidate"
  test ! -L "$candidate"
  test -s "$candidate"
  case "$(basename "$candidate")" in
    *.dmg|*.app.tar.gz|*.app.tar.gz.sig|*-setup.exe|*-setup.exe.sig|*.AppImage|*.AppImage.sig|*.deb|*.deb.sig)
      assets+=("$candidate")
      ;;
  esac
done < <(find "$bundle_root" -type f -print0)

count_suffix() {
  local suffix=$1 count=0 asset
  for asset in "${assets[@]}"; do
    [[ "$(basename "$asset")" == *"$suffix" ]] && count=$((count + 1))
  done
  printf '%s' "$count"
}

case "$target" in
  aarch64-apple-darwin)
    test "$(count_suffix .dmg)" -eq 1
    test "$(count_suffix .app.tar.gz)" -eq 1
    test "$(count_suffix .app.tar.gz.sig)" -eq 1
    printf '%s\n' "${assets[@]}" | grep -Eq '/SCAI_[^/]*_aarch64\.dmg$'
    printf '%s\n' "${assets[@]}" | grep -Eq '/SCAI_aarch64\.app\.tar\.gz$'
    printf '%s\n' "${assets[@]}" | grep -Eq '/SCAI_aarch64\.app\.tar\.gz\.sig$'
    test "$(printf '%s\n' "${assets[@]}" | grep -Ec '/SCAI_(aarch64|x64)\.app\.tar\.gz(\.sig)?$')" -eq 2
    test "${#assets[@]}" -eq 3
    ;;
  x86_64-apple-darwin)
    test "$(count_suffix .dmg)" -eq 1
    test "$(count_suffix .app.tar.gz)" -eq 1
    test "$(count_suffix .app.tar.gz.sig)" -eq 1
    printf '%s\n' "${assets[@]}" | grep -Eq '/SCAI_[^/]*_x64\.dmg$'
    printf '%s\n' "${assets[@]}" | grep -Eq '/SCAI_x64\.app\.tar\.gz$'
    printf '%s\n' "${assets[@]}" | grep -Eq '/SCAI_x64\.app\.tar\.gz\.sig$'
    test "$(printf '%s\n' "${assets[@]}" | grep -Ec '/SCAI_(aarch64|x64)\.app\.tar\.gz(\.sig)?$')" -eq 2
    test "${#assets[@]}" -eq 3
    ;;
  *-pc-windows-msvc)
    test "$(count_suffix -setup.exe)" -eq 1
    test "$(count_suffix -setup.exe.sig)" -eq 1
    test "${#assets[@]}" -eq 2
    ;;
  *-unknown-linux-gnu)
    test "$(count_suffix .AppImage)" -eq 1
    test "$(count_suffix .AppImage.sig)" -eq 1
    test "$(count_suffix .deb)" -eq 1
    test "$(count_suffix .deb.sig)" -eq 1
    test "${#assets[@]}" -eq 4
    ;;
  *)
    echo "unsupported release target" >&2
    exit 65
    ;;
esac

printf '%s\n' "${assets[@]}"
