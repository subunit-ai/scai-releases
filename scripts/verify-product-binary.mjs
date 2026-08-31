#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalized(path) {
  return resolve(path).replaceAll("\\", "/");
}

export function validateProductMetadata(metadata, manifestPath) {
  const errors = [];
  const expectedManifest = normalized(manifestPath);
  const packages = Array.isArray(metadata?.packages) ? metadata.packages : [];
  const matching = packages.filter((candidate) => normalized(candidate.manifest_path ?? ".") === expectedManifest);

  if (matching.length !== 1) {
    return ["Cargo metadata must contain exactly the requested Tauri package"];
  }

  const binaryTargets = (matching[0].targets ?? []).filter((target) => target.kind?.includes("bin"));
  if (binaryTargets.length !== 1) {
    return ["Tauri package must expose exactly one Cargo binary target"];
  }

  const [product] = binaryTargets;
  if (product.name !== "subunit-scai") {
    errors.push("the only Cargo binary target must be subunit-scai");
  }

  const expectedSource = normalized(resolve(dirname(manifestPath), "src/main.rs"));
  if (normalized(product.src_path ?? ".") !== expectedSource) {
    errors.push("the product binary must resolve to src/main.rs");
  }

  return errors;
}

function inspect(manifestPath) {
  const result = spawnSync(
    "cargo",
    ["metadata", "--locked", "--no-deps", "--format-version", "1", "--manifest-path", manifestPath],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return ["Cargo metadata could not be verified"];
  }

  try {
    return validateProductMetadata(JSON.parse(result.stdout), manifestPath);
  } catch {
    return ["Cargo metadata was not valid JSON"];
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv[2];
  if (!manifestPath || process.argv.length !== 3) {
    console.error("usage: verify-product-binary.mjs <Cargo.toml>");
    process.exit(64);
  }

  const errors = inspect(resolve(manifestPath));
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exit(1);
  }
  console.log("PASS product binary :: exactly subunit-scai from src/main.rs; helper programs remain examples");
}
