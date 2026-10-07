#!/usr/bin/env node
// Geschlossener Sonar-Vertrag: nur Installer, Updater-Payloads und deren Signaturen.
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertMonotonic } from './assert-semver-monotonic.mjs';
import { exactKeys, releaseAssetUrl } from './release-authorization.mjs';

export const REPOSITORY = 'subunit-ai/sonar-releases';
export const TARGETS = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc', 'x86_64-unknown-linux-gnu'];
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) && value.length === 40;
const tag = value => typeof value === 'string' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && !value.endsWith('\n');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const gh = args => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const regular = path => { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || !s.size) throw Error('Leere Datei oder unzulässiger Dateityp'); };

export function validateRequest(sourceSha, releaseTag, diagnosticKey = '') {
  if (!sha(sourceSha) || !tag(releaseTag)) throw Error('Vollständiger SHA und stabiler vX.Y.Z-Tag erforderlich');
  if (diagnosticKey) {
    const key = createPublicKey(Buffer.from(diagnosticKey, 'base64'));
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw Error('Diagnose benötigt RSA mit mindestens 3072 Bit');
  }
  return { source_sha: sourceSha, tag: releaseTag };
}

export function validateSource(config, pins, releaseTag) {
  if (!tag(releaseTag) || config.version !== releaseTag.slice(1) || config.productName !== 'Sonar'
      || config.bundle?.createUpdaterArtifacts !== true) throw Error('Sonar-Version oder Updater-Vertrag abweichend');
  const pubkey = config.plugins?.updater?.pubkey;
  if (typeof pubkey !== 'string' || !Buffer.from(pubkey, 'base64').toString('utf8').startsWith('untrusted comment:')) throw Error('Updater-Public-Key fehlt');
  if (!exactKeys(pins, ['bridge-tauri', 'trace-tauri'])) throw Error('Komponenten-Pins fehlen oder sind unerwartet');
  const result = {};
  for (const [component, prefix] of [['bridge-tauri', 'bridge'], ['trace-tauri', 'trace']]) {
    const pin = pins[component];
    if (!exactKeys(pin, ['tag', 'sha']) || !tag(pin.tag) || !sha(pin.sha)) throw Error('Ungültiger Komponenten-Pin');
    result[`${prefix}_sha`] = pin.sha;
    result[`${prefix}_tag`] = pin.tag;
  }
  return result;
}

export function assertRemoteState(releases, refs, releaseTag) {
  if (!Array.isArray(releases) || !Array.isArray(refs)) throw Error('Ungültige GitHub-Antwort');
  if (releases.some(r => r.tag_name === releaseTag) || refs.some(r => r.ref === `refs/tags/${releaseTag}`)) throw Error('Release oder Tag existiert bereits; unveränderlich');
  // Jede veröffentlichte stabile Version prüfen, auch wenn Latest manuell zurückgesetzt wurde.
  for (const release of releases.filter(r => !r.draft && !r.prerelease)) {
    if (!tag(release.tag_name)) throw Error('Veröffentlichter Tag ist kein stabiler SemVer-Tag');
    assertMonotonic(release.tag_name, releaseTag);
  }
}
function checkRemote(releaseTag) {
  const releases = gh(['--paginate', '--slurp', `repos/${REPOSITORY}/releases?per_page=100`]).flat();
  const refs = gh(['--paginate', '--slurp', `repos/${REPOSITORY}/git/matching-refs/tags/${releaseTag}`]).flat();
  assertRemoteState(releases, refs, releaseTag);
}

export function targetAssets(releaseTag, target) {
  if (!tag(releaseTag) || !TARGETS.includes(target)) throw Error('Unzulässiger Tag oder Target');
  const version = releaseTag.slice(1);
  if (target.endsWith('apple-darwin')) {
    const arch = target.startsWith('aarch64') ? 'aarch64' : 'x64';
    return [`Sonar_${arch}.app.tar.gz`, `Sonar_${arch}.app.tar.gz.sig`, `Sonar_${version}_${arch}.dmg`];
  }
  const name = target.endsWith('windows-msvc')
    ? `Sonar_${version}_${target.startsWith('aarch64') ? 'arm64' : 'x64'}-setup.exe`
    : `Sonar_${version}_amd64.deb`;
  return [name, `${name}.sig`];
}
export const assetNames = releaseTag => [...TARGETS.flatMap(t => targetAssets(releaseTag, t)), 'latest.json'].sort();

export function verifyFrontend(source) {
  const config = json(join(source, 'src-tauri/tauri.conf.json'));
  if (config.build?.frontendDist !== '../dist' || (config.bundle?.resources && Object.keys(config.bundle.resources).length)) {
    throw Error('Ungeprüfter Frontend- oder Ressourcenpfad');
  }
  const visit = directory => {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Ungültiges Frontend-Verzeichnis');
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), entry = lstatSync(path);
      if (entry.isSymbolicLink()) throw Error('Frontend-Symlink');
      if (entry.isDirectory()) visit(path);
      else {
        if (!entry.isFile() || /\.(?:map|[cm]?tsx?|jsx|rs|log)$/i.test(name)) throw Error('Quelltext oder Diagnose im Frontend');
        if (/\.(?:[cm]?js|css|html)$/i.test(name) && /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/.test(readFileSync(path, 'utf8'))) {
          throw Error('Frontend enthält Sourcemap-Verweis');
        }
      }
    }
  };
  visit(join(source, 'dist'));
  regular(join(source, 'dist/index.html'));
}

export function assertTargetInventory(directory, releaseTag, target) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Ungültiges Installer-Verzeichnis');
  const expected = targetAssets(releaseTag, target).sort();
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected)) throw Error('Unerlaubtes Target-Inventar');
  for (const name of expected) regular(join(directory, name));
  return expected.map(name => join(resolve(directory), name));
}

// Never trust a filename/glob to prove that a diagnostic was encrypted. Seal
// every matching byte again; plaintext or forged inner envelopes stay private.
function sealDiagnostics(root, key, output) {
  validateRequest('a'.repeat(40), 'v0.0.0', key);
  if (!key) throw Error('Diagnose-Empfänger fehlt');
  const files = [], maxBytes = 64 * 1024 * 1024;
  let bytes = 0;
  for (const name of readdirSync(root).sort().filter(n => /^sonar-diagnostic(?:-[A-Za-z0-9._-]+)?\.json$/.test(n))) {
    const path = join(root, name);
    regular(path);
    bytes += lstatSync(path).size;
    if (bytes > maxBytes) throw Error('Diagnose zu groß');
    files.push({ name, data_base64: readFileSync(path).toString('base64') });
  }
  if (!files.length) return;
  const sealed = mkdtempSync(join(root, 'sonar-sealed-diagnostic.'));
  const payload = join(sealed, 'payload'), envelope = join(sealed, 'envelope.json');
  try {
    writeFileSync(payload, JSON.stringify({ schema_version: 1, files }), { flag: 'wx', mode: 0o600 });
    execFileSync(process.execPath, [join(fileURLToPath(new URL('.', import.meta.url)), 'encrypt-confidential-log.mjs'), payload, envelope, key], { stdio: 'pipe' });
    appendFileSync(output, `path=${envelope}\n`);
  } finally {
    try { unlinkSync(payload); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function collect(source, directory, releaseTag, target) {
  // Nur die fertigen Bundle-Dateien lesen; weder target/release noch binaries/ hochladen.
  mkdirSync(directory);
  const bundle = join(source, 'src-tauri', 'target', target, 'release', 'bundle');
  const folder = target.endsWith('apple-darwin') ? 'macos' : target.endsWith('windows-msvc') ? 'nsis' : 'deb';
  for (const name of targetAssets(releaseTag, target)) {
    const original = name.endsWith('.dmg') ? join(bundle, 'dmg', name)
      : join(bundle, folder, name.replace(/^Sonar_(?:aarch64|x64)\.app/, 'Sonar.app'));
    regular(original);
    copyFileSync(original, join(directory, name), /* COPYFILE_EXCL */ 1);
  }
}
export function assertInventory(directory, releaseTag, withManifest = false) {
  const expected = assetNames(releaseTag).filter(n => withManifest || n !== 'latest.json');
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Installer-Inventar ist unvollständig oder enthält unerlaubte Dateien');
  for (const name of actual) regular(join(directory, name));
}

export function createManifest(directory, releaseTag, verify, now = new Date()) {
  assertInventory(directory, releaseTag);
  const platforms = {};
  for (const target of TARGETS) {
    const name = targetAssets(releaseTag, target)[0];
    const signature = readFileSync(join(directory, `${name}.sig`), 'utf8').trim();
    if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw Error('Ungültige base64-Updater-Signatur');
    verify(join(directory, name), Buffer.from(signature, 'base64'));
    const platform = target.endsWith('apple-darwin') ? 'darwin' : target.endsWith('windows-msvc') ? 'windows' : 'linux';
    const arch = target.startsWith('aarch64') ? 'aarch64' : 'x86_64';
    const suffix = platform === 'darwin' ? 'app' : platform === 'windows' ? 'nsis' : 'deb';
    const entry = { signature, url: releaseAssetUrl(REPOSITORY, releaseTag, name) };
    platforms[`${platform}-${arch}`] = entry;
    platforms[`${platform}-${arch}-${suffix}`] = entry;
  }
  return { version: releaseTag.slice(1), notes: `Sonar ${releaseTag} — macOS, Windows, Linux`, pub_date: now.toISOString(), platforms };
}

function prepare(source, directory, releaseTag) {
  const config = json(join(source, 'src-tauri/tauri.conf.json'));
  validateSource(config, json(join(source, 'component-pins.json')), releaseTag);
  const pub = join(process.env.RUNNER_TEMP, 'sonar-updater.pub');
  const sig = join(process.env.RUNNER_TEMP, 'sonar-updater.minisig');
  writeFileSync(pub, Buffer.from(config.plugins.updater.pubkey, 'base64'), { flag: 'wx' });
  const manifest = createManifest(directory, releaseTag, (payload, signature) => {
    writeFileSync(sig, signature);
    execFileSync(process.env.MINISIGN_BIN, ['-Vm', payload, '-x', sig, '-p', pub], { stdio: 'pipe' });
  });
  writeFileSync(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

function publish(directory, releaseTag) {
  assertInventory(directory, releaseTag, true);
  checkRemote(releaseTag);
  const names = assetNames(releaseTag);
  const body = `Sonar ${releaseTag} — macOS, Windows, Linux`;
  // POST-Antwort bindet diesen Lauf an seinen eigenen Draft; kein Resume fremder Drafts.
  const draft = gh(['-X', 'POST', `repos/${REPOSITORY}/releases`, '-f', `tag_name=${releaseTag}`, '-f', `name=Sonar ${releaseTag}`, '-f', `body=${body}`, '-F', 'draft=true']);
  if (!Number.isSafeInteger(draft.id) || draft.draft !== true || draft.tag_name !== releaseTag) throw Error('Ungültige Draft-Antwort');
  execFileSync('gh', ['release', 'upload', releaseTag, '-R', REPOSITORY, ...names.map(n => join(directory, n))], { stdio: 'pipe' });
  const uploaded = gh(['--paginate', '--slurp', `repos/${REPOSITORY}/releases/${draft.id}/assets?per_page=100`]).flat();
  if (JSON.stringify(uploaded.map(a => a.name).sort()) !== JSON.stringify(names)) throw Error('Remote-Inventar abweichend');
  for (const asset of uploaded) {
    const path = join(directory, asset.name);
    if (asset.state !== 'uploaded' || asset.size !== lstatSync(path).size || asset.digest !== `sha256:${digest(path)}`) throw Error('Remote-Asset-Digest abweichend');
  }
  const state = gh([`repos/${REPOSITORY}/releases/${draft.id}`]);
  if (!state.draft || state.tag_name !== releaseTag) throw Error('Draft wurde verändert');
  const releases = gh(['--paginate', '--slurp', `repos/${REPOSITORY}/releases?per_page=100`]).flat();
  assertRemoteState(releases.filter(r => r.id !== draft.id), [], releaseTag);
  const released = gh(['-X', 'PATCH', `repos/${REPOSITORY}/releases/${draft.id}`, '-F', 'draft=false', '-f', 'make_latest=true']);
  if (released.draft || released.tag_name !== releaseTag || gh([`repos/${REPOSITORY}/releases/latest`]).id !== draft.id) throw Error('Veröffentlichung/Latest nicht bestätigt');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    const releaseTag = process.env.TAG;
    if (mode === 'request') {
      const output = validateRequest(process.env.SOURCE_SHA, releaseTag, process.env.DIAGNOSTIC_KEY);
      appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([k, v]) => `${k}=${v}\n`).join(''));
    } else if (mode === 'source') {
      const pins = validateSource(json(join(args[0], 'src-tauri/tauri.conf.json')), json(join(args[0], 'component-pins.json')), releaseTag);
      appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(pins).map(([k, v]) => `${k}=${v}\n`).join(''));
    } else if (mode === 'check-remote') checkRemote(releaseTag);
    else if (mode === 'collect') collect(args[0], args[1], releaseTag, args[2]);
    else if (mode === 'frontend-proof') verifyFrontend(args[0]);
    else if (mode === 'delivery') {
      const paths = assertTargetInventory(args[0], releaseTag, args[1]);
      appendFileSync(process.env.GITHUB_OUTPUT, `paths<<SONAR_INSTALLER_PATHS\n${paths.join('\n')}\nSONAR_INSTALLER_PATHS\n`);
    }
    else if (mode === 'seal-diagnostics') sealDiagnostics(process.env.RUNNER_TEMP, process.env.SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64, process.env.GITHUB_OUTPUT);
    else if (mode === 'prepare') prepare(args[0], args[1], releaseTag);
    else if (mode === 'publish') publish(args[0], releaseTag);
    else throw Error('Unbekannter Sonar-Modus');
  } catch {
    // Daten/Exceptions können private Dateipfade oder GitHub-Antworten enthalten.
    console.error('Sonar-Vertrag fehlgeschlagen; Details ausschließlich in vertraulicher Diagnose.');
    process.exit(1);
  }
}
