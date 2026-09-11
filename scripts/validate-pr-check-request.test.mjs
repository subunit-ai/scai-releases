import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./validate-pr-check-request.sh", import.meta.url));
const sha = "a".repeat(40);
const request = "e95aacd2-45ab-4e0b-9cff-bb7c015b1f9c";
for (const ref of ["main", "session/legacy-caller", "v0.156.0", sha]) {
  test(`legacy caller without request_id remains compatible: ${ref}`, () => {
    assert.equal(spawnSync("bash", [script, ref, ""]).status, 0);
  });
}
test("a full SHA and UUIDv4 correlation passes", () => {
  assert.equal(spawnSync("bash", [script, sha, request]).status, 0);
});
for (const [ref, id] of [
  ["main", request], [sha.slice(0, 8), request], [sha.toUpperCase(), request],
  [sha, "same-request"], [sha, request.toUpperCase()], [sha, `${request}\n`],
  [sha, `x; echo unsafe`], [sha, request.replace("4e0b", "1e0b")],
]) {
  test(`invalid correlation is rejected: ${JSON.stringify([ref, id])}`, () => {
    const result = spawnSync("bash", [script, ref, id], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /::error::/);
    assert.doesNotMatch(result.stdout, /unsafe/);
  });
}
