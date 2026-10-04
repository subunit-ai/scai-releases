import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,symlinkSync,linkSync,chmodSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {copyRegular,stageEvidence,proofCommands,validateRequest,validateRadarBundle,validateStagedProof,runCommand,territorySteps,territoryViews,intelligenceShots,intelligenceStressShots,intelligenceAnchors,signedChecks,signedShots} from './run-radar-proof.mjs';
const fixture=()=>realpathSync(mkdtempSync(join(tmpdir(),'radar-gate-unit-')));
test('locked generated-only verifier and three complete proof invocations are exact',()=>{
 const c=proofCommands('/private/work');
 assert.deepEqual(c[1],['cargo',['install','wasm-bindgen-cli','--version','0.2.126','--locked','--root','/private/work/tools']]);
 assert.deepEqual(c[3],['minisign',['-G','-W','-s','/private/work/fixture.sec','-p','/private/work/fixture.pub']]);
 assert.deepEqual(c.slice(-3),[['node',['scripts/verify-radar-territories.mjs']],['node',['scripts/verify-radar-intelligence.mjs']],['bun',['--no-env-file','scripts/verify-radar-plugin-update.mjs']]]);
 assert.deepEqual(c[4],['node',['/private/work/source/scripts/plugins/build-policy-wasm.mjs','--test']]);
});
test('evidence staging selects regular top-level PNG/report only, never work keys or host symlinks',()=>{
 const root=fixture(),out=join(root,'output/case'),evidence=join(root,'evidence');mkdirSync(out,{recursive:true});
 writeFileSync(join(out,'report.json'),'{}');writeFileSync(join(out,'shot.png'),'synthetic');writeFileSync(join(out,'fixture.sec'),'synthetic not a key');symlinkSync('/not-followed',join(out,'host'));
 stageEvidence(out,evidence,root);assert.deepEqual(readdirSync(evidence),['report.json','shot.png']);
});
for(const mode of ['symlink','hardlink','directory','oversize'])test(`selected evidence rejects ${mode}`,()=>{
 const root=fixture(),out=join(root,'output/case');mkdirSync(out,{recursive:true});const selected=join(out,'report.json'),target=join(root,'target');writeFileSync(target,'{}');
 if(mode==='symlink')symlinkSync(target,selected);if(mode==='hardlink')linkSync(target,selected);if(mode==='directory')mkdirSync(selected);if(mode==='oversize')writeFileSync(selected,Buffer.alloc(8*1024*1024+1));
 assert.throws(()=>stageEvidence(out,join(root,'proof'),root),/invalid Radar fixture source/);
});
test('wrapper private unique roots and first proof failure survive sealing',()=>{
 const root=fixture(),bin=join(root,'bin');mkdirSync(bin);writeFileSync(join(bin,'node'),'#!/usr/bin/env bash\nif [[ "$1" == *run-radar-proof.mjs ]]; then printf "%s\\n%s\\n" "$2" "$3";exit 37;fi\nexit 0\n');chmodSync(join(bin,'node'),0o700);
 const script=new URL('./run-radar-proof.sh',import.meta.url).pathname;
 const r=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,RUNNER_TEMP:root,SCAI_ENCRYPTED_DIAGNOSTIC_PUBLIC_KEY_BASE64:'synthetic-public-not-real'}});
 assert.equal(r.status,37,r.stderr);const roots=r.stdout.trim().split('\n');assert.equal(roots.length,2);assert.notEqual(...roots);
 for(const p of roots){assert.equal(realpathSync(p),p);assert.equal(statSync(p).mode&0o777,0o700);}
});
test('wrapper requires runner temp before source launch',()=>{
 const env={...process.env};delete env.RUNNER_TEMP;assert.notEqual(spawnSync('bash',[new URL('./run-radar-proof.sh',import.meta.url).pathname],{env}).status,0);
});
test('staging refuses a symlinked output ancestor',()=>{
 const work=fixture(),outside=fixture();mkdirSync(join(outside,'case'));writeFileSync(join(outside,'case/report.json'),'{}');symlinkSync(outside,join(work,'output'));
 assert.throws(()=>stageEvidence(join(work,'output/case'),join(work,'proof'),work),/invalid evidence directory/);
});
const source='a'.repeat(40),request='12345678-1234-4234-8234-123456789abc';
for(const [sha,id,head] of [['',request,source],[source,'',source],[source,request,'b'.repeat(40)],[source,'../bad',source]])test('request binds exact source and UUID',()=>assert.throws(()=>validateRequest(sha,id,head)));
function acceptedBundle(){
 const files=[],add=(path,value)=>files.push({path,media_type:'application/json',base64:Buffer.from(JSON.stringify(value)).toString('base64')});
 add('gate-receipt.json',{sourceSha:source,requestId:request,proofExit:0,fullMatricesRequested:true});
 for(const [name,tags,key] of [['territories',['chromium-dark-1440','chromium-dark-390','chromium-dark-588','chromium-light-1440','chromium-light-390','chromium-light-588','webkit-dark-1440'],'cases'],['intelligence',['chromium-dark-1440','chromium-dark-390','chromium-light-1440','chromium-light-390','webkit-dark-1440','webkit-dark-390','webkit-light-1440','webkit-light-390'],'runs']]){
  const screenshots=[],assertions=[];
  for(const tag of tags){
    const names=name==='territories'?territoryViews.flatMap(v=>['kein horizontaler Überlauf','Overlays/Dialoge vollständig im Plugin-Rahmen','reduzierte Bewegung ohne laufende Animationen','Layoutblöcke überlappen nicht'].map(n=>v+': '+n)).concat(['0 Konsolen- und Seitenfehler','keine Fixture-Antwort ≥400 außer angekündigten','keine unerwarteten externen Anfragen','keine Transportfehler']):intelligenceAnchors.concat(Array.from({length:110},(_,i)=>'synthetic extra '+i));
    assertions.push(...names.map(n=>({case:tag,name:n,ok:true})));
    const shots=name==='territories'?[...territoryViews,'import-409']:[...intelligenceShots,...(tag==='chromium-dark-1440'?intelligenceStressShots:[])];
    for(const shot of shots){files.push({path:name+'/'+tag+'-'+shot+'.png',media_type:'image/png'});screenshots.push({run:tag,name:shot});}
  }
  if(name==='intelligence')assertions.push({run:'harness',name:'all nonlocal non-tile requests prevented and none attempted',ok:true});
  add(name+'/report.json',{dodMet:true,failed:0,requestedCases:null,scope:name==='territories'?'volle Matrix':'full-matrix',network:false,git:{head:source.slice(0,8),dirty:[]},passed:assertions.length,assertions,screenshots,[key]:tags.map(tag=>({tag,realTiles:false,consoleErrors:[],pageErrors:[],steps:territorySteps.map(name=>({name,ok:true})),views:Object.fromEntries(territoryViews.map(v=>[v,{}]))}))});
 }
 const state=['filters','sort'].map(suffix=>({key:'scai:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:radar%3A'+suffix,envelope:{version:1,value:suffix==='filters'?{q:'Meridian'}:'name'}}));
 add('signed-update/report.json',{sourceCommit:source,bundleSha256:'b'.repeat(64),hostHtmlSha256:'c'.repeat(64),errors:[],checks:['chromium','webkit'].flatMap(e=>signedChecks.map(n=>({name:e+': '+n,ok:true}))),restoredState:['chromium','webkit'].map(engineName=>({engineName,before:state,after:state}))});
 for(const e of ['chromium','webkit'])for(const n of signedShots)files.push({path:'signed-update/'+e+'-'+n+'.png',media_type:'image/png'});
 return {files};
}
function alter(bundle,path,fn){const row=bundle.files.find(f=>f.path===path),value=JSON.parse(Buffer.from(row.base64,'base64'));fn(value);row.base64=Buffer.from(JSON.stringify(value)).toString('base64');}
test('successful receipt requires complete actual three reports',()=>assert.equal(validateRadarBundle(acceptedBundle(),source,request),true));
for(const [name,change] of [
 ['missing report',b=>b.files=b.files.filter(f=>f.path!=='intelligence/report.json')],
 ['missing PNGs',b=>b.files=b.files.filter(f=>f.media_type!=='image/png')],
 ['wrong source',b=>alter(b,'gate-receipt.json',v=>v.sourceSha='b'.repeat(40))],
 ['wrong request',b=>alter(b,'gate-receipt.json',v=>v.requestId='other')],
 ['filtered cases',b=>alter(b,'territories/report.json',v=>v.requestedCases=['one'])],
 ['duplicate case',b=>alter(b,'territories/report.json',v=>v.cases[1]=v.cases[0])],
 ['empty assertions',b=>alter(b,'intelligence/report.json',v=>v.assertions=[])],
 ['failed assertion',b=>alter(b,'intelligence/report.json',v=>v.assertions[0].ok=false)],
 ['console error',b=>alter(b,'intelligence/report.json',v=>v.runs[0].consoleErrors=['bad'])],
 ['duplicate assertion',b=>alter(b,'intelligence/report.json',v=>{v.assertions.push(v.assertions[0]);v.passed++;})],
 ['missing territory step',b=>alter(b,'territories/report.json',v=>v.cases[0].steps.pop())],
 ['missing named view',b=>alter(b,'territories/report.json',v=>delete v.cases[0].views.lage)],
 ['missing named screenshot',b=>b.files=b.files.filter(f=>f.path!=='intelligence/chromium-dark-1440-literal-empty-search.png')],
 ['changed signed restored state',b=>alter(b,'signed-update/report.json',v=>v.restoredState[0].after[0].envelope.value.q='wrong')],
 ['signed missing engine',b=>alter(b,'signed-update/report.json',v=>v.checks.pop())],
])test('receipt refuses '+name,()=>{const b=acceptedBundle();change(b);assert.throws(()=>validateRadarBundle(b,source,request));});
test('command timeout kills its owned group and actual synthetic descendant',async()=>{
 const root=fixture(),pidPath=join(root,'child.pid');
 const program=`const cp=require('child_process'),fs=require('fs');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid));setInterval(()=>{},1000);`;
 const r=await runCommand(process.execPath,['-e',program],{stdio:'ignore'},1000);assert.equal(r.status,124);
 const pid=Number(readFileSync(pidPath,'utf8'));assert.ok(Number.isInteger(pid)&&pid>1);
 const stat=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).stdout.trim();
 assert.ok(stat===''||stat.startsWith('Z'),'synthetic descendant remains running');
});

test('keyless zero-exit receipt cannot pass without actual three staged reports',()=>{
 const proof=fixture();writeFileSync(join(proof,'gate-receipt.json'),JSON.stringify({sourceSha:source,requestId:request,proofExit:0,fullMatricesRequested:true}));
 for(const n of ['territories','intelligence','signed-update'])mkdirSync(join(proof,n));
 assert.throws(()=>validateStagedProof(proof,source,request));
 const script=readFileSync(new URL('./run-radar-proof.mjs',import.meta.url),'utf8');
 assert.match(script,/if\(status===0\)validateStagedProof\(proof,process.env.SOURCE_SHA,process.env.REQUEST_ID\)/);
});
