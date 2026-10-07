import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { TARGETS } from './sonar-release.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function harness(t) {
  const root = mkdtempSync(join(tmpdir(), 'sonar-build-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), workspace = join(root, 'workspace'), source = join(workspace, 'private/sonar-tauri'), runner = join(root, 'runner');
  for (const path of [bin, join(source, 'scripts'), join(source, 'src-tauri/binaries'), join(workspace, 'private/bridge-tauri'), join(workspace, 'private/trace-tauri'), runner]) mkdirSync(path, { recursive: true });
  const log = join(root, 'calls.jsonl');
  for (const tool of ['bun', 'cargo', 'rustup', 'pwsh', 'codesign']) {
    const file = join(bin, tool);
    writeFileSync(file, `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');const args=process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify({tool:path.basename(process.argv[1]),args,cwd:process.cwd()})+'\\n');
if(args[0]==='build'&&args.includes('--compile')) fs.writeFileSync(args[args.indexOf('--outfile')+1],'compiled fixture');
if(path.basename(process.argv[1])==='cargo') {const target=args[args.indexOf('--target')+1]; const out=path.join(process.cwd(),'forge-control/target',target,'release');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'forge-control'+(target.includes('windows')?'.exe':'')),'native fixture');}
if(path.basename(process.argv[1])==='codesign'&&args.includes('-dv')) process.stderr.write('Authority='+process.env.APPLE_SIGNING_IDENTITY+'\\n');
`);
    chmodSync(file, 0o755);
  }
  const run = (mode, target, env = {}) => spawnSync('bash', [join(ROOT, 'scripts/sonar-build.sh'), mode, target], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runner, MOCK_LOG: log, TAURI_SIGNING_PRIVATE_KEY: '', ...env } });
  return { source, workspace, run, calls: () => readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s)) };
}
for (const target of TARGETS) test(`Lokaler Sidecar-Bau ${target}: Hash-Manifest und native Forge-Datei`, t => {
  const h = harness(t);
  const result = h.run('bridge', target); assert.equal(result.status, 0, result.stderr);
  const ext = target.includes('windows') ? '.exe' : '', name = `subunit-bridge-${target}${ext}`;
  const bytes = readFileSync(join(h.source, 'src-tauri/binaries', name));
  assert.equal(readFileSync(join(h.source, 'scripts/sidecar-sha256.txt'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  const expected = target.includes('windows') ? 'bun-windows-x64' : target.startsWith('aarch64') ? 'bun-darwin-arm64' : target.includes('apple') ? 'bun-darwin-x64' : 'bun-linux-x64';
  assert.ok(h.calls()[1].args.includes(`--target=${expected}`));
  assert.deepEqual(h.calls()[0].args, ['install', '--frozen-lockfile']);
  assert.equal(h.run('forge', target).status, 0);
  assert.equal(readFileSync(join(h.source, 'src-tauri/binaries', `forge-control-${target}${ext}`), 'utf8'), 'native fixture');
  const forge = h.calls().at(-1); assert.equal(forge.tool, 'cargo'); assert.ok(forge.args.includes('--locked'));
});
test('Trace bleibt eine lokale Pfadabhängigkeit; kein Quellenartefakt', t => {
  const h = harness(t);
  writeFileSync(join(h.workspace, 'private/trace-tauri/Cargo.toml'), '[package]\nname="trace-engine"');
  assert.equal(h.run('layout', '').status, 0);
  assert.equal(readFileSync(join(h.source, 'trace-src/Cargo.toml'), 'utf8'), '[package]\nname="trace-engine"');
});
for (const target of TARGETS) test(`Tauri ${target}: Updater-Key ist Pflicht, Bundle-Ziel stimmt`, t => {
  const h = harness(t);
  assert.notEqual(h.run('tauri', target).status, 0);
  if (target.includes('apple')) assert.notEqual(h.run('tauri', target, { TAURI_SIGNING_PRIVATE_KEY: 'fixture' }).status, 0);
  assert.equal(h.run('tauri', target, { TAURI_SIGNING_PRIVATE_KEY: 'fixture', APPLE_SIGNING_IDENTITY: 'Subunit Echo Signing' }).status, 0);
  const tauri = h.calls().find(c => c.tool === 'bun');
  assert.deepEqual(tauri.args, ['run', 'tauri', 'build', '--target', target, '--bundles', target.includes('apple') ? 'app,dmg' : target.includes('windows') ? 'nsis' : 'deb']);
});
