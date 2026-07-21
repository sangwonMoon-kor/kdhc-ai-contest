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
function string(value) {
  return typeof value === "string" && value.length > 0;
}
function collection(value, length, message, validateItem) {
  assert(Array.isArray(value) && value.length === length, `${message} must contain ${length} items`);
  value.forEach((item, index) => validateItem(item, `${message}[${index}]`));
}
function fields(value, message, required) {
  assert(object(value), `${message} must be an object`);
  Object.entries(required).forEach(([key, predicate]) => assert(predicate(value[key]), `${message}.${key} has an unexpected type`));
}
function validateResponses({ summary, forecast, briefing, graph, documents, askPump, askMissing, drafts, riskyCheck, cleanCheck, hintStage, hintCommit, ingestStage, ingestCommit, extract }) {
  assert(object(summary), "summary must be an object");
  assert(summary.version === 24 && summary.versionLabel === "v2.4", "summary must be v2.4");
  assert(summary.docCount === 19 && string(summary.simDate), "summary docCount must be 19 with a simulation date");
  assert(object(summary.stats) && summary.stats.nodes === 193 && summary.stats.edges === 938, "summary graph must be 193 nodes and 938 edges");
  fields(forecast, "forecast", { simDate: string });
  collection(forecast.items, 2, "forecast.items", (item, message) => fields(item, message, {
    name: string, task: string, stageId: string, month: Number.isInteger, lastDate: string, dueDate: string,
    dday: Number.isInteger, docCount: Number.isInteger, docs: (value) => Array.isArray(value) && value.length > 0 && value.every(string)
  }));
  assert(forecast.items.some((item) => /펌프/.test(item.name)), "forecast must include pump item");
  collection(forecast.recurrences, 4, "forecast.recurrences", (item, message) => fields(item, message, {
    stageId: string, task: string, month: Number.isInteger, years: (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isInteger),
    day: Number.isInteger, title: string, docs: (value) => Array.isArray(value) && value.length === 2 && value.every(string), lastDate: string
  }));
  fields(briefing, "briefing", { persona: object, generatedFrom: object, knownGap: object });
  assert(object(briefing.generatedFrom) && briefing.generatedFrom.docs === 19 && briefing.generatedFrom.edges === 938 && briefing.generatedFrom.version === 24, "briefing must match v2.4 baseline");
  fields(briefing.persona, "briefing.persona", { name: string, assignedDate: string, department: string, role: string });
  collection(briefing.stages, 11, "briefing.stages", (item, message) => fields(item, message, { id: string, name: string, desc: string, docCount: Number.isInteger, contextCount: Number.isInteger }));
  collection(briefing.cautions, 18, "briefing.cautions", (item, message) => fields(item, message, {
    rel: string, text: string, status: string, confidence: (value) => typeof value === "number", confirmed: (value) => typeof value === "boolean",
    relation: string, risks: (value) => Array.isArray(value) && value.length > 0 && value.every(string), evidence: (value) => Array.isArray(value) && value.length > 0 && value.every((entry) => object(entry) && string(entry.docId) && string(entry.label)), okfId: string
  }));
  collection(briefing.contacts, 6, "briefing.contacts", (item, message) => fields(item, message, { name: string, score: (value) => typeof value === "number" }));
  collection(briefing.issues, 5, "briefing.issues", (item, message) => fields(item, message, { date: string, title: string, kind: string, docId: string }));
  collection(briefing.cases, 8, "briefing.cases", (item, message) => fields(item, message, { label: string, okfId: string, desc: string }));
  collection(briefing.calendar, 12, "briefing.calendar", (item, message) => fields(item, message, { month: Number.isInteger, labels: (value) => Array.isArray(value) && value.every((label) => object(label) && string(label.title) && string(label.task) && string(label.stageId)) }));
  fields(briefing.knownGap, "briefing.knownGap", { text: string, status: string });
  fields(graph, "graph", { nodes: Array.isArray, edges: Array.isArray });
  assert(graph.nodes.length === 193 && graph.edges.length === 938, "graph must match the captured 193-node/938-edge baseline");
  graph.nodes.forEach((node, index) => fields(node, `graph.nodes[${index}]`, { key: string, type: string, name: string }));
  graph.edges.forEach((edge, index) => fields(edge, `graph.edges[${index}]`, { from: string, to: string, rel: string }));
  collection(documents, 19, "documents", (doc, message) => fields(doc, message, { id: string, kind: string, title: string, date: string, task: (value) => value === null || string(value), author: string }));
  const validateAsk = (value, message, expected) => {
    fields(value, message, { question: string, intent: string, answer: Array.isArray, knowledge: Array.isArray, docs: Array.isArray, forecast: Array.isArray, entities: object, followups: Array.isArray, grounded: (item) => typeof item === "boolean", disclaimer: string });
    assert(value.grounded === expected.grounded, `${message}.grounded has an unexpected value`);
    collection(value.answer, 1, `${message}.answer`, (item, itemMessage) => assert(string(item), `${itemMessage} must be a string`));
    collection(value.knowledge, expected.knowledge, `${message}.knowledge`, (item, itemMessage) => fields(item, itemMessage, { rel: string, fromName: string, toName: string, text: string, status: string, confidence: (entry) => typeof entry === "number", evidence: (entries) => Array.isArray(entries) && entries.length > 0 }));
    collection(value.docs, expected.docs, `${message}.docs`, (item, itemMessage) => fields(item, itemMessage, { id: string, title: string, kind: string, date: string, snippet: string }));
    collection(value.forecast, expected.forecast, `${message}.forecast`, () => {});
    collection(value.followups, expected.followups, `${message}.followups`, (item, itemMessage) => assert(string(item), `${itemMessage} must be a string`));
    ["stages", "actors", "assets", "risks"].forEach((key) => assert(Array.isArray(value.entities[key]), `${message}.entities.${key} must be an array`));
  };
  validateAsk(askPump, "askPump", { grounded: true, knowledge: 3, docs: 3, forecast: 0, followups: 2 });
  validateAsk(askMissing, "askMissing", { grounded: false, knowledge: 0, docs: 0, forecast: 0, followups: 3 });
  const forecastStages = [...new Set(forecast.items.map((item) => item.stageId))].sort();
  assert(object(drafts) && JSON.stringify(Object.keys(drafts).sort()) === JSON.stringify(forecastStages), "draft fixtures must cover every forecast stage exactly");
  for (const stageId of forecastStages) {
    const draft = drafts[stageId];
    fields(draft, `drafts.${stageId}`, { ok: (value) => value === true, task: string, stageId: (value) => value === stageId, baseDocId: string, baseTitle: string, baseDate: string, title: string });
    assert(Array.isArray(draft.sections) && draft.sections.length > 0, `drafts.${stageId}.sections must not be empty`);
    draft.sections.forEach((item, index) => fields(item, `drafts.${stageId}.sections[${index}]`, { h: string, tokens: (value) => Array.isArray(value) && value.length > 0 && value.every((token) => object(token) && (string(token.text) || string(token.ph))) }));
    collection(draft.checklist, 4, `drafts.${stageId}.checklist`, (item, message) => fields(item, message, { text: string }));
  }
  assert(drafts["design-and-costing"].sections.length === 5, "design-and-costing draft must retain five sections");
  fields(riskyCheck, "riskyCheck", { count: (value) => value === 5, findings: Array.isArray });
  collection(riskyCheck.findings, 5, "riskyCheck.findings", (item, message) => fields(item, message, {
    id: string, level: string, cls: string, name: string, desc: string, fix: string, riskName: string,
    matches: (value) => Array.isArray(value) && value.length > 0 && value.every((entry) => object(entry) && Array.isArray(entry.span) && entry.span.length === 2 && entry.span.every(Number.isInteger) && string(entry.text)),
    evidence: (value) => Array.isArray(value) && value.length > 0 && value.every((entry) => object(entry) && string(entry.docId) && string(entry.label))
  }));
  fields(cleanCheck, "cleanCheck", { count: (value) => value === 0, findings: Array.isArray });
  collection(cleanCheck.findings, 0, "cleanCheck.findings", () => {});
  fields(hintStage, "hintStage", { guard: (value) => object(value) && value.flagged === false, triples: (value) => Array.isArray(value) && value.length > 0 });
  hintStage.triples.forEach((triple, index) => fields(triple, `hintStage.triples[${index}]`, { from: object, rel: string, to: object, confidence: (value) => typeof value === "number" }));
  fields(hintCommit, "hintCommit", { ok: (value) => value === true, hint: object });
  fields(hintCommit.hint, "hintCommit.hint", { id: string, text: string, from: object, to: object, rel: string });
  fields(ingestStage, "ingestStage", { doc: object, triples: (value) => Array.isArray(value) && value.length > 0, caseProposal: object });
  assert(ingestStage.doc.id === "DOC-FIXTURE-001", "ingestStage.doc.id must be stable");
  fields(ingestCommit, "ingestCommit", { ok: (value) => value === true, merged: Number.isInteger, doc: object });
  assert(ingestCommit.doc.id === ingestStage.doc.id, "ingest commit must return the staged fixture document");
  fields(extract, "extract", { ok: (value) => value === true, text: string, model: string });
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

async function capture() {
  const summary = await request("/api/summary");
  const forecast = await request("/api/forecast");
  const briefing = await request("/api/briefing");
  const graph = await request("/api/graph");
  const documents = await request("/api/documents");
  const askPump = await request("/api/ask", { question: "작년 펌프 정비 추진 보고 찾아줘" });
  const askMissing = await request("/api/ask", { question: "점심 뭐 먹지?" });
  const drafts = {};
  for (const stageId of [...new Set(forecast.items.map((item) => item.stageId))].sort()) drafts[stageId] = await request("/api/draft", { task: stageId });
  const riskyText = "작년 내역을 그대로 준용하고 특정 모델로 지정한다. 산출근거 없이 구두 지시로 먼저 시공하고 검수 전 대금을 지급한다.";
  const riskyCheck = await request("/api/check", { text: riskyText });
  const cleanCheck = await request("/api/check", { text: "올해 산출근거와 동등 이상 판단 기준을 첨부하고 검수 완료 후 지급한다." });
  const hintText = "운영부 일정은 5월 둘째 주로 확정";
  const hintStage = await request("/api/hint/stage", { text: hintText, stageId: "design-and-costing" });
  const ingestText = "2026년 순환수 펌프 정비 계획 보고\n운영부와 정비 일정을 확인하고 설계내역서 산출근거를 첨부한다.";
  const capturedIngest = await request("/api/ingest", { text: ingestText });
  const dynamicDocId = capturedIngest.doc.id;
  const ingestStage = JSON.parse(JSON.stringify(capturedIngest).split(dynamicDocId).join("DOC-FIXTURE-001"));
  const hintTriple = hintStage.triples[0];
  const hintCommit = {
    ok: true,
    hint: {
      id: "HINT-FIXTURE-001", text: hintText, task: hintTriple.from.name,
      from: hintTriple.from, to: hintTriple.to, rel: hintTriple.rel,
      date: String(summary.simDate).slice(0, 7), status: "작성자확인", createdBy: summary.persona.name
    },
    version: summary.version + 1,
    versionLabel: `v${Math.floor((summary.version + 1) / 10)}.${(summary.version + 1) % 10}`
  };
  const ingestCommit = {
    ok: true, merged: ingestStage.triples.length, case: null, doc: ingestStage.doc,
    version: summary.version + 1,
    versionLabel: `v${Math.floor((summary.version + 1) / 10)}.${(summary.version + 1) % 10}`
  };
  const extract = {
    ok: true,
    text: "시연용 스캔 PDF에서 추출한 고정 텍스트입니다. 원본 파일은 서버나 외부 모델로 전송하지 않습니다.",
    model: "fixture"
  };
  validateResponses({ summary, forecast, briefing, graph, documents, askPump, askMissing, drafts, riskyCheck, cleanCheck, hintStage, hintCommit, ingestStage, ingestCommit, extract });

  const docIds = new Set();
  const okfIds = new Set();
  [forecast, briefing, askPump, askMissing, ...Object.values(drafts), riskyCheck, cleanCheck].forEach((value) => collectEvidenceIds(value, docIds, okfIds));
  forecast.items.forEach((item) => okfIds.add(item.stageId));
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
  write("graph.json", graph);
  write("documents/index.json", documents);
  write("ask/pump-report.json", askPump);
  write("ask/not-found.json", askMissing);
  for (const [stageId, draft] of Object.entries(drafts)) write(`draft/${stageId}.json`, draft);
  write("check/pump-risky-draft.json", riskyCheck);
  write("check/clean-draft.json", cleanCheck);
  write("hint/stage.json", hintStage);
  write("hint/commit.json", hintCommit);
  write("ingest/stage.json", ingestStage);
  write("ingest/commit.json", ingestCommit);
  write("extract/scanned-pdf.json", extract);
  write("documents/DOC-FIXTURE-001.json", { doc: ingestStage.doc, edges: [] });
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
}

if (require.main === module) {
  capture().catch((error) => { console.error(error.stack || error); process.exit(1); });
}

module.exports = { validateResponses, collectEvidenceIds, capture };
