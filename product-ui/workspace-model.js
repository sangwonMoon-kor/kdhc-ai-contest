(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OnMemoryWorkspaceModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SCOPE = Object.freeze({
    MINE: "mine",
    SECTION: "section",
    DEPARTMENT: "department"
  });
  const SCOPE_ORDER = [SCOPE.MINE, SCOPE.SECTION, SCOPE.DEPARTMENT];

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createDemoContext() {
    return {
      currentPersonId: "person-kim-hannan",
      currentRoleId: "role-maintenance-planning",
      org: {
        departments: [{ id: "dept-plant", name: "발전처" }],
        sections: [{ id: "section-maintenance", departmentId: "dept-plant", name: "정비기획과" }],
        people: [{ id: "person-kim-hannan", sectionId: "section-maintenance", name: "김한난" }],
        roles: [{ id: "role-maintenance-planning", personId: "person-kim-hannan", name: "정기점검보수 계획" }]
      }
    };
  }

  function baseState(context) {
    const resolved = context || createDemoContext();
    return {
      v: 3,
      currentPersonId: resolved.currentPersonId,
      currentRoleId: resolved.currentRoleId,
      org: clone(resolved.org),
      works: [],
      personalSchedules: [],
      roleLibraries: [{
        roleId: resolved.currentRoleId,
        items: [],
        proposals: [],
        rules: [],
        actionLog: []
      }],
      selectedWorkId: null,
      completionBundles: []
    };
  }

  function createDemoState() {
    const context = createDemoContext();
    const state = baseState(context);
    state.works = [{
      id: "work-maintenance-plan-2026",
      title: "2026년 정기점검보수 기본계획 수립",
      instruction: "정기점검보수 기본계획을 수립합니다.",
      requester: "정비기획과",
      due: "2026-07-30",
      stageId: "design-and-costing",
      stageName: "설계·내역 작성",
      doneWhen: "기본계획 결재",
      repeat: true,
      departmentId: "dept-plant",
      sectionId: "section-maintenance",
      relations: [{ personId: context.currentPersonId, kind: "owner" }],
      lifecycle: {
        phase: "design",
        designDeadlineISO: "2026-07-30",
        completionDateISO: null,
        completedAtISO: null,
        completedBy: null
      },
      output: {
        mode: "recurring",
        templateId: null,
        priorDocumentId: null,
        finalDocumentId: null
      },
      schedule: {
        startISO: "2026-01-05",
        endISO: "2026-07-30",
        milestones: [{ id: "scope", dateISO: "2026-01-23", label: "점검 범위 확정" }]
      },
      todos: [],
      records: [],
      sources: [
        { docId: "RULE-2026-0401", role: "업무 지침", category: "official", access: "full" },
        { docId: "APPR-2025-0409", role: "전년도 기안", category: "memory", year: 2025, access: "full" },
        { docId: "tip-inspection-order", role: "개인 확인 메모", category: "memory", authorType: "personal", access: "full" }
      ],
      draft: { savedAt: null, values: null }
    }, {
      id: "work-maintenance-contract-2026",
      title: "2026년 정기점검보수 계약 후 시공 관리",
      instruction: "계약 후 시공 일정을 관리합니다.",
      requester: "정비기획과",
      due: "2026-09-18",
      stageId: "maintenance-construction",
      stageName: "시공 관리",
      doneWhen: "시공 완료 확인",
      repeat: false,
      departmentId: "dept-plant",
      sectionId: "section-maintenance",
      relations: [{ personId: context.currentPersonId, kind: "owner" }],
      lifecycle: {
        phase: "construction",
        designDeadlineISO: null,
        completionDateISO: "2026-09-18",
        completedAtISO: null,
        completedBy: null
      },
      output: {
        mode: "new",
        templateId: null,
        priorDocumentId: null,
        finalDocumentId: null
      },
      schedule: {
        startISO: null,
        endISO: "2026-09-18",
        milestones: []
      },
      todos: [],
      records: [],
      sources: [],
      draft: { savedAt: null, values: null }
    }];
    state.personalSchedules = [{
      id: "personal-demo-review",
      title: "기본계획 검토 메모",
      startISO: "2026-01-15",
      endISO: "2026-01-15",
      ownerId: context.currentPersonId,
      status: "active"
    }];
    state.selectedWorkId = state.works[0].id;
    return state;
  }

  function normalizeRelationList(value, context) {
    if (Array.isArray(value) && value.length) return clone(value);
    return [{ personId: context.currentPersonId, kind: "owner" }];
  }

  function migrateLifecycle(work) {
    const source = work.lifecycle && typeof work.lifecycle === "object" ? work.lifecycle : {};
    const phase = ["design", "contract", "construction", "completion", "done"].includes(source.phase)
      ? source.phase
      : "design";
    return {
      phase,
      designDeadlineISO: source.designDeadlineISO || null,
      completionDateISO: source.completionDateISO || null,
      completedAtISO: source.completedAtISO || null,
      completedBy: source.completedBy || null
    };
  }

  function migrateOutput(work) {
    const source = work.output && typeof work.output === "object" ? work.output : {};
    return {
      mode: source.mode === "new" || source.mode === "recurring"
        ? source.mode
        : (work.repeat ? "recurring" : "new"),
      templateId: source.templateId || null,
      priorDocumentId: source.priorDocumentId || null,
      finalDocumentId: source.finalDocumentId || null
    };
  }

  function migrateWork(work, context) {
    const migrated = Object.assign({}, clone(work));
    migrated.todos = Array.isArray(migrated.todos) ? migrated.todos : [];
    migrated.records = Array.isArray(migrated.records) ? migrated.records : [];
    migrated.sources = Array.isArray(migrated.sources) ? migrated.sources : [];
    migrated.departmentId = migrated.departmentId || context.org.departments[0].id;
    migrated.sectionId = migrated.sectionId || context.org.sections[0].id;
    migrated.relations = normalizeRelationList(migrated.relations, context);
    if (!migrated.schedule || typeof migrated.schedule !== "object") {
      migrated.schedule = {
        startISO: typeof migrated.calendarStart === "string" ? migrated.calendarStart : null,
        endISO: typeof migrated.due === "string" ? migrated.due : null,
        milestones: []
      };
    }
    migrated.lifecycle = migrateLifecycle(migrated);
    migrated.output = migrateOutput(migrated);
    return migrated;
  }

  function migrateState(raw, suppliedContext) {
    const context = suppliedContext || createDemoContext();
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.works)) return createDemoState();
    const migrated = baseState(context);
    migrated.works = raw.works
      .filter((work) => work && typeof work.id === "string" && typeof work.title === "string")
      .map((work) => migrateWork(work, context));
    migrated.personalSchedules = Array.isArray(raw.personalSchedules) ? clone(raw.personalSchedules) : [];
    migrated.roleLibraries = Array.isArray(raw.roleLibraries) ? clone(raw.roleLibraries) : migrated.roleLibraries;
    migrated.selectedWorkId = typeof raw.selectedWorkId === "string" ? raw.selectedWorkId : null;
    migrated.completionBundles = Array.isArray(raw.completionBundles) ? clone(raw.completionBundles) : [];
    return migrated;
  }

  function adaptForecastItem(item, suppliedContext, simISO) {
    const context = suppliedContext || createDemoContext();
    const year = String(simISO || "").slice(0, 4);
    const stageId = item && item.stageId ? String(item.stageId) : "forecast";
    const month = item && item.month != null ? String(item.month) : "unknown";
    const due = item && typeof item.dueDate === "string" ? item.dueDate : null;
    return {
      id: `w-${stageId}-m${month}`,
      seedKey: `${stageId}|${month}`,
      title: `${year ? `${year}년 ` : ""}${item && item.name ? item.name : "반복 업무"}`,
      instruction: `매년 ${month}월 반복 · 과거 문서 ${Number(item && item.docCount) || 0}건 근거`,
      requester: "반복 업무(과거 문서 근거)",
      due,
      stageId: item && item.stageId ? item.stageId : null,
      stageName: item && item.task ? item.task : "",
      doneWhen: "결재 상신",
      repeat: true,
      departmentId: context.org.departments[0].id,
      sectionId: context.org.sections[0].id,
      relations: [{ personId: context.currentPersonId, kind: "owner" }],
      lifecycle: {
        phase: "design",
        designDeadlineISO: null,
        completionDateISO: null,
        completedAtISO: null,
        completedBy: null
      },
      output: {
        mode: "recurring",
        templateId: null,
        priorDocumentId: null,
        finalDocumentId: null
      },
      schedule: { startISO: null, endISO: due, milestones: [] },
      todos: [],
      records: [],
      sources: ((item && item.docs) || []).map((docId) => ({ docId, role: "과거 문서" })),
      draft: { savedAt: null, values: null }
    };
  }

  function overlaps(startISO, endISO, window) {
    return Boolean(startISO && endISO && window && window.startISO && window.endISO
      && startISO <= window.endISO && endISO >= window.startISO);
  }

  function stateContext(state) {
    const person = (state.org && state.org.people || []).find((item) => item.id === state.currentPersonId) || null;
    const section = person && (state.org && state.org.sections || []).find((item) => item.id === person.sectionId) || null;
    return {
      personId: state.currentPersonId,
      sectionId: section && section.id,
      departmentId: section && section.departmentId
    };
  }

  function scopesForWork(work, context) {
    const scopes = [];
    if ((work.relations || []).some((relation) => relation && relation.personId === context.personId)) scopes.push(SCOPE.MINE);
    if (context.sectionId && work.sectionId === context.sectionId) scopes.push(SCOPE.SECTION);
    if (context.departmentId && work.departmentId === context.departmentId) scopes.push(SCOPE.DEPARTMENT);
    return scopes;
  }

  function workDates(work) {
    const schedule = work.schedule || {};
    const endISO = schedule.endISO || work.due || null;
    const startISO = schedule.startISO || work.calendarStart || endISO;
    return { startISO, endISO: endISO || startISO };
  }

  function selectScheduleEvents(state, window, selectedScopes) {
    if (!window || !window.startISO || !window.endISO) throw new Error("Invalid calendar window");
    const selected = SCOPE_ORDER.filter((scope) => (selectedScopes || []).includes(scope));
    if (!selected.length) return [];
    const context = stateContext(state);
    const events = [];
    for (const work of state.works || []) {
      const eligible = scopesForWork(work, context);
      const visibleScopes = selected.filter((scope) => eligible.includes(scope));
      const dates = workDates(work);
      if (!visibleScopes.length || !overlaps(dates.startISO, dates.endISO, window)) continue;
      events.push({
        kind: "work",
        id: work.id,
        workId: work.id,
        label: work.title,
        startISO: dates.startISO,
        endISO: dates.endISO,
        milestones: clone(work.schedule && work.schedule.milestones || []),
        visibleScopes,
        primaryScope: SCOPE_ORDER.find((scope) => visibleScopes.includes(scope))
      });
    }
    if (selected.includes(SCOPE.MINE)) {
      for (const personal of state.personalSchedules || []) {
        if (personal.ownerId && personal.ownerId !== context.personId) continue;
        const startISO = personal.startISO;
        const endISO = personal.endISO || startISO;
        if (!overlaps(startISO, endISO, window)) continue;
        events.push({
          kind: "personal",
          id: personal.id,
          label: personal.title,
          startISO,
          endISO,
          visibleScopes: [SCOPE.MINE],
          primaryScope: SCOPE.MINE
        });
      }
    }
    return events;
  }

  function selectHomeEvents(state, window) {
    const context = stateContext(state);
    const events = [];
    for (const work of state.works || []) {
      if (!scopesForWork(work, context).includes(SCOPE.MINE)) continue;
      const dates = workDates(work);
      if (overlaps(dates.startISO, dates.endISO, window)) {
        events.push({ kind: "work", id: work.id, workId: work.id, label: work.title, startISO: dates.startISO, endISO: dates.endISO, visibleScopes: [SCOPE.MINE], primaryScope: SCOPE.MINE });
      }
      if (work.repeat && work.due && overlaps(work.due, work.due, window)) {
        events.push({ kind: "deadline", id: work.id, workId: work.id, label: work.title, startISO: work.due, endISO: work.due, visibleScopes: [SCOPE.MINE], primaryScope: SCOPE.MINE });
      }
      for (const record of work.records || []) {
        const startISO = record && (record.startISO || record.dateISO);
        const endISO = record && (record.endISO || startISO);
        if (overlaps(startISO, endISO, window)) events.push({ kind: "memo", id: record.id, workId: work.id, label: record.label || record.text || work.title, startISO, endISO, visibleScopes: [SCOPE.MINE], primaryScope: SCOPE.MINE });
      }
      for (const candidate of work.scheduleCandidates || []) {
        if (!candidate || candidate.confirmed || !overlaps(candidate.startISO, candidate.endISO, window)) continue;
        events.push({ kind: "candidate", id: candidate.id, workId: work.id, label: candidate.label || work.title, startISO: candidate.startISO, endISO: candidate.endISO, visibleScopes: [SCOPE.MINE], primaryScope: SCOPE.MINE });
      }
    }
    return events.concat(selectScheduleEvents(state, window, [SCOPE.MINE]).filter((event) => event.kind === "personal"));
  }

  function toggleScheduleScope(selectedScopes, scope) {
    if (!SCOPE_ORDER.includes(scope)) throw new Error("Unknown schedule scope");
    const selected = new Set((selectedScopes || []).filter((item) => SCOPE_ORDER.includes(item)));
    if (selected.has(scope)) selected.delete(scope);
    else selected.add(scope);
    return SCOPE_ORDER.filter((item) => selected.has(item));
  }

  return {
    SCOPE,
    createDemoContext,
    createDemoState,
    migrateState,
    adaptForecastItem,
    selectHomeEvents,
    selectScheduleEvents,
    toggleScheduleScope
  };
});
