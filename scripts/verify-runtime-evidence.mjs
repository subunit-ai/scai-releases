#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = {
  "aarch64-apple-darwin": { os: "macos", arch: "aarch64", distinctArtifacts: true },
  "x86_64-apple-darwin": { os: "macos", arch: "x86_64", distinctArtifacts: true },
  "aarch64-pc-windows-msvc": { os: "windows", arch: "aarch64", distinctArtifacts: false },
  "x86_64-pc-windows-msvc": { os: "windows", arch: "x86_64", distinctArtifacts: false },
  "x86_64-unknown-linux-gnu": { os: "linux", arch: "x86_64", distinctArtifacts: true },
};

const exactKeys = (value, expected) =>
  value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export function validateRuntimeEvidence(report, target, version, sourceSha) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const targetContract = TARGETS[target];

  require(Boolean(targetContract), `unsupported target: ${target}`);
  require(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.]+)?$/.test(version), "expected version is invalid");
  require(/^[0-9a-f]{40}$/.test(sourceSha), "expected source SHA is invalid");
  require(exactKeys(report, ["schema_version", "status", "target", "version", "source_sha", "packages"]), "top-level evidence keys must be exact");
  require(report?.schema_version === "1.0", "schema_version must be 1.0");
  require(report?.status === "pass", "runtime evidence must be pass");
  require(report?.target === target, "runtime target drift");
  require(report?.version === version, "runtime version drift");
  require(report?.source_sha === sourceSha, "runtime source SHA drift");
  require(Array.isArray(report?.packages) && report.packages.length === 2, "exactly installer and updater evidence are required");

  const roles = Array.isArray(report?.packages) ? report.packages.map((entry) => entry?.role).sort() : [];
  require(JSON.stringify(roles) === JSON.stringify(["installer", "updater"]), "package roles must be exactly installer and updater");

  for (const entry of report?.packages ?? []) {
    require(exactKeys(entry, ["role", "artifact_basename", "artifact_sha256", "evidence"]), `${entry?.role ?? "unknown"}: package keys must be exact`);
    require(typeof entry?.artifact_basename === "string" && /^[^/\\\0]+$/.test(entry.artifact_basename), `${entry?.role}: artifact basename is invalid`);
    require(/^[0-9a-f]{64}$/.test(entry?.artifact_sha256 ?? ""), `${entry?.role}: artifact SHA-256 is invalid`);
    const proof = entry?.evidence;
    require(exactKeys(proof, ["schema_version", "status", "product_binary", "package_name", "version", "source_sha", "target_os", "target_arch"]), `${entry?.role}: binary evidence keys must be exact`);
    require(proof?.schema_version === "1.0" && proof?.status === "pass", `${entry?.role}: binary evidence must pass`);
    require(proof?.product_binary === "subunit-scai" && proof?.package_name === "subunit-scai", `${entry?.role}: wrong product binary`);
    require(proof?.version === version, `${entry?.role}: packaged version drift`);
    require(proof?.source_sha === sourceSha, `${entry?.role}: packaged source SHA drift`);
    if (targetContract) {
      require(proof?.target_os === targetContract.os, `${entry?.role}: packaged OS drift`);
      require(proof?.target_arch === targetContract.arch, `${entry?.role}: packaged architecture drift`);
    }
  }

  if (targetContract?.distinctArtifacts && Array.isArray(report?.packages) && report.packages.length === 2) {
    require(report.packages[0].artifact_sha256 !== report.packages[1].artifact_sha256, "installer and updater must be distinct artifacts on this target");
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, target, version, sourceSha] = process.argv.slice(2);
  if (!path || !target || !version || !sourceSha) {
    console.error("usage: verify-runtime-evidence.mjs <file> <target> <version> <source-sha>");
    process.exit(64);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    console.error(`FAIL cannot read runtime evidence: ${error.message}`);
    process.exit(1);
  }
  const errors = validateRuntimeEvidence(report, target, version, sourceSha);
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exit(1);
  }
  console.log(`PASS runtime evidence ${target} :: installed product + updater payload bound to ${version}/${sourceSha}`);
}
