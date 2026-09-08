import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENCRYPT = join(ROOT, "scripts/encrypt-confidential-log.mjs");
const DECRYPT = join(ROOT, "scripts/decrypt-confidential-envelope.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "confidential-envelope-test-"));
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const publicKeyBase64 = Buffer.from(
    publicKey.export({ type: "spki", format: "pem" }),
  ).toString("base64");
  const privateKeyPath = join(root, "private.pem");
  writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return { root, publicKeyBase64, privateKeyPath };
}

test("round-trips binary data and refuses to overwrite an output", () => {
  const { root, publicKeyBase64, privateKeyPath } = fixture();
  const input = join(root, "input.bin");
  const envelope = join(root, "envelope.json");
  const output = join(root, "output.bin");
  const content = Buffer.from([0, 1, 2, 3, 255, 10, 0, 42]);
  writeFileSync(input, content);

  assert.equal(spawnSync(process.execPath, [ENCRYPT, input, envelope, publicKeyBase64]).status, 0);
  assert.equal(spawnSync(process.execPath, [DECRYPT, envelope, output, privateKeyPath]).status, 0);
  assert.deepEqual(readFileSync(output), content);
  assert.notEqual(spawnSync(process.execPath, [DECRYPT, envelope, output, privateKeyPath]).status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("rejects tampered ciphertext and produces no plaintext", () => {
  const { root, publicKeyBase64, privateKeyPath } = fixture();
  const input = join(root, "input.bin");
  const envelope = join(root, "envelope.json");
  const output = join(root, "output.bin");
  writeFileSync(input, "signed trace bundle");
  assert.equal(spawnSync(process.execPath, [ENCRYPT, input, envelope, publicKeyBase64]).status, 0);

  const parsed = JSON.parse(readFileSync(envelope, "utf8"));
  const ciphertext = Buffer.from(parsed.ciphertext, "base64");
  ciphertext[0] ^= 0xff;
  parsed.ciphertext = ciphertext.toString("base64");
  writeFileSync(envelope, `${JSON.stringify(parsed)}\n`);

  const result = spawnSync(process.execPath, [DECRYPT, envelope, output, privateKeyPath]);
  assert.notEqual(result.status, 0);
  assert.throws(() => readFileSync(output));
  rmSync(root, { recursive: true, force: true });
});
