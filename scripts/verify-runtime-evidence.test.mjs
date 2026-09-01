import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeEvidence } from "./verify-runtime-evidence.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const VERSION = "9.8.7";
const TARGET = "x86_64-unknown-linux-gnu";

function fixture() {
  const proof = {
    schema_version: "1.0",
    status: "pass",
    product_binary: "subunit-scai",
    package_name: "subunit-scai",
    version: VERSION,
    source_sha: SOURCE_SHA,
    target_os: "linux",
    target_arch: "x86_64",
  };
  return {
    schema_version: "1.0",
    status: "pass",
    target: TARGET,
    version: VERSION,
    source_sha: SOURCE_SHA,
    packages: [
      { role: "installer", artifact_basename: "SCAI.deb", artifact_sha256: "a".repeat(64), evidence: { ...proof } },
      { role: "updater", artifact_basename: "SCAI.AppImage", artifact_sha256: "b".repeat(64), evidence: { ...proof } },
    ],
  };
}

test("accepts exact installer and updater runtime evidence", () => {
  assert.deepEqual(validateRuntimeEvidence(fixture(), TARGET, VERSION, SOURCE_SHA), []);
});

for (const [name, mutate, expected] of [
  ["wrong binary", (value) => { value.packages[0].evidence.product_binary = "a1_keyring_smoke"; }, /wrong product binary/],
  ["source drift", (value) => { value.packages[1].evidence.source_sha = "f".repeat(40); }, /packaged source SHA drift/],
  ["version drift", (value) => { value.version = "9.8.8"; }, /runtime version drift/],
  ["missing updater", (value) => { value.packages.pop(); }, /exactly installer and updater/],
  ["secret-shaped extra field", (value) => { value.packages[0].evidence.credentials = "forbidden"; }, /binary evidence keys must be exact/],
  ["absolute artifact path", (value) => { value.packages[0].artifact_basename = "/private/source/SCAI.deb"; }, /artifact basename is invalid/],
  ["same Linux artifact", (value) => { value.packages[1].artifact_sha256 = value.packages[0].artifact_sha256; }, /distinct artifacts/],
]) {
  test(`rejects ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.match(validateRuntimeEvidence(value, TARGET, VERSION, SOURCE_SHA).join("\n"), expected);
  });
}
