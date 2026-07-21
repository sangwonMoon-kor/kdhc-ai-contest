"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SOURCE_REPOSITORY = "sangwonMoon-kor/kdhc-ai-contest";
const TARGET_REPOSITORY = "creationy/jikmu-memory";
const LOCK_NAME = "jikmu-product-ui-sync.lock";
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const GIT_READ_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };

function assertSafeEntry(entry) {
  const value = typeof entry === "string" ? entry : "";
  const parts = value.split("/");
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`unsafe manifest entry: ${value}`);
  }
  return value;
}

function lstatOrNull(absolute) {
  try {
    return fs.lstatSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertWithin(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its root`);
  }
  return resolvedCandidate;
}

function posixRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function fromPosix(root, relative) {
  return path.join(root, ...relative.split("/"));
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function directoryIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode };
}

function installedIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function identitiesEqual(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function assertCanonicalDirectory(absolute, label) {
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe ${label}`);
  if (fs.realpathSync(absolute) !== absolute) throw new Error(`unsafe ${label}`);
  return stat;
}

function validateDirectoryComponents(root, directory, label) {
  assertWithin(root, directory, label);
  assertCanonicalDirectory(root, label);
  const relative = path.relative(root, directory);
  let current = root;
  if (!relative) return;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe ${label}: ${posixRelative(root, current)}`);
    if (fs.realpathSync(current) !== current) throw new Error(`unsafe ${label}: ${posixRelative(root, current)}`);
  }
}

function readStableRegularFile(root, absolute, label, rejectHardlinks) {
  const candidate = assertWithin(root, absolute, label);
  validateDirectoryComponents(root, path.dirname(candidate), label);
  const before = lstatOrNull(candidate);
  if (!before || before.isSymbolicLink() || !before.isFile()) throw new Error(`unsafe ${label}: ${posixRelative(root, candidate)}`);
  if (rejectHardlinks && before.nlink !== 1) throw new Error(`unsafe ${label} hardlink: ${posixRelative(root, candidate)}`);
  if (fs.realpathSync(candidate) !== candidate) throw new Error(`unsafe ${label}: ${posixRelative(root, candidate)}`);

  let descriptor;
  let bytes;
  let descriptorBefore;
  let descriptorAfter;
  try {
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | NOFOLLOW);
    descriptorBefore = fs.fstatSync(descriptor);
    if (!descriptorBefore.isFile() || (rejectHardlinks && descriptorBefore.nlink !== 1)) {
      throw new Error(`unsafe ${label} hardlink: ${posixRelative(root, candidate)}`);
    }
    if (!identitiesEqual(fileIdentity(before), fileIdentity(descriptorBefore))) throw new Error(`${label} changed during read: ${posixRelative(root, candidate)}`);
    bytes = fs.readFileSync(descriptor);
    descriptorAfter = fs.fstatSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  const after = lstatOrNull(candidate);
  if (
    !after ||
    after.isSymbolicLink() ||
    !after.isFile() ||
    !identitiesEqual(fileIdentity(descriptorBefore), fileIdentity(descriptorAfter)) ||
    !identitiesEqual(fileIdentity(descriptorAfter), fileIdentity(after)) ||
    fs.realpathSync(candidate) !== candidate
  ) {
    throw new Error(`${label} changed during read: ${posixRelative(root, candidate)}`);
  }
  return { bytes, stat: after, identity: fileIdentity(after) };
}

function readSourceFile(sourceRoot, relative) {
  return readStableRegularFile(sourceRoot, fromPosix(sourceRoot, relative), "source", true);
}

function collectSourceEntry(sourceRoot, entry, files, preloaded) {
  const absolute = fromPosix(sourceRoot, entry);
  assertWithin(sourceRoot, absolute, "source entry");
  validateDirectoryComponents(sourceRoot, path.dirname(absolute), "source entry");
  const stat = lstatOrNull(absolute);
  if (!stat || stat.isSymbolicLink()) throw new Error(`unsafe source entry: ${entry}`);
  if (stat.isFile()) {
    if (stat.nlink !== 1) throw new Error(`unsafe source hardlink: ${entry}`);
    if (files.has(entry)) throw new Error(`duplicate manifest file: ${entry}`);
    files.set(entry, preloaded.has(entry) ? preloaded.get(entry).bytes : readSourceFile(sourceRoot, entry).bytes);
    return;
  }
  if (!stat.isDirectory() || fs.realpathSync(absolute) !== absolute) throw new Error(`unsafe source entry: ${entry}`);

  const before = { ...directoryIdentity(stat), mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
  const names = fs.readdirSync(absolute).sort();
  const after = fs.lstatSync(absolute);
  const afterIdentity = { ...directoryIdentity(after), mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs };
  if (after.isSymbolicLink() || !after.isDirectory() || !identitiesEqual(before, afterIdentity) || fs.realpathSync(absolute) !== absolute) {
    throw new Error(`source changed during read: ${entry}`);
  }
  for (const name of names) collectSourceEntry(sourceRoot, `${entry}/${name}`, files, preloaded);
}

function loadSourcePlan(sourceRoot) {
  const manifestLoaded = readSourceFile(sourceRoot, "sync-manifest.json");
  const versionLoaded = readSourceFile(sourceRoot, "version.json");
  const manifestBytes = manifestLoaded.bytes;
  const versionBytes = versionLoaded.bytes;
  let manifest;
  let version;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error("invalid sync manifest");
  }
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0 ||
    manifest.entries.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("invalid sync manifest");
  }
  const entries = manifest.entries.map(assertSafeEntry);
  if (new Set(entries).size !== entries.length) throw new Error("invalid sync manifest: duplicate entries");
  if (entries.some((entry) => entry === ".ui-source.json" || entry.startsWith(".ui-source.json/"))) {
    throw new Error("invalid sync manifest: .ui-source.json is reserved");
  }
  try {
    version = JSON.parse(versionBytes.toString("utf8"));
  } catch (error) {
    throw new Error("invalid UI version");
  }
  if (!version || typeof version.version !== "string" || !/^ui-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version.version)) {
    throw new Error("invalid UI version");
  }

  const files = new Map();
  const preloaded = new Map([["version.json", versionLoaded]]);
  for (const entry of entries) collectSourceEntry(sourceRoot, entry, files, preloaded);
  const sortedFiles = new Map([...files.entries()].sort(([left], [right]) => compareStrings(left, right)));
  const verificationFiles = new Map([
    ["sync-manifest.json", manifestBytes],
    ["version.json", versionBytes],
    ...sortedFiles,
  ]);
  return { files: sortedFiles, verificationFiles, version: version.version };
}

function verifySourceAtCommit(sourceState, sourcePlan) {
  for (const [relative, bytes] of sourcePlan.verificationFiles) {
    let committed;
    try {
      committed = execFileSync(
        "git",
        ["-C", sourceState.topLevel, "show", `${sourceState.sha}:product-ui/${relative}`],
        { encoding: null, env: GIT_READ_ENV, maxBuffer: 64 * 1024 * 1024 },
      );
    } catch (error) {
      throw new Error(`source file is not tracked at verified commit: ${relative}`);
    }
    if (!committed.equals(bytes)) throw new Error(`source file does not match verified commit: ${relative}`);
  }
}

function secureRemote(remote, repository, label) {
  const value = String(remote || "").trim();
  const allowed = new Set([
    `https://github.com/${repository}`,
    `https://github.com/${repository}.git`,
    `git@github.com:${repository}`,
    `git@github.com:${repository}.git`,
    `ssh://git@github.com/${repository}`,
    `ssh://git@github.com/${repository}.git`,
  ]);
  if (!allowed.has(value)) throw new Error(`wrong ${label} remote`);
  return repository;
}

function validTargetBranch(branch) {
  const value = String(branch || "");
  const tail = value.slice(3);
  return value.startsWith("ui/") && tail.length > 0 && /^[A-Za-z0-9._/-]+$/.test(tail) && !tail.includes("//") && !tail.includes("..") && !tail.endsWith("/");
}

function canonicalExistingPath(value, label) {
  try {
    return fs.realpathSync(String(value || ""));
  } catch (error) {
    throw new Error(`invalid ${label}`);
  }
}

function validateInspection(state, sourceInput, sourceRoot, targetInput, targetRepo) {
  if (!state || !state.source || !state.target) throw new Error("invalid repository inspection");
  const sourceTop = canonicalExistingPath(state.source.topLevel, "source top-level");
  const expectedSourceRoot = path.join(sourceTop, "product-ui");
  if (
    sourceTop !== path.dirname(sourceRoot) ||
    sourceRoot !== expectedSourceRoot ||
    path.resolve(sourceInput) !== expectedSourceRoot
  ) {
    throw new Error("source top-level mismatch");
  }
  assertCanonicalDirectory(sourceTop, "source repository");
  assertCanonicalDirectory(sourceRoot, "source root");
  const sourceRepository = secureRemote(state.source.remote, SOURCE_REPOSITORY, "source");
  if (!String(state.source.branch || "").trim() || state.source.branch === "HEAD") throw new Error("source branch is required");
  if (state.source.clean !== true) throw new Error("source working tree must be clean");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(state.source.sha || ""))) throw new Error("invalid source SHA");

  const targetTop = canonicalExistingPath(state.target.topLevel, "target top-level");
  if (targetTop !== targetRepo || path.resolve(targetInput) !== targetRepo) throw new Error("target top-level mismatch");
  assertCanonicalDirectory(targetTop, "target repository");
  const targetRepository = secureRemote(state.target.remote, TARGET_REPOSITORY, "target");
  if (!validTargetBranch(state.target.branch)) throw new Error("target branch must start with ui/");
  if (state.target.clean !== true) throw new Error("target working tree must be clean");
  const targetGitDir = canonicalExistingPath(state.target.gitDir, "target git directory");
  assertCanonicalDirectory(targetGitDir, "target git directory");

  return {
    source: {
      topLevel: sourceTop,
      repository: sourceRepository,
      remote: String(state.source.remote).trim(),
      branch: String(state.source.branch),
      sha: String(state.source.sha),
    },
    target: {
      topLevel: targetTop,
      gitDir: targetGitDir,
      repository: targetRepository,
      remote: String(state.target.remote).trim(),
      branch: String(state.target.branch),
    },
  };
}

function inspectionIdentity(state) {
  return JSON.stringify(state);
}

function gitText(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: GIT_READ_ENV }).trim();
}

function gitOutput(cwd, args, options = {}) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: GIT_READ_ENV,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function parseGitEntries(output, pattern, label) {
  const entries = new Map();
  for (const record of output.split("\0").filter(Boolean)) {
    const match = pattern.exec(record);
    if (!match || entries.has(match[4])) throw new Error(`could not inspect ${label}`);
    entries.set(match[4], { mode: match[1], oid: match[2], stage: match[3] });
  }
  return entries;
}

function hashWorktreeBytes(cwd, relative, bytes, filtered) {
  return gitOutput(cwd, ["hash-object", ...(filtered ? ["--path", relative] : []), "--stdin"], {
    input: bytes,
  }).trim();
}

function gitWorkingTreeClean(cwd, allowedAbsolutePaths = []) {
  const topLevel = gitText(cwd, ["rev-parse", "--show-toplevel"]);
  const fileMode = gitOutput(cwd, ["config", "--type=bool", "--default=true", "core.filemode"]).trim() !== "false";
  const head = parseGitEntries(
    gitOutput(cwd, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]),
    /^([0-7]{6}) (?:blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})()\t([\s\S]*)$/,
    "HEAD tree",
  );
  const index = parseGitEntries(
    gitOutput(cwd, ["ls-files", "--stage", "-z"]),
    /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t([\s\S]*)$/,
    "Git index",
  );
  if (head.size !== index.size) return false;
  for (const [relative, indexed] of index) {
    const committed = head.get(relative);
    if (!committed || indexed.stage !== "0" || committed.mode !== indexed.mode || committed.oid !== indexed.oid) return false;

    const absolute = fromPosix(topLevel, relative);
    const stat = lstatOrNull(absolute);
    if (indexed.mode === "120000") {
      if (!stat || !stat.isSymbolicLink()) return false;
      const linkBytes = Buffer.from(fs.readlinkSync(absolute));
      if (hashWorktreeBytes(cwd, relative, linkBytes, false) !== indexed.oid) return false;
    } else if (indexed.mode === "160000") {
      if (!stat || !stat.isDirectory()) return false;
      try {
        if (gitText(absolute, ["rev-parse", "HEAD"]) !== indexed.oid) return false;
      } catch (error) {
        return false;
      }
    } else {
      if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
      if (fileMode && Boolean(stat.mode & 0o111) !== (indexed.mode === "100755")) return false;
      if (hashWorktreeBytes(cwd, relative, fs.readFileSync(absolute), true) !== indexed.oid) return false;
    }
  }

  const output = gitOutput(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!output) return true;
  const allowed = new Set(allowedAbsolutePaths.map((absolute) => posixRelative(topLevel, absolute)));
  return output.split("\0").filter(Boolean).every((relative) => allowed.has(relative));
}

function defaultInspect(sourceRoot, targetRepo, context = {}) {
  const sourceTop = gitText(sourceRoot, ["rev-parse", "--show-toplevel"]);
  const targetTop = gitText(targetRepo, ["rev-parse", "--show-toplevel"]);
  return {
    source: {
      topLevel: sourceTop,
      remote: gitText(sourceTop, ["remote", "get-url", "origin"]),
      branch: gitText(sourceTop, ["branch", "--show-current"]),
      clean: gitWorkingTreeClean(sourceTop),
      sha: gitText(sourceTop, ["rev-parse", "HEAD"]),
    },
    target: {
      topLevel: targetTop,
      gitDir: gitText(targetTop, ["rev-parse", "--absolute-git-dir"]),
      remote: gitText(targetTop, ["remote", "get-url", "origin"]),
      branch: gitText(targetTop, ["branch", "--show-current"]),
      clean: gitWorkingTreeClean(targetTop, context.allowedTargetPaths || []),
    },
  };
}

function assertSupplementalInspection(expected, actual) {
  if (expected === undefined || expected === null) return;
  if (!expected || typeof expected !== "object") throw new Error("inspectRepo must return expected state or undefined");
  for (const repository of ["source", "target"]) {
    if (expected[repository] === undefined) continue;
    if (!expected[repository] || typeof expected[repository] !== "object") throw new Error(`inspectRepo expectation mismatch: ${repository}`);
    for (const [key, value] of Object.entries(expected[repository])) {
      if (actual[repository][key] !== value) throw new Error(`inspectRepo expectation mismatch: ${repository}.${key}`);
    }
  }
}

function inspectAndValidate(inspectRepo, context, sourceInput, sourceRoot, targetInput, targetRepo) {
  const actual = defaultInspect(sourceRoot, targetRepo, context);
  if (inspectRepo) {
    const expected = inspectRepo(JSON.parse(JSON.stringify(actual)), context);
    assertSupplementalInspection(expected, actual);
  }
  return validateInspection(actual, sourceInput, sourceRoot, targetInput, targetRepo);
}

function targetPublicRoot(targetRepo) {
  const service = path.join(targetRepo, "service");
  const publicRoot = path.join(service, "public");
  assertCanonicalDirectory(service, "target service directory");
  assertCanonicalDirectory(publicRoot, "target public directory");
  if (fs.realpathSync(service) !== service || fs.realpathSync(publicRoot) !== publicRoot) throw new Error("unsafe target public directory");
  return publicRoot;
}

function snapshotTarget(targetRoot, relative) {
  const destination = assertWithin(targetRoot, fromPosix(targetRoot, relative), "target destination");
  const parts = relative.split("/");
  const directories = [];
  let current = targetRoot;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (!stat) {
      directories.push({ absolute: current, exists: false });
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(current) !== current) {
      throw new Error(`unsafe target directory: ${posixRelative(targetRoot, current)}`);
    }
    directories.push({ absolute: current, exists: true, identity: directoryIdentity(stat) });
  }

  const stat = lstatOrNull(destination);
  let final;
  if (!stat) {
    final = { exists: false };
  } else {
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`unsafe target file: ${relative}`);
    if (stat.nlink !== 1) throw new Error(`unsafe target hardlink: ${relative}`);
    const loaded = readStableRegularFile(targetRoot, destination, "target", true);
    final = { exists: true, identity: loaded.identity, bytes: loaded.bytes, mode: stat.mode & 0o777 };
  }
  return { relative, destination, directories, final };
}

function revalidateTarget(snapshot, targetRoot, createdDirectories = new Set()) {
  for (const directory of snapshot.directories) {
    const stat = lstatOrNull(directory.absolute);
    if (directory.exists) {
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || !identitiesEqual(directory.identity, directoryIdentity(stat)) || fs.realpathSync(directory.absolute) !== directory.absolute) {
        throw new Error(`target changed during sync: ${posixRelative(targetRoot, directory.absolute)}`);
      }
    } else if (createdDirectories.has(directory.absolute)) {
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory.absolute) !== directory.absolute) {
        throw new Error(`unsafe target directory: ${posixRelative(targetRoot, directory.absolute)}`);
      }
    } else if (stat) {
      throw new Error(`target changed during sync: ${posixRelative(targetRoot, directory.absolute)}`);
    }
  }

  const stat = lstatOrNull(snapshot.destination);
  if (!snapshot.final.exists) {
    if (stat) throw new Error(`target changed during sync: ${snapshot.relative}`);
    return;
  }
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !identitiesEqual(snapshot.final.identity, fileIdentity(stat))) {
    throw new Error(`target changed during sync: ${snapshot.relative}`);
  }
  const loaded = readStableRegularFile(targetRoot, snapshot.destination, "target", true);
  if (!loaded.bytes.equals(snapshot.final.bytes)) throw new Error(`target changed during sync: ${snapshot.relative}`);
}

function validIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function freshIsoTimestamp(previous) {
  const now = new Date();
  if (validIsoTimestamp(previous) && now.toISOString() === previous) now.setTime(now.getTime() + 1);
  return now.toISOString();
}

function arraysEqual(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseProvenance(snapshot) {
  if (!snapshot.final.exists) return null;
  try {
    return JSON.parse(snapshot.final.bytes.toString("utf8"));
  } catch (error) {
    return null;
  }
}

function validManagedFiles(value) {
  if (!Array.isArray(value) || value.some((relative) => typeof relative !== "string")) return false;
  try {
    value.forEach(assertSafeEntry);
  } catch (error) {
    return false;
  }
  return new Set(value).size === value.length && !value.includes(".ui-source.json");
}

function randomSibling(destination, kind) {
  const name = `.ui-sync-${kind}-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
  return path.join(path.dirname(destination), name);
}

function createExclusiveFile(destination, bytes, mode, kind = "tmp") {
  let temporary;
  let descriptor;
  let createdNode;
  for (let attempts = 0; attempts < 10; attempts += 1) {
    temporary = randomSibling(destination, kind);
    try {
      descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, mode);
      const opened = fs.fstatSync(descriptor);
      createdNode = { dev: opened.dev, ino: opened.ino };
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  if (descriptor === undefined) throw new Error("could not allocate sync temporary file");
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
  } catch (error) {
    fs.closeSync(descriptor);
    try {
      const stat = lstatOrNull(temporary);
      if (stat && !stat.isSymbolicLink() && stat.dev === createdNode.dev && stat.ino === createdNode.ino && stat.nlink === 1) fs.unlinkSync(temporary);
    } catch (cleanupError) {}
    throw error;
  }
  fs.closeSync(descriptor);
  const stat = fs.lstatSync(temporary);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    try {
      if (!stat.isSymbolicLink() && stat.dev === createdNode.dev && stat.ino === createdNode.ino) fs.unlinkSync(temporary);
    } catch (cleanupError) {}
    throw new Error("unsafe sync temporary file");
  }
  return { path: temporary, identity: fileIdentity(stat) };
}

function acquireLock(gitDir) {
  const lockPath = path.join(gitDir, LOCK_NAME);
  let descriptor;
  let created = false;
  let createdNode;
  try {
    descriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    created = true;
    const opened = fs.fstatSync(descriptor);
    createdNode = { dev: opened.dev, ino: opened.ino };
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    fs.fsyncSync(descriptor);
    const identity = fileIdentity(fs.fstatSync(descriptor));
    fs.closeSync(descriptor);
    return { path: lockPath, identity };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (created) {
      try {
        const stat = lstatOrNull(lockPath);
        if (stat && !stat.isSymbolicLink() && stat.isFile() && stat.dev === createdNode.dev && stat.ino === createdNode.ino && stat.nlink === 1) fs.unlinkSync(lockPath);
      } catch (cleanupError) {}
    }
    if (error.code === "EEXIST") throw new Error("UI sync lock is already held");
    throw error;
  }
}

function releaseLock(lock) {
  if (!lock) return;
  const stat = lstatOrNull(lock.path);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile() || !identitiesEqual(lock.identity, fileIdentity(stat))) {
    throw new Error("sync lock changed unexpectedly");
  }
  fs.unlinkSync(lock.path);
}

function createMissingDirectories(outputs, targetRoot, created) {
  const missing = new Set();
  for (const output of outputs) {
    for (const directory of output.snapshot.directories) if (!directory.exists) missing.add(directory.absolute);
  }
  const ordered = [...missing].sort((left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right));
  for (const directory of ordered) {
    const parent = path.dirname(directory);
    const parentStat = fs.lstatSync(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || fs.realpathSync(parent) !== parent) throw new Error(`unsafe target directory: ${posixRelative(targetRoot, parent)}`);
    if (lstatOrNull(directory)) throw new Error(`target changed during sync: ${posixRelative(targetRoot, directory)}`);
    fs.mkdirSync(directory, { mode: 0o755 });
    created.push(directory);
    assertCanonicalDirectory(directory, "target directory");
  }
}

function verifyInstalled(output, targetRoot) {
  const stat = fs.lstatSync(output.snapshot.destination);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new Error(`unsafe installed target: ${output.snapshot.relative}`);
  const loaded = readStableRegularFile(targetRoot, output.snapshot.destination, "target", true);
  if (!loaded.bytes.equals(output.bytes)) throw new Error(`installed target verification failed: ${output.snapshot.relative}`);
  return loaded.identity;
}

function safeUnlinkInstalled(record, targetRoot) {
  const stat = lstatOrNull(record.output.snapshot.destination);
  if (!stat) return;
  if (!record.installedIdentity || !identitiesEqual(record.installedIdentity, installedIdentity(stat))) {
    throw new Error(`cannot safely roll back changed target: ${record.output.snapshot.relative}`);
  }
  const loaded = readStableRegularFile(targetRoot, record.output.snapshot.destination, "installed target", true);
  if (!loaded.bytes.equals(record.output.bytes)) throw new Error(`cannot safely roll back changed target: ${record.output.snapshot.relative}`);
  fs.unlinkSync(record.output.snapshot.destination);
}

function restoreRecord(record, targetRoot) {
  const original = record.output.snapshot.final;
  if (!original.exists) {
    safeUnlinkInstalled(record, targetRoot);
    return;
  }
  const backupStat = record.backup ? lstatOrNull(record.backup) : null;
  if (backupStat) {
    if (backupStat.isSymbolicLink() || !backupStat.isFile() || backupStat.nlink !== 1) throw new Error("unsafe transaction backup");
    const backup = readStableRegularFile(targetRoot, record.backup, "transaction backup", true);
    if (backup.identity.dev !== original.identity.dev || backup.identity.ino !== original.identity.ino || !backup.bytes.equals(original.bytes)) {
      throw new Error("transaction backup changed unexpectedly");
    }
    safeUnlinkInstalled(record, targetRoot);
    const beforeRestore = fs.lstatSync(record.backup);
    if (beforeRestore.dev !== backup.identity.dev || beforeRestore.ino !== backup.identity.ino || beforeRestore.nlink !== 1) {
      throw new Error("transaction backup changed unexpectedly");
    }
    fs.renameSync(record.backup, record.output.snapshot.destination);
    record.backup = null;
    return;
  }
  safeUnlinkInstalled(record, targetRoot);
  const restored = createExclusiveFile(record.output.snapshot.destination, original.bytes, original.mode || 0o644, "restore");
  fs.renameSync(restored.path, record.output.snapshot.destination);
}

function rollbackTransaction(records, staged, createdDirectories, targetRoot) {
  const failures = [];
  for (const record of [...records].reverse()) {
    try { restoreRecord(record, targetRoot); } catch (error) { failures.push(error.message); }
  }
  for (const stage of staged) {
    if (!stage.path) continue;
    try {
      const stat = lstatOrNull(stage.path);
      if (stat && identitiesEqual(stage.identity, fileIdentity(stat))) fs.unlinkSync(stage.path);
    } catch (error) { failures.push(error.message); }
  }
  for (const directory of [...createdDirectories].reverse()) {
    try { fs.rmdirSync(directory); } catch (error) { failures.push(error.message); }
  }
  if (failures.length) throw new Error(`transaction rollback failed: ${failures.join("; ")}`);
}

function runWriteTransaction({ outputs, allSnapshots, targetRoot, inspectState, inspectRepo, sourceInput, sourceRoot, targetInput, targetRepo }) {
  let lock;
  let createdDirectories = [];
  const staged = [];
  const records = [];
  try {
    lock = acquireLock(inspectState.target.gitDir);
    const afterLock = inspectAndValidate(inspectRepo, { phase: "after-lock", allowedTargetPaths: [] }, sourceInput, sourceRoot, targetInput, targetRepo);
    if (inspectionIdentity(afterLock) !== inspectionIdentity(inspectState)) throw new Error("repository state changed during sync");
    for (const snapshot of allSnapshots) revalidateTarget(snapshot, targetRoot);

    createMissingDirectories(outputs, targetRoot, createdDirectories);
    const createdSet = new Set(createdDirectories);
    for (const output of outputs) {
      const mode = output.snapshot.final.exists ? output.snapshot.final.mode : 0o644;
      const stage = createExclusiveFile(output.snapshot.destination, output.bytes, mode);
      output.stage = stage;
      staged.push(stage);
    }

    const beforeCommit = inspectAndValidate(
      inspectRepo,
      { phase: "before-commit", allowedTargetPaths: staged.map((stage) => stage.path) },
      sourceInput,
      sourceRoot,
      targetInput,
      targetRepo,
    );
    if (inspectionIdentity(beforeCommit) !== inspectionIdentity(inspectState)) throw new Error("repository state changed during sync");
    for (const snapshot of allSnapshots) revalidateTarget(snapshot, targetRoot, createdSet);

    for (const output of outputs) {
      revalidateTarget(output.snapshot, targetRoot, createdSet);
      const record = { output, backup: null, installedIdentity: null };
      records.push(record);
      if (output.snapshot.final.exists) {
        record.backup = randomSibling(output.snapshot.destination, "backup");
        if (lstatOrNull(record.backup)) throw new Error("transaction backup collision");
        fs.renameSync(output.snapshot.destination, record.backup);
      }
      record.installedIdentity = installedIdentity(output.stage.identity);
      fs.renameSync(output.stage.path, output.snapshot.destination);
      output.stage.path = null;
      verifyInstalled(output, targetRoot);
    }

    for (const record of records) {
      if (!record.backup) continue;
      const stat = fs.lstatSync(record.backup);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new Error("unsafe transaction backup");
      const backup = readStableRegularFile(targetRoot, record.backup, "transaction backup", true);
      if (backup.identity.dev !== record.output.snapshot.final.identity.dev || backup.identity.ino !== record.output.snapshot.final.identity.ino || !backup.bytes.equals(record.output.snapshot.final.bytes)) {
        throw new Error("transaction backup changed unexpectedly");
      }
      fs.unlinkSync(record.backup);
      record.backup = null;
    }
  } catch (error) {
    try {
      rollbackTransaction(records, staged, createdDirectories, targetRoot);
    } catch (rollbackError) {
      throw new Error(`${error.message}; ${rollbackError.message}`);
    }
    throw error;
  } finally {
    releaseLock(lock);
  }
}

function syncProductUi({ sourceRoot, targetRepo, write, inspectRepo }) {
  if (typeof write !== "boolean") throw new Error("write must be a boolean");
  const sourceInput = path.resolve(sourceRoot);
  const targetInput = path.resolve(targetRepo);
  const source = canonicalExistingPath(sourceInput, "source root");
  const target = canonicalExistingPath(targetInput, "target repository");
  const initialState = inspectAndValidate(inspectRepo, { phase: "initial", allowedTargetPaths: [] }, sourceInput, source, targetInput, target);
  const sourcePlan = loadSourcePlan(source);
  verifySourceAtCommit(initialState.source, sourcePlan);
  const targetRoot = targetPublicRoot(target);

  const fileOutputs = [];
  const allSnapshots = [];
  for (const [relative, bytes] of sourcePlan.files) {
    const snapshot = snapshotTarget(targetRoot, relative);
    allSnapshots.push(snapshot);
    if (!snapshot.final.exists || !snapshot.final.bytes.equals(bytes)) fileOutputs.push({ snapshot, bytes });
  }

  const managedFiles = [...sourcePlan.files.keys()];
  const provenanceSnapshot = snapshotTarget(targetRoot, ".ui-source.json");
  allSnapshots.push(provenanceSnapshot);
  const existingProvenance = parseProvenance(provenanceSnapshot);
  if (provenanceSnapshot.final.exists && (
    !existingProvenance ||
    !validManagedFiles(existingProvenance.managedFiles)
  )) {
    throw new Error("existing provenance lacks valid managedFiles; manual migration/review required");
  }
  if (existingProvenance) {
    const removed = existingProvenance.managedFiles.filter((relative) => typeof relative === "string" && !managedFiles.includes(relative));
    if (removed.length) throw new Error(`manifest removed previously managed files (${removed.sort().join(", ")}); manual review required`);
  }
  const expectedProvenance = {
    repository: initialState.source.repository,
    commit: initialState.source.sha,
    version: sourcePlan.version,
    managedFiles,
  };
  const provenanceMatches = Boolean(
    existingProvenance &&
    existingProvenance.repository === expectedProvenance.repository &&
    existingProvenance.commit === expectedProvenance.commit &&
    existingProvenance.version === expectedProvenance.version &&
    arraysEqual(existingProvenance.managedFiles, expectedProvenance.managedFiles) &&
    validIsoTimestamp(existingProvenance.syncedAt)
  );
  const changed = fileOutputs.length > 0 || !provenanceMatches;
  if (!changed || !write) {
    return {
      changed,
      files: managedFiles.length,
      provenance: provenanceMatches ? existingProvenance : expectedProvenance,
    };
  }

  const writtenProvenance = { ...expectedProvenance, syncedAt: freshIsoTimestamp(existingProvenance && existingProvenance.syncedAt) };
  const provenanceOutput = {
    snapshot: provenanceSnapshot,
    bytes: Buffer.from(`${JSON.stringify(writtenProvenance, null, 2)}\n`),
  };
  runWriteTransaction({
    outputs: [...fileOutputs, provenanceOutput],
    allSnapshots,
    targetRoot,
    inspectState: initialState,
    inspectRepo,
    sourceInput,
    sourceRoot: source,
    targetInput,
    targetRepo: target,
  });
  return { changed: true, files: managedFiles.length, provenance: writtenProvenance };
}

function parseArgs(argv) {
  let target;
  let mode;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target") {
      if (target !== undefined) throw new Error("--target may only be provided once");
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--target requires a path");
      target = value;
    } else if (argument === "--check" || argument === "--write") {
      if (mode !== undefined) throw new Error("exactly one of --check or --write is required");
      mode = argument;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (target === undefined) throw new Error("--target is required");
  if (mode === undefined) throw new Error("exactly one of --check or --write is required");
  return { target, write: mode === "--write" };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = syncProductUi({
      sourceRoot: path.resolve(__dirname, "..", "product-ui"),
      targetRepo: path.resolve(args.target),
      write: args.write,
    });
    console.log(`${args.write ? "synced" : "checked"} ${result.files} files; changed=${result.changed}; source=${result.provenance.commit}`);
    if (!args.write && result.changed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { syncProductUi, assertSafeEntry, parseArgs };
