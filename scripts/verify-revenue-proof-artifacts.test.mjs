import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { verifyRevenueProofArtifacts } from "./verify-revenue-proof-artifacts.mjs";

const REQUIRED = {
  billing: [
    ["billing-desktop-light.png", 1440, 1000],
    ["billing-desktop-dark.png", 1440, 1000],
    ["billing-mobile-light.png", 390, 844],
    ["billing-mobile-dark.png", 390, 844],
  ],
  offers: [
    ["offers-desktop-light.png", 1360, 900],
    ["offers-desktop-dark.png", 1360, 900],
    ["offers-mobile-light.png", 390, 844],
    ["offers-mobile-dark.png", 390, 844],
  ],
};

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, crcInput, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width, height, extraChunks = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...extraChunks,
    chunk("IDAT", Buffer.from([0])),
    chunk("IEND"),
  ]);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scai-revenue-proof-"));
  const billing = join(root, "billing");
  const offers = join(root, "offers");
  const artifact = join(root, "artifact");
  mkdirSync(billing);
  mkdirSync(offers);
  for (const [name, width, height] of REQUIRED.billing) writeFileSync(join(billing, name), png(width, height));
  for (const [name, width, height] of REQUIRED.offers) writeFileSync(join(offers, name), png(width, height));
  return { root, billing, offers, artifact };
}

test("stages the eight required fixture screenshots and two optional billing screenshots", () => {
  const paths = fixture();
  writeFileSync(join(paths.billing, "billing-offer-converted-issue.png"), png(1440, 1300));
  writeFileSync(join(paths.billing, "billing-project-free-mobile.png"), png(390, 1200));

  const staged = verifyRevenueProofArtifacts(paths.billing, paths.offers, paths.artifact);
  assert.equal(staged.length, 10);
  assert.deepEqual(readdirSync(paths.artifact).sort(), staged);
});

test("accepts the canonical eight screenshots without optional form evidence", () => {
  const paths = fixture();
  assert.equal(verifyRevenueProofArtifacts(paths.billing, paths.offers, paths.artifact).length, 8);
});

test("rejects missing and arbitrary extra artifacts", () => {
  const missing = fixture();
  const first = REQUIRED.billing[0][0];
  renameSync(join(missing.billing, first), join(missing.root, first));
  assert.throws(
    () => verifyRevenueProofArtifacts(missing.billing, missing.offers, missing.artifact),
    /is missing/,
  );

  const extra = fixture();
  writeFileSync(join(extra.offers, "private-browser.log"), "private output");
  assert.throws(
    () => verifyRevenueProofArtifacts(extra.billing, extra.offers, extra.artifact),
    /non-allowlisted artifact/,
  );
});

test("rejects symlinked proof files and directories", () => {
  const fileLink = fixture();
  symlinkSync(join(fileLink.billing, REQUIRED.billing[0][0]), join(fileLink.billing, "billing-offer-converted-issue.png"));
  assert.throws(
    () => verifyRevenueProofArtifacts(fileLink.billing, fileLink.offers, fileLink.artifact),
    /regular file/,
  );

  const directoryLink = fixture();
  const linkedBilling = join(directoryLink.root, "linked-billing");
  symlinkSync(directoryLink.billing, linkedBilling);
  assert.throws(
    () => verifyRevenueProofArtifacts(linkedBilling, directoryLink.offers, directoryLink.artifact),
    /real directory/,
  );
});

test("rejects textual and EXIF PNG metadata", () => {
  for (const type of ["tEXt", "zTXt", "iTXt", "eXIf"]) {
    const paths = fixture();
    writeFileSync(
      join(paths.billing, REQUIRED.billing[0][0]),
      png(1440, 1000, [chunk(type, Buffer.from("private detail"))]),
    );
    assert.throws(
      () => verifyRevenueProofArtifacts(paths.billing, paths.offers, paths.artifact),
      /metadata is forbidden/,
    );
  }
});

test("rejects a PNG with a corrupted chunk checksum", () => {
  const paths = fixture();
  const corrupt = png(1440, 1000);
  corrupt[32] ^= 0xff;
  writeFileSync(join(paths.billing, REQUIRED.billing[0][0]), corrupt);
  assert.throws(
    () => verifyRevenueProofArtifacts(paths.billing, paths.offers, paths.artifact),
    /checksum is invalid/,
  );
});

test("requires exact viewport width and a bounded full-page height", () => {
  const wrongWidth = fixture();
  writeFileSync(join(wrongWidth.offers, REQUIRED.offers[0][0]), png(1440, 900));
  assert.throws(
    () => verifyRevenueProofArtifacts(wrongWidth.billing, wrongWidth.offers, wrongWidth.artifact),
    /dimensions are invalid/,
  );

  const tooShort = fixture();
  writeFileSync(join(tooShort.billing, REQUIRED.billing[2][0]), png(390, 599));
  assert.throws(
    () => verifyRevenueProofArtifacts(tooShort.billing, tooShort.offers, tooShort.artifact),
    /dimensions are invalid/,
  );

  const tooTall = fixture();
  writeFileSync(join(tooTall.billing, REQUIRED.billing[0][0]), png(1440, 30_001));
  assert.throws(
    () => verifyRevenueProofArtifacts(tooTall.billing, tooTall.offers, tooTall.artifact),
    /dimensions are invalid/,
  );
});

test("refuses a pre-existing artifact directory", () => {
  const paths = fixture();
  mkdirSync(paths.artifact);
  assert.throws(
    () => verifyRevenueProofArtifacts(paths.billing, paths.offers, paths.artifact),
    /must not already exist/,
  );
});
