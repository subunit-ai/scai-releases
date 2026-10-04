import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve("scripts/setup-auth-ci-databases.sh");
function fixture(mode) {
  const root = mkdtempSync(join(tmpdir(), "auth-ci-guard-"));
  const source = join(root,"source"), bin = join(root,"bin");
  mkdirSync(join(source,"scripts/ci"),{recursive:true}); mkdirSync(bin);
  for (const helper of ["prepare-migration-fixture.ts","seed-legacy-upgrade.sql","run-proof-suite.sh"]) writeFileSync(join(source,"scripts/ci",helper),"");
  const marker=join(root,"psql-calls");
  writeFileSync(join(bin,"psql"), `#!/bin/sh\ncat >> "$AUTH_GUARD_MARKER"\n${mode === "error" ? "exit 42" : mode === "success" ? "echo f" : "echo t"}\n`,{mode:0o700});
  // Credential encoding is not relevant to the preflight rejection assertions.
  writeFileSync(join(bin,"bun"), "#!/bin/sh\nprintf fixture-password\n",{mode:0o700});
  return {root,source,marker,bin,env:{...process.env,PATH:bin+":"+process.env.PATH,PGHOST:"127.0.0.1",PGPORT:"5432",PGUSER:"postgres",PGPASSWORD:"fixture-password",AUTH_CI_PREFIX:"auth_ci_test0001",AUTH_GUARD_MARKER:marker}};
}
for (const [name, override] of [["remote host",{PGHOST:"database.example.invalid"}],["invalid prefix",{AUTH_CI_PREFIX:"production"}],["invalid role",{PGUSER:"postgres;drop"}]]) {
  test(`fixture rejects ${name} before contacting PostgreSQL`, () => {
    const f=fixture("collision"); const result=spawnSync("bash",[script,f.source,join(f.root,"env")],{env:{...f.env,...override},encoding:"utf8"});
    assert.equal(result.status,64); assert.equal(existsSync(f.marker),false);
  });
}
test("existing fixture identities cannot be altered",()=>{
  const f=fixture("collision");const result=spawnSync("bash",[script,f.source,join(f.root,"env")],{env:f.env,encoding:"utf8"});
  assert.equal(result.status,70); assert.doesNotMatch(readFileSync(f.marker,"utf8"),/CREATE ROLE|ALTER ROLE|CREATE DATABASE/);
  assert.equal(existsSync(join(f.root,"env")),false);
});
test("failed collision query cannot fall through into provisioning",()=>{
  const f=fixture("error");const result=spawnSync("bash",[script,f.source,join(f.root,"env")],{env:f.env,encoding:"utf8"});
  assert.equal(result.status,42);assert.doesNotMatch(readFileSync(f.marker,"utf8"),/CREATE ROLE|ALTER ROLE|CREATE DATABASE/);
});

for (const present of ["migration", "helper"]) test(`native ${present}-only pair fails before PostgreSQL`,()=>{
 const f=fixture("success");mkdirSync(join(f.source,"migrations"));
 writeFileSync(present==="migration"?join(f.source,"migrations/059_native_execution.sql"):join(f.source,"scripts/ci/prepare-native-execution-fixture.ts"),"");
 const r=spawnSync("bash",[script,f.source,join(f.root,"env")],{env:f.env,encoding:"utf8"});assert.equal(r.status,65);assert.equal(existsSync(f.marker),false);
});
for(const native of [false,true]) test(`provisioning selects exact native source pair: ${native}`,()=>{
 const f=fixture("success");const calls=join(f.root,"bun-calls");
 writeFileSync(join(f.bin,"bun"), '#!/bin/sh\nif [ "$1" = "-e" ]; then printf fixture-password; else printf "%s\\n" "$*" >> "$AUTH_BUN_CALLS"; fi\n',{mode:0o700});
 if(native){mkdirSync(join(f.source,"migrations"));writeFileSync(join(f.source,"migrations/059_native_execution.sql"),"");writeFileSync(join(f.source,"scripts/ci/prepare-native-execution-fixture.ts"),"");}
 const r=spawnSync("bash",[script,f.source,join(f.root,"env")],{env:{...f.env,AUTH_BUN_CALLS:calls},encoding:"utf8"});assert.equal(r.status,0,r.stderr);
 const output=readFileSync(join(f.root,"env"),"utf8"), commands=readFileSync(calls,"utf8"),sql=readFileSync(f.marker,"utf8");
 if(native){for(const kind of ["bridge","unbridged"])assert.ok(commands.includes(`prepare-native-execution-fixture.ts ${kind}`));for(const suffix of ["NATIVE_EXECUTION_RUNTIME_URL","NATIVE_EXECUTION_ADMIN_URL"])assert.ok(output.includes(`AUTH_CI_${suffix}=`));for(const kind of ["BRIDGE","UNBRIDGED"])for(const role of ["MIGRATION","ADMIN"])assert.ok(output.includes(`AUTH_NATIVE_EXECUTION_${kind}_${role}_URL=`));assert.equal((sql.match(/CREATE DATABASE/g)||[]).length,14);}
 else {assert.doesNotMatch(commands,/prepare-native-execution/);assert.doesNotMatch(output,/NATIVE_EXECUTION/);assert.equal((sql.match(/CREATE DATABASE/g)||[]).length,11);}
});
