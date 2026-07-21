"use strict";
const fs = require("fs");
const path = require("path");

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf("=");
  return index < 0 ? [arg.replace(/^--/, ""), true] : [arg.slice(2, index), arg.slice(index + 1)];
}));
const baseUrl = String(args["base-url"] || "http://127.0.0.1:8343").replace(/\/$/, "");
const engineCommit = String(args["engine-commit"] || "13e232e");
const outRoot = path.resolve(__dirname, "..", "product-ui", "fixtures");

async function request(apiPath, body) {
  const response = await fetch(baseUrl + apiPath, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  } : undefined);
  if (!response.ok) throw new Error(`${apiPath} returned HTTP ${response.status}`);
  return response.json();
}
function write(rel, value) {
  const file = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function assert(condition, message) {
  if (!condition) throw new Error(`Fixture capture validation failed: ${message}`);
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function validateResponses({ summary, forecast, briefing, documents, askPump, askMissing, draft, riskyCheck, cleanCheck }) {
  assert(object(summary), "summary must be an object");
  assert(summary.versionLabel === "v2.4", "summary versionLabel must be v2.4");
  assert(summary.docCount === 19, "summary docCount must be 19");
  assert(object(summary.stats) && summary.stats.nodes === 193 && summary.stats.edges === 938, "summary graph must be 193 nodes and 938 edges");
  assert(object(forecast) && Array.isArray(forecast.items) && Array.isArray(forecast.recurrences), "forecast items and recurrences must be arrays");
  assert(forecast.items.some((item) => object(item) && /펌프/.test(item.name)), "forecast must include pump item");
  assert(object(briefing) && Array.isArray(briefing.stages) && Array.isArray(briefing.cautions), "briefing stages and cautions must be arrays");
  assert(object(briefing.generatedFrom) && briefing.generatedFrom.docs === 19 && briefing.generatedFrom.edges === 938 && briefing.generatedFrom.version === 24, "briefing must match v2.4 baseline");
  assert(Array.isArray(documents) && documents.length === 19 && documents.every((doc) => object(doc) && typeof doc.id === "string"), "documents must be 19 identified entries");
  assert(object(askPump) && askPump.grounded === true && Array.isArray(askPump.answer) && Array.isArray(askPump.knowledge) && Array.isArray(askPump.docs) && askPump.docs.length > 0 && Array.isArray(askPump.forecast), "pump answer has unexpected shape");
  assert(object(askMissing) && askMissing.grounded === false && Array.isArray(askMissing.answer) && Array.isArray(askMissing.knowledge) && Array.isArray(askMissing.docs) && Array.isArray(askMissing.forecast), "not-found answer has unexpected shape");
  assert(object(draft) && draft.ok === true && draft.stageId === "design-and-costing" && Array.isArray(draft.sections) && Array.isArray(draft.checklist), "draft has unexpected shape");
  assert(object(riskyCheck) && typeof riskyCheck.count === "number" && riskyCheck.count > 0 && Array.isArray(riskyCheck.findings) && riskyCheck.findings.length === riskyCheck.count, "risky check has unexpected shape");
  assert(object(cleanCheck) && cleanCheck.count === 0 && Array.isArray(cleanCheck.findings) && cleanCheck.findings.length === 0, "clean check has unexpected shape");
}
function collectEvidenceIds(value, docs, okf) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectEvidenceIds(item, docs, okf));
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
  Object.values(value).forEach((child) => {
    collectEvidenceIds(child, docs, okf);
  });
}

(async () => {
  const summary = await request("/api/summary");
  const forecast = await request("/api/forecast");
  const briefing = await request("/api/briefing");
  const documents = await request("/api/documents");
  const askPump = await request("/api/ask", { question: "작년 펌프 정비 추진 보고 찾아줘" });
  const askMissing = await request("/api/ask", { question: "점심 뭐 먹지?" });
  const draft = await request("/api/draft", { task: "design-and-costing" });
  const riskyText = "작년 내역을 그대로 준용하고 특정 모델로 지정한다. 산출근거 없이 구두 지시로 먼저 시공하고 검수 전 대금을 지급한다.";
  const riskyCheck = await request("/api/check", { text: riskyText });
  const cleanCheck = await request("/api/check", { text: "올해 산출근거와 동등 이상 판단 기준을 첨부하고 검수 완료 후 지급한다." });
  validateResponses({ summary, forecast, briefing, documents, askPump, askMissing, draft, riskyCheck, cleanCheck });

  const docIds = new Set();
  const okfIds = new Set();
  [forecast, briefing, askPump, askMissing, draft, riskyCheck, cleanCheck].forEach((value) => collectEvidenceIds(value, docIds, okfIds));
  for (const id of docIds) {
    assert(documents.some((doc) => doc.id === id), `referenced document ${id} is absent from /api/documents`);
  }
  const documentFixtures = new Map();
  for (const id of docIds) {
    const fixture = await request(`/api/documents/${encodeURIComponent(id)}`);
    assert(object(fixture) && object(fixture.doc) && fixture.doc.id === id && Array.isArray(fixture.edges), `document ${id} has unexpected shape`);
    documentFixtures.set(id, fixture);
  }
  const okfFixtures = new Map();
  for (const id of okfIds) {
    const fixture = await request(`/api/okf/${encodeURIComponent(id)}`);
    assert(object(fixture) && fixture.id === id, `OKF ${id} has unexpected shape`);
    okfFixtures.set(id, fixture);
  }
  write("summary.json", summary);
  write("forecast.json", forecast);
  write("briefing.json", briefing);
  write("documents/index.json", documents);
  write("ask/pump-report.json", askPump);
  write("ask/not-found.json", askMissing);
  write("draft/design-and-costing.json", draft);
  write("check/pump-risky-draft.json", riskyCheck);
  write("check/clean-draft.json", cleanCheck);
  for (const [id, fixture] of documentFixtures) write(`documents/${encodeURIComponent(id)}.json`, fixture);
  for (const [id, fixture] of okfFixtures) write(`okf/${encodeURIComponent(id)}.json`, fixture);
  write("manifest.json", {
    contractVersion: 1,
    fixtureVersion: summary.versionLabel,
    generatedAt: new Date().toISOString(),
    engine: { repository: "creationy/jikmu-memory", commit: engineCommit },
    stats: { docCount: summary.docCount, nodes: summary.stats.nodes, edges: summary.stats.edges },
    scenarios: { primary: "pump-maintenance", simDate: summary.simDate }
  });
  console.log(`Captured fixtures from ${baseUrl} (${summary.versionLabel}, docs=${summary.docCount})`);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
