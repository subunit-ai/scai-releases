#!/usr/bin/env bash
# Derselbe versions- und digestgebundene Verifizierer wie build-all.yml.
set -euo pipefail
set +x
archive="$RUNNER_TEMP/minisign-0.12-linux.tar.gz"
curl --fail --location --silent --show-error --output "$archive" \
  https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-linux.tar.gz
printf '%s  %s\n' 9a599b48ba6eb7b1e80f12f36b94ceca7c00b7a5173c95c3efc88d9822957e73 "$archive" | sha256sum -c -
tar -xzf "$archive" -C "$RUNNER_TEMP"
test -x "$RUNNER_TEMP/minisign-linux/x86_64/minisign"
