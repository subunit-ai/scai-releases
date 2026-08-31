import assert from "node:assert/strict";
import test from "node:test";

import { validateProductMetadata } from "./verify-product-binary.mjs";

const manifestPath = "/private/source/src-tauri/Cargo.toml";

function metadata(targets) {
  return { packages: [{ manifest_path: manifestPath, targets }] };
}

const product = {
  name: "subunit-scai",
  kind: ["bin"],
  src_path: "/private/source/src-tauri/src/main.rs",
};

test("accepts one product binary plus a non-binary smoke example", () => {
  const errors = validateProductMetadata(metadata([
    product,
    { name: "a1_keyring_smoke", kind: ["example"], src_path: "/private/source/src-tauri/examples/a1_keyring_smoke.rs" },
  ]), manifestPath);
  assert.deepEqual(errors, []);
});

test("rejects the historical auto-discovered smoke binary", () => {
  const errors = validateProductMetadata(metadata([
    product,
    { name: "a1_keyring_smoke", kind: ["bin"], src_path: "/private/source/src-tauri/src/bin/a1_keyring_smoke.rs" },
  ]), manifestPath);
  assert.match(errors.join("\n"), /exactly one Cargo binary target/);
});

test("rejects a wrong single binary or a redirected product source", () => {
  assert.match(
    validateProductMetadata(metadata([{ ...product, name: "a1_keyring_smoke" }]), manifestPath).join("\n"),
    /must be subunit-scai/,
  );
  assert.match(
    validateProductMetadata(metadata([{ ...product, src_path: "/private/source/src-tauri/src/bin/subunit-scai.rs" }]), manifestPath).join("\n"),
    /must resolve to src\/main.rs/,
  );
});

test("binds the proof to the requested manifest", () => {
  assert.match(
    validateProductMetadata(metadata([product]), "/other/source/Cargo.toml").join("\n"),
    /exactly the requested Tauri package/,
  );
});
