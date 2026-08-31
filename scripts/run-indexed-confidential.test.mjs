import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(ROOT, "scripts/run-indexed-confidential.sh");

function invoke(script, expectedCount = "30") {
  const runnerTemp = mkdtempSync(join(tmpdir(), "scai-indexed-confidential-test-"));
  const result = spawnSync(
    "bash",
    [RUNNER, "indexed-check", expectedCount, "bash", "-c", script],
    { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: runnerTemp } },
  );
  return { ...result, runnerTemp };
}

function assertNoPrivateOutput(result, markers) {
  const output = result.stdout + result.stderr;
  for (const marker of markers) assert.doesNotMatch(output, new RegExp(marker));
}

function cleanup(result) {
  const logDir = join(result.runnerTemp, "scai-confidential-logs");
  assert.equal(existsSync(logDir), true);
  assert.deepEqual(readdirSync(logDir), []);
  rmSync(result.runnerTemp, { recursive: true, force: true });
}

test("successful fixed-size proof emits only digest, byte count, and total", () => {
  const marker = "PRIVATE_SUCCESS_CANARY";
  const result = invoke(`for i in {1..30}; do printf 'PASS private-check-%s :: ${marker}\\n' "$i"; done`);
  assert.equal(result.status, 0);
  assertNoPrivateOutput(result, [marker, "private-check"]);
  assert.match(result.stdout, /^PASS indexed-check \(private-log-sha256=[0-9a-f]{64}, bytes=[0-9]+, checks=30\)\n$/);
  cleanup(result);
});

test("failed proof exposes only sorted zero-based indices", () => {
  const marker = "PRIVATE_FAILURE_CANARY";
  const result = invoke(`for i in {0..29}; do if [ "$i" = 4 ] || [ "$i" = 22 ]; then printf 'FAIL secret-%s :: ${marker}\\n' "$i"; else printf 'PASS secret-%s :: ${marker}\\n' "$i"; fi; done; exit 23`);
  assert.equal(result.status, 23);
  assertNoPrivateOutput(result, [marker, "secret-"]);
  assert.match(result.stdout, /failed-check-indices=4,22; total=30; private output suppressed/);
  cleanup(result);
});

test("wrong proof size fails closed without disclosing measured lines", () => {
  const marker = "PRIVATE_COUNT_CANARY";
  const result = invoke(`printf 'FAIL hidden-name :: ${marker}\\n'; exit 9`);
  assert.equal(result.status, 70);
  assertNoPrivateOutput(result, [marker, "hidden-name"]);
  assert.match(result.stdout, /invalid indexed proof; private output suppressed/);
  cleanup(result);
});

test("command status and indexed statuses must agree", () => {
  const allPassButFailed = invoke("for i in {1..30}; do printf 'PASS hidden-%s\\n' \"$i\"; done; exit 5");
  assert.equal(allPassButFailed.status, 70);
  assertNoPrivateOutput(allPassButFailed, ["hidden-"]);
  cleanup(allPassButFailed);

  const failButSucceeded = invoke("printf 'FAIL hidden-zero\\n'; for i in {2..30}; do printf 'PASS hidden-%s\\n' \"$i\"; done");
  assert.equal(failButSucceeded.status, 70);
  assertNoPrivateOutput(failButSucceeded, ["hidden-"]);
  cleanup(failButSucceeded);
});

test("untrusted labels and counts cannot widen the proof surface", () => {
  const badCount = invoke("true", "unbounded");
  assert.equal(badCount.status, 64);
  assert.match(badCount.stderr, /invalid expected check count/);
  assert.deepEqual(readdirSync(badCount.runnerTemp), []);
  rmSync(badCount.runnerTemp, { recursive: true, force: true });
});
