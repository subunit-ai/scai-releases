import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { REPOSITORY, TARGETS, validateRequest, validateSource, assertRemoteState, targetAssets, assetNames, assertInventory, assertTargetInventory, verifyFrontend, createManifest } from './sonar-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(40), TAG = 'v1.2.3';
const KEY = Buffer.from('untrusted comment: minisign public key\nfixture\n').toString('base64');
const config = { productName: 'Sonar', version: '1.2.3', bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: KEY } } };
const pins = { 'bridge-tauri': { tag: 'v0.4.9', sha: SHA }, 'trace-tauri': { tag: 'v0.1.13', sha: 'b'.repeat(40) } };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sonar-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'assets'); mkdirSync(directory);
  for (const name of assetNames(TAG).filter(n => n !== 'latest.json')) writeFileSync(join(directory, name), name.endsWith('.sig') ? Buffer.from('fixture minisign').toString('base64') : `installer:${name}`);
  return { root, directory };
}
function invoke(mode, args, env) {
  return spawnSync('node', [join(ROOT, 'scripts/sonar-release.mjs'), mode, ...args], { encoding: 'utf8', env: { ...process.env, TAG, ...env } });
}

for (const target of TARGETS) test(`Upload barrier ${target}: exact files, no source/log/symlink extras`, t => {
  const { root } = fixture(t), directory = join(root, 'delivery'); mkdirSync(directory);
  for (const name of targetAssets(TAG, target)) writeFileSync(join(directory, name), 'installer');
  assert.deepEqual(assertTargetInventory(directory, TAG, target).map(path => path.slice(directory.length + 1)).sort(), targetAssets(TAG, target).sort());
  for (const name of ['private.ts', 'debug.map', 'build.log', 'sidecar.exe', '.hidden']) {
    writeFileSync(join(directory, name), 'PRIVATE_CANARY');
    assert.throws(() => assertTargetInventory(directory, TAG, target));
    rmSync(join(directory, name));
  }
  const alias = join(root, 'alias'); symlinkSync(directory, alias);
  assert.throws(() => assertTargetInventory(alias, TAG, target));
  const name = targetAssets(TAG, target)[0]; rmSync(join(directory, name));
  symlinkSync(join(root, 'private-source'), join(directory, name));
  assert.throws(() => assertTargetInventory(directory, TAG, target));
});

for (const bad of ['map', 'inline-map', 'external-map', 'ts', 'nested-rs', 'log', 'symlink', 'dist-symlink', 'resources', 'frontend-path']) test(`Frontend confidentiality rejects ${bad}`, t => {
  const { root } = fixture(t), source = join(root, 'source');
  mkdirSync(join(source, 'src-tauri'), { recursive: true }); mkdirSync(join(source, 'dist'));
  const cfg = { build: { frontendDist: '../dist' } };
  writeFileSync(join(source, 'src-tauri/tauri.conf.json'), JSON.stringify(cfg));
  writeFileSync(join(source, 'dist/index.html'), '<script src="/assets/compiled.js"></script>');
  mkdirSync(join(source, 'dist/assets')); writeFileSync(join(source, 'dist/assets/compiled.js'), 'console.log("compiled")');
  assert.doesNotThrow(() => verifyFrontend(source));
  if (bad === 'map') writeFileSync(join(source, 'dist/assets/compiled.js.map'), '{"sourcesContent":["PRIVATE_CANARY"]}');
  if (bad === 'inline-map' || bad === 'external-map') writeFileSync(join(source, 'dist/assets/compiled.js'), `//# sourceMappingURL=${bad === 'inline-map' ? 'data:application/json;base64,UElWQVRF' : 'https://example.invalid/private.map'}`);
  if (bad === 'ts' || bad === 'nested-rs' || bad === 'log') writeFileSync(join(source, `dist/assets/private.${bad === 'nested-rs' ? 'rs' : bad}`), 'PRIVATE_CANARY');
  if (bad === 'symlink') symlinkSync(join(source, 'src-tauri'), join(source, 'dist/private'));
  if (bad === 'dist-symlink') { rmSync(join(source, 'dist'), { recursive: true }); symlinkSync(join(source, 'src-tauri'), join(source, 'dist')); }
  if (bad === 'resources') cfg.bundle = { resources: ['../src/**'] };
  if (bad === 'frontend-path') cfg.build.frontendDist = '../src';
  writeFileSync(join(source, 'src-tauri/tauri.conf.json'), JSON.stringify(cfg));
  assert.throws(() => verifyFrontend(source));
});

test('diagnostic upload re-encrypts every byte, including plaintext/forged glob matches, and keeps nested failures', t => {
  const { root } = fixture(t), output = join(root, 'output');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const key = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
  const original = ['sonar-diagnostic.json', 'sonar-diagnostic-checkout-sonar-tauri-fetch-1.json', 'sonar-diagnostic-sonar-checkout-2.json'];
  for (const name of original) writeFileSync(join(root, name), 'PRIVATE_CANARY:'+name);
  writeFileSync(join(root, 'unrelated.json'), 'DO_NOT_UPLOAD');
  const result = invoke('seal-diagnostics', [], { RUNNER_TEMP: root, GITHUB_OUTPUT: output, SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64: key });
  assert.equal(result.status, 0, result.stderr);
  const path = readFileSync(output, 'utf8').trim().slice('path='.length);
  const envelope = readFileSync(path, 'utf8');
  assert.doesNotMatch(envelope, /PRIVATE_CANARY|sonar-diagnostic|DO_NOT_UPLOAD/);
  assert.deepEqual(readdirSync(dirname(path)), ['envelope.json']);
  const priv = join(root, 'recipient.pem'), plaintext = join(root, 'decoded');
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  execFileSync(process.execPath, [join(ROOT, 'scripts/decrypt-confidential-envelope.mjs'), path, plaintext, priv]);
  const bundle = JSON.parse(readFileSync(plaintext, 'utf8'));
  assert.deepEqual(bundle.files.map(f => f.name).sort(), original.sort());
  for (const file of bundle.files) assert.equal(Buffer.from(file.data_base64, 'base64').toString(), 'PRIVATE_CANARY:'+file.name);
});

for (const kind of ['missing-key', 'weak-key', 'symlink', 'directory', 'empty', 'oversize']) test(`diagnostic sealing fails closed: ${kind}`, t => {
  const { root } = fixture(t), output = join(root, 'output'), diagnostic = join(root, 'sonar-diagnostic.json');
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: kind === 'weak-key' ? 2048 : 3072 });
  const key = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
  if (kind === 'directory') mkdirSync(diagnostic);
  else if (kind === 'symlink') symlinkSync(join(root, 'assets'), diagnostic);
  else writeFileSync(diagnostic, kind === 'empty' ? '' : kind === 'oversize' ? Buffer.alloc(64 * 1024 * 1024 + 1) : 'PRIVATE_CANARY');
  const result = invoke('seal-diagnostics', [], { RUNNER_TEMP: root, GITHUB_OUTPUT: output, SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64: kind === 'missing-key' ? '' : key });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CANARY/);
  assert.equal(existsSync(output), false);
});

test('Sonar-Auftrag validiert SHA, stabile SemVer und einmaligen RSA-Schlüssel fail-closed', () => {
  assert.deepEqual(validateRequest(SHA, TAG), { source_sha: SHA, tag: TAG });
  for (const source of ['', 'main', '-x', SHA.toUpperCase(), `${SHA}\n`, SHA.slice(1)]) assert.throws(() => validateRequest(source, TAG));
  for (const tag of ['', '1.2.3', 'v01.2.3', 'v1.2.3-beta', 'v1.2.3+meta', `${TAG}\n`, ` ${TAG}`]) assert.throws(() => validateRequest(SHA, tag));
  for (const bits of [2048, 3072]) {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
    const encoded = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
    if (bits === 2048) assert.throws(() => validateRequest(SHA, TAG, encoded));
    else assert.doesNotThrow(() => validateRequest(SHA, TAG, encoded));
  }
  const { publicKey } = generateKeyPairSync('ed25519');
  assert.throws(() => validateRequest(SHA, TAG, Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64')));
  assert.throws(() => validateRequest(SHA, TAG, 'kein-schlüssel'));
});
test('Sonar-Konfiguration und vollständige Komponenten-Pins binden Tag und SHA', () => {
  assert.deepEqual(validateSource(config, pins, TAG), { bridge_sha: SHA, bridge_tag: 'v0.4.9', trace_sha: 'b'.repeat(40), trace_tag: 'v0.1.13' });
  for (const bad of [{}, { ...config, version: '1.2.2' }, { ...config, productName: 'Other' }, { ...config, bundle: {} }, { ...config, plugins: {} }]) assert.throws(() => validateSource(bad, pins, TAG));
  for (const bad of [{}, { ...pins, extra: {} }, { ...pins, 'bridge-tauri': { ...pins['bridge-tauri'], sha: 'main' } }, { ...pins, 'trace-tauri': { tag: '--help', sha: SHA } }, { ...pins, 'trace-tauri': { ...pins['trace-tauri'], branch: 'main' } }]) assert.throws(() => validateSource(config, bad, TAG));
});
test('Remote-Vorflug sperrt Drafts, existierende Tags, gleiche und ältere Versionen', () => {
  assert.doesNotThrow(() => assertRemoteState([], [], TAG));
  assert.doesNotThrow(() => assertRemoteState([{ tag_name: 'v1.2.2', draft: false, prerelease: false }], [], TAG));
  for (const release of [{ tag_name: TAG, draft: true }, { tag_name: TAG, draft: false }, { tag_name: 'v1.3.0', draft: false }, { tag_name: 'unbekannt', draft: false }]) assert.throws(() => assertRemoteState([release], [], TAG));
  assert.throws(() => assertRemoteState([], [{ ref: `refs/tags/${TAG}` }], TAG));
  assert.doesNotThrow(() => assertRemoteState([], [{ ref: `refs/tags/${TAG}0` }], TAG));
  assert.throws(() => assertRemoteState(null, [], TAG));
});
test('Installer-Allowlist hat exakt zwölf Bundle-/Signaturdateien und latest.json', t => {
  const { directory } = fixture(t);
  assert.equal(assetNames(TAG).length, 13);
  assertInventory(directory, TAG);
  assert.throws(() => targetAssets(TAG, 'attacker-target'));
  writeFileSync(join(directory, 'trace-src.tgz'), 'private source');
  assert.throws(() => assertInventory(directory, TAG));
});
for (const kind of ['leer', 'symlink', 'ordner', 'fehlend']) test(`Installer-Inventar sperrt ${kind}`, t => {
  const { root, directory } = fixture(t), path = join(directory, assetNames(TAG)[0]);
  rmSync(path);
  if (kind === 'leer') writeFileSync(path, '');
  if (kind === 'symlink') { writeFileSync(join(root, 'private'), 'source'); symlinkSync(join(root, 'private'), path); }
  if (kind === 'ordner') mkdirSync(path);
  assert.throws(() => assertInventory(directory, TAG));
});
test('Tauri-v2-Manifest besitzt zehn vollständige Aliase, öffentliche URLs und fünf verifizierte Payloads', t => {
  const { directory } = fixture(t), verified = [];
  const manifest = createManifest(directory, TAG, (path, sig) => { verified.push(path); assert.equal(sig.toString(), 'fixture minisign'); }, new Date('2026-10-07T00:00:00Z'));
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.pub_date, '2026-10-07T00:00:00.000Z');
  assert.equal(verified.length, 5);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-aarch64-app', 'darwin-x86_64', 'darwin-x86_64-app', 'linux-x86_64', 'linux-x86_64-deb', 'windows-aarch64', 'windows-aarch64-nsis', 'windows-x86_64', 'windows-x86_64-nsis']);
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    assert.ok(entry.url.startsWith(`https://github.com/${REPOSITORY}/releases/download/${TAG}/Sonar_`));
    assert.equal(entry.signature, Buffer.from('fixture minisign').toString('base64'));
    if (platform.includes('aarch64')) assert.match(entry.url, /(?:aarch64|arm64)/);
    if (platform.startsWith('linux')) assert.match(entry.url, /amd64\.deb$/);
  }
  assert.deepEqual(Object.keys(manifest).sort(), ['notes', 'platforms', 'pub_date', 'version']);
  assert.throws(() => createManifest(directory, TAG, () => { throw Error('Signatur falsch'); }));
  writeFileSync(join(directory, targetAssets(TAG, TARGETS[0])[1]), 'rohes log mit source');
  assert.throws(() => createManifest(directory, TAG, () => assert.fail('Darf nicht verifizieren')));
});
for (const target of TARGETS) test(`Collect ${target} übernimmt nur fertige Bundles`, t => {
  const { root } = fixture(t), source = join(root, 'source'), out = join(root, 'out');
  const bundle = join(source, 'src-tauri/target', target, 'release/bundle');
  for (const name of targetAssets(TAG, target)) {
    const folder = name.endsWith('.dmg') ? 'dmg' : target.endsWith('apple-darwin') ? 'macos' : target.endsWith('windows-msvc') ? 'nsis' : 'deb';
    mkdirSync(join(bundle, folder), { recursive: true });
    writeFileSync(join(bundle, folder, name.replace(/^Sonar_(?:aarch64|x64)\.app/, 'Sonar.app')), `bundle:${name}`);
  }
  mkdirSync(join(source, 'src-tauri/binaries'), { recursive: true });
  writeFileSync(join(source, 'src-tauri/binaries/private-sidecar.exe'), 'private');
  writeFileSync(join(source, 'secret-source.rs'), 'private');
  const result = invoke('collect', [source, out, target], {});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(out).sort(), targetAssets(TAG, target).sort());
  for (const name of readdirSync(out)) assert.equal(readFileSync(join(out, name), 'utf8'), `bundle:${name}`);
  assert.notEqual(invoke('collect', [source, out, target], {}).status, 0, 'Vorhandene Dateien nicht überschreiben');
});

test('Echte Minisign-Prüfung akzeptiert fünf Payloads und sperrt Tampering/falschen Key', t => {
  // Keine Produktionsschlüssel: ausschließlich in diesem Test erzeugte, passwortlose Fixture-Keys.
  const ready = spawnSync('minisign', ['-v'], { encoding: 'utf8' });
  if (ready.error?.code === 'ENOENT') { t.skip('Minisign fehlt lokal; CI nutzt den gepinnten Verifizierer'); return; }
  const { root, directory } = fixture(t), source = join(root, 'source'), pub = join(root, 'test.pub'), sec = join(root, 'test.sec');
  mkdirSync(join(source, 'src-tauri'), { recursive: true });
  execFileSync('minisign', ['-G', '-W', '-p', pub, '-s', sec], { stdio: 'pipe' });
  writeFileSync(join(source, 'component-pins.json'), JSON.stringify(pins));
  const writeConfig = () => writeFileSync(join(source, 'src-tauri/tauri.conf.json'), JSON.stringify({ ...config, plugins: { updater: { pubkey: readFileSync(pub).toString('base64') } } }));
  writeConfig();
  const originalConfig = readFileSync(join(source, 'src-tauri/tauri.conf.json'));
  for (const target of TARGETS) {
    const name = targetAssets(TAG, target)[0], raw = join(root, 'raw.minisig');
    execFileSync('minisign', ['-S', '-s', sec, '-m', join(directory, name), '-x', raw], { stdio: 'pipe' });
    writeFileSync(join(directory, `${name}.sig`), readFileSync(raw).toString('base64'));
  }
  const verifier = execFileSync('which', ['minisign'], { encoding: 'utf8' }).trim();
  const run = () => { const temp = mkdtempSync(join(root, 'verify-')); return invoke('prepare', [source, directory], { RUNNER_TEMP: temp, MINISIGN_BIN: verifier }); };
  assert.equal(run().status, 0);
  assert.equal(JSON.parse(readFileSync(join(directory, 'latest.json'), 'utf8')).platforms['linux-x86_64'].url.endsWith('.deb'), true);
  rmSync(join(directory, 'latest.json'));
  execFileSync('minisign', ['-G', '-W', '-p', pub, '-s', sec, '-f'], { stdio: 'pipe' });
  writeConfig();
  assert.notEqual(run().status, 0, 'Falscher Public Key muss scheitern');
  writeFileSync(join(source, 'src-tauri/tauri.conf.json'), originalConfig);
  writeFileSync(join(directory, targetAssets(TAG, TARGETS[0])[0]), 'tampered');
  assert.notEqual(run().status, 0);
  assert.equal(existsSync(join(directory, 'latest.json')), false);
});

function mockGithub(root, directory, mode) {
  const bin = join(root, 'bin'); mkdirSync(bin);
  const log = join(root, 'gh-calls.jsonl'), mock = join(bin, 'gh');
  writeFileSync(mock, `#!/usr/bin/env node
const fs = require('node:fs'), crypto = require('node:crypto'), path = require('node:path');
const args = process.argv.slice(2); fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args)+'\\n');
const mode = process.env.MOCK_MODE;
let result;
if (args[0] === 'release') {
  if (mode === 'upload-error') process.exit(1);
  process.exit(0);
}
const endpoint = args.find(a => a.startsWith('repos/'));
const assets = fs.readdirSync(process.env.MOCK_DIRECTORY).map(name => ({name, state:'uploaded', size:fs.statSync(path.join(process.env.MOCK_DIRECTORY,name)).size, digest:'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.MOCK_DIRECTORY,name))).digest('hex')}));
if (args.includes('POST')) result={id:123,draft:true,tag_name:process.env.TAG};
else if (args.includes('PATCH')) result={id:123,draft:false,tag_name:process.env.TAG};
else if (endpoint.includes('/assets?')) { if(mode==='bad-digest') assets[0].digest='sha256:wrong'; if(mode==='extra-asset') assets.push({...assets[0], name:'trace-src.tgz'}); result=[assets]; }
else if (endpoint.endsWith('/releases/123')) result={id:123,draft:mode!=='draft-changed',tag_name:process.env.TAG};
else if (endpoint.endsWith('/releases/latest')) result={id:123,draft:false,tag_name:process.env.TAG};
else if (endpoint.includes('/releases?')) result=[[...(mode==='existing-release'?[{id:55,tag_name:process.env.TAG,draft:true}]:mode==='newer-version'?[{tag_name:'v9.0.0',draft:false}]:[])]];
else if (endpoint.includes('/matching-refs/')) result=[mode==='existing-tag'?[{ref:'refs/tags/'+process.env.TAG}]:[]];
else process.exit(99);
if(mode==='network-error') process.exit(1);
process.stdout.write(JSON.stringify(result));
`);
  chmodSync(mock, 0o755);
  return { env: { PATH: `${bin}:${process.env.PATH}`, MOCK_MODE: mode, MOCK_LOG: log, MOCK_DIRECTORY: directory }, calls: () => readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s)) };
}
for (const mode of ['ok', 'existing-release', 'existing-tag', 'newer-version', 'bad-digest', 'extra-asset', 'draft-changed', 'network-error', 'upload-error']) test(`Publish mit GitHub-Fixture: ${mode}`, t => {
  const { root, directory } = fixture(t);
  writeFileSync(join(directory, 'latest.json'), JSON.stringify(createManifest(directory, TAG, () => {})));
  const mock = mockGithub(root, directory, mode);
  const result = invoke('publish', [directory], mock.env), calls = mock.calls();
  assert.equal(result.status, mode === 'ok' ? 0 : 1, result.stderr);
  assert.ok(calls.every(c => !c.includes('--clobber')));
  assert.ok(calls.filter(c => c[0] === 'api').every(c => c.some(a => a.startsWith(`repos/${REPOSITORY}/`))));
  const post = calls.findIndex(c => c.includes('POST')), upload = calls.findIndex(c => c[0] === 'release'), check = calls.findIndex(c => c.some(a => a.includes('/assets?'))), patch = calls.findIndex(c => c.includes('PATCH'));
  if (mode === 'ok') {
    assert.ok(post >= 0 && upload > post && check > upload && patch > check);
    assert.ok(calls[post].includes('draft=true'));
    assert.ok(calls[patch].includes('make_latest=true'));
    assert.equal(calls[upload].filter(a => a.startsWith(directory)).length, 13);
    assert.ok(calls.at(-1).some(a => a.endsWith('/releases/latest')));
  } else {
    assert.equal(patch, -1, 'Keine Freigabe nach Fehler');
    if (['existing-release', 'existing-tag', 'newer-version', 'network-error'].includes(mode)) assert.equal(post, -1);
  }
});
