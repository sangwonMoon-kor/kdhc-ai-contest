"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parseScheduleCandidate } = require("../home-model.js");
const workspaceModel = require("../workspace-model.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8")
  .replace(/\nboot\(\);\s*$/, "")
  + "\nroute = function () {}; toast = function () {}; hideToast = function () {};"
  + "\nmodule.exports = { blankState, validWork, normalizeWork, loadState, seedFromForecast, applyRecordOrTodo, retarget, confirmScheduleCandidate, undoLast, setChooseWork: (next) => { chooseWork = next; }, getLastAction: () => lastAction, getState: () => S, setState: (state) => { S = state; } };";

function loadHomeState(storedState) {
  const values = new Map();
  if (storedState) values.set("jikmu.workbench.v1", typeof storedState === "string" ? storedState : JSON.stringify(storedState));
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
    OnMemoryWorkspaceModel: workspaceModel,
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
  const migrated = plain(homeState.loadState());
  assert.equal(migrated.v, 3, "v1 state migrates to workspace v3");
  assert.equal(migrated.currentPersonId, "person-kim-hannan");
  assert.equal(migrated.currentRoleId, "role-maintenance-planning");
  assert.equal(migrated.selectedWorkId, "work-1");
  assert.deepStrictEqual(migrated.works[0].todos, legacy.works[0].todos, "migration preserves todos");
  assert.deepStrictEqual(migrated.works[0].records, legacy.works[0].records, "migration preserves records");
  assert.deepStrictEqual(migrated.works[0].sources, legacy.works[0].sources, "migration preserves sources");
  assert.deepStrictEqual(plain(homeState.normalizeWork(legacy.works[0])), legacy.works[0], "normalization preserves a legacy work unchanged");
}

{
  const homeState = loadHomeState("{broken json");
  const recovered = plain(homeState.loadState());
  assert.equal(recovered.v, 3, "damaged storage recovers with a v3 demo state");
  assert(Array.isArray(recovered.works));
  assert(Array.isArray(recovered.personalSchedules));
}

{
  const scheduled = legacyWork({
    calendarStart: "2026-02-01",
    calendarCategory: "meeting",
    records: [{ id: "record-1", dateISO: "2026-02-03", calendarStatus: "confirmed" }],
    scheduleCandidates: [{ id: "candidate-1", kind: "date", label: "운영부 일정", startISO: "2026-02-03", endISO: "2026-02-03", confirmed: false }],
  });
  const homeState = loadHomeState({ v: 1, works: [scheduled], selectedWorkId: scheduled.id });
  const migrated = plain(homeState.loadState().works[0]);
  assert.equal(migrated.id, scheduled.id);
  assert.equal(migrated.due, scheduled.due);
  assert.deepStrictEqual(migrated.sources, scheduled.sources);
  assert.deepStrictEqual(migrated.scheduleCandidates, scheduled.scheduleCandidates, "migration keeps calendar candidates");
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
  homeState.undoLast();
  assert.deepStrictEqual(plain(homeState.getState().works[0].records), [], "undo removes the linked dated record");
  assert.deepStrictEqual(plain(homeState.getState().works[0].scheduleCandidates), [], "undo removes the linked schedule candidate");
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

{
  const oldWork = legacyWork({
    id: "old-work",
    records: [{ id: "dated-record", kind: "decision", text: "2026-02-03 운영부 일정 확정" }],
    scheduleCandidates: [{ id: "dated-candidate", kind: "date", label: "2026-02-03 운영부 일정 확정", startISO: "2026-02-03", endISO: "2026-02-03", confirmed: false }],
  });
  const newWork = legacyWork({ id: "new-work", title: "새 업무" });
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [oldWork, newWork], selectedWorkId: oldWork.id });
  homeState.setChooseWork((_title, onPick) => onPick(newWork));
  homeState.retarget({ type: "addRecord", workId: oldWork.id, recId: "dated-record", candidateId: "dated-candidate" });
  assert.deepStrictEqual(plain(oldWork.records), [], "retarget removes the dated record from the old work");
  assert.deepStrictEqual(plain(oldWork.scheduleCandidates), [], "retarget removes the linked candidate from the old work");
  assert.deepStrictEqual(plain(newWork.records.map((record) => record.id)), ["dated-record"], "retarget adds the dated record to the new work");
  assert.deepStrictEqual(plain(newWork.scheduleCandidates.map((candidate) => candidate.id)), ["dated-candidate"], "retarget moves the linked candidate to the new work");
  homeState.confirmScheduleCandidate(newWork.id, "dated-candidate");
  assert.equal(newWork.scheduleCandidates[0].confirmed, true, "the moved candidate confirms on the new work");
  assert.equal(oldWork.records.length, 0, "confirmation does not create a schedule record on the old work");
  assert.equal(newWork.records.filter((record) => record.kind === "schedule").length, 1, "confirmation creates its schedule record on the new work");
  homeState.undoLast();
  assert.equal(newWork.scheduleCandidates[0].confirmed, false, "undo restores the moved candidate on the new work");
  assert.equal(newWork.records.filter((record) => record.kind === "schedule").length, 0, "undo removes the new work confirmation record");
}

{
  const oldWork = legacyWork({ id: "old-work", todos: [{ id: "undated-todo", text: "업체에 확인하기", done: false, candidate: true, evidence: [] }] });
  const newWork = legacyWork({ id: "new-work", title: "새 업무" });
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [oldWork, newWork], selectedWorkId: oldWork.id });
  homeState.setChooseWork((_title, onPick) => onPick(newWork));
  homeState.retarget({ type: "addTodo", workId: oldWork.id, todoId: "undated-todo" });
  assert.deepStrictEqual(plain(oldWork.todos), [], "undated retarget removes the todo from the old work");
  assert.deepStrictEqual(plain(newWork.todos.map((todo) => todo.id)), ["undated-todo"], "undated retarget keeps moving the todo to the new work");
  assert.equal(newWork.scheduleCandidates, undefined, "undated retarget does not invent a schedule candidate");
}

{
  const oldWork = legacyWork({
    id: "old-work",
    records: [{ id: "dated-record", kind: "decision", text: "2026-02-03 운영부 일정 확정" }],
    scheduleCandidates: [{ id: "dated-candidate", kind: "date", label: "2026-02-03 운영부 일정 확정", startISO: "2026-02-03", endISO: "2026-02-03", confirmed: false }],
  });
  const newWork = legacyWork({ id: "new-work", title: "새 업무" });
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [oldWork, newWork], selectedWorkId: oldWork.id });
  homeState.setChooseWork((_title, onPick) => onPick(newWork));
  homeState.retarget({ type: "addRecord", workId: oldWork.id, recId: "dated-record", candidateId: "dated-candidate" });
  homeState.undoLast();
  assert.deepStrictEqual(plain(newWork.records), [], "retarget undo removes the moved record from the new work");
  assert.deepStrictEqual(plain(newWork.scheduleCandidates), [], "retarget undo removes the moved candidate from the new work");
  assert.deepStrictEqual(plain(oldWork.scheduleCandidates), [], "retarget undo does not leave the candidate on the old work");
}

{
  const oldWork = legacyWork({ id: "old-work" });
  const newWork = legacyWork({ id: "new-work", title: "새 업무" });
  const homeState = loadHomeState();
  homeState.setState({ v: 1, works: [oldWork, newWork], selectedWorkId: oldWork.id });
  homeState.applyRecordOrTodo("2026-02-03 운영부 일정 확정", "record", oldWork, null, "2026-01-02");
  const stateBeforeCancel = plain(homeState.getState());
  const actionBeforeCancel = plain(homeState.getLastAction());
  let pickerCallback = null;
  homeState.setChooseWork((_title, onPick) => { pickerCallback = onPick; });
  homeState.retarget(actionBeforeCancel);
  assert.equal(typeof pickerCallback, "function", "retarget opens a picker before it changes work ownership");
  assert.deepStrictEqual(plain(homeState.getState()), stateBeforeCancel, "cancelling the retarget picker keeps the original record and candidate");
  assert.deepStrictEqual(plain(homeState.getLastAction()), actionBeforeCancel, "cancelling the retarget picker keeps the original undo action");
}

console.log("Home state contract passed");
