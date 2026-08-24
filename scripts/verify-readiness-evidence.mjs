#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;
const RELEASE_ID = /^scai-candidate-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$/;
const HTTPS = /^https:\/\//;

const exactKeys = (value, expected) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const isoDate = (value) => Number.isFinite(Date.parse(value ?? ""));
const httpsOrEmpty = (value) => value === "" || HTTPS.test(value ?? "");
const evidenceList = (value) => Array.isArray(value) && value.length > 0 && value.every((entry) => HTTPS.test(entry));

export function validateOperationsEvidence(report, filename = "<operations>") {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(`${filename}: ${message}`); };
  const rootFields = ["schema_version", "report_type", "release_id", "source_sha", "status", "authorization", "environment", "operator", "independent_judge", "started_at", "completed_at", "drills", "decision"];
  require(exactKeys(report, rootFields), "root fields must match the operations contract exactly");
  require(report.schema_version === "1.0", "schema_version must equal 1.0");
  require(report.report_type === "operations", "report_type must equal operations");
  require(RELEASE_ID.test(report.release_id ?? ""), "release_id is invalid");
  require(FULL_SHA.test(report.source_sha ?? ""), "source_sha must be a full Git SHA");
  require(["open", "pass", "failed"].includes(report.status), "status is invalid");

  require(exactKeys(report.authorization, ["approved_by", "evidence_url"]), "authorization fields are invalid");
  require(httpsOrEmpty(report.authorization?.evidence_url), "authorization.evidence_url must be empty or HTTPS");
  require(exactKeys(report.environment, ["name", "kind", "platform"]), "environment fields are invalid");
  require(["canary", "production", ""].includes(report.environment?.kind), "environment.kind is invalid");
  require(exactKeys(report.operator, ["name", "role"]), "operator fields are invalid");
  require(exactKeys(report.independent_judge, ["name", "role"]), "independent_judge fields are invalid");
  require(exactKeys(report.decision, ["status", "reason"]), "decision fields are invalid");
  require(["open", "approved", "rejected"].includes(report.decision?.status), "decision.status is invalid");

  require(exactKeys(report.drills, ["deploy", "health", "recovery", "rollback"]), "drills must contain deploy, health, recovery and rollback exactly");
  const deploy = report.drills?.deploy ?? {};
  require(exactKeys(deploy, ["status", "evidence_url", "observed_release_id", "observed_source_sha"]), "deploy fields are invalid");
  require(["open", "pass", "failed"].includes(deploy.status), "deploy.status is invalid");
  require(httpsOrEmpty(deploy.evidence_url), "deploy.evidence_url must be empty or HTTPS");

  const health = report.drills?.health ?? {};
  require(exactKeys(health, ["status", "evidence_url", "checks"]), "health fields are invalid");
  require(["open", "pass", "failed"].includes(health.status), "health.status is invalid");
  require(httpsOrEmpty(health.evidence_url), "health.evidence_url must be empty or HTTPS");
  require(Array.isArray(health.checks), "health.checks must be an array");
  for (const [index, check] of (health.checks ?? []).entries()) {
    require(exactKeys(check, ["name", "expected", "observed", "status"]), `health.checks[${index}] fields are invalid`);
    require(["pass", "failed"].includes(check?.status), `health.checks[${index}].status is invalid`);
  }

  const recovery = report.drills?.recovery ?? {};
  require(exactKeys(recovery, ["status", "evidence_url", "scenario", "rto_target_seconds", "rto_observed_seconds", "data_loss_target_records", "data_loss_observed_records"]), "recovery fields are invalid");
  require(["open", "pass", "failed"].includes(recovery.status), "recovery.status is invalid");
  require(httpsOrEmpty(recovery.evidence_url), "recovery.evidence_url must be empty or HTTPS");

  const rollback = report.drills?.rollback ?? {};
  require(exactKeys(rollback, ["status", "evidence_url", "from_source_sha", "to_source_sha", "duration_seconds", "health_after_rollback"]), "rollback fields are invalid");
  require(["open", "pass", "failed"].includes(rollback.status), "rollback.status is invalid");
  require(httpsOrEmpty(rollback.evidence_url), "rollback.evidence_url must be empty or HTTPS");

  if (report.status === "pass") {
    require(nonEmpty(report.authorization?.approved_by) && HTTPS.test(report.authorization?.evidence_url ?? ""), "PASS requires explicit authorization evidence");
    require(nonEmpty(report.environment?.name) && nonEmpty(report.environment?.platform) && nonEmpty(report.environment?.kind), "PASS requires a named environment, kind and platform");
    require(nonEmpty(report.operator?.name) && nonEmpty(report.operator?.role), "PASS requires a named operator");
    require(nonEmpty(report.independent_judge?.name) && nonEmpty(report.independent_judge?.role), "PASS requires a named independent judge");
    require(report.operator?.name !== report.independent_judge?.name, "operator and independent judge must differ");
    require(isoDate(report.started_at) && isoDate(report.completed_at), "PASS requires valid start and completion timestamps");
    require(Date.parse(report.completed_at) >= Date.parse(report.started_at), "completed_at must not precede started_at");
    require(report.decision?.status === "approved" && nonEmpty(report.decision?.reason), "PASS requires an approved, reasoned decision");

    for (const [id, drill] of Object.entries(report.drills ?? {})) {
      require(drill.status === "pass", `PASS requires ${id}.status=pass`);
      require(HTTPS.test(drill.evidence_url ?? ""), `PASS requires ${id}.evidence_url`);
    }
    require(deploy.observed_release_id === report.release_id, "deploy must observe the exact release_id");
    require(deploy.observed_source_sha === report.source_sha, "deploy must observe the exact source_sha");
    require((health.checks ?? []).length > 0 && health.checks.every((check) => check.status === "pass" && nonEmpty(check.name) && nonEmpty(check.expected) && nonEmpty(check.observed)), "health PASS requires concrete passing checks");
    require(nonEmpty(recovery.scenario), "recovery PASS requires a scenario");
    require(Number.isFinite(recovery.rto_target_seconds) && recovery.rto_target_seconds > 0, "recovery PASS requires a positive RTO target");
    require(Number.isFinite(recovery.rto_observed_seconds) && recovery.rto_observed_seconds <= recovery.rto_target_seconds, "observed RTO must meet the target");
    require(Number.isInteger(recovery.data_loss_target_records) && recovery.data_loss_target_records >= 0, "recovery PASS requires a data-loss target");
    require(Number.isInteger(recovery.data_loss_observed_records) && recovery.data_loss_observed_records <= recovery.data_loss_target_records, "observed data loss must meet the target");
    require(rollback.from_source_sha === report.source_sha, "rollback must start from the candidate source_sha");
    require(FULL_SHA.test(rollback.to_source_sha ?? "") && rollback.to_source_sha !== report.source_sha, "rollback must target a different full source SHA");
    require(Number.isFinite(rollback.duration_seconds) && rollback.duration_seconds > 0, "rollback PASS requires a positive measured duration");
    require(rollback.health_after_rollback === true, "rollback PASS requires healthy state after rollback");
  }
  return errors;
}

export function validateMarketEvidence(report, filename = "<market>") {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(`${filename}: ${message}`); };
  require(exactKeys(report, ["schema_version", "report_type", "release_id", "source_sha", "status", "segment", "customers", "gates", "decision"]), "root fields must match the market contract exactly");
  require(report.schema_version === "1.0", "schema_version must equal 1.0");
  require(report.report_type === "market", "report_type must equal market");
  require(RELEASE_ID.test(report.release_id ?? ""), "release_id is invalid");
  require(FULL_SHA.test(report.source_sha ?? ""), "source_sha must be a full Git SHA");
  require(["open", "pass", "failed"].includes(report.status), "status is invalid");
  require(exactKeys(report.segment, ["core_segment", "employee_min", "employee_max", "geography", "outcome"]), "segment fields are invalid");
  require(Number.isInteger(report.segment?.employee_min) && report.segment.employee_min > 0, "segment.employee_min must be positive");
  require(Number.isInteger(report.segment?.employee_max) && report.segment.employee_max >= report.segment.employee_min, "segment.employee_max is invalid");
  require(exactKeys(report.gates, ["R0", "R1", "R2", "R3"]), "gates must be exactly R0-R3");
  for (const id of ["R0", "R1", "R2", "R3"]) {
    const gate = report.gates?.[id] ?? {};
    require(exactKeys(gate, ["status", "evidence"]), `${id} fields are invalid`);
    require(["open", "pass", "failed"].includes(gate.status), `${id}.status is invalid`);
    require(Array.isArray(gate.evidence), `${id}.evidence must be an array`);
    if (gate.status === "pass") require(evidenceList(gate.evidence), `${id} PASS requires HTTPS evidence`);
  }
  require(exactKeys(report.decision, ["status", "reason"]), "decision fields are invalid");
  require(["open", "go", "reshape", "stop"].includes(report.decision?.status), "decision.status is invalid");
  require(Array.isArray(report.customers), "customers must be an array");

  const customers = report.customers ?? [];
  for (const [index, customer] of customers.entries()) {
    const prefix = `customers[${index}]`;
    require(exactKeys(customer, ["customer_ref", "organization_evidence_url", "employee_band", "process", "sponsor_role", "process_owner_role", "problem_confirmed", "budget_path", "next_commitment_at", "diagnostic", "pilot", "outcome"]), `${prefix} fields are invalid`);
    require(nonEmpty(customer.customer_ref), `${prefix}.customer_ref is required`);
    require(httpsOrEmpty(customer.organization_evidence_url), `${prefix}.organization_evidence_url must be empty or HTTPS`);
    require(Number.isInteger(customer.employee_band) && customer.employee_band > 0, `${prefix}.employee_band must be positive`);
    require(exactKeys(customer.diagnostic, ["paid_amount_eur", "evidence_url", "metric_name", "metric_unit", "baseline", "after", "accepted_by"]), `${prefix}.diagnostic fields are invalid`);
    require(httpsOrEmpty(customer.diagnostic?.evidence_url), `${prefix}.diagnostic.evidence_url must be empty or HTTPS`);
    require(exactKeys(customer.pilot, ["price_eur", "start_date", "end_date", "scope", "success_criteria", "delivery_cost_eur", "evidence_url"]), `${prefix}.pilot fields are invalid`);
    require(httpsOrEmpty(customer.pilot?.evidence_url), `${prefix}.pilot.evidence_url must be empty or HTTPS`);
    require(exactKeys(customer.outcome, ["name", "accepted", "evidence_url"]), `${prefix}.outcome fields are invalid`);
    require(httpsOrEmpty(customer.outcome?.evidence_url), `${prefix}.outcome.evidence_url must be empty or HTTPS`);
  }

  if (report.gates?.R0?.status === "pass") {
    require(customers.some((customer) => customer.problem_confirmed === true && nonEmpty(customer.process) && nonEmpty(customer.sponsor_role) && nonEmpty(customer.process_owner_role) && nonEmpty(customer.budget_path) && isoDate(customer.next_commitment_at) && HTTPS.test(customer.organization_evidence_url ?? "")), "R0 PASS requires a qualified company, problem, budget path and dated next commitment");
  }
  if (report.gates?.R1?.status === "pass") {
    require(customers.some((customer) => customer.diagnostic?.paid_amount_eur > 0 && HTTPS.test(customer.diagnostic?.evidence_url ?? "") && nonEmpty(customer.diagnostic?.metric_name) && nonEmpty(customer.diagnostic?.metric_unit) && Number.isFinite(customer.diagnostic?.baseline) && Number.isFinite(customer.diagnostic?.after) && customer.diagnostic.baseline !== customer.diagnostic.after && nonEmpty(customer.diagnostic?.accepted_by)), "R1 PASS requires a paid diagnosis with measured change and buyer acceptance");
  }
  if (report.gates?.R2?.status === "pass") {
    require(customers.some((customer) => customer.pilot?.price_eur > 0 && customer.pilot?.delivery_cost_eur >= 0 && customer.pilot.delivery_cost_eur < customer.pilot.price_eur && isoDate(customer.pilot?.start_date) && isoDate(customer.pilot?.end_date) && Date.parse(customer.pilot.end_date) > Date.parse(customer.pilot.start_date) && nonEmpty(customer.pilot?.scope) && nonEmpty(customer.pilot?.success_criteria) && HTTPS.test(customer.pilot?.evidence_url ?? "")), "R2 PASS requires a priced, bounded, profitable pilot with dates and success criteria");
  }
  if (report.gates?.R3?.status === "pass") {
    const repeatable = customers.filter((customer) => customer.pilot?.price_eur > 0 && HTTPS.test(customer.pilot?.evidence_url ?? "") && customer.outcome?.accepted === true && customer.outcome?.name === report.segment?.outcome && HTTPS.test(customer.outcome?.evidence_url ?? ""));
    require(new Set(repeatable.map((customer) => customer.customer_ref)).size >= 3, "R3 PASS requires three distinct paying customers for the same accepted outcome");
  }
  if (report.status === "pass") {
    require(["R0", "R1", "R2", "R3"].every((id) => report.gates?.[id]?.status === "pass"), "market PASS requires R0-R3 PASS");
    require(report.decision?.status === "go" && nonEmpty(report.decision?.reason), "market PASS requires a reasoned GO decision");
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2).map((path) => resolve(path));
  if (paths.length === 0) {
    console.error("Aufruf: verify-readiness-evidence.mjs <operations.json|market.json> [...]");
    process.exit(2);
  }
  let failed = false;
  for (const path of paths) {
    try {
      const report = JSON.parse(readFileSync(path, "utf8"));
      const validator = report.report_type === "operations" ? validateOperationsEvidence : report.report_type === "market" ? validateMarketEvidence : null;
      const errors = validator ? validator(report, path) : [`${path}: unknown report_type`];
      if (errors.length) {
        failed = true;
        errors.forEach((error) => console.error(`FAIL ${error}`));
      } else {
        console.log(`PASS ${path} :: ${report.report_type} :: ${report.status}`);
      }
    } catch (error) {
      failed = true;
      console.error(`FAIL ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
