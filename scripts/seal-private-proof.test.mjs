import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,chmodSync,symlinkSync,linkSync,truncateSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,privateDecrypt,constants,createDecipheriv,createHash} from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {collectPrivateProof,sealPrivateProof,MAX_BUNDLE_BYTES} from './seal-private-proof.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10]);
function fixture(){const temp=realpathSync(mkdtempSync(join(tmpdir(),'private-visual-test-')));const root=join(temp,'proof');mkdirSync(root,{mode:0o700});return {temp,root};}
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072});
const publicBase64=Buffer.from(publicKey.export({type:'spki',format:'pem'})).toString('base64');
function decrypt(path){const e=JSON.parse(readFileSync(path));const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(e.wrapped_key,'base64'));const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'base64')),d.final()]);assert.equal(createHash('sha256').update(bytes).digest('hex'),e.plaintext_sha256);return JSON.parse(bytes);}
test('only PNG/report/receipt JSON collected, with hashes and empty-bundle support',()=>{
 const {root}=fixture();assert.deepEqual(JSON.parse(collectPrivateProof(root,'agents-os',0)).files,[]);
 mkdirSync(join(root,'screens'));writeFileSync(join(root,'screens','scene.png'),png);writeFileSync(join(root,'browser-receipt.json'),' {"checks":3}');writeFileSync(join(root,'report.json'),'{}');writeFileSync(join(root,'private-source.ts'),'private ignored data');writeFileSync(join(root,'failure-dom.json'),'private ignored data');
 const b=JSON.parse(collectPrivateProof(root,'agents-os',37));assert.equal(b.proof_exit,37);assert.deepEqual(b.files.map(f=>f.path),['browser-receipt.json','report.json','screens/scene.png']);assert.equal(b.files[2].base64,png.toString('base64'));assert.equal(b.files[2].sha256,createHash('sha256').update(png).digest('hex'));
});
for(const kind of ['root-symlink','nested-symlink','ignored-symlink','hardlink','public-root','bad-png','bad-json','oversize'])test(`rejects ${kind} before encryption`,()=>{
 const {root,temp}=fixture();let candidate=root;
 if(kind==='root-symlink'){candidate=join(temp,'alias');symlinkSync(root,candidate);}
 if(kind==='nested-symlink')symlinkSync(temp,join(root,'escape'));
 if(kind==='ignored-symlink')symlinkSync(join(temp,'nonexistent'),join(root,'ignore.txt'));
 if(kind==='hardlink'){writeFileSync(join(temp,'outside.png'),png);linkSync(join(temp,'outside.png'),join(root,'scene.png'));}
 if(kind==='public-root')chmodSync(root,0o755);
 if(kind==='bad-png')writeFileSync(join(root,'scene.png'),'not an image');
 if(kind==='bad-json')writeFileSync(join(root,'receipt.json'),'not JSON');
 if(kind==='oversize'){writeFileSync(join(root,'scene.png'),png);truncateSync(join(root,'scene.png'),MAX_BUNDLE_BYTES+1);}
 assert.throws(()=>collectPrivateProof(candidate,'agents-os',0));
});
test('encrypted-only exact known output decrypts to original visual bytes and cannot overwrite',()=>{
 const {root,temp}=fixture();writeFileSync(join(root,'scene.png'),png);
 const output=sealPrivateProof(root,'agents-os',37,temp,publicBase64);assert.equal(output,join(temp,'scai-agents-os-encrypted-proof.json'));assert.equal(lstatSync(output).mode&0o777,0o600);
 const bundle=decrypt(output);assert.equal(bundle.proof_exit,37);assert.equal(bundle.files[0].base64,png.toString('base64'));assert.throws(()=>sealPrivateProof(root,'agents-os',0,temp,publicBase64));
 const envelope=JSON.parse(readFileSync(output));assert.equal('files' in envelope,false);assert.equal('base64' in envelope,false);
});
test('rejects foreign root, invalid recipient and output symlinks without following them',()=>{
 const a=fixture(),b=fixture();assert.throws(()=>sealPrivateProof(a.root,'agents-os',0,b.temp,publicBase64));
 assert.throws(()=>sealPrivateProof(a.root,'agents-os',0,a.temp,'not-a-public-key'));
 const victim=join(a.temp,'victim');writeFileSync(victim,'untouched');symlinkSync(victim,join(a.temp,'scai-agents-os-encrypted-proof.json'));
 assert.throws(()=>sealPrivateProof(a.root,'agents-os',0,a.temp,publicBase64));assert.equal(readFileSync(victim,'utf8'),'untouched');
});
for(const label of ['agents-os','workforce-coordination'])for(const code of [0,37])test(`${label} wrapper seals on exit ${code} while preserving failure`,()=>{
 const temp=mkdtempSync(join(tmpdir(),'private-wrapper-test-')),bin=join(temp,'bin');mkdirSync(bin);
 const fake=join(bin,'node');
 writeFileSync(fake,`#!/usr/bin/env bash\nif [[ "$1" == *seal-private-proof.mjs ]]; then exec "${process.execPath}" "$@"; fi\nroot="\${SCAI_OS_DURABLE_UI_PROOF_ROOT:-\${SCAI_W3C_COORDINATION_PROOF_ROOT}}"\nprintf '{}' > "$root/browser-receipt.json"\nexit "\${FIXTURE_EXIT}"\n`);chmodSync(fake,0o700);
 const script=new URL(`./run-${label}-proof.sh`,import.meta.url).pathname;const githubOutput=join(temp,'outputs');
 const r=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:temp,FIXTURE_EXIT:String(code),GITHUB_OUTPUT:githubOutput,SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:publicBase64}});
 assert.equal(r.status,code,r.stderr);const bundle=decrypt(join(temp,`scai-${label}-encrypted-proof.json`));assert.equal(bundle.proof_exit,code);assert.equal(bundle.files[0].path,'browser-receipt.json');assert.equal(r.stdout,'');assert.equal(readFileSync(githubOutput,'utf8'),'encrypted_visual_receipt=true\n');
});
for(const code of [0,37])test(`sealing failure cannot hide proof exit ${code}`,()=>{
 const temp=mkdtempSync(join(tmpdir(),'private-seal-failure-')),bin=join(temp,'bin');mkdirSync(bin);const fake=join(bin,'node');
 writeFileSync(fake,'#!/usr/bin/env bash\nif [[ "$1" == *seal-private-proof.mjs ]]; then exit 70; fi\nexit "$FIXTURE_EXIT"\n');chmodSync(fake,0o700);
 const r=spawnSync('bash',[new URL('./run-agents-os-proof.sh',import.meta.url).pathname],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:temp,FIXTURE_EXIT:String(code),SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:'synthetic-invalid'}});assert.equal(r.status,code===0?70:code);
});
test('existing envelope cannot be advertised as this run visual evidence',()=>{
 const temp=mkdtempSync(join(tmpdir(),'private-stale-envelope-')),bin=join(temp,'bin');mkdirSync(bin);const fake=join(bin,'node'),outputs=join(temp,'outputs');
 writeFileSync(join(temp,'scai-agents-os-encrypted-proof.json'),'foreign stale envelope');
 writeFileSync(fake,`#!/usr/bin/env bash\nif [[ "$1" == *seal-private-proof.mjs ]]; then exec "${process.execPath}" "$@"; fi\nexit 0\n`);chmodSync(fake,0o700);
 writeFileSync(outputs,'');const r=spawnSync('bash',[new URL('./run-agents-os-proof.sh',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:temp,GITHUB_OUTPUT:outputs,SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:publicBase64}});
 assert.equal(r.status,70);assert.equal(readFileSync(outputs,'utf8'),'');assert.equal(readFileSync(join(temp,'scai-agents-os-encrypted-proof.json'),'utf8'),'foreign stale envelope');assert.equal(r.stdout,'');assert.equal(r.stderr,'private visual proof sealing failed\n');
});

test('native selection never visits unselected CLI symlinks, binary or logs',()=>{
 const {root,temp}=fixture();writeFileSync(join(root,'receipt.json'),'{"status":"BLOCKED","synthetic":true}');
 writeFileSync(join(root,'claude-pinned-binary'),'synthetic binary ignored');writeFileSync(join(root,'raw.log'),'synthetic log ignored');
 mkdirSync(join(root,'inside'));symlinkSync(join(temp,'nonexistent-secret-canary'),join(root,'inside','private-config-link'));symlinkSync(temp,join(root,'cli-directory-link'));
 const b=JSON.parse(collectPrivateProof(root,'native-cli',1));assert.deepEqual(b.files.map(f=>f.path),['receipt.json']);
 for(const label of ['agents-os','workforce-coordination'])assert.throws(()=>collectPrivateProof(root,label,1));
});
for(const kind of ['selected-symlink','selected-hardlink','selected-directory','root-symlink','public-root','oversize','invalid-json'])test(`native selection rejects ${kind}`,()=>{
 const {root,temp}=fixture();let candidate=root;
 if(kind==='selected-symlink'){writeFileSync(join(temp,'outside-receipt.json'),'{}');symlinkSync(join(temp,'outside-receipt.json'),join(root,'receipt.json'));}
 if(kind==='selected-hardlink'){writeFileSync(join(temp,'outside-receipt.json'),'{}');linkSync(join(temp,'outside-receipt.json'),join(root,'receipt.json'));}
 if(kind==='selected-directory')mkdirSync(join(root,'receipt.json'));
 if(kind==='root-symlink'){candidate=join(temp,'root-alias');symlinkSync(root,candidate);}
 if(kind==='public-root')chmodSync(root,0o755);
 if(kind==='oversize'){writeFileSync(join(root,'receipt.json'),'{}');truncateSync(join(root,'receipt.json'),MAX_BUNDLE_BYTES+1);}
 if(kind==='invalid-json')writeFileSync(join(root,'receipt.json'),'not JSON');
 assert.throws(()=>collectPrivateProof(candidate,'native-cli',1));
});
test('missing native receipt yields empty failed bundle; success remains rejected',()=>{
 const {root,temp}=fixture();assert.deepEqual(JSON.parse(collectPrivateProof(root,'native-cli',1)).files,[]);assert.throws(()=>sealPrivateProof(root,'native-cli',0,temp,publicBase64));
 const output=sealPrivateProof(root,'native-cli',1,temp,publicBase64);assert.deepEqual(decrypt(output).files,[]);
});

test('native receipt changing during its bounded fd read is rejected',()=>{
 const {root}=fixture(),receipt=join(root,'receipt.json');writeFileSync(receipt,'{"status":"BLOCKED"}');
 const read=fs.readSync;let changed=false;
 fs.readSync=(...args)=>{const count=read(...args);if(!changed){changed=true;writeFileSync(receipt,'{"status":"CHANGED","extra":true}');}return count;};
 syncBuiltinESMExports();
 try{assert.throws(()=>collectPrivateProof(root,'native-cli',1),/changed during read/);assert.equal(changed,true);}
 finally{fs.readSync=read;syncBuiltinESMExports();}
});
