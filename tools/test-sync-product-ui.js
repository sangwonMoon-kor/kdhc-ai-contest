"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { syncProductUi, assertSafeEntry } = require("./sync-product-ui.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jikmu-ui-sync-"));
const sourceRoot = path.join(tmp, "source");
const targetRepo = path.join(tmp, "target");
fs.mkdirSync(path.join(sourceRoot, "fixtures"), { recursive: true });
fs.mkdirSync(path.join(targetRepo, "service", "public"), { recursive: true });
fs.mkdirSync(path.join(targetRepo, "service", "src"), { recursive: true });
fs.writeFileSync(path.join(sourceRoot, "index.html"), "new ui\n");
fs.writeFileSync(path.join(sourceRoot, "fixtures", "summary.json"), "{}\n");
fs.writeFileSync(
  path.join(sourceRoot, "sync-manifest.json"),
  JSON.stringify({ version: 1, entries: ["index.html", "fixtures"] }),
);
fs.writeFileSync(path.join(sourceRoot, "version.json"), JSON.stringify({ version: "ui-v1.0.0" }));
fs.writeFileSync(path.join(targetRepo, "service", "public", "index.html"), "old ui\n");
fs.writeFileSync(path.join(targetRepo, "service", "src", "sentinel.js"), "do not touch\n");

assert.throws(() => assertSafeEntry("../service/src"), /unsafe manifest entry/);
assert.throws(() => assertSafeEntry("/service/src"), /unsafe manifest entry/);
assert.throws(() => assertSafeEntry("fixtures\\..\\..\\service\\src"), /unsafe manifest entry/);

const inspectRepo = () => ({
  remote: "https://github.com/creationy/jikmu-memory.git",
  branch: "ui/test",
  clean: true,
  sourceSha: "abc1234",
});
const check = syncProductUi({ sourceRoot, targetRepo, write: false, inspectRepo });
assert.equal(check.changed, true);
assert.equal(fs.readFileSync(path.join(targetRepo, "service", "public", "index.html"), "utf8"), "old ui\n");

const written = syncProductUi({ sourceRoot, targetRepo, write: true, inspectRepo });
assert.equal(written.changed, true);
assert.equal(fs.readFileSync(path.join(targetRepo, "service", "public", "index.html"), "utf8"), "new ui\n");
assert.equal(fs.readFileSync(path.join(targetRepo, "service", "src", "sentinel.js"), "utf8"), "do not touch\n");
const provenance = JSON.parse(fs.readFileSync(path.join(targetRepo, "service", "public", ".ui-source.json"), "utf8"));
assert.equal(provenance.repository, "sangwonMoon-kor/kdhc-ai-contest");
assert.equal(provenance.commit, "abc1234");

const cleanCheck = syncProductUi({ sourceRoot, targetRepo, write: false, inspectRepo });
assert.equal(cleanCheck.changed, false, "check after write must be clean");
assert.throws(
  () => syncProductUi({
    sourceRoot,
    targetRepo,
    write: true,
    inspectRepo: () => ({ remote: "wrong/repo", branch: "ui/test", clean: true, sourceSha: "x" }),
  }),
  /wrong target remote/,
);
assert.throws(
  () => syncProductUi({
    sourceRoot,
    targetRepo,
    write: true,
    inspectRepo: () => ({
      remote: "https://github.com/other/creationy/jikmu-memory.git",
      branch: "ui/test",
      clean: true,
      sourceSha: "x",
    }),
  }),
  /wrong target remote/,
);
assert.throws(
  () => syncProductUi({
    sourceRoot,
    targetRepo,
    write: true,
    inspectRepo: () => ({ remote: "https://github.com/creationy/jikmu-memory.git", branch: "main", clean: true, sourceSha: "x" }),
  }),
  /target branch must start with ui\//,
);
assert.throws(
  () => syncProductUi({
    sourceRoot,
    targetRepo,
    write: true,
    inspectRepo: () => ({ remote: "https://github.com/creationy/jikmu-memory.git", branch: "ui/test", clean: false, sourceSha: "x" }),
  }),
  /target working tree must be clean/,
);

if (process.platform !== "win32") {
  fs.unlinkSync(path.join(targetRepo, "service", "public", "index.html"));
  fs.symlinkSync(path.join(targetRepo, "service", "src", "missing.js"), path.join(targetRepo, "service", "public", "index.html"));
  assert.throws(
    () => syncProductUi({ sourceRoot, targetRepo, write: true, inspectRepo }),
    /unsafe destination/,
  );
  fs.unlinkSync(path.join(targetRepo, "service", "public", "index.html"));
  fs.linkSync(path.join(targetRepo, "service", "src", "sentinel.js"), path.join(targetRepo, "service", "public", "index.html"));
  assert.throws(
    () => syncProductUi({ sourceRoot, targetRepo, write: true, inspectRepo }),
    /unsafe destination/,
  );
  const linkedFixture = path.join(sourceRoot, "fixtures", "outside.json");
  fs.symlinkSync(path.join(targetRepo, "service", "src", "sentinel.js"), linkedFixture);
  assert.throws(
    () => syncProductUi({ sourceRoot, targetRepo, write: false, inspectRepo }),
    /unsafe source entry/,
  );
}

console.log("UI sync contract passed");
