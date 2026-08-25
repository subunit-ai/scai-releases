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
