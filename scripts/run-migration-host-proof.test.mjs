import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const script = new URL('./run-migration-host-proof.sh', import.meta.url).pathname;
test('trusted runner creates unique real private proof roots and preserves failures', () => {
  const temp = mkdtempSync(join(tmpdir(), 'migration-host-gate-'));
  const bin = join(temp, 'bin'); mkdirSync(bin);
  const node = join(bin, 'node');
  writeFileSync(node, '#!/usr/bin/env bash\nset -eu\nprintf "%s\\n%s\\n" "$SCAI_MIGRATION_HOST_PROOF_ROOT" "$*"\nexit "${FIXTURE_EXIT:-0}"\n'); chmodSync(node, 0o700);
  const roots = [];
  for (const code of [0, 37]) {
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, FIXTURE_EXIT: String(code) } });
    assert.equal(result.status, code, result.stderr);
    const [root, args] = result.stdout.trim().split('\n'); roots.push(root);
    assert.equal(realpathSync(root), root);
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(root), []);
    assert.equal(args, 'scripts/verify-migration-host.mjs');
  }
  assert.notEqual(roots[0], roots[1]);
});
test('trusted runner fails without runner temp before invoking source', () => {
  const env = { ...process.env }; delete env.RUNNER_TEMP;
  assert.notEqual(spawnSync('bash', [script], { env }).status, 0);
});
