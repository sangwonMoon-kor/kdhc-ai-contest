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

  function cleanId(value) {
    return encodeURIComponent(String(value || ""));
  }

  function normalizeResponse(path, value) {
    if (path === "/api/documents") {
      if (!Array.isArray(value)) throw new Error("documents contract mismatch");
      return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`response contract mismatch for ${path}`);
    }
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

    function status() {
      return {
        requestedMode,
        activeMode,
        source,
        error: lastError ? String(lastError.message || lastError) : null
      };
    }

    function publish() {
      onStatus(status());
    }

    async function getJSON(url, body) {
      if (!fetchImpl) throw new Error("fetch unavailable");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, body ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        } : { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      } finally {
        clearTimeout(timer);
      }
    }

    async function ensureManifest() {
      if (!manifestPromise) {
        manifestPromise = getJSON(`${fixtureBase}/manifest.json`).then((manifest) => {
          if (!manifest || manifest.contractVersion !== 1) throw new Error("fixture contract mismatch");
          return manifest;
        });
      }
      return manifestPromise;
    }

    async function fixtureRequest(path, body) {
      const rel = fixturePath(path, body);
      if (!rel) throw new Error(`No fixture route for ${path}`);
      await ensureManifest();
      const data = normalizeResponse(path, await getJSON(`${fixtureBase}/${rel}`));
      activeMode = "fixture";
      source = "fixture";
      publish();
      return data;
    }

    async function liveRequest(path, body) {
      const data = normalizeResponse(path, await getJSON(path, body));
      activeMode = "live";
      source = "live";
      lastError = null;
      publish();
      return data;
    }

    async function request(path, body) {
      if (activeMode === "fixture") return fixtureRequest(path, body);
      if (requestedMode === "live" || activeMode === "live") {
        try {
          return await liveRequest(path, body);
        } catch (error) {
          lastError = error;
          source = "live";
          publish();
          throw error;
        }
      }
      try {
        return await liveRequest(path, body);
      } catch (error) {
        lastError = error;
        activeMode = "fixture";
        source = "fixture";
        publish();
        return fixtureRequest(path, body);
      }
    }

    publish();
    return { request, getStatus: status };
  }

  return { createApiClient, modeFromSearch, fixturePath, normalizeResponse };
});
