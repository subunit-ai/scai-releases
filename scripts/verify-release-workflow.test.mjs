import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePublishWorkflow, validateReleaseWorkflow } from "./verify-release-workflow.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = readFileSync(join(ROOT, ".github/workflows/build-all.yml"), "utf8");
const publishFixture = readFileSync(join(ROOT, ".github/workflows/publish-approved.yml"), "utf8");
const contractPaths = readFileSync(join(ROOT, "fleet/release-contract.paths"), "utf8");

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

test("legacy accepts the historical unencrypted updater key but market-ready does not", () => {
  const legacyBase = fixture.match(/BASE_RELEASE_SECRETS=\(\s*([\s\S]*?)\s*\)/)?.[1] ?? "";
  const marketReady = fixture.match(/MARKET_READY_SECRETS=\(\s*([\s\S]*?)\s*\)/)?.[1] ?? "";
  assert.doesNotMatch(legacyBase, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(marketReady, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
});

test("a mutable action reference is rejected", () => {
  const unsafe = fixture.replace(/actions\/attest@[0-9a-f]{40}/, "actions/attest@v4");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /action reference must be immutable/);

  const shorthand = `${fixture}\n      - uses: attacker/action@main\n`;
  assert.match(validateReleaseWorkflow(shorthand).join("\n"), /action reference must be immutable/);
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
  const unsafe = fixture.replaceAll("Get-AuthenticodeSignature", "Get-UnverifiedSignature");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /Windows Authenticode signature must be verified/);
});

test("the build workflow cannot publish its draft", () => {
  const unsafe = fixture.replace(
    "echo \"Technisches Draft-Evidence für $DISTRIBUTION_POLICY vollständig; dieser Workflow veröffentlicht nie.\"",
    "gh release edit \"$TAG\" -R \"$REPO\" --draft=false",
  );
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /build workflow must never publish a draft/);
});

test("legacy compatibility cannot run without the exact risk acknowledgement", () => {
  const unsafe = fixture.replace(
    'COMPATIBILITY_ACKNOWLEDGEMENT" != "I_ACCEPT_GATEKEEPER_AND_SMARTSCREEN"',
    'COMPATIBILITY_ACKNOWLEDGEMENT" != "ACK_OPTIONAL"',
  );
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /exact risk acknowledgement/);
});

test("legacy macOS cannot silently accept an arbitrary signing identity", () => {
  const unsafe = fixture.replace('legacy-v0.125:"Apple Development:"*', "legacy-v0.125:*");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /historical Apple Development identity/);
});

test("legacy Windows must measure and disclose missing Authenticode", () => {
  const unsafe = fixture.replace('.Status -ne "NotSigned"', '.Status -ne "Valid"');
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /prove that both artifacts are unsigned/);

  const dishonest = fixture.replace("authenticode_verified = $false", "authenticode_verified = $true");
  assert.match(validateReleaseWorkflow(dishonest).join("\n"), /state the missing native signature/);
});

test("current publication workflow is fail-closed", () => {
  assert.deepEqual(validatePublishWorkflow(publishFixture, contractPaths), []);
});

test("publication without Fleet PASS is rejected", () => {
  const unsafe = publishFixture.replace('test "$(jq -r .status "$MANIFEST")" = "pass"', "echo unchecked-status");
  assert.match(validatePublishWorkflow(unsafe, contractPaths).join("\n"), /publication must require manifest PASS/);
});

test("publication without the approved manifest digest is rejected", () => {
  const unsafe = publishFixture.replace('test "$ACTUAL_MANIFEST_SHA256" = "$EXPECTED_MANIFEST_SHA256"', "echo unchecked-manifest");
  assert.match(validatePublishWorkflow(unsafe, contractPaths).join("\n"), /approved manifest SHA-256/);
});

test("publication before asset verification is rejected", () => {
  const unsafe = publishFixture.replace('gh release edit "$TAG"', 'echo publish-removed "$TAG"')
    .replace("sha256sum -c SHA256SUMS", 'gh release edit "$TAG"\n          sha256sum -c SHA256SUMS');
  assert.match(validatePublishWorkflow(unsafe, contractPaths).join("\n"), /only after PASS and asset verification/);
});

test("publication contract covers the complete confidential execution chain", () => {
  const missingFleetGate = contractPaths.replace(".github/workflows/fleet-source-check.yml\n", "");
  assert.match(validatePublishWorkflow(publishFixture, missingFleetGate).join("\n"), /path inventory must exactly cover/);

  const unpinnedInventory = publishFixture.replace('git show "$CONTRACT_SHA:$CONTRACT_PATHS_FILE"', 'cp "$CONTRACT_PATHS_FILE"');
  assert.match(validatePublishWorkflow(unpinnedInventory, contractPaths).join("\n"), /pin the path inventory itself/);
});
