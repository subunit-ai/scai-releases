import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = join(ROOT, "scripts/validate-release-assets.sh");

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "scai-release-assets-"));
  for (const file of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "signed-artifact");
  }
  return root;
}

function validate(target, root) {
  return spawnSync("bash", [VALIDATOR, target, root], { encoding: "utf8" });
}

for (const [target, files] of [
  ["aarch64-apple-darwin", ["dmg/SCAI_0.126.0_aarch64.dmg", "macos/SCAI_aarch64.app.tar.gz", "macos/SCAI_aarch64.app.tar.gz.sig"]],
  ["x86_64-apple-darwin", ["dmg/SCAI_0.126.0_x64.dmg", "macos/SCAI_x64.app.tar.gz", "macos/SCAI_x64.app.tar.gz.sig"]],
  ["x86_64-pc-windows-msvc", ["nsis/SCAI_0.126.0_x64-setup.exe", "nsis/SCAI_0.126.0_x64-setup.exe.sig"]],
  ["x86_64-unknown-linux-gnu", ["appimage/SCAI_0.126.0_amd64.AppImage", "appimage/SCAI_0.126.0_amd64.AppImage.sig", "deb/SCAI_0.126.0_amd64.deb", "deb/SCAI_0.126.0_amd64.deb.sig"]],
]) {
  test(`accepts only the complete ${target} release set`, () => {
    const root = fixture([...files, "ignored/private-source.rs", "ignored/app.js.map"]);
    const result = validate(target, root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n").sort(), files.map((file) => join(root, file)).sort());
    rmSync(root, { recursive: true, force: true });
  });
}

test("rejects an incomplete updater pair", () => {
  const root = fixture(["nsis/SCAI_0.126.0_x64-setup.exe"]);
  assert.notEqual(validate("x86_64-pc-windows-msvc", root).status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("rejects colliding generic macOS updater archive names", () => {
  const root = fixture([
    "dmg/SCAI_0.126.0_aarch64.dmg",
    "macos/SCAI.app.tar.gz",
    "macos/SCAI.app.tar.gz.sig",
  ]);
  assert.notEqual(validate("aarch64-apple-darwin", root).status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("rejects an updater archive labeled for the other macOS architecture", () => {
  const root = fixture([
    "dmg/SCAI_0.126.0_aarch64.dmg",
    "macos/SCAI_x64.app.tar.gz",
    "macos/SCAI_x64.app.tar.gz.sig",
  ]);
  assert.notEqual(validate("aarch64-apple-darwin", root).status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("rejects an extra allowlisted artifact instead of uploading an ambiguous set", () => {
  const root = fixture([
    "nsis/SCAI_0.126.0_x64-setup.exe",
    "nsis/SCAI_0.126.0_x64-setup.exe.sig",
    "nsis/second-setup.exe",
  ]);
  assert.notEqual(validate("x86_64-pc-windows-msvc", root).status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("does not follow a symlink into an unvalidated artifact", () => {
  const root = fixture(["outside.exe", "outside.exe.sig"]);
  mkdirSync(join(root, "nsis"));
  symlinkSync(join(root, "outside.exe"), join(root, "nsis/SCAI_0.126.0_x64-setup.exe"));
  symlinkSync(join(root, "outside.exe.sig"), join(root, "nsis/SCAI_0.126.0_x64-setup.exe.sig"));
  assert.notEqual(validate("x86_64-pc-windows-msvc", join(root, "nsis")).status, 0);
  rmSync(root, { recursive: true, force: true });
});
