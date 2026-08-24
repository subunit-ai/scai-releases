import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateReleaseWorkflow } from "./verify-release-workflow.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = readFileSync(join(ROOT, ".github/workflows/build-all.yml"), "utf8");

test("current release workflow is fail-closed", () => {
  assert.deepEqual(validateReleaseWorkflow(fixture), []);
});

test("a public pre-build release is rejected", () => {
  const unsafe = fixture.replace("--draft \\", "--not-a-draft \\");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /release must be created as a draft/);
});

test("a mutable action reference is rejected", () => {
  const unsafe = fixture.replace(/actions\/attest@[0-9a-f]{40}/, "actions/attest@v4");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /action reference must be immutable/);
});

test("updater signatures cannot be treated as native platform signing", () => {
  const unsafe = fixture.replace("Get-AuthenticodeSignature", "Get-UnverifiedSignature");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /Windows Authenticode signature must be verified/);
});

test("publication before attestation verification is rejected", () => {
  const unsafe = fixture.replace("gh release edit \"$TAG\"", "gh release publish-removed \"$TAG\"")
    .replace("set -euo pipefail\n          cd \"$ASSET_DIR\"", "set -euo pipefail\n          gh release edit \"$TAG\"\n          cd \"$ASSET_DIR\"");
  assert.match(validateReleaseWorkflow(unsafe).join("\n"), /draft publication must happen after independent attestation verification/);
});
