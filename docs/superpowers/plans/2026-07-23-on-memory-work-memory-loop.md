# ON_메모리 내 업무·업무 사고 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 일정과 관련 업무를 한곳에 모은 `내 업무` 피드에서 바로 자연어 코멘트를 남기고, 각 업무 작업대가 `언제 / 참고 / 기준 / 산출물 / 최종 결과물`의 사고 흐름을 따라 끝까지 업무 기억을 축적하게 한다.

**Architecture:** 새 순수 모듈 `memory-model.js`가 업무 관계 피드, 다섯 단계 상태, AI 사전 채움, 사용자 확인, 자연어 기록의 구조화 결과를 관리한다. `app.js`는 기존 `/api/briefing`, `/api/ask`, `/api/hint/stage`, `/api/draft`, `/api/check`를 조합해 모델에 사실만 전달한다. 원문·작성자·작성시점은 항상 보존하고, task/stage/source 연결은 상태 관계로 저장한다. 기존 별도 `다음 담당자에게` 흐름은 제거하고 모든 코멘트를 즉시 업무 기억으로 축적한다.

**Tech Stack:** Vanilla JavaScript UMD/CommonJS, 기존 Jikmu 엔진 API/fixture, Node.js `assert`, Playwright

## Global Constraints

- 선행 계획 `2026-07-23-on-memory-role-cloud.md`까지 전체 테스트가 통과한 뒤 시작한다.
- `내 업무`에는 현재 사용자가 owner·participant·reference인 모든 업무와 개인 일정이 함께 나온다.
- 코멘트는 채팅이 아니라 해당 업무 건의 장기 기억이다.
- 사용자는 자연어로만 입력하고 AI가 결정·변경·이유·일정·다음 행동을 구조화한다.
- 화면에는 원문, 작성자 이름, 작성시점을 항상 표시한다. 직무명은 기록 메타데이터에 반복 표시하지 않는다.
- 원문은 구조화 결과로 덮어쓰거나 삭제하지 않는다.
- AI가 하나의 해석을 충분히 확신하면 바로 저장하고 결과·되돌리기를 보여준다. 해석이 모호할 때만 사용자에게 선택을 요청한다.
- 업무 사고 흐름의 질문 문구는 축약하지 않는다. 핵심 단어는 굵게, 현재는 적색, 완료는 녹색, 미래는 회색으로 표현한다.
- 단계는 이전 단계로 다시 들어가 수정할 수 있고 수정 이력을 남긴다.
- 자료가 없거나 해당 없음은 사용자가 명시적으로 확인하면 충족으로 간주한다. AI가 임의로 충족 처리하지 않는다.
- 이 계획에서는 업무 완료 처리를 구현하지 않는다. `최종 결과물` 단계는 준비·연결까지만 구현하고 완료 확정은 다음 계획에서 처리한다.

---

## Task 1: 업무 기억 단계·코멘트 순수 모델 추가

**Files:**
- Create: `product-ui/memory-model.js`
- Create: `product-ui/tests/verify-memory-model.js`
- Modify: `product-ui/index.html`
- Modify: `product-ui/sync-manifest.json`
- Modify: `package.json`

**Interfaces:**

```js
window.OnMemoryMemoryModel = {
  STAGES,
  ensureWorkMemory(work, context),
  deriveStagePrefill(work, briefing),
  confirmStage(work, stageKey, resolution, actor, nowISO),
  revisitStage(work, stageKey, actor, nowISO),
  interpretHintResponse(staged),
  addWorkRecord(work, input),
  undoLastWorkRecord(work),
  selectMyWorkFeed(state, nowISO)
};
```

`STAGES`는 아래 순서와 문구를 고정한다.

```js
[
  { key: "timing", keyword: "언제", suffix: " 해야 하는가" },
  { key: "references", keyword: "무엇을 참고", suffix: "해야 하는가" },
  { key: "criteria", keyword: "어떤 기준", suffix: "을 지켜야 하는가" },
  { key: "output", keyword: "무엇을 만들어야", suffix: " 하는가" },
  { key: "result", keyword: "최종 결과물", suffix: "" }
]
```

- [ ] **Step 1: 실패하는 모델 테스트 작성**

```js
// product-ui/tests/verify-memory-model.js
const assert = require("assert");
const model = require("../memory-model.js");
const work = { id: "work-1", title: "2026 정기점검보수 기본계획 수립", due: "2026-03-31", sources: [], records: [] };
model.ensureWorkMemory(work, { currentPersonId: "person-kim-hannan" });
assert.equal(work.memory.stages.length, 5);
assert.equal(work.memory.stages[0].status, "current");
assert.equal(work.memory.stages[1].status, "future");

model.confirmStage(work, "timing", { kind: "confirmed", value: "2026-03-31" },
  { id: "person-kim-hannan", name: "김한난" }, "2026-01-05T09:00:00.000Z");
assert.equal(work.memory.stages[0].status, "done");
assert.equal(work.memory.stages[1].status, "current");

const record = model.addWorkRecord(work, {
  id: "record-1", text: "운영부 협의 때문에 일정이 이틀 밀렸어요",
  author: { id: "person-kim-hannan", name: "김한난" },
  createdAt: "2026-01-06T10:20:00.000Z",
  stageKey: "timing", structure: { category: "change", reason: "운영부 협의", scheduleChange: "2일 지연" }
});
assert.equal(record.text, "운영부 협의 때문에 일정이 이틀 밀렸어요");
assert.equal(record.authorName, "김한난");
assert.equal(record.structure.category, "change");
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-memory-model.js`

Expected: FAIL with `Cannot find module '../memory-model.js'`.

- [ ] **Step 3: 단계 상태와 사전 채움 구현**

```js
// work.memory 핵심 형태
{
  currentStageKey: "timing",
  stages: [{
    key: "timing",
    status: "current", // current | done | future
    resolution: "unknown", // unknown | confirmed | not-applicable
    value: null,
    confidence: null,
    evidence: [],
    confirmedBy: null,
    confirmedAt: null,
    revisions: []
  }],
  recordUndo: []
}
```

`deriveStagePrefill` 매핑은 다음으로 고정한다: timing←`work.due/schedule`, references←`work.sources`, criteria←동일 `stageId` briefing, output←저장된 draft 메타데이터, result←사용자가 연결한 final artifact. 없는 값은 `unknown`이고 자동으로 `done`이 되지 않는다.

- [ ] **Step 4: 확인·해당 없음·재방문 구현**

`confirmStage`는 `confirmed` 또는 `not-applicable`만 허용하고 actor/time을 저장한 뒤 다음 미완료 단계를 `current`로 바꾼다. `revisitStage`는 기존 resolution을 `revisions`에 복사하고 대상만 `current`로 만든다. 이후 단계의 값은 삭제하지 않고 상태만 `future`로 되돌린다.

- [ ] **Step 5: 자연어 기록과 AI 해석 규칙 구현**

기록은 `{id,text,authorId,authorName,createdAt,stageKey,source:"natural-language",structure}`로 저장한다. `structure`는 `{type,decision,change,reason,schedule,references,nextAction,summary}` 고정 필드를 사용하고 비어 있는 값은 `null`로 둔다. `interpretHintResponse`는 guard가 켜지면 `blocked`, 가장 높은 triple의 confidence가 `>=0.72`이고 2위와 차이가 `>=0.08`이면 `automatic`, 나머지는 `ambiguous`를 반환한다. triple 관계를 다음 범주로 매핑한다.

```js
const CATEGORY_BY_RELATION = {
  causes_risk: "reason",
  mitigated_by: "next-action",
  is_controlled_by: "decision",
  requires_document: "references",
  cross_checks: "decision",
  involves_actor: "change",
  has_tacit_knowledge: "decision"
};
```

관계가 없어도 원문은 `type:"progress"`로 보존한다. `home-model.parseScheduleCandidate`가 날짜를 찾으면 `structure.schedule`과 업무 일정 후보를 함께 만들고, `확정/결정/변경/때문/먼저 확인` 표현은 각각 decision·change·reason·references/nextAction 보조 신호로 사용한다. 이 보조 신호는 원문에 있는 내용만 구조화하고 새로운 날짜·이유를 만들지 않는다.

- [ ] **Step 6: 내 업무 피드 선택자 구현**

`selectMyWorkFeed`는 현재 사용자의 업무 관계와 개인 일정을 합쳐 `{kind:"work"|"personal", id, startISO, endISO, title, relation}` 목록을 만든다. 업무 중복은 하나로 합치고 관계 우선순위는 owner→participant→reference다. 정렬은 오늘 진행 중, 임박 시작/마감, 날짜 없음 순이다.

- [ ] **Step 7: 로드·테스트 등록, 통과, 커밋**

Run: `node product-ui/tests/verify-memory-model.js`

```bash
git add product-ui/memory-model.js product-ui/tests/verify-memory-model.js product-ui/index.html product-ui/sync-manifest.json package.json
git commit -m "feat: 업무 사고 흐름과 기록 모델 추가"
```

## Task 2: 개인 일정과 관련 업무를 합친 `내 업무` 피드 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-my-work-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 피드 브라우저 실패 계약 작성**

owner·participant·reference 업무와 개인 일정을 심고 다음을 검증한다.

- `전체 / 확인 필요 / 관련 작업 / 내 일정 / 완료` 필터가 독립적으로 동작한다.
- 각 관계 업무가 한 번씩 보이고 `담당`, `참여`, `참고` 관계 배지가 사실대로 표시된다.
- 개인 일정도 날짜 순서에 맞춰 보인다.
- 업무 카드마다 날짜, 현재 단계, 다음 행동, 준비 자료 수, 확인 필요 상태와 `검토 / 코멘트 / 열기`가 있다.
- 개인 일정에는 `수정 / 완료`가 있다.
- 이전 `반복 업무만` 중심 목록이 기본 구조로 남지 않는다.
- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-my-work-browser.js`

Expected: FAIL because `vList()` renders only `S.works` cards.

- [ ] **Step 3: `vList`를 업무 피드로 교체**

`memoryModel.selectMyWorkFeed(S, sim)` 결과를 `오늘`, `다가오는 일정`, `날짜 확인 필요` 섹션으로 나누고 `UI.myWorkFilter`로 다섯 필터를 적용한다. 업무 카드는 기간·관계·현재 사고 단계·다음 행동·준비 자료 수·최근 기록·확인 필요 상태를, 개인 일정은 녹색 일정 카드와 수정·완료 동작을 보여준다.

- [ ] **Step 4: 인라인 리뷰·코멘트 입력 배치**

`검토`는 카드 안에서 현재 AI 제안과 확인 필요 항목을 펼치고, `코멘트`는 한 줄 입력을 펼친다. 입력 placeholder는 `결정, 변경, 이유를 편하게 적어보세요`로 고정한다. `열기`는 같은 `workId`의 작업대로 이동한다. 입력 제출은 Task 3의 공통 구조화 함수 `recordNaturalWorkMemory(work,text,box)`를 호출한다.

- [ ] **Step 5: 접근성·모바일 스타일 구현**

피드 section 제목과 카드 heading 계층, 입력 label, 관계 배지의 텍스트를 제공한다. 390px에서는 날짜·관계·현재 단계가 줄바꿈되고 입력/버튼이 세로로 쌓인다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-my-work-browser.js`

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-my-work-browser.js package.json
git commit -m "feat: 개인 일정과 관련 업무 피드 통합"
```

## Task 3: 자연어 코멘트를 자동 구조화해 업무 기억으로 저장

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-my-work-browser.js`
- Modify: `product-ui/tests/verify-showcase-e2e.js`

- [ ] **Step 1: 자동 해석과 모호성 E2E 작성**

확신도 높은 fixture에서는 `성적서를 먼저 확인하고 업체 서류는 7월 30일까지 받기로 함` 제출 직후 원문·`김한난`·작성시점과 확인 자료·후속 일정 구조화 결과가 보이고 `되돌리기`가 나타나야 한다. 모호한 응답에서는 원문을 아직 확정 저장하지 않고 최대 세 개 범주만 질문해야 한다.

- [ ] **Step 2: 공통 구조화 함수 구현**

```js
async function recordNaturalWorkMemory(work, text, resultBox) {
  const staged = await api("/api/hint/stage", { text, stageId: work.stageId || null });
  const interpretation = memoryModel.interpretHintResponse(staged);
  if (interpretation.mode === "automatic") {
    memoryModel.addWorkRecord(work, buildRecordInput(work, text, interpretation));
    saveState();
    return renderRecordResult(resultBox, "업무 기록으로 정리했습니다.", true);
  }
  if (interpretation.mode === "ambiguous") return renderRecordChoices(work, text, interpretation, resultBox);
  return renderGuardMessage(staged.guard, resultBox);
}
```

선택이 필요한 경우에도 사용자가 범주만 고르면 원문은 그대로 저장한다. 기존 `/api/hint/commit`은 엔진 관계 반영에 사용하되 실패하면 로컬 기록을 완료로 표시하지 않는다.

- [ ] **Step 3: 기존 `다음 담당자에게` 흐름 제거**

`[data-hint]`, `hintFlow`, `다음 담당자 메모` 문구를 제거한다. 기존 records는 v2 마이그레이션에서 `authorName:"작성자 확인 필요"`, 기존 timestamp, 원문을 가진 업무 기억으로 보존한다.

- [ ] **Step 4: 결과·되돌리기 구현**

자동 저장 뒤 `결정`, `변경`, `이유`, `일정`, `다음 행동` 중 채워진 항목만 요약하고 `원문 보기`와 `되돌리기`를 제공한다. undo는 마지막 추가 기록만 제거하며 관련 일정 변경이 함께 생겼다면 같은 action으로 복구한다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-my-work-browser.js && node product-ui/tests/verify-showcase-e2e.js`

```bash
git add product-ui/app.js product-ui/tests/verify-my-work-browser.js product-ui/tests/verify-showcase-e2e.js
git commit -m "feat: 자연어 코멘트를 업무 기억으로 구조화"
```

## Task 4: 작업대를 다섯 단계 업무 사고 흐름으로 재구성

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-memory-workbench-browser.js`
- Modify: `product-ui/tests/verify-local-maintenance-demo.js`
- Modify: `package.json`

- [ ] **Step 1: 사고 흐름 브라우저 계약 작성**

다섯 원문 질문이 순서대로 보이고 핵심 단어가 `<strong>`인지 검증한다. 첫 단계는 적색 current, 확인 뒤 녹색 done, 나머지는 회색 future여야 한다. 각 단계의 `확인`, `자료 없음`, `해당 없음`, `다시 보기` 동작을 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-memory-workbench-browser.js`

Expected: FAIL because the workbench still renders a flat four-item showcase.

- [ ] **Step 3: 단계 spine과 상세 패널 구현**

작업대 상단에 세로/가로 progress spine을 렌더링하고 현재 단계 상세를 바로 아래에 표시한다. 질문 문자열 전체는 유지하고 `keyword`만 `<strong>`으로 렌더링한다. 사용자 입력은 항상 escape하며 질문 마크업은 `STAGES` 상수에서만 생성한다.

- [ ] **Step 4: 사전 채움과 불확실성 표시**

- timing: due/업무 기간과 일정 근거
- references: 연결 문서 버튼과 클라우드 경로
- criteria: briefing 단계 설명과 OKF evidence
- output: draft 제목·저장 여부·제출 전 check
- result: 연결된 결과물이 없으면 `아직 연결되지 않음`

AI 사전 채움은 `AI가 찾은 내용` 배지와 confidence 또는 `확인 필요`를 표시하고 사용자 확인 전에는 녹색 done이 되지 않는다.

- [ ] **Step 5: 확인·해당 없음·재방문 UI 연결**

`확인하고 다음`은 actor/time을 저장해 다음 단계로 이동한다. `자료 없음으로 확인`과 `해당 없음으로 확인`은 명시적 resolution을 남긴다. 완료 단계의 `다시 보기`는 기존 값을 유지한 채 current로 전환하고 수정 이유 입력을 받는다.

- [ ] **Step 6: 기존 기능을 단계 안에 재배치**

체크리스트와 일정은 timing, 자료 붙이기와 근거 drawer는 references, briefing/주의는 criteria, 기안과 점검은 output에 배치한다. 진행 기록과 자연어 입력은 모든 단계 아래 공통 패널로 유지한다. 기존 `#draft/<id>` 집중 화면은 output에서 그대로 연다.

- [ ] **Step 7: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-memory-workbench-browser.js && node product-ui/tests/verify-local-maintenance-demo.js`

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-memory-workbench-browser.js product-ui/tests/verify-local-maintenance-demo.js package.json
git commit -m "feat: 작업대에 업무 사고 흐름 적용"
```

## Task 5: 3차 회귀 검증

- [ ] Run: `node --check product-ui/memory-model.js && node --check product-ui/app.js`
- [ ] Run: `npm run test:product-ui`
- [ ] Run: `git diff --check`
- [ ] 1920×1080에서 내 업무 피드, 자동 구조화 결과, 다섯 단계 작업대와 390×844 줄바꿈을 시각 확인한다.
- [ ] 작성자명·시점·원문, 굵은 핵심 단어, 적색/녹색/회색 단계가 영상에서 읽히는지 확인한다.
- [ ] `git status --short`가 깨끗한지 확인한다.
