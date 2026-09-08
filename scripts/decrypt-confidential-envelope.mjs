#!/usr/bin/env node
import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  privateDecrypt,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [envelopePath, outputPath, privateKeyPath] = process.argv.slice(2);
if (!envelopePath || !outputPath || !privateKeyPath) {
  console.error("usage: decrypt-confidential-envelope.mjs <envelope.json> <output> <private-key.pem>");
  process.exit(64);
}

const envelope = JSON.parse(readFileSync(envelopePath, "utf8"));
if (
  envelope.schema_version !== 1
  || envelope.key_algorithm !== "RSA-3072+-OAEP-SHA256"
  || envelope.content_algorithm !== "AES-256-GCM"
) {
  throw new Error("unsupported confidential envelope contract");
}

const privateKey = createPrivateKey(readFileSync(privateKeyPath));
if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
  throw new Error("recipient must be an RSA private key with at least 3072 bits");
}

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

const expectedHash = Buffer.from(envelope.plaintext_sha256, "hex");
const actualHash = createHash("sha256").update(plaintext).digest();
if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
  throw new Error("confidential envelope plaintext hash mismatch");
}

writeFileSync(outputPath, plaintext, { flag: "wx", mode: 0o600 });
console.log(`Decrypted and SHA-256 verified: ${outputPath}`);
