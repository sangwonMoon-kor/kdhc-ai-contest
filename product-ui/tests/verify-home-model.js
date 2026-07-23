"use strict";
const assert = require("assert");
const { buildTwoWeekWindow, parseScheduleCandidate, buildCalendarEvents } = require("../home-model.js");
const workspaceModel = require("../workspace-model.js");

const window = buildTwoWeekWindow("2026-01-02", 0);
assert.deepEqual(
  { startISO: window.startISO, endISO: window.endISO, days: window.days.length, weeks: window.weeks.length },
  { startISO: "2025-12-28", endISO: "2026-01-10", days: 14, weeks: 2 },
  "two-week window starts on Sunday and contains 14 days"
);

assert.deepEqual(
  parseScheduleCandidate("업체 서류는 1월 8일까지 받기로 함", "2026-01-02"),
  { kind: "date", label: "업체 서류는 1월 8일까지 받기로 함", startISO: "2026-01-08", endISO: "2026-01-08", confirmed: false },
  "explicit Korean month/day produces a date candidate"
);
assert.deepEqual(
  parseScheduleCandidate("다음 주까지 준비", "2026-01-02"),
  { kind: "range", label: "다음 주까지 준비", startISO: "2026-01-04", endISO: "2026-01-10", confirmed: false },
  "next week remains a range candidate"
);
assert.equal(parseScheduleCandidate("업체에 확인 요청", "2026-01-02"), null, "undated text has no candidate");

const events = buildCalendarEvents([
  { id: "forecast", title: "월간 보고", due: "2026-01-06", repeat: true },
  {
    id: "multi-day",
    title: "현장 점검",
    calendarStart: "2026-01-05",
    due: "2026-01-09",
    records: [
      { id: "memo-with-date", text: "업체 방문", dateISO: "2026-01-07" },
      { id: "memo-with-range", text: "다음 주 현장 대응", startISO: "2026-01-04", endISO: "2026-01-10", calendarStatus: "confirmed" },
      { id: "memo-without-date", text: "현장에 문의" }
    ],
    scheduleCandidates: [
      { id: "candidate", kind: "date", label: "업체 서류", startISO: "2026-01-08", endISO: "2026-01-08", confirmed: false }
    ]
  }
], window);

assert(events.some((event) => event.kind === "deadline" && event.workId === "forecast" && event.startISO === "2026-01-06"), "forecast due creates a deadline event");
assert(events.some((event) => event.kind === "work" && event.workId === "multi-day" && event.startISO === "2026-01-05" && event.endISO === "2026-01-09"), "dated work creates a multi-day work event");
assert(events.some((event) => event.kind === "memo" && event.id === "memo-with-date" && event.startISO === "2026-01-07"), "dated memo creates a memo event");
assert(events.some((event) => event.kind === "memo" && event.id === "memo-with-range" && event.startISO === "2026-01-04" && event.endISO === "2026-01-10"), "confirmed range memo retains both dates");
assert(events.some((event) => event.kind === "candidate" && event.id === "candidate" && event.startISO === "2026-01-08"), "schedule candidate creates a candidate event");
assert(!events.some((event) => event.id === "memo-without-date"), "undated memo does not create a calendar event");

const scopedState = workspaceModel.createDemoState();
scopedState.works = [
  { id: "owner", title: "내 담당 업무", sectionId: "section-maintenance", departmentId: "dept-plant", relations: [{ personId: scopedState.currentPersonId, kind: "owner" }], schedule: { startISO: "2026-01-02", endISO: "2026-01-03", milestones: [] }, todos: [], records: [], sources: [] },
  { id: "participant", title: "내 참여 업무", sectionId: "section-maintenance", departmentId: "dept-plant", relations: [{ personId: scopedState.currentPersonId, kind: "participant" }], schedule: { startISO: "2026-01-04", endISO: "2026-01-05", milestones: [] }, todos: [], records: [], sources: [] },
  { id: "section-only", title: "과의 다른 업무", sectionId: "section-maintenance", departmentId: "dept-plant", relations: [{ personId: "person-other", kind: "owner" }], schedule: { startISO: "2026-01-04", endISO: "2026-01-05", milestones: [] }, todos: [], records: [], sources: [] },
  { id: "department-only", title: "타 과 업무", sectionId: "section-other", departmentId: "dept-plant", relations: [{ personId: "person-other", kind: "owner" }], schedule: { startISO: "2026-01-04", endISO: "2026-01-05", milestones: [] }, todos: [], records: [], sources: [] }
];
scopedState.personalSchedules = [{ id: "personal", title: "개인 일정", startISO: "2026-01-06", endISO: "2026-01-06", ownerId: scopedState.currentPersonId }];
const scopedEvents = workspaceModel.selectHomeEvents(scopedState, window);
assert.deepStrictEqual(scopedEvents.filter((event) => event.kind === "work").map((event) => event.workId), ["owner", "participant"], "home only includes personally related work");
assert(scopedEvents.some((event) => event.kind === "personal" && event.id === "personal"), "home includes the current person's private schedule");

console.log("Home model contract passed");
