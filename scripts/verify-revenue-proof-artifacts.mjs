#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FORBIDDEN_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_SCREENSHOT_HEIGHT = 30_000;

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

const BILLING_SCREENSHOTS = new Map([
  ["billing-desktop-light.png", { width: 1440, minHeight: 600 }],
  ["billing-desktop-dark.png", { width: 1440, minHeight: 600 }],
  ["billing-mobile-light.png", { width: 390, minHeight: 600 }],
  ["billing-mobile-dark.png", { width: 390, minHeight: 600 }],
]);

const OPTIONAL_BILLING_SCREENSHOTS = new Map([
  ["billing-offer-converted-issue.png", { width: 1440, minHeight: 600 }],
  ["billing-project-free-mobile.png", { width: 390, minHeight: 600 }],
]);

const OFFERS_SCREENSHOTS = new Map([
  ["offers-desktop-light.png", { width: 1360, minHeight: 600 }],
  ["offers-desktop-dark.png", { width: 1360, minHeight: 600 }],
  ["offers-mobile-light.png", { width: 390, minHeight: 600 }],
  ["offers-mobile-dark.png", { width: 390, minHeight: 600 }],
]);

function assertPlainDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("proof artifact must be a regular file");
  }
  if (stat.size < 45 || stat.size > MAX_SCREENSHOT_BYTES) {
    throw new Error("proof artifact has an invalid size");
  }

  const bytes = readFileSync(path);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("proof artifact is not a PNG");
  }

  let offset = PNG_SIGNATURE.length;
  let width;
  let height;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG chunk is truncated");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("PNG chunk exceeds the file boundary");
    const storedCrc = bytes.readUInt32BE(offset + 8 + length);
    const calculatedCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== calculatedCrc) throw new Error("PNG chunk checksum is invalid");
    if (FORBIDDEN_METADATA_CHUNKS.has(type)) {
      throw new Error("PNG textual or EXIF metadata is forbidden");
    }
    if (type === "IHDR") {
      if (offset !== PNG_SIGNATURE.length || length !== 13 || width !== undefined) {
        throw new Error("PNG must contain one leading IHDR chunk");
      }
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
    } else if (type === "IDAT") {
      sawIdat = true;
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) throw new Error("PNG IEND must terminate the file");
      sawIend = true;
    }
    offset = end;
  }

  if (width === undefined || height === undefined || !sawIdat || !sawIend) {
    throw new Error("PNG is missing required image chunks");
  }
  return { width, height };
}

function validateDirectory(path, required, optional = new Map()) {
  assertPlainDirectory(path, "proof input");
  const allowed = new Map([...required, ...optional]);
  const entries = readdirSync(path, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));

  for (const name of required.keys()) {
    if (!names.has(name)) throw new Error(`required fixture screenshot is missing: ${name}`);
  }
  for (const entry of entries) {
    if (!allowed.has(entry.name)) throw new Error("proof directory contains a non-allowlisted artifact");
    if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error("proof artifact must be a regular file");

    const dimensions = parsePng(resolve(path, entry.name));
    const expected = allowed.get(entry.name);
    if (
      dimensions.width !== expected.width
      || dimensions.height < expected.minHeight
      || dimensions.height > MAX_SCREENSHOT_HEIGHT
    ) {
      throw new Error(`fixture screenshot dimensions are invalid: ${entry.name}`);
    }
  }

  return [...names].sort();
}

export function verifyRevenueProofArtifacts(billingDir, offersDir, artifactDir) {
  const billing = resolve(billingDir);
  const offers = resolve(offersDir);
  const destination = resolve(artifactDir);
  if (billing === offers || billing === destination || offers === destination) {
    throw new Error("proof input and artifact directories must be distinct");
  }

  const billingNames = validateDirectory(billing, BILLING_SCREENSHOTS, OPTIONAL_BILLING_SCREENSHOTS);
  const offersNames = validateDirectory(offers, OFFERS_SCREENSHOTS);

  try {
    lstatSync(destination);
    throw new Error("artifact directory must not already exist");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  mkdirSync(destination, { mode: 0o700 });

  for (const [source, names] of [[billing, billingNames], [offers, offersNames]]) {
    for (const name of names) {
      if (basename(name) !== name) throw new Error("artifact filename must be a basename");
      const target = resolve(destination, name);
      copyFileSync(resolve(source, name), target);
      chmodSync(target, 0o600);
    }
  }

  const stagedNames = readdirSync(destination).sort();
  const expectedNames = [...billingNames, ...offersNames].sort();
  if (stagedNames.length !== expectedNames.length || stagedNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error("staged proof artifact set changed unexpectedly");
  }
  return stagedNames;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) {
    console.error("usage: verify-revenue-proof-artifacts.mjs <billing-dir> <offers-dir> <artifact-dir>");
    process.exit(2);
  }
  const staged = verifyRevenueProofArtifacts(process.argv[2], process.argv[3], process.argv[4]);
  console.log(`PASS revenue browser proof :: ${staged.length} allowlisted fixture screenshots`);
}
