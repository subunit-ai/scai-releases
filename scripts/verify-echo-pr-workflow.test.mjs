import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = new URL("./verify-echo-pr-workflow.mjs", import.meta.url);
const workflowUrl = new URL("../.github/workflows/echo-pr-check.yml", import.meta.url);

test("Echo PR workflow passes its confidentiality contract", () => {
  const result = spawnSync(process.execPath, [verifier.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Echo PR workflow contains no mutable action tags or public artifacts", () => {
  const workflow = readFileSync(workflowUrl, "utf8");
  assert.doesNotMatch(workflow, /uses:\s+[^\s@]+@(?![0-9a-f]{40}(?:\s|$))/u);
  assert.doesNotMatch(workflow, /uses:\s+actions\/upload-artifact@|\bgh\s+release\b/u);
});
