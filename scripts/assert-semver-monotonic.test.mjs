import assert from "node:assert/strict";
import test from "node:test";

import { assertMonotonic, compareVersions, parseVersion } from "./assert-semver-monotonic.mjs";

test("accepts strictly newer core versions", () => {
  for (const candidate of ["v1.2.4", "v1.3.0", "v2.0.0"]) {
    assert.doesNotThrow(() => assertMonotonic("v1.2.3", candidate));
  }
});

test("rejects equal and lower core versions", () => {
  for (const candidate of ["v1.2.3", "v1.2.2", "v1.1.99", "v0.99.99"]) {
    assert.throws(() => assertMonotonic("v1.2.3", candidate), /muss strikt neuer/);
  }
});

test("implements SemVer prerelease precedence", () => {
  assert.equal(compareVersions("v1.0.0-rc.10", "v1.0.0-rc.2"), 1);
  assert.equal(compareVersions("v1.0.0-1", "v1.0.0-alpha"), -1);
  assert.equal(compareVersions("v1.0.0", "v1.0.0-rc.99"), 1);
  assert.throws(() => assertMonotonic("v1.0.0", "v1.0.0-rc.1"), /muss strikt neuer/);
});

test("ignores build metadata for precedence", () => {
  assert.equal(compareVersions("v1.2.3+build.2", "v1.2.3+build.1"), 0);
  assert.throws(() => assertMonotonic("v1.2.3+build.1", "v1.2.3+build.2"), /muss strikt neuer/);
});

test("fails closed on malformed versions", () => {
  for (const tag of ["1.2.3", "v1.2", "v01.2.3", "v1.2.3-rc.01", "v1.2.3-"]) {
    assert.throws(() => parseVersion(tag), /Ungültig/);
  }
});
