#!/usr/bin/env node
import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath, publicKeyBase64] = process.argv.slice(2);
if (!inputPath || !outputPath || !publicKeyBase64) {
  console.error("usage: encrypt-confidential-log.mjs <input> <output> <public-key-pem-base64>");
  process.exit(64);
}

const publicKey = createPublicKey(Buffer.from(publicKeyBase64, "base64").toString("utf8"));
if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
  throw new Error("diagnostic recipient must be an RSA public key with at least 3072 bits");
}

const plaintext = readFileSync(inputPath);
const contentKey = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const wrappedKey = publicEncrypt({
  key: publicKey,
  padding: constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: "sha256",
}, contentKey);

writeFileSync(outputPath, `${JSON.stringify({
  schema_version: 1,
  key_algorithm: "RSA-3072+-OAEP-SHA256",
  content_algorithm: "AES-256-GCM",
  wrapped_key: wrappedKey.toString("base64"),
  iv: iv.toString("base64"),
  tag: tag.toString("base64"),
  ciphertext: ciphertext.toString("base64"),
  plaintext_sha256: createHash("sha256").update(plaintext).digest("hex"),
})}\n`, { encoding: "utf8", mode: 0o600 });
