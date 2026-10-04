import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=new URL('./detect-recovered-source-proofs.sh',import.meta.url).pathname;
const rows=[['migration_host','src/components/settings/MigrationSettings.tsx','import { MigrationApp } from "./migration-ui";','scripts/verify-migration-host.mjs'],['native_usage_core','src-tauri/src/lib.rs','mod native_usage;','src-tauri/crates/native-usage-harness/Cargo.toml'],['workforce_coordination','src/plugins/projects/ProjectsRoot.tsx','import { CoordinationDesk } from "./CoordinationDesk";','scripts/verify-workforce-coordination.mjs'],['agents_os','src/plugins/agents/index.tsx','import { OsSurface } from "./os/surface";','scripts/lib/agent-operations-os-durable-proof.mjs'],['email_full_peek','src/lib/workspaceMail.ts','export async function workspaceMailFullPeek(','scripts/verify-email-full-peek.mjs'],['backoffice_capacity','src/lib/operations.ts','listProjectAllocations: async','scripts/verify-backoffice-capacity-list.mjs']];
for(const [key,source,marker,harness] of rows)for(const [feature,proof] of [[false,false],[true,false],[false,true],[true,true]])test(`${key}: source=${feature} proof=${proof}`,()=>{
 const root=mkdtempSync(join(tmpdir(),'recovered-proof-pair-'));
 const put=(path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
 if(feature)put(source,marker);if(proof)put(harness,'// synthetic fixture');
 const result=spawnSync('bash',[script,root],{encoding:'utf8'});
 assert.equal(result.status,feature===proof?0:65,result.stderr);
 if(feature===proof)assert.match(result.stdout,new RegExp(`${key}=${feature}\\n`));
 else assert.match(result.stderr,/source\/proof pair incomplete/);
 // Retain exclusively created fixtures; no user's paths or network are touched.
});
for(const missing of ['none','spotlight','marker','territories','intelligence','signed-update'])test(`Radar mandatory triple: missing ${missing}`,()=>{
 const root=mkdtempSync(join(tmpdir(),'radar-pair-'));const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 if(missing!=='spotlight')put('src/plugins/radar/spotlight.tsx','// synthetic');
 put('src/plugins/radar/explorer.tsx',missing==='marker'?'// no feature':'import { RadarSpotlight } from "./spotlight";');
 for(const [name,omit] of [['territories','territories'],['intelligence','intelligence'],['plugin-update','signed-update']])if(missing!==omit)put(`scripts/verify-radar-${name}.mjs`,'// synthetic');
 const r=spawnSync('bash',[script,root],{encoding:'utf8'});assert.equal(r.status,missing==='none'?0:65,r.stderr);
 if(missing==='none')assert.match(r.stdout,/radar=true/);
});
test('older Radar harnesses alone do not falsely imply Spotlight activation',()=>{
 const root=mkdtempSync(join(tmpdir(),'radar-old-'));mkdirSync(join(root,'scripts'));writeFileSync(join(root,'scripts/verify-radar-territories.mjs'),'// historical');
 const r=spawnSync('bash',[script,root],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/radar=false/);
});
