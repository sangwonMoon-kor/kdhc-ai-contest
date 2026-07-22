"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parseScheduleCandidate } = require("../home-model.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8")
  .replace(/\nboot\(\);\s*$/, "")
  + "\nroute = function () {}; toast = function () {}; hideToast = function () {};"
  + "\nmodule.exports = { blankState, validWork, normalizeWork, loadState, seedFromForecast, applyRecordOrTodo, confirmScheduleCandidate, undoLast, getState: () => S, setState: (state) => { S = state; } };";

function loadHomeState(storedState) {
  const values = new Map();
  if (storedState) values.set("jikmu.workbench.v1", JSON.stringify(storedState));
  const localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const document = {
    querySelector: () => ({ hidden: true, innerHTML: "", onclick: null }),
    querySelectorAll: () => [],
    body: { contains: () => true },
  };
  const window = {
    JikmuApi: { createApiClient: () => ({ request: async () => ({}) }), modeFromSearch: () => "fixture" },
    JikmuHomeModel: { parseScheduleCandidate },
    addEventListener: () => {},
  };
  const sandbox = {
    module: { exports: {} }, exports: {}, window, document, localStorage,
    location: { search: "", hash: "#home", replace: () => {} },
    matchMedia: () => ({ matches: false }), setTimeout: () => 0, clearTimeout: () => {},
    console, Map, Date, JSON, String, Array, Object, Math, RegExp, Error, CSS: { escape: (value) => value },
  };
  vm.runInNewContext(appSource, sandbox, { filename: "app.js" });
  return sandbox.module.exports;
}

function legacyWork(overrides) {
  return Object.assign({
    id: "work-1", title: "기존 업무", todos: [], records: [], sources: [],
  }, overrides);
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

{
  const legacy = { v: 1, works: [legacyWork()], selectedWorkId: "work-1" };
  const homeState = loadHomeState(legacy);
  assert.deepStrictEqual(plain(homeState.loadState()), legacy, "v1 work remains valid without calendar fields");
  assert.deepStrictEqual(plain(homeState.normalizeWork(legacy.works[0])), legacy.works[0], "normalization preserves a legacy work unchanged");
}

{
  const scheduled = legacyWork({
    calendarStart: "2026-02-01",
    calendarCategory: "meeting",
    records: [{ id: "record-1", dateISO: "2026-02-03", calendarStatus: "confirmed" }],
    scheduleCandidates: [{ id: "candidate-1", kind: "date", label: "운영부 일정", startISO: "2026-02-03", endISO: "2026-02-03", confirmed: false }],
  });
  const homeState = loadHomeState({ v: 1, works: [scheduled], selectedWorkId: scheduled.id });
  assert.deepStrictEqual(plain(homeState.loadState().works[0]), scheduled, "normalization keeps optional calendar and candidate fields");
}

{
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [], selectedWorkId: null });
  homeState.seedFromForecast({ items: [{
    stageId: "pump", month: 4, name: "펌프 정비", task: "설계", dueDate: "2026-04-09", docCount: 1, docs: ["APPR-2025-0409"],
  }] }, "2026-01-02");
  const forecast = homeState.getState().works[0];
  assert.equal(forecast.due, "2026-04-09", "forecast seed keeps its due date");
  assert.deepStrictEqual(plain(forecast.sources), [{ docId: "APPR-2025-0409", role: "과거 문서" }], "forecast seed keeps source document IDs");
  assert.equal(forecast.calendarStart, undefined, "forecast seed does not infer a calendar start date");
}

{
  const work = legacyWork();
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [work], selectedWorkId: work.id });
  homeState.applyRecordOrTodo("2026-02-03 운영부 일정 확정", "record", work, null, "2026-01-02");
  const candidate = homeState.getState().works[0].scheduleCandidates[0];
  assert.deepStrictEqual(
    Object.assign({}, candidate, { id: undefined }),
    { id: undefined, kind: "date", label: "2026-02-03 운영부 일정 확정", startISO: "2026-02-03", endISO: "2026-02-03", confirmed: false },
    "a dated record stores a schedule candidate only after it is linked to work"
  );
}

{
  const work = legacyWork({ scheduleCandidates: [{
    id: "candidate-1", kind: "range", label: "다음 주 운영부 일정 확정", startISO: "2026-02-08", endISO: "2026-02-14", confirmed: false,
  }] });
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [work], selectedWorkId: work.id });
  homeState.confirmScheduleCandidate(work.id, "candidate-1");
  const confirmed = homeState.getState().works[0];
  assert.equal(confirmed.scheduleCandidates[0].confirmed, true, "confirmation marks the candidate as confirmed");
  assert.deepStrictEqual(
    plain(confirmed.records.map(({ id, ts, kind, text, dateISO, startISO, endISO, calendarStatus }) => ({ kind, text, dateISO, startISO, endISO, calendarStatus }))),
    [{ kind: "schedule", text: "다음 주 운영부 일정 확정", dateISO: "2026-02-08", startISO: "2026-02-08", endISO: "2026-02-14", calendarStatus: "confirmed" }],
    "confirmation preserves the candidate range on its execution record"
  );
  homeState.undoLast();
  assert.equal(confirmed.scheduleCandidates[0].confirmed, false, "undo restores the candidate confirmation state");
  assert.deepStrictEqual(plain(confirmed.records), [], "undo removes the confirmation record");
}

console.log("Home state contract passed");
