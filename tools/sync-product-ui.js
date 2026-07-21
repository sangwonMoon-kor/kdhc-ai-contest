"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function assertSafeEntry(entry) {
  const value = String(entry || "");
  const parts = value.split("/");
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`unsafe manifest entry: ${value}`);
  }
  return value;
}

function assertWithin(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its root`);
  }
  return resolvedCandidate;
}

function assertDirectory(abs, label) {
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe ${label}`);
}

function lstatOrNull(abs) {
  try {
    return fs.lstatSync(abs);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function filesUnder(root, entry) {
  const sourceRoot = fs.realpathSync(root);
  const start = assertWithin(sourceRoot, path.join(sourceRoot, entry), "source entry");
  if (!lstatOrNull(start)) throw new Error(`missing source entry: ${entry}`);
  const out = [];

  function walk(abs) {
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`unsafe source entry: ${path.relative(sourceRoot, abs)}`);
    }
    if (stat.isFile()) {
      out.push(path.relative(sourceRoot, abs));
      return;
    }
    for (const name of fs.readdirSync(abs).sort()) walk(path.join(abs, name));
  }

  walk(start);
  return out;
}

function same(source, destination) {
  const stat = lstatOrNull(destination);
  if (!stat) return false;
  return stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(source).equals(fs.readFileSync(destination));
}

function defaultInspect(sourceRepo, targetRepo) {
  const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  return {
    remote: git(targetRepo, ["remote", "get-url", "origin"]),
    branch: git(targetRepo, ["branch", "--show-current"]),
    clean: git(targetRepo, ["status", "--porcelain"]) === "",
    sourceSha: git(sourceRepo, ["rev-parse", "--short=12", "HEAD"]),
  };
}

function isExpectedRemote(remote) {
  return /^(?:(?:https?|git):\/\/github\.com\/creationy\/jikmu-memory|git@github\.com:creationy\/jikmu-memory)(?:\.git)?\/?$/.test(String(remote).trim());
}

function targetPublicRoot(targetRepo) {
  const repo = fs.realpathSync(targetRepo);
  assertDirectory(repo, "target repository");
  const service = assertWithin(repo, path.join(repo, "service"), "target service directory");
  const publicDir = assertWithin(service, path.join(service, "public"), "target public directory");
  assertDirectory(service, "target service directory");
  assertDirectory(publicDir, "target public directory");
  return fs.realpathSync(publicDir);
}

function assertWritableDestination(target, relativePath) {
  const destination = assertWithin(target, path.join(target, relativePath), "destination");
  const relativeParent = path.dirname(relativePath);
  let current = target;
  if (relativeParent !== ".") {
    for (const part of relativeParent.split(path.sep)) {
      current = path.join(current, part);
      if (lstatOrNull(current)) {
        assertDirectory(current, "destination directory");
      } else {
        fs.mkdirSync(current);
      }
    }
  }
  const destinationStat = lstatOrNull(destination);
  if (destinationStat && (destinationStat.isSymbolicLink() || !destinationStat.isFile() || destinationStat.nlink !== 1)) {
    throw new Error(`unsafe destination: ${relativePath}`);
  }
  return destination;
}

function readProvenance(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function syncProductUi({ sourceRoot, targetRepo, write, inspectRepo }) {
  const source = fs.realpathSync(sourceRoot);
  assertDirectory(source, "source root");
  const sourceRepo = path.resolve(source, "..");
  const inspect = inspectRepo || (() => defaultInspect(sourceRepo, targetRepo));
  const state = inspect();
  if (!isExpectedRemote(state.remote)) throw new Error("wrong target remote");
  if (!/^ui\/.+/.test(String(state.branch))) throw new Error("target branch must start with ui/");
  if (!state.clean) throw new Error("target working tree must be clean");

  const manifest = JSON.parse(fs.readFileSync(path.join(source, "sync-manifest.json"), "utf8"));
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error("invalid sync manifest");
  const version = JSON.parse(fs.readFileSync(path.join(source, "version.json"), "utf8"));
  const target = targetPublicRoot(targetRepo);
  const relFiles = [...new Set(manifest.entries.flatMap((entry) => filesUnder(source, assertSafeEntry(entry))))].sort();
  let changed = false;

  for (const rel of relFiles) {
    const from = assertWithin(source, path.join(source, rel), "source file");
    const to = assertWithin(target, path.join(target, rel), "destination");
    if (!same(from, to)) {
      changed = true;
      if (write) fs.copyFileSync(from, assertWritableDestination(target, rel));
    }
  }

  const expectedProvenance = {
    repository: "sangwonMoon-kor/kdhc-ai-contest",
    commit: state.sourceSha,
    version: version.version,
  };
  const provenanceFile = path.join(target, ".ui-source.json");
  const provenance = readProvenance(provenanceFile);
  const provenanceMatches = provenance && ["repository", "commit", "version"].every((key) => provenance[key] === expectedProvenance[key]);
  if (!provenanceMatches) {
    changed = true;
    if (write) {
      const destination = assertWritableDestination(target, ".ui-source.json");
      fs.writeFileSync(destination, `${JSON.stringify({ ...expectedProvenance, syncedAt: new Date().toISOString() }, null, 2)}\n`);
    }
  }
  return { changed, files: relFiles.length, provenance: provenanceMatches ? provenance : expectedProvenance };
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--target") out.target = argv[++index];
    else if (argv[index] === "--write") out.write = true;
    else if (argv[index] === "--check") out.write = false;
  }
  return out;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.target) throw new Error("--target is required");
    const result = syncProductUi({
      sourceRoot: path.resolve(__dirname, "..", "product-ui"),
      targetRepo: path.resolve(args.target),
      write: Boolean(args.write),
    });
    console.log(`${args.write ? "synced" : "checked"} ${result.files} files; changed=${result.changed}; source=${result.provenance.commit}`);
    if (!args.write && result.changed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { syncProductUi, assertSafeEntry };
