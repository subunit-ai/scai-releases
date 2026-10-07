#!/usr/bin/env bash
# Checkout one explicitly allowlisted private Fleet repository at an immutable
# commit without exposing the deploy key, Git transport output, or a mutable ref.

set -euo pipefail
set +x

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "usage: checkout-private-source.sh <component> <repository> <source-sha> [component-tag]" >&2
  exit 64
fi

component=$1
source_repo=$2
source_sha=$3
component_tag=${4:-}
if [ -n "$component_tag" ] && ! printf '%s' "$component_tag" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  echo "Ungültiges Komponenten-Tag" >&2
  exit 64
fi

case "$component:$source_repo" in
  u1-chat:git@github.com:subunit-ai/u1-chat.git) ;;
  atlas:git@github.com:subunit-ai/atlas.git) ;;
  subunit-auth:git@github.com:subunit-ai/subunit-auth.git) ;;
  subunit-scai:git@github.com:subunit-ai/subunit-scai.git) ;;
  echo:git@github.com:subunit-ai/echo.git) ;;
  subunit-notch:git@github.com:subunit-ai/subunit-notch.git) ;;
  sonar-tauri:git@github.com:subunit-ai/sonar-tauri.git) ;;
  bridge-tauri:git@github.com:subunit-ai/bridge-tauri.git) ;;
  trace-tauri:git@github.com:subunit-ai/trace-tauri.git) ;;
  *)
    echo "component/repository is not allowlisted" >&2
    exit 64
    ;;
esac

if ! printf '%s' "$source_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "source SHA must be 40 lowercase hexadecimal characters" >&2
  exit 64
fi

if [ -z "${SOURCE_DEPLOY_KEY:-}" ]; then
  echo "::error title=Private checkout unavailable::$component read-only deploy key is missing."
  exit 65
fi

workspace=${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}
temp_root=${RUNNER_TEMP:?RUNNER_TEMP is required}
windows=false
ssh_bin=ssh
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    workspace=$(cygpath -u "$workspace")
    temp_root=$(cygpath -u "$temp_root")
    windows=true
    ;;
esac
script_dir=$(dirname -- "$0")
script_dir=$(cd -- "$script_dir" && pwd)
private_root="$workspace/private"
destination="$private_root/$component"
key_file="$temp_root/scai-$component-deploy-key"
known_hosts="$temp_root/scai-$component-known-hosts"
windows_host_entry=''
windows_host_separator=''
github_ed25519_fingerprint="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"

if [ -e "$destination" ]; then
  echo "private checkout destination already exists" >&2
  exit 66
fi

if [ "$windows" = true ]; then
  mkdir -p "$HOME/.ssh"
  # A unique key per invocation; never overwrite an existing user's key.
  key_file=$(mktemp "$HOME/.ssh/scai-$component-deploy-key.XXXXXX")
fi

# shellcheck disable=SC2329 # invoked by trap
cleanup() {
  rm -f "$key_file" "$known_hosts"
  if [ -n "$windows_host_entry" ]; then
    # Remove only our uniquely marked line; preserve all pre-existing hosts.
    node - "$HOME/.ssh/known_hosts" "$windows_host_entry" "$windows_host_separator" <<'NODE'
const fs = require('node:fs');
const [path, entry, separator] = process.argv.slice(2);
const contents = fs.readFileSync(path, 'utf8');
fs.writeFileSync(path, contents.replace(`${separator}${entry}\n`, ''));
NODE
  fi
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$private_root"
chmod 700 "$private_root"
printf '%s\n' "$SOURCE_DEPLOY_KEY" > "$key_file"
chmod 600 "$key_file"
# OpenSSH >= 10 (macOS-Runner) schreibt die Banner-Kommentarzeile auf stdout;
# nur Schluesselzeilen zaehlen, die Pruefung auf genau EINEN gepinnten Schluessel bleibt.
{ ssh-keyscan -t ed25519 github.com 2>/dev/null || true; } | { grep -v '^#' || true; } > "$known_hosts"
chmod 600 "$known_hosts"

host_key_count=$(wc -l < "$known_hosts" | tr -d '[:space:]')
actual_fingerprint=$(ssh-keygen -lf "$known_hosts" -E sha256 | awk 'NR == 1 { print $2 }')
if [ "$host_key_count" != "1" ] || [ "$actual_fingerprint" != "$github_ed25519_fingerprint" ]; then
  echo "::error title=GitHub host verification failed::The pinned GitHub ED25519 host fingerprint did not match."
  exit 68
fi

# Git reparses this command through a shell: quote every path, including spaces
# and apostrophes, rather than relying on the outer assignment's quotes.
printf -v ssh_command '%q' "$ssh_bin"
printf -v key_arg '%q' "$key_file"
printf -v hosts_arg '%q' "UserKnownHostsFile=$known_hosts"
if [ "$windows" = true ]; then
  windows_host_entry="$(cat "$known_hosts") scai-checkout-${key_file##*/}"
  if [ -s "$HOME/.ssh/known_hosts" ] && [ -n "$(tail -c 1 "$HOME/.ssh/known_hosts")" ]; then
    windows_host_separator=$'\n'
  fi
  printf '%s%s\n' "$windows_host_separator" "$windows_host_entry" >> "$HOME/.ssh/known_hosts"
  # Match build-all.yml: use Git Bash's PATH ssh and its default known_hosts.
  export GIT_SSH_COMMAND="ssh -i $key_arg -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
else
  export GIT_SSH_COMMAND="$ssh_command -i $key_arg -o IdentitiesOnly=yes -o $hosts_arg -o StrictHostKeyChecking=yes"
fi
git init -q "$destination"
if [ "$windows" = true ]; then
  git -C "$destination" config core.autocrlf false
  git -C "$destination" config core.eol lf
fi
git -C "$destination" remote add origin "$source_repo"
bash "$script_dir/run-confidential.sh" "checkout-$component-fetch" \
  git -C "$destination" fetch --depth 1 origin "$source_sha"
bash "$script_dir/run-confidential.sh" "checkout-$component-detach" \
  git -C "$destination" checkout --detach FETCH_HEAD

actual_sha=$(git -C "$destination" rev-parse HEAD)
if [ "$actual_sha" != "$source_sha" ]; then
  echo "::error title=Private checkout drift::$component expected $source_sha but received $actual_sha."
  exit 67
fi

# Tag-Objekte (auch annotierte Tags) zum Commit auflösen, solange der read-only Key lebt.
if [ -n "$component_tag" ]; then
  bash "$script_dir/run-confidential.sh" "checkout-$component-tag" \
    git -C "$destination" fetch --depth 1 -- origin "refs/tags/$component_tag"
  tag_sha=$(git -C "$destination" rev-parse 'FETCH_HEAD^{commit}')
  if [ "$tag_sha" != "$source_sha" ]; then
    echo "::error::Komponenten-Tag stimmt nicht mit dem Pin überein."
    exit 67
  fi
fi

git -C "$destination" remote remove origin
cleanup
trap - EXIT HUP INT TERM
unset GIT_SSH_COMMAND SOURCE_DEPLOY_KEY
echo "PASS private-checkout-$component (source-sha=$actual_sha)"
