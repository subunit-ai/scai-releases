#!/usr/bin/env node
// Trusted collector: only bounded PNG and report/receipt JSON from this run's private root.
import {constants, chmodSync, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, realpathSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
export function collectPrivateProof(root, label, proofExit) {
  const canonical = realpathSync(root), first = lstatSync(root);
  if (resolve(root) !== canonical || !first.isDirectory() || first.isSymbolicLink() || (first.mode & 0o777) !== 0o700 || first.uid !== process.getuid()) throw new Error('invalid private proof root');
  const files = [], directories = []; let encoded = 0, visited = 0;
  function walk(dir, depth) {
    if (depth > 16) throw new Error('proof nesting exceeds limit');
    const initial = lstatSync(dir);
    if (!initial.isDirectory() || initial.isSymbolicLink() || (!realpathSync(dir).startsWith(canonical + '/') && dir !== canonical)) throw new Error('unsafe proof directory');
    directories.push([dir, initial]);
    for (const name of readdirSync(dir).sort()) {
      if (++visited > 4096) throw new Error('proof entries exceed limit');
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('proof symlink rejected');
      if (stat.isDirectory()) { walk(path, depth + 1); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('proof nonregular or hardlinked file rejected');
      const png = name.endsWith('.png'), json = name.endsWith('.json') && /(?:^|[-_.])(report|receipt)(?:[-_.]|$)/.test(name.slice(0,-5));
      if (!png && !json) continue;
      if (files.length >= 512 || stat.size > MAX_BUNDLE_BYTES || encoded + Math.ceil(stat.size / 3) * 4 > MAX_BUNDLE_BYTES) throw new Error('proof bundle exceeds limit');
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try {
        const actual = fstatSync(fd), real = realpathSync(path);
        if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== stat.dev || actual.ino !== stat.ino || actual.size !== stat.size || !real.startsWith(canonical + '/')) throw new Error('proof changed or escaped');
        // Read exactly the prevalidated size: concurrent growth cannot force
        // an unbounded read/allocation before the post-read consistency check.
        bytes = Buffer.alloc(stat.size);
        let offset=0;
        while (offset < bytes.length) {
          const count=readSync(fd,bytes,offset,bytes.length-offset,offset);
          if (count===0) throw new Error('proof truncated during read');
          offset+=count;
        }
        const after = fstatSync(fd);
        if (after.size !== stat.size || after.mtimeMs !== actual.mtimeMs || bytes.length !== stat.size) throw new Error('proof changed during read');
      } finally { closeSync(fd); }
      if (png && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('invalid proof PNG');
      if (json) JSON.parse(bytes.toString('utf8'));
      const data = bytes.toString('base64'); encoded += Buffer.byteLength(data);
      files.push({path:relative(canonical,path),media_type:png?'image/png':'application/json',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:data});
    }
  }
  walk(canonical, 0);
  for (const [dir, initial] of directories) {
    const now = lstatSync(dir);
    if (now.isSymbolicLink() || now.dev !== initial.dev || now.ino !== initial.ino || realpathSync(dir) !== dir) throw new Error('proof directory changed');
  }
  const bundle = Buffer.from(JSON.stringify({schema_version:1,label,proof_exit:proofExit,files}) + '\n');
  if (bundle.length > MAX_BUNDLE_BYTES) throw new Error('proof bundle exceeds limit');
  return bundle;
}
export function sealPrivateProof(root, label, proofExit, runnerTemp, publicKey) {
  if (!['agents-os','workforce-coordination'].includes(label) || !Number.isInteger(proofExit) || proofExit < 0 || proofExit > 255 || !publicKey) throw new Error('invalid proof sealing contract');
  const temp = realpathSync(runnerTemp);
  if (!realpathSync(root).startsWith(temp + '/')) throw new Error('proof root outside runner temp');
  const bundle = collectPrivateProof(root,label,proofExit);
  const stage = mkdtempSync(join(temp,'scai-proof-seal-'));
  // mkdir inherits 0700 from wrapper umask; explicitly secure direct CLI callers too.
  chmodSync(stage,0o700);
  const input=join(stage,'bundle.json'), envelope=join(stage,'envelope.json');
  writeFileSync(input,bundle,{flag:'wx',mode:0o600});
  const encrypted=spawnSync(process.execPath,[fileURLToPath(new URL('./encrypt-confidential-log.mjs',import.meta.url)),input,envelope,publicKey],{stdio:'pipe',maxBuffer:1024*1024,timeout:30000});
  if (encrypted.status !== 0) throw new Error('private proof encryption failed');
  const output=join(temp,`scai-${label}-encrypted-proof.json`);
  // Never replace a prior envelope, follow a symlink, or reuse a foreign output.
  writeFileSync(output,readFileSync(envelope),{flag:'wx',mode:0o600});
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root,label,exit]=process.argv.slice(2);
    sealPrivateProof(root,label,Number(exit),process.env.RUNNER_TEMP,process.env.SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64);
  } catch {
    // No paths, source text, raw errors, JSON contents or public key in public logs.
    console.error('private visual proof sealing failed'); process.exitCode=70;
  }
}
