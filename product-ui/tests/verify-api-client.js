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
