import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "validate-private-source-ref.sh");

function validate(...args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

test("accepts only supported immutable or operator-controlled source ref forms", () => {
  for (const ref of [
    "main",
    "session/revenue-browser-proof-20260908",
    "session/parent/child.v2",
    "refs/tags/revenue-v0.16.0",
    "v0.16.0",
    "v0.16.0-rc.1",
    "0123456789abcdef0123456789abcdef01234567",
  ]) {
    const result = validate(ref);
    assert.equal(result.status, 0, `${ref}: ${result.stderr}`);
    assert.equal(result.stdout, "");
  }
});

test("rejects option injection, revision expressions, shell metacharacters and arbitrary branches", () => {
  for (const ref of [
    "--upload-pack=touch /tmp/pwned",
    "session/proof~1",
    "session/proof^{}",
    "session/proof..main",
    "refs/tags/v0.16.0^{}",
    "feature/unreviewed",
    "main:refs/heads/pwned",
    "session/proof;echo-pwned",
    "session/proof $(echo pwned)",
    "session/proof\nmalicious",
    "",
  ]) {
    const result = validate(ref);
    assert.equal(result.status, 2, ref);
    assert.equal(result.stdout, "");
    if (ref) assert.doesNotMatch(result.stderr, new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("rejects missing and additional arguments", () => {
  assert.equal(validate().status, 2);
  assert.equal(validate("main", "--upload-pack=evil").status, 2);
});
