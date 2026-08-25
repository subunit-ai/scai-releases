#!/usr/bin/env bash
# Checkout one explicitly allowlisted private Fleet repository at an immutable
# commit without exposing the deploy key, Git transport output, or a mutable ref.

set -euo pipefail
set +x

if [ "$#" -ne 3 ]; then
  echo "usage: checkout-private-source.sh <component> <repository> <source-sha>" >&2
  exit 64
fi

component=$1
source_repo=$2
source_sha=$3

case "$component:$source_repo" in
  u1-chat:git@github.com:subunit-ai/u1-chat.git) ;;
  atlas:git@github.com:subunit-ai/atlas.git) ;;
  subunit-auth:git@github.com:subunit-ai/subunit-auth.git) ;;
  echo:git@github.com:subunit-ai/echo.git) ;;
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
script_dir=$(dirname -- "$0")
script_dir=$(cd -- "$script_dir" && pwd)
private_root="$workspace/private"
destination="$private_root/$component"
key_file="$temp_root/scai-$component-deploy-key"
known_hosts="$temp_root/scai-$component-known-hosts"
github_ed25519_fingerprint="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"

if [ -e "$destination" ]; then
  echo "private checkout destination already exists" >&2
  exit 66
fi

# shellcheck disable=SC2329 # invoked by trap
cleanup() {
  rm -f "$key_file" "$known_hosts"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$private_root"
chmod 700 "$private_root"
printf '%s\n' "$SOURCE_DEPLOY_KEY" > "$key_file"
chmod 600 "$key_file"
ssh-keyscan -t ed25519 github.com > "$known_hosts" 2>/dev/null
chmod 600 "$known_hosts"

host_key_count=$(wc -l < "$known_hosts" | tr -d '[:space:]')
actual_fingerprint=$(ssh-keygen -lf "$known_hosts" -E sha256 | awk 'NR == 1 { print $2 }')
if [ "$host_key_count" != "1" ] || [ "$actual_fingerprint" != "$github_ed25519_fingerprint" ]; then
  echo "::error title=GitHub host verification failed::The pinned GitHub ED25519 host fingerprint did not match."
  exit 68
fi

export GIT_SSH_COMMAND="ssh -i $key_file -o IdentitiesOnly=yes -o UserKnownHostsFile=$known_hosts -o StrictHostKeyChecking=yes"
git init -q "$destination"
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

git -C "$destination" remote remove origin
cleanup
trap - EXIT HUP INT TERM
unset GIT_SSH_COMMAND SOURCE_DEPLOY_KEY
echo "PASS private-checkout-$component (source-sha=$actual_sha)"
