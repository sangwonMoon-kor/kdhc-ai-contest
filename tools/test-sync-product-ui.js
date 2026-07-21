"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { syncProductUi, assertSafeEntry } = require("./sync-product-ui.js");

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jikmu-ui-sync-")));
const SOURCE_REMOTE = "https://github.com/sangwonMoon-kor/kdhc-ai-contest.git";
const TARGET_REMOTE = "https://github.com/creationy/jikmu-memory.git";
const SOURCE_SHA = "a".repeat(40);

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(name, options = {}) {
  const root = path.join(tmp, name);
  const sourceRepo = path.join(root, "source-repo");
  const sourceRoot = path.join(sourceRepo, "product-ui");
  const targetRepo = path.join(root, "target-repo");
  const targetPublic = path.join(targetRepo, "service", "public");
  const targetSrc = path.join(targetRepo, "service", "src");
  const targetGitDir = path.join(targetRepo, ".git-test");
  const sourceFiles = options.sourceFiles || {
    "index.html": "new ui\n",
    "fixtures/summary.json": "{}\n",
  };
  const entries = options.entries || ["index.html", "fixtures"];

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(targetPublic, { recursive: true });
  fs.mkdirSync(targetSrc, { recursive: true });
  fs.mkdirSync(targetGitDir, { recursive: true });
  for (const [relative, content] of Object.entries(sourceFiles)) writeFile(path.join(sourceRoot, relative), content);
  writeJson(path.join(sourceRoot, "sync-manifest.json"), options.manifest || { version: 1, entries });
  writeJson(path.join(sourceRoot, "version.json"), options.version || { version: "ui-v1.0.0" });
  for (const [relative, content] of Object.entries(options.targetFiles || { "index.html": "old ui\n" })) {
    writeFile(path.join(targetPublic, relative), content);
  }
  writeFile(path.join(targetSrc, "sentinel.js"), "do not touch\n");

  return { root, sourceRepo, sourceRoot, targetRepo, targetPublic, targetSrc, targetGitDir };
}

function stateFor(fixture, overrides = {}) {
  return {
    source: {
      topLevel: fixture.sourceRepo,
      remote: SOURCE_REMOTE,
      branch: "feature/product-ui-source",
      clean: true,
      sha: SOURCE_SHA,
      ...(overrides.source || {}),
    },
    target: {
      topLevel: fixture.targetRepo,
      gitDir: fixture.targetGitDir,
      remote: TARGET_REMOTE,
      branch: "ui/test",
      clean: true,
      ...(overrides.target || {}),
    },
  };
}

function inspector(fixture, overrides) {
  const state = stateFor(fixture, overrides);
  return () => JSON.parse(JSON.stringify(state));
}

function invoke(fixture, write, inspectRepo = inspector(fixture)) {
  return syncProductUi({ sourceRoot: fixture.sourceRoot, targetRepo: fixture.targetRepo, write, inspectRepo });
}

function provenanceFor(managedFiles, overrides = {}) {
  return {
    repository: "sangwonMoon-kor/kdhc-ai-contest",
    commit: SOURCE_SHA,
    version: "ui-v1.0.0",
    managedFiles: [...managedFiles].sort(),
    syncedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function treeSnapshot(root) {
  const out = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) out.push([relative, "link", fs.readlinkSync(absolute)]);
      else if (stat.isDirectory()) {
        out.push([relative, "dir"]);
        walk(absolute);
      } else out.push([relative, "file", fs.readFileSync(absolute).toString("base64")]);
    }
  }
  walk(root);
  return out;
}

function assertNoTransactionArtifacts(fixture) {
  const names = treeSnapshot(fixture.targetRepo).map(([name]) => name);
  assert.equal(names.some((name) => name.includes(".ui-sync-") || name.endsWith("jikmu-product-ui-sync.lock")), false);
}

function assertSentinel(fixture) {
  assert.equal(fs.readFileSync(path.join(fixture.targetSrc, "sentinel.js"), "utf8"), "do not touch\n");
}

assert.throws(() => assertSafeEntry("../service/src"), /unsafe manifest entry/);
assert.throws(() => assertSafeEntry("/service/src"), /unsafe manifest entry/);
assert.throws(() => assertSafeEntry("fixtures\\..\\..\\service\\src"), /unsafe manifest entry/);

{
  const fixture = makeFixture("strict-api");
  assert.throws(
    () => syncProductUi({ sourceRoot: fixture.sourceRoot, targetRepo: fixture.targetRepo, write: "false", inspectRepo: inspector(fixture) }),
    /write must be a boolean/,
  );
}

{
  const fixture = makeFixture("baseline");
  const beforeCheck = treeSnapshot(fixture.targetRepo);
  const check = invoke(fixture, false);
  assert.equal(check.changed, true);
  assert.deepEqual(treeSnapshot(fixture.targetRepo), beforeCheck, "check mode must not create a lock, temp, provenance, or copied file");

  const written = invoke(fixture, true);
  assert.equal(written.changed, true);
  assert.equal(fs.readFileSync(path.join(fixture.targetPublic, "index.html"), "utf8"), "new ui\n");
  assert.equal(fs.readFileSync(path.join(fixture.targetPublic, "fixtures", "summary.json"), "utf8"), "{}\n");
  const provenance = JSON.parse(fs.readFileSync(path.join(fixture.targetPublic, ".ui-source.json"), "utf8"));
  assert.equal(provenance.repository, "sangwonMoon-kor/kdhc-ai-contest");
  assert.equal(provenance.commit, SOURCE_SHA);
  assert.deepEqual(provenance.managedFiles, ["fixtures/summary.json", "index.html"]);
  assert.equal(new Date(provenance.syncedAt).toISOString(), provenance.syncedAt);
  assert.equal(invoke(fixture, false).changed, false, "unchanged check after write must be stable");
  assertNoTransactionArtifacts(fixture);
  assertSentinel(fixture);
}

for (const [name, overrides, pattern] of [
  ["wrong-source-remote", { source: { remote: "https://github.com/other/kdhc-ai-contest.git" } }, /wrong source remote/],
  ["insecure-source-remote", { source: { remote: "http://github.com/sangwonMoon-kor/kdhc-ai-contest.git" } }, /wrong source remote/],
  ["dirty-source", { source: { clean: false } }, /source working tree must be clean/],
  ["wrong-source-top", { source: { topLevel: tmp } }, /source top-level mismatch/],
  ["bad-sha", { source: { sha: "abc1234" } }, /invalid source SHA/],
  ["wrong-target-remote", { target: { remote: "https://github.com/other/jikmu-memory.git" } }, /wrong target remote/],
  ["insecure-target-remote", { target: { remote: "git:\/\/github.com/creationy/jikmu-memory.git" } }, /wrong target remote/],
  ["wrong-target-branch", { target: { branch: "main" } }, /target branch must start with ui\//],
  ["dirty-target", { target: { clean: false } }, /target working tree must be clean/],
]) {
  const fixture = makeFixture(name);
  assert.throws(() => invoke(fixture, false, inspector(fixture, overrides)), pattern, name);
  assertSentinel(fixture);
}

for (const [name, fixtureOptions, pattern] of [
  ["manifest-version", { manifest: { version: 2, entries: ["index.html"] } }, /invalid sync manifest/],
  ["manifest-entries", { manifest: { version: 1, entries: "index.html" } }, /invalid sync manifest/],
  ["manifest-reserved-provenance", {
    entries: [".ui-source.json"],
    sourceFiles: { ".ui-source.json": "{}\n" },
  }, /invalid sync manifest.*reserved/],
  ["ui-version", { version: { version: "1.0.0" } }, /invalid UI version/],
]) {
  const fixture = makeFixture(name, fixtureOptions);
  assert.throws(() => invoke(fixture, false), pattern, name);
  assertSentinel(fixture);
}

if (process.platform !== "win32") {
  {
    const fixture = makeFixture("source-intermediate-symlink");
    const outside = path.join(fixture.root, "outside");
    writeFile(path.join(outside, "summary.json"), "{}\n");
    fs.unlinkSync(path.join(fixture.sourceRoot, "fixtures", "summary.json"));
    fs.rmdirSync(path.join(fixture.sourceRoot, "fixtures"));
    fs.symlinkSync(outside, path.join(fixture.sourceRoot, "fixtures"));
    assert.throws(() => invoke(fixture, false), /unsafe source/);
  }
  {
    const fixture = makeFixture("source-final-symlink", { entries: ["index.html"] });
    const outside = path.join(fixture.root, "outside.html");
    writeFile(outside, "new ui\n");
    fs.unlinkSync(path.join(fixture.sourceRoot, "index.html"));
    fs.symlinkSync(outside, path.join(fixture.sourceRoot, "index.html"));
    assert.throws(() => invoke(fixture, false), /unsafe source/);
  }
  {
    const fixture = makeFixture("source-hardlink", { entries: ["index.html"] });
    fs.linkSync(path.join(fixture.sourceRoot, "index.html"), path.join(fixture.sourceRoot, "other.html"));
    assert.throws(() => invoke(fixture, false), /unsafe source.*hardlink/);
  }
  {
    const fixture = makeFixture("target-intermediate-symlink");
    fs.symlinkSync(fixture.targetSrc, path.join(fixture.targetPublic, "fixtures"));
    assert.throws(() => invoke(fixture, true), /unsafe target/);
    assert.equal(fs.readFileSync(path.join(fixture.targetPublic, "index.html"), "utf8"), "old ui\n");
    assertSentinel(fixture);
  }
  {
    const fixture = makeFixture("target-dangling-symlink", { entries: ["index.html"] });
    fs.unlinkSync(path.join(fixture.targetPublic, "index.html"));
    fs.symlinkSync(path.join(fixture.targetSrc, "missing.js"), path.join(fixture.targetPublic, "index.html"));
    assert.throws(() => invoke(fixture, true), /unsafe target/);
    assertSentinel(fixture);
  }
  {
    const fixture = makeFixture("target-same-content-hardlink", { entries: ["index.html"] });
    writeFile(path.join(fixture.targetSrc, "same-index.html"), "new ui\n");
    fs.unlinkSync(path.join(fixture.targetPublic, "index.html"));
    fs.linkSync(path.join(fixture.targetSrc, "same-index.html"), path.join(fixture.targetPublic, "index.html"));
    assert.throws(() => invoke(fixture, false), /unsafe target.*hardlink/);
    assertSentinel(fixture);
  }
  {
    const fixture = makeFixture("target-provenance-hardlink", {
      entries: ["index.html"],
      targetFiles: { "index.html": "new ui\n" },
    });
    writeJson(path.join(fixture.targetSrc, "provenance.json"), provenanceFor(["index.html"]));
    fs.linkSync(path.join(fixture.targetSrc, "provenance.json"), path.join(fixture.targetPublic, ".ui-source.json"));
    assert.throws(() => invoke(fixture, false), /unsafe target.*hardlink/);
    assertSentinel(fixture);
  }
}

{
  const fixture = makeFixture("source-read-race", { entries: ["index.html"] });
  const originalRead = fs.readFileSync;
  let mutated = false;
  fs.readFileSync = function patchedRead(file, ...args) {
    const result = originalRead.call(fs, file, ...args);
    if (!mutated && typeof file === "number") {
      mutated = true;
      fs.appendFileSync(path.join(fixture.sourceRoot, "sync-manifest.json"), " ");
    }
    return result;
  };
  try {
    assert.throws(() => invoke(fixture, false), /source changed during read/);
  } finally {
    fs.readFileSync = originalRead;
  }
}

{
  const fixture = makeFixture("preflight-late-failure", {
    entries: ["index.html", "z.txt"],
    sourceFiles: { "index.html": "new ui\n", "z.txt": "new z\n" },
    targetFiles: { "index.html": "old ui\n", "z.txt": "old z\n" },
  });
  if (process.platform !== "win32") {
    writeFile(path.join(fixture.targetSrc, "z-copy.txt"), "old z\n");
    fs.unlinkSync(path.join(fixture.targetPublic, "z.txt"));
    fs.linkSync(path.join(fixture.targetSrc, "z-copy.txt"), path.join(fixture.targetPublic, "z.txt"));
    assert.throws(() => invoke(fixture, true), /unsafe target.*hardlink/);
    assert.equal(fs.readFileSync(path.join(fixture.targetPublic, "index.html"), "utf8"), "old ui\n");
    assert.equal(fs.existsSync(path.join(fixture.targetPublic, ".ui-source.json")), false);
    assertSentinel(fixture);
  }
}

{
  const fixture = makeFixture("provenance-validation", {
    entries: ["index.html"],
    targetFiles: { "index.html": "new ui\n" },
  });
  writeJson(path.join(fixture.targetPublic, ".ui-source.json"), provenanceFor(["index.html"], { syncedAt: "not-a-date" }));
  assert.equal(invoke(fixture, false).changed, true, "invalid timestamp must require repair");
  invoke(fixture, true);
  const repaired = JSON.parse(fs.readFileSync(path.join(fixture.targetPublic, ".ui-source.json"), "utf8"));
  assert.equal(new Date(repaired.syncedAt).toISOString(), repaired.syncedAt);

  const previousTimestamp = repaired.syncedAt;
  fs.writeFileSync(path.join(fixture.targetPublic, "index.html"), "old again\n");
  invoke(fixture, true);
  const refreshed = JSON.parse(fs.readFileSync(path.join(fixture.targetPublic, ".ui-source.json"), "utf8"));
  assert.notEqual(refreshed.syncedAt, previousTimestamp, "actual file repair must refresh syncedAt");
  assert.equal(invoke(fixture, false).changed, false);
}

{
  const fixture = makeFixture("missing-timestamp", {
    entries: ["index.html"],
    targetFiles: { "index.html": "new ui\n" },
  });
  const withoutTimestamp = provenanceFor(["index.html"]);
  delete withoutTimestamp.syncedAt;
  writeJson(path.join(fixture.targetPublic, ".ui-source.json"), withoutTimestamp);
  assert.equal(invoke(fixture, false).changed, true);
}

{
  const fixture = makeFixture("manifest-shrink", {
    entries: ["index.html"],
    targetFiles: { "index.html": "new ui\n", "obsolete.js": "old managed file\n" },
  });
  writeJson(path.join(fixture.targetPublic, ".ui-source.json"), provenanceFor(["index.html", "obsolete.js"]));
  assert.throws(() => invoke(fixture, false), /manifest removed previously managed files.*manual review/);
  assert.throws(() => invoke(fixture, true), /manifest removed previously managed files.*manual review/);
  assert.equal(fs.readFileSync(path.join(fixture.targetPublic, "obsolete.js"), "utf8"), "old managed file\n");
}

{
  const fixture = makeFixture("transaction-rollback");
  writeJson(path.join(fixture.targetPublic, ".ui-source.json"), provenanceFor(["fixtures/summary.json", "index.html"]));
  const before = treeSnapshot(fixture.targetRepo);
  const originalRename = fs.renameSync;
  let replacements = 0;
  fs.renameSync = function patchedRename(from, to) {
    if (path.basename(from).startsWith(".ui-sync-tmp-") && ++replacements === 2) throw new Error("injected rename failure");
    return originalRename.call(fs, from, to);
  };
  try {
    assert.throws(() => invoke(fixture, true), /injected rename failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.deepEqual(treeSnapshot(fixture.targetRepo), before, "transaction failure must restore every managed file and provenance");
  assertNoTransactionArtifacts(fixture);
  assertSentinel(fixture);
}

if (process.platform !== "win32") {
  const fixture = makeFixture("target-race");
  fs.mkdirSync(path.join(fixture.targetPublic, "fixtures"));
  const state = stateFor(fixture);
  let inspections = 0;
  const inspectRepo = () => {
    inspections += 1;
    if (inspections === 2) {
      fs.rmdirSync(path.join(fixture.targetPublic, "fixtures"));
      fs.symlinkSync(fixture.targetSrc, path.join(fixture.targetPublic, "fixtures"));
    }
    return JSON.parse(JSON.stringify(state));
  };
  assert.throws(
    () => syncProductUi({ sourceRoot: fixture.sourceRoot, targetRepo: fixture.targetRepo, write: true, inspectRepo }),
    /target changed during sync|unsafe target/,
  );
  assert.equal(fs.readFileSync(path.join(fixture.targetPublic, "index.html"), "utf8"), "old ui\n");
  assertNoTransactionArtifacts(fixture);
  assertSentinel(fixture);
}

{
  const fixture = makeFixture("secure-ssh-remotes");
  const secureState = inspector(fixture, {
    source: { remote: "git@github.com:sangwonMoon-kor/kdhc-ai-contest.git" },
    target: { remote: "ssh://git@github.com/creationy/jikmu-memory.git" },
  });
  assert.equal(invoke(fixture, false, secureState).changed, true);
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function initializeGitRepo(repo, branch, remote) {
  execFileSync("git", ["init", "-q", "-b", branch, repo]);
  git(repo, ["config", "user.name", "UI Sync Test"]);
  git(repo, ["config", "user.email", "ui-sync@example.invalid"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", "fixture"]);
}

{
  const cliRoot = path.join(tmp, "cli");
  const sourceRepo = path.join(cliRoot, "source-repo");
  const sourceRoot = path.join(sourceRepo, "product-ui");
  const tool = path.join(sourceRepo, "tools", "sync-product-ui.js");
  const targetRepo = path.join(cliRoot, "target-repo");
  fs.mkdirSync(path.dirname(tool), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "sync-product-ui.js"), tool);
  writeFile(path.join(sourceRoot, "index.html"), "cli ui\n");
  writeJson(path.join(sourceRoot, "sync-manifest.json"), { version: 1, entries: ["index.html", "version.json"] });
  writeJson(path.join(sourceRoot, "version.json"), { version: "ui-v1.0.0" });
  fs.mkdirSync(path.join(targetRepo, "service", "public"), { recursive: true });
  fs.mkdirSync(path.join(targetRepo, "service", "src"), { recursive: true });
  writeFile(path.join(targetRepo, "service", "src", "sentinel.js"), "do not touch\n");
  initializeGitRepo(sourceRepo, "feature/test", SOURCE_REMOTE);
  initializeGitRepo(targetRepo, "ui/test", TARGET_REMOTE);

  const run = (args) => spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
  for (const args of [
    ["--target", targetRepo],
    ["--target", targetRepo, "--check", "--write"],
    ["--target", targetRepo, "--check", "--check"],
    ["--target", targetRepo, "--target", targetRepo, "--check"],
    ["--target", targetRepo, "--unknown"],
    ["--target", "--check"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, `ambiguous CLI invocation unexpectedly succeeded: ${args.join(" ")}`);
  }

  const beforeCheck = treeSnapshot(targetRepo);
  const changedCheck = run(["--target", targetRepo, "--check"]);
  assert.equal(changedCheck.status, 1);
  assert.match(changedCheck.stdout, /changed=true/);
  assert.deepEqual(treeSnapshot(targetRepo), beforeCheck, "CLI check must not write");

  const write = run(["--target", targetRepo, "--write"]);
  assert.equal(write.status, 0, write.stderr);
  git(targetRepo, ["add", "service/public"]);
  git(targetRepo, ["commit", "-q", "-m", "sync ui"]);
  const unchangedCheck = run(["--target", targetRepo, "--check"]);
  assert.equal(unchangedCheck.status, 0, unchangedCheck.stderr);
  assert.match(unchangedCheck.stdout, /changed=false/);
  assert.equal(fs.readFileSync(path.join(targetRepo, "service", "src", "sentinel.js"), "utf8"), "do not touch\n");

  writeJson(path.join(sourceRoot, "sync-manifest.json"), {
    version: 1,
    entries: ["index.html", "version.json", "ignored.js"],
  });
  writeFile(path.join(sourceRepo, ".gitignore"), "product-ui/ignored.js\n");
  git(sourceRepo, ["add", "product-ui/sync-manifest.json", ".gitignore"]);
  git(sourceRepo, ["commit", "-q", "-m", "reference ignored source"]);
  writeFile(path.join(sourceRoot, "ignored.js"), "not committed\n");
  assert.equal(git(sourceRepo, ["status", "--porcelain"]), "");
  const untrackedSource = run(["--target", targetRepo, "--check"]);
  assert.equal(untrackedSource.status, 1);
  assert.match(untrackedSource.stderr, /source file is not tracked at verified commit/);
}

console.log("UI sync hardened contract passed");
