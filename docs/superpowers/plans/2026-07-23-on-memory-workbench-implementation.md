# ON_메모리 업무 작업대 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선택한 업무 한 건의 일정, 진행 기록, 공식 기준, 과거 업무 메모리, 결과물 작성, 완료 보관을 세로형 단일 작업대에서 이어서 처리하게 한다.

**Architecture:** 기존 정적 SPA와 `product-ui` 경계를 유지한다. `workspace-model.js`는 저장 상태를 v3로 안전하게 이관하고, 새 순수 모듈 `workbench-model.js`는 헤드라인·참고자료 분류·진행 메모 후보·완료 스냅샷을 계산한다. `app.js`는 이 모델을 렌더링하고 사용자 확인 뒤에만 상태를 변경한다. 완료된 업무는 삭제하지 않고 `works`의 완료 상태와 `completionBundles`의 불변 스냅샷으로 함께 보존한다.

**Tech Stack:** Static HTML/CSS, Vanilla JavaScript UMD/CommonJS, Node.js `assert`, Playwright 1.61.1, 기존 `JikmuApi` fixture/live/auto 어댑터

## Global Constraints

- 변경 범위는 `product-ui/`, 관련 테스트, `package.json`과 이 계획 문서다. `service/public/`는 수정하지 않는다.
- 작업대 진입의 기준은 모든 화면에서 동일한 `workId`다.
- 헤드라인에는 `진행 중` 같은 공통 상태를 표시하지 않고 `설계`, `계약`, `시공`, `준공`, `완료` 중 세부 단계만 표시한다.
- 설계 단계의 D-day는 사용자가 확정한 설계 발송일만, 계약 이후 단계의 D-day는 확인된 준공일만 사용한다.
- 날짜가 없거나 후보 상태이면 D-day를 만들지 않고 `일정 미정`과 날짜 추가 행동을 표시한다.
- 진행 메모 원문은 분석 성공 여부와 관계없이 먼저 저장한다. 자동 분석 결과는 사용자가 확인하기 전까지 후보다.
- 공식 지침과 업무 메모리는 데이터 유형과 화면 영역을 분리한다. 개인 메모는 공식 근거로 표시하지 않는다.
- 반복 업무 결과물은 회사 템플릿과 과거 문서 구조를, 신규 업무 결과물은 회사 템플릿과 공식 지침을 시작 근거로 사용한다.
- 자동 생성 결과는 결재 가능한 완성본으로 표현하지 않고 편집·검토 가능한 초안 또는 교정 후보로 표시한다.
- 완료는 삭제나 물리적 이동이 아니다. 완료 업무는 `내 업무 > 완료`에서 열리고 문서·기록 묶음은 `클라우드`에서 조회된다.
- 완료 작업대는 읽기 전용이다. 완료 스냅샷에는 완료 당시의 원문 기록, 확정 후보, 공식 기준, 참고 메모리, 결과물 연결을 보존한다.
- 기존 v1/v2 localStorage, fixture/live/auto 데이터 모드, 홈·일정·근거 drawer·기안 흐름을 보존한다.
- 권한 없는 문서는 제목과 권한 안내만 보이고 본문은 노출하지 않는다.
- 390px에서는 헤드라인 → 진행 기록 → 공식 지침 → 업무 메모리 → 결과물 → 완료 정보 순으로 쌓이고 문서 전체의 가로 overflow가 없어야 한다.

---

## Task 1: 작업 상태를 v3 생애주기와 완료 묶음으로 이관

**Files:**
- Modify: `product-ui/workspace-model.js`
- Modify: `product-ui/tests/verify-workspace-model.js`
- Modify: `product-ui/tests/verify-home-state.js`

**Interfaces:**

```js
{
  v: 3,
  works: [{
    lifecycle: {
      phase: "design" | "contract" | "construction" | "completion" | "done",
      designDeadlineISO: string | null,
      completionDateISO: string | null,
      completedAtISO: string | null,
      completedBy: string | null
    },
    output: {
      mode: "recurring" | "new",
      templateId: string | null,
      priorDocumentId: string | null,
      finalDocumentId: string | null
    }
  }],
  completionBundles: []
}
```

- [ ] **Step 1: v1·v2 보존과 v3 기본값을 검증하는 실패 테스트 작성**

```js
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
    draft: { savedAt: null, values: null }
  }]
};
const migrated = model.migrateState(legacy, model.createDemoContext());
assert.equal(migrated.v, 3);
assert.equal(migrated.works[0].lifecycle.phase, "design");
assert.equal(migrated.works[0].lifecycle.designDeadlineISO, null);
assert.equal(migrated.works[0].output.mode, "new");
assert.equal(migrated.works[0].due, "2026-08-20");
assert.deepEqual(migrated.works[0].todos, legacy.works[0].todos);
assert.deepEqual(migrated.works[0].records, legacy.works[0].records);
assert.deepEqual(migrated.works[0].sources, legacy.works[0].sources);
assert.deepEqual(migrated.completionBundles, []);
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-workspace-model.js`

Expected: FAIL because migrated state is still v2 and has no lifecycle/output/completion bundle fields.

- [ ] **Step 3: v3 기본 상태와 무손실 마이그레이션 구현**

```js
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
```

`baseState`를 `v: 3`으로 바꾸고 `completionBundles: []`를 추가한다. `migrateWork`는 기존 속성을 복제한 뒤 `lifecycle`과 `output`만 보충한다. `migrateState`는 유효한 기존 `completionBundles`를 깊은 복사하고, 없으면 빈 배열을 사용한다. 기존 `todos`, `records`, `sources`, `draft`, `schedule`, ID는 변경하지 않는다.

레거시 `due`는 일정 화면을 위해 그대로 보존하지만 `designDeadlineISO`나 `completionDateISO`로 자동 승격하지 않는다. 새 헤드라인의 확정일은 사용자가 확인한 새 필드만 읽는다.

- [ ] **Step 4: 데모 데이터에 설계 전·계약 후 시나리오와 정직한 참고자료 유형 추가**

```js
sources: [
  { docId: "RULE-2026-0401", role: "업무 지침", category: "official", access: "full" },
  { docId: "APPR-2025-0409", role: "전년도 기안", category: "memory", year: 2025, access: "full" },
  { docId: "tip-inspection-order", role: "개인 확인 메모", category: "memory", authorType: "personal", access: "full" }
]
```

데모의 선택 업무는 `designDeadlineISO: "2026-07-30"`이 있는 설계 단계로 둔다. 별도 계약 후 업무 한 건은 `completionDateISO: "2026-09-18"`이 있는 시공 단계로 추가해 두 D-day 경로를 브라우저 테스트에서 모두 열 수 있게 한다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workspace-model.js && node product-ui/tests/verify-home-state.js`

Expected: both contracts pass and legacy arrays remain byte-for-byte equivalent after migration.

```bash
git add product-ui/workspace-model.js product-ui/tests/verify-workspace-model.js product-ui/tests/verify-home-state.js
git commit -m "feat: 업무 생애주기와 완료 묶음 상태 추가"
```

## Task 2: 작업대 순수 도메인 모델 추가

**Files:**
- Create: `product-ui/workbench-model.js`
- Create: `product-ui/tests/verify-workbench-model.js`
- Modify: `product-ui/index.html`
- Modify: `product-ui/sync-manifest.json`
- Modify: `product-ui/tests/verify-source-contract.js`
- Modify: `package.json`

**Interfaces:**

```js
window.OnMemoryWorkbenchModel = {
  PHASE,
  headlineFor(work, todayISO),
  partitionReferences(work),
  analyzeProgressText(text, options),
  createProgressNote(text, timestampISO, candidates),
  confirmProgressCandidate(work, noteId, candidateId),
  completionReadiness(work),
  completeWork(state, workId, completion),
  selectWorkList(state, mode),
  selectCloudBundles(state)
};
```

- [ ] **Step 1: 헤드라인·자료 분류·원문 보존·완료 전환 실패 테스트 작성**

```js
assert.deepEqual(model.headlineFor({
  lifecycle: { phase: "design", designDeadlineISO: "2026-07-30", completionDateISO: null }
}, "2026-07-23"), {
  phaseKey: "design",
  phaseLabel: "설계",
  dateLabel: "설계 발송일",
  dateISO: "2026-07-30",
  dday: 7,
  isComplete: false
});

const split = model.partitionReferences({
  sources: [
    { docId: "rule", category: "official" },
    { docId: "old", category: "memory" },
    { docId: "unknown" }
  ]
});
assert.deepEqual(split.official.map((item) => item.docId), ["rule"]);
assert.deepEqual(split.memory.map((item) => item.docId), ["old", "unknown"]);
assert.equal(split.memory[1].needsClassification, true);

const note = model.createProgressNote("7월 30일 도면 발송", "2026-07-23T10:00:00.000Z", []);
assert.equal(note.text, "7월 30일 도면 발송");
assert.equal(note.analysis.status, "empty");

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
    todos: [],
    records: [],
    sources: []
  }],
  completionBundles: []
};
const result = model.completeWork(state, "work-a", {
  completedAtISO: "2026-07-23T11:00:00.000Z",
  completedBy: "person-kim-hannan",
  completionDateISO: "2026-07-23",
  acknowledgeIncomplete: true
});
assert.equal(result.state.works[0].lifecycle.phase, "done");
assert.equal(result.state.completionBundles.length, 1);
assert.equal(state.works[0].lifecycle.phase, "design");
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-workbench-model.js`

Expected: FAIL with `Cannot find module '../workbench-model.js'`.

- [ ] **Step 3: 헤드라인과 참고자료 분리 구현**

```js
const PHASE = Object.freeze({
  design: "설계",
  contract: "계약",
  construction: "시공",
  completion: "준공",
  done: "완료"
});

function headlineFor(work, todayISO) {
  const lifecycle = work.lifecycle || {};
  const phaseKey = PHASE[lifecycle.phase] ? lifecycle.phase : "design";
  const beforeContract = phaseKey === "design";
  const dateISO = beforeContract ? lifecycle.designDeadlineISO : lifecycle.completionDateISO;
  return {
    phaseKey,
    phaseLabel: PHASE[phaseKey],
    dateLabel: beforeContract ? "설계 발송일" : (phaseKey === "done" ? "완료일" : "준공일"),
    dateISO: dateISO || null,
    dday: dateISO ? daysBetween(todayISO, dateISO) : null,
    isComplete: phaseKey === "done"
  };
}
```

`partitionReferences`는 `category: "official"`만 공식 지침으로 보낸다. `memory`와 분류되지 않은 레거시 자료는 업무 메모리로 보내되 후자에는 `needsClassification: true`를 붙인다. 어떤 레거시 자료도 추정으로 공식 지침이 되지 않는다.

- [ ] **Step 4: 진행 후보와 완료 스냅샷 구현**

```js
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
```

`stableId`는 `${timestampISO}|${text}`의 각 UTF-16 코드 값을 순회해 32비트 unsigned 정수로 누적한 뒤 base36 문자열로 반환한다. 같은 원문·시각에는 같은 ID가 나오고 외부 난수에 의존하지 않는다.

`analyzeProgressText`의 첫 규칙은 주입한 날짜 파서가 반환한 유효 날짜를 `schedule` 후보로 만드는 것이다. 이어서 원문에 `확정` 또는 `결정`이 있으면 `decision`, `변경` 또는 `수정`이 있으면 `change`, `요청`·`확인`·`전달`·`준비`·`회신` 중 하나가 있으면 `followup` 후보를 만든다. 어떤 규칙도 일치하지 않으면 `reference` 후보 하나를 만든다. 각 후보는 `{ id, type, label, basis, dateISO, status: "proposed" }`의 동일한 모양을 가진다.

`confirmProgressCandidate`는 복제한 업무를 반환하며 일정 후보는 milestone, 후속 작업 후보는 `todos`에 반영하고 나머지는 해당 기록의 확정 후보로 남긴다. 원문 기록은 삭제하거나 바꾸지 않는다.

`completeWork`는 유효한 `workId`, ISO 완료 시각, 완료자, 기준일을 검증한다. 입력 상태를 깊은 복사하고 완료 단계로 바꾼 뒤 `{ id, workId, completedAtISO, completedBy, baselinePhase, workSnapshot }` 모양의 완료 묶음을 `completionBundles`에 추가한다. `workSnapshot`은 완료 당시 결과물·기준·기록·미완료 후속 작업을 포함하며 기존 입력 객체는 수정하지 않는다.

- [ ] **Step 5: 브라우저 로드 순서와 테스트 스크립트 등록**

`index.html`은 `workspace-model.js` 다음, `app.js` 전에 `workbench-model.js`를 읽는다. `sync-manifest.json`에도 동일 파일을 추가한다. `package.json`에 `test:product-ui:workbench-model`을 만들고 전체 체인의 workspace model 다음에 둔다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workbench-model.js && node product-ui/tests/verify-source-contract.js`

Expected: both contracts pass.

```bash
git add product-ui/workbench-model.js product-ui/tests/verify-workbench-model.js product-ui/index.html product-ui/sync-manifest.json product-ui/tests/verify-source-contract.js package.json
git commit -m "feat: 업무 작업대 도메인 모델 추가"
```

## Task 3: 내 업무를 진행·완료 목록으로 나누고 헤드라인 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-work-list-browser.js`
- Modify: `product-ui/tests/verify-product-shell-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 기본 진행 목록과 완료 탭 접근을 검증하는 실패 테스트 작성**

```js
await page.goto(`${baseURL}/?data=fixture#work/list`);
await expect(page.locator('[role="tab"][data-mode="active"]')).toHaveAttribute("aria-selected", "true");
await expect(page.locator('[data-work-phase="done"]')).toHaveCount(0);
await page.locator('[role="tab"][data-mode="completed"]').click();
await expect(page.locator('[role="tab"][data-mode="completed"]')).toHaveAttribute("aria-selected", "true");
await expect(page.locator('[data-work-phase="done"]')).toHaveCount(1);
```

테스트 시작 전에 `page.addInitScript`로 v3 상태 한 건을 완료시키고 `completionBundles`까지 포함한 localStorage fixture를 주입한다. 제품 기본 데모에 가짜 완료 업무를 상시 노출하지 않는다.

헤드라인 테스트는 설계 업무에서 `설계`, `설계 발송일`, 정확한 D-day를, 시공 업무에서 `시공`, `준공일`, 정확한 D-day를 찾는다. 공통 `진행 중` 배지는 없어야 한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-work-list-browser.js`

Expected: FAIL because the current list has no active/completed tab contract and the workbench has no lifecycle headline.

- [ ] **Step 3: 목록 탭과 선택 진입 구현**

```js
const workMode = UI.workListMode === "completed" ? "completed" : "active";
const works = workbenchModel.selectWorkList(S, workMode);
```

두 탭은 `role="tablist"`와 `aria-selected`를 사용한다. 기본은 진행 목록이며 완료 업무는 제외한다. 완료 탭의 카드도 기존과 같은 `workId`로 작업대에 진입하되 읽기 전용이다.

- [ ] **Step 4: 작업대 헤드라인 구현**

```html
<header class="workbench-headline">
  <div>
    <p class="eyebrow">현재 업무</p>
    <h1 data-work-title></h1>
    <div class="workbench-headline__meta">
      <span class="phase-badge" data-work-phase></span>
      <span data-owner></span>
    </div>
  </div>
  <div class="workbench-deadline">
    <span data-date-label></span>
    <strong data-dday></strong>
    <time data-date-iso></time>
  </div>
  <button type="button" data-complete-work>업무 완료</button>
</header>
```

D-day는 `D-7`, 당일은 `D-day`, 지난 날짜는 `D+2` 형식으로 표현한다. 날짜가 없으면 `일정 미정`과 `날짜 추가` 버튼을 보인다. 완료 업무는 `완료` 단계와 완료일을 보이고 완료 버튼을 숨긴다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-work-list-browser.js && node product-ui/tests/verify-product-shell-browser.js`

Expected: both browser contracts pass at 1920px and 390px.

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-work-list-browser.js product-ui/tests/verify-product-shell-browser.js package.json
git commit -m "feat: 내 업무 진행 완료 목록과 헤드라인 구현"
```

## Task 4: 세로형 단일 업무 문서 작업대 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-workbench-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 의미 순서와 자료 분리를 검증하는 실패 테스트 작성**

```js
const sectionLabels = await page.locator("[data-workbench-section]").evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("data-workbench-section"))
);
assert.deepEqual(sectionLabels, [
  "headline",
  "progress",
  "official",
  "memory",
  "output",
  "completion"
]);
await expect(page.locator('[data-reference-category="official"] [data-doc-id="RULE-2026-0401"]')).toHaveCount(1);
await expect(page.locator('[data-reference-category="memory"] [data-doc-id="APPR-2025-0409"]')).toHaveCount(1);
await expect(page.locator('[data-reference-category="official"] [data-author-type="personal"]')).toHaveCount(0);
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-workbench-browser.js`

Expected: FAIL because the current workbench renders the old summary/checklist stack.

- [ ] **Step 3: `vWorkbench`를 단일 문서 구조로 교체**

```html
<article class="workbench-dossier">
  <section data-workbench-section="headline"></section>
  <section data-workbench-section="progress" aria-labelledby="progress-title"></section>
  <section data-workbench-section="official" aria-labelledby="official-title"></section>
  <section data-workbench-section="memory" aria-labelledby="memory-title"></section>
  <section data-workbench-section="output" aria-labelledby="output-title"></section>
  <section data-workbench-section="completion" aria-labelledby="completion-title"></section>
</article>
```

기존 `업무 시연 요약`은 제거한다. 각 섹션은 별도 카드처럼 보이되 페이지 전체는 한 문서의 위계로 읽혀야 한다. 공식 지침 카드에는 문서명·발행 조직·시행일/버전·적용 근거·권한 상태를, 업무 메모리 카드에는 연도·원본 업무·작성 주체·연결 이유·확인 상태를 표시한다.

- [ ] **Step 4: 빈 상태와 권한 상태 구현**

- 공식 지침 없음: `연결된 공식 지침 없음`과 `자료 연결`
- 과거 자료 없음: `처음 진행하는 업무`와 신규 초안 안내
- 진행 기록 없음: 첫 메모 입력 안내
- 권한 없음: 문서 제목, 발행 조직, `본문 열람 권한이 없습니다`, 접근 요청 행동
- 분류되지 않은 레거시 자료: 업무 메모리 영역에서 `분류 확인 필요`

빈 상태는 자료를 추정하거나 존재하는 것처럼 보이게 하지 않는다.

- [ ] **Step 5: 데스크톱·모바일 레이아웃 구현**

데스크톱에서도 공식 지침과 업무 메모리를 가로 2열로 강제하지 않는다. 각 영역은 세로로 이어지고 내부 문서 카드만 가용 폭에 따라 1~2열이 된다. 390px에서는 모든 카드가 1열이며 `min-width: 0`, `overflow-wrap: anywhere`를 적용한다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workbench-browser.js`

Expected: semantic order, empty states, access notice, 390px no-overflow contract pass.

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-workbench-browser.js package.json
git commit -m "feat: 세로형 업무 문서 작업대 구현"
```

## Task 5: 진행 메모 원문 저장과 확인 후보 흐름 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Modify: `product-ui/tests/verify-workbench-model.js`
- Modify: `product-ui/tests/verify-workbench-browser.js`

- [ ] **Step 1: 원문 우선 저장과 후보 확인 실패 테스트 작성**

```js
await page.locator("[data-progress-input]").fill("7월 30일까지 도면을 발송하고 담당자에게 확인 요청");
await page.locator("[data-save-progress]").click();
await expect(page.locator("[data-progress-note]").first()).toContainText("7월 30일까지 도면을 발송하고 담당자에게 확인 요청");
await expect(page.locator("[data-progress-candidate]").first()).toHaveAttribute("data-status", "proposed");
await expect(page.locator("[data-work-milestone]")).not.toContainText("도면 발송");
await page.locator("[data-confirm-candidate]").first().click();
await expect(page.locator("[data-progress-candidate]").first()).toHaveAttribute("data-status", "confirmed");
```

분석 함수를 강제로 실패시키는 단위 테스트에서도 `createProgressNote`가 원문을 저장하고 `analysis.status === "failed"`를 유지하는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-workbench-model.js && node product-ui/tests/verify-workbench-browser.js`

Expected: FAIL because the current omni input applies records directly and has no candidate confirmation UI.

- [ ] **Step 3: 작업대 전용 진행 메모 입력 구현**

```js
const rawText = input.value.trim();
let candidates = [];
let analysisError = null;
try {
  candidates = workbenchModel.analyzeProgressText(rawText, {
    simISO: currentSimISO(),
    parseScheduleCandidate: (text) => homeModel.parseScheduleCandidate(text, currentSimISO())
  });
} catch (error) {
  analysisError = String(error.message || error);
}
const note = workbenchModel.createProgressNote(rawText, new Date().toISOString(), candidates);
if (analysisError) note.analysis = { status: "failed", error: analysisError, candidates: [], confirmedCandidateIds: [] };
w.records.unshift(note);
saveState();
```

이 입력은 기존 전역 omni 입력과 분리한다. 저장 직후 원문을 목록에 보여주고, 후보가 있으면 `일정`, `결정`, `변경`, `후속 작업`, `참고 메모` 태그와 해석 근거를 표시한다.

- [ ] **Step 4: 후보 확인·건너뛰기 구현**

확인 버튼은 `confirmProgressCandidate` 반환 업무로 해당 업무만 교체한 뒤 저장한다. 건너뛰기는 후보를 `dismissed`로 바꾸고 원문은 유지한다. 일정 후보는 확정 전 헤드라인 D-day를 바꾸지 않으며, 확정 뒤에도 마일스톤으로만 추가한다. 헤드라인 기준일 변경은 별도 날짜 확인 행동으로 실행한다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workbench-model.js && node product-ui/tests/verify-workbench-browser.js`

Expected: original note survives empty/failed analysis; proposed data is not applied before confirmation.

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-workbench-model.js product-ui/tests/verify-workbench-browser.js
git commit -m "feat: 진행 메모 분석 후보 확인 흐름 구현"
```

## Task 6: 반복·신규 업무 결과물 영역과 문체 교정 경계 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Modify: `product-ui/tests/verify-workbench-browser.js`
- Modify: `product-ui/tests/verify-showcase-e2e.js`

- [ ] **Step 1: 반복·신규 결과물 시작점 실패 테스트 작성**

반복 업무는 회사 템플릿과 전년도 문서 구조를 표시하고 `과거 문서 구조로 초안 열기`가 기존 `#draft/<workId>`로 이동하는지 검증한다. 신규 업무는 `처음 진행하는 업무`, 회사 템플릿, 공식 지침을 표시하고 `빈 초안 시작`으로 같은 편집 화면에 진입하는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-workbench-browser.js`

Expected: FAIL because the current output section does not distinguish recurring/new work.

- [ ] **Step 3: 결과물 시작 근거와 상태 구현**

```js
function outputViewModel(work, references) {
  const recurring = work.output && work.output.mode === "recurring";
  return {
    mode: recurring ? "recurring" : "new",
    title: recurring ? "과거 구조를 활용한 초안" : "공식 기준에서 시작하는 새 초안",
    templateId: work.output && work.output.templateId,
    priorDocumentId: recurring ? work.output && work.output.priorDocumentId : null,
    officialCount: references.official.length,
    finalDocumentId: work.output && work.output.finalDocumentId
  };
}
```

회사 템플릿, 과거 문서, 공식 지침은 각각 출처 배지를 표시한다. 확인되지 않은 값은 빈칸 자동 채움 대신 `확인 필요`로 남긴다.

- [ ] **Step 4: 공기업 문체 교정은 후보 행동으로 표현**

기존 기안 화면에 `공기업 문체 교정안 요청` 행동을 추가한다. 이번 프런트엔드 범위에서는 실제 교정 API가 연결되지 않았으면 버튼을 비활성화하지 않고 안내 패널을 연다.

```html
<div class="tone-candidate-boundary" role="status">
  <strong>문체 교정 연결 준비됨</strong>
  <p>현재 초안은 변경되지 않았습니다. 교정 엔진 연결 후 후보 문장을 이 영역에 표시하고, 적용은 사용자가 선택합니다.</p>
</div>
```

fixture/live/auto 상태가 실제 교정 응답을 제공하지 않는 동안에는 원문을 바꾸거나 교정 완료라고 표시하지 않는다. 향후 API 입력은 `{ workId, text, officialSourceIds }`, 출력은 `{ candidateText, changes, sourceIds }`로 고정하고, 사용자가 `교정안 적용`을 누른 뒤에만 초안이 변경되는 경계를 UI와 테스트 이름에 남긴다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workbench-browser.js && node product-ui/tests/verify-showcase-e2e.js`

Expected: recurring/new entry paths work, and tone action never overwrites draft without an explicit apply action.

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-workbench-browser.js product-ui/tests/verify-showcase-e2e.js
git commit -m "feat: 업무 유형별 결과물 시작 흐름 구현"
```

## Task 7: 완료 확인, 완료 목록, 클라우드 보관 연결

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Modify: `product-ui/tests/verify-workbench-model.js`
- Modify: `product-ui/tests/verify-work-list-browser.js`
- Create: `product-ui/tests/verify-completion-browser.js`
- Modify: `product-ui/tests/verify-product-shell-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 완료 전환 전체 흐름 실패 테스트 작성**

```js
await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-plan-2026`);
await page.locator("[data-complete-work]").click();
await expect(page.locator('[role="dialog"][data-completion-review]')).toBeVisible();
await expect(page.locator("[data-review-output]")).toBeVisible();
await expect(page.locator("[data-review-standards]")).toBeVisible();
await expect(page.locator("[data-review-records]")).toBeVisible();
await expect(page.locator("[data-review-open-items]")).toBeVisible();
await page.locator("[data-acknowledge-open-items]").check();
await page.locator("[data-confirm-completion]").click();
await expect(page).toHaveURL(/#work\/list/);
```

이후 완료 탭에서 같은 `workId`를 찾고 읽기 전용 작업대로 열며, 클라우드에서 같은 완료 묶음 ID를 찾는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-completion-browser.js`

Expected: FAIL because no completion review dialog or cloud bundle list exists.

- [ ] **Step 3: 완료 확인 dialog 구현**

dialog는 최종 결과물, 완료일, 적용 공식 기준, 확정 기록, 미완료 후속 작업을 한 화면에 보여준다. 미완료 항목이 있으면 체크박스로 인지했음을 확인받되 완료 자체를 강제로 막지 않는다. Escape, 취소 버튼, 포커스 복귀, dialog 내부 포커스 이동을 지원한다.

- [ ] **Step 4: 완료 전환과 읽기 전용 작업대 구현**

```js
const result = workbenchModel.completeWork(S, w.id, {
  completedAtISO: new Date().toISOString(),
  completedBy: S.currentPersonId,
  completionDateISO: completionDateInput.value,
  acknowledgeIncomplete: acknowledgement.checked
});
S = result.state;
saveState();
nav("#work/list");
```

완료 작업대의 입력, 자료 연결, 후보 확인, 기안 저장, 완료 행동은 숨기거나 비활성화하고 `완료 당시 기록` 안내를 표시한다.

- [ ] **Step 5: 클라우드 완료 묶음 목록 구현**

`vCloud`는 더 이상 전면 빈 화면만 표시하지 않는다. `selectCloudBundles(S)` 결과를 완료일 역순으로 보여주며 업무명, 완료일, 최종 결과물 유무, 기록 수, 공식 기준 수를 표시한다. 묶음을 선택하면 같은 완료 작업대 읽기 화면으로 이동한다. 묶음이 없을 때만 기존의 정직한 빈 상태를 유지한다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-workbench-model.js && node product-ui/tests/verify-work-list-browser.js && node product-ui/tests/verify-completion-browser.js && node product-ui/tests/verify-product-shell-browser.js`

Expected: completion transition, completed list, read-only workbench, cloud bundle lookup all pass.

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-workbench-model.js product-ui/tests/verify-work-list-browser.js product-ui/tests/verify-completion-browser.js product-ui/tests/verify-product-shell-browser.js package.json
git commit -m "feat: 업무 완료와 클라우드 보관 흐름 연결"
```

## Task 8: 회귀·모바일·화면 기준 검증

**Files:**
- Modify if needed: `product-ui/app.js`
- Modify if needed: `product-ui/style.css`
- Create: `product-ui/screenshots/workbench-golden.png`
- Modify if intentionally changed: `product-ui/screenshots/showcase-golden.png`
- Modify if needed: `product-ui/screenshots/home-two-week-context.png`

- [ ] **Step 1: 정적·순수 모델 검증**

Run: `node --check product-ui/workspace-model.js && node --check product-ui/workbench-model.js && node --check product-ui/app.js`

Run: `node product-ui/tests/verify-workspace-model.js && node product-ui/tests/verify-workbench-model.js && node product-ui/tests/verify-home-model.js`

- [ ] **Step 2: 작업대 관련 브라우저 검증**

Run: `node product-ui/tests/verify-work-list-browser.js && node product-ui/tests/verify-workbench-browser.js && node product-ui/tests/verify-completion-browser.js`

- [ ] **Step 3: 기존 홈·일정·데이터 모드 회귀 검증**

Run: `node product-ui/tests/verify-source-contract.js && node product-ui/tests/verify-home-state.js && node product-ui/tests/verify-product-shell-browser.js && node product-ui/tests/verify-home-browser.js && node product-ui/tests/verify-schedule-browser.js`

Run: `node product-ui/tests/verify-api-client.js && node product-ui/tests/verify-fixtures.js && node product-ui/tests/verify-fixture-reachable-flows.js && node product-ui/tests/verify-showcase-e2e.js`

- [ ] **Step 4: 알려진 Windows sync 제약을 분리해 기록**

Run: `npm run test:product-ui:sync`

이 명령은 현재 기준 브랜치에서도 Windows에서 종료되지 않는 기존 문제가 있다. 120초 안에 끝나지 않으면 이번 변경의 실패로 숨기지 말고 별도 기존 제약으로 보고한다. 나머지 테스트 결과와 섞어 전체 성공으로 표현하지 않는다.

- [ ] **Step 5: 1920×1080 및 390×844 시각 검증**

다음 상태를 각각 캡처한다.

- 설계 단계 업무: 설계 발송일 D-day
- 시공 단계 업무: 준공일 D-day
- 공식 지침과 업무 메모리의 세로 구분
- 진행 메모의 제안/확정 상태
- 반복 업무와 신규 업무 결과물 영역
- 완료 확인 dialog
- 완료 작업대 읽기 전용 상태
- 클라우드 완료 묶음

390px에서는 `document.documentElement.scrollWidth === 390`을 확인하고 섹션 의미 순서가 데스크톱과 동일해야 한다. 기준 이미지가 의도한 새 구조와 일치할 때만 교체한다.

- [ ] **Step 6: 최종 diff와 작업 트리 검증**

Run: `git diff --check`

Run: `git status --short`

Run: `git log --oneline -8`

Expected: only planned files are changed, whitespace errors are absent, each task commit is present.
