"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validateResponses } = require("../capture-product-fixtures");

const fixtureRoot = path.resolve(__dirname, "..", "..", "product-ui", "fixtures");
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
console.log("Capture response validation passed");
