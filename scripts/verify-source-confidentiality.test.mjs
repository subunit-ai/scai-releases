import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePrRequest, validateSourceConfidentiality } from "./verify-source-confidentiality.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = Object.fromEntries(
  ["pr-check.yml", "build-all.yml", "windows-arm-smoke.yml", "auth-pr-check.yml", "atlas-pr-check.yml", "fleet-source-check.yml"].map((name) => [
    name,
    readFileSync(join(ROOT, ".github/workflows", name), "utf8"),
  ]),
);
const assetSelector = readFileSync(join(ROOT, "scripts/validate-release-assets.sh"), "utf8");

test("current public source workflows fail closed on source confidentiality", () => {
  assert.deepEqual(validateSourceConfidentiality(fixtures, assetSelector), []);
});

for (const declaration of [
  '      replica: { image: postgres:fixture, options: "--health-cmd pg_isready" }',
  '      "replica":\n        image: postgres:fixture',
  '      replica: *unprotected-service',
  '      <<: *unprotected-services',
]) {
  test(`unsupported service declaration cannot evade log protection: ${declaration.split("\n")[0].trim()}`, () => {
    const unsafe = { ...fixtures, "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace("    services:\n", `    services:\n${declaration}\n`) };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
  });
}

test("a second job cannot hide service logging behind a flow mapping", () => {
  const unsafe = { ...fixtures, "auth-pr-check.yml": fixtures["auth-pr-check.yml"] + '\n  another-private-job:\n    services: { postgres: { image: postgres:fixture } }\n' };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
});

for (const servicesKey of ['"services":', "services :"]) {
  test(`a second job cannot hide services behind non-canonical key syntax: ${servicesKey}`, () => {
    const unsafe = {
      ...fixtures,
      "auth-pr-check.yml": `${fixtures["auth-pr-check.yml"]}\n  another-private-job:\n    ${servicesKey}\n      replica:\n        image: postgres:fixture\n`,
    };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
  });
}

for (const mutation of [
  ['quoted root jobs key', /^jobs:/m, '"jobs":'],
  ['quoted job key', /^  consent-dsar:/m, '  "consent-dsar":'],
  ['job alias', /^  consent-dsar:/m, '  consent-dsar: *private-job'],
  ['root merge key', /^jobs:/m, '<<: *private-root\njobs:'],
  ['job merge key', /^    runs-on:/m, '    <<: *private-job\n    runs-on:'],
  ['quoted options key', /^        options:/m, '        "options":'],
  ['service-attribute merge key', /^        image:/m, '        <<: *private-service\n        image:'],
]) {
  test(`private workflow structure rejects ${mutation[0]}`, () => {
    const source = fixtures["auth-pr-check.yml"];
    const changed = source.replace(mutation[1], mutation[2]);
    assert.notEqual(changed, source, `fixture mutation for ${mutation[0]} must apply`);
    const unsafe = { ...fixtures, "auth-pr-check.yml": changed };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
  });
}

test("run block scalar contents are not interpreted as workflow structure", () => {
  const source = fixtures["auth-pr-check.yml"];
  const changed = source.replace(
    "          set -euo pipefail\n",
    `          set -euo pipefail
          printf '%s\\n' '"jobs":' 'services : hidden' '<<: *shell' '"options": hidden'
`,
  );
  assert.notEqual(changed, source, "run block fixture mutation must apply");
  assert.deepEqual(validateSourceConfidentiality({ ...fixtures, "auth-pr-check.yml": changed }, assetSelector), []);
});

for (const name of ["auth-pr-check.yml", "atlas-pr-check.yml", "fleet-source-check.yml"]) {
  test(`${name} PostgreSQL service cannot expose its teardown log`, () => {
    const unsafe = { ...fixtures, [name]: fixtures[name].replace(/^\s+--log-driver none\s*$/m, "") };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), new RegExp(`${name.replace(".", "\\.")}: every private service options`));
  });
}

test("a commented or wrong-service log driver cannot satisfy the PostgreSQL boundary", () => {
  const commented = {
    ...fixtures,
    "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace("          --log-driver none", "          # --log-driver none"),
  };
  assert.match(validateSourceConfidentiality(commented, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);

  const wrongService = {
    ...fixtures,
    "atlas-pr-check.yml": fixtures["atlas-pr-check.yml"]
      .replace("          --log-driver none\n", "")
      .replace("    services:\n", "    services:\n      redis:\n        image: redis:fixture\n        options: >-\n          --log-driver none\n"),
  };
  assert.match(validateSourceConfidentiality(wrongService, assetSelector).join("\n"), /atlas-pr-check\.yml: every private service options/);

  const commandText = {
    ...fixtures,
    "auth-pr-check.yml": fixtures["auth-pr-check.yml"]
      .replace("          --log-driver none\n", "")
      .replace("          --health-cmd pg_isready", '          --health-cmd "echo --log-driver none"'),
  };
  assert.match(validateSourceConfidentiality(commandText, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
});

test("a differently named PostgreSQL replica cannot bypass private service log suppression", () => {
  const unsafe = {
    ...fixtures,
    "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace(
      "    services:\n",
      `    services:
      replica:
        image: postgres@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b
        options: >-
          --health-cmd pg_isready
`,
    ),
  };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
});

for (const hiddenFlag of [
  '--log-driver\n          json-file',
  '"--log-driver" json-file',
  '--log-\\driver json-file',
  '${{ inputs.extra_service_options }}',
]) {
  test(`non-canonical service arguments cannot hide a second log driver: ${hiddenFlag}`, () => {
    const unsafe = {
      ...fixtures,
      "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace(
        "          --log-driver none",
        `          --log-driver none\n          ${hiddenFlag}`,
      ),
    };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
  });
}

test("duplicate or overriding PostgreSQL log drivers fail closed", () => {
  const duplicateDriver = {
    ...fixtures,
    "fleet-source-check.yml": fixtures["fleet-source-check.yml"].replace("          --log-driver none", "          --log-driver none\n          --log-driver json-file"),
  };
  assert.match(validateSourceConfidentiality(duplicateDriver, assetSelector).join("\n"), /fleet-source-check\.yml: every private service options/);

  const duplicateOptions = {
    ...fixtures,
    "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace("          --health-retries 12", "          --health-retries 12\n        options: --log-driver json-file"),
  };
  assert.match(validateSourceConfidentiality(duplicateOptions, assetSelector).join("\n"), /auth-pr-check\.yml: every private service options/);
});

test("an automatic public trigger is rejected", () => {
  const unsafe = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace("  workflow_dispatch:", "  pull_request:\n  workflow_dispatch:") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /must not have an automatic or fork trigger/);
});

test("a PR check without its exact source identity in the run name is rejected", () => {
  const unsafe = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace("run-name: SCAI PR · ${{ inputs.ref }} · ${{ inputs.request_id }}\n", "") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /exact private source ref/);
});

const sourceSha = "a".repeat(40);
const requestId = "e95aacd2-45ab-4e0b-9cff-bb7c015b1f90";
const traceSha = "b".repeat(40);

test("preflight preserves exact source/request binding, including all UUIDv4 variants", () => {
  for (const variant of ["8", "9", "a", "b"]) {
    const id = requestId.slice(0, 19) + variant + requestId.slice(20);
    assert.deepEqual(validatePrRequest(sourceSha, id, traceSha, "public-recipient"), {
      source_sha: sourceSha, request_id: id, trace_sha: traceSha,
    });
  }
  assert.equal(validatePrRequest(sourceSha, requestId).trace_sha, "");
});

for (const [label, patch] of [
  ["missing source", { SOURCE_SHA: "" }],
  ["mutable source", { SOURCE_SHA: "main" }],
  ["short source", { SOURCE_SHA: sourceSha.slice(1) }],
  ["uppercase source", { SOURCE_SHA: sourceSha.toUpperCase() }],
  ["newline source", { SOURCE_SHA: sourceSha + "\n" }],
  ["shell source", { SOURCE_SHA: "$(touch must-not-execute)" }],
  ["missing request", { REQUEST_ID: "" }],
  ["uppercase request", { REQUEST_ID: requestId.toUpperCase() }],
  ["UUIDv1", { REQUEST_ID: requestId.replace("-4e0b-", "-1e0b-") }],
  ["non-RFC variant", { REQUEST_ID: requestId.replace("-9cff-", "-7cff-") }],
  ["trailing space", { REQUEST_ID: requestId + " " }],
  ["trailing newline", { REQUEST_ID: requestId + "\n" }],
  ["output injection", { REQUEST_ID: requestId + "\nsource_sha=foreign" }],
  ["mutable Trace", { TRACE_SHA: "main" }],
  ["newline Trace", { TRACE_SHA: traceSha + "\n" }],
  ["bundle without Trace", { TRACE_BUNDLE_KEY: "public-recipient" }],
]) {
  test(`real preflight rejects ${label} before writing any downstream output`, () => {
    const dir = mkdtempSync(join(tmpdir(), "source-request-policy-"));
    try {
      const output = join(dir, "output");
      const result = spawnSync(process.execPath, [join(ROOT, "scripts/verify-source-confidentiality.mjs"), "--pr-request"], {
        cwd: dir, encoding: "utf8", timeout: 10000,
        env: { PATH: process.env.PATH, SOURCE_SHA: sourceSha, REQUEST_ID: requestId, TRACE_SHA: "", TRACE_BUNDLE_KEY: "", GITHUB_OUTPUT: output, ...patch },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /^FAIL /);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(join(dir, "must-not-execute")), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("the actual workflow preflight command emits only validated job outputs", () => {
  const workflow = fixtures["pr-check.yml"];
  assert.match(workflow, /run: node gate\/scripts\/verify-source-confidentiality\.mjs --pr-request/);
  const dir = mkdtempSync(join(tmpdir(), "source-request-policy-"));
  try {
    const output = join(dir, "output");
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/verify-source-confidentiality.mjs"), "--pr-request"], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, SOURCE_SHA: sourceSha, REQUEST_ID: requestId, TRACE_SHA: traceSha, TRACE_BUNDLE_KEY: "public-recipient", GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, "utf8"), `source_sha=${sourceSha}\nrequest_id=${requestId}\ntrace_sha=${traceSha}\n`);
    assert.match(result.stdout, new RegExp(`source-sha=${sourceSha}, request-id=${requestId}`));
    assert.ok(!result.stdout.includes("public-recipient"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function rejectPrMutation(label, mutate, expected) {
  test(`request/gate policy rejects ${label}`, () => {
    const source = fixtures["pr-check.yml"];
    const changed = mutate(source);
    assert.notEqual(changed, source, "negative mutation must really alter the workflow");
    assert.match(validateSourceConfidentiality({ ...fixtures, "pr-check.yml": changed }, assetSelector).join("\n"), expected);
  });
}

for (const [label, from, to, error] of [
  ["legacy run name", " · ${{ inputs.request_id }}\n", "\n", /run name/],
  ["optional request", '        description: "Neue eindeutige UUIDv4 für diesen Source-Prüfauftrag"\n        required: true', '        description: "Request"\n        required: false', /request_id must be/],
  ["request default", "      request_id:\n", "      request_id:\n        default: fixed\n", /request_id must be/],
  ["duplicate request requirement", "        type: string\n      trace_ref:", "        type: string\n        required: false\n      trace_ref:", /request_id must be/],
  ["source default", "      ref:\n", "      ref:\n        default: main\n", /ref must be/],
  ["source-only concurrency", '  group: pr-check-${{ inputs.ref }}-${{ inputs.request_id }}', '  group: pr-check-${{ inputs.ref }}', /concurrency/],
  ["cancelling running proofs", "  cancel-in-progress: false", "  cancel-in-progress: true", /concurrency/],
  ["skipped preflight", "  preflight:\n", "  preflight:\n    if: false\n", /preflight must/],
  ["ignored preflight failure", "  preflight:\n", "  preflight:\n    continue-on-error: true\n", /preflight must/],
  ["secret in preflight", "          SOURCE_SHA: ${{ inputs.ref }}", "          SOURCE_SHA: ${{ secrets.SOURCE_DEPLOY_KEY }}", /preflight must/],
  ["forged source output", "source_sha: ${{ steps.request.outputs.source_sha }}", "source_sha: ${{ inputs.ref }}", /preflight must/],
  ["preflight without validator", "run: node gate/scripts/verify-source-confidentiality.mjs --pr-request", "run: true", /preflight must/],
  ["input embedded in shell", "run: node gate/scripts/verify-source-confidentiality.mjs --pr-request", "run: echo '${{ inputs.request_id }}'", /preflight must/],
  ["global secret env", "jobs:\n", "env:\n  KEY: ${{ secrets.SOURCE_DEPLOY_KEY }}\njobs:\n", /canonical unique/],
  ["duplicate job key", "  check:\n", "  check:\n    runs-on: ubuntu-latest\n  check:\n", /canonical unique|dependency graph/],
  ["new unguarded private job", "jobs:\n", "jobs:\n  surprise:\n    runs-on: ubuntu-latest\n    env:\n      KEY: ${{ secrets.SOURCE_DEPLOY_KEY }}\n", /dependency graph/],
  ["quoted job bypass", "  native-trace:\n", '  "native-trace":\n', /canonical unique|dependency graph/],
]) rejectPrMutation(label, (source) => source.replace(from, to), error);

for (const job of ["check", "trace-standalone", "native-trace"]) {
  for (const [label, from, to, error] of [
    ["missing dependency", "    needs: preflight\n", "", /successful preflight/],
    ["always despite failed preflight", "needs.preflight.result == 'success'", "always()", /successful preflight/],
    ["continue-on-error", `  ${job}:\n`, `  ${job}:\n    continue-on-error: true\n`, /successful preflight/],
    ["unvalidated source", "SRC_REF: ${{ needs.preflight.outputs.", "SRC_REF: ${{ inputs.", /validated source\/request/],
    ["unvalidated request", "REQUEST_ID: ${{ needs.preflight.outputs.request_id }}", "REQUEST_ID: ${{ inputs.request_id }}", /validated source\/request/],
  ]) rejectPrMutation(`${job} ${label}`, (source) => source.replace(new RegExp(`^  ${job}:\\n[\\s\\S]*?(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"), (block) => block.replace(from, to)), error);
}

for (const [label, command] of [
  ["web-release-fixture-tests", "npm run test:web"],
  ["plugin-deploy-tests", "npm run test:plugin-deploy"],
  ["host-restore-webkit-proof", "node scripts/verify-pages-foundation.mjs"],
]) {
  for (const [mutation, replace] of [
    ["missing", () => "        run: true"],
    ["unwrapped", () => `        run: ${command}`],
    ["soft failure", (line) => line + " || true"],
    ["skipped", (line) => `        if: false\n${line}`],
    ["ignored failure", (line) => `        continue-on-error: true\n${line}`],
    ["comment-only command", (line) => `        # ${line.trim()}\n        run: true`],
  ]) rejectPrMutation(`${label} ${mutation}`, (source) => source.replace(new RegExp(`^        run: .* ${label} .*$`, "m"), replace), /confidential.*(?:gate|source)/);
}

for (const [label, from, to] of [
  ["Chromium instead of WebKit", "PAGES_PROOF_BROWSER: webkit", "PAGES_PROOF_BROWSER: chromium"],
  ["missing host focus", "          PAGES_PROOF_FOCUS: host-restore\n", ""],
  ["only one viewport", "          PAGES_PROOF_FOCUS: host-restore", "          PAGES_PROOF_FOCUS: host-restore\n          PAGES_PROOF_VARIANT: light-390"],
  ["overwriting normal Pages output", "PAGES_PROOF_OUT: ${{ runner.temp }}/scai-host-restore-webkit", "PAGES_PROOF_OUT: ~/.cache/u1-shots/scai-pages"],
  ["missing WebKit deps", "install --with-deps chromium webkit", "install chromium"],
  ["raw WebKit upload", "path: ${{ runner.temp }}/scai-host-restore-webkit-diagnostic.json", "path: ${{ runner.temp }}/scai-host-restore-webkit/"],
  ["WebKit upload path suffix", "path: ${{ runner.temp }}/scai-host-restore-webkit-diagnostic.json", "path: ${{ runner.temp }}/scai-host-restore-webkit-diagnostic.json/../scai-host-restore-webkit/"],
  ["second raw WebKit upload", "          path: ${{ runner.temp }}/scai-host-restore-webkit-diagnostic.json", "          path: ${{ runner.temp }}/scai-host-restore-webkit-diagnostic.json\n          path: src/"],
  ["unkeyed WebKit diagnostic", "if: failure() && steps.host_restore_webkit.outcome == 'failure' && inputs.diagnostic_public_key_base64 != ''", "if: failure()"],
]) rejectPrMutation(label, (source) => source.replace(from, to), /WebKit/);

test("a mutable action can never run beside private source", () => {
  const unsafe = { ...fixtures, "windows-arm-smoke.yml": fixtures["windows-arm-smoke.yml"].replace(/actions\/setup-node@[0-9a-f]{40}/, "actions/setup-node@v4") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /action reference must be immutable/);

  const shorthand = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace(/- uses: dtolnay\/rust-toolchain@[0-9a-f]{40}/, "- uses: dtolnay/rust-toolchain@stable") };
  assert.match(validateSourceConfidentiality(shorthand, assetSelector).join("\n"), /action reference must be immutable/);
});

test("a mutable branch clone cannot stand in for an exact source pin", () => {
  const unsafe = { ...fixtures, "pr-check.yml": fixtures["pr-check.yml"].replace('git -C src fetch --depth 1 -- origin "$SRC_REF"', 'git clone --depth 1 --branch "$SRC_REF" git@github.com:subunit-ai/subunit-scai.git src') };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /mutable branch clone/);
});

test("private source fetches must terminate options before the validated ref", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      'git -C src fetch --depth 1 -- origin "$SRC_REF"',
      'git -C src fetch --depth 1 origin "$SRC_REF"',
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /source fetch must terminate options|must not accept ref-shaped options/,
  );
});

test("source ref validation must run before deploy-key material is created", () => {
  const validation = 'bash "$GITHUB_WORKSPACE/gate/scripts/validate-private-source-ref.sh" "$SRC_REF"';
  const keyWrite = 'printf \'%s\\n\' "$DEPLOY_KEY" > "$key_file"';
  const unsafeWorkflow = fixtures["pr-check.yml"]
    .replace(validation, "true")
    .replace(keyWrite, `${keyWrite}\n          ${validation}`);
  const unsafe = { ...fixtures, "pr-check.yml": unsafeWorkflow };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /allowlist-validated before deploy-key material is created/,
  );
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

test("an internal Trace bundle can leave the public runner only as a keyed encrypted envelope", () => {
  const plaintextUpload = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/trace-host-macos-arm64-internal.tar.gz.envelope.json",
      "path: ${{ runner.temp }}/trace-host-macos-arm64-internal.tar.gz",
    ),
  };
  assert.match(
    validateSourceConfidentiality(plaintextUpload, assetSelector).join("\n"),
    /encrypted envelope|plaintext Trace delivery archives/,
  );

  const missingKeyGate = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replaceAll(
      "inputs.trace_bundle_public_key_base64 != ''",
      "always()",
    ),
  };
  assert.match(
    validateSourceConfidentiality(missingKeyGate, assetSelector).join("\n"),
    /explicit one-time recipient key|encrypted envelope/,
  );

  const sourceAfterSecrets = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "name: Signierten Trace-App-Bundle bauen und einmalig verschlüsseln",
      "name: Signierten Trace-App-Bundle bauen und einmalig verschlüsseln\n        run-private-after-import: bash scripts/build-macos-app.sh",
    ),
  };
  assert.match(
    validateSourceConfidentiality(sourceAfterSecrets, assetSelector).join("\n"),
    /no private Trace packaging script may execute after signing secrets/,
  );

  const setupAfterSecrets = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "name: Signierten Trace-App-Bundle bauen und einmalig verschlüsseln",
      "name: Signierten Trace-App-Bundle bauen und einmalig verschlüsseln\n        run-private-after-import: bash scripts/build-macos-setup-app.sh",
    ),
  };
  assert.match(
    validateSourceConfidentiality(setupAfterSecrets, assetSelector).join("\n"),
    /no private Trace setup packaging script may execute after signing secrets/,
  );

  const missingSetupIdentity = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      'setup_bundle_identifier:"ai.subunit.trace-setup"',
      'setup_bundle_identifier:"unknown"',
    ),
  };
  assert.match(
    validateSourceConfidentiality(missingSetupIdentity, assetSelector).join("\n"),
    /setup app must be identity-bound/,
  );
});

test("Bun setup cannot run after the private source checkout", () => {
  const action = fixtures["pr-check.yml"].match(/\n      # Bun wird[\s\S]*?uses: oven-sh\/setup-bun@[0-9a-f]{40}[^\n]*\n/)?.[0];
  assert.ok(action);
  const withoutAction = fixtures["pr-check.yml"].replace(action, "\n");
  const sourceStep = "      - name: Quellcode auschecken (privates Repo, read-only Deploy-Key)";
  const unsafe = {
    ...fixtures,
    "pr-check.yml": withoutAction.replace(sourceStep, `${sourceStep}${action}`),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /Bun setup must complete before private source checkout/,
  );
});

test("a broad upload cannot replace the release artifact allowlist", () => {
  const unsafe = { ...fixtures, "build-all.yml": fixtures["build-all.yml"].replace('upload-draft-assets.sh" "${ASSETS[@]}"', 'upload-draft-assets.sh" "$BUNDLE_ROOT"') };
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

test("Chat-Dock proof cannot upload the private source tree", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ~/.cache/u1-shots/scai-chat-dock/",
      "path: src/",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /Chat-Dock proof may upload only its sanitized screenshot directory/,
  );
});

test("Sentinel CRM proof cannot upload the private source tree", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ~/.cache/u1-shots/sentinel-crm-2026/",
      "path: src/",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /Sentinel CRM proof may upload only its sanitized screenshot directory/,
  );
});

test("Sentinel CRM diagnostics cannot upload plaintext or a source-tree path", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/scai-sentinel-crm-diagnostic.json",
      "path: src/private-sentinel-crm.log",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /Sentinel CRM diagnostics may upload only a one-time-key encrypted envelope/,
  );
});

test("Revenue harnesses cannot be partially present or bypass confidential execution", () => {
  const partialAllowed = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      `            echo "::error::Revenue-Browser-Proof ist unvollständig; Billing- und Offers-Harness müssen gemeinsam vorliegen."
            exit 1`,
      '            echo "revenue_browser=false" >> "$GITHUB_OUTPUT"',
    ),
  };
  assert.match(
    validateSourceConfidentiality(partialAllowed, assetSelector).join("\n"),
    /partial Revenue harness availability must fail closed/,
  );

  const publicHarness = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("billing-production-proof", "billing-public-proof"),
  };
  assert.match(
    validateSourceConfidentiality(publicHarness, assetSelector).join("\n"),
    /billing-production-proof must suppress private output/,
  );
});

test("Workspace browser harnesses are an atomic confidential gate", () => {
  const partialAllowed = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      `            echo "::error::Arbeitsbereich-Browser-Proof ist unvollständig; Web- und App-Modus-Harness müssen gemeinsam vorliegen."
            exit 1`,
      '            echo "workspace_browser=false" >> "$GITHUB_OUTPUT"',
    ),
  };
  assert.match(
    validateSourceConfidentiality(partialAllowed, assetSelector).join("\n"),
    /partial Workspace harness availability must fail closed/,
  );

  const publicTabs = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("workspace-tabs-proof", "workspace-tabs-public"),
  };
  assert.match(
    validateSourceConfidentiality(publicTabs, assetSelector).join("\n"),
    /workspace-tabs-proof must suppress private output|Workspace tab proof must run confidentially/,
  );

  const publicAppPlugins = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("workspace-app-plugins-proof", "workspace-app-plugins-public"),
  };
  assert.match(
    validateSourceConfidentiality(publicAppPlugins, assetSelector).join("\n"),
    /workspace-app-plugins-proof must suppress private output|Workspace app-plugin proof must run confidentially/,
  );

  const rawUpload = {
    ...fixtures,
    "pr-check.yml": `${fixtures["pr-check.yml"]}\n      - uses: actions/upload-artifact@${"a".repeat(40)}\n        with:\n          path: \${{ runner.temp }}/scai-workspace-tabs/\n`,
  };
  assert.match(
    validateSourceConfidentiality(rawUpload, assetSelector).join("\n"),
    /raw Workspace proof output must not be uploaded/,
  );
});

test("Workspace and Call diagnostics require the supplied key and the three exact encrypted envelopes", () => {
  for (const [stepId, diagnosticName, expected] of [
    ["workspace_tabs_proof", "scai-workspace-tabs-diagnostic.json", /Workspace tab diagnostics/],
    ["workspace_app_plugins_proof", "scai-workspace-app-plugins-diagnostic.json", /Workspace app-plugin diagnostics/],
    ["subunit_call_proof", "scai-subunit-call-diagnostic.json", /Subunit Call diagnostics/],
  ]) {
    const missingKeyGuard = {
      ...fixtures,
      "pr-check.yml": fixtures["pr-check.yml"].replace(
        `if: failure() && steps.${stepId}.outcome == 'failure' && inputs.diagnostic_public_key_base64 != ''`,
        `if: failure() && steps.${stepId}.outcome == 'failure'`,
      ),
    };
    assert.match(
      validateSourceConfidentiality(missingKeyGuard, assetSelector).join("\n"),
      expected,
    );

    const plaintextUpload = {
      ...fixtures,
      "pr-check.yml": fixtures["pr-check.yml"].replace(
        `path: \${{ runner.temp }}/${diagnosticName}`,
        `path: src/private-${diagnosticName.replace("-diagnostic.json", ".log")}`,
      ),
    };
    assert.match(
      validateSourceConfidentiality(plaintextUpload, assetSelector).join("\n"),
      expected,
    );

    const broadUpload = {
      ...fixtures,
      "pr-check.yml": fixtures["pr-check.yml"].replace(
        `path: \${{ runner.temp }}/${diagnosticName}`,
        `path: \${{ runner.temp }}/${diagnosticName.replace("-diagnostic.json", "/")}`,
      ),
    };
    assert.match(
      validateSourceConfidentiality(broadUpload, assetSelector).join("\n"),
      /raw Workspace proof output|Workspace .* diagnostics|Subunit Call diagnostics/,
    );
  }
});

test("Subunit Call proof remains ref-bound, confidential, and runnable after an earlier failure", () => {
  const scriptOnlyDetection = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "[ ! -f src/call/CallSessionHost.tsx ] || subunit_call_host=true",
      "subunit_call_host=true",
    ),
  };
  assert.match(
    validateSourceConfidentiality(scriptOnlyDetection, assetSelector).join("\n"),
    /Subunit Call proof detection must retain/,
  );

  const partialAllowed = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      `            echo "::error::Subunit-Call-Proof ist unvollständig; Call-Host und Proof-Harness müssen gemeinsam vorliegen."
            exit 1`,
      '            echo "subunit_call=false" >> "$GITHUB_OUTPUT"',
    ),
  };
  assert.match(
    validateSourceConfidentiality(partialAllowed, assetSelector).join("\n"),
    /partial Subunit Call capability availability must fail closed/,
  );

  const publicProof = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("subunit-call-proof", "subunit-call-public"),
  };
  assert.match(
    validateSourceConfidentiality(publicProof, assetSelector).join("\n"),
    /subunit-call-proof must suppress private output|Subunit Call proof must run confidentially/,
  );

  const priorFailureSkipsProof = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "if: always() && steps.source_proofs.outputs.subunit_call == 'true'",
      "if: steps.source_proofs.outputs.subunit_call == 'true'",
    ),
  };
  assert.match(
    validateSourceConfidentiality(priorFailureSkipsProof, assetSelector).join("\n"),
    /Subunit Call proof must run confidentially/,
  );

  for (const rawPath of [
    "~/.cache/u1-shots/subunit-call/",
    "~/.cache/u1-shots/subunit-call/report.json",
    '"/home/runner/.cache/u1-shots/subunit-call"',
    "'/home/runner/.cache/u1-shots/subunit-call/**/*.png'",
    "${{ runner.temp }}/subunit-call-report.json",
    "${{ runner.temp }}/call-audio-caller-final.webm",
    "${{ runner.temp }}/call-active-caller-390-light.png",
  ]) {
    const rawCallArtifact = {
      ...fixtures,
      "pr-check.yml": `${fixtures["pr-check.yml"]}\n      - uses: actions/upload-artifact@${"a".repeat(40)}\n        with:\n          path: ${rawPath}\n`,
    };
    assert.match(
      validateSourceConfidentiality(rawCallArtifact, assetSelector).join("\n"),
      /raw Subunit Call screenshots, recordings, reports, and the real proof output directory/,
    );
  }
});

test("Revenue screenshots can upload only after closed sanitization", () => {
  const rawUpload = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/scai-revenue-browser-proof/",
      "path: ${{ runner.temp }}/scai-revenue-source-shots/",
    ),
  };
  const errors = validateSourceConfidentiality(rawUpload, assetSelector).join("\n");
  assert.match(errors, /raw Revenue source proof output must never be uploaded/);
  assert.match(errors, /may upload only its sanitized fixture screenshot directory/);

  const noSanitizer = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "steps.revenue_artifacts.outcome == 'success'",
      "steps.offers_revenue_proof.outcome == 'success'",
    ),
  };
  assert.match(
    validateSourceConfidentiality(noSanitizer, assetSelector).join("\n"),
    /may upload only its sanitized fixture screenshot directory/,
  );
});

test("Workgraph harness remains optional, but runs confidentially and sanitizes all output when present", () => {
  const undetected = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "if [ -f scripts/verify-workgraph-blackbox.mjs ]; then",
      "if false; then",
    ),
  };
  assert.match(validateSourceConfidentiality(undetected, assetSelector).join("\n"), /Workgraph proof must be optional/);

  const publicHarness = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace("workgraph-blackbox-proof", "workgraph-public-proof"),
  };
  assert.match(validateSourceConfidentiality(publicHarness, assetSelector).join("\n"), /workgraph-blackbox-proof must suppress private output/);

  const noWorkgraphSanitizer = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      '--workgraph-only "$HOME/.cache/u1-shots/scai-workgraph-blackbox"',
      '--workgraph-disabled "$HOME/.cache/u1-shots/scai-workgraph-blackbox"',
    ),
  };
  assert.match(validateSourceConfidentiality(noWorkgraphSanitizer, assetSelector).join("\n"), /Revenue and Workgraph screenshots must pass/);

  const uncheckedWorkgraphOnly = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "steps.source_proofs.outputs.revenue_browser != 'true' && steps.source_proofs.outputs.workgraph_blackbox == 'true' && steps.workgraph_blackbox_proof.outcome == 'success'",
      "steps.source_proofs.outputs.workgraph_blackbox == 'true'",
    ),
  };
  assert.match(validateSourceConfidentiality(uncheckedWorkgraphOnly, assetSelector).join("\n"), /artifact modes must require/);

  const rawUpload = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/scai-revenue-browser-proof/",
      "path: ~/.cache/u1-shots/scai-workgraph-blackbox/",
    ),
  };
  assert.match(validateSourceConfidentiality(rawUpload, assetSelector).join("\n"), /raw Workgraph source proof output/);
});

test("Workforce Inbox proof remains optional, isolated, and confidential", () => {
  const undetected = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "if [ -f scripts/verify-workforce-inbox.mjs ]; then",
      "if false; then",
    ),
  };
  assert.match(validateSourceConfidentiality(undetected, assetSelector).join("\n"), /Workforce Inbox proof must be optional/);

  const publicHarness = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      'run-confidential.sh" workforce-inbox-proof',
      'run-publicly.sh" workforce-inbox-proof',
    ),
  };
  assert.match(
    validateSourceConfidentiality(publicHarness, assetSelector).join("\n"),
    /workforce-inbox-proof must suppress private output|Workforce Inbox proof must run confidentially/,
  );

  const sourceOutput = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "SCAI_WORKFORCE_INBOX_PROOF_DIR: ${{ runner.temp }}/scai-workforce-inbox-proof",
      "SCAI_WORKFORCE_INBOX_PROOF_DIR: src/private-workforce-inbox-output",
    ),
  };
  assert.match(
    validateSourceConfidentiality(sourceOutput, assetSelector).join("\n"),
    /Workforce Inbox proof must run confidentially into its isolated fixture directory/,
  );
});

test("Revenue diagnostics cannot upload plaintext or a source-tree path", () => {
  for (const [safePath, unsafePath, expected] of [
    ["${{ runner.temp }}/scai-revenue-billing-diagnostic.json", "src/private-billing.log", /Billing Revenue diagnostics/],
    ["${{ runner.temp }}/scai-revenue-offers-diagnostic.json", "src/private-offers.log", /Offers Revenue diagnostics/],
  ]) {
    const unsafe = {
      ...fixtures,
      "pr-check.yml": fixtures["pr-check.yml"].replace(`path: ${safePath}`, `path: ${unsafePath}`),
    };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), expected);
  }
});

test("Workgraph diagnostics cannot upload plaintext or a source-tree path", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/scai-workgraph-blackbox-diagnostic.json",
      "path: src/private-workgraph.log",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /Workgraph diagnostics may upload only a one-time-key encrypted envelope/,
  );
});

test("Chat-Dock diagnostics cannot upload plaintext or a source-tree path", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "path: ${{ runner.temp }}/scai-chat-dock-diagnostic.json",
      "path: src/private-chat-dock.log",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /Chat-Dock diagnostics may upload only a one-time-key encrypted envelope/,
  );
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
  assert.match(errors, /keyring smoke must stay an example in both manifest-derived branches/);
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
    /must support old and new pinned manifests without Bash 3\.2 empty-array expansion/,
  );
});

test("the native keyring smoke cannot require the legacy feature unconditionally", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "              --example a1_keyring_smoke",
      "              --features a1-keyring-smoke --example a1_keyring_smoke",
    ),
  };
  const errors = validateSourceConfidentiality(unsafe, assetSelector).join("\n");
  assert.match(errors, /must support old and new pinned manifests without Bash 3\.2 empty-array expansion/);
});

test("the native keyring smoke cannot use an empty feature array under Bash 3.2", () => {
  const unsafe = {
    ...fixtures,
    "pr-check.yml": fixtures["pr-check.yml"].replace(
      "          if grep -Eq '^[[:space:]]*a1-keyring-smoke[[:space:]]*=' src-tauri/Cargo.toml; then",
      "          keyring_features=()\n          if grep -Eq '^[[:space:]]*a1-keyring-smoke[[:space:]]*=' src-tauri/Cargo.toml; then",
    ),
  };
  assert.match(
    validateSourceConfidentiality(unsafe, assetSelector).join("\n"),
    /must support old and new pinned manifests without Bash 3\.2 empty-array expansion/,
  );
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

for (const label of ["auth-install", "auth-db-fixture", "auth-tests", "auth-build", "auth-deploy-gate"]) {
  test(`Auth ${label} cannot expose private output`, () => {
    const unsafe = { ...fixtures, "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace(`run-confidential.sh" ${label}`, `plain.sh" ${label}`) };
    assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /must suppress private output/);
  });
}
test("Auth diagnostic artifact cannot point at private source", () => {
  const unsafe = { ...fixtures, "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace("path: ${{ runner.temp }}/auth-diagnostic.json", "path: private/subunit-auth") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /encrypted diagnostic envelope/);
});

test("Auth PostgreSQL image cannot use a mutable tag", () => {
  const unsafe = { ...fixtures, "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace(/postgres@sha256:[0-9a-f]{64}/, "postgres:16") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /immutable digest/);
});

test("Auth full suite cannot become a partial test selection", () => {
  const unsafe = { ...fixtures, "auth-pr-check.yml": fixtures["auth-pr-check.yml"].replace("bash scripts/ci/run-proof-suite.sh", "bun test test/one.test.ts") };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /partial test commands/);
});
test("Auth discovery keys require unconditional cleanup", () => {
  const workflow = fixtures["auth-pr-check.yml"].replace('"$RUNNER_TEMP/auth-cutover-discovery-public.pem"\n', '\n');
  const unsafe = { ...fixtures, "auth-pr-check.yml": workflow.replace('"$RUNNER_TEMP/auth-cutover-discovery-private.pem" "$RUNNER_TEMP/auth-cutover-discovery-public.pem"','') };
  assert.match(validateSourceConfidentiality(unsafe, assetSelector).join("\n"), /unconditional cleanup/);
});
