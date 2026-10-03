import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/pr-check.yml", import.meta.url), "utf8");
const step = workflow.match(/      - name: Plugin-Deploy-Snapshot und Fehlergrenzen prüfen\n([\s\S]*?)(?=\n      (?:#|- name:))/)?.[0];
assert.ok(step, "real plugin-deploy step must exist");
const commands = step.match(/^        run: (.+)$/m)?.[1];
assert.ok(commands, "real confidential command must exist");

for (const [name, exists, code] of [["current pass", true, 0], ["current failure", true, 17]]) test(`${name}: real workflow step routes the strict fixture command confidentially`, t => {
  const root = mkdtempSync(join(tmpdir(), "scai-plugin-deploy-step-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["src/scripts/plugins", "gate/scripts", "bin", "tmp"]) mkdirSync(join(root, path), { recursive: true });
  copyFileSync(new URL("./run-confidential.sh", import.meta.url), join(root, "gate/scripts/run-confidential.sh"));
  if (exists) writeFileSync(join(root, "src/scripts/plugins/deploy.test.mjs"), "fixture");
  const log = join(root, "calls.txt");
  writeFileSync(join(root, "bin/npm"), `#!/bin/bash\nprintf '%s\\n' "$*" > "$PROOF_CALL_LOG"\nprintf 'PRIVATE-PLUGIN-TEST-OUTPUT\\n'\nexit ${code}\n`, { mode: 0o755 });
  const result = spawnSync("/bin/bash", ["-c", commands], { cwd: join(root, "src"), encoding: "utf8", timeout: 10000,
    env: { PATH: `${join(root, "bin") }:/usr/bin:/bin`, LANG: "C", GITHUB_WORKSPACE: root, RUNNER_TEMP: join(root, "tmp"), PROOF_CALL_LOG: log } });
  assert.equal(result.status, code, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-PLUGIN-TEST-OUTPUT/);
  if (exists) {
    assert.equal(readFileSync(log, "utf8"), "run test:plugin-deploy\n");
    assert.match(result.stdout, code === 0 ? /PASS plugin-deploy-tests/ : /failed with exit 17/);
  } else assert.equal(result.stdout, "");
});
