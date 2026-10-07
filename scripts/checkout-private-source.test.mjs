import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = join(ROOT, "scripts/checkout-private-source.sh");
const SHA = "a".repeat(40);

function invoke(args, env = {}) {
  const testRoot = mkdtempSync(join(tmpdir(), "scai-private-checkout-test-"));
  const runnerTemp = join(testRoot, "runner-temp");
  const workspace = join(testRoot, "workspace");
  mkdirSync(runnerTemp);
  mkdirSync(workspace);
  const result = spawnSync("bash", [HELPER, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runnerTemp, ...env },
  });
  return { ...result, runnerTemp, testRoot, workspace };
}

function cleanup(testRoot) {
  rmSync(testRoot, { recursive: true, force: true });
}

function writeMock(binDir, name, body) {
  const target = join(binDir, name);
  writeFileSync(target, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(target, 0o755);
}

test("repository allowlist, immutable SHA and dedicated key fail closed", () => {
  for (const [args, expectedStatus, expectedMessage] of [
    [["u1-chat", "git@github.com:attacker/source.git", SHA], 64, /not allowlisted/],
    [["u1-chat", "git@github.com:subunit-ai/u1-chat.git", "main"], 64, /40 lowercase hexadecimal/],
    [["u1-chat", "git@github.com:subunit-ai/u1-chat.git", SHA], 65, /deploy key is missing/],
    [["subunit-notch", "git@github.com:subunit-ai/subunit-notch.git", SHA], 65, /deploy key is missing/],
    [["subunit-notch", "git@github.com:subunit-ai/echo.git", SHA], 64, /not allowlisted/],
    [["subunit-scai", "git@github.com:subunit-ai/subunit-scai.git", SHA], 65, /deploy key is missing/],
    [["subunit-scai", "git@github.com:subunit-ai/atlas.git", SHA], 64, /not allowlisted/],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, expectedStatus);
    assert.match(result.stdout + result.stderr, expectedMessage);
    cleanup(result.testRoot);
  }
});

test("an untrusted GitHub host key is rejected and credential files are cleaned", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "scai-private-host-test-"));
  const binDir = join(testRoot, "bin");
  const runnerTemp = join(testRoot, "runner-temp");
  const workspace = join(testRoot, "workspace");
  mkdirSync(binDir);
  mkdirSync(runnerTemp);
  mkdirSync(workspace);
  writeMock(binDir, "ssh-keyscan", "printf '%s\\n' 'github.com ssh-ed25519 AAAAUNTRUSTED'");
  writeMock(binDir, "ssh-keygen", "printf '%s\\n' '256 SHA256:WRONG github.com (ED25519)'");

  const secret = "PRIVATE_DEPLOY_KEY_CANARY";
  const result = spawnSync("bash", [HELPER, "u1-chat", "git@github.com:subunit-ai/u1-chat.git", SHA], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: runnerTemp,
      SOURCE_DEPLOY_KEY: secret,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 68);
  assert.match(result.stdout + result.stderr, /host verification failed/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.equal(existsSync(join(runnerTemp, "scai-u1-chat-deploy-key")), false);
  assert.equal(existsSync(join(runnerTemp, "scai-u1-chat-known-hosts")), false);
  cleanup(testRoot);
});

test("the happy path fetches and detaches the exact SHA without retaining credentials", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "scai-private-success-test-"));
  const binDir = join(testRoot, "bin");
  const runnerTemp = join(testRoot, "runner-temp");
  const workspace = join(testRoot, "workspace");
  const gitLog = join(testRoot, "git-calls.log");
  mkdirSync(binDir);
  mkdirSync(runnerTemp);
  mkdirSync(workspace);
  writeMock(binDir, "ssh-keyscan", "printf '%s\\n' 'github.com ssh-ed25519 AAAAPINNED'");
  writeMock(binDir, "ssh-keygen", "printf '%s\\n' '256 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU github.com (ED25519)'");
  writeMock(binDir, "git", `
printf '%s\\n' "$*" >> "$MOCK_GIT_LOG"
if [ "\${1:-}" = "init" ]; then
  mkdir -p "\${3:?}/.git"
elif [ "\${1:-}" = "-C" ] && [ "\${3:-}" = "rev-parse" ]; then
  printf '%s\\n' "$MOCK_SOURCE_SHA"
fi
`);

  const secret = "PRIVATE_DEPLOY_KEY_CANARY";
  const result = spawnSync("bash", [HELPER, "u1-chat", "git@github.com:subunit-ai/u1-chat.git", SHA], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: runnerTemp,
      SOURCE_DEPLOY_KEY: secret,
      MOCK_GIT_LOG: gitLog,
      MOCK_SOURCE_SHA: SHA,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`PASS private-checkout-u1-chat \\(source-sha=${SHA}\\)`));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  const calls = readFileSync(gitLog, "utf8");
  assert.match(calls, new RegExp(`fetch --depth 1 origin ${SHA}`));
  assert.match(calls, /checkout --detach FETCH_HEAD/);
  assert.match(calls, /remote remove origin/);
  assert.equal(existsSync(join(runnerTemp, "scai-u1-chat-deploy-key")), false);
  assert.equal(existsSync(join(runnerTemp, "scai-u1-chat-known-hosts")), false);
  cleanup(testRoot);
});

test("an OpenSSH banner comment on stdout is ignored for host pinning (macOS runners)", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "scai-private-success-test-"));
  const binDir = join(testRoot, "bin");
  const runnerTemp = join(testRoot, "runner-temp");
  const workspace = join(testRoot, "workspace");
  const gitLog = join(testRoot, "git-calls.log");
  mkdirSync(binDir);
  mkdirSync(runnerTemp);
  mkdirSync(workspace);
  writeMock(binDir, "ssh-keyscan", "printf '%s\\n' '# github.com:22 SSH-2.0-2097ddd' 'github.com ssh-ed25519 AAAAPINNED'");
  writeMock(binDir, "ssh-keygen", "printf '%s\\n' '256 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU github.com (ED25519)'");
  writeMock(binDir, "git", `
printf '%s\\n' "$*" >> "$MOCK_GIT_LOG"
if [ "\${1:-}" = "init" ]; then
  mkdir -p "\${3:?}/.git"
elif [ "\${1:-}" = "-C" ] && [ "\${3:-}" = "rev-parse" ]; then
  printf '%s\\n' "$MOCK_SOURCE_SHA"
fi
`);

  const secret = "PRIVATE_DEPLOY_KEY_CANARY";
  const result = spawnSync("bash", [HELPER, "u1-chat", "git@github.com:subunit-ai/u1-chat.git", SHA], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: runnerTemp,
      SOURCE_DEPLOY_KEY: secret,
      MOCK_GIT_LOG: gitLog,
      MOCK_SOURCE_SHA: SHA,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`PASS private-checkout-u1-chat \\(source-sha=${SHA}\\)`));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  const calls = readFileSync(gitLog, "utf8");
  assert.match(calls, new RegExp(`fetch --depth 1 origin ${SHA}`));
  assert.match(calls, /checkout --detach FETCH_HEAD/);
  assert.match(calls, /remote remove origin/);
  assert.equal(existsSync(join(runnerTemp, "scai-u1-chat-deploy-key")), false);
  assert.equal(existsSync(join(runnerTemp, "scai-u1-chat-known-hosts")), false);
  cleanup(testRoot);
});

for (const component of ['sonar-tauri', 'bridge-tauri', 'trace-tauri']) test(`Sonar-Quellen verlangen je einen eigenen Deploy-Key: ${component}`, () => {
  const result = invoke([component, `git@github.com:subunit-ai/${component}.git`, SHA], { SOURCE_DEPLOY_KEY: '' });
  assert.equal(result.status, 65);
  cleanup(result.testRoot);
});
for (const [name, tagSha, fetchStatus, status] of [
  ['leichter oder annotierter Tag stimmt', SHA, 0, 0],
  ['Tag zeigt auf anderen Commit', 'b'.repeat(40), 0, 67],
  ['Tag fehlt oder Transport scheitert', SHA, 1, 1],
]) test(`Komponenten-Drift-Guard: ${name}`, t => {
  const root = mkdtempSync(join(tmpdir(), 'sonar-tag-checkout-'));
  t.after(() => cleanup(root));
  const bin = join(root, 'bin'), runnerTemp = join(root, 'runner'), workspace = join(root, 'workspace');
  for (const path of [bin, runnerTemp, workspace]) mkdirSync(path);
  const gitLog = join(root, 'git.log');
  writeMock(bin, 'ssh-keyscan', "printf '%s\\n' 'github.com ssh-ed25519 AAAAPINNED'");
  writeMock(bin, 'ssh-keygen', "printf '%s\\n' '256 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU github.com (ED25519)'");
  writeMock(bin, 'git', `
printf '%s\\n' "$*" >> "$MOCK_GIT_LOG"
if [ "\${1:-}" = init ]; then mkdir -p "\${3:?}/.git";
elif [ "\${3:-}" = rev-parse ]; then
  if [ "\${4:-}" = 'FETCH_HEAD^{commit}' ]; then printf '%s\\n' "$MOCK_TAG_SHA"; else printf '%s\\n' "$MOCK_SOURCE_SHA"; fi
elif [ "\${3:-}" = fetch ] && [[ "$*" == *refs/tags/* ]]; then exit "$MOCK_TAG_STATUS";
fi`);
  const secret = 'PRIVATE_DEPLOY_KEY_CANARY';
  const result = spawnSync('bash', [HELPER, 'bridge-tauri', 'git@github.com:subunit-ai/bridge-tauri.git', SHA, 'v0.4.9'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace, SOURCE_DEPLOY_KEY: secret, MOCK_GIT_LOG: gitLog, MOCK_SOURCE_SHA: SHA, MOCK_TAG_SHA: tagSha, MOCK_TAG_STATUS: String(fetchStatus) },
  });
  assert.equal(result.status, status, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.match(readFileSync(gitLog, 'utf8'), /fetch --depth 1 -- origin refs\/tags\/v0\.4\.9/);
  assert.equal(existsSync(join(runnerTemp, 'scai-bridge-tauri-deploy-key')), false);
  assert.equal(existsSync(join(runnerTemp, 'scai-bridge-tauri-known-hosts')), false);
});
