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
  if (summary.docCount !== 19 || summary.stats.nodes !== 193 || summary.stats.edges !== 938) failures.push("unexpected v2.4 summary");
  if (!(forecast.items || []).some((item) => /펌프/.test(item.name))) failures.push("pump forecast missing");
  if (!ask.grounded || !(ask.docs || []).length) failures.push("grounded pump answer missing");
  if (!draft.ok || draft.stageId !== "design-and-costing") failures.push("design draft missing");
  if (!(check.count > 0)) failures.push("risk findings missing");
}

if (failures.length) {
  console.error("Fixture contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Fixture contract passed");
