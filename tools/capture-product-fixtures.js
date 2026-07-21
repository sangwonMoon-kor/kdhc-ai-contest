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
function collectEvidenceIds(value, docs, okf) {
  if (!value || typeof value !== "object") return;
  if (typeof value.docId === "string") {
    if (value.docId.startsWith("okf:")) okf.add(value.docId.slice(4));
    else docs.add(value.docId);
  }
  if (typeof value.baseDocId === "string") docs.add(value.baseDocId);
  Object.values(value).forEach((child) => {
    if (Array.isArray(child)) child.forEach((item) => collectEvidenceIds(item, docs, okf));
    else if (child && typeof child === "object") collectEvidenceIds(child, docs, okf);
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

  write("summary.json", summary);
  write("forecast.json", forecast);
  write("briefing.json", briefing);
  write("documents/index.json", documents);
  write("ask/pump-report.json", askPump);
  write("ask/not-found.json", askMissing);
  write("draft/design-and-costing.json", draft);
  write("check/pump-risky-draft.json", riskyCheck);
  write("check/clean-draft.json", cleanCheck);

  const docIds = new Set();
  const okfIds = new Set();
  [briefing, askPump, draft, riskyCheck].forEach((value) => collectEvidenceIds(value, docIds, okfIds));
  for (const id of docIds) {
    const found = documents.some((doc) => doc.id === id);
    if (found) write(`documents/${encodeURIComponent(id)}.json`, await request(`/api/documents/${encodeURIComponent(id)}`));
  }
  for (const id of okfIds) {
    write(`okf/${encodeURIComponent(id)}.json`, await request(`/api/okf/${encodeURIComponent(id)}`));
  }
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
