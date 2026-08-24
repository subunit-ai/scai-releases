#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateReleaseWorkflow(workflow) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const has = (pattern) => pattern.test(workflow);

  require(has(/source_sha:\s*\n(?:\s+.*\n){0,4}?\s+required:\s*true/m), "source_sha input must be required");
  require((workflow.match(/git -C src fetch --depth 1 origin "\$SOURCE_SHA"/g) ?? []).length >= 2, "source checkout must fetch the immutable SHA in build and evidence jobs");
  require(!has(/git clone[^\n]*--branch/), "branch-based source checkout is forbidden");
  require(has(/gh release create "\$TAG"[\s\S]{0,200}?--draft/), "release must be created as a draft");
  require(has(/releaseDraft:\s*true/), "tauri-action must keep the release draft");
  require(has(/IS_DRAFT=.*isDraft[\s\S]{0,500}?Source-SHA:/), "existing release reuse must verify draft state and source SHA");
  require(has(/needs:\s*\[release, build\][\s\S]{0,180}?needs\.build\.result == 'success'/), "publication job must depend on successful release and build jobs");

  require(has(/Developer ID Application:/), "macOS must require Developer ID Application signing");
  require(has(/xcrun stapler validate/), "macOS notarization staple must be verified");
  require(has(/spctl --assess/), "macOS Gatekeeper acceptance must be verified");
  require(has(/Import-PfxCertificate/), "Windows signing certificate must be imported");
  require(has(/Get-AuthenticodeSignature/), "Windows Authenticode signature must be verified");
  require(has(/TimeStamperCertificate/), "Windows timestamp certificate must be verified");
  require(has(/minisign -Vm/), "Tauri updater signatures must be cryptographically verified");

  require(has(/@cyclonedx\/cyclonedx-npm@6\.0\.1/), "Node SBOM generator must be version pinned");
  require(has(/cargo install cargo-cyclonedx --version 0\.5\.9 --locked/), "Rust SBOM generator must be version and lock pinned");
  require(has(/merge-cyclonedx\.mjs/), "Node and Rust SBOMs must be merged");
  require((workflow.match(/uses:\s*actions\/attest@[0-9a-f]{40}/g) ?? []).length === 2, "provenance and SBOM need two immutable attest actions");
  require(has(/--predicate-type https:\/\/cyclonedx\.org\/bom/), "CycloneDX attestation must be independently verified");
  require(has(/gh attestation verify[\s\S]{0,300}?--source-digest "\$GITHUB_SHA"/), "attestation verification must bind the workflow source digest");

  for (const line of workflow.split("\n")) {
    const match = line.match(/^\s*uses:\s*([^\s#]+)/);
    if (!match || match[1].startsWith("./")) continue;
    const ref = match[1].split("@").at(-1);
    require(/^[0-9a-f]{40}$/.test(ref ?? ""), `action reference must be immutable: ${match[1]}`);
  }

  const attestIndex = workflow.lastIndexOf("gh attestation verify");
  const publishIndex = workflow.lastIndexOf("gh release edit");
  require(attestIndex >= 0 && publishIndex > attestIndex, "draft publication must happen after independent attestation verification");
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, ".github/workflows/build-all.yml");
  const errors = validateReleaseWorkflow(readFileSync(path, "utf8"));
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exit(1);
  }
  console.log(`PASS ${path} :: fail-closed release workflow`);
}
