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
  require(has(/release_id:\s*\n(?:\s+.*\n){0,4}?\s+required:\s*true/m), "release_id input must be required");
  const secretPreflightIndex = workflow.indexOf("name: Release-Secret-Preflight");
  const sourceCheckoutIndex = workflow.indexOf("name: Version aus dem Quell-Repo lesen");
  require(secretPreflightIndex >= 0 && sourceCheckoutIndex > secretPreflightIndex, "all release secrets must be checked before source checkout or draft creation");
  const secretPreflight = secretPreflightIndex >= 0 && sourceCheckoutIndex > secretPreflightIndex
    ? workflow.slice(secretPreflightIndex, sourceCheckoutIndex)
    : "";
  const requiredSecretList = secretPreflight.match(/REQUIRED_RELEASE_SECRETS=\(\s*([\s\S]*?)\s*\)/)?.[1] ?? "";
  for (const name of [
    "SOURCE_DEPLOY_KEY",
    "TRACE_SOURCE_DEPLOY_KEY",
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "WINDOWS_CERTIFICATE",
    "WINDOWS_CERTIFICATE_PASSWORD",
    "WINDOWS_CERTIFICATE_SUBJECT",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  ]) {
    require(secretPreflight.includes(`${name}: \${{ secrets.${name} }}`), `release secret preflight must bind ${name}`);
    require(new RegExp(`(^|\\s)${name}(\\s|$)`).test(requiredSecretList), `release secret preflight must require ${name}`);
  }
  require(secretPreflight.includes('MISSING_RELEASE_SECRETS+=("$secret_name")'), "release secret preflight must fail closed on empty secrets");
  require((workflow.match(/git -C src fetch --depth 1 origin "\$SOURCE_SHA"/g) ?? []).length >= 2, "source checkout must fetch the immutable SHA in build and evidence jobs");
  require(!has(/git clone[^\n]*--branch/), "branch-based source checkout is forbidden");
  require(has(/gh release create "\$TAG"[\s\S]{0,200}?--draft/), "release must be created as a draft");
  require(!has(/uses:\s*tauri-apps\/tauri-action@/), "public release builds must not stream private compiler output through tauri-action");
  require(has(/run-confidential\.sh" "tauri-build-\$TARGET"/), "release build output must pass through the confidential runner");
  require(has(/gh release upload "\$TAG" "\$\{ASSETS\[@\]\}"/), "only the explicit release asset allowlist may be uploaded");
  require(has(/IS_DRAFT=.*isDraft[\s\S]{0,500}?Source-SHA:/), "existing release reuse must verify draft state and source SHA");
  require(has(/needs:\s*\[release, build\][\s\S]{0,180}?needs\.build\.result == 'success'/), "evidence job must depend on successful release and build jobs");
  require(has(/Fleet-Release-ID: \$RELEASE_ID/), "draft must be bound to the Fleet release ID");
  require(!has(/gh release edit[^\n]*--draft=false/), "build workflow must never publish a draft");

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
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
    if (!match || match[1].startsWith("./")) continue;
    const ref = match[1].split("@").at(-1);
    require(/^[0-9a-f]{40}$/.test(ref ?? ""), `action reference must be immutable: ${match[1]}`);
  }

  const attestIndex = workflow.lastIndexOf("gh attestation verify");
  const draftGuardIndex = workflow.lastIndexOf('test "$(jq -r .isDraft');
  require(attestIndex >= 0 && draftGuardIndex > attestIndex, "draft state must be rechecked after independent attestation verification");
  return errors;
}

export function validatePublishWorkflow(workflow) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const has = (pattern) => pattern.test(workflow);

  for (const input of ["release_id", "tag", "manifest_sha256"]) {
    require(has(new RegExp(`${input}:\\s*\\n(?:\\s+.*\\n){0,4}?\\s+required:\\s*true`, "m")), `${input} input must be required`);
  }
  require(has(/test "\$GITHUB_REF" = "refs\/heads\/\$DEFAULT_BRANCH"/), "publication must run from the default branch");
  require(has(/node scripts\/verify-fleet-manifest\.mjs "\$MANIFEST"/), "publication must validate the Fleet manifest");
  require(has(/jq -r \.status "\$MANIFEST"[\s\S]{0,80}?= "pass"/), "publication must require manifest PASS");
  require(has(/sha256sum "\$MANIFEST"[\s\S]{0,160}?EXPECTED_MANIFEST_SHA256/), "publication must bind the approved manifest SHA-256");
  require(has(/git merge-base --is-ancestor "\$CONTRACT_SHA" "\$GITHUB_SHA"/), "publication must require an ancestor release-contract pin");
  require(has(/git show "\$CONTRACT_SHA:\$path"[\s\S]{0,120}?cmp --silent/), "publication must reject release-contract drift");
  require(has(/Source-SHA: \$SOURCE_SHA/), "publication must bind the draft to the source SHA");
  require(has(/Fleet-Release-ID: \$RELEASE_ID/), "publication must bind the draft to the release ID");
  require(has(/sha256sum -c SHA256SUMS/), "publication must recheck all release asset digests");

  for (const line of workflow.split("\n")) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
    if (!match || match[1].startsWith("./")) continue;
    const ref = match[1].split("@").at(-1);
    require(/^[0-9a-f]{40}$/.test(ref ?? ""), `action reference must be immutable: ${match[1]}`);
  }

  const passIndex = workflow.indexOf('= "pass"');
  const digestIndex = workflow.indexOf("sha256sum -c SHA256SUMS");
  const publishIndex = workflow.lastIndexOf('gh release edit "$TAG"');
  require(passIndex >= 0 && digestIndex > passIndex && publishIndex > digestIndex, "publication must happen only after PASS and asset verification");
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, ".github/workflows/build-all.yml");
  const publishPath = process.argv[3] ? resolve(process.argv[3]) : join(ROOT, ".github/workflows/publish-approved.yml");
  const errors = [
    ...validateReleaseWorkflow(readFileSync(path, "utf8")).map((error) => `${path}: ${error}`),
    ...validatePublishWorkflow(readFileSync(publishPath, "utf8")).map((error) => `${publishPath}: ${error}`),
  ];
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exit(1);
  }
  console.log(`PASS ${path} + ${publishPath} :: fail-closed build/publish split`);
}
