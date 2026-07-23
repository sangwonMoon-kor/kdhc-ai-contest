"use strict";

const assert = require("assert");
const model = require("../workspace-model.js");

const context = model.createDemoContext();
const legacy = {
  v: 2,
  selectedWorkId: "work-a",
  works: [{
    id: "work-a",
    title: "열수송관 보수 설계",
    due: "2026-08-20",
    repeat: false,
    todos: [{ id: "todo-a", text: "현장 확인", done: false }],
    records: [{ id: "record-a", text: "도면 수령", ts: "2026-07-20T09:00:00.000Z" }],
    sources: [{ docId: "RULE-2026-0401", role: "공식 지침" }],
    draft: {
      savedAt: "2026-07-20T09:30:00.000Z",
      values: { p0: "보존할 입력값" },
      freeText: "보존할 자유 초안",
      reviewState: { status: "pending", comments: ["원문 유지"] }
    },
    schedule: { startISO: "2026-08-01", endISO: "2026-08-20", milestones: [], legacyLabel: "기존 일정" }
  }],
  completionBundles: [{
    id: "bundle-existing",
    workId: "work-completed",
    workSnapshot: {
      id: "work-completed",
      title: "기존 완료 업무",
      draft: { values: { p0: "완료 당시 초안" } }
    }
  }]
};
const migrated = model.migrateState(legacy, context);

assert.equal(migrated.v, 3);
assert.equal(migrated.currentPersonId, "person-kim-hannan");
assert.equal(migrated.currentRoleId, "role-maintenance-planning");
assert.equal(migrated.selectedWorkId, "work-a");
assert.equal(migrated.works[0].id, "work-a");
assert.equal(migrated.works[0].lifecycle.phase, "design");
assert.equal(migrated.works[0].lifecycle.designDeadlineISO, null);
assert.equal(migrated.works[0].output.mode, "new");
assert.equal(migrated.works[0].due, "2026-08-20");
assert.deepStrictEqual(migrated.works[0].todos, legacy.works[0].todos);
assert.deepStrictEqual(migrated.works[0].records, legacy.works[0].records);
assert.deepStrictEqual(migrated.works[0].sources, legacy.works[0].sources);
assert.deepStrictEqual(migrated.works[0].draft, legacy.works[0].draft);
assert.deepStrictEqual(migrated.works[0].schedule, legacy.works[0].schedule);
assert.deepStrictEqual(migrated.completionBundles, legacy.completionBundles);
migrated.completionBundles[0].workSnapshot.draft.values.p0 = "외부 변경";
assert.equal(legacy.completionBundles[0].workSnapshot.draft.values.p0, "완료 당시 초안",
  "completion bundle migration did not deep-copy nested draft data");
assert(Array.isArray(migrated.personalSchedules));

const demo = model.createDemoState();
const defaultRecurring = demo.works.find((work) => work.id === "work-maintenance-plan-2026");
assert.equal(defaultRecurring.stageId, "design-and-costing",
  "default recurring work points at a stage without a draft fixture");
assert.equal(defaultRecurring.due, "2026-07-30",
  "default recurring work legacy schedule conflicts with its confirmed July 30 design deadline");
assert.equal(defaultRecurring.schedule.endISO, "2026-07-30",
  "default recurring work schedule conflicts with its confirmed July 30 design deadline");
const events = model.selectScheduleEvents(demo, {
  startISO: "2026-01-01",
  endISO: "2026-12-31"
}, ["mine", "section", "department"]);
const workEvents = events.filter((event) => event.kind === "work");

assert.equal(new Set(workEvents.map((event) => event.workId)).size, workEvents.length);
assert(events.some((event) => event.visibleScopes.includes("mine") && event.primaryScope === "mine"));
assert(events.some((event) => event.kind === "personal"));

const homeEvents = model.selectHomeEvents(demo, {
  startISO: "2026-01-01",
  endISO: "2026-12-31"
});
assert(homeEvents.every((event) => event.kind === "personal" || event.visibleScopes.includes("mine")));

const toggled = model.toggleScheduleScope(["mine"], "section");
assert.deepStrictEqual(toggled, ["mine", "section"]);
assert.deepStrictEqual(model.toggleScheduleScope(toggled, "mine"), ["section"]);

console.log("Workspace model contract passed");
