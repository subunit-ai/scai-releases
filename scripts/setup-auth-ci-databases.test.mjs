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
  writeFileSync(join(bin,"psql"), `#!/bin/sh\ncat >> "$AUTH_GUARD_MARKER"\n${mode === "error" ? "exit 42" : "echo t"}\n`,{mode:0o700});
  // Credential encoding is not relevant to the preflight rejection assertions.
  writeFileSync(join(bin,"bun"), "#!/bin/sh\nprintf fixture-password\n",{mode:0o700});
  return {root,source,marker,env:{...process.env,PATH:bin+":"+process.env.PATH,PGHOST:"127.0.0.1",PGPORT:"5432",PGUSER:"postgres",PGPASSWORD:"fixture-password",AUTH_CI_PREFIX:"auth_ci_test0001",AUTH_GUARD_MARKER:marker}};
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
