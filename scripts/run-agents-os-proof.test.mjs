import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const script = new URL('./run-agents-os-proof.sh', import.meta.url).pathname;
test('trusted runner creates unique real private proof roots and preserves failures', () => {
  const temp = mkdtempSync(join(tmpdir(), 'agents-os-gate-'));
  const bin = join(temp, 'bin'); mkdirSync(bin);
  const node = join(bin, 'node');
  writeFileSync(node, '#!/usr/bin/env bash\nset -eu\nprintf "%s\\n%s\\n" "$SCAI_OS_DURABLE_UI_PROOF_ROOT" "$*"\nexit "${FIXTURE_EXIT:-0}"\n'); chmodSync(node, 0o700);
  const roots = [];
  for (const code of [0, 37]) {
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, FIXTURE_EXIT: String(code) } });
    assert.equal(result.status, code, result.stderr);
    const [root, args] = result.stdout.trim().split('\n'); roots.push(root);
    assert.equal(realpathSync(root), root);
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(root), []);
    assert.equal(args, 'scripts/lib/agent-operations-os-durable-proof.mjs');
  }
  assert.notEqual(roots[0], roots[1]);
});
test('trusted runner fails without runner temp before invoking source', () => {
  const env = { ...process.env }; delete env.RUNNER_TEMP;
  assert.notEqual(spawnSync('bash', [script], { env }).status, 0);
});


test('optional stage executes inside sealed root and propagates both failure combinations', () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'agents-karte-gate-')));
  const bin = join(temp, 'bin'); mkdirSync(bin);
  const node = join(bin, 'node');
  writeFileSync(node, `#!/usr/bin/env bash
set -eu
case "$1" in
  scripts/lib/agent-operations-os-durable-proof.mjs)
    printf 'OS|%s\n' "$SCAI_OS_DURABLE_UI_PROOF_ROOT"
    exit "$OS_EXIT" ;;
  scripts/verify-karte-stage.mjs)
    printf 'STAGE|%s\n' "$SCAI_KARTE_STAGE_PROOF_ROOT"
    mkdir -m 700 "$SCAI_KARTE_STAGE_PROOF_ROOT"
    printf '{}' > "$SCAI_KARTE_STAGE_PROOF_ROOT/karte-stage-report.json"
    exit "$STAGE_EXIT" ;;
  */seal-private-proof.mjs)
    printf 'SEAL|%s|%s\\n' "$2" "$4"
    exit 0 ;;
  *) exit 99 ;;
esac
`); chmodSync(node, 0o700);
  for (const [present, osCode, stageCode, expected] of [
    [false, 0, 19, 0], [false, 37, 19, 37],
    [true, 0, 0, 0], [true, 0, 19, 19], [true, 37, 0, 37], [true, 37, 19, 37],
  ]) {
    const fixture = mkdtempSync(join(temp, 'source-')); mkdirSync(join(fixture, 'scripts'));
    if (present) writeFileSync(join(fixture, 'scripts/verify-karte-stage.mjs'), '// fixture marker');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp,
      OS_EXIT: String(osCode), STAGE_EXIT: String(stageCode) };
    env.SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64 = "synthetic-key-handled-only-by-mock";
    delete env.GITHUB_OUTPUT;
    const result = spawnSync('bash', [script], { cwd: fixture, env, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr);
    const lines = result.stdout.trim().split('\n');
    const proof = lines[0].slice(3);
    assert.equal(realpathSync(proof), proof); assert.equal(statSync(proof).mode & 0o777, 0o700);
    assert.equal(lines.length, present ? 3 : 2);
    assert.equal(lines.at(-1), `SEAL|${proof}|${expected}`);
    if (present) {
      assert.equal(lines[1], `STAGE|${proof}/karte-stage`);
      assert.equal(statSync(join(proof, 'karte-stage')).mode & 0o777, 0o700);
      assert.deepEqual(readdirSync(join(proof, 'karte-stage')), ['karte-stage-report.json']);
    }
  }
});
