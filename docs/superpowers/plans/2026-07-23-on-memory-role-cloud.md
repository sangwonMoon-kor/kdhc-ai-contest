# ON_메모리 역할 클라우드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 자신의 업무 자료를 편하게 올리면 AI가 연도·폴더·태그·업무 연결을 제안하고, 확인된 자료를 현재 역할에 귀속되는 C드라이브형 `내 클라우드`로 정리한다.

**Architecture:** 앞 계획의 v2 상태 안 `roleLibraries` 배열은 역할별 라이브러리 메타데이터를 보존하고, 새 순수 모듈 `cloud-model.js`가 현재 역할의 라이브러리를 선택·정리한다. 원본 파일·붙여넣기 원문은 `cloud-store.js`가 IndexedDB에 Blob으로 보존한다. `/api/ingest` 결과를 폴더·태그·업무 연결 제안으로 변환하고 사용자가 확인하면 제안을 항목에 적용한다. 이미 확인된 정리 규칙은 높은 신뢰도에서만 자동 적용하고 마지막 동작을 되돌릴 수 있게 한다. 화면은 공통 셸의 `#cloud` 라우트에서 현재 역할 라이브러리만 보여준다.

**Tech Stack:** Vanilla JavaScript UMD/CommonJS, IndexedDB Blob 저장소, 기존 파일 추출기 `extract.js`, `JikmuApi /api/ingest`·`/api/ingest/commit`, Node.js `assert`, Playwright

## Global Constraints

- 선행 계획 `2026-07-23-on-memory-shell-schedule.md`의 v2 상태·공통 셸·전체 테스트가 통과한 뒤 시작한다.
- 화면명은 `내 클라우드`지만 자료 소유 단위는 개인 계정이 아니라 `currentRoleId`다.
- 다른 사람의 자료나 부서 공용 드라이브는 이 화면에 섞지 않는다.
- 기본 폴더는 `연도 / 업무 건` 구조이며 사용자가 직접 만든 하위 폴더를 허용한다.
- AI는 `폴더`, `태그`, `업무 연결`을 제안하고 사용자가 확인한 뒤 적용한다.
- 확인된 반복 규칙만 자동 적용할 수 있으며, 자동 적용 직후에는 `되돌리기`를 제공한다.
- 암호화·손상·미지원 형식도 항목 자체를 삭제하지 않고 `내용 확인 불가` 상태로 원본 이름과 업로드 시점을 보존한다.
- 문서 원문과 사용자가 붙여넣은 원본 텍스트는 구조화 결과와 별도로 보존한다.
- 사용자가 역할을 떠나는 삭제·정리·인수인계 승인 단계는 이 계획에 넣지 않는다.
- 기존 업무 작업대의 자료 붙이기와 엔진 인제스트 계약은 깨지지 않아야 한다.

---

## Task 1: 역할 라이브러리 순수 모델 구현

**Files:**
- Create: `product-ui/cloud-model.js`
- Create: `product-ui/cloud-store.js`
- Create: `product-ui/tests/verify-cloud-model.js`
- Create: `product-ui/tests/verify-cloud-store-browser.js`
- Modify: `product-ui/index.html`
- Modify: `product-ui/sync-manifest.json`
- Modify: `package.json`

**Interfaces:**

```js
window.OnMemoryCloudModel = {
  getRoleLibrary(state, roleId),
  createAsset(input),
  createOrganizationProposal(asset, ingestResult, works, nowISO),
  confirmProposal(roleLibrary, proposalId, selection, nowISO),
  learnRule(roleLibrary, confirmedProposal),
  applyKnownRule(roleLibrary, assetId, nowISO),
  undoLastOrganization(roleLibrary),
  buildFolderTree(roleLibrary),
  selectRoleItems(state)
};

window.OnMemoryCloudStore = {
  putOriginal(assetId, blob),
  getOriginal(assetId),
  hasOriginal(assetId)
};
```

- [ ] **Step 1: 실패하는 모델 계약 작성**

```js
// product-ui/tests/verify-cloud-model.js
const assert = require("assert");
const cloud = require("../cloud-model.js");
const library = { roleId: "role-maintenance-planning", items: [], proposals: [], rules: [], actionLog: [] };
const asset = cloud.createAsset({
  id: "asset-1", roleId: library.roleId, fileName: "2026 정기점검 기본계획.hwp",
  uploadedAt: "2026-01-05T09:00:00.000Z", extractionStatus: "ready", contentRef: "asset-1"
});
library.items.push(asset);
const proposal = cloud.createOrganizationProposal(asset, {
  doc: { id: "DOC-1", title: "2026년 정기점검보수 기본계획", date: "2026-01-05", stageId: "problem-recognition" },
  triples: []
}, [{ id: "work-plan-2026", title: "2026년 정기점검보수 기본계획 수립" }], "2026-01-05");
library.proposals.push(proposal);

assert.deepEqual(proposal.folderPath, ["2026", "2026년 정기점검보수 기본계획 수립"]);
assert.equal(proposal.workId, "work-plan-2026");
cloud.confirmProposal(library, proposal.id, { folder: true, tags: true, work: true }, "2026-01-05T09:01:00.000Z");
assert.equal(library.items[0].organizationStatus, "organized");
assert.equal(cloud.buildFolderTree(library).children[0].name, "2026");
cloud.undoLastOrganization(library);
assert.equal(library.items[0].organizationStatus, "unorganized");
```

- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-cloud-model.js`

Expected: FAIL with `Cannot find module '../cloud-model.js'`.

- [ ] **Step 3: 원본 보존형 항목과 제안 스키마 구현**

```js
// 라이브러리 항목 핵심 형태
{
  id: "asset-1",
  roleId: "role-maintenance-planning",
  fileName: "2026 정기점검 기본계획.hwp",
  uploadedAt: "2026-01-05T09:00:00.000Z",
  extractionStatus: "ready", // ready | unreadable
  extractionMessage: null,
  contentRef: "asset-1",
  docId: "DOC-1",
  folderPath: [],
  tags: [],
  workId: null,
  organizationStatus: "unorganized" // unorganized | proposed | organized | auto-organized
}
```

제안은 `{id,assetId,folderPath,tags,workId,confidence,reasons,status}`를 갖는다. `createOrganizationProposal`은 문서 날짜 또는 파일명의 네 자리 연도를 우선하고, 연결 업무는 정규화된 제목 토큰이 가장 많이 겹치는 업무만 선택한다. 동점이나 점수 부족은 `workId:null`로 남긴다.

- [ ] **Step 4: IndexedDB 원본 저장소 구현**

`cloud-store.js`는 `on-memory-cloud-v1` 데이터베이스의 `originals` object store에 `{assetId,blob,savedAt}`를 저장한다. 파일은 원본 `File` Blob 그대로, 붙여넣기는 `text/plain;charset=utf-8` Blob으로 저장한다. 저장 실패 시 항목을 정리 완료로 진행하지 않고 `원본 보존 실패`를 보여준다. 삭제 API는 제공하지 않는다. Playwright 테스트는 새 페이지를 열어도 `getOriginal(assetId).text()`가 동일한지 검증한다.

- [ ] **Step 5: 확인·학습·되돌리기 구현**

`confirmProposal`은 사용자가 체크한 세 영역만 반영하고 적용 전 항목 스냅샷을 `actionLog`에 넣는다. 동일 확장자·제목 패턴·업무 연결이 두 번 확인된 경우에만 규칙을 학습한다. `applyKnownRule`은 `confidence >= 0.92`인 단일 규칙에서만 실행하며 `organizationStatus:"auto-organized"`를 남긴다.

- [ ] **Step 6: 역할 필터와 폴더 트리 구현**

`getRoleLibrary(state,state.currentRoleId)`와 `selectRoleItems(state)`는 현재 역할과 동일한 라이브러리만 반환한다. `buildFolderTree`는 정렬된 폴더 노드와 파일 leaf를 만들고 `unorganized` 항목은 `정리 대기` 가상 폴더에 둔다. `currentRoleId`를 바꿨을 때 이전 역할 라이브러리는 배열에 그대로 남고 새 역할 화면에는 섞이지 않아야 한다. 반대로 `currentPersonId`만 후임자로 바꾸고 역할 ID를 유지하면 같은 역할 라이브러리가 그대로 보이는 테스트를 추가한다.

- [ ] **Step 7: 브라우저 로드와 테스트 등록**

`index.html`에서 `cloud-store.js`, `cloud-model.js`를 `workspace-model.js` 다음에 로드하고 `sync-manifest.json`, `package.json` 전체 체인에 두 테스트를 등록한다.

- [ ] **Step 8: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-cloud-model.js && node product-ui/tests/verify-cloud-store-browser.js`

Expected: `Cloud model contract passed`.

```bash
git add product-ui/cloud-model.js product-ui/cloud-store.js product-ui/tests/verify-cloud-model.js product-ui/tests/verify-cloud-store-browser.js product-ui/index.html product-ui/sync-manifest.json package.json
git commit -m "feat: 역할 클라우드 정리 모델 추가"
```

## Task 2: `내 클라우드` C드라이브형 화면 구현

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Create: `product-ui/tests/verify-cloud-browser.js`
- Modify: `package.json`

- [ ] **Step 1: 브라우저 실패 계약 작성**

시드 상태에 `2024 / 정기점검`, `2025 / 정기점검`, `정리 대기` 항목을 넣고 다음을 검증한다.

- 사이드바에서 `클라우드`가 현재 메뉴로 표시된다.
- 화면 제목은 `내 클라우드`이고 현재 역할명 `정기점검보수 계획`을 함께 보여준다.
- 좌측 폴더 트리와 우측 파일 목록이 같은 선택 경로를 반영한다.
- 다른 역할의 항목은 DOM에 나타나지 않는다.
- 파일 행에는 업로드 시점, 태그, 연결 업무, 정리 상태가 보인다.
- [ ] **Step 2: 실패 확인**

Run: `node product-ui/tests/verify-cloud-browser.js`

Expected: FAIL because `#cloud` still renders an empty state.

- [ ] **Step 3: 라이브러리 레이아웃과 상호작용 구현**

`vCloud(main)`은 상단 업로드 영역, 좌측 폴더 트리, 우측 경로 breadcrumb·파일 목록, 하단 정리 상태 설명으로 구성한다. 폴더 버튼은 `aria-expanded`, 현재 경로는 `aria-current`, 파일 행은 키보드로 선택 가능하게 한다. `UI.cloudPath`를 저장해 재방문 시 경로를 복원한다.

- [ ] **Step 4: 빈 상태와 읽기 불가 상태 구현**

자료가 없을 때는 `자료를 올리면 AI가 연도와 업무별로 정리해 드립니다`를 보여준다. 읽기 불가 파일은 숨기지 않고 파일명, 업로드 시점, 오류 이유, `원본 보존됨` 배지를 표시한다.

- [ ] **Step 5: 반응형 스타일 구현**

데스크톱은 280px 트리 + 유동 목록, 태블릿 이하는 트리를 가로 breadcrumb/folder strip으로 전환한다. 홈과 같은 흰 패널·옅은 적색 광원·붉은 선택 포인트를 쓰되 폴더는 중립색, 정리 완료는 녹색으로 표현한다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-cloud-browser.js`

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-cloud-browser.js package.json
git commit -m "feat: 내 클라우드 라이브러리 화면 구현"
```

## Task 3: 업로드→AI 제안→사용자 확인→정리 흐름 연결

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-cloud-browser.js`
- Modify: `product-ui/tests/verify-fixture-reachable-flows.js`

- [ ] **Step 1: 업로드 E2E 실패 시나리오 작성**

브라우저에서 텍스트 파일을 업로드하고 `/api/ingest` fixture 응답을 받은 뒤 `2026 / 2026년 정기점검보수 기본계획 수립`, 태그, 연결 업무 제안을 확인한다. `폴더·태그·업무 연결` checkbox를 모두 선택해 반영하면 해당 폴더로 이동하고 업무의 `sources`에 같은 `docId`가 한 번만 추가되어야 한다.

- [ ] **Step 2: 원본부터 즉시 저장**

파일 선택 직후 `cloudModel.getRoleLibrary(S,S.currentRoleId)`로 현재 역할 라이브러리를 얻고 `createAsset`으로 그 `items`에 메타데이터를 만든다. `cloudStore.putOriginal(asset.id, file)`을 완료한 뒤 상태를 저장한다. 붙여넣기는 텍스트 Blob으로 같은 저장소에 넣는다. 추출 성공은 `ready`, 실패는 `unreadable`·오류 문구를 저장한다. 어느 경우든 원본 Blob과 파일 항목은 남는다.

- [ ] **Step 3: 기존 엔진 인제스트를 제안으로 변환**

```js
const original = await cloudStore.getOriginal(asset.id);
const text = await extractFileTextOrBlob(asset, original);
const staged = await api("/api/ingest", { text });
const proposal = cloudModel.createOrganizationProposal(asset, staged, S.works, simISO);
const library = cloudModel.getRoleLibrary(S, S.currentRoleId);
library.proposals.push(proposal);
saveState();
```

`extractFileTextOrBlob`은 원본이 `File`이면 기존 `extractFileText`, 붙여넣기 `text/plain` Blob이면 `blob.text()`를 호출하며 다른 경로를 추측하지 않는다.

사람 평가 위험 guard가 켜지면 문구를 업무 절차 표현으로 바꾸라는 기존 제안을 보여주고 자동 정리를 중단한다. guard가 없으면 폴더·태그·업무 연결 세 항목을 각각 확인할 수 있는 review panel을 연다.

- [ ] **Step 4: 확인 후 엔진 commit과 로컬 연결을 원자적으로 처리**

`/api/ingest/commit`이 성공한 뒤 `confirmProposal`을 호출하고, 선택된 업무가 있으면 `work.sources`에 `{docId,role:"역할 클라우드"}`를 중복 없이 추가한다. API 실패 시 제안 상태를 유지해 재시도할 수 있게 하고 정리 완료로 표시하지 않는다.

- [ ] **Step 5: 취소 의미를 삭제가 아닌 정리 대기로 구현**

review panel의 `나중에 확인`은 제안만 `deferred`로 바꾸고 원본 항목은 `정리 대기`에 둔다. 파일 삭제 버튼은 제공하지 않는다.

- [ ] **Step 6: 통과 확인과 커밋**

Run: `node product-ui/tests/verify-cloud-browser.js && node product-ui/tests/verify-fixture-reachable-flows.js`

```bash
git add product-ui/app.js product-ui/tests/verify-cloud-browser.js product-ui/tests/verify-fixture-reachable-flows.js
git commit -m "feat: AI 클라우드 정리 확인 흐름 연결"
```

## Task 4: 확인된 규칙 자동 정리와 되돌리기

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-cloud-model.js`
- Modify: `product-ui/tests/verify-cloud-browser.js`

- [ ] 두 번 확인된 동일 패턴 뒤 세 번째 파일이 `auto-organized` 되는 실패 테스트를 추가한다.
- [ ] 자동 정리 배너에 적용 폴더·태그·업무를 요약하고 `되돌리기` 버튼을 제공한다.
- [ ] 되돌리면 항목을 `정리 대기`로 복원하고 적용 규칙은 남기되 해당 자동 적용만 취소한다.
- [ ] 여러 규칙이 같은 신뢰도로 충돌하면 자동 적용하지 않고 review panel을 연다.
- [ ] Run: `node product-ui/tests/verify-cloud-model.js && node product-ui/tests/verify-cloud-browser.js`
- [ ] Commit:

```bash
git add product-ui/cloud-model.js product-ui/app.js product-ui/tests/verify-cloud-model.js product-ui/tests/verify-cloud-browser.js
git commit -m "feat: 클라우드 자동 정리와 되돌리기 추가"
```

## Task 5: 2차 회귀 검증

- [ ] Run: `node --check product-ui/cloud-model.js && node --check product-ui/app.js`
- [ ] Run: `npm run test:product-ui`
- [ ] Run: `git diff --check`
- [ ] 1920×1080과 390×844에서 빈 라이브러리, 정리 제안, 연도/업무 폴더, 읽기 불가 원본, 자동 정리 되돌리기를 시각 확인한다.
- [ ] `git status --short`가 깨끗한지 확인한다.
