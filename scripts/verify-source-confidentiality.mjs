#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateSourceConfidentiality(workflows, assetSelector) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };

  for (const [name, workflow] of Object.entries(workflows)) {
    require(/^\s{2}workflow_dispatch:\s*$/m.test(workflow), `${name}: workflow_dispatch must be the only executable trigger`);
    require(!/^\s{2}(pull_request|push|pull_request_target|schedule):/m.test(workflow), `${name}: secret-bearing public workflow must not have an automatic or fork trigger`);
    require(workflow.includes("persist-credentials: false"), `${name}: public checkout credentials must not persist`);
    require(workflow.includes("scripts/run-confidential.sh"), `${name}: private command output must use the confidential runner`);
    require(!/uses:\s*(?:swatinem\/rust-cache|actions\/cache)@/.test(workflow), `${name}: private build outputs must not enter a public Actions cache`);

    for (const line of workflow.split("\n")) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
      if (!match || match[1].startsWith("./")) continue;
      const ref = match[1].split("@").at(-1);
      require(/^[0-9a-f]{40}$/.test(ref ?? ""), `${name}: action reference must be immutable: ${match[1]}`);
    }
  }

  const pr = workflows["pr-check.yml"] ?? "";
  for (const label of [
    "npm-ci", "frontend-unit-tests", "cli-drift", "release-meta", "plugin-bundles", "no-demo-data",
    "frontend-build", "support-diagnostics-proof", "meet-visual-proof", "chat-dock-visual-proof", "sentinel-crm-proof", "cargo-test", "native-cargo-check",
    "revenue-proof-dependencies", "revenue-proof-esbuild", "billing-production-proof", "offers-v01-proof", "revenue-proof-artifacts",
    "native-product-binary", "native-pkce-tests", "native-keyring-smoke",
    "trace-fmt", "trace-core-check", "trace-core-clippy", "trace-core-test",
    "trace-native-check", "trace-native-clippy", "trace-native-test", "trace-native-build",
  ]) {
    require(pr.includes(`run-confidential.sh\" ${label}`), `pr-check.yml: ${label} must suppress private output`);
  }
  require(!/git clone[^\n]*--branch/.test(pr), "pr-check.yml: a mutable branch clone cannot prove an exact source SHA");
  require(
    pr.indexOf("uses: oven-sh/setup-bun@") >= 0
      && pr.indexOf("uses: oven-sh/setup-bun@") < pr.indexOf("name: Quellcode auschecken (privates Repo, read-only Deploy-Key)"),
    "pr-check.yml: Bun setup must complete before private source checkout",
  );
  require((pr.match(/git -C src fetch --depth 1 origin "\$SRC_REF"/g) ?? []).length === 2, "pr-check.yml: both jobs must fetch the requested immutable source ref");
  require((pr.match(/echo "::error::Checkout-Drift: erwartet \$SRC_REF/g) ?? []).length === 2, "pr-check.yml: both jobs must reject exact-SHA checkout drift");
  require(!/^\s+path:\s*src\/?\s*$/m.test(pr), "pr-check.yml: the private source tree must never be uploaded as an artifact");
  require(!/^\s+path:\s*trace-src\/?\s*$/m.test(pr), "pr-check.yml: the private Trace source tree must never be uploaded as an artifact");
  require(!/^\s+path:.*scai-revenue-source-shots/m.test(pr), "pr-check.yml: raw Revenue source proof output must never be uploaded as an artifact");
  require(
    /name: Chat-Dock-Proof-Screenshots sichern[\s\S]{0,450}?path: ~\/\.cache\/u1-shots\/scai-chat-dock\//.test(pr),
    "pr-check.yml: Chat-Dock proof may upload only its sanitized screenshot directory",
  );
  require(
    /name: Sentinel-CRM-Proof-Screenshots sichern[\s\S]{0,450}?path: ~\/\.cache\/u1-shots\/sentinel-crm-2026\//.test(pr),
    "pr-check.yml: Sentinel CRM proof may upload only its sanitized screenshot directory",
  );
  require(
    (pr.match(/run-confidential\.sh" native-keyring-smoke/g) ?? []).length === 2
      && (pr.match(/--example a1_keyring_smoke/g) ?? []).length === 2,
    "pr-check.yml: keyring smoke must stay an example in both manifest-derived branches",
  );
  require(
    pr.includes("if grep -Eq '^[[:space:]]*a1-keyring-smoke[[:space:]]*=' src-tauri/Cargo.toml; then")
      && (pr.match(/--features a1-keyring-smoke/g) ?? []).length === 1
      && !pr.includes("keyring_features"),
    "pr-check.yml: keyring smoke must support old and new pinned manifests without Bash 3.2 empty-array expansion",
  );
  require(!pr.includes("--bin a1_keyring_smoke"), "pr-check.yml: keyring smoke must not reintroduce a Cargo bin target");
  require(
    pr.includes("trace_ref muss ein unveränderlicher 40-Zeichen-SHA sein."),
    "pr-check.yml: standalone Trace checks must reject mutable refs",
  );
  require(
    pr.includes("Trace-Checkout-Drift: erwartet $SRC_REF"),
    "pr-check.yml: standalone Trace checks must verify the exact checked-out SHA",
  );
  require(
    /trace-standalone:[\s\S]*?if: inputs\.trace_ref != ''[\s\S]*?runner: ubuntu-latest[\s\S]*?runner: macos-15[\s\S]*?runner: macos-15-intel[\s\S]*?runner: windows-2025/.test(pr),
    "pr-check.yml: standalone Trace must retain Linux, macOS ARM/Intel and Windows lanes",
  );
  require(
    /if: failure\(\) && matrix\.label == 'windows-x64' && inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/trace-windows-diagnostic\.json/.test(pr),
    "pr-check.yml: Trace Windows diagnostics may upload only a one-time-key encrypted envelope",
  );
  require(
    /if: failure\(\) &&[^\n]*inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/scai-support-diagnostic\.json/.test(pr),
    "pr-check.yml: Support diagnostics may upload only a one-time-key encrypted envelope",
  );
  require(
    /if: failure\(\) &&[^\n]*inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/scai-pages-diagnostic\.json/.test(pr),
    "pr-check.yml: Pages diagnostics may upload only a one-time-key encrypted envelope",
  );
  require(
    /if: failure\(\) &&[^\n]*inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/scai-chat-dock-diagnostic\.json/.test(pr),
    "pr-check.yml: Chat-Dock diagnostics may upload only a one-time-key encrypted envelope",
  );
  require(
    /if: failure\(\) &&[^\n]*inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/scai-sentinel-crm-diagnostic\.json/.test(pr),
    "pr-check.yml: Sentinel CRM diagnostics may upload only a one-time-key encrypted envelope",
  );
  require(
    /if \[ -f scripts\/verify-sentinel-forecast\.mjs \]; then[\s\S]{0,220}?sentinel_forecast=true[\s\S]{0,220}?sentinel_forecast=false/.test(pr),
    "pr-check.yml: newer Sentinel proofs must be detected before older source refs are gated",
  );
  require(
    /if \[ -f scripts\/verify-sentinel-crm-2026\.mjs \]; then[\s\S]{0,220}?sentinel_crm=true[\s\S]{0,220}?sentinel_crm=false/.test(pr),
    "pr-check.yml: Sentinel CRM proof must be detected before older source refs are gated",
  );
  require(
    /name: Sentinel CRM 2026 visuell und interaktiv beweisen[\s\S]{0,180}?if: steps\.source_proofs\.outputs\.sentinel_crm == 'true'/.test(pr),
    "pr-check.yml: Sentinel CRM proof must stay strict when its source harness exists",
  );
  require(
    /name: Sentinel Forecast Command Desk beweisen[\s\S]{0,180}?if: steps\.source_proofs\.outputs\.sentinel_forecast == 'true'/.test(pr),
    "pr-check.yml: Sentinel forecast proof must stay strict when its source harness exists",
  );
  for (const contract of [
    "billing_revenue=false",
    "offers_revenue=false",
    "[ ! -f scripts/verify-billing-production.mjs ] || billing_revenue=true",
    "[ ! -f scripts/verify-offers-v01.mjs ] || offers_revenue=true",
    "echo \"revenue_browser=true\" >> \"$GITHUB_OUTPUT\"",
    "echo \"revenue_browser=false\" >> \"$GITHUB_OUTPUT\"",
  ]) {
    require(pr.includes(contract), `pr-check.yml: Revenue proof detection must retain: ${contract}`);
  }
  require(
    /if \[ "\$billing_revenue" = true \] && \[ "\$offers_revenue" = true \]; then[\s\S]{0,180}?elif \[ "\$billing_revenue" = false \] && \[ "\$offers_revenue" = false \]; then[\s\S]{0,260}?else[\s\S]{0,220}?exit 1/.test(pr),
    "pr-check.yml: partial Revenue harness availability must fail closed",
  );
  require(
    /name: Revenue-Browser-Abhängigkeiten prüfen[\s\S]{0,500}?if: steps\.source_proofs\.outputs\.revenue_browser == 'true'[\s\S]{0,500}?run-confidential\.sh" revenue-proof-dependencies npx --no-install playwright --version[\s\S]{0,180}?run-confidential\.sh" revenue-proof-esbuild npx --no-install esbuild --version/.test(pr),
    "pr-check.yml: Revenue browser dependencies must be installed and resolved without an implicit npx download",
  );
  require(
    /name: Billing produktionsnah visuell und interaktiv beweisen[\s\S]{0,700}?if: always\(\) && steps\.source_proofs\.outputs\.revenue_browser == 'true' && steps\.revenue_proof_dependencies\.outcome == 'success'[\s\S]{0,700}?SCAI_BILLING_PROOF_DIR: \$\{\{ runner\.temp \}\}\/scai-revenue-source-shots\/billing[\s\S]{0,700}?run-confidential\.sh" billing-production-proof node scripts\/verify-billing-production\.mjs/.test(pr),
    "pr-check.yml: Billing Revenue proof must run confidentially into its isolated fixture directory",
  );
  require(
    /name: Angebote v0\.1 visuell und interaktiv beweisen[\s\S]{0,700}?if: always\(\) && steps\.source_proofs\.outputs\.revenue_browser == 'true' && steps\.revenue_proof_dependencies\.outcome == 'success'[\s\S]{0,700}?SCAI_OFFERS_PROOF_DIR: \$\{\{ runner\.temp \}\}\/scai-revenue-source-shots\/offers[\s\S]{0,700}?run-confidential\.sh" offers-v01-proof node scripts\/verify-offers-v01\.mjs/.test(pr),
    "pr-check.yml: Offers Revenue proof must run confidentially into its isolated fixture directory",
  );
  require(
    /name: Revenue-Fixture-Screenshots geschlossen prüfen[\s\S]{0,900}?if: always\(\) && steps\.billing_revenue_proof\.outcome == 'success' && steps\.offers_revenue_proof\.outcome == 'success'[\s\S]{0,900}?REVENUE_ARTIFACT_DIR: \$\{\{ runner\.temp \}\}\/scai-revenue-browser-proof[\s\S]{0,900}?run-confidential\.sh" revenue-proof-artifacts node "\$GITHUB_WORKSPACE\/gate\/scripts\/verify-revenue-proof-artifacts\.mjs" "\$BILLING_PROOF_DIR" "\$OFFERS_PROOF_DIR" "\$REVENUE_ARTIFACT_DIR"/.test(pr),
    "pr-check.yml: Revenue screenshots must pass the public closed artifact sanitizer",
  );
  require(
    /name: Revenue-Browser-Proof-Screenshots sichern[\s\S]{0,450}?if: always\(\) && steps\.revenue_artifacts\.outcome == 'success'[\s\S]{0,450}?path: \$\{\{ runner\.temp \}\}\/scai-revenue-browser-proof\//.test(pr),
    "pr-check.yml: Revenue proof may upload only its sanitized fixture screenshot directory",
  );
  require(
    /if: failure\(\) && steps\.billing_revenue_proof\.outcome == 'failure' && inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/scai-revenue-billing-diagnostic\.json/.test(pr),
    "pr-check.yml: Billing Revenue diagnostics may upload only a one-time-key encrypted envelope",
  );
  require(
    /if: failure\(\) && steps\.offers_revenue_proof\.outcome == 'failure' && inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,350}?path: \$\{\{ runner\.temp \}\}\/scai-revenue-offers-diagnostic\.json/.test(pr),
    "pr-check.yml: Offers Revenue diagnostics may upload only a one-time-key encrypted envelope",
  );

  const release = workflows["build-all.yml"] ?? "";
  require(!/uses:\s*tauri-apps\/tauri-action@/.test(release), "build-all.yml: tauri-action may expose private compiler output");
  require(release.includes('run-confidential.sh\" release-npm-ci'), "build-all.yml: npm install output must be suppressed");
  require(release.includes('run-confidential.sh\" \"tauri-build-$TARGET\"'), "build-all.yml: Tauri compiler output must be suppressed");
  require(release.includes('run-confidential.sh\" \"product-binary-$TARGET\"'), "build-all.yml: Cargo product-binary metadata must be checked confidentially before packaging");
  require(release.includes("scripts/verify-product-binary.mjs"), "build-all.yml: release packaging must reject ambiguous Cargo binary targets");
  require(release.includes('run-indexed-confidential.sh\"'), "build-all.yml: indexed private diagnostics must use the dedicated confidential runner");
  require(release.includes("scripts/validate-release-assets.sh"), "build-all.yml: release assets must pass the standalone allowlist validator");
  require(release.includes('gh release upload "$TAG" "${ASSETS[@]}"'), "build-all.yml: only the validated asset array may be uploaded");
  require((release.match(/name: Private Trace-Credentials entfernen/g) ?? []).length >= 2, "build-all.yml: private Trace credentials must be cleaned in build and evidence jobs");
  require(/^\s+\*\.dmg\|\*\.app\.tar\.gz\|\*\.app\.tar\.gz\.sig\|\*-setup\.exe\|\*-setup\.exe\.sig\|\*\.AppImage\|\*\.AppImage\.sig\|\*\.deb\|\*\.deb\.sig\)\s*$/m.test(assetSelector), "validate-release-assets.sh: release uploads need a closed filename allowlist");
  require(assetSelector.includes('test ! -L "$candidate"'), "validate-release-assets.sh: symlinked artifacts must be rejected");

  const smoke = workflows["windows-arm-smoke.yml"] ?? "";
  for (const label of ["arm64-npm-ci", "arm64-frontend-build", "arm64-cargo-check", "arm64-preview-build"]) {
    require(smoke.includes(`run-confidential.sh\" ${label}`), `windows-arm-smoke.yml: ${label} must suppress private output`);
  }
  require(!/^\s+path:\s*src\/?\s*$/m.test(smoke), "windows-arm-smoke.yml: the private source tree must never be uploaded as an artifact");
  require(/if: failure\(\) && inputs\.diagnostic_public_key_base64 != ''[\s\S]{0,300}?path: \$\{\{ runner\.temp \}\}\/scai-arm64-diagnostic\.json/.test(smoke), "windows-arm-smoke.yml: diagnostics may upload only a one-time-key encrypted envelope");
  require(/CXXFLAGS_aarch64_pc_windows_msvc=\/EHsc[\s\S]{0,220}?MSYS2_ENV_CONV_EXCL=CXXFLAGS_aarch64_pc_windows_msvc/.test(smoke), "windows-arm-smoke.yml: MSYS path conversion must not rewrite the clang-cl exception flag");
  require(/OPENSSL_TRIPLET: arm64-windows-static-md[\s\S]{0,240}?OPENSSL_DIR=\$env:VCPKG_INSTALLATION_ROOT\\installed\\\$env:OPENSSL_TRIPLET/.test(smoke), "windows-arm-smoke.yml: SQLCipher must get the same vcpkg OpenSSL environment the release lane provisions");
  require(release.includes("openssl_triplet: arm64-windows-static-md"), "build-all.yml: the ARM64 release lane must keep the vcpkg OpenSSL triplet the smoke mirrors");

  return errors;
}

function loadWorkflows() {
  return Object.fromEntries(
    ["pr-check.yml", "build-all.yml", "windows-arm-smoke.yml"].map((name) => [
      name,
      readFileSync(join(ROOT, ".github/workflows", name), "utf8"),
    ]),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateSourceConfidentiality(
    loadWorkflows(),
    readFileSync(join(ROOT, "scripts/validate-release-assets.sh"), "utf8"),
  );
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exit(1);
  }
  console.log("PASS public source workflows :: dispatch-only, immutable actions, confidential logs, no private build cache, allowlisted artifacts");
}
