"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "fixtures");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const required = [
  "manifest.json", "summary.json", "forecast.json", "briefing.json", "documents/index.json",
  "ask/pump-report.json", "ask/not-found.json", "draft/design-and-costing.json",
  "check/pump-risky-draft.json", "check/clean-draft.json"
];
const failures = required.filter((rel) => !fs.existsSync(path.join(root, rel))).map((rel) => `missing ${rel}`);

function collectReferences(value, docs, okf) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, docs, okf));
    return;
  }
  if (typeof value.docId === "string") {
    if (value.docId.startsWith("okf:")) okf.add(value.docId.slice(4));
    else docs.add(value.docId);
  }
  if (typeof value.baseDocId === "string") docs.add(value.baseDocId);
  if (typeof value.okfId === "string") okf.add(value.okfId);
  if (Array.isArray(value.docs)) {
    value.docs.forEach((doc) => {
      if (typeof doc === "string") docs.add(doc);
      else if (doc && typeof doc.id === "string") docs.add(doc.id);
    });
  }
  Object.values(value).forEach((child) => collectReferences(child, docs, okf));
}

if (!failures.length) {
  const manifest = read("manifest.json");
  const summary = read("summary.json");
  const forecast = read("forecast.json");
  const ask = read("ask/pump-report.json");
  const draft = read("draft/design-and-costing.json");
  const check = read("check/pump-risky-draft.json");
  if (manifest.contractVersion !== 1) failures.push("contractVersion must be 1");
  if (manifest.fixtureVersion !== "v2.4") failures.push("fixtureVersion must be v2.4");
  if (manifest.engine.repository !== "creationy/jikmu-memory") failures.push("wrong engine repository");
  if (manifest.engine.commit !== "13e232e") failures.push("wrong engine commit");
  if (summary.docCount !== 19 || summary.stats.nodes !== 193 || summary.stats.edges !== 938) failures.push("unexpected v2.4 summary");
  if (!(forecast.items || []).some((item) => /펌프/.test(item.name))) failures.push("pump forecast missing");
  if (!ask.grounded || !(ask.docs || []).length) failures.push("grounded pump answer missing");
  if (!draft.ok || draft.stageId !== "design-and-costing") failures.push("design draft missing");
  if (!(check.count > 0)) failures.push("risk findings missing");
  const docIds = new Set();
  const okfIds = new Set();
  [forecast, read("briefing.json"), ask, read("ask/not-found.json"), draft, check, read("check/clean-draft.json")]
    .forEach((value) => collectReferences(value, docIds, okfIds));
  for (const id of docIds) {
    const rel = `documents/${encodeURIComponent(id)}.json`;
    if (!fs.existsSync(path.join(root, rel))) failures.push(`missing referenced document ${id}`);
    else if (read(rel).doc?.id !== id) failures.push(`wrong captured document ${id}`);
  }
  for (const id of okfIds) {
    const rel = `okf/${encodeURIComponent(id)}.json`;
    if (!fs.existsSync(path.join(root, rel))) failures.push(`missing referenced OKF ${id}`);
    else if (read(rel).id !== id) failures.push(`wrong captured OKF ${id}`);
  }
}

if (failures.length) {
  console.error("Fixture contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Fixture contract passed");
