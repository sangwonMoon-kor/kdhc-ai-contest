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

  function fixtureId(path, prefix) {
    try {
      return cleanId(decodeURIComponent(path.slice(prefix.length)));
    } catch (error) {
      throw new Error(`Invalid fixture route for ${path}`);
    }
  }

  function isLiveApiPath(path) {
    return typeof path === "string" && (path === "/api" || path.startsWith("/api/"));
  }

  function connectionFailure(error, timedOut) {
    const message = timedOut ? "Request timed out" : String(error && (error.message || error) || "Connection failed");
    const failure = new Error(message);
    failure.connectionFailure = true;
    return failure;
  }

  function isConnectionFailure(error) {
    return Boolean(error && error.connectionFailure);
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
    if (path.startsWith("/api/documents/")) return `documents/${fixtureId(path, "/api/documents/")}.json`;
    if (path.startsWith("/api/okf/")) return `okf/${fixtureId(path, "/api/okf/")}.json`;
    if (path === "/api/ask") return /펌프|정비|추진\s*보고/.test(String(body && body.question || "")) ? "ask/pump-report.json" : "ask/not-found.json";
    if (path === "/api/draft" && body && body.task === "design-and-costing") return "draft/design-and-costing.json";
    if (path === "/api/check") return /확인\s*필요|그대로\s*준용|특정\s*모델|구두\s*지시|검수\s*전/.test(String(body && body.text || "")) ? "check/pump-risky-draft.json" : "check/clean-draft.json";
    return null;
  }

  function createApiClient(options = {}) {
    const requestedMode = MODES.has(options.mode) ? options.mode : "auto";
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const fixtureBase = String(options.fixtureBase || "fixtures").replace(/\/$/, "");
    const configuredTimeoutMs = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 20000;
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    let activeMode = requestedMode;
    let source = requestedMode === "fixture" ? "fixture" : "live";
    let lastError = null;
    let manifestPromise = null;
    let hasAttemptedLive = false;

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
        let response;
        try {
          response = await fetchImpl(url, body ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
          } : { signal: controller.signal });
        } catch (error) {
          throw connectionFailure(error, controller.signal.aborted || (error && error.name === "AbortError"));
        }
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
      try {
        const rel = fixturePath(path, body);
        if (!rel) throw new Error(`No fixture route for ${path}`);
        await ensureManifest();
        const data = normalizeResponse(path, await getJSON(`${fixtureBase}/${rel}`));
        activeMode = "fixture";
        source = "fixture";
        lastError = null;
        publish();
        return data;
      } catch (error) {
        activeMode = "fixture";
        source = "fixture";
        lastError = error;
        publish();
        throw error;
      }
    }

    async function liveRequest(path, body) {
      if (!isLiveApiPath(path)) throw new Error(`Invalid live API path: ${path}`);
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
        hasAttemptedLive = true;
        try {
          return await liveRequest(path, body);
        } catch (error) {
          lastError = error;
          source = "live";
          publish();
          throw error;
        }
      }
      const isInitialLiveAttempt = !hasAttemptedLive;
      hasAttemptedLive = true;
      try {
        return await liveRequest(path, body);
      } catch (error) {
        lastError = error;
        source = "live";
        publish();
        if (!isInitialLiveAttempt || !isConnectionFailure(error)) throw error;
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
