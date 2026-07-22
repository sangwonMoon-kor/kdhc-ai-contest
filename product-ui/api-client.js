(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.JikmuApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODES = new Set(["fixture", "live", "auto"]);
  const FIXTURE_DRAFT_STAGES = new Set(["design-and-costing", "problem-recognition"]);
  const LOCAL_MAINTENANCE_ASK = "local-maintenance/ask/maintenance-plan.json";
  const LOCAL_MAINTENANCE_DOCUMENT_ID = "PROC-MAINT-31100";

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

  function safeFixtureBase(value) {
    const base = String(value || "fixtures").replace(/\/+$/, "");
    const segments = base.split("/");
    let decodedSegments;
    try {
      decodedSegments = segments.map((segment) => decodeURIComponent(segment));
    } catch (error) {
      throw new Error(`Invalid fixture base: ${value}`);
    }
    if (!base || base.startsWith("/") || base.includes("?") || base.includes("#") || base.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(base) || decodedSegments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))) {
      throw new Error(`Invalid fixture base: ${value}`);
    }
    return base;
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

  function nonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }

  function canonicalDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validForecastItem(item) {
    return Boolean(
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      nonEmptyString(item.name) &&
      nonEmptyString(item.task) &&
      typeof item.stageId === "string" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.stageId) &&
      Number.isInteger(item.month) && item.month >= 1 && item.month <= 12 &&
      canonicalDate(item.lastDate) &&
      canonicalDate(item.dueDate) &&
      Number.isInteger(item.dday) &&
      Number.isInteger(item.docCount) && item.docCount >= 0 &&
      Array.isArray(item.docs) && item.docs.length > 0 && item.docs.every(nonEmptyString)
    );
  }

  function normalizeResponse(path, value) {
    if (path === "/api/documents") {
      if (!Array.isArray(value)) throw new Error("documents contract mismatch");
      return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`response contract mismatch for ${path}`);
    }
    if (path.startsWith("/api/documents/") && !(value.doc && typeof value.doc.id === "string" && Array.isArray(value.edges))) throw new Error("document detail contract mismatch");
    if (path.startsWith("/api/okf/") && typeof value.id !== "string") throw new Error("OKF detail contract mismatch");
    if (path === "/api/summary" && !(Number.isInteger(value.docCount) && value.stats && Number.isInteger(value.stats.nodes) && Number.isInteger(value.stats.edges))) throw new Error("summary contract mismatch");
    if (path === "/api/forecast" && !(Array.isArray(value.items) && value.items.every(validForecastItem))) throw new Error("forecast contract mismatch");
    if (path === "/api/briefing" && !(Array.isArray(value.stages) && Array.isArray(value.cautions))) throw new Error("briefing contract mismatch");
    if (path === "/api/graph" && !(Array.isArray(value.nodes) && Array.isArray(value.edges))) throw new Error("graph contract mismatch");
    if (path === "/api/ask" && !(typeof value.grounded === "boolean" && Array.isArray(value.answer) && Array.isArray(value.docs))) throw new Error("ask contract mismatch");
    if (path === "/api/draft" && !(typeof value.ok === "boolean" && (value.ok
      ? typeof value.stageId === "string" && typeof value.baseDocId === "string" && typeof value.title === "string" && Array.isArray(value.sections) && Array.isArray(value.checklist)
      : typeof value.reason === "string"))) throw new Error("draft contract mismatch");
    if (path === "/api/check" && !(Number.isInteger(value.count) && Array.isArray(value.findings))) throw new Error("check contract mismatch");
    if (path === "/api/hint/stage" && !(value.guard && typeof value.guard.flagged === "boolean" && Array.isArray(value.triples))) throw new Error("hint stage contract mismatch");
    if (path === "/api/hint/commit" && !(typeof value.ok === "boolean" && (value.ok ? value.hint && typeof value.hint === "object" : typeof value.reason === "string"))) throw new Error("hint commit contract mismatch");
    if (path === "/api/ingest" && !(value.doc && typeof value.doc.id === "string" && Array.isArray(value.triples) && (value.caseProposal == null || typeof value.caseProposal === "object"))) throw new Error("ingest contract mismatch");
    if (path === "/api/ingest/commit" && !(typeof value.ok === "boolean" && (value.ok ? value.doc && typeof value.doc.id === "string" : typeof value.reason === "string"))) throw new Error("ingest commit contract mismatch");
    if (path === "/api/extract" && !(typeof value.ok === "boolean" && (value.ok ? typeof value.text === "string" : typeof value.reason === "string"))) throw new Error("extract contract mismatch");
    return value;
  }

  function isMaintenancePlanningQuestion(value) {
    const question = String(value || "");
    if (question.includes("정기점검보수")) return /(계획|수립|절차|범위|항목)/.test(question);
    return question.includes("유지보수") && /(계획|수립|절차)/.test(question);
  }

  function fixturePath(path, body) {
    if (path === "/api/summary") return "summary.json";
    if (path === "/api/forecast") return "forecast.json";
    if (path === "/api/briefing") return "briefing.json";
    if (path === "/api/graph") return "graph.json";
    if (path === "/api/documents") return "documents/index.json";
    if (path === `/api/documents/${LOCAL_MAINTENANCE_DOCUMENT_ID}`) return `local-maintenance/documents/${LOCAL_MAINTENANCE_DOCUMENT_ID}.json`;
    if (path.startsWith("/api/documents/")) return `documents/${fixtureId(path, "/api/documents/")}.json`;
    if (path.startsWith("/api/okf/")) return `okf/${fixtureId(path, "/api/okf/")}.json`;
    if (path === "/api/ask") {
      const question = String(body && body.question || "");
      if (isMaintenancePlanningQuestion(question)) return LOCAL_MAINTENANCE_ASK;
      return /펌프|정비|추진\s*보고/.test(question) ? "ask/pump-report.json" : "ask/not-found.json";
    }
    if (path === "/api/draft" && body && FIXTURE_DRAFT_STAGES.has(body.task)) return `draft/${body.task}.json`;
    if (path === "/api/check") return /확인\s*필요|그대로\s*준용|특정\s*모델|구두\s*지시|검수\s*전/.test(String(body && body.text || "")) ? "check/pump-risky-draft.json" : "check/clean-draft.json";
    if (path === "/api/hint/stage") return "hint/stage.json";
    if (path === "/api/hint/commit") return "hint/commit.json";
    if (path === "/api/ingest") return "ingest/stage.json";
    if (path === "/api/ingest/commit") return "ingest/commit.json";
    if (path === "/api/extract") return "extract/scanned-pdf.json";
    return null;
  }

  function createApiClient(options = {}) {
    const requestedMode = MODES.has(options.mode) ? options.mode : "auto";
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const fixtureBase = safeFixtureBase(options.fixtureBase);
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
        const requestOptions = body ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        } : { signal: controller.signal };
        let response;
        try {
          response = await fetchImpl(url, requestOptions);
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
        let value;
        try {
          value = await getJSON(`${fixtureBase}/${rel}`);
        } catch (error) {
          if (rel !== LOCAL_MAINTENANCE_ASK || error.message !== "HTTP 404") throw error;
          value = await getJSON(`${fixtureBase}/ask/not-found.json`);
        }
        const data = normalizeResponse(path, value);
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
