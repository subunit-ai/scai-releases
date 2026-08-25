#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "./verify-fleet-manifest.mjs";
import {
  repeatablePayingCustomerRefs,
  validateMarketAttestation,
  validateMarketEvidence,
} from "./verify-readiness-evidence.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function parseJson(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function validateMarketEvidenceBinding(manifestText, reportText, attestationText) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const manifest = parseJson(manifestText, "manifest", errors);
  const report = parseJson(reportText, "market report", errors);
  const attestation = parseJson(attestationText, "market attestation", errors);
  if (!manifest || !report || !attestation) return errors;

  errors.push(...validateManifest(manifest, "manifest"));
  errors.push(...validateMarketEvidence(report, "market report"));
  errors.push(...validateMarketAttestation(attestation, "market attestation"));

  const binding = manifest.market_evidence ?? {};
  const reportDigest = sha256(reportText);
  const attestationDigest = sha256(attestationText);
  require(binding.status === "pass", "manifest market_evidence must be PASS");
  require(report.status === "pass", "bound market report must be PASS");
  require(attestation.status === "pass", "bound market attestation must be PASS");
  for (const [label, value] of [["report", report], ["attestation", attestation]]) {
    require(value.release_id === manifest.release_id, `${label} release_id must equal manifest release_id`);
    require(value.source_sha === manifest.pins?.scai_source?.sha, `${label} source_sha must equal manifest SCAI source pin`);
  }
  require(binding.release_pin === manifest.release_id, "market_evidence release pin must equal manifest release_id");
  require(binding.source_sha === manifest.pins?.scai_source?.sha, "market_evidence source_sha must equal manifest SCAI source pin");
  require(binding.report_schema_version === report.schema_version, "market report schema version must match the manifest binding");
  require(binding.report_sha256 === reportDigest, "market report bytes do not match manifest report_sha256");
  require(attestation.report_sha256 === reportDigest, "market attestation does not bind the exact report SHA-256");
  require(binding.attestation_sha256 === attestationDigest, "market attestation bytes do not match manifest attestation_sha256");
  require(binding.validator_name === attestation.validator?.name, "manifest validator_name must match the attestation");
  require(binding.validator_role === attestation.validator?.role, "manifest validator_role must match the attestation");
  require(binding.validated_at === attestation.validated_at, "manifest validated_at must match the attestation");

  const latestCustomerEvidenceTime = Math.max(...(report.customers ?? []).flatMap((customer) => [
    Date.parse(customer.next_commitment_at ?? ""),
    Date.parse(customer.pilot?.end_date ?? ""),
  ]).filter(Number.isFinite));
  require(Number.isFinite(latestCustomerEvidenceTime) && Date.parse(attestation.validated_at ?? "") >= latestCustomerEvidenceTime, "market attestation must not predate the customer evidence it validates");

  const repeatableCustomers = repeatablePayingCustomerRefs(report).length;
  require(binding.repeatable_paying_customers === repeatableCustomers, "manifest repeatable customer count must equal the validated market report");
  require(repeatableCustomers >= 3, "bound market report requires three repeatable paying customers");
  for (const id of ["R0", "R1", "R2", "R3"]) {
    require(manifest.market_gates?.[id]?.status === report.gates?.[id]?.status, `${id} status must match the bound market report`);
    require(JSON.stringify(manifest.market_gates?.[id]?.evidence) === JSON.stringify(report.gates?.[id]?.evidence), `${id} evidence must match the bound market report exactly`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) {
    console.error("Aufruf: verify-market-evidence-binding.mjs <manifest.json> <market-report.json> <market-attestation.json>");
    process.exit(2);
  }
  const [manifestPath, reportPath, attestationPath] = process.argv.slice(2).map((path) => resolve(path));
  const errors = validateMarketEvidenceBinding(
    readFileSync(manifestPath, "utf8"),
    readFileSync(reportPath, "utf8"),
    readFileSync(attestationPath, "utf8"),
  );
  if (errors.length) {
    errors.forEach((error) => console.error(`FAIL ${error}`));
    process.exit(1);
  }
  console.log(`PASS ${manifestPath} :: market report and independent attestation are byte-bound`);
}
