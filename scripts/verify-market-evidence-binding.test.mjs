import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateMarketEvidenceBinding } from "./verify-market-evidence-binding.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(join(ROOT, "fleet/manifests/scai-candidate-2026-08-24.1.json"), "utf8"));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

function passingBundle() {
  const manifest = structuredClone(fixture);
  const report = JSON.parse(readFileSync(join(ROOT, "fleet/evidence/market-template.json"), "utf8"));
  report.status = "pass";
  report.segment.outcome = "Freigegebener Angebotsentwurf mit belegter Durchlaufzeit";
  const customer = (id, baseline, after) => ({
    customer_ref: id,
    organization_evidence_url: `https://evidence.example/${id}/qualification`,
    employee_band: 75,
    process: "Angebot zu Freigabe",
    sponsor_role: "Geschaeftsfuehrung",
    process_owner_role: "Vertriebsleitung",
    problem_confirmed: true,
    budget_path: "Digitalisierungsbudget",
    next_commitment_at: "2026-09-01T10:00:00Z",
    diagnostic: { paid_amount_eur: 750, evidence_url: `https://evidence.example/${id}/diagnosis`, metric_name: "Durchlaufzeit", metric_unit: "Minuten", baseline, after, accepted_by: "Vertriebsleitung" },
    pilot: { price_eur: 5000, start_date: "2026-09-02", end_date: "2026-10-02", scope: "25 reale Angebotsfaelle", success_criteria: "30 Prozent weniger Durchlaufzeit bei null unfreigegebenen Aktionen", delivery_cost_eur: 2000, evidence_url: `https://evidence.example/${id}/pilot` },
    outcome: { name: report.segment.outcome, accepted: true, evidence_url: `https://evidence.example/${id}/acceptance` },
  });
  report.customers = [customer("c1", 120, 70), customer("c2", 100, 65), customer("c3", 140, 80)];
  for (const id of ["R0", "R1", "R2", "R3"]) {
    report.gates[id] = {
      status: "pass",
      evidence: id === "R3"
        ? report.customers.map((entry) => entry.outcome.evidence_url)
        : [`https://evidence.example/${id}`],
    };
    manifest.market_gates[id].status = "pass";
    manifest.market_gates[id].evidence = [...report.gates[id].evidence];
  }
  report.decision = { status: "go", reason: "Three comparable paid outcomes prove repeatability." };
  const reportText = serialize(report);

  const attestation = JSON.parse(readFileSync(join(ROOT, "fleet/evidence/market-attestation-template.json"), "utf8"));
  Object.assign(attestation, {
    status: "pass",
    report_sha256: sha256(reportText),
    validator: { name: "Independent Market Judge", role: "external evidence review" },
    validated_at: "2026-10-03T10:00:00Z",
    decision: { status: "approved", reason: "Primary evidence and repeatable outcomes verified." },
  });
  const attestationText = serialize(attestation);
  Object.assign(manifest.market_evidence, {
    status: "pass",
    report_url: "https://evidence.example/market-report.json",
    report_sha256: sha256(reportText),
    validator_name: attestation.validator.name,
    validator_role: attestation.validator.role,
    validated_at: attestation.validated_at,
    attestation_url: "https://evidence.example/market-attestation.json",
    attestation_sha256: sha256(attestationText),
    repeatable_paying_customers: 3,
  });
  return { manifest, report, attestation, manifestText: serialize(manifest), reportText, attestationText };
}

test("a complete private market report and independent attestation are byte-bound", () => {
  const bundle = passingBundle();
  assert.deepEqual(validateMarketEvidenceBinding(bundle.manifestText, bundle.reportText, bundle.attestationText), []);
});

test("tabletop rejects a swapped report even when its JSON remains valid", () => {
  const bundle = passingBundle();
  const swappedBytes = `${bundle.reportText}\n`;
  assert.match(validateMarketEvidenceBinding(bundle.manifestText, swappedBytes, bundle.attestationText).join("\n"), /report bytes do not match/);
});

test("tabletop rejects a market report without primary gate evidence", () => {
  const bundle = passingBundle();
  bundle.report.gates.R2.evidence = [];
  const errors = validateMarketEvidenceBinding(bundle.manifestText, serialize(bundle.report), bundle.attestationText).join("\n");
  assert.match(errors, /R2 PASS requires HTTPS evidence/);
});

test("tabletop rejects R3 with only two paying customers", () => {
  const bundle = passingBundle();
  bundle.report.customers = bundle.report.customers.slice(0, 2);
  bundle.report.gates.R3.evidence = bundle.report.gates.R3.evidence.slice(0, 2);
  const errors = validateMarketEvidenceBinding(bundle.manifestText, serialize(bundle.report), bundle.attestationText).join("\n");
  assert.match(errors, /R3 PASS requires three distinct paying customers/);
  assert.match(errors, /three repeatable paying customers/);
});
