import assert from "node:assert/strict";
import test from "node:test";

import { mergeCycloneDx } from "./merge-cyclonedx.mjs";

const bom = (root, dependency) => ({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: { component: { type: "application", name: root, version: "1", "bom-ref": "root" } },
  components: [{ type: "library", name: dependency, version: "1", "bom-ref": "shared-ref" }],
  dependencies: [{ ref: "root", dependsOn: ["shared-ref"] }],
});

test("merges Node and Rust without cross-ecosystem bom-ref collisions", () => {
  const merged = mergeCycloneDx(bom("frontend", "react"), bom("native", "tauri"), {
    name: "scai",
    version: "0.126.0",
    sourceSha: "a".repeat(40),
    timestamp: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(merged.bomFormat, "CycloneDX");
  assert.equal(merged.specVersion, "1.5");
  assert.equal(merged.$schema, "http://cyclonedx.org/schema/bom-1.5.schema.json");
  assert.match(
    merged.serialNumber,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(merged.components.map((entry) => entry["bom-ref"]), [
    "npm:root",
    "npm:shared-ref",
    "cargo:root",
    "cargo:shared-ref",
  ]);
  assert.deepEqual(merged.dependencies[0].dependsOn, ["cargo:root", "npm:root"]);
});

test("binds a deterministic CycloneDX document serial to the release identity", () => {
  const options = {
    name: "scai",
    version: "0.132.0",
    sourceSha: "b".repeat(40),
    timestamp: "2026-08-31T00:00:00.000Z",
  };
  const first = mergeCycloneDx(bom("frontend", "react"), bom("native", "tauri"), options);
  const repeated = mergeCycloneDx(bom("frontend", "react"), bom("native", "tauri"), options);
  const nextSource = mergeCycloneDx(bom("frontend", "react"), bom("native", "tauri"), {
    ...options,
    sourceSha: "c".repeat(40),
  });

  assert.equal(first.serialNumber, repeated.serialNumber);
  assert.notEqual(first.serialNumber, nextSource.serialNumber);
});

test("rejects an unpinned source", () => {
  assert.throws(() => mergeCycloneDx(bom("frontend", "react"), bom("native", "tauri"), {
    name: "scai",
    version: "0.126.0",
    sourceSha: "a2d1881",
    timestamp: "2026-08-24T00:00:00.000Z",
  }), /vollständiger Git-SHA/);
});
