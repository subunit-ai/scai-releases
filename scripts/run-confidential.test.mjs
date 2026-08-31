import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { constants, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(ROOT, "scripts/run-confidential.sh");

function invoke(label, script, env = {}) {
  const runnerTemp = mkdtempSync(join(tmpdir(), "scai-confidential-test-"));
  const extraEnv = typeof env === "function" ? env(runnerTemp) : env;
  const result = spawnSync(
    "bash",
    [RUNNER, label, "bash", "-c", script],
    { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: runnerTemp, ...extraEnv } },
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

test("failed private output can leave the runner only as a one-time encrypted envelope", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const publicKeyBase64 = Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64");
  const marker = "PRIVATE_ENCRYPTED_DIAGNOSTIC_CANARY";
  const sealed = invoke("encrypted-failure", `printf '${marker}\\n' >&2; exit 27`, (runnerTemp) => ({
    SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64: publicKeyBase64,
    SCAI_ENCRYPTED_DIAGNOSTIC_PATH: join(runnerTemp, "diagnostic.json"),
  }));
  const diagnosticPath = join(sealed.runnerTemp, "diagnostic.json");
  assert.equal(sealed.status, 27);
  assert.doesNotMatch(sealed.stdout + sealed.stderr, new RegExp(marker));
  assert.equal(existsSync(diagnosticPath), true);

  const envelope = JSON.parse(readFileSync(diagnosticPath, "utf8"));
  const contentKey = privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(envelope.wrapped_key, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  assert.equal(plaintext.toString("utf8"), `${marker}\n`);
  assert.equal(createHash("sha256").update(plaintext).digest("hex"), envelope.plaintext_sha256);
  assertNoRetainedLogs(sealed.runnerTemp);
});

test("invalid diagnostic keys fail closed without claiming that an envelope was sealed", () => {
  const marker = "PRIVATE_INVALID_KEY_CANARY";
  const sealed = invoke("invalid-key-failure", `printf '${marker}\\n' >&2; exit 29`, (runnerTemp) => ({
    SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64: Buffer.from("not a PEM public key").toString("base64"),
    SCAI_ENCRYPTED_DIAGNOSTIC_PATH: join(runnerTemp, "diagnostic.json"),
  }));
  const publicOutput = sealed.stdout + sealed.stderr;
  assert.equal(sealed.status, 70);
  assert.doesNotMatch(publicOutput, new RegExp(marker));
  assert.doesNotMatch(publicOutput, /private failure log sealed/);
  assert.match(publicOutput, /Encrypted diagnostic unavailable/);
  assert.equal(existsSync(join(sealed.runnerTemp, "diagnostic.json")), false);
  assertNoRetainedLogs(sealed.runnerTemp);
});
