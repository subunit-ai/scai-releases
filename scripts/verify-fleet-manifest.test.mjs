import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateManifest } from "./verify-fleet-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(join(ROOT, "fleet/manifests/scai-candidate-2026-08-24.1.json"), "utf8"));
const clone = () => structuredClone(fixture);

test("current candidate is structurally valid and honestly blocked", () => {
  assert.deepEqual(validateManifest(clone()), []);
});

test("short component SHAs are rejected", () => {
  const manifest = clone();
  manifest.pins.atlas.sha = "dd60d554";
  assert.match(validateManifest(manifest).join("\n"), /atlas\.sha must be a full 40-character Git SHA/);
});

test("all A-gates must refer to the exact same release pin", () => {
  const manifest = clone();
  manifest.gates.A4.release_pin = "another-release";
  assert.match(validateManifest(manifest).join("\n"), /A4\.release_pin must equal release_id/);
});

test("unknown fields are rejected instead of silently ignored", () => {
  const manifest = clone();
  manifest.pins.atlas.unverified_note = "looks fine";
  assert.match(validateManifest(manifest).join("\n"), /atlas fields must match schema exactly/);
});

test("aggregate artifact PASS cannot hide an open platform", () => {
  const manifest = clone();
  manifest.artifacts.status = "pass";
  assert.match(validateManifest(manifest).join("\n"), /artifacts PASS requires every platform to PASS/);
});

test("a cosmetic top-level PASS fails closed while evidence remains open", () => {
  const manifest = clone();
  manifest.status = "pass";
  const errors = validateManifest(manifest).join("\n");
  assert.match(errors, /PASS requires an empty blocker list/);
  assert.match(errors, /PASS requires every pin to be merged/);
  assert.match(errors, /PASS requires A1-A8 to PASS/);
  assert.match(errors, /PASS requires market gates R0-R3 to PASS/);
  assert.match(errors, /PASS requires governance status PASS/);
  assert.match(errors, /PASS requires operations status PASS/);
});
