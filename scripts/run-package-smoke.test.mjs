import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE = join(ROOT, "scripts/run-package-smoke.sh");
const VERSION = "0.139.0";
const SOURCE_SHA = "a".repeat(40);

const hasTool = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0;
const LINUX_LANE = process.platform === "linux" && hasTool("dpkg-deb");
const MACOS_LANE = process.platform === "darwin" && hasTool("hdiutil");

// Steht für das echte Produkt: schreibt den Laufzeitbeleg, den der Smoke einfordert.
// `exitCode` und `writesEvidence` bilden die Ausfälle nach, die es zu fangen gilt.
function productScript({ exitCode = 0, writesEvidence = true } = {}) {
  return [
    "#!/bin/sh",
    'test "$1" = "--release-smoke" || test "$2" = "--release-smoke" || exit 3',
    writesEvidence
      ? 'printf \'{"version":"%s","source_sha":"%s"}\\n\' "$SCAI_EXPECTED_VERSION" "$SCAI_EXPECTED_SOURCE_SHA" > "$SCAI_RELEASE_SMOKE_EVIDENCE"'
      : ": # schreibt bewusst keinen Beleg",
    `exit ${exitCode}`,
    "",
  ].join("\n");
}

function writeExecutable(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function workspace() {
  return mkdtempSync(join(tmpdir(), "scai-package-smoke-"));
}

function runSmoke(target, bundleRoot, home, { version = VERSION, sourceSha = SOURCE_SHA } = {}) {
  const runnerTemp = join(home, "runner-temp");
  mkdirSync(runnerTemp, { recursive: true });
  return spawnSync("bash", [SMOKE, target, bundleRoot, version, sourceSha, join(home, "report.json")], {
    encoding: "utf8",
    env: { ...process.env, RUNNER_TEMP: runnerTemp },
  });
}

// ── Eingangsprüfungen: gelten auf jeder Plattform ───────────────────────────────

test("rejects a call that does not carry all five arguments", () => {
  assert.equal(spawnSync("bash", [SMOKE, "x86_64-unknown-linux-gnu"], { encoding: "utf8" }).status, 64);
});

test("rejects an unsupported non-Windows target", () => {
  const home = workspace();
  const bundleRoot = join(home, "bundle");
  mkdirSync(bundleRoot, { recursive: true });
  assert.equal(runSmoke("x86_64-pc-windows-msvc", bundleRoot, home).status, 65);
  rmSync(home, { recursive: true, force: true });
});

test("rejects a malformed version or source SHA", () => {
  const home = workspace();
  const bundleRoot = join(home, "bundle");
  mkdirSync(bundleRoot, { recursive: true });
  assert.notEqual(runSmoke("x86_64-unknown-linux-gnu", bundleRoot, home, { version: "latest" }).status, 0);
  assert.notEqual(runSmoke("x86_64-unknown-linux-gnu", bundleRoot, home, { sourceSha: "deadbeef" }).status, 0);
  rmSync(home, { recursive: true, force: true });
});

// ── Linux-Schiene: .deb + AppImage ──────────────────────────────────────────────

function linuxBundle(home, { binaryName = "subunit-scai", product = productScript(), extraDeb = false } = {}) {
  const bundleRoot = join(home, "bundle");
  const staging = join(home, "staging");
  writeExecutable(join(staging, "usr/bin", binaryName), product);
  mkdirSync(join(staging, "DEBIAN"), { recursive: true });
  writeFileSync(
    join(staging, "DEBIAN/control"),
    ["Package: scai", `Version: ${VERSION}`, "Architecture: amd64", "Maintainer: Subunit <git@subunit.ai>", "Description: Testpaket", ""].join("\n"),
  );
  mkdirSync(join(bundleRoot, "deb"), { recursive: true });
  const deb = join(bundleRoot, "deb", `SCAI_${VERSION}_amd64.deb`);
  const built = spawnSync("dpkg-deb", ["--build", staging, deb], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  if (extraDeb) {
    // Kopieren statt ein zweites Mal bauen: die Fixture-Aussage ist "zwei .deb im
    // Bundle-Root", die darf nicht davon abhaengen, ob dpkg-deb ein zweites Mal laeuft.
    copyFileSync(deb, join(bundleRoot, "deb", `SCAI_${VERSION}_amd64.kopie.deb`));
  }
  const debs = readdirSync(join(bundleRoot, "deb")).filter((name) => name.endsWith(".deb"));
  assert.equal(debs.length, extraDeb ? 2 : 1, `Fixture unbrauchbar: ${debs.length} .deb im Bundle-Root`);
  writeExecutable(join(bundleRoot, "appimage", `SCAI_${VERSION}_amd64.AppImage`), product);
  return bundleRoot;
}

test("accepts a Linux bundle that ships and starts the product binary", { skip: !LINUX_LANE }, () => {
  const home = workspace();
  const result = runSmoke("x86_64-unknown-linux-gnu", linuxBundle(home), home);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(home, "report.json"), "utf8"));
  assert.equal(report.status, "pass");
  assert.deepEqual(report.packages.map((entry) => entry.role), ["installer", "updater"]);
  rmSync(home, { recursive: true, force: true });
});

// Der Vorfall vom 31.08.: v0.131.0-v0.135.0 trugen a1_keyring_smoke statt
// subunit-scai. Genau dieses Paket muss die Schiene abweisen.
test("rejects a Linux .deb that carries a foreign binary instead of the product", { skip: !LINUX_LANE }, () => {
  const home = workspace();
  const bundleRoot = linuxBundle(home, { binaryName: "a1_keyring_smoke" });
  assert.notEqual(runSmoke("x86_64-unknown-linux-gnu", bundleRoot, home).status, 0);
  rmSync(home, { recursive: true, force: true });
});

test("rejects a Linux payload that starts but writes no runtime evidence", { skip: !LINUX_LANE }, () => {
  const home = workspace();
  const bundleRoot = linuxBundle(home, { product: productScript({ writesEvidence: false }) });
  assert.notEqual(runSmoke("x86_64-unknown-linux-gnu", bundleRoot, home).status, 0);
  rmSync(home, { recursive: true, force: true });
});

test("rejects a Linux payload whose product exits non-zero", { skip: !LINUX_LANE }, () => {
  const home = workspace();
  const bundleRoot = linuxBundle(home, { product: productScript({ exitCode: 1 }) });
  assert.notEqual(runSmoke("x86_64-unknown-linux-gnu", bundleRoot, home).status, 0);
  rmSync(home, { recursive: true, force: true });
});

test("rejects a Linux bundle root holding more than one installer", { skip: !LINUX_LANE }, () => {
  const home = workspace();
  const bundleRoot = linuxBundle(home, { extraDeb: true });
  assert.notEqual(runSmoke("x86_64-unknown-linux-gnu", bundleRoot, home).status, 0);
  rmSync(home, { recursive: true, force: true });
});

// ── macOS-Schiene: .dmg + .app.tar.gz ───────────────────────────────────────────

function macosBundle(home, { binaryName = "subunit-scai", product = productScript() } = {}) {
  const bundleRoot = join(home, "bundle");
  const appRoot = join(home, "app");
  const app = join(appRoot, "SCAI.app");
  writeExecutable(join(app, "Contents/MacOS", binaryName), product);
  writeFileSync(join(app, "Contents/Info.plist"), "<plist><dict/></plist>\n");

  mkdirSync(join(bundleRoot, "dmg"), { recursive: true });
  const dmg = join(bundleRoot, "dmg", `SCAI_${VERSION}_aarch64.dmg`);
  const created = spawnSync(
    "hdiutil",
    ["create", "-srcfolder", appRoot, "-volname", "SCAI", "-format", "UDZO", "-ov", "-quiet", dmg],
    { encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr);

  mkdirSync(join(bundleRoot, "macos"), { recursive: true });
  const tarred = spawnSync("tar", ["-czf", join(bundleRoot, "macos", "SCAI_aarch64.app.tar.gz"), "-C", appRoot, "SCAI.app"], {
    encoding: "utf8",
  });
  assert.equal(tarred.status, 0, tarred.stderr);
  return bundleRoot;
}

test("accepts a macOS bundle that ships and starts the product binary", { skip: !MACOS_LANE }, () => {
  const home = workspace();
  const result = runSmoke("aarch64-apple-darwin", macosBundle(home), home);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(home, "report.json"), "utf8"));
  assert.equal(report.status, "pass");
  assert.equal(report.packages.length, 2);
  rmSync(home, { recursive: true, force: true });
});

test("rejects a macOS .app that carries a foreign binary instead of the product", { skip: !MACOS_LANE }, () => {
  const home = workspace();
  const bundleRoot = macosBundle(home, { binaryName: "a1_keyring_smoke" });
  assert.notEqual(runSmoke("aarch64-apple-darwin", bundleRoot, home).status, 0);
  rmSync(home, { recursive: true, force: true });
});

test("rejects a macOS payload that starts but writes no runtime evidence", { skip: !MACOS_LANE }, () => {
  const home = workspace();
  const bundleRoot = macosBundle(home, { product: productScript({ writesEvidence: false }) });
  assert.notEqual(runSmoke("aarch64-apple-darwin", bundleRoot, home).status, 0);
  rmSync(home, { recursive: true, force: true });
});
