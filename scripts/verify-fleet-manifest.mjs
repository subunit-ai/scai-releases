#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_PINS = [
  "atlas",
  "echo",
  "scai_release_contract",
  "scai_source",
  "subunit_auth",
  "u1_chat",
];
const EXPECTED_GATES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
const EXPECTED_MARKET_GATES = ["R0", "R1", "R2", "R3"];
const EXPECTED_PLATFORMS = [
  "linux_x64",
  "macos_arm64",
  "macos_x64",
  "windows_arm64",
  "windows_x64",
];
const ROOT_FIELDS = ["$schema", "schema_version", "release_id", "status", "created_at", "pins", "gates", "market_gates", "source_ci", "artifacts", "governance", "operations", "approvals", "blockers"];
const PIN_FIELDS = ["repository", "sha", "branch", "pr_url", "merge_status"];
const GATE_FIELDS = ["title", "release_pin", "status", "owner", "judge", "evidence", "acceptance"];
const MARKET_GATE_FIELDS = ["title", "status", "owner", "evidence", "acceptance"];
const SOURCE_CI_FIELDS = ["status", "sha", "run_url", "checks"];
const ARTIFACT_FIELDS = [
  "status",
  "artifact_url",
  "sha256",
  "updater_signature_url",
  "updater_signature_verified",
  "code_signature_status",
  "code_signer",
  "code_signature_evidence_url",
  "sbom_url",
  "sbom_sha256",
  "provenance_url",
  "provenance_verified",
];
const GOVERNANCE_FIELDS = ["status", "release_pin", "legal_owner", "dpo_owner", "independent_judge", "decision", "evidence_url", "evidence_sha256"];
const OPERATIONS_FIELDS = ["status", "release_pin", "environment", "operator", "independent_judge", "started_at", "completed_at", "deployed", "health_verified", "recovery_verified", "rollback_verified", "evidence_url", "evidence_sha256"];
const APPROVAL_FIELDS = ["name", "evidence_url", "evidence_sha256"];
const BLOCKER_FIELDS = ["id", "owner", "resolution", "evidence_required"];
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RELEASE_ID = /^scai-candidate-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$/;
const HTTPS = /^https:\/\//;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function evidenceIsHttps(values) {
  return Array.isArray(values) && values.length > 0 && values.every((value) => HTTPS.test(value));
}

export function validateManifest(manifest, filename = "<memory>") {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(`${filename}: ${message}`);
  };

  require(manifest && typeof manifest === "object" && !Array.isArray(manifest), "root must be an object");
  if (!manifest || typeof manifest !== "object") return errors;

  require(exactKeys(manifest, ROOT_FIELDS), "root fields must match schema exactly");
  require(manifest.$schema === "../manifest.schema.json", "$schema must pin the repository schema");
  require(manifest.schema_version === "1.1", "schema_version must equal 1.1");
  require(RELEASE_ID.test(manifest.release_id ?? ""), "release_id has an invalid format");
  require(["candidate", "pass", "rejected"].includes(manifest.status), "status must be candidate, pass or rejected");
  require(Number.isFinite(Date.parse(manifest.created_at ?? "")), "created_at must be an ISO date-time");

  require(exactKeys(manifest.pins, EXPECTED_PINS), `pins must be exactly ${EXPECTED_PINS.join(", ")}`);
  for (const name of EXPECTED_PINS) {
    const pin = manifest.pins?.[name] ?? {};
    require(exactKeys(pin, PIN_FIELDS), `${name} fields must match schema exactly`);
    require(/^https:\/\/github\.com\/subunit-ai\/[A-Za-z0-9._-]+$/.test(pin.repository ?? ""), `${name}.repository must be an approved GitHub repository`);
    require(FULL_SHA.test(pin.sha ?? ""), `${name}.sha must be a full 40-character Git SHA`);
    require(nonEmpty(pin.branch), `${name}.branch is required`);
    require(pin.pr_url === "" || HTTPS.test(pin.pr_url ?? ""), `${name}.pr_url must be empty or HTTPS`);
    require(["open", "merged", "rejected"].includes(pin.merge_status), `${name}.merge_status is invalid`);
  }

  require(exactKeys(manifest.gates, EXPECTED_GATES), `gates must be exactly ${EXPECTED_GATES.join(", ")}`);
  for (const id of EXPECTED_GATES) {
    const gate = manifest.gates?.[id] ?? {};
    require(exactKeys(gate, GATE_FIELDS), `${id} fields must match schema exactly`);
    require(nonEmpty(gate.title), `${id}.title is required`);
    require(gate.release_pin === manifest.release_id, `${id}.release_pin must equal release_id`);
    require(["open", "candidate", "pass", "failed"].includes(gate.status), `${id}.status is invalid`);
    require(Array.isArray(gate.evidence), `${id}.evidence must be an array`);
    require(nonEmpty(gate.acceptance), `${id}.acceptance is required`);
    if (gate.status === "pass") {
      require(nonEmpty(gate.owner), `${id} PASS requires a named owner`);
      require(nonEmpty(gate.judge), `${id} PASS requires a named independent judge`);
      require(evidenceIsHttps(gate.evidence), `${id} PASS requires immutable HTTPS evidence`);
    }
  }

  require(exactKeys(manifest.market_gates, EXPECTED_MARKET_GATES), `market_gates must be exactly ${EXPECTED_MARKET_GATES.join(", ")}`);
  for (const id of EXPECTED_MARKET_GATES) {
    const gate = manifest.market_gates?.[id] ?? {};
    require(exactKeys(gate, MARKET_GATE_FIELDS), `${id} fields must match schema exactly`);
    require(nonEmpty(gate.title), `${id}.title is required`);
    require(["open", "pass", "failed"].includes(gate.status), `${id}.status is invalid`);
    require(Array.isArray(gate.evidence), `${id}.evidence must be an array`);
    require(nonEmpty(gate.acceptance), `${id}.acceptance is required`);
    if (gate.status === "pass") {
      require(nonEmpty(gate.owner), `${id} PASS requires a named owner`);
      require(evidenceIsHttps(gate.evidence), `${id} PASS requires immutable HTTPS customer evidence`);
    }
  }

  const sourceCi = manifest.source_ci ?? {};
  require(exactKeys(sourceCi, SOURCE_CI_FIELDS), "source_ci fields must match schema exactly");
  require(["open", "local-pass", "pass", "failed"].includes(sourceCi.status), "source_ci.status is invalid");
  require(FULL_SHA.test(sourceCi.sha ?? ""), "source_ci.sha must be a full Git SHA");
  require(sourceCi.sha === manifest.pins?.scai_source?.sha, "source_ci.sha must equal pins.scai_source.sha");
  require(sourceCi.run_url === "" || HTTPS.test(sourceCi.run_url ?? ""), "source_ci.run_url must be empty or HTTPS");
  require(Array.isArray(sourceCi.checks) && sourceCi.checks.every(nonEmpty), "source_ci.checks must contain only non-empty strings");

  const artifacts = manifest.artifacts ?? {};
  require(exactKeys(artifacts, ["status", "platforms"]), "artifacts fields must match schema exactly");
  require(["open", "pass", "failed"].includes(artifacts.status), "artifacts.status is invalid");
  require(exactKeys(artifacts.platforms, EXPECTED_PLATFORMS), `artifact platforms must be exactly ${EXPECTED_PLATFORMS.join(", ")}`);
  for (const platform of EXPECTED_PLATFORMS) {
    const artifact = artifacts.platforms?.[platform] ?? {};
    require(exactKeys(artifact, ARTIFACT_FIELDS), `${platform} fields must match schema exactly`);
    require(["open", "pass", "failed"].includes(artifact.status), `${platform}.status is invalid`);
    for (const key of ["artifact_url", "updater_signature_url", "code_signature_evidence_url", "sbom_url", "provenance_url"]) {
      require(artifact[key] === "" || HTTPS.test(artifact[key] ?? ""), `${platform}.${key} must be empty or HTTPS`);
    }
    require(artifact.sha256 === "" || SHA256.test(artifact.sha256 ?? ""), `${platform}.sha256 must be empty or a full SHA-256`);
    require(artifact.sbom_sha256 === "" || SHA256.test(artifact.sbom_sha256 ?? ""), `${platform}.sbom_sha256 must be empty or a full SHA-256`);
    require(typeof artifact.updater_signature_verified === "boolean", `${platform}.updater_signature_verified must be boolean`);
    require(typeof artifact.provenance_verified === "boolean", `${platform}.provenance_verified must be boolean`);
    require(["open", "pass", "failed", "not_applicable"].includes(artifact.code_signature_status), `${platform}.code_signature_status is invalid`);
    require(typeof artifact.code_signer === "string", `${platform}.code_signer must be a string`);
    if (artifact.status === "pass") {
      require(HTTPS.test(artifact.artifact_url ?? ""), `${platform} PASS requires artifact_url`);
      require(SHA256.test(artifact.sha256 ?? ""), `${platform} PASS requires sha256`);
      require(HTTPS.test(artifact.updater_signature_url ?? ""), `${platform} PASS requires updater_signature_url`);
      require(artifact.updater_signature_verified === true, `${platform} PASS requires a verified updater signature`);
      require(HTTPS.test(artifact.sbom_url ?? ""), `${platform} PASS requires sbom_url`);
      require(SHA256.test(artifact.sbom_sha256 ?? ""), `${platform} PASS requires sbom_sha256`);
      require(HTTPS.test(artifact.provenance_url ?? ""), `${platform} PASS requires provenance_url`);
      require(artifact.provenance_verified === true, `${platform} PASS requires verified provenance`);
      if (platform === "linux_x64") {
        require(artifact.code_signature_status === "not_applicable", "linux_x64 PASS must mark native code signing not_applicable");
        require(artifact.code_signer === "", "linux_x64 PASS must not claim a native code signer");
      } else {
        require(artifact.code_signature_status === "pass", `${platform} PASS requires native code-signature PASS`);
        require(nonEmpty(artifact.code_signer), `${platform} PASS requires a named code signer`);
        require(HTTPS.test(artifact.code_signature_evidence_url ?? ""), `${platform} PASS requires code-signature evidence`);
      }
    }
  }
  if (artifacts.status === "pass") {
    require(EXPECTED_PLATFORMS.every((platform) => artifacts.platforms?.[platform]?.status === "pass"), "artifacts PASS requires every platform to PASS");
  }

  const governance = manifest.governance ?? {};
  require(exactKeys(governance, GOVERNANCE_FIELDS), "governance fields must match schema exactly");
  require(["open", "pass", "failed"].includes(governance.status), "governance.status is invalid");
  require(governance.release_pin === manifest.release_id, "governance.release_pin must equal release_id");
  require(["open", "approved", "rejected"].includes(governance.decision), "governance.decision is invalid");
  require(governance.evidence_url === "" || HTTPS.test(governance.evidence_url ?? ""), "governance.evidence_url must be empty or HTTPS");
  require(governance.evidence_sha256 === "" || SHA256.test(governance.evidence_sha256 ?? ""), "governance.evidence_sha256 must be empty or a full SHA-256");
  if (governance.status === "pass") {
    require(nonEmpty(governance.legal_owner), "governance PASS requires legal_owner");
    require(nonEmpty(governance.dpo_owner), "governance PASS requires dpo_owner");
    require(nonEmpty(governance.independent_judge), "governance PASS requires independent_judge");
    require(governance.decision === "approved", "governance PASS requires an approved decision");
    require(HTTPS.test(governance.evidence_url ?? ""), "governance PASS requires HTTPS evidence");
    require(SHA256.test(governance.evidence_sha256 ?? ""), "governance PASS requires evidence_sha256");
  }

  const operations = manifest.operations ?? {};
  require(exactKeys(operations, OPERATIONS_FIELDS), "operations fields must match schema exactly");
  require(["open", "pass", "failed"].includes(operations.status), "operations.status is invalid");
  require(operations.release_pin === manifest.release_id, "operations.release_pin must equal release_id");
  require(typeof operations.deployed === "boolean", "operations.deployed must be boolean");
  require(typeof operations.health_verified === "boolean", "operations.health_verified must be boolean");
  require(typeof operations.recovery_verified === "boolean", "operations.recovery_verified must be boolean");
  require(typeof operations.rollback_verified === "boolean", "operations.rollback_verified must be boolean");
  require(operations.evidence_url === "" || HTTPS.test(operations.evidence_url ?? ""), "operations.evidence_url must be empty or HTTPS");
  require(operations.evidence_sha256 === "" || SHA256.test(operations.evidence_sha256 ?? ""), "operations.evidence_sha256 must be empty or a full SHA-256");
  if (operations.status === "pass") {
    require(nonEmpty(operations.environment), "operations PASS requires environment");
    require(nonEmpty(operations.operator), "operations PASS requires a named operator");
    require(nonEmpty(operations.independent_judge), "operations PASS requires an independent judge");
    require(Number.isFinite(Date.parse(operations.started_at ?? "")), "operations PASS requires started_at");
    require(Number.isFinite(Date.parse(operations.completed_at ?? "")), "operations PASS requires completed_at");
    require(Date.parse(operations.completed_at ?? "") >= Date.parse(operations.started_at ?? ""), "operations.completed_at must not precede started_at");
    for (const key of ["deployed", "health_verified", "recovery_verified", "rollback_verified"]) {
      require(operations[key] === true, `operations PASS requires ${key}=true`);
    }
    require(HTTPS.test(operations.evidence_url ?? ""), "operations PASS requires HTTPS evidence");
    require(SHA256.test(operations.evidence_sha256 ?? ""), "operations PASS requires evidence_sha256");
  }

  require(exactKeys(manifest.approvals, ["product", "security", "legal"]), "approvals fields must match schema exactly");
  for (const role of ["product", "security", "legal"]) {
    const approval = manifest.approvals?.[role] ?? {};
    require(exactKeys(approval, APPROVAL_FIELDS), `approvals.${role} fields must match schema exactly`);
    require(typeof approval.name === "string", `approvals.${role}.name must be a string`);
    require(approval.evidence_url === "" || HTTPS.test(approval.evidence_url ?? ""), `approvals.${role}.evidence_url must be empty or HTTPS`);
    require(approval.evidence_sha256 === "" || SHA256.test(approval.evidence_sha256 ?? ""), `approvals.${role}.evidence_sha256 must be empty or a full SHA-256`);
  }

  require(Array.isArray(manifest.blockers), "blockers must be an array");
  for (const [index, blocker] of (manifest.blockers ?? []).entries()) {
    require(exactKeys(blocker, BLOCKER_FIELDS), `blockers[${index}] fields must match schema exactly`);
    for (const key of ["id", "owner", "resolution", "evidence_required"]) {
      require(nonEmpty(blocker?.[key]), `blockers[${index}].${key} is required`);
    }
  }

  if (manifest.status === "candidate") {
    require((manifest.blockers ?? []).length > 0, "candidate must name at least one blocker");
  }

  if (manifest.status === "pass") {
    require((manifest.blockers ?? []).length === 0, "PASS requires an empty blocker list");
    require(EXPECTED_PINS.every((name) => manifest.pins?.[name]?.merge_status === "merged" && HTTPS.test(manifest.pins?.[name]?.pr_url ?? "")), "PASS requires every pin to be merged with HTTPS PR evidence");
    require(EXPECTED_GATES.every((id) => manifest.gates?.[id]?.status === "pass"), "PASS requires A1-A8 to PASS on the same release pin");
    require(EXPECTED_MARKET_GATES.every((id) => manifest.market_gates?.[id]?.status === "pass"), "PASS requires market gates R0-R3 to PASS");
    require(sourceCi.status === "pass" && HTTPS.test(sourceCi.run_url ?? ""), "PASS requires green remote source CI evidence");
    require(artifacts.status === "pass", "PASS requires artifact status PASS");
    require(governance.status === "pass", "PASS requires governance status PASS");
    require(operations.status === "pass", "PASS requires operations status PASS");
    for (const role of ["product", "security", "legal"]) {
      const approval = manifest.approvals?.[role] ?? {};
      require(nonEmpty(approval.name) && HTTPS.test(approval.evidence_url ?? "") && SHA256.test(approval.evidence_sha256 ?? ""), `PASS requires named ${role} approval with HTTPS evidence and SHA-256`);
    }
  }

  return errors;
}

function defaultManifestPaths() {
  const directory = join(ROOT, "fleet", "manifests");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(directory, name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2).map((path) => resolve(path));
  const manifests = paths.length > 0 ? paths : defaultManifestPaths();
  let failed = false;
  for (const path of manifests) {
    try {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      const errors = validateManifest(manifest, path);
      if (errors.length > 0) {
        failed = true;
        for (const error of errors) console.error(`FAIL ${error}`);
      } else {
        console.log(`PASS ${path} :: ${manifest.status} :: ${manifest.release_id}`);
      }
    } catch (error) {
      failed = true;
      console.error(`FAIL ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
