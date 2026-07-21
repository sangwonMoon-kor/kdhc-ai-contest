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
