#!/usr/bin/env node

const SEMVER = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(tag) {
  const match = SEMVER.exec(tag);
  if (!match) throw new Error(`Ungültiger SemVer-Tag: ${tag}`);

  const prerelease = match[4]?.split(".") ?? [];
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw new Error(`Ungültiger numerischer Prerelease-Bezeichner in ${tag}: ${identifier}`);
    }
  }

  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease,
  };
}

export function compareVersions(leftTag, rightTag) {
  const left = parseVersion(leftTag);
  const right = parseVersion(rightTag);

  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] < right.core[index]) return -1;
    if (left.core[index] > right.core[index]) return 1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }

  return 0;
}

export function assertMonotonic(latestTag, candidateTag) {
  if (compareVersions(candidateTag, latestTag) <= 0) {
    throw new Error(`Release ${candidateTag} muss strikt neuer als GitHub Latest ${latestTag} sein`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [latestTag, candidateTag] = process.argv.slice(2);
  if (!latestTag || !candidateTag) {
    console.error("Usage: node scripts/assert-semver-monotonic.mjs <latest-tag> <candidate-tag>");
    process.exit(2);
  }

  try {
    assertMonotonic(latestTag, candidateTag);
    console.log(`PASS SemVer monoton: ${candidateTag} > ${latestTag}`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  }
}
