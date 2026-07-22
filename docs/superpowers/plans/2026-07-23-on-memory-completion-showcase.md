# ON_메모리 완료 기억·통합 시연 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무가 실제로 완료된 결과와 계획 대비 차이를 역할 기억으로 고정하고, 다음 연도 업무가 그 기억을 즉시 재사용하는 하나의 발표용 엔드투엔드 구현물을 완성한다.

**Architecture:** `memory-model.js`에 사용자 확정 완료 snapshot과 다음 주기 seed 생성을 추가한다. 완료는 성공/실패 판정이 아니라 `complete` 단일 상태이며, 단계 확인 상태·실제 일정·비용·범위·이유·최종 결과물·원문 기록·근거를 불변 snapshot으로 묶는다. fixture 시연은 기존 엔진의 정기점검보수 문서·forecast·briefing·draft·check 응답을 사용하고, `product-ui` 검증 후 보안 동기화 도구로 팀 저장소 `service/public/`에 복사한다.

**Tech Stack:** Vanilla JavaScript UMD/CommonJS, Jikmu fixture/live API, Node.js `assert`, Playwright 1.61.1, 기존 보안 동기화 도구

## Global Constraints

- 선행 계획 `2026-07-23-on-memory-work-memory-loop.md`까지 전체 테스트가 통과한 뒤 시작한다.
- 회사 업무 상태는 사용자 확정 후 `완료` 하나로 끝난다. `성공`, `실패`, `불명예`, 점수, 직원 평가를 만들지 않는다.
- AI는 완료를 제안할 수 있지만 완료 상태를 직접 확정하지 않는다.
- 데이터가 없다는 이유로 업무 완료를 막지 않는다. 미확인 단계는 담당자가 `자료 없음`, `해당 없음`, `완료 시점까지 확인 불가` 중 하나와 사유를 명시해 충족시킨 뒤 snapshot에 남긴다.
- 계획 대비 실제 차이는 `지연`, `추가 비용`, `범위 변경`, `변경 이유`, `실제 참고 자료`로 기록한다.
- 최종 결과물은 파일, 결재 참조, 현장 결과, 데이터 묶음 중 하나 이상으로 연결한다.
- 완료 snapshot은 이후 원본 업무가 수정되어도 바뀌지 않는 깊은 복사본이어야 한다.
- 다음 연도 재사용은 전년도 결과를 복사해 정답으로 만들지 않고 `참고할 기억`으로 사전 채움한다.
- 대표 시연 업무는 `2026년 정기점검보수 기본계획 수립` 하나로 고정한다.
- UI 정본은 개인 저장소 `product-ui/`, 실행 복사본은 팀 저장소 `service/public/`이다.
- 두 저장소의 `main`에 직접 푸시하지 않는다. 현재 기능 브랜치에서만 커밋한다.
- 영상 시연은 fixture 모드로 완결되어야 하고 live/auto 모드의 진실한 상태 표시는 보존한다.

---

## Task 1: 사용자 확정 완료 snapshot 모델 구현

**Files:**
- Modify: `product-ui/memory-model.js`
- Create: `product-ui/tests/verify-completion-model.js`
- Modify: `package.json`

**Interfaces:**

```js
window.OnMemoryMemoryModel = {
  // 기존 exports 유지
  buildCompletionPreview(work, input),
  completeWork(work, input, actor, nowISO),
  buildNextCycleSeed(completedWork, nextYear, actor),
  comparePlanAndActual(work, input)
};
```

- [ ] **Step 1: 실패하는 완료 모델 계약 작성**

```js
// product-ui/tests/verify-completion-model.js
const assert = require("assert");
const model = require("../memory-model.js");
const work = {
  id: "work-maintenance-plan-2026",
  title: "2026년 정기점검보수 기본계획 수립",
  due: "2026-03-31",
  schedule: { startISO: "2026-01-05", endISO: "2026-03-31", milestones: [] },
  sources: [{ docId: "PROC-MAINT-31100", role: "절차 근거" }],
  records: [{ id: "rec-1", text: "운영부 협의로 이틀 지연", authorName: "김한난", createdAt: "2026-03-20T09:00:00.000Z" }]
};
model.ensureWorkMemory(work, { currentPersonId: "person-kim-hannan" });

const completed = model.completeWork(work, {
  actualStartISO: "2026-01-05",
  actualEndISO: "2026-04-02",
  addedCost: { amount: 1200000, currency: "KRW", reason: "추가 현장 조사" },
  scopeChanges: ["현장 안전점검 항목 추가"],
  criteriaChanges: ["현장 확인 결과로 점검 기준 보완"],
  reasons: ["운영부 협의 지연"],
  stageResolutions: {
    timing: { kind: "confirmed", value: "2026-04-02" },
    references: { kind: "confirmed", value: ["PROC-MAINT-31100"] },
    criteria: { kind: "confirmed", value: "정기점검보수 절차 기준" },
    output: { kind: "confirmed", value: "기본계획 결재" }
  },
  finalArtifacts: [{ type: "approval", label: "기본계획 결재", reference: "APPROVAL-2026-0402" }]
}, { id: "person-kim-hannan", name: "김한난" }, "2026-04-02T18:00:00.000Z");

assert.equal(completed.status, "complete");
assert.equal(completed.completion.variance.delayDays, 2);
assert.equal(completed.completion.confirmedBy.name, "김한난");
assert.equal(completed.completion.snapshot.records[0].text, "운영부 협의로 이틀 지연");
work.records[0].text = "수정됨";
assert.equal(completed.completion.snapshot.records[0].text, "운영부 협의로 이틀 지연");
assert.equal(JSON.stringify(completed).includes("실패"), false);
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-completion-model.js`

Expected: FAIL because `completeWork` is not defined.

- [ ] **Step 3: 계획 대비 실제 차이 계산 구현**

`comparePlanAndActual`은 ISO 종료일 차이를 정수 일수로 계산하고, 금액은 사용자가 입력한 값만 저장한다. 범위·이유는 빈 문자열을 제거하되 문구를 재작성하지 않는다. 계획 시작/종료가 없으면 `delayDays:null`과 `계획 일정 확인 불가`를 반환한다.

- [ ] **Step 4: 완료 snapshot과 단일 상태 구현**

```js
// work.completion 핵심 형태
{
  status: "complete",
  completedAt: "2026-04-02T18:00:00.000Z",
  confirmedBy: { id: "person-kim-hannan", name: "김한난" },
  finalArtifacts: [{ type: "approval", label: "기본계획 결재", reference: "APPROVAL-2026-0402" }],
  variance: {
    plannedStartISO: "2026-01-05",
    plannedEndISO: "2026-03-31",
    actualStartISO: "2026-01-05",
    actualEndISO: "2026-04-02",
    delayDays: 2,
    addedCost: { amount: 1200000, currency: "KRW", reason: "추가 현장 조사" },
    scopeChanges: ["현장 안전점검 항목 추가"],
    criteriaChanges: ["현장 확인 결과로 점검 기준 보완"],
    reasons: ["운영부 협의 지연"]
  },
  unavailableAtCompletion: [],
  snapshot: { stages: [], records: [], sources: [], roleLibraryItemIds: [] }
}
```

`completeWork`는 actor와 하나 이상의 finalArtifact가 없으면 오류를 낸다. 앞의 네 단계가 미확인이라면 `stageResolutions`에서 `confirmed`, `no-data`, `not-applicable`, `unavailable-at-completion` 중 하나를 담당자가 명시해야 한다. 데이터가 없어도 후자의 세 상태로 완료할 수 있으며 해당 사유는 `unavailableAtCompletion`에 남긴다. 전체 snapshot은 JSON 호환 깊은 복사로 만든다.

- [ ] **Step 5: 상태 문구 안전 계약 추가**

완료 모델과 UI 소스에 `성공`, `실패`, `불명예`, `평가 점수`가 완료 판정으로 들어가지 않는 정적 검증을 추가한다. 일반적인 API 실패 안내 문구는 이 검사에서 제외하고 `.completion-*` 렌더러만 대상으로 한다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-completion-model.js`

Expected: `Completion model contract passed`.

```bash
git add product-ui/memory-model.js product-ui/tests/verify-completion-model.js package.json
git commit -m "feat: 사용자 확정 완료 기억 모델 추가"
```

## Task 2: 작업대 완료 확인과 계획 차이 기록 UI 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-completion-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 완료 UI 브라우저 실패 계약 작성**

작업대에서 `업무 완료 기록`을 열고 결과물 유형·참조, 실제 시작/종료, 추가 비용, 범위 변경, 적용 기준 변경, 이유를 입력한다. 미확인 단계는 담당자가 데이터 부재 유형과 사유를 선택한다. 최종 확인 전 상태가 바뀌지 않고, `이 내용으로 완료 기록`을 누른 뒤에만 `완료` 배지와 snapshot 요약이 나타나는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-completion-browser.js`

Expected: FAIL because the workbench has no completion control.

- [ ] **Step 3: 완료 preview drawer 구현**

`최종 결과물` 단계에 `파일`, `결재`, `현장 결과`, `데이터 묶음` 유형 선택과 label/reference 입력을 둔다. 완료 drawer는 계획값과 실제값을 나란히 보여주고 차이를 계산하되 값은 자동 생성하지 않는다. 미확인 단계가 있으면 `자료 없음 / 해당 없음 / 완료 시점까지 확인 불가`와 사유 입력을 단계별로 제공한다. 데이터 부재 선택은 완료를 막지 않지만 담당자 확인 없이 AI가 자동 선택하지 않는다.

- [ ] **Step 4: 사용자 확정만 상태 변경하도록 연결**

첫 버튼은 `완료 내용 검토`, preview의 최종 버튼은 `이 내용으로 완료 기록`으로 구분한다. 두 번째 버튼에서만 `completeWork`를 호출한다. actor는 현재 사용자 ID/이름을 사용하며 AI나 시스템 이름을 넣지 않는다.

- [ ] **Step 5: 완료 뒤 읽기 전용 요약 구현**

완료 업무는 작업대 상단에 `완료 · 2026.04.02 · 김한난`을 보이고, 결과물·지연·추가비용·범위변경·적용 기준 변경·이유·사용 근거·데이터 부재 확인 단계를 별도 카드로 표시한다. 기존 단계와 원문 코멘트는 계속 열람할 수 있다. `성공/실패` 선택이나 색상은 제공하지 않는다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-completion-browser.js`

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-completion-browser.js package.json
git commit -m "feat: 완료 결과와 계획 차이 기록 화면 구현"
```

## Task 3: 완료 기억에서 다음 연도 업무 준비

**Files:**
- Modify: `product-ui/memory-model.js`
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-completion-model.js`
- Create: `product-ui/tests/verify-reuse-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 다음 주기 seed 실패 테스트 작성**

2026 완료 업무에서 2027 seed를 만들면 새 ID·새 제목·미완료 상태를 가져야 한다. 2026 snapshot의 일정 차이, 이유, 실제 근거, 결과물은 `priorMemory` 아래 읽기 전용 참고로 연결되고 2027 단계가 자동 완료되어서는 안 된다.

- [ ] **Step 2: `buildNextCycleSeed` 구현**

```js
{
  id: "work-maintenance-plan-2027",
  title: "2027년 정기점검보수 기본계획 수립",
  status: "active",
  memory: { currentStageKey: "timing", stages: [/* 모두 미확인 */] },
  priorMemory: {
    workId: "work-maintenance-plan-2026",
    completedAt: "2026-04-02T18:00:00.000Z",
    variance: { delayDays: 2, reasons: ["운영부 협의 지연"] },
    sourceIds: ["PROC-MAINT-31100"],
    finalArtifacts: [{ type: "approval", reference: "APPROVAL-2026-0402" }]
  }
}
```

제목의 첫 네 자리 연도만 바꾸고 나머지 문구와 조직/관계/roleId를 보존한다. 다음 해 due는 사용자가 확인하기 전 `null`로 둔다.

- [ ] **Step 3: 완료 화면에 `다음 연도 준비` 동작 구현**

버튼 클릭 시 새 업무 preview에서 제목과 연도를 확인한 뒤 생성한다. 이미 같은 `priorMemory.workId + year` seed가 있으면 중복 생성하지 않고 기존 업무로 이동한다.

- [ ] **Step 4: 다음 연도 작업대에 과거 기억 카드 표시**

각 단계에 관련된 전년도 memory를 `지난 업무에서 확인된 내용`으로 표시하고 근거 drawer·클라우드 항목으로 이동할 수 있게 한다. 사용자가 `참고하여 확인`을 눌러야 현재 단계 값으로 반영된다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-completion-model.js && node product-ui/tests/verify-reuse-browser.js`

```bash
git add product-ui/memory-model.js product-ui/app.js product-ui/tests/verify-completion-model.js product-ui/tests/verify-reuse-browser.js package.json
git commit -m "feat: 완료 기억의 다음 연도 재사용 연결"
```

## Task 4: 대표 업무 fixture와 하나의 시연 경로 고정

**Files:**
- Modify: `product-ui/workspace-model.js`
- Modify: `product-ui/tests/verify-showcase-e2e.js`
- Create: `docs/showcase/on-memory-demo-runbook.md`

- [ ] **Step 1: 대표 시연 seed를 사실 기반으로 추가**

`workspaceModel.createDemoState()`에 다음 업무를 한 번만 만든다.

```js
{
  id: "work-maintenance-plan-2026",
  title: "2026년 정기점검보수 기본계획 수립",
  departmentId: "dept-plant",
  sectionId: "section-maintenance",
  roleId: "role-maintenance-planning",
  relations: [{ personId: "person-kim-hannan", kind: "owner" }],
  schedule: {
    startISO: "2026-01-05",
    endISO: "2026-03-31",
    milestones: [
      { id: "scope", dateISO: "2026-01-23", label: "점검 범위 확정" },
      { id: "review", dateISO: "2026-03-13", label: "부서 검토" }
    ]
  },
  sources: [{ docId: "PROC-MAINT-31100", role: "절차 근거" }],
  stageId: "problem-recognition",
  status: "active"
}
```

일정과 마일스톤은 시연용 각색 데이터임을 runbook과 화면 데이터 상태에 명시한다. 문서 내용은 기존 `local-maintenance` fixture에서만 읽는다.

- [ ] **Step 2: 엔진 기능 매핑 E2E 작성**

다음 순서를 하나의 Playwright 테스트로 고정한다.

1. 홈 자연어 입력과 내 업무 2주 달력 확인
2. 일정에서 세 레이어를 모두 켜고 대표 업무 전체 막대 확인
3. 클라우드에서 자료 업로드→AI 제안→확인
4. 내 업무 카드에서 `성적서를 먼저 확인하고 업체 서류는 7월 30일까지 받기로 함`을 입력해 원문·확인 자료·일정 구조화 확인
5. 작업대에서 다섯 단계의 근거·기준·초안·점검 확인
6. 실제 결과와 계획 차이를 입력하고 사용자가 완료 확정
7. 2027 업무를 만들고 2026 완료 기억이 참고 카드로 나타나는지 확인

- [ ] **Step 3: E2E가 추측·중복·외부 요청을 막는지 검증**

fixture 모드에서 `/api/*` 네트워크 요청이 없어야 하고, 업무·자료·기록 ID가 화면 전환 후 동일해야 한다. 존재하지 않는 due·근거·결과물을 합성하지 않고, 같은 docId/workId가 중복 저장되지 않는지 확인한다.

- [ ] **Step 4: 발표 runbook 작성**

`docs/showcase/on-memory-demo-runbook.md`에 5~7분 영상 장면, 클릭/대사, 화면에서 보여줄 놀람 포인트, 각색 데이터 고지, 녹화 전 reset 명령을 기록한다. 발표는 UI와 백엔드를 따로 설명하지 않고 한 업무가 기억으로 완성되는 이야기로 구성한다.

- [ ] **Step 5: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-showcase-e2e.js`

```bash
git add product-ui/workspace-model.js product-ui/tests/verify-showcase-e2e.js docs/showcase/on-memory-demo-runbook.md
git commit -m "test: ON_메모리 대표 업무 시연 경로 고정"
```

## Task 5: 전체 회귀·시각·접근성 검증과 UI 버전 확정

**Files:**
- Modify: `product-ui/version.json`
- Modify if needed: `product-ui/app.js`
- Modify if needed: `product-ui/style.css`
- Generated verification artifacts: `product-ui/screenshots/on-memory-*.png`

- [ ] `product-ui/version.json`을 `ui-v2.0.0`으로 변경한다.
- [ ] Run: `node --check product-ui/workspace-model.js && node --check product-ui/cloud-model.js && node --check product-ui/memory-model.js && node --check product-ui/app.js`
- [ ] Run: `npm run test:product-ui`
- [ ] Run: `git diff --check`
- [ ] 1920×1080 fixture 모드에서 홈, 세 레이어 일정, 클라우드 제안, 내 업무 코멘트, 사고 흐름 current/done/future, 완료 snapshot, 2027 재사용을 캡처한다.
- [ ] 390×844에서 메뉴 이름, 입력, 단계 질문, 완료 drawer가 잘리지 않고 키보드 focus가 보이는지 확인한다.
- [ ] 브라우저 console/page error, 4xx 응답, 문서 전체 overflow가 0인지 확인한다.
- [ ] Run: `git status --short` and verify only expected version/screenshot changes remain.
- [ ] Commit:

```bash
git add product-ui/version.json product-ui/app.js product-ui/style.css product-ui/screenshots
git commit -m "release: ON_메모리 시연 UI v2"
```

## Task 6: 검증된 UI를 팀 저장소 실행 복사본에 동기화

**Files:**
- Source: `product-ui/**`
- Generated/Modify: `/Users/openclaw/projects/jikmu-memory/service/public/**`
- Generated/Modify: `/Users/openclaw/projects/jikmu-memory/service/public/.ui-source.json`

- [ ] **Step 1: 두 저장소 안전 조건 확인**

```bash
git status --short --branch
git -C /Users/openclaw/projects/jikmu-memory status --short --branch
git remote get-url origin
git -C /Users/openclaw/projects/jikmu-memory remote get-url origin
```

Expected: source branch `feature/on-memory-brand`, target branch `ui/showcase-integration`, both clean, remotes are the two approved GitHub repositories.

- [ ] **Step 2: 동기화 dry-run**

```bash
node tools/sync-product-ui.js --target /Users/openclaw/projects/jikmu-memory --check
```

Expected before first v2 sync: exit 1 with `changed=true`; no target file is modified.

- [ ] **Step 3: 허용 목록 동기화 실행**

```bash
node tools/sync-product-ui.js --target /Users/openclaw/projects/jikmu-memory --write
```

Expected: only manifest-managed `service/public/` files and `.ui-source.json` change; `service/src/` and `service/server.js` remain untouched.

- [ ] **Step 4: 팀 엔진과 통합 UI 검증**

```bash
npm --prefix /Users/openclaw/projects/jikmu-memory/service test
npm --prefix /Users/openclaw/projects/jikmu-memory/service run test:ui
```

Expected: all engine tests and UI integration tests pass.

- [ ] **Step 5: 동기화 후 일치 확인**

```bash
node tools/sync-product-ui.js --target /Users/openclaw/projects/jikmu-memory --check
```

Expected: exit 0 with `changed=false`.

- [ ] **Step 6: 팀 브랜치에 실행 복사본 커밋**

```bash
git -C /Users/openclaw/projects/jikmu-memory add service/public
git -C /Users/openclaw/projects/jikmu-memory commit -m "feat: ON_메모리 통합 시연 UI 동기화"
```

- [ ] **Step 7: 푸시 전 최종 상태 보고**

두 저장소의 branch, HEAD, clean status, 전체 테스트 결과, `.ui-source.json`의 source commit/version을 기록한다. 사용자 요청 없이는 push나 main merge를 실행하지 않는다.
