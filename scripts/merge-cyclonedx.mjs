#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;

function requireBom(value, label) {
  if (!value || value.bomFormat !== "CycloneDX" || !Array.isArray(value.components)) {
    throw new Error(`${label} ist kein unterstütztes CycloneDX-JSON`);
  }
}

function namespaceBom(bom, namespace) {
  const mapRef = (reference) => `${namespace}:${reference}`;
  const components = [];
  const root = bom.metadata?.component;
  if (root?.["bom-ref"]) components.push({ ...root, "bom-ref": mapRef(root["bom-ref"]) });
  for (const component of bom.components) {
    if (!component?.["bom-ref"]) throw new Error(`${namespace}: Komponente ohne bom-ref`);
    components.push({ ...component, "bom-ref": mapRef(component["bom-ref"]) });
  }

  const dependencies = (bom.dependencies ?? []).map((dependency) => ({
    ref: mapRef(dependency.ref),
    dependsOn: [...new Set((dependency.dependsOn ?? []).map(mapRef))].sort(),
  }));
  return {
    components,
    dependencies,
    rootRef: root?.["bom-ref"] ? mapRef(root["bom-ref"]) : null,
  };
}

export function mergeCycloneDx(nodeBom, rustBom, { name, version, sourceSha, timestamp }) {
  requireBom(nodeBom, "Node-SBOM");
  requireBom(rustBom, "Rust-SBOM");
  if (!name?.trim() || !version?.trim()) throw new Error("Name und Version sind Pflicht");
  if (!FULL_SHA.test(sourceSha ?? "")) throw new Error("sourceSha muss ein vollständiger Git-SHA sein");
  if (!Number.isFinite(Date.parse(timestamp ?? ""))) throw new Error("timestamp muss ISO-8601 sein");

  const node = namespaceBom(nodeBom, "npm");
  const rust = namespaceBom(rustBom, "cargo");
  const rootRef = `pkg:generic/subunit-ai/${name}@${version}?vcs_ref=${sourceSha}`;
  const rootDependsOn = [node.rootRef, rust.rootRef].filter(Boolean).sort();

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp,
      component: {
        type: "application",
        name,
        version,
        "bom-ref": rootRef,
        properties: [
          { name: "subunit:source_repository", value: "https://github.com/subunit-ai/subunit-scai" },
          { name: "subunit:source_sha", value: sourceSha },
        ],
      },
    },
    components: [...node.components, ...rust.components],
    dependencies: [
      { ref: rootRef, dependsOn: rootDependsOn },
      ...node.dependencies,
      ...rust.dependencies,
    ],
  };
}

function main(argv) {
  const [nodePath, rustPath, outputPath, name, version, sourceSha, timestamp] = argv;
  if (!timestamp) {
    throw new Error("Aufruf: merge-cyclonedx.mjs <node.json> <rust.json> <output.json> <name> <version> <source-sha> <timestamp>");
  }
  const merged = mergeCycloneDx(
    JSON.parse(readFileSync(resolve(nodePath), "utf8")),
    JSON.parse(readFileSync(resolve(rustPath), "utf8")),
    { name, version, sourceSha, timestamp },
  );
  writeFileSync(resolve(outputPath), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
