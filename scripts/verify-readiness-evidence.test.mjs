import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateMarketAttestation, validateMarketEvidence, validateOperationsEvidence } from "./verify-readiness-evidence.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(readFileSync(join(ROOT, `fleet/evidence/${name}-template.json`), "utf8"));

test("open operations and market templates are structurally valid", () => {
  assert.deepEqual(validateOperationsEvidence(read("operations")), []);
  assert.deepEqual(validateMarketEvidence(read("market")), []);
  assert.deepEqual(validateMarketAttestation(read("market-attestation")), []);
});

test("operations cannot pass without authorization, measurements and an independent judge", () => {
  const report = read("operations");
  report.status = "pass";
  report.decision.status = "approved";
  const errors = validateOperationsEvidence(report).join("\n");
  assert.match(errors, /explicit authorization evidence/);
  assert.match(errors, /named operator/);
  assert.match(errors, /named independent judge/);
  assert.match(errors, /deploy\.status=pass/);
  assert.match(errors, /positive RTO target/);
  assert.match(errors, /rollback must target a different full source SHA/);
});

test("a measured, authorized and independently judged operations drill can pass", () => {
  const report = read("operations");
  Object.assign(report, {
    status: "pass",
    started_at: "2026-08-25T10:00:00Z",
    completed_at: "2026-08-25T10:20:00Z",
  });
  report.authorization = { approved_by: "TJ", evidence_url: "https://example.invalid/authorization" };
  report.environment = { name: "customer-canary-01", kind: "canary", platform: "windows-x64" };
  report.operator = { name: "Release Operator", role: "engineering" };
  report.independent_judge = { name: "Independent Judge", role: "operations-review" };
  report.drills.deploy = { status: "pass", evidence_url: "https://example.invalid/deploy", observed_release_id: report.release_id, observed_source_sha: report.source_sha };
  report.drills.health = { status: "pass", evidence_url: "https://example.invalid/health", checks: [{ name: "login", expected: "success", observed: "success", status: "pass" }] };
  report.drills.recovery = { status: "pass", evidence_url: "https://example.invalid/recovery", scenario: "local cache loss", rto_target_seconds: 300, rto_observed_seconds: 180, data_loss_target_records: 0, data_loss_observed_records: 0 };
  report.drills.rollback = { status: "pass", evidence_url: "https://example.invalid/rollback", from_source_sha: report.source_sha, to_source_sha: "a".repeat(40), duration_seconds: 120, health_after_rollback: true };
  report.decision = { status: "approved", reason: "All measured targets passed." };
  assert.deepEqual(validateOperationsEvidence(report), []);
});

test("market gates reject conversation theatre and unpaid pilots", () => {
  const report = read("market");
  report.gates.R0.status = "pass";
  report.gates.R0.evidence = ["https://example.invalid/call"];
  report.gates.R1.status = "pass";
  report.gates.R1.evidence = ["https://example.invalid/diagnosis"];
  const errors = validateMarketEvidence(report).join("\n");
  assert.match(errors, /R0 PASS requires a qualified company/);
  assert.match(errors, /R1 PASS requires a paid diagnosis/);
});

test("market evidence cannot use a shortened or mutable source pin", () => {
  const report = read("market");
  report.source_sha = report.source_sha.slice(0, 12);
  assert.match(validateMarketEvidence(report).join("\n"), /source_sha must be a full Git SHA/);
});

test("R0-R3 can pass only for three comparable paying customers", () => {
  const report = read("market");
  report.status = "pass";
  report.segment.outcome = "Freigegebener Angebotsentwurf mit belegter Durchlaufzeit";
  const customer = (id, baseline, after) => ({
    customer_ref: id,
    organization_evidence_url: `https://example.invalid/${id}/qualification`,
    employee_band: 75,
    process: "Angebot zu Freigabe",
    sponsor_role: "Geschaeftsfuehrung",
    process_owner_role: "Vertriebsleitung",
    problem_confirmed: true,
    budget_path: "Digitalisierungsbudget",
    next_commitment_at: "2026-09-01T10:00:00Z",
    diagnostic: { paid_amount_eur: 750, evidence_url: `https://example.invalid/${id}/diagnosis`, metric_name: "Durchlaufzeit", metric_unit: "Minuten", baseline, after, accepted_by: "Vertriebsleitung" },
    pilot: { price_eur: 5000, start_date: "2026-09-02", end_date: "2026-10-02", scope: "25 reale Angebotsfaelle", success_criteria: "30 Prozent weniger Durchlaufzeit bei null unfreigegebenen Aktionen", delivery_cost_eur: 2000, evidence_url: `https://example.invalid/${id}/pilot` },
    outcome: { name: report.segment.outcome, accepted: true, evidence_url: `https://example.invalid/${id}/acceptance` },
  });
  report.customers = [customer("c1", 120, 70), customer("c2", 100, 65), customer("c3", 140, 80)];
  for (const id of ["R0", "R1", "R2", "R3"]) report.gates[id] = { status: "pass", evidence: [`https://example.invalid/${id}`] };
  report.decision = { status: "go", reason: "Three comparable paid outcomes prove repeatability." };
  assert.deepEqual(validateMarketEvidence(report), []);
});
