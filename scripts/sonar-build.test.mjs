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

for (const [name, selfSigned, identityOutput, trustStatus, identityStatus, expected] of [
  ['Apple-issued valid identity', false, 'valid', 99, 0, 0],
  ['self-signed valid identity', true, 'valid', 0, 0, 0],
  ['self-signed trust failure', true, 'valid', 1, 0, 1],
  ['Apple-issued missing identity', false, 'missing', 99, 0, 65],
  ['self-signed missing identity', true, 'missing', 0, 0, 65],
  ['similar identity is not exact', false, 'similar', 99, 0, 65],
  ['invalid identity annotation', false, 'invalid', 99, 0, 65],
  ['identity query failure', false, 'valid', 99, 1, 1],
]) test(`mac-sign: ${name}`, t => {
  const root = mkdtempSync(join(tmpdir(), 'sonar-sign-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), log = join(root, 'security.log');
  mkdirSync(bin);
  const mock = (name, body) => {
    const file = join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    chmodSync(file, 0o755);
  };
  mock('openssl', `
case "$1" in
  rand) echo fixture-password ;;
  x509)
    if [[ "$*" == *-subject* ]]; then echo 'subject=CN=Fixture';
    elif [ "$MOCK_SELF_SIGNED" = true ]; then echo 'issuer=CN=Fixture';
    else echo 'issuer=CN=Apple Development CA'; fi ;;
  *) exit 99 ;;
esac`);
  mock('sudo', 'exec "$@"');
  mock('security', `
printf '%s\\n' "$*" >> "$MOCK_LOG"
case "$1" in
  find-certificate) echo certificate-fixture ;;
  add-trusted-cert) exit "$MOCK_TRUST_STATUS" ;;
  find-identity)
    [ "$*" = "find-identity -v -p codesigning $RUNNER_TEMP/sonar-build.keychain-db" ]
    case "$MOCK_IDENTITY" in
      valid) printf '  1) ABCDEF0123456789 "%s"\\n  1 valid identities found\\n' "$APPLE_SIGNING_IDENTITY" ;;
      missing) echo '  0 valid identities found' ;;
      similar) printf '  1) ABCDEF "%s other"\\n' "$APPLE_SIGNING_IDENTITY" ;;
      invalid) printf '  1) ABCDEF "%s" (CSSMERR_TP_CERT_EXPIRED)\\n' "$APPLE_SIGNING_IDENTITY" ;;
    esac
    exit "$MOCK_IDENTITY_STATUS" ;;
esac`);
  const result = spawnSync('bash', [join(ROOT, 'scripts/sonar-build.sh'), 'mac-sign'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, GITHUB_WORKSPACE: root, APPLE_CERTIFICATE: Buffer.from('fixture').toString('base64'), APPLE_SIGNING_IDENTITY: 'Apple Development: Fixture (TEAM)', MOCK_LOG: log, MOCK_SELF_SIGNED: String(selfSigned), MOCK_TRUST_STATUS: String(trustStatus), MOCK_IDENTITY_STATUS: String(identityStatus), MOCK_IDENTITY: identityOutput },
  });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.equal(calls.includes('add-trusted-cert'), selfSigned);
  assert.equal(calls.includes('find-identity -v -p codesigning'), !(selfSigned && trustStatus));
  if (expected === 65) assert.match(result.stderr, /identity is not valid/);
});
