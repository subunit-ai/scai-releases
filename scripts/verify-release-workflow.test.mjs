import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePublishWorkflow, validateReleaseWorkflow } from "./verify-release-workflow.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = readFileSync(join(ROOT, ".github/workflows/build-all.yml"), "utf8");
const publishFixture = readFileSync(join(ROOT, ".github/workflows/publish-approved.yml"), "utf8");

test("current release workflow is fail-closed", () => {
  assert.deepEqual(validateReleaseWorkflow(fixture), []);
});

test("a public pre-build release is rejected", () => {
  const unsafe = fixture.replace("--draft \\", "--not-a-draft \\");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /release must be created as a draft/);
});

test("a draft cannot be created before every signing secret exists", () => {
  const unsafe = fixture.replace("name: Release-Secret-Preflight", "name: Unchecked-Secrets");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /release secrets must be checked before/);
});

test("a bound signing secret must also be required by the preflight", () => {
  const unsafe = fixture.replace("APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID", "APPLE_PASSWORD APPLE_TEAM_ID");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /preflight must require APPLE_ID/);
});

test("a mutable action reference is rejected", () => {
  const unsafe = fixture.replace(/actions\/attest@[0-9a-f]{40}/, "actions/attest@v4");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /action reference must be immutable/);
});

test("a release build that can stream private compiler output is rejected", () => {
  const unsafe = fixture.replace('run-confidential.sh" "tauri-build-$TARGET"', 'run-publicly.sh" "tauri-build-$TARGET"');
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /confidential runner/);
});

test("a broad release upload cannot replace the explicit asset allowlist", () => {
  const unsafe = fixture.replace('gh release upload "$TAG" "${ASSETS[@]}"', 'gh release upload "$TAG" "$BUNDLE_ROOT"');
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /explicit release asset allowlist/);
});

test("updater signatures cannot be treated as native platform signing", () => {
  const unsafe = fixture.replace("Get-AuthenticodeSignature", "Get-UnverifiedSignature");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /Windows Authenticode signature must be verified/);
});

test("the build workflow cannot publish its draft", () => {
  const unsafe = fixture.replace(
    "echo \"Technisches Draft-Evidence vollständig; Veröffentlichung bleibt bis Fleet-PASS gesperrt.\"",
    "gh release edit \"$TAG\" -R \"$REPO\" --draft=false",
  );
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /build workflow must never publish a draft/);
});

test("current publication workflow is fail-closed", () => {
  assert.deepEqual(validatePublishWorkflow(publishFixture), []);
});

test("publication without Fleet PASS is rejected", () => {
  const unsafe = publishFixture.replace('test "$(jq -r .status "$MANIFEST")" = "pass"', "echo unchecked-status");
  assert.match(validatePublishWorkflow(unsafe).join("\n"), /publication must require manifest PASS/);
});

test("publication without the approved manifest digest is rejected", () => {
  const unsafe = publishFixture.replace('test "$ACTUAL_MANIFEST_SHA256" = "$EXPECTED_MANIFEST_SHA256"', "echo unchecked-manifest");
  assert.match(validatePublishWorkflow(unsafe).join("\n"), /approved manifest SHA-256/);
});

test("publication before asset verification is rejected", () => {
  const unsafe = publishFixture.replace('gh release edit "$TAG"', 'echo publish-removed "$TAG"')
    .replace("sha256sum -c SHA256SUMS", 'gh release edit "$TAG"\n          sha256sum -c SHA256SUMS');
  assert.match(validatePublishWorkflow(unsafe).join("\n"), /only after PASS and asset verification/);
});
