"use strict";
const assert = require("assert");
const { createApiClient, fixturePath, modeFromSearch, normalizeResponse } = require("../api-client.js");

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

(async () => {
  assert.equal(modeFromSearch("?data=fixture"), "fixture");
  assert.equal(modeFromSearch("?data=live"), "live");
  assert.equal(modeFromSearch(""), "auto");

  const reachableFixtureRoutes = [
    ["/api/graph", null, "graph.json"],
    ["/api/draft", { task: "design-and-costing" }, "draft/design-and-costing.json"],
    ["/api/draft", { task: "problem-recognition" }, "draft/problem-recognition.json"],
    ["/api/hint/stage", { text: "운영부 일정 확인", stageId: "design-and-costing" }, "hint/stage.json"],
    ["/api/hint/commit", { triple: {}, text: "운영부 일정 확인" }, "hint/commit.json"],
    ["/api/ingest", { text: "순환수 펌프 정비 계획 보고와 산출근거" }, "ingest/stage.json"],
    ["/api/ingest/commit", { doc: {}, triples: [] }, "ingest/commit.json"],
    ["/api/extract", { filename: "scan.pdf", mime: "application/pdf", dataB64: "AA==" }, "extract/scanned-pdf.json"]
  ];
  for (const [apiPath, body, expected] of reachableFixtureRoutes) {
    assert.equal(fixturePath(apiPath, body), expected, `fixture route missing for ${apiPath}`);
  }
  assert.equal(
    fixturePath("/api/ask", { question: "올해 정기점검보수 기본계획을 어떻게 수립해야 해?" }),
    "local-maintenance/ask/maintenance-plan.json"
  );
  assert.equal(
    fixturePath("/api/ask", { question: "유지보수 계획 수립 절차를 알려줘" }),
    "local-maintenance/ask/maintenance-plan.json"
  );
  assert.equal(
    fixturePath("/api/documents/PROC-MAINT-31100"),
    "local-maintenance/documents/PROC-MAINT-31100.json"
  );
  assert.equal(
    fixturePath("/api/ask", { question: "작년 펌프 정비 추진 보고 찾아줘" }),
    "ask/pump-report.json"
  );
  assert.equal(fixturePath("/api/draft", { task: "unknown-stage" }), null, "unknown draft stage used an unrelated fixture");

  const validShapes = [
    ["/api/forecast", { items: [{ name: "순환수 펌프 정비", task: "설계·내역 작성", stageId: "design-and-costing", month: 4, lastDate: "2025-04-09", dueDate: "2026-04-09", dday: 97, docCount: 2, docs: ["APPR-2025-0409"] }] }],
    ["/api/graph", { nodes: [], edges: [] }],
    ["/api/draft", { ok: true, stageId: "problem-recognition", baseDocId: "DOC-1", title: "초안", sections: [], checklist: [] }],
    ["/api/hint/stage", { guard: { flagged: false }, triples: [] }],
    ["/api/hint/commit", { ok: true, hint: {} }],
    ["/api/ingest", { doc: { id: "DOC-1" }, triples: [], caseProposal: null }],
    ["/api/ingest/commit", { ok: true, doc: { id: "DOC-1" } }],
    ["/api/extract", { ok: true, text: "추출된 고정 텍스트" }],
    ["/api/documents/DOC-1", { doc: { id: "DOC-1" }, edges: [] }],
    ["/api/okf/problem-recognition", { id: "problem-recognition" }]
  ];
  for (const [apiPath, value] of validShapes) assert.equal(normalizeResponse(apiPath, value), value);

  const normalizedLegacyLiveDocuments = normalizeResponse("/api/documents", [
    { id: "LEGACY-ABSENT", title: "Legacy absent access" },
    { id: "EXPLICIT-FULL", title: "Explicit full", access: "full" },
    { id: "EXPLICIT-NONE", title: "Explicit none", access: "none" },
    { id: "EXPLICIT-NULL", title: "Explicit null", access: null },
    { id: "EXPLICIT-EMPTY", title: "Explicit empty", access: "" },
    { id: "EXPLICIT-RESTRICTED", title: "Explicit restricted", access: "restricted" },
    { id: "EXPLICIT-FUTURE", title: "Explicit future value", access: "metadata-only" }
  ], { legacyDocumentIndexGrant: true });
  assert.deepEqual(
    normalizedLegacyLiveDocuments.map((document) => [document.id, document.access]),
    [
      ["LEGACY-ABSENT", "full"],
      ["EXPLICIT-FULL", "full"],
      ["EXPLICIT-NONE", "none"],
      ["EXPLICIT-NULL", "none"],
      ["EXPLICIT-EMPTY", "none"],
      ["EXPLICIT-RESTRICTED", "none"],
      ["EXPLICIT-FUTURE", "none"]
    ],
    "legacy grant trusted an explicit unknown access value"
  );
  assert.throws(
    () => normalizeResponse("/api/documents", [{ id: "FIXTURE-MISSING-ACCESS" }]),
    /documents access contract mismatch/,
    "fixture/captured index accepted an implicit access value"
  );
  for (const access of [null, "", "restricted", "metadata-only"]) {
    assert.throws(
      () => normalizeResponse("/api/documents", [{ id: "FIXTURE-INVALID-ACCESS", access }]),
      /documents access contract mismatch/,
      `fixture index accepted explicit invalid access: ${String(access)}`
    );
  }
  const duplicateLiveDocuments = normalizeResponse("/api/documents", [
    { id: "LIVE-DUPLICATE", title: "Allowed duplicate", access: "full" },
    { id: "LIVE-DUPLICATE", title: "Denied duplicate", access: "none" },
    { id: "LIVE-SAME", title: "Same duplicate first", access: "full" },
    { id: "LIVE-SAME", title: "Same duplicate second", access: "full" }
  ], { legacyDocumentIndexGrant: true });
  assert.deepEqual(
    duplicateLiveDocuments.map((document) => [document.id, document.access]),
    [["LIVE-DUPLICATE", "none"], ["LIVE-SAME", "full"]],
    "live normalization returned duplicate IDs or allowed a conflicting duplicate"
  );

  const invalidShapes = [
    ["/api/forecast", { items: [{ name: "순환수 펌프 정비", task: "설계·내역 작성", stageId: "design-and-costing", month: 4, lastDate: "2025-04-09", dueDate: '\"><img src=x onerror=alert(1)>', dday: 97, docCount: 2, docs: ["APPR-2025-0409"] }] }, /forecast contract mismatch/],
    ["/api/graph", { nodes: [] }, /graph contract mismatch/],
    ["/api/draft", { ok: true }, /draft contract mismatch/],
    ["/api/hint/stage", { triples: [] }, /hint stage contract mismatch/],
    ["/api/hint/commit", { ok: true }, /hint commit contract mismatch/],
    ["/api/ingest", { doc: {}, triples: "not-an-array" }, /ingest contract mismatch/],
    ["/api/ingest/commit", { ok: true }, /ingest commit contract mismatch/],
    ["/api/extract", { ok: true }, /extract contract mismatch/],
    ["/api/documents/DOC-1", { doc: {}, edges: [] }, /document detail contract mismatch/],
    ["/api/okf/problem-recognition", { label: "문제 인식" }, /OKF detail contract mismatch/]
  ];
  for (const [apiPath, value, message] of invalidShapes) assert.throws(() => normalizeResponse(apiPath, value), message);

  const fixtureCalls = [];
  const fixture = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    fixtureCalls.push(url);
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  assert.deepEqual(await fixture.request("/api/summary"), { docCount: 19, stats: { nodes: 193, edges: 938 } });
  assert(fixtureCalls.every((url) => String(url).startsWith("fixtures/")), "fixture mode attempted an API call");
  assert.equal(fixture.getStatus().activeMode, "fixture");

  const fixtureOverlayCalls = [];
  const fixtureWithOverlay = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    fixtureOverlayCalls.push(url);
    if (url === "fixtures/manifest.json") {
      return response({
        contractVersion: 1,
        documentIndex: [{
          id: "DOC-FIXTURE-001",
          access: "full",
          kind: "전자결재",
          title: "Captured ingest document"
        }]
      });
    }
    if (url === "fixtures/documents/index.json") {
      return response([{ id: "BASE-DOC", access: "full", title: "Base document" }]);
    }
    throw new Error(`unexpected fixture overlay URL: ${url}`);
  }});
  const fixtureOverlayIndex = await fixtureWithOverlay.request("/api/documents");
  assert.deepEqual(fixtureOverlayIndex.map((document) => [document.id, document.access]), [
    ["BASE-DOC", "full"],
    ["DOC-FIXTURE-001", "full"]
  ], "fixture manifest document overlay was not merged into the canonical index");
  assert.deepEqual(fixtureOverlayCalls, [
    "fixtures/manifest.json",
    "fixtures/documents/index.json"
  ]);

  const overlayMergeCases = [{
    name: "base none cannot be elevated by overlay full",
    base: [{ id: "MERGED", access: "none", title: "Base denied" }],
    overlays: [{ id: "MERGED", access: "full", title: "Overlay full" }],
    expectedAccess: "none"
  }, {
    name: "overlay none revokes base full",
    base: [{ id: "MERGED", access: "full", title: "Base full" }],
    overlays: [{ id: "MERGED", access: "none", title: "Overlay denied" }],
    expectedAccess: "none"
  }, {
    name: "same-access duplicates collapse",
    base: [
      { id: "MERGED", access: "full", title: "Base first" },
      { id: "MERGED", access: "full", title: "Base second" }
    ],
    overlays: [{ id: "MERGED", access: "full", title: "Overlay full" }],
    expectedAccess: "full"
  }, {
    name: "conflicting overlays deny when full precedes none",
    base: [],
    overlays: [
      { id: "MERGED", access: "full", title: "Overlay full" },
      { id: "MERGED", access: "none", title: "Overlay none" }
    ],
    expectedAccess: "none"
  }, {
    name: "conflicting overlays deny when none precedes full",
    base: [],
    overlays: [
      { id: "MERGED", access: "none", title: "Overlay none" },
      { id: "MERGED", access: "full", title: "Overlay full" }
    ],
    expectedAccess: "none"
  }];
  for (const mergeCase of overlayMergeCases) {
    const mergeClient = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
      if (url === "fixtures/manifest.json") {
        return response({ contractVersion: 1, documentIndex: mergeCase.overlays });
      }
      if (url === "fixtures/documents/index.json") return response(mergeCase.base);
      throw new Error(`unexpected merge URL: ${url}`);
    }});
    const mergedIndex = await mergeClient.request("/api/documents");
    assert.equal(mergedIndex.length, 1, `${mergeCase.name}: canonical index was not unique`);
    assert.equal(mergedIndex[0].id, "MERGED", `${mergeCase.name}: wrong canonical ID`);
    assert.equal(mergedIndex[0].access, mergeCase.expectedAccess, mergeCase.name);
  }

  const localOverlayCalls = [];
  const fixtureWithLocalOverlay = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    localOverlayCalls.push(url);
    if (url === "fixtures/manifest.json") return response({ contractVersion: 1, documentIndex: [] });
    if (url === "fixtures/local-maintenance/ask/maintenance-plan.json") {
      return response({
        grounded: true,
        answer: ["Local maintenance answer"],
        knowledge: [],
        docs: [{ id: "PROC-MAINT-31100" }]
      });
    }
    if (url === "fixtures/documents/index.json") return response([]);
    if (url === "fixtures/local-maintenance/manifest.json") {
      return response({
        contractVersion: 1,
        localOnly: true,
        documentIndex: [{
          id: "PROC-MAINT-31100",
          access: "full",
          kind: "유지보수 절차",
          title: "Local maintenance procedure"
        }]
      });
    }
    if (url === "fixtures/local-maintenance/documents/PROC-MAINT-31100.json") {
      return response({
        doc: { id: "PROC-MAINT-31100", title: "Local maintenance procedure", text: "PRIVATE LOCAL BODY" },
        edges: []
      });
    }
    throw new Error(`unexpected local overlay URL: ${url}`);
  }});
  await fixtureWithLocalOverlay.request("/api/ask", { question: "정기점검보수 기본계획 수립 절차" });
  const localOverlayIndex = await fixtureWithLocalOverlay.request("/api/documents");
  assert.deepEqual(localOverlayIndex.map((document) => [document.id, document.access]), [
    ["PROC-MAINT-31100", "full"]
  ], "available local-maintenance fixture was not advertised through an explicit canonical overlay");
  assert(localOverlayCalls.includes("fixtures/local-maintenance/manifest.json"),
    "local overlay availability did not verify the private manifest");
  assert(localOverlayCalls.includes("fixtures/local-maintenance/documents/PROC-MAINT-31100.json"),
    "local overlay availability did not verify the private document");

  const deniedLocalOverlayCalls = [];
  const fixtureWithDeniedLocalOverlay = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    deniedLocalOverlayCalls.push(url);
    if (url === "fixtures/manifest.json") return response({ contractVersion: 1, documentIndex: [] });
    if (url === "fixtures/local-maintenance/ask/maintenance-plan.json") {
      return response({
        grounded: true,
        answer: ["Local maintenance metadata only"],
        knowledge: [],
        docs: [{ id: "PROC-MAINT-31100" }]
      });
    }
    if (url === "fixtures/documents/index.json") return response([]);
    if (url === "fixtures/local-maintenance/manifest.json") {
      return response({
        contractVersion: 1,
        localOnly: true,
        documentIndex: [{
          id: "PROC-MAINT-31100",
          access: "none",
          kind: "유지보수 절차",
          title: "Restricted local maintenance procedure"
        }]
      });
    }
    if (url === "fixtures/local-maintenance/documents/PROC-MAINT-31100.json") {
      return response({
        doc: { id: "PROC-MAINT-31100", text: "PRIVATE DENIED LOCAL BODY" },
        edges: []
      });
    }
    throw new Error(`unexpected denied local overlay URL: ${url}`);
  }});
  await fixtureWithDeniedLocalOverlay.request("/api/ask", { question: "정기점검보수 기본계획 수립 절차" });
  assert.deepEqual(
    (await fixtureWithDeniedLocalOverlay.request("/api/documents"))
      .map((document) => [document.id, document.access, document.title]),
    [["PROC-MAINT-31100", "none", "Restricted local maintenance procedure"]],
    "denied local overlay did not preserve denial metadata"
  );
  assert.equal(
    deniedLocalOverlayCalls.filter((url) =>
      url === "fixtures/local-maintenance/documents/PROC-MAINT-31100.json").length,
    0,
    "denied local overlay fetched private document detail"
  );

  const unavailableLocalOverlayCalls = [];
  const unavailableLocalOverlay = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    unavailableLocalOverlayCalls.push(url);
    if (url === "fixtures/manifest.json") return response({ contractVersion: 1, documentIndex: [] });
    if (url === "fixtures/local-maintenance/ask/maintenance-plan.json") {
      return response({
        grounded: true,
        answer: ["Local maintenance answer"],
        knowledge: [],
        docs: [{ id: "PROC-MAINT-31100" }]
      });
    }
    if (url === "fixtures/documents/index.json") return response([]);
    if (url === "fixtures/local-maintenance/manifest.json") return response({}, false, 404);
    throw new Error(`unavailable local overlay requested unexpected URL: ${url}`);
  }});
  await unavailableLocalOverlay.request("/api/ask", { question: "정기점검보수 기본계획 수립 절차" });
  assert.deepEqual(await unavailableLocalOverlay.request("/api/documents"), [],
    "adapter advertised a local-maintenance document without its manifest/document overlay");
  assert(unavailableLocalOverlayCalls.includes("fixtures/local-maintenance/manifest.json"),
    "adapter did not verify local overlay availability before omitting it");

  const fixtureActionCalls = [];
  const fixtureAction = createApiClient({ mode: "fixture", fetchImpl: async (url, options = {}) => {
    fixtureActionCalls.push({ url, method: options.method || "GET", body: options.body });
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ ok: true, text: "시연용 스캔 PDF 고정 텍스트", model: "fixture" });
  }});
  await fixtureAction.request("/api/extract", { filename: "private-scan.pdf", mime: "application/pdf", dataB64: "c2Vuc2l0aXZl" });
  assert(fixtureActionCalls.every((call) => call.method === "GET" && call.body === undefined), "fixture action body was sent to the fixture host");

  const localNotFound = {
    grounded: false,
    answer: ["관련 근거를 찾지 못했습니다."],
    knowledge: [],
    docs: []
  };
  const localFallbackCalls = [];
  const localFallback = createApiClient({ mode: "fixture", fetchImpl: async (url, options = {}) => {
    localFallbackCalls.push({ url, method: options.method || "GET", body: options.body });
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    if (url.endsWith("local-maintenance/ask/maintenance-plan.json")) return response({}, false, 404);
    if (url.endsWith("ask/not-found.json")) return response(localNotFound);
    throw new Error(`unexpected local fallback URL: ${url}`);
  }});
  assert.deepEqual(
    await localFallback.request("/api/ask", { question: "정기점검보수 기본계획 수립 절차" }),
    localNotFound
  );
  assert.deepEqual(
    localFallbackCalls.map((call) => call.url),
    [
      "fixtures/manifest.json",
      "fixtures/local-maintenance/ask/maintenance-plan.json",
      "fixtures/ask/not-found.json"
    ]
  );
  assert(localFallbackCalls.every((call) => call.method === "GET" && call.body === undefined), "local fixture fallback sent a request body");

  const localDocumentCalls = [];
  const missingLocalDocument = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    localDocumentCalls.push(url);
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({}, false, 404);
  }});
  await assert.rejects(
    () => missingLocalDocument.request("/api/documents/PROC-MAINT-31100"),
    /HTTP 404/
  );
  assert.deepEqual(localDocumentCalls, [
    "fixtures/manifest.json",
    "fixtures/local-maintenance/documents/PROC-MAINT-31100.json"
  ]);

  const invalidManifestCalls = [];
  const invalidManifest = createApiClient({ mode: "fixture", fetchImpl: async (url) => {
    invalidManifestCalls.push(url);
    return response({ contractVersion: 2 });
  }});
  await assert.rejects(() => invalidManifest.request("/api/summary"), /fixture contract mismatch/);
  assert.deepEqual(invalidManifestCalls, ["fixtures/manifest.json"], "invalid fixture manifest allowed a data request");

  const liveCalls = [];
  const live = createApiClient({ mode: "live", fetchImpl: async (url) => {
    liveCalls.push(url); return response({ versionLabel: "v2.4", docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  assert.equal((await live.request("/api/summary")).versionLabel, "v2.4");
  assert.deepEqual(liveCalls, ["/api/summary"]);

  const liveDocumentCalls = [];
  const liveDocuments = createApiClient({ mode: "live", fetchImpl: async (url) => {
    liveDocumentCalls.push(url);
    return response([
      { id: "LIVE-LEGACY", title: "Legacy live document" },
      { id: "LIVE-DENIED", title: "Denied live document", access: "none" }
    ]);
  }});
  assert.deepEqual(
    (await liveDocuments.request("/api/documents")).map((document) => [document.id, document.access]),
    [["LIVE-LEGACY", "full"], ["LIVE-DENIED", "none"]]
  );
  assert.deepEqual(liveDocumentCalls, ["/api/documents"]);

  const autoLiveDocuments = createApiClient({ mode: "auto", fetchImpl: async () => response([
    { id: "AUTO-LEGACY", title: "Legacy auto-live document" },
    { id: "AUTO-DENIED", title: "Denied auto-live document", access: "none" }
  ]) });
  assert.deepEqual(
    (await autoLiveDocuments.request("/api/documents")).map((document) => [document.id, document.access]),
    [["AUTO-LEGACY", "full"], ["AUTO-DENIED", "none"]]
  );

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

  const fallbackOnceCalls = [];
  const fallbackOnce = createApiClient({ mode: "auto", fetchImpl: async (url) => {
    fallbackOnceCalls.push(url);
    if (url === "/api/summary") throw new Error("network offline");
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  await fallbackOnce.request("/api/summary");
  await fallbackOnce.request("/api/summary");
  assert.equal(fallbackOnceCalls.filter((url) => url === "/api/summary").length, 1, "auto retried live after fallback");

  for (const badLiveResponse of [
    () => response({}, false, 503),
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad JSON"); } }),
    () => response({})
  ]) {
    const calls = [];
    const client = createApiClient({ mode: "auto", fetchImpl: async (url) => {
      calls.push(url);
      return badLiveResponse();
    }});
    await assert.rejects(() => client.request("/api/summary"));
    assert.deepEqual(calls, ["/api/summary"], "auto fell back after a non-connection live error");
    assert.equal(client.getStatus().activeMode, "auto");
    assert.equal(client.getStatus().source, "live");
  }

  const initialHttpThenOfflineCalls = [];
  const initialHttpThenOffline = createApiClient({ mode: "auto", fetchImpl: async (url) => {
    initialHttpThenOfflineCalls.push(url);
    if (initialHttpThenOfflineCalls.length === 1) return response({}, false, 503);
    throw new Error("network offline");
  }});
  await assert.rejects(() => initialHttpThenOffline.request("/api/summary"), /HTTP 503/);
  await assert.rejects(() => initialHttpThenOffline.request("/api/summary"), /network offline/);
  assert.deepEqual(initialHttpThenOfflineCalls, ["/api/summary", "/api/summary"]);
  assert.equal(initialHttpThenOffline.getStatus().activeMode, "auto");

  const firstLiveThenOfflineCalls = [];
  const firstLiveThenOffline = createApiClient({ mode: "auto", fetchImpl: async (url) => {
    firstLiveThenOfflineCalls.push(url);
    if (firstLiveThenOfflineCalls.length === 1) return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
    throw new Error("network offline");
  }});
  await firstLiveThenOffline.request("/api/summary");
  await assert.rejects(() => firstLiveThenOffline.request("/api/summary"), /network offline/);
  assert.deepEqual(firstLiveThenOfflineCalls, ["/api/summary", "/api/summary"]);
  assert.equal(firstLiveThenOffline.getStatus().activeMode, "live");

  const rejectedPaths = ["https://example.test/api/summary", "//example.test/api/summary", "/summary"];
  for (const path of rejectedPaths) {
    let calls = 0;
    const client = createApiClient({ mode: "live", fetchImpl: async () => { calls += 1; return response({}); } });
    await assert.rejects(() => client.request(path), /Invalid live API path/);
    assert.equal(calls, 0, `live fetched invalid path ${path}`);
  }

  const liveStatuses = [];
  const liveFailure = createApiClient({ mode: "live", onStatus: (status) => liveStatuses.push(status), fetchImpl: async () => response({}, false, 500) });
  await assert.rejects(() => liveFailure.request("/api/summary"), /HTTP 500/);
  assert.deepEqual(liveStatuses.at(-1), { requestedMode: "live", activeMode: "live", source: "live", error: "HTTP 500" });

  const fixtureStatuses = [];
  const fixtureFailure = createApiClient({ mode: "fixture", onStatus: (status) => fixtureStatuses.push(status), fetchImpl: async (url) => {
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({}, false, 503);
  }});
  await assert.rejects(() => fixtureFailure.request("/api/summary"), /HTTP 503/);
  assert.deepEqual(fixtureStatuses.at(-1), { requestedMode: "fixture", activeMode: "fixture", source: "fixture", error: "HTTP 503" });
  await assert.rejects(() => fixtureFailure.request("/api/documents/%E0%A4%A"), /Invalid fixture route/);
  assert.equal(fixtureFailure.getStatus().error, "Invalid fixture route for /api/documents/%E0%A4%A");

  const staleFixtureError = createApiClient({ mode: "auto", fetchImpl: async (url) => {
    if (url === "/api/summary") throw new Error("network offline");
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  await staleFixtureError.request("/api/summary");
  assert.equal(staleFixtureError.getStatus().error, null, "successful fixture response retained a stale live error");

  for (const fixtureBase of [
    "https://example.test/fixtures",
    "//example.test/fixtures",
    "/fixtures",
    "fixtures?cache=1",
    "fixtures#section",
    "../fixtures",
    "fixtures/../private",
    "fixtures/%2e%2e/private"
  ]) {
    let calls = 0;
    assert.throws(() => createApiClient({ mode: "fixture", fixtureBase, fetchImpl: async () => { calls += 1; return response({}); } }), /Invalid fixture base/);
    assert.equal(calls, 0, `unsafe fixture base fetched: ${fixtureBase}`);
  }

  const cyclicBody = {};
  cyclicBody.self = cyclicBody;
  let cyclicCalls = 0;
  const cyclicAuto = createApiClient({ mode: "auto", fetchImpl: async () => { cyclicCalls += 1; return response({}); } });
  await assert.rejects(() => cyclicAuto.request("/api/ask", cyclicBody), /circular/i);
  assert.equal(cyclicCalls, 0, "cyclic body attempted live or fixture fetch");
  assert.equal(cyclicAuto.getStatus().activeMode, "auto");
  assert.equal(cyclicAuto.getStatus().source, "live");

  const timeoutCalls = [];
  let timeoutSignalObserved = false;
  const timeoutAuto = createApiClient({ mode: "auto", timeoutMs: 5, fetchImpl: async (url, options) => {
    timeoutCalls.push(url);
    if (url === "/api/summary") {
      timeoutSignalObserved = Boolean(options && options.signal);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    if (url.endsWith("manifest.json")) return response({ contractVersion: 1 });
    return response({ docCount: 19, stats: { nodes: 193, edges: 938 } });
  }});
  assert.deepEqual(await timeoutAuto.request("/api/summary"), { docCount: 19, stats: { nodes: 193, edges: 938 } });
  assert(timeoutSignalObserved, "timeout fetch did not receive an abort signal");
  assert(timeoutCalls.includes("fixtures/manifest.json") && timeoutCalls.includes("fixtures/summary.json"), "timeout did not fall back to fixtures");
  console.log("API client contract passed");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
