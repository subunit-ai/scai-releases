import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const script = new URL('./run-native-usage-core-proof.sh', import.meta.url).pathname;
test('trusted runner creates unique real private proof roots and preserves failures', () => {
  const temp = mkdtempSync(join(tmpdir(), 'native-usage-core-gate-'));
  const bin = join(temp, 'bin'); mkdirSync(bin);
  const node = join(bin, 'cargo');
  writeFileSync(node, '#!/usr/bin/env bash\nset -eu\nprintf "%s\\n%s\\n" "$CARGO_TARGET_DIR" "$*"\n[[ "$CARGO_BUILD_JOBS" == 1 ]] || exit 91\nexit "${FIXTURE_EXIT:-0}"\n'); chmodSync(node, 0o700);
  const roots = [];
  for (const code of [0, 37]) {
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, FIXTURE_EXIT: String(code) } });
    assert.equal(result.status, code, result.stderr);
    const [root, args] = result.stdout.trim().split('\n'); roots.push(root);
    assert.equal(realpathSync(root), root);
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(root), []);
    assert.equal(args, 'test --locked --manifest-path src-tauri/crates/native-usage-harness/Cargo.toml -- --test-threads=1');
  }
  assert.notEqual(roots[0], roots[1]);
});
test('trusted runner fails without runner temp before invoking source', () => {
  const env = { ...process.env }; delete env.RUNNER_TEMP;
  assert.notEqual(spawnSync('bash', [script], { env }).status, 0);
});
