"use strict";

const assert = require("assert");
const model = require("../workbench-model.js");

assert.deepStrictEqual(model.headlineFor({
  lifecycle: { phase: "design", designDeadlineISO: "2026-07-30", completionDateISO: null }
}, "2026-07-23"), {
  phaseKey: "design",
  phaseLabel: "설계",
  dateLabel: "설계 발송일",
  dateISO: "2026-07-30",
  dday: 7,
  isComplete: false
});

const referenceWork = {
  sources: [
    { docId: "rule", category: "official" },
    { docId: "old", category: "memory" },
    { docId: "unknown" }
  ]
};
const split = model.partitionReferences(referenceWork);
assert.deepStrictEqual(split.official.map((item) => item.docId), ["rule"]);
assert.deepStrictEqual(split.memory.map((item) => item.docId), ["old", "unknown"]);
assert.equal(split.memory[1].needsClassification, true);
assert.equal(referenceWork.sources[2].needsClassification, undefined);

assert.deepStrictEqual(
  model.resolveReferenceAccess(
    { docId: "restricted", access: "full" },
    { id: "restricted", access: "none" }
  ),
  { docId: "restricted", access: "none", canReadBody: false, isKnown: true },
  "stale persisted access overrode the current canonical denial"
);
assert.deepStrictEqual(
  model.resolveReferenceAccess({ docId: "missing", access: "full" }, null),
  { docId: "missing", access: "none", canReadBody: false, isKnown: false },
  "missing canonical access failed open"
);
assert.deepStrictEqual(
  model.resolveReferenceAccess(
    { docId: "readable", access: "none" },
    { id: "readable", access: "full" }
  ),
  { docId: "readable", access: "full", canReadBody: true, isKnown: true },
  "current canonical access was not authoritative"
);

const note = model.createProgressNote("7월 30일 도면 발송", "2026-07-23T10:00:00.000Z", []);
assert.equal(note.text, "7월 30일 도면 발송");
assert.equal(note.analysis.status, "empty");
assert.equal(note.id, model.createProgressNote("7월 30일 도면 발송", "2026-07-23T10:00:00.000Z", []).id);

const candidates = model.analyzeProgressText("7월 30일 도면 발송을 확정하고 담당자에게 확인 요청", {
  parseDate: () => "2026-07-30"
});
assert.deepStrictEqual(candidates.map((candidate) => candidate.type), ["schedule", "decision", "followup"]);
assert(candidates.every((candidate) => candidate.status === "proposed"));
assert.equal(candidates[0].dateISO, "2026-07-30");

const scheduleCandidate = model.analyzeProgressText("다음 주 도면 준비", {
  parseScheduleCandidate: () => ({ startISO: "2026-07-30", endISO: "2026-08-05" })
})[0];
assert.equal(scheduleCandidate.type, "schedule");
assert.equal(scheduleCandidate.dateISO, "2026-07-30");

const progressing = {
  id: "work-progress",
  records: [model.createProgressNote("일정 확인", "2026-07-23T10:00:00.000Z", candidates)],
  schedule: { milestones: [] },
  todos: []
};
const scheduled = model.confirmProgressCandidate(progressing, progressing.records[0].id, candidates[0].id);
assert.equal(scheduled.schedule.milestones.length, 1);
assert.equal(progressing.schedule.milestones.length, 0);
assert.equal(scheduled.records[0].text, "일정 확인");
assert.equal(scheduled.records[0].analysis.candidates[0].status, "confirmed");

const followedUp = model.confirmProgressCandidate(progressing, progressing.records[0].id, candidates[2].id);
assert.equal(followedUp.todos.length, 1);
assert.equal(followedUp.todos[0].candidate, false);

const repeatedCandidates = model.analyzeProgressText("7월 30일 도면 확인 요청", {
  parseDate: () => "2026-07-30"
});
const repeatedNotesWork = {
  id: "work-repeated-notes",
  records: [
    model.createProgressNote("7월 30일 도면 확인 요청", "2026-07-23T10:00:00.000Z", repeatedCandidates),
    model.createProgressNote("7월 30일 도면 확인 요청", "2026-07-23T11:00:00.000Z", repeatedCandidates)
  ],
  schedule: { milestones: [] },
  todos: []
};
const repeatedScheduleCandidateId = repeatedCandidates.find((candidate) => candidate.type === "schedule").id;
const repeatedFollowupCandidateId = repeatedCandidates.find((candidate) => candidate.type === "followup").id;
let repeatedApplied = model.confirmProgressCandidate(
  repeatedNotesWork,
  repeatedNotesWork.records[0].id,
  repeatedScheduleCandidateId
);
repeatedApplied = model.confirmProgressCandidate(
  repeatedApplied,
  repeatedApplied.records[1].id,
  repeatedScheduleCandidateId
);
repeatedApplied = model.confirmProgressCandidate(
  repeatedApplied,
  repeatedApplied.records[0].id,
  repeatedFollowupCandidateId
);
repeatedApplied = model.confirmProgressCandidate(
  repeatedApplied,
  repeatedApplied.records[1].id,
  repeatedFollowupCandidateId
);
assert.equal(new Set(repeatedApplied.schedule.milestones.map((milestone) => milestone.id)).size, 2,
  "identical notes produced duplicate applied milestone IDs");
assert.equal(new Set(repeatedApplied.todos.map((todo) => todo.id)).size, 2,
  "identical notes produced duplicate applied todo IDs");
const firstRepeatedTodo = repeatedApplied.todos.find((todo) => todo.sourceNoteId === repeatedApplied.records[0].id);
const secondRepeatedTodo = repeatedApplied.todos.find((todo) => todo.sourceNoteId === repeatedApplied.records[1].id);
repeatedApplied.todos.find((todo) => todo.id === firstRepeatedTodo.id).done = true;
assert.equal(firstRepeatedTodo.done, true);
assert.equal(secondRepeatedTodo.done, false, "toggling one identical note's todo also toggled the other");

const headlineBeforeCandidate = {
  phase: "design",
  designDeadlineISO: "2026-08-14",
  completionDateISO: null
};
const scheduleOnlyWork = {
  id: "work-schedule-only",
  lifecycle: headlineBeforeCandidate,
  records: [model.createProgressNote("7월 30일까지 도면을 발송", "2026-07-23T10:30:00.000Z", [scheduleCandidate])],
  schedule: { milestones: [] },
  todos: []
};
assert.equal(scheduleOnlyWork.schedule.milestones.length, 0, "proposed schedule changed work before confirmation");
const scheduleOnlyConfirmed = model.confirmProgressCandidate(
  scheduleOnlyWork,
  scheduleOnlyWork.records[0].id,
  scheduleCandidate.id
);
assert.deepStrictEqual(scheduleOnlyConfirmed.lifecycle, headlineBeforeCandidate, "schedule candidate changed the headline date");
assert.equal(scheduleOnlyConfirmed.schedule.milestones.length, 1, "confirmed schedule was not added as a milestone");
assert.equal(scheduleOnlyWork.schedule.milestones.length, 0, "confirmation mutated the original work");

const failedRawText = "분석 실패에도 원문은 저장";
let failedNote;
try {
  model.analyzeProgressText(failedRawText, {
    parseScheduleCandidate: () => { throw new Error("forced analysis failure"); }
  });
  assert.fail("forced progress analysis did not fail");
} catch (error) {
  failedNote = model.createProgressNote(failedRawText, "2026-07-23T10:45:00.000Z", []);
  failedNote.analysis = {
    status: "failed",
    error: String(error.message || error),
    candidates: [],
    confirmedCandidateIds: []
  };
}
assert.equal(failedNote.text, failedRawText);
assert.equal(failedNote.analysis.status, "failed");
assert.equal(failedNote.analysis.error, "forced analysis failure");

const state = {
  v: 3,
  currentPersonId: "person-kim-hannan",
  works: [{
    id: "work-a",
    title: "열수송관 보수 설계",
    lifecycle: {
      phase: "design",
      designDeadlineISO: "2026-07-30",
      completionDateISO: null,
      completedAtISO: null,
      completedBy: null
    },
    output: { mode: "new", templateId: null, priorDocumentId: null, finalDocumentId: null },
    todos: [{ id: "todo-open", text: "현장 확인", done: false }],
    records: [note],
    sources: []
  }],
  completionBundles: []
};
assert.equal(model.completionReadiness(state.works[0]).ready, false);
assert.equal(model.completionReadiness({ todos: [{ id: "proposal", done: false, candidate: true }] }).ready, true);
assert.deepStrictEqual(model.selectWorkList(state, "active").map((work) => work.id), ["work-a"]);
assert.deepStrictEqual(model.selectWorkList({
  works: [
    { id: "missing-lifecycle" },
    { id: "unknown-phase", lifecycle: { phase: "paused" } },
    { id: "done", lifecycle: { phase: "done" } }
  ]
}, "active").map((work) => work.id), ["missing-lifecycle", "unknown-phase"],
"every work not explicitly done must remain in the active list");
assert.throws(() => model.completeWork(state, "work-a", {
  completedAtISO: "2026-07-23T10:59:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-07-23",
  acknowledgeIncomplete: false
}), /acknowledged/, "incomplete follow-ups can be completed without acknowledgement");
assert.throws(() => model.completeWork(state, "work-a", {
  completedAtISO: "2026-02-30T10:59:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-07-23",
  acknowledgeIncomplete: true
}), /Valid ISO completion time/, "normalized nonexistent completion timestamp was accepted");
assert.throws(() => model.completeWork(state, "work-a", {
  completedAtISO: "2026-07-23T25:00:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-07-23",
  acknowledgeIncomplete: true
}), /Valid ISO completion time/, "out-of-range completion time was accepted");
assert.throws(() => model.completeWork(state, "work-a", {
  completedAtISO: "2026-07-23T11:00:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-02-30",
  acknowledgeIncomplete: true
}), /Valid completion date/, "normalized nonexistent completion date was accepted");

const result = model.completeWork(state, "work-a", {
  completedAtISO: "2026-07-23T11:00:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-07-23",
  acknowledgeIncomplete: true
});
assert.equal(result.state.works[0].lifecycle.phase, "done");
assert.equal(result.state.completionBundles.length, 1);
assert.equal(result.state.completionBundles[0].baselinePhase, "design");
assert.deepStrictEqual(result.state.completionBundles[0].workSnapshot.incompleteTodos.map((todo) => todo.id), ["todo-open"]);
assert.equal(result.bundle.workId, "work-a");
assert.equal(result.bundle.workSnapshot.id, "work-a");
assert.equal(state.works[0].lifecycle.phase, "design");
assert.equal(state.completionBundles.length, 0);
assert.deepStrictEqual(model.selectWorkList(result.state, "completed").map((work) => work.id), ["work-a"]);
assert.deepStrictEqual(model.selectCloudBundles(result.state).map((bundle) => bundle.workId), ["work-a"]);
const selectedBundles = model.selectCloudBundles(result.state);
selectedBundles[0].workSnapshot.title = "changed outside the model";
assert.equal(result.state.completionBundles[0].workSnapshot.title, "열수송관 보수 설계");

const archivalState = JSON.parse(JSON.stringify(state));
archivalState.works[0].sources = [{
  docId: "RULE-ARCHIVE-01",
  category: "official",
  role: "완료 당시 적용 근거",
  sourceSystem: "document-index"
}];
const resolvedReferences = {
  official: [{
    docId: "RULE-ARCHIVE-01",
    category: "official",
    title: "완료 당시 지침 제목",
    issuer: "완료 당시 발행 조직",
    effectiveDate: "2026-07-01",
    version: "V2026.07-R01",
    rationale: "완료 당시 적용 근거",
    access: "full",
    body: "보관하면 안 되는 본문"
  }],
  memory: []
};
const archivalResult = model.completeWork(archivalState, "work-a", {
  completedAtISO: "2026-07-23T12:00:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-07-23",
  acknowledgeIncomplete: true,
  resolvedReferences
});
const archivedReference = archivalResult.bundle.workSnapshot.officialReferences[0];
assert.deepStrictEqual(archivalResult.bundle.workSnapshot.sources, archivalState.works[0].sources,
  "completion changed the raw reference identity");
assert.equal(archivedReference.docId, "RULE-ARCHIVE-01");
assert.equal(archivedReference.title, "완료 당시 지침 제목");
assert.equal(archivedReference.issuer, "완료 당시 발행 조직");
assert.equal(archivedReference.version, "V2026.07-R01");
assert.equal(archivedReference.rationale, "완료 당시 적용 근거");
assert.equal("access" in archivedReference, false, "completion archived mutable access state");
assert.equal("body" in archivedReference, false, "completion archived document body as presentation metadata");
resolvedReferences.official[0].title = "완료 후 바뀐 현재 제목";
assert.equal(archivalResult.bundle.workSnapshot.officialReferences[0].title, "완료 당시 지침 제목",
  "completion reference presentation was not immutable");

console.log("Workbench model contract passed");
