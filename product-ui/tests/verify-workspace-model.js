"use strict";

const assert = require("assert");
const model = require("../workspace-model.js");

const context = model.createDemoContext();
const migrated = model.migrateState({
  v: 1,
  selectedWorkId: "work-a",
  works: [{ id: "work-a", title: "정기점검", todos: [], records: [], sources: [] }]
}, context);

assert.equal(migrated.v, 2);
assert.equal(migrated.currentPersonId, "person-kim-hannan");
assert.equal(migrated.currentRoleId, "role-maintenance-planning");
assert.equal(migrated.selectedWorkId, "work-a");
assert.equal(migrated.works[0].id, "work-a");
assert(Array.isArray(migrated.personalSchedules));

const demo = model.createDemoState();
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
