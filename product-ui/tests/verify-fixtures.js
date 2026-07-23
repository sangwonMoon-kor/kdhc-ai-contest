"use strict";
const fs = require("fs");
const path = require("path");
const { fixturePath, normalizeResponse } = require("../api-client.js");
const root = path.resolve(__dirname, "..", "fixtures");
const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const required = [
  "manifest.json", "summary.json", "forecast.json", "briefing.json", "graph.json", "documents/index.json",
  "ask/pump-report.json", "ask/not-found.json", "draft/design-and-costing.json", "draft/problem-recognition.json",
  "check/pump-risky-draft.json", "check/clean-draft.json", "hint/stage.json", "hint/commit.json",
  "ingest/stage.json", "ingest/commit.json", "extract/scanned-pdf.json", "documents/DOC-FIXTURE-001.json"
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
  if (manifest.engine.commit !== "e7dcfb17632560d1e660b2380cc0ccfaab0ac894") failures.push("wrong engine commit");
  const manifestDocumentIndex = Array.isArray(manifest.documentIndex) ? manifest.documentIndex : [];
  const ingestedOverlay = manifestDocumentIndex.find((document) => document && document.id === "DOC-FIXTURE-001");
  if (!ingestedOverlay || ingestedOverlay.access !== "full") {
    failures.push("manifest missing explicit DOC-FIXTURE-001 canonical access overlay");
  }
  if (summary.docCount !== 19 || summary.stats.nodes !== 193 || summary.stats.edges !== 938) failures.push("unexpected v2.4 summary");
  if (!(forecast.items || []).some((item) => /펌프/.test(item.name))) failures.push("pump forecast missing");
  if (!ask.grounded || !(ask.docs || []).length) failures.push("grounded pump answer missing");
  if (!draft.ok || draft.stageId !== "design-and-costing") failures.push("design draft missing");
  if (!(check.count > 0)) failures.push("risk findings missing");
  const documents = read("documents/index.json");
  if (!documents.every((document) => document && ["full", "none"].includes(document.access))) {
    failures.push("captured document index contains implicit access");
  }
  if (new Set(documents.map((document) => document.id)).size !== documents.length) {
    failures.push("captured document index contains duplicate IDs");
  }
  const routeCases = [
    ["/api/summary", null],
    ["/api/forecast", null],
    ["/api/briefing", null],
    ["/api/graph", null],
    ["/api/documents", null],
    ["/api/documents/APPR-2025-0409", null],
    ["/api/documents/DOC-FIXTURE-001", null],
    ["/api/okf/problem-recognition", null],
    ["/api/ask", { question: "작년 펌프 정비 추진 보고 찾아줘" }],
    ["/api/ask", { question: "점심 뭐 먹지?" }],
    ["/api/check", { text: "구두 지시로 검수 전 지급" }],
    ["/api/check", { text: "최신 기준 반영" }],
    ["/api/hint/stage", { text: "운영부 일정 확인", stageId: "design-and-costing" }],
    ["/api/hint/commit", { triple: {}, text: "운영부 일정 확인" }],
    ["/api/ingest", { text: "순환수 펌프 정비 계획 보고와 산출근거" }],
    ["/api/ingest/commit", { doc: {}, triples: [] }],
    ["/api/extract", { filename: "scan.pdf", mime: "application/pdf", dataB64: "AA==" }]
  ];
  for (const item of forecast.items || []) {
    routeCases.push(["/api/draft", { task: item.stageId }]);
    routeCases.push([`/api/okf/${encodeURIComponent(item.stageId)}`, null]);
  }
  const routedDraftStages = new Set((forecast.items || []).map((item) => item.stageId));
  if (routedDraftStages.size !== (forecast.items || []).length) failures.push("forecast stages must be unique for draft coverage");
  const calledApiPaths = [...appSource.matchAll(/\bapi\("(\/api\/[^"?]*)"/g)].map((match) => match[1]);
  for (const called of new Set(calledApiPaths)) {
    const covered = routeCases.some(([apiPath]) => called.endsWith("/") ? apiPath.startsWith(called) : apiPath === called);
    if (!covered) failures.push(`app API call lacks a fixture contract case: ${called}`);
  }
  for (const [apiPath, body] of routeCases) {
    const rel = fixturePath(apiPath, body);
    if (!rel) { failures.push(`missing fixture route ${apiPath}`); continue; }
    if (!fs.existsSync(path.join(root, rel))) { failures.push(`missing routed fixture ${rel}`); continue; }
    try { normalizeResponse(apiPath, read(rel)); }
    catch (error) { failures.push(`${rel}: ${error.message}`); }
  }
  const docIds = new Set();
  const okfIds = new Set();
  [forecast, read("briefing.json"), ask, read("ask/not-found.json"), draft, check, read("check/clean-draft.json")]
    .forEach((value) => collectReferences(value, docIds, okfIds));
  for (const id of docIds) {
    const rel = `documents/${encodeURIComponent(id)}.json`;
    if (!fs.existsSync(path.join(root, rel))) failures.push(`missing referenced document ${id}`);
    else if (read(rel).doc?.id !== id) failures.push(`wrong captured document ${id}`);
    else try { normalizeResponse(`/api/documents/${encodeURIComponent(id)}`, read(rel)); }
      catch (error) { failures.push(`${rel}: ${error.message}`); }
  }
  for (const id of okfIds) {
    const rel = `okf/${encodeURIComponent(id)}.json`;
    if (!fs.existsSync(path.join(root, rel))) failures.push(`missing referenced OKF ${id}`);
    else if (read(rel).id !== id) failures.push(`wrong captured OKF ${id}`);
    else try { normalizeResponse(`/api/okf/${encodeURIComponent(id)}`, read(rel)); }
      catch (error) { failures.push(`${rel}: ${error.message}`); }
  }
}

if (failures.length) {
  console.error("Fixture contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Fixture contract passed");
