import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(ROOT, "scripts/run-confidential.sh");

function invoke(label, script) {
  const runnerTemp = mkdtempSync(join(tmpdir(), "scai-confidential-test-"));
  const result = spawnSync(
    "bash",
    [RUNNER, label, "bash", "-c", script],
    { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: runnerTemp } },
  );
  return { ...result, runnerTemp };
}

function assertNoRetainedLogs(runnerTemp) {
  const logDir = join(runnerTemp, "scai-confidential-logs");
  assert.equal(existsSync(logDir), true);
  assert.deepEqual(readdirSync(logDir), []);
  rmSync(runnerTemp, { recursive: true, force: true });
}

test("successful private output is replaced by a digest-only PASS", () => {
  const marker = "PRIVATE_SOURCE_CANARY_SUCCESS";
  const result = invoke("success-check", `printf '${marker}\\n'`);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(marker));
  assert.match(result.stdout, /^PASS success-check \(private-log-sha256=[0-9a-f]{64}, bytes=30\)\n$/);
  assertNoRetainedLogs(result.runnerTemp);
});

test("failed private output is suppressed while the original exit code survives", () => {
  const marker = "PRIVATE_SOURCE_CANARY_FAILURE";
  const result = invoke("failure-check", `printf '${marker}\\n' >&2; exit 23`);
  assert.equal(result.status, 23);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(marker));
  assert.match(result.stdout, /failure-check failed with exit 23; private output suppressed/);
  assertNoRetainedLogs(result.runnerTemp);
});

test("digest stays plain hexadecimal when the temporary path contains a backslash", () => {
  const runnerRoot = mkdtempSync(join(tmpdir(), "scai-confidential-test-"));
  const runnerTemp = join(runnerRoot, "windows\\path");
  mkdirSync(runnerTemp);
  const result = spawnSync(
    "bash",
    [RUNNER, "windows-path-check", "bash", "-c", "printf 'private\\n'"],
    { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: runnerTemp } },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^PASS windows-path-check \(private-log-sha256=[0-9a-f]{64}, bytes=8\)\n$/);
  assertNoRetainedLogs(runnerTemp);
  rmSync(runnerRoot, { recursive: true, force: true });
});

test("labels cannot inject workflow commands or filesystem paths", () => {
  const runnerTemp = mkdtempSync(join(tmpdir(), "scai-confidential-test-"));
  const result = spawnSync(
    "bash",
    [RUNNER, "../::warning::bad", "true"],
    { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: runnerTemp } },
  );
  assert.equal(result.status, 64);
  assert.match(result.stderr, /invalid confidential command label/);
  assert.deepEqual(readdirSync(runnerTemp), []);
  rmSync(runnerTemp, { recursive: true, force: true });
});
