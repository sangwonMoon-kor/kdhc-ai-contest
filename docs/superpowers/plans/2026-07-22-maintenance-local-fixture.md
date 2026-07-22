# Maintenance Local Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 비식별 변환본 `sanitized.md`의 정기점검보수 기본계획 절을 외부 전송 없이 로컬 Product UI 질문·근거 흐름에 연결한다.

**Architecture:** 추적 가능한 Node.js 변환기가 로컬 Markdown의 필수 구조만 확인하고 고정된 최소 응답 계약을 `product-ui/fixtures/local-maintenance/`에 생성한다. API 클라이언트는 유지보수 질문과 로컬 문서 ID만 이 오버레이로 라우팅하고, 오버레이가 없으면 기존 `ask/not-found.json`으로 복귀한다. 원문과 생성물은 Git에서 제외하며 기존 fixture/live/auto 동작은 유지한다.

**Tech Stack:** Node.js CommonJS, browser JavaScript, JSON fixtures, Playwright, Node `assert`

## Global Constraints

- `sanitized.md`, `변환결과_REVIEW.json`, `.env`, 생성된 `product-ui/fixtures/local-maintenance/`는 Git에 추가하지 않는다.
- 변환기는 네트워크를 사용하지 않고 원본 절대경로를 출력·생성물에 기록하지 않는다.
- 기관명, 원문 개정·시행일, 마스킹 토큰, 이미지 파일명, 법령 세부 조문, 장문 인용을 생성물에 넣지 않는다.
- 별도 UI 세션과 충돌하지 않도록 `product-ui/index.html`, `product-ui/style.css`, `product-ui/app.js`는 수정하지 않는다.
- 각 기능은 테스트를 먼저 추가하고 실패를 확인한 뒤 최소 구현으로 통과시킨다.

---

### Task 1: 로컬 전용 경계와 변환기 계약

**Files:**

- Modify: `.gitignore`
- Create: `tools/tests/verify-build-local-maintenance-fixture.js`
- Create: `tools/build-local-maintenance-fixture.js`

**Step 1: 실패하는 변환기 테스트 작성**

테스트가 임시 폴더에 합성 Markdown을 만들고 다음을 검증하게 한다.

- 필수 절이 모두 있으면 ask/document/manifest 세 파일이 생성된다.
- ask 응답은 `/api/ask` 계약(`grounded`, `answer`, `knowledge`, `docs`)을 만족한다.
- 문서 상세는 `/api/documents/:id` 계약(`doc.id`, `edges`)을 만족한다.
- manifest에는 SHA-256과 `localOnly: true`만 남고 원본 경로는 없다.
- 생성 JSON 전체에 `[ORG_…]`, `[PERSON_…]`, `image_…`, 합성 원문의 기관명이 없다.
- 필수 절이 하나라도 없으면 실패하고 출력 폴더를 남기지 않는다.

**Step 2: RED 확인**

Run: `node tools/tests/verify-build-local-maintenance-fixture.js`

Expected: `Cannot find module '../build-local-maintenance-fixture.js'` 또는 동등한 미구현 실패.

**Step 3: 변환기 최소 구현**

`tools/build-local-maintenance-fixture.js`에 다음 공개 계약을 구현한다.

```js
module.exports = {
  REQUIRED_MARKERS,
  buildMaintenanceFixture,
  writeMaintenanceFixture
};
```

- `buildMaintenanceFixture(markdown, { generatedAt })`는 구조 검증 후 고정된 최소 한국어 요약 JSON 세트를 반환한다.
- `writeMaintenanceFixture(inputPath, outputRoot, options)`는 UTF-8 입력을 읽고 임시 출력 디렉터리에 쓴 뒤 검증 성공 시 최종 폴더로 교체한다.
- CLI는 `--input <path>`와 선택적 `--output <path>`를 받는다.
- 기본 출력은 `product-ui/fixtures/local-maintenance`이다.
- 출력 직렬화 결과에 금지 패턴이 있으면 쓰기를 중단한다.

**Step 4: 로컬 경계 추가**

`.gitignore`에 다음을 추가한다.

```gitignore
.env
product-ui/fixtures/local-maintenance/
```

**Step 5: GREEN 확인**

Run: `node tools/tests/verify-build-local-maintenance-fixture.js`

Expected: `Local maintenance fixture builder contract passed`

**Step 6: 변경 검사 및 커밋**

Run: `git diff --check`

Run: `git check-ignore -v .env product-ui/fixtures/local-maintenance/manifest.json`

Commit: `git add .gitignore tools/build-local-maintenance-fixture.js tools/tests/verify-build-local-maintenance-fixture.js && git commit -m "feat: 로컬 유지보수 fixture 변환기 추가"`

---

### Task 2: API 클라이언트 로컬 오버레이 라우팅과 폴백

**Files:**

- Modify: `product-ui/tests/verify-api-client.js`
- Modify: `product-ui/api-client.js`

**Step 1: 실패하는 라우팅 테스트 추가**

다음을 기존 API 클라이언트 계약 테스트에 추가한다.

```js
assert.equal(
  fixturePath("/api/ask", { question: "올해 정기점검보수 기본계획을 어떻게 수립해야 해?" }),
  "local-maintenance/ask/maintenance-plan.json"
);
assert.equal(
  fixturePath("/api/documents/PROC-MAINT-31100"),
  "local-maintenance/documents/PROC-MAINT-31100.json"
);
```

추가 fetch 모의 테스트로 로컬 ask가 404일 때 `fixtures/ask/not-found.json`을 요청하고, 로컬 문서 상세의 404는 감추지 않으며, 기존 펌프 질문과 live 모드는 그대로임을 검증한다.

**Step 2: RED 확인**

Run: `node product-ui/tests/verify-api-client.js`

Expected: 유지보수 질문 경로가 `ask/not-found.json`으로 반환되어 assertion 실패.

**Step 3: 최소 라우팅 구현**

`product-ui/api-client.js`에 다음 규칙을 추가한다.

- 문서 ID가 `PROC-MAINT-31100`이면 로컬 문서 상세로 라우팅한다.
- 질문에 `정기점검보수` 또는 `유지보수`와 `계획/수립/절차` 조합이 있으면 로컬 ask로 라우팅한다.
- 로컬 ask GET만 `HTTP 404`일 때 기존 `ask/not-found.json`을 다시 GET한다.
- manifest 실패, JSON 계약 실패, 로컬 문서 상세 실패는 폴백으로 감추지 않는다.
- fixture 요청은 계속 GET만 사용하고 질문 본문을 fixture host에 보내지 않는다.

**Step 4: GREEN 및 회귀 확인**

Run: `node product-ui/tests/verify-api-client.js`

Run: `node product-ui/tests/verify-fixture-reachable-flows.js`

Expected: 두 테스트 모두 통과.

**Step 5: 변경 검사 및 커밋**

Run: `git diff --check`

Commit: `git add product-ui/api-client.js product-ui/tests/verify-api-client.js && git commit -m "feat: 유지보수 로컬 fixture 라우팅 추가"`

---

### Task 3: 실제 `sanitized.md` 로컬 fixture 생성과 정적 검증

**Files:**

- Local input only: `C:/Users/User/Desktop/클로드/sanitized.md`
- Generated and ignored: `product-ui/fixtures/local-maintenance/manifest.json`
- Generated and ignored: `product-ui/fixtures/local-maintenance/ask/maintenance-plan.json`
- Generated and ignored: `product-ui/fixtures/local-maintenance/documents/PROC-MAINT-31100.json`

**Step 1: 실제 입력으로 생성**

Run:

```powershell
node tools/build-local-maintenance-fixture.js --input "C:\Users\User\Desktop\클로드\sanitized.md"
```

Expected: 세 파일 생성, 입력 SHA-256 출력, 원본 경로 미출력.

**Step 2: API 계약으로 생성물 검증**

Run:

```powershell
node -e "const fs=require('fs'); const {normalizeResponse}=require('./product-ui/api-client'); const base='product-ui/fixtures/local-maintenance'; normalizeResponse('/api/ask',JSON.parse(fs.readFileSync(base+'/ask/maintenance-plan.json','utf8'))); normalizeResponse('/api/documents/PROC-MAINT-31100',JSON.parse(fs.readFileSync(base+'/documents/PROC-MAINT-31100.json','utf8'))); console.log('local maintenance fixture shapes passed')"
```

Expected: `local maintenance fixture shapes passed`

**Step 3: 보안 패턴과 Git 제외 확인**

Run: `rg -n "\[(ORG|PERSON|DATE|ADDR|PHONE|EMAIL)_[^]]+\]|image_[0-9]+|C:\\\\Users" product-ui/fixtures/local-maintenance`

Expected: 검색 결과 없음.

Run: `git status --short --ignored product-ui/fixtures/local-maintenance .env`

Expected: `.env`와 local-maintenance가 `!!`로 표시되고 `??`가 없음.

---

### Task 4: 로컬 유지보수 질문 브라우저 시연 검증

**Files:**

- Create: `product-ui/tests/verify-local-maintenance-demo.js`

**Step 1: 실패하는 E2E 테스트 작성**

테스트는 포트 `8422`에 현재 Product UI를 실행하고 다음을 검증한다.

- `?data=fixture#home`에서 질문 입력창이 열린다.
- “올해 정기점검보수 기본계획을 어떻게 수립해야 해?” 입력 후 근거 있음 배지가 나타난다.
- 답변에 `작업 항목`, `예산`, `과거 기록`, `관련 부서`, `자료관리`가 나타난다.
- 관련 문서 버튼의 `data-ev`가 `PROC-MAINT-31100`이다.
- 근거 서랍에 구조화 절차와 체크리스트가 나타난다.
- `/api/*` 네트워크 요청, console error, page error가 0건이다.
- 로컬 fixture가 없으면 명시적으로 실패해 잘못된 시연을 통과시키지 않는다.

**Step 2: RED 확인**

Run: `node product-ui/tests/verify-local-maintenance-demo.js`

Expected: 테스트 파일 미구현 또는 시연 요소 assertion 실패.

**Step 3: E2E 최소 구현 및 GREEN 확인**

기존 `verify-showcase-e2e.js`의 서버·브라우저 종료 패턴을 재사용해 독립 실행 가능한 테스트를 작성한다.

Run: `node product-ui/tests/verify-local-maintenance-demo.js`

Expected: `Local maintenance demo flow passed`

**Step 4: 기존 Product UI 회귀 확인**

Run: `node product-ui/tests/verify-source-contract.js`

Run: `node product-ui/tests/verify-fixtures.js`

Run: `node product-ui/tests/verify-api-client.js`

Run: `node product-ui/tests/verify-fixture-reachable-flows.js`

Run: `node product-ui/tests/verify-showcase-e2e.js`

Expected: 모두 통과.

**Step 5: 커밋**

Run: `git add product-ui/tests/verify-local-maintenance-demo.js && git commit -m "test: 유지보수 로컬 시연 흐름 검증"`

---

### Task 5: 최종 보안·Git 인수 점검

**Files:**

- Verify only: tracked changes and ignored local files

**Step 1: 금지 파일 추적 여부 확인**

Run: `git ls-files --error-unmatch .env sanitized.md "변환결과_REVIEW.json" product-ui/fixtures/local-maintenance/manifest.json`

Expected: 모두 추적되지 않아 non-zero 종료.

**Step 2: 전체 변경 품질 확인**

Run: `git diff --check HEAD~3..HEAD`

Run: `git status --short --branch`

Expected: `.env`와 로컬 생성물이 표시되지 않고 추적 파일 워킹트리가 깨끗하다.

**Step 3: 인수 결과 기록**

최종 보고에는 다음만 포함한다.

- 대표 질문과 확인된 화면 결과
- 실행한 테스트 및 통과 여부
- 원문/생성물의 Git 제외 상태
- 생성물 재생성 명령
- push하지 않았다는 현재 브랜치 상태
