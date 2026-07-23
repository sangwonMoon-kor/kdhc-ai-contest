"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  validateResponses,
  parseCliArgs,
  buildManifest,
  normalizeCapturedDocumentIndex
} = require("../capture-product-fixtures");

const fixtureRoot = path.resolve(__dirname, "..", "..", "product-ui", "fixtures");
const captureScript = path.resolve(__dirname, "..", "capture-product-fixtures.js");
const engineCommit = "e7dcfb17632560d1e660b2380cc0ccfaab0ac894";
const generatedAt = "2026-07-21T15:26:11.445Z";
const read = (rel) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, rel), "utf8"));
const payloads = () => ({
  summary: read("summary.json"),
  forecast: read("forecast.json"),
  briefing: read("briefing.json"),
  graph: read("graph.json"),
  documents: read("documents/index.json"),
  askPump: read("ask/pump-report.json"),
  askMissing: read("ask/not-found.json"),
  drafts: {
    "design-and-costing": read("draft/design-and-costing.json"),
    "problem-recognition": read("draft/problem-recognition.json")
  },
  riskyCheck: read("check/pump-risky-draft.json"),
  cleanCheck: read("check/clean-draft.json"),
  hintStage: read("hint/stage.json"),
  hintCommit: read("hint/commit.json"),
  ingestStage: read("ingest/stage.json"),
  ingestCommit: read("ingest/commit.json"),
  extract: read("extract/scanned-pdf.json")
});

assert.doesNotThrow(() => validateResponses(payloads()));
assert.throws(() => validateResponses({ ...payloads(), forecast: { simDate: "2026-01-02", items: [{ name: "순환수 펌프" }], recurrences: [] } }));
assert.throws(() => validateResponses({ ...payloads(), briefing: { generatedFrom: { docs: 19, edges: 938, version: 24 }, stages: [], cautions: [] } }));
assert.throws(() => validateResponses({ ...payloads(), graph: { nodes: [], edges: [] } }));
assert.throws(() => validateResponses({ ...payloads(), drafts: { "design-and-costing": read("draft/design-and-costing.json") } }));
const missingAccessPayload = payloads();
missingAccessPayload.documents = missingAccessPayload.documents.map((document, index) => {
  const copy = { ...document };
  if (index === 0) delete copy.access;
  return copy;
});
assert.throws(
  () => validateResponses(missingAccessPayload),
  /documents\[0\]\.access/,
  "capture validation accepted an implicit document access value"
);
for (const access of [null, "restricted"]) {
  const invalidAccessPayload = payloads();
  invalidAccessPayload.documents = invalidAccessPayload.documents.map((document, index) =>
    index === 0 ? { ...document, access } : document);
  assert.throws(
    () => validateResponses(invalidAccessPayload),
    /documents\[0\]\.access/,
    `capture validation accepted explicit invalid access: ${String(access)}`
  );
}

const normalizedCapturedDocuments = normalizeCapturedDocumentIndex([
  { id: "LEGACY-CAPTURED", title: "Legacy captured document" },
  { id: "FULL-CAPTURED", title: "Full captured document", access: "full" },
  { id: "DENIED-CAPTURED", title: "Denied captured document", access: "none" },
  { id: "NULL-CAPTURED", title: "Null captured document", access: null },
  { id: "RESTRICTED-CAPTURED", title: "Restricted captured document", access: "restricted" }
]);
assert.deepEqual(
  normalizedCapturedDocuments.map((document) => [document.id, document.access]),
  [
    ["LEGACY-CAPTURED", "full"],
    ["FULL-CAPTURED", "full"],
    ["DENIED-CAPTURED", "none"],
    ["NULL-CAPTURED", "none"],
    ["RESTRICTED-CAPTURED", "none"]
  ],
  "capture boundary trusted an explicit unknown access value"
);
const duplicateCapturedDocuments = normalizeCapturedDocumentIndex([
  { id: "CAPTURE-DUPLICATE", title: "Allowed duplicate", access: "full" },
  { id: "CAPTURE-DUPLICATE", title: "Denied duplicate", access: "none" },
  { id: "CAPTURE-SAME", title: "Same first", access: "full" },
  { id: "CAPTURE-SAME", title: "Same second", access: "full" }
]);
assert.deepEqual(
  duplicateCapturedDocuments.map((document) => [document.id, document.access]),
  [["CAPTURE-DUPLICATE", "none"], ["CAPTURE-SAME", "full"]],
  "capture boundary emitted duplicate IDs or allowed a conflicting duplicate"
);

assert.deepEqual(parseCliArgs([
  "--base-url=http://127.0.0.1:8343",
  `--engine-commit=${engineCommit}`,
  `--generated-at=${generatedAt}`
]), { baseUrl: "http://127.0.0.1:8343", engineCommit, generatedAt });
assert.throws(() => parseCliArgs([`--generated-at=${generatedAt}`]), /--engine-commit/);
assert.throws(() => parseCliArgs(["--engine-commit=13e232e", `--generated-at=${generatedAt}`]), /40.*hex|40.*16진/i);
assert.throws(() => parseCliArgs([`--engine-commit=${engineCommit}`]), /--generated-at/);
assert.throws(() => parseCliArgs([`--engine-commit=${engineCommit}`, "--generated-at=yesterday"]), /ISO/i);

const summary = payloads().summary;
const documentIndex = [{
  id: "DOC-FIXTURE-001",
  access: "full",
  kind: "전자결재",
  title: "2026년 순환수 펌프 정비 계획 보고"
}];
const firstBytes = Buffer.from(JSON.stringify(buildManifest(summary, { engineCommit, generatedAt, documentIndex }), null, 2) + "\n");
const secondBytes = Buffer.from(JSON.stringify(buildManifest(summary, { engineCommit, generatedAt, documentIndex }), null, 2) + "\n");
assert(firstBytes.equals(secondBytes), "identical capture inputs must produce byte-identical manifests");
assert.equal(JSON.parse(firstBytes).engine.commit, engineCommit);
assert.equal(JSON.parse(firstBytes).generatedAt, generatedAt);
assert.deepEqual(JSON.parse(firstBytes).documentIndex, documentIndex,
  "capture manifest omitted the explicit ingested-document canonical overlay");

function assertCliFailure(args, pattern) {
  const result = spawnSync(process.execPath, [captureScript, ...args], { encoding: "utf8" });
  assert.notEqual(result.status, 0, `capture CLI unexpectedly accepted: ${args.join(" ")}`);
  assert.match(result.stderr, pattern);
}
assertCliFailure([], /--engine-commit/);
assertCliFailure(["--engine-commit=13e232e", `--generated-at=${generatedAt}`], /40-character hexadecimal/);
assertCliFailure([`--engine-commit=${engineCommit}`], /--generated-at/);
assertCliFailure([`--engine-commit=${engineCommit}`, "--generated-at=yesterday"], /ISO/);

console.log("Capture response, CLI, and reproducibility validation passed");
