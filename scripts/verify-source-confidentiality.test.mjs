import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateSourceConfidentiality } from "./verify-source-confidentiality.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = Object.fromEntries(
  ["pr-check.yml", "build-all.yml", "windows-arm-smoke.yml"].map((name) => [
    name,
    readFileSync(join(ROOT, ".github/workflows", name), "utf8"),
  ]),
);
const assetSelector = readFileSync(join(ROOT, "scripts/validate-release-assets.sh"), "utf8");

test("current public source workflows fail closed on source confidentiality", () => {
  assert.deepEqual(validateSourceConfidentiality(fixtures, assetSelector), []);
});

test("an automatic public trigger is rejected", () => {
  const unsafe = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace("  workflow_dispatch:", "  pull_request:\n  workflow_dispatch:") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /must not have an automatic or fork trigger/);
});

test("a mutable action can never run beside private source", () => {
  const unsafe = { ...fixtures, "windows-arm-smoke.yml": fixtures["windows-arm-smoke.yml"].replace(/actions\/setup-node@[0-9a-f]{40}/, "actions/setup-node@v4") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /action reference must be immutable/);

  const shorthand = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace(/- uses: dtolnay\/rust-toolchain@[0-9a-f]{40}/, "- uses: dtolnay/rust-toolchain@stable") };
  assert.match(validateSourceConfidentiality(shorthand, assetSelector).join("\n"), /action reference must be immutable/);
});

test("a mutable branch clone cannot stand in for an exact source pin", () => {
  const unsafe = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace('git -C src fetch --depth 1 origin "$SRC_REF"', 'git clone --depth 1 --branch "$SRC_REF" git@github.com:subunit-ai/subunit-scai.git src') };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /mutable branch clone/);
});

test("a source-streaming Tauri action is rejected", () => {
  const unsafe = { ...fixtures, "build-all.yml": `${fixtures["build-all.yml"]}\n      - uses: tauri-apps/tauri-action@${"a".repeat(40)}\n` };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /tauri-action may expose private compiler output/);
});

test("private build outputs cannot enter a public Actions cache", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": `${fixtures["pr-check.yml"]}\n      - uses: swatinem/rust-cache@${"a".repeat(40)}\n`,
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /private build outputs must not enter a public Actions cache/);
});

test("a broad upload cannot replace the release artifact allowlist", () => {
  const unsafe = { ...fixtures, "build-all.yml": fixtures["build-all.yml"].replace('gh release upload "$TAG" "${ASSETS[@]}"', 'gh release upload "$TAG" "$BUNDLE_ROOT"') };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /validated asset array/);
});

test("a widened release filename allowlist is rejected", () => {
  const unsafeSelector = assetSelector.replace("*.dmg|", "*.rs|*.dmg|");
  assert.match(validateSourceConfidentiality(fixtures, unsafeSelector).join("\n"), /closed filename allowlist/);
});

test("Windows ARM diagnostics cannot upload plaintext or a source-tree path", () => {
  const unsafe = {
    ...fixtures,
    "windows-arm-smoke.yml": fixtures["windows-arm-smoke.yml"].replace(
      "path: ${{ runner.temp }}/scai-arm64-diagnostic.json",
      "path: src/private-build.log",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /only a one-time-key encrypted envelope/);
});

test("Trace Windows diagnostics cannot upload plaintext or a source-tree path", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/trace-windows-diagnostic.json",
      "path: trace-src/private-clippy.log",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /Trace Windows diagnostics may upload only a one-time-key encrypted envelope/);
});

test("Pages diagnostics cannot upload plaintext or a source-tree path", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/scai-pages-diagnostic.json",
      "path: src/private-pages.log",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /Pages diagnostics may upload only a one-time-key encrypted envelope/);
});

test("Windows ARM smoke preserves the clang-cl exception flag", () => {
  const unsafe = {
    ...fixtures,
    "windows-arm-smoke.yml": fixtures["windows-arm-smoke.yml"].replace(
      "MSYS2_ENV_CONV_EXCL=CXXFLAGS_aarch64_pc_windows_msvc",
      "MSYS2_ENV_CONV_EXCL=",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /must not rewrite the clang-cl exception flag/);
});

test("Windows ARM smoke keeps the release lane's OpenSSL environment", () => {
  const unsafe = {
    ...fixtures,
    "windows-arm-smoke.yml": fixtures["windows-arm-smoke.yml"].replace(
      "OPENSSL_TRIPLET: arm64-windows-static-md",
      "OPENSSL_TRIPLET:",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /same vcpkg OpenSSL environment/);
});

test("the native keyring smoke stays outside Tauri binary targets", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("--example a1_keyring_smoke", "--bin a1_keyring_smoke"),
  };
  const errors = validateSourceConfidentiality(unsafe, assetSelector).join("\n");
  assert.match(errors, /keyring smoke must stay an example while using only the manifest-derived feature set/);
  assert.match(errors, /must not reintroduce a Cargo bin target/);
});

test("the native keyring smoke derives legacy feature use from the pinned manifest", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "if grep -Eq '^[[:space:]]*a1-keyring-smoke[[:space:]]*=' src-tauri/Cargo.toml; then",
      "if false; then",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /must support old and new pinned manifests without requiring a removed feature/,
  );
});

test("the native keyring smoke cannot require the legacy feature unconditionally", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace('"${keyring_features[@]}"', "--features a1-keyring-smoke"),
  };
  const errors = validateSourceConfidentiality(unsafe, assetSelector).join("\n");
  assert.match(errors, /must stay an example while using only the manifest-derived feature set/);
  assert.match(errors, /must support old and new pinned manifests without requiring a removed feature/);
});

test("standalone Trace checks cannot accept a mutable ref", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "trace_ref muss ein unveränderlicher 40-Zeichen-SHA sein.",
      "trace_ref wird als Branch akzeptiert.",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /reject mutable refs/);
});

test("standalone Trace native output cannot bypass the confidential runner", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("trace-native-test cargo test", "trace-test-plain cargo test"),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /trace-native-test must suppress private output/);
});

test("release packaging cannot skip the product-binary target proof", () => {
  const unsafe = {
    ...fixtures,
    "build-all.yml": fixtures["build-all.yml"].replace(
      'run-confidential.sh" "product-binary-$TARGET"',
      'run-confidential.sh" "unchecked-product-$TARGET"',
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /product-binary metadata must be checked confidentially/,
  );
});

test("the ARM64 release lane cannot drop the triplet the smoke mirrors", () => {
  const unsafe = {
    ...fixtures,
    "build-all.yml": fixtures["build-all.yml"].replace(
      "openssl_triplet: arm64-windows-static-md",
      "openssl_triplet: arm64-windows",
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /triplet the smoke mirrors/);
});
