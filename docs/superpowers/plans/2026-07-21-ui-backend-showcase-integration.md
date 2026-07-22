# UI·UX 정본과 직무 메모리 엔진 쇼케이스 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kdhc-ai-contest`의 `product-ui/`를 UI·UX 정본으로 만들고, fixture와 실제 `jikmu-memory` API를 같은 화면에서 사용한 뒤 안전하게 `jikmu-memory/service/public/`으로 동기화해 하나의 발표용 제품을 만든다.

**Architecture:** `product-ui/api-client.js`가 fixture/live/auto 데이터 모드를 단일 `request(path, body)` 인터페이스로 제공하고, 기존 업무 작업대 SPA는 이 인터페이스만 사용한다. 허용 목록 기반 동기화 도구가 검증된 UI 파일만 팀원 저장소의 `ui/showcase-integration` 브랜치로 복사하며, 백엔드 소스와 두 저장소의 `main`은 건드리지 않는다.

**Tech Stack:** HTML5, CSS, 바닐라 JavaScript(CommonJS+브라우저 UMD), Node.js 내장 모듈, Playwright 1.61.1, 기존 의존성 없는 `jikmu-memory` Node HTTP 엔진

## Global Constraints

- UI·UX 정본은 `sangwonMoon-kor/kdhc-ai-contest/product-ui/`이다.
- 최종 실행 정본은 `creationy/jikmu-memory/service/public/`이다.
- 초기 기술 기준은 `jikmu-memory/main@13e232e`의 `service/public/`이다.
- 두 저장소의 `main`에는 검증과 PR 승인 전까지 직접 푸시하지 않는다.
- UI 구현 브랜치는 `feature/product-ui-source`, 엔진 통합 브랜치는 `ui/showcase-integration`을 사용한다.
- fixture 데이터는 시드 v2.4의 각색된 PoC 샘플만 포함한다.
- `fixture` 모드는 외부 네트워크를 호출하지 않는다.
- `live` 모드는 같은 출처의 `/api/*`만 호출하며 오류를 fixture로 위장하지 않는다.
- `auto` 모드만 최초 API 연결 실패 시 fixture로 복귀한다.
- 브라우저에 LLM 키, KV 토큰, GitHub 토큰 또는 관리자 비밀정보를 넣지 않는다.
- Todo, 진행 기록, 기안 임시 저장은 브라우저 상태로 유지한다.
- UI 샘플 초기화는 서버 `/api/reset`을 호출하지 않는다.
- 동기화 도구는 `sync-manifest.json`의 허용 경로와 `service/public/.ui-source.json`만 수정할 수 있다.
- `jikmu-memory/service/src/`와 `service/server.js`는 이 계획에서 수정하지 않는다.
- 영상 대표 해상도는 1920×1080, 모바일 회귀 폭은 390px이다.
- 기존 `demo/`, `docs/`, `poc/` 발표·프로토타입 자산은 보존한다.
- 코드 행동 변경은 실패 테스트→최소 구현→통과→커밋 순으로 진행한다.

---

### Task 1: 통합 UI 기준선을 개인 저장소에 고정

**Files:**
- Create: `product-ui/index.html`
- Create: `product-ui/style.css`
- Create: `product-ui/app.js`
- Create: `product-ui/intent.js`
- Create: `product-ui/extract.js`
- Create: `product-ui/source-baseline.json`
- Create: `product-ui/tests/verify-source-contract.js`
- Create: `tools/serve-product-ui.js`
- Modify: `package.json`
- Source: `../jikmu-memory/service/public/*`

**Interfaces:**
- Consumes: `jikmu-memory/main@13e232e:service/public/{index.html,style.css,app.js,intent.js,extract.js}`
- Produces: 독립 실행 가능한 `product-ui/` 기준선과 `npm run product-ui:serve`, `npm run test:product-ui:source`

- [ ] **Step 1: 구현 브랜치 생성**

```bash
git switch -c feature/product-ui-source design/ui-backend-integration
```

Expected: current branch is `feature/product-ui-source`; the approved spec and this plan are present.

- [ ] **Step 2: UI 기준선 계약 실패 테스트 작성**

```js
// product-ui/tests/verify-source-contract.js
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const required = ["index.html", "style.css", "app.js", "intent.js", "extract.js", "source-baseline.json"];
const failures = [];

for (const name of required) {
  if (!fs.existsSync(path.join(root, name))) failures.push(`missing ${name}`);
}
if (!failures.length) {
  const index = read("index.html");
  const app = read("app.js");
  const style = read("style.css");
  const baseline = JSON.parse(read("source-baseline.json"));
  if (!index.includes('<main id="view"')) failures.push("missing SPA view root");
  if (!(index.indexOf('src="intent.js"') < index.indexOf('src="app.js"'))) failures.push("intent.js must load before app.js");
  for (const route of ["#home", "#work/list", "#work/calendar", "#workbench/", "#draft/"]) {
    if (!app.includes(route)) failures.push(`missing route ${route}`);
  }
  if (!/function typeIntro\(/.test(app)) failures.push("home type intro missing");
  if (!style.includes("시각 정본: kdhc-ai-contest demo/app.html v4")) failures.push("approved UI provenance missing");
  if (!/main\{width:min\(830px,/.test(style)) failures.push("approved 830px reading width missing");
  if (!style.includes('[data-theme="dark"]')) failures.push("dark mode token set missing");
  if (baseline.repository !== "creationy/jikmu-memory") failures.push("wrong baseline repository");
  if (baseline.commit !== "13e232e") failures.push("wrong baseline commit");
}

if (failures.length) {
  console.error("Product UI source contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Product UI source contract passed");
```

- [ ] **Step 3: 실패 확인**

Run: `node product-ui/tests/verify-source-contract.js`
Expected: FAIL with `missing index.html`.

- [ ] **Step 4: 엔진 UI를 한 번만 기준선으로 복사**

```bash
mkdir -p product-ui/tests
cp ../jikmu-memory/service/public/index.html product-ui/index.html
cp ../jikmu-memory/service/public/style.css product-ui/style.css
cp ../jikmu-memory/service/public/app.js product-ui/app.js
cp ../jikmu-memory/service/public/intent.js product-ui/intent.js
cp ../jikmu-memory/service/public/extract.js product-ui/extract.js
```

Create `product-ui/source-baseline.json`:

```json
{
  "repository": "creationy/jikmu-memory",
  "branch": "main",
  "commit": "13e232e",
  "path": "service/public",
  "seedVersion": "v2.4",
  "capturedAt": "2026-07-21"
}
```

- [ ] **Step 5: 의존성 없는 정적 서버 추가**

```js
// tools/serve-product-ui.js
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "product-ui");
const port = Number(process.env.PRODUCT_UI_PORT || 8410);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4"
};

http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
    res.writeHead(403); return res.end("forbidden");
  }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`product-ui http://127.0.0.1:${port}`);
});
```

- [ ] **Step 6: 개인 저장소 실행·테스트 명령 등록**

Replace `package.json` with:

```json
{
  "name": "kdhc-ai-contest-mockup",
  "private": true,
  "scripts": {
    "test:workbench": "node demo/tests/verify-app-workbench.js",
    "test:workbench:e2e": "node demo/tests/verify-app-workbench-e2e.js",
    "product-ui:serve": "node tools/serve-product-ui.js",
    "test:product-ui:source": "node product-ui/tests/verify-source-contract.js"
  },
  "devDependencies": {
    "playwright": "1.61.1"
  }
}
```

- [ ] **Step 7: 기준선 검증**

Run: `npm run test:product-ui:source`
Expected: `Product UI source contract passed`.

Run: `PRODUCT_UI_PORT=8410 npm run product-ui:serve`
Expected: `product-ui http://127.0.0.1:8410`; opening `http://127.0.0.1:8410/#home` renders the current engine workbench shell.

- [ ] **Step 8: 커밋**

```bash
git add product-ui tools/serve-product-ui.js package.json
git commit -m "제품 UI 정본 기준선 추가"
```

---

### Task 2: 엔진 응답을 버전이 있는 fixture로 캡처

**Files:**
- Create: `tools/capture-product-fixtures.js`
- Create: `product-ui/tests/verify-fixtures.js`
- Create: `product-ui/fixtures/manifest.json`
- Create: `product-ui/fixtures/summary.json`
- Create: `product-ui/fixtures/forecast.json`
- Create: `product-ui/fixtures/briefing.json`
- Create: `product-ui/fixtures/documents/index.json`
- Create: `product-ui/fixtures/documents/*.json`
- Create: `product-ui/fixtures/okf/*.json`
- Create: `product-ui/fixtures/ask/pump-report.json`
- Create: `product-ui/fixtures/ask/not-found.json`
- Create: `product-ui/fixtures/draft/design-and-costing.json`
- Create: `product-ui/fixtures/check/pump-risky-draft.json`
- Create: `product-ui/fixtures/check/clean-draft.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: `http://127.0.0.1:8343/api/*`, engine commit argument `--engine-commit`
- Produces: `contractVersion: 1` fixture pack consumed by `JikmuApi.createApiClient()`

- [ ] **Step 1: fixture 계약 실패 테스트 작성**

```js
// product-ui/tests/verify-fixtures.js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-fixtures.js`
Expected: FAIL with `missing manifest.json`.

- [ ] **Step 3: fixture 캡처 도구 구현**

```js
// tools/capture-product-fixtures.js
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
```

- [ ] **Step 4: 결정론적 엔진으로 fixture 생성**

Terminal A:

```bash
cd /Users/openclaw/projects/jikmu-memory/service
node server.js
```

Expected: `직무 메모리 서비스 → http://localhost:8343  (docs=19, edges=938)`.

Terminal B:

```bash
cd /Users/openclaw/projects/kdhc-ai-contest
node tools/capture-product-fixtures.js --base-url=http://127.0.0.1:8343 --engine-commit=13e232e
```

Expected: `Captured fixtures from http://127.0.0.1:8343 (v2.4, docs=19)`.

- [ ] **Step 5: fixture 명령 등록 및 검증**

Add these scripts to `package.json`:

```json
"fixtures:capture": "node tools/capture-product-fixtures.js",
"test:product-ui:fixtures": "node product-ui/tests/verify-fixtures.js"
```

Run: `npm run test:product-ui:fixtures`
Expected: `Fixture contract passed`.

- [ ] **Step 6: 비밀정보 스캔**

Run:

```bash
rg -n "sk-[A-Za-z0-9_-]{12,}|LLM_API_KEY|KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN|Authorization" product-ui/fixtures
```

Expected: no matches.

- [ ] **Step 7: 커밋**

```bash
git add product-ui/fixtures product-ui/tests/verify-fixtures.js tools/capture-product-fixtures.js package.json
git commit -m "제품 UI용 엔진 fixture 고정"
```

---

### Task 3: fixture/live/auto API 어댑터 구현

**Files:**
- Create: `product-ui/api-client.js`
- Create: `product-ui/tests/verify-api-client.js`
- Modify: `product-ui/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createApiClient({ mode, fetchImpl, fixtureBase, timeoutMs, onStatus })`
- Produces: `client.request(path: string, body?: object): Promise<object>`, `client.getStatus(): { requestedMode, activeMode, source, error }`, `modeFromSearch(search: string): "fixture"|"live"|"auto"`

- [ ] **Step 1: API 어댑터 실패 테스트 작성**

```js
// product-ui/tests/verify-api-client.js
"use strict";
const assert = require("assert");
const { createApiClient, modeFromSearch } = require("../api-client.js");

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

(async () => {
  assert.equal(modeFromSearch("?data=fixture"), "fixture");
  assert.equal(modeFromSearch("?data=live"), "live");
  assert.equal(modeFromSearch(""), "auto");

  const fixtureCalls = [];
  const fixture = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    fixtureCalls.push(url);
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  assert.deepEqual(await fixture.request("/api/summary"), { docCount: 19, stats: { nodes: 193, edges: 938 } });
  assert(fixtureCalls.every((url) => String(url).startsWith("fixtures/")), "fixture mode attempted an API call");
  assert.equal(fixture.getStatus().activeMode, "fixture");

  const liveCalls = [];
  const live = createApiClient({ mode: "live", fetchImpl: async (url) => {
    liveCalls.push(url); return response({ versionLabel: "v2.4", docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  assert.equal((await live.request("/api/summary")).versionLabel, "v2.4");
  assert.deepEqual(liveCalls, ["/api/summary"]);

  const autoCalls = [];
  const auto = createApiClient({ mode: "auto", fetchImpl: async (url) => {
    autoCalls.push(url);
    if (url === "/api/summary") throw new Error("offline");
    if (String(url).endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  assert.deepEqual(await auto.request("/api/summary"), { docCount: 19, stats: { nodes: 193, edges: 938 } });
  assert.equal(auto.getStatus().activeMode, "fixture");
  assert(autoCalls.includes("/api/summary") && autoCalls.some((url) => String(url).includes("fixtures/summary.json")));

  const invalidLive = createApiClient({ mode: "live", fetchImpl: async () => response({}) });
  await assert.rejects(() => invalidLive.request("/api/summary"), /summary contract mismatch/);
  assert.equal(invalidLive.getStatus().error, "summary contract mismatch");
  await assert.rejects(() => fixture.request("/api/reset", {}), /No fixture route/);
  console.log("API client contract passed");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-api-client.js`
Expected: FAIL with `Cannot find module '../api-client.js'`.

- [ ] **Step 3: API 어댑터 최소 구현**

```js
// product-ui/api-client.js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.JikmuApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MODES = new Set(["fixture", "live", "auto"]);
  function modeFromSearch(search) {
    const mode = new URLSearchParams(String(search || "")).get("data") || "auto";
    return MODES.has(mode) ? mode : "auto";
  }
  function cleanId(value) { return encodeURIComponent(String(value || "")); }
  function normalizeResponse(path, value) {
    if (path === "/api/documents") {
      if (!Array.isArray(value)) throw new Error("documents contract mismatch");
      return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`response contract mismatch for ${path}`);
    if (path === "/api/summary" && !(Number.isInteger(value.docCount) && value.stats && Number.isInteger(value.stats.nodes) && Number.isInteger(value.stats.edges))) throw new Error("summary contract mismatch");
    if (path === "/api/forecast" && !Array.isArray(value.items)) throw new Error("forecast contract mismatch");
    if (path === "/api/briefing" && !(Array.isArray(value.stages) && Array.isArray(value.cautions))) throw new Error("briefing contract mismatch");
    if (path === "/api/ask" && !(typeof value.grounded === "boolean" && Array.isArray(value.answer) && Array.isArray(value.docs))) throw new Error("ask contract mismatch");
    if (path === "/api/draft" && typeof value.ok !== "boolean") throw new Error("draft contract mismatch");
    if (path === "/api/check" && !(Number.isInteger(value.count) && Array.isArray(value.findings))) throw new Error("check contract mismatch");
    return value;
  }
  function fixturePath(path, body) {
    if (path === "/api/summary") return "summary.json";
    if (path === "/api/forecast") return "forecast.json";
    if (path === "/api/briefing") return "briefing.json";
    if (path === "/api/documents") return "documents/index.json";
    if (path.startsWith("/api/documents/")) return `documents/${cleanId(decodeURIComponent(path.slice(15)))}.json`;
    if (path.startsWith("/api/okf/")) return `okf/${cleanId(decodeURIComponent(path.slice(9)))}.json`;
    if (path === "/api/ask") return /펌프|정비|추진\s*보고/.test(String(body && body.question || "")) ? "ask/pump-report.json" : "ask/not-found.json";
    if (path === "/api/draft" && body && body.task === "design-and-costing") return "draft/design-and-costing.json";
    if (path === "/api/check") return /확인\s*필요|그대로\s*준용|특정\s*모델|구두\s*지시|검수\s*전/.test(String(body && body.text || "")) ? "check/pump-risky-draft.json" : "check/clean-draft.json";
    return null;
  }
  function createApiClient(options = {}) {
    const requestedMode = MODES.has(options.mode) ? options.mode : "auto";
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const fixtureBase = String(options.fixtureBase || "fixtures").replace(/\/$/, "");
    const timeoutMs = Number(options.timeoutMs || 20000);
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    let activeMode = requestedMode;
    let source = requestedMode === "fixture" ? "fixture" : "live";
    let lastError = null;
    let manifestPromise = null;
    function status() { return { requestedMode, activeMode, source, error: lastError ? String(lastError.message || lastError) : null }; }
    function publish() { onStatus(status()); }
    async function getJSON(url, body) {
      if (!fetchImpl) throw new Error("fetch unavailable");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, body ? {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal
        } : { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      } finally { clearTimeout(timer); }
    }
    async function ensureManifest() {
      if (!manifestPromise) manifestPromise = getJSON(`${fixtureBase}/manifest.json`).then((manifest) => {
        if (!manifest || manifest.contractVersion !== 1) throw new Error("fixture contract mismatch");
        return manifest;
      });
      return manifestPromise;
    }
    async function fixtureRequest(path, body) {
      const rel = fixturePath(path, body);
      if (!rel) throw new Error(`No fixture route for ${path}`);
      await ensureManifest();
      const data = normalizeResponse(path, await getJSON(`${fixtureBase}/${rel}`));
      activeMode = "fixture"; source = "fixture"; publish();
      return data;
    }
    async function liveRequest(path, body) {
      const data = normalizeResponse(path, await getJSON(path, body));
      activeMode = "live"; source = "live"; lastError = null; publish();
      return data;
    }
    async function request(path, body) {
      if (activeMode === "fixture") return fixtureRequest(path, body);
      if (requestedMode === "live" || activeMode === "live") {
        try { return await liveRequest(path, body); }
        catch (error) { lastError = error; source = "live"; publish(); throw error; }
      }
      try {
        return await liveRequest(path, body);
      } catch (error) {
        lastError = error; activeMode = "fixture"; source = "fixture"; publish();
        return fixtureRequest(path, body);
      }
    }
    publish();
    return { request, getStatus: status };
  }
  return { createApiClient, modeFromSearch, fixturePath, normalizeResponse };
});
```

- [ ] **Step 4: 브라우저 스크립트 순서 추가**

Change the bottom of `product-ui/index.html` to:

```html
<script src="intent.js"></script>
<script src="extract.js"></script>
<script src="api-client.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 5: 테스트 명령 등록 및 검증**

Add to `package.json`:

```json
"test:product-ui:api": "node product-ui/tests/verify-api-client.js"
```

Run: `npm run test:product-ui:api`
Expected: `API client contract passed`.

Run: `npm run test:product-ui:source`
Expected: `Product UI source contract passed`.

- [ ] **Step 6: 커밋**

```bash
git add product-ui/api-client.js product-ui/index.html product-ui/tests/verify-api-client.js package.json
git commit -m "fixture와 live 데이터 어댑터 추가"
```

---

### Task 4: 업무 작업대 SPA를 API 어댑터에 연결

**Files:**
- Create: `product-ui/tests/verify-app-data-mode.js`
- Modify: `product-ui/index.html`
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: `window.JikmuApi.createApiClient()`, `client.request(path, body)`, `client.getStatus()`
- Produces: 전역 `api(path, body)` 호환 래퍼, `renderDataStatus(status)`, stale `/api/ask` 응답 차단

- [ ] **Step 1: 데이터 모드 연결 실패 테스트 작성**

```js
// product-ui/tests/verify-app-data-mode.js
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const failures = [];

if (!(index.indexOf('src="api-client.js"') < index.indexOf('src="app.js"'))) failures.push("api-client.js script order");
if (!index.includes('id="dataStatus"')) failures.push("missing data status element");
if (!app.includes("window.JikmuApi.createApiClient")) failures.push("app does not create API client");
if (/async function api\([^)]*\)\s*\{[\s\S]{0,500}fetch\(/.test(app)) failures.push("app still fetches API directly");
if (!/let askSeq\s*=\s*0/.test(app) || !/const seq\s*=\s*\+\+askSeq/.test(app)) failures.push("stale ask guard missing");
if (/api\(["']\/api\/reset/.test(app)) failures.push("UI reset calls server reset");
if (!css.includes(".data-status")) failures.push("data status style missing");

if (failures.length) { console.error("App data-mode contract failed:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("App data-mode contract passed");
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-app-data-mode.js`
Expected: FAIL with `missing data status element` and `app does not create API client`.

- [ ] **Step 3: 데이터 상태 표시 추가**

Insert in `product-ui/index.html` inside `.top-right`, before the theme button:

```html
<span class="data-status" id="dataStatus" role="status" aria-live="polite">데이터 확인 중</span>
```

Append to the header section of `product-ui/style.css`:

```css
.data-status{font-size:.76rem;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 9px;background:var(--surface)}
.data-status.fixture{color:var(--amber);background:var(--amber-soft);border-color:transparent}
.data-status.live{color:var(--mint);background:var(--mint-soft);border-color:transparent}
.data-status.error{color:var(--red);background:var(--red-soft);border-color:transparent}
```

- [ ] **Step 4: 기존 직접 fetch 래퍼를 API 클라이언트로 교체**

Replace the `/* ---------- 엔진 API ---------- */` block in `product-ui/app.js` through the three `load*` functions with:

```js
/* ---------- 엔진·fixture API ---------- */
function renderDataStatus(status) {
  const el = document.getElementById("dataStatus");
  if (!el) return;
  el.className = "data-status " + (status.error && status.requestedMode === "live" ? "error" : status.activeMode);
  el.textContent = status.activeMode === "fixture" ? "시연용 샘플 데이터" : status.error ? "엔진 연결 오류" : "실제 엔진 연결";
}
const apiClient = window.JikmuApi.createApiClient({
  mode: window.JikmuApi.modeFromSearch(location.search),
  fixtureBase: "fixtures",
  timeoutMs: 20000,
  onStatus: renderDataStatus,
});
async function api(path, body) { return apiClient.request(path, body); }
const cache = { summary: null, forecast: null, briefing: null };
async function loadSummary() { if (!cache.summary) cache.summary = await api("/api/summary"); return cache.summary; }
async function loadForecast() { if (!cache.forecast) cache.forecast = await api("/api/forecast"); return cache.forecast; }
async function loadBriefing() { if (!cache.briefing) cache.briefing = await api("/api/briefing"); return cache.briefing; }
```

- [ ] **Step 5: 오래된 질문 응답 차단**

Add before `renderAsk`:

```js
let askSeq = 0;
```

Change the start and first awaited result inside `renderAsk` to:

```js
async function renderAsk(box, q, target) {
  if (!box) return;
  const seq = ++askSeq;
  box.innerHTML = `<div class="card ask-panel"><div class="blk-k">근거를 찾는 중…</div></div>`;
  try {
    const r = await api("/api/ask", { question: q });
    if (seq !== askSeq || !document.body.contains(box)) return;
```

In the `catch` block, add the same guard before rendering the error:

```js
if (seq !== askSeq || !document.body.contains(box)) return;
```

- [ ] **Step 6: 정적 계약 통과 확인**

Add to `package.json`:

```json
"test:product-ui:data-mode": "node product-ui/tests/verify-app-data-mode.js"
```

Run:

```bash
npm run test:product-ui:source
npm run test:product-ui:fixtures
npm run test:product-ui:api
npm run test:product-ui:data-mode
```

Expected: all four commands pass.

- [ ] **Step 7: fixture 모드 수동 스모크**

Run: `PRODUCT_UI_PORT=8410 npm run product-ui:serve`
Open: `http://127.0.0.1:8410/?data=fixture#home`
Expected: header shows `시연용 샘플 데이터`; browser Network panel contains no `/api/` request.

- [ ] **Step 8: 커밋**

```bash
git add product-ui/index.html product-ui/style.css product-ui/app.js product-ui/tests/verify-app-data-mode.js package.json
git commit -m "업무 작업대에 데이터 모드 연결"
```

---

### Task 5: 대표 영상 동선을 자동 검증

**Files:**
- Create: `product-ui/tests/verify-showcase-e2e.js`
- Create: `product-ui/screenshots/.gitkeep`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PRODUCT_UI_URL` optional base URL; default `http://127.0.0.1:8410/?data=fixture`
- Produces: 홈 지시→작업대→근거 질문→기안→사전점검의 1920×1080 E2E와 390px 회귀

- [ ] **Step 1: 대표 동선 실패 E2E 작성**

```js
// product-ui/tests/verify-showcase-e2e.js
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const local = !process.env.PRODUCT_UI_URL;
const base = process.env.PRODUCT_UI_URL || "http://127.0.0.1:8410/?data=fixture";
const server = local ? spawn(process.execPath, [path.resolve(__dirname, "..", "..", "tools", "serve-product-ui.js")], {
  env: { ...process.env, PRODUCT_UI_PORT: "8410" }, stdio: ["ignore", "pipe", "inherit"]
}) : null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browserCandidates = [
  process.env.BROWSER_PATH,
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch("http://127.0.0.1:8410/index.html"); if (r.ok) return; } catch (e) {}
    await wait(100);
  }
  throw new Error("product UI server did not start");
}

(async () => {
  if (local) await waitForServer();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(base + (base.includes("#") ? "" : "#home"));
  await page.evaluate(() => {
    localStorage.removeItem("jikmu.workbench.v1");
    localStorage.removeItem("jikmu.ui.v1");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="home-omni"]');
  await page.fill("#omniIn", "팀장님이 다음 주까지 펌프 정비계획 올리래");
  await page.locator('[data-testid="home-omni"]').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => location.hash.startsWith("#workbench/"));
  await page.waitForSelector('[data-testid="workbench"]');
  if (!(await page.textContent("main")).includes("순환수 펌프")) throw new Error("pump workbench did not open");

  await page.fill("#wbIn", "운영부 일정은 5월 둘째 주로 확정");
  await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("운영부 일정은 5월 둘째 주로 확정"));

  await page.fill("#wbIn", "작년 펌프 정비 추진 보고 찾아줘");
  await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
  await page.waitForSelector('[data-testid="grounded-answer"] .badge.grounded');
  if (!(await page.textContent("#wbResult")).includes("관련 문서")) throw new Error("grounded documents missing");
  const evidence = page.locator("#wbResult [data-ev]").first();
  if (!(await evidence.count())) throw new Error("evidence link missing");
  await evidence.click();
  await page.waitForSelector("#drawer:not([hidden])");
  await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
  if ((await page.textContent("#drawerBody")).includes("불러오지 못했습니다")) throw new Error("evidence detail failed");
  await page.click("#drawerClose");

  await page.click("#goDraft");
  await page.waitForFunction(() => location.hash.startsWith("#draft/"));
  await page.waitForSelector('[data-testid="draft-document"]');
  await page.click("#dCheck");
  await page.waitForSelector('[data-testid="precheck-results"] .f-item');
  if ((await page.locator('[data-testid="precheck-results"] .f-item').count()) < 1) throw new Error("precheck findings missing");
  const expectedStatus = base.includes("data=fixture") ? "시연용 샘플 데이터" : base.includes("data=live") ? "실제 엔진 연결" : null;
  if (expectedStatus && (await page.textContent("#dataStatus")).trim() !== expectedStatus) throw new Error(`data status mismatch: expected ${expectedStatus}`);

  fs.mkdirSync(path.resolve(__dirname, "..", "screenshots"), { recursive: true });
  await page.screenshot({ path: path.resolve(__dirname, "..", "screenshots", "showcase-golden.png"), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base + (base.includes("#") ? "" : "#home"));
  await mobile.waitForSelector('[data-testid="home-omni"]');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("390px horizontal overflow");

  if (consoleErrors.length) throw new Error("console errors: " + consoleErrors.join(" | "));
  await browser.close();
  console.log("Showcase E2E passed");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => { if (server) server.kill("SIGTERM"); });
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-showcase-e2e.js`
Expected: FAIL waiting for `[data-testid="home-omni"]` because the stable showcase selectors do not exist yet.

- [ ] **Step 3: 최소한의 selector·fixture 매핑 교정**

Add these stable attributes without changing layout:

```html
data-testid="home-omni"
data-testid="workbench"
data-testid="grounded-answer"
data-testid="draft-document"
data-testid="precheck-results"
```

Map them respectively to `#omni`, the root of `vWorkbench`, `.ask-panel`, `.draft-doc`, and `#checkOut`. Update the E2E selectors to the `data-testid` values after adding them.

Make these exact template changes in `product-ui/app.js`:

```html
<form class="omni" id="omni" data-testid="home-omni">
<div class="view" data-testid="workbench">
<div class="card ask-panel" data-testid="grounded-answer">
<div class="draft-doc" data-testid="draft-document">
<div id="checkOut" data-testid="precheck-results"></div>
```

- [ ] **Step 4: E2E 명령 등록 및 통과**

Add to `package.json`:

```json
"test:product-ui:e2e": "node product-ui/tests/verify-showcase-e2e.js"
```

Run: `npm run test:product-ui:e2e`
Expected: `Showcase E2E passed` and `product-ui/screenshots/showcase-golden.png` exists.

- [ ] **Step 5: 기존 UI 계약 회귀 확인**

Run:

```bash
npm run test:workbench
npm run test:product-ui:source
npm run test:product-ui:fixtures
npm run test:product-ui:api
npm run test:product-ui:data-mode
```

Expected: all commands pass.

- [ ] **Step 6: 커밋**

```bash
git add product-ui/tests/verify-showcase-e2e.js product-ui/screenshots product-ui/index.html product-ui/app.js package.json
git commit -m "발표용 대표 업무 동선 검증 추가"
```

---

### Task 6: 허용 목록 기반 저장소 동기화 도구 구현

**Files:**
- Create: `product-ui/version.json`
- Create: `product-ui/sync-manifest.json`
- Create: `tools/sync-product-ui.js`
- Create: `tools/test-sync-product-ui.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `syncProductUi({ sourceRoot, targetRepo, write, inspectRepo })`
- Produces: `service/public/*` 허용 파일 동기화, `service/public/.ui-source.json`, check mode exit code

- [ ] **Step 1: 동기화 안전성 실패 테스트 작성**

```js
// tools/test-sync-product-ui.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { syncProductUi, assertSafeEntry } = require("./sync-product-ui.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jikmu-ui-sync-"));
const sourceRoot = path.join(tmp, "source");
const targetRepo = path.join(tmp, "target");
fs.mkdirSync(path.join(sourceRoot, "fixtures"), { recursive: true });
fs.mkdirSync(path.join(targetRepo, "service", "public"), { recursive: true });
fs.mkdirSync(path.join(targetRepo, "service", "src"), { recursive: true });
fs.writeFileSync(path.join(sourceRoot, "index.html"), "new ui\n");
fs.writeFileSync(path.join(sourceRoot, "fixtures", "summary.json"), "{}\n");
fs.writeFileSync(path.join(sourceRoot, "sync-manifest.json"), JSON.stringify({ version: 1, entries: ["index.html", "fixtures"] }));
fs.writeFileSync(path.join(sourceRoot, "version.json"), JSON.stringify({ version: "ui-v1.0.0" }));
fs.writeFileSync(path.join(targetRepo, "service", "public", "index.html"), "old ui\n");
fs.writeFileSync(path.join(targetRepo, "service", "src", "sentinel.js"), "do not touch\n");

assert.throws(() => assertSafeEntry("../service/src"), /unsafe manifest entry/);
const inspectRepo = () => ({ remote: "https://github.com/creationy/jikmu-memory.git", branch: "ui/test", clean: true, sourceSha: "abc1234" });
const check = syncProductUi({ sourceRoot, targetRepo, write: false, inspectRepo });
assert.equal(check.changed, true);
assert.equal(fs.readFileSync(path.join(targetRepo, "service", "public", "index.html"), "utf8"), "old ui\n");
const written = syncProductUi({ sourceRoot, targetRepo, write: true, inspectRepo });
assert.equal(written.changed, true);
assert.equal(fs.readFileSync(path.join(targetRepo, "service", "public", "index.html"), "utf8"), "new ui\n");
assert.equal(fs.readFileSync(path.join(targetRepo, "service", "src", "sentinel.js"), "utf8"), "do not touch\n");
const provenance = JSON.parse(fs.readFileSync(path.join(targetRepo, "service", "public", ".ui-source.json"), "utf8"));
assert.equal(provenance.repository, "sangwonMoon-kor/kdhc-ai-contest");
assert.equal(provenance.commit, "abc1234");
const cleanCheck = syncProductUi({ sourceRoot, targetRepo, write: false, inspectRepo });
assert.equal(cleanCheck.changed, false, "check after write must be clean");
assert.throws(() => syncProductUi({ sourceRoot, targetRepo, write: true, inspectRepo: () => ({ remote: "wrong/repo", branch: "ui/test", clean: true, sourceSha: "x" }) }), /wrong target remote/);
console.log("UI sync contract passed");
```

- [ ] **Step 2: 실패 확인**

Run: `node tools/test-sync-product-ui.js`
Expected: FAIL with `Cannot find module './sync-product-ui.js'`.

- [ ] **Step 3: UI 버전과 허용 목록 작성**

Create `product-ui/version.json`:

```json
{
  "version": "ui-v1.0.0"
}
```

Create `product-ui/sync-manifest.json`:

```json
{
  "version": 1,
  "entries": [
    "index.html",
    "style.css",
    "app.js",
    "api-client.js",
    "intent.js",
    "extract.js",
    "fixtures",
    "version.json"
  ]
}
```

- [ ] **Step 4: 동기화 도구 구현**

```js
// tools/sync-product-ui.js
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function assertSafeEntry(entry) {
  const value = String(entry || "");
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error(`unsafe manifest entry: ${value}`);
  return value;
}
function filesUnder(root, entry) {
  const start = path.join(root, entry);
  if (!fs.existsSync(start)) throw new Error(`missing source entry: ${entry}`);
  if (fs.statSync(start).isFile()) return [entry];
  const out = [];
  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name); const child = path.join(rel, name);
      if (fs.statSync(abs).isDirectory()) walk(abs, child); else out.push(child);
    }
  }
  walk(start, entry);
  return out;
}
function same(a, b) { return fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b)); }
function defaultInspect(sourceRepo, targetRepo) {
  const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  return {
    remote: git(targetRepo, ["remote", "get-url", "origin"]),
    branch: git(targetRepo, ["branch", "--show-current"]),
    clean: git(targetRepo, ["status", "--porcelain"]) === "",
    sourceSha: git(sourceRepo, ["rev-parse", "--short=12", "HEAD"]),
  };
}
function syncProductUi({ sourceRoot, targetRepo, write, inspectRepo }) {
  const sourceRepo = path.resolve(sourceRoot, "..");
  const target = path.join(path.resolve(targetRepo), "service", "public");
  const inspect = inspectRepo || (() => defaultInspect(sourceRepo, targetRepo));
  const state = inspect();
  if (!String(state.remote).includes("creationy/jikmu-memory")) throw new Error("wrong target remote");
  if (!String(state.branch).startsWith("ui/")) throw new Error("target branch must start with ui/");
  if (!state.clean) throw new Error("target working tree must be clean");
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, "sync-manifest.json"), "utf8"));
  const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, "version.json"), "utf8"));
  const relFiles = manifest.entries.flatMap((entry) => filesUnder(sourceRoot, assertSafeEntry(entry)));
  let changed = false;
  for (const rel of relFiles) {
    const from = path.join(sourceRoot, rel); const to = path.join(target, rel);
    if (!same(from, to)) {
      changed = true;
      if (write) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
    }
  }
  const expectedProvenance = { repository: "sangwonMoon-kor/kdhc-ai-contest", commit: state.sourceSha, version: version.version };
  const provenanceFile = path.join(target, ".ui-source.json");
  let provenance = null;
  try { provenance = JSON.parse(fs.readFileSync(provenanceFile, "utf8")); } catch (error) {}
  const provenanceMatches = provenance && ["repository", "commit", "version"].every((key) => provenance[key] === expectedProvenance[key]);
  if (!provenanceMatches) {
    changed = true;
    provenance = { ...expectedProvenance, syncedAt: new Date().toISOString() };
    if (write) fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + "\n");
  }
  return { changed, files: relFiles.length, provenance: provenance || expectedProvenance };
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") out.target = argv[++i];
    else if (argv[i] === "--write") out.write = true;
    else if (argv[i] === "--check") out.write = false;
  }
  return out;
}
if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.target) throw new Error("--target is required");
    const result = syncProductUi({ sourceRoot: path.resolve(__dirname, "..", "product-ui"), targetRepo: path.resolve(args.target), write: Boolean(args.write) });
    console.log(`${args.write ? "synced" : "checked"} ${result.files} files; changed=${result.changed}; source=${result.provenance.commit}`);
    if (!args.write && result.changed) process.exitCode = 1;
  } catch (error) { console.error(error.message || error); process.exitCode = 1; }
}
module.exports = { syncProductUi, assertSafeEntry };
```

- [ ] **Step 5: 동기화 테스트 등록 및 통과**

Add to `package.json`:

```json
"test:product-ui:sync": "node tools/test-sync-product-ui.js"
```

Run: `npm run test:product-ui:sync`
Expected: `UI sync contract passed`.

- [ ] **Step 6: 커밋**

```bash
git add product-ui/version.json product-ui/sync-manifest.json tools/sync-product-ui.js tools/test-sync-product-ui.js package.json
git commit -m "UI 정본 안전 동기화 도구 추가"
```

---

### Task 7: 팀원 저장소 통합 브랜치에 UI를 반영하고 실제 엔진 검증

**Files (`jikmu-memory`):**
- Modify: `service/public/index.html`
- Modify: `service/public/style.css`
- Modify: `service/public/app.js`
- Create: `service/public/api-client.js`
- Replace from source: `service/public/intent.js`
- Replace from source: `service/public/extract.js`
- Create: `service/public/fixtures/**`
- Create: `service/public/version.json`
- Create: `service/public/.ui-source.json`
- Create: `service/test/ui-integration.test.js`
- Modify: `service/package.json`

**Interfaces:**
- Consumes: `product-ui/sync-manifest.json`, `tools/sync-product-ui.js`, existing `/api/*`
- Produces: `ui/showcase-integration`의 same-origin live UI, `npm run test:ui`, live E2E

- [ ] **Step 1: 팀원 저장소 상태와 최신 기준 확인**

Run:

```bash
cd /Users/openclaw/projects/jikmu-memory
git status --short --branch
git fetch origin --prune
git rev-parse --short origin/main
```

Expected: clean `main`; `origin/main` is at least `13e232e`. If it moved, inspect new `service/public` changes and merge them into `product-ui` before continuing.

- [ ] **Step 2: 통합 브랜치 생성**

```bash
git switch -c ui/showcase-integration origin/main
```

Expected: branch `ui/showcase-integration`; `main` remains unchanged.

- [ ] **Step 3: 쓰기 전 check 모드로 차이만 확인**

Run from `kdhc-ai-contest`:

```bash
node tools/sync-product-ui.js --target /Users/openclaw/projects/jikmu-memory --check
```

Expected: exit code 1 with `changed=true`; `git -C /Users/openclaw/projects/jikmu-memory status --short` remains empty.

- [ ] **Step 4: 깨끗한 통합 브랜치에 검증된 UI 동기화**

Run from `kdhc-ai-contest`:

```bash
node tools/sync-product-ui.js --target /Users/openclaw/projects/jikmu-memory --write
```

Expected: `synced ... files; changed=true; source=<kdhc commit>`. Only the manifest-approved files under `service/public/` and `.ui-source.json` are changed.

- [ ] **Step 5: 동기화 결과에 대한 UI 통합 계약 테스트 작성**

```js
// service/test/ui-integration.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "public");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const failures = [];
for (const rel of ["index.html", "app.js", "api-client.js", "intent.js", "extract.js", "fixtures/manifest.json", ".ui-source.json"]) {
  if (!fs.existsSync(path.join(root, rel))) failures.push(`missing ${rel}`);
}
if (!failures.length) {
  const index = read("index.html");
  const source = JSON.parse(read(".ui-source.json"));
  const fixture = JSON.parse(read("fixtures/manifest.json"));
  if (!(index.indexOf('src="api-client.js"') < index.indexOf('src="app.js"'))) failures.push("script order");
  if (source.repository !== "sangwonMoon-kor/kdhc-ai-contest") failures.push("UI provenance repository");
  if (fixture.contractVersion !== 1 || fixture.fixtureVersion !== "v2.4") failures.push("fixture contract");
  const tracked = [read("index.html"), read("app.js"), read("api-client.js")].join("\n");
  if (/sk-[A-Za-z0-9_-]{12,}|LLM_API_KEY|KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN/.test(tracked)) failures.push("secret-like token in UI");
}
if (failures.length) { console.error("UI integration contract failed:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("UI integration contract passed");
```

- [ ] **Step 6: 팀원 저장소 UI 테스트 명령 추가**

Add to `service/package.json` scripts without changing the existing `test` command:

```json
"test:ui": "node test/ui-integration.test.js"
```

- [ ] **Step 7: 엔진과 UI 정적 게이트 통과**

Run:

```bash
cd /Users/openclaw/projects/jikmu-memory/service
npm test
npm run test:ui
```

Expected: existing engine gate `102 passed, 0 failed` in total across six suites; then `UI integration contract passed`.

- [ ] **Step 8: 실제 엔진 same-origin E2E**

Terminal A:

```bash
cd /Users/openclaw/projects/jikmu-memory/service
node server.js
```

Terminal B:

```bash
cd /Users/openclaw/projects/kdhc-ai-contest
PRODUCT_UI_URL='http://127.0.0.1:8343/?data=live' npm run test:product-ui:e2e
```

Expected: `Showcase E2E passed`; header status is `실제 엔진 연결`; no fixture fallback occurs. Start with `node server.js`, not `npm start`, so local `.env` and paid LLM calls are not loaded during automated verification.

- [ ] **Step 9: 팀원 저장소 통합 브랜치 커밋**

```bash
cd /Users/openclaw/projects/jikmu-memory
git add service/public service/test/ui-integration.test.js service/package.json
git commit -m "쇼케이스 UI 정본을 엔진에 통합"
```

- [ ] **Step 10: 깨끗한 커밋에서 동기화 일치 확인**

Run from `kdhc-ai-contest`:

```bash
node tools/sync-product-ui.js --target /Users/openclaw/projects/jikmu-memory --check
```

Expected: exit code 0 with `changed=false`; teammate repository remains clean.

- [ ] **Step 11: 통합 브랜치만 원격 게시**

Do not push `main`. Push only the reviewed integration branch:

```bash
git push -u origin ui/showcase-integration
```

---

### Task 8: 운영 문서와 최종 녹화 게이트 고정

**Files (`kdhc-ai-contest`):**
- Create: `product-ui/README.md`
- Create: `docs/showcase-recording-checklist.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: 모든 product UI 테스트, 엔진 통합 커밋, `ui-v1.0.0`
- Produces: 맥미니 재현 절차, 녹화 체크리스트, 단일 종합 검증 명령

- [ ] **Step 1: 종합 명령이 아직 없는지 실패 확인**

Run: `npm run test:product-ui`
Expected: FAIL with `Missing script: "test:product-ui"`.

- [ ] **Step 2: UI 개발·동기화 문서 작성**

Create `product-ui/README.md` with exactly these sections and commands:

````markdown
# 직무 메모리 Product UI

이 폴더가 UI·UX 정본이다. `demo/`는 발표·과거 프로토타입 보존본이며 최종 엔진 UI를 직접 수정하는 위치가 아니다.

## 맥미니에서 UI 작업

```bash
npm ci --ignore-scripts
npm run product-ui:serve
# http://127.0.0.1:8410/?data=fixture#home
```

## 데이터 모드

- `?data=fixture`: v2.4 고정 샘플, 외부 네트워크 없음
- `?data=live`: 같은 출처의 실제 `/api/*`, 실패를 숨기지 않음
- `?data=auto`: 실제 API 최초 연결 실패 시 fixture로 복귀

## 검증

```bash
npm run test:product-ui
```

## 팀원 저장소로 동기화

대상은 반드시 `creationy/jikmu-memory`의 깨끗한 `ui/*` 브랜치여야 한다.

```bash
node tools/sync-product-ui.js --target /path/to/jikmu-memory --check
node tools/sync-product-ui.js --target /path/to/jikmu-memory --write
```
````

- [ ] **Step 3: 영상 녹화 체크리스트 작성**

Create `docs/showcase-recording-checklist.md`:

```markdown
# 직무 메모리 쇼케이스 녹화 체크리스트

## 녹화 전

- [ ] `npm run test:product-ui` 통과
- [ ] fixture manifest가 v2.4·engine commit 13e232e 이상
- [ ] `?data=fixture#home`로 시작
- [ ] 샘플 초기화 후 홈 재진입
- [ ] 1920×1080, 브라우저 배율 100%
- [ ] 알림, 북마크 바, 개인정보 노출 차단

## 대표 동선

- [ ] 팀장 지시 입력
- [ ] 순환수 펌프 업무 작업대 착지
- [ ] 과거 자료·근거 확인
- [ ] 근거 기반 질문
- [ ] 올해 기안 초안
- [ ] 제출 전 위험 점검
- [ ] 다음 담당자에게 남는 직무 메모리 메시지

## 녹화 후

- [ ] 로딩 지연·커서 실수 없음
- [ ] 잘린 카드·가로 스크롤 없음
- [ ] 임시 문구·콘솔 오류·네트워크 오류 없음
- [ ] 실제 구현처럼 과장한 문구 없음
```

- [ ] **Step 4: 종합 테스트 명령 등록**

Add to `package.json`:

```json
"test:product-ui": "npm run test:product-ui:source && npm run test:product-ui:fixtures && npm run test:product-ui:api && npm run test:product-ui:data-mode && npm run test:product-ui:sync && npm run test:product-ui:e2e"
```

- [ ] **Step 5: 루트 README에 UI 정본 링크 추가**

Add near the current product prototype section in `README.md`:

```markdown
> 🎬 **최종 통합 UI·UX 정본은 [`product-ui/`](product-ui/README.md)** — fixture로 맥미니에서 독립 수정하고,
> 검증된 파일만 `creationy/jikmu-memory/service/public/`의 통합 브랜치로 동기화한다.
> `demo/app.html`은 제품 방향과 과거 프로토타입을 보존한다.
```

- [ ] **Step 6: 전체 검증**

Run:

```bash
npm run test:workbench
npm run test:product-ui
git diff --check
git status --short --branch
```

Expected: all tests pass; only intentional documentation/UI files are changed; branch is `feature/product-ui-source`.

Run in `jikmu-memory/service`:

```bash
npm test
npm run test:ui
```

Expected: existing 102 engine assertions pass and UI integration contract passes.

- [ ] **Step 7: 문서 커밋**

```bash
git add product-ui/README.md docs/showcase-recording-checklist.md README.md package.json
git commit -m "통합 UI 작업과 녹화 절차 문서화"
```

- [ ] **Step 8: 최종 승인 뒤 UI 버전 태그와 원격 브랜치 게시**

```bash
git tag -a ui-v1.0.0 -m "직무 메모리 통합 쇼케이스 UI v1.0.0"
git push -u origin feature/product-ui-source
git push origin ui-v1.0.0
```

Expected: 개인 저장소에 최신 UI·UX 정본과 버전 태그가 보이고, 팀원 저장소에는 `ui/showcase-integration` 브랜치의 실행본이 보인다. 두 저장소의 `main` 병합은 별도 PR 검토 후 수행한다.
