import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=new URL('./detect-recovered-source-proofs.sh',import.meta.url).pathname;
const rows=[['email_full_peek','src/lib/workspaceMail.ts','export async function workspaceMailFullPeek(','scripts/verify-email-full-peek.mjs'],['backoffice_capacity','src/lib/operations.ts','listProjectAllocations: async','scripts/verify-backoffice-capacity-list.mjs']];
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
