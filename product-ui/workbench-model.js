(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OnMemoryWorkbenchModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PHASE = Object.freeze({
    design: "설계",
    contract: "계약",
    construction: "시공",
    completion: "준공",
    done: "완료"
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isISODate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0]
      && date.getUTCMonth() === parts[1] - 1
      && date.getUTCDate() === parts[2];
  }

  function isISOTime(value) {
    return typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T/.test(value)
      && !Number.isNaN(Date.parse(value));
  }

  function daysBetween(startISO, endISO) {
    if (!isISODate(startISO) || !isISODate(endISO)) return null;
    const start = Date.UTC(...startISO.split("-").map((part, index) => index === 1 ? Number(part) - 1 : Number(part)));
    const end = Date.UTC(...endISO.split("-").map((part, index) => index === 1 ? Number(part) - 1 : Number(part)));
    return Math.round((end - start) / 86400000);
  }

  function stableId(timestampISO, text) {
    const source = `${timestampISO}|${text}`;
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
      hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
  }

  function headlineFor(work, todayISO) {
    const lifecycle = work && work.lifecycle || {};
    const phaseKey = PHASE[lifecycle.phase] ? lifecycle.phase : "design";
    const beforeContract = phaseKey === "design";
    const dateISO = beforeContract ? lifecycle.designDeadlineISO : lifecycle.completionDateISO;
    return {
      phaseKey,
      phaseLabel: PHASE[phaseKey],
      dateLabel: beforeContract ? "설계 발송일" : (phaseKey === "done" ? "완료일" : "준공일"),
      dateISO: isISODate(dateISO) ? dateISO : null,
      dday: isISODate(dateISO) ? daysBetween(todayISO, dateISO) : null,
      isComplete: phaseKey === "done"
    };
  }

  function partitionReferences(work) {
    const official = [];
    const memory = [];
    for (const source of work && Array.isArray(work.sources) ? work.sources : []) {
      if (!source || typeof source !== "object") continue;
      const item = clone(source);
      if (item.category === "official") official.push(item);
      else {
        if (item.category !== "memory") item.needsClassification = true;
        memory.push(item);
      }
    }
    return { official, memory };
  }

  function parsedDate(text, options) {
    const parser = options && (options.parseScheduleCandidate || options.parseDate || options.dateParser);
    if (typeof parser !== "function") return null;
    const parsed = parser(text, options && options.simISO);
    const value = parsed && typeof parsed === "object" && !(parsed instanceof Date)
      ? (parsed.dateISO || parsed.startISO || parsed.iso || parsed.value)
      : parsed;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return value.toISOString().slice(0, 10);
    }
    return isISODate(value) ? value : null;
  }

  function progressCandidate(type, label, text, dateISO) {
    return {
      id: `candidate-${stableId(type, `${text}|${dateISO || ""}`)}`,
      type,
      label,
      basis: text,
      dateISO: dateISO || null,
      status: "proposed"
    };
  }

  function analyzeProgressText(text, options) {
    const clean = String(text || "").trim();
    const candidates = [];
    const dateISO = parsedDate(clean, options);
    if (dateISO) candidates.push(progressCandidate("schedule", `${dateISO} 일정`, clean, dateISO));
    if (/확정|결정/.test(clean)) candidates.push(progressCandidate("decision", "결정 기록", clean, null));
    if (/변경|수정/.test(clean)) candidates.push(progressCandidate("change", "변경 기록", clean, null));
    if (/요청|확인|전달|준비|회신/.test(clean)) candidates.push(progressCandidate("followup", "후속 작업", clean, null));
    if (!candidates.length) candidates.push(progressCandidate("reference", "참고 기록", clean, null));
    return candidates;
  }

  function createProgressNote(text, timestampISO, candidates) {
    const clean = String(text || "").trim();
    if (!clean) throw new Error("Progress note text is required");
    const proposed = Array.isArray(candidates) ? clone(candidates) : [];
    return {
      id: `progress-${stableId(timestampISO, clean)}`,
      kind: "progress-note",
      text: clean,
      ts: timestampISO,
      analysis: {
        status: proposed.length ? "proposed" : "empty",
        candidates: proposed,
        confirmedCandidateIds: []
      }
    };
  }

  function confirmProgressCandidate(work, noteId, candidateId) {
    const next = clone(work || {});
    next.records = Array.isArray(next.records) ? next.records : [];
    next.todos = Array.isArray(next.todos) ? next.todos : [];
    const note = next.records.find((record) => record && record.id === noteId);
    if (!note || !note.analysis || !Array.isArray(note.analysis.candidates)) throw new Error("Progress note not found");
    const candidate = note.analysis.candidates.find((item) => item && item.id === candidateId);
    if (!candidate) throw new Error("Progress candidate not found");
    if (candidate.status === "confirmed") return next;

    candidate.status = "confirmed";
    note.analysis.status = "confirmed";
    note.analysis.confirmedCandidateIds = Array.isArray(note.analysis.confirmedCandidateIds)
      ? note.analysis.confirmedCandidateIds : [];
    if (!note.analysis.confirmedCandidateIds.includes(candidate.id)) note.analysis.confirmedCandidateIds.push(candidate.id);

    if (candidate.type === "schedule") {
      if (!isISODate(candidate.dateISO)) throw new Error("Schedule candidate requires a valid date");
      next.schedule = next.schedule && typeof next.schedule === "object" ? next.schedule : {};
      next.schedule.milestones = Array.isArray(next.schedule.milestones) ? next.schedule.milestones : [];
      next.schedule.milestones.push({
        id: `milestone-${candidate.id}`,
        dateISO: candidate.dateISO,
        label: candidate.label,
        sourceNoteId: note.id,
        candidateId: candidate.id
      });
    } else if (candidate.type === "followup") {
      next.todos.push({
        id: `todo-${candidate.id}`,
        text: candidate.label,
        done: false,
        candidate: false,
        sourceNoteId: note.id,
        candidateId: candidate.id
      });
    }
    return next;
  }

  function completionReadiness(work) {
    const incompleteTodos = (work && Array.isArray(work.todos) ? work.todos : [])
      .filter((todo) => todo && !todo.done && !todo.candidate)
      .map(clone);
    return {
      ready: incompleteTodos.length === 0,
      incompleteTodos,
      requiresAcknowledgement: incompleteTodos.length > 0
    };
  }

  function completeWork(state, workId, completion) {
    if (!state || !Array.isArray(state.works)) throw new Error("Invalid work state");
    if (typeof workId !== "string" || !workId.trim()) throw new Error("Valid workId is required");
    if (!completion || !isISOTime(completion.completedAtISO)) throw new Error("Valid ISO completion time is required");
    if (typeof completion.completedBy !== "string" || !completion.completedBy.trim()) throw new Error("Completion actor is required");
    if (!isISODate(completion.completionDateISO)) throw new Error("Valid completion date is required");

    const index = state.works.findIndex((work) => work && work.id === workId);
    if (index < 0) throw new Error("Work not found");
    const current = state.works[index];
    if (current.lifecycle && current.lifecycle.phase === "done") throw new Error("Work is already complete");
    const readiness = completionReadiness(current);
    if (!readiness.ready && !completion.acknowledgeIncomplete) {
      throw new Error("Incomplete follow-up work must be acknowledged");
    }

    const nextState = clone(state);
    nextState.completionBundles = Array.isArray(nextState.completionBundles) ? nextState.completionBundles : [];
    const work = nextState.works[index];
    const baselinePhase = work.lifecycle && PHASE[work.lifecycle.phase] ? work.lifecycle.phase : "design";
    work.lifecycle = work.lifecycle && typeof work.lifecycle === "object" ? work.lifecycle : {};
    work.lifecycle.phase = "done";
    work.lifecycle.completedAtISO = completion.completedAtISO;
    work.lifecycle.completedBy = completion.completedBy;
    work.lifecycle.completionDateISO = completion.completionDateISO;

    const references = partitionReferences(work);
    const workSnapshot = clone(work);
    workSnapshot.incompleteTodos = readiness.incompleteTodos;
    workSnapshot.officialReferences = references.official;
    workSnapshot.memoryReferences = references.memory;
    const bundle = {
      id: `completion-${stableId(completion.completedAtISO, work.id)}`,
      workId: work.id,
      completedAtISO: completion.completedAtISO,
      completedBy: completion.completedBy,
      baselinePhase,
      workSnapshot
    };
    nextState.completionBundles.push(bundle);
    return { state: nextState, bundle: clone(bundle) };
  }

  function selectWorkList(state, mode) {
    const completed = mode === "completed";
    return (state && Array.isArray(state.works) ? state.works : [])
      .filter((work) => Boolean(work) && ((work.lifecycle && work.lifecycle.phase === "done") === completed))
      .map(clone);
  }

  function selectCloudBundles(state) {
    return clone(state && Array.isArray(state.completionBundles) ? state.completionBundles : []);
  }

  return {
    PHASE,
    headlineFor,
    partitionReferences,
    analyzeProgressText,
    createProgressNote,
    confirmProgressCandidate,
    completionReadiness,
    completeWork,
    selectWorkList,
    selectCloudBundles
  };
});
