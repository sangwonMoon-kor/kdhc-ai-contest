# ON_메모리 홈·2주 업무지도 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확정된 흰색·연한 적색/주황 리퀴드 글래스 홈에서 자연어 입력, 2주 업무 일정, 업무 상세, 확인 전 일정 후보를 하나의 시연 흐름으로 연결한다.

**Architecture:** 기존 `product-ui` SPA와 엔진 API/fixture 경계를 유지한다. 날짜 계산과 일정 후보 판정은 새 순수 모듈 `home-model.js`로 분리하고, `app.js`는 상태 변경·렌더링·라우팅만 담당한다. 기존 forecast 업무를 `workId`로 달력과 워크벤치에 연결하며, 사용자가 입력한 명시 날짜 메모는 확인 전 후보로 저장한 뒤 확인해야 달력에 반영한다.

**Tech Stack:** 정적 HTML/CSS/Vanilla JavaScript, Node.js `assert`, Playwright, 기존 `JikmuApi` fixture/live 어댑터

## Global Constraints

- 홈 문구는 `지금 어떤 생각을 하시나요?`로 고정하고 별도 날짜·환영 문구를 두지 않는다.
- 사용자가 입력하지 않은 확정 날짜나 업무 근거를 만들지 않는다.
- AI가 해석한 날짜는 `후보`로 표시하고 사용자의 확인 전에는 확정 일정처럼 표현하지 않는다.
- 달력 이벤트는 기존 업무의 `workId`를 그대로 사용해 `#workbench/<workId>`로 이동한다.
- 엔진의 문서·OKF·근거 응답은 변경하지 않고, 브라우저 상태는 개인 진행 기록만 보관한다.
- 홈은 흰색을 중심으로 하고 적색/주황은 배경 광원과 주요 행동에만 사용한다. 확인된 개인 메모에는 녹색을 사용한다.
- 390px 화면에서 문서 전체의 가로 스크롤이 생기지 않아야 한다. 2주 표 자체는 내부 스크롤 영역을 사용할 수 있다.
- 기존 fixture/live/auto 모드와 워크벤치·초안·점검 흐름을 보존한다.

---

## Task 1: 2주 일정과 날짜 후보를 순수 모델로 분리

**Files:**
- Create: `product-ui/home-model.js`
- Create: `product-ui/tests/verify-home-model.js`
- Modify: `product-ui/index.html`
- Modify: `product-ui/sync-manifest.json`
- Modify: `package.json`

- [ ] `verify-home-model.js`에 다음 실패 테스트를 먼저 작성한다.
  - 기준일 `2026-01-02`의 2주 구간이 일요일 시작 14일로 생성된다.
  - forecast 업무의 `due`가 구간 안에 있으면 `deadline` 이벤트가 생성된다.
  - `2026-01-05`부터 `2026-01-09`까지의 업무는 다일 `work` 이벤트로 생성된다.
  - `업체 서류는 1월 8일까지 받기로 함`에서 `2026-01-08` 후보를 얻는다.
  - `다음 주까지 준비`는 정확한 날짜를 확정하지 않고 범위 후보로 남긴다.
  - 날짜가 없는 메모는 달력 이벤트가 되지 않는다.
- [ ] `node product-ui/tests/verify-home-model.js`를 실행해 모듈 부재로 실패하는지 확인한다.
- [ ] `home-model.js`를 UMD/CommonJS 형태로 구현한다.
  - `buildTwoWeekWindow(simISO, offsetWeeks)` → `{startISO,endISO,days,weeks}`
  - `parseScheduleCandidate(text, simISO)` → 명시 일자 후보 또는 다음 주 범위 후보/`null`
  - `buildCalendarEvents(works, window)` → `work`, `deadline`, `memo`, `candidate` 이벤트
  - 로컬 시간대 파싱 대신 `YYYY-MM-DD` 문자열과 UTC 정오를 사용해 날짜 밀림을 막는다.
- [ ] `index.html`에서 `home-model.js`를 `app.js`보다 먼저 불러온다.
- [ ] `sync-manifest.json`에 `home-model.js`를 추가한다.
- [ ] `package.json`에 `test:product-ui:home-model` 스크립트를 추가하고 `test:product-ui` 체인에 포함한다.
- [ ] `node product-ui/tests/verify-home-model.js`가 통과하는지 확인한다.

## Task 2: 기존 업무 상태에 달력·후보 필드를 안전하게 추가

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-app-data-mode.js`
- Create: `product-ui/tests/verify-home-state.js`
- Modify: `package.json`

- [ ] `verify-home-state.js`에 다음 실패 테스트를 작성한다.
  - 기존 v1 localStorage 업무는 새 선택 필드 없이도 유효하다.
  - forecast 업무는 `due`와 원본 문서 ID를 유지한다.
  - 일정 후보는 `{kind,label,startISO,endISO,confirmed:false}`로 저장된다.
  - 후보 확인은 `confirmed:true`와 실행 기록을 남기며, 되돌리기로 이전 상태를 복구한다.
- [ ] `app.js`의 업무 정규화 함수에서 선택 필드를 허용한다.
  - `calendarStart`
  - `calendarCategory`
  - `scheduleCandidates`
  - 기록의 `dateISO`, `calendarStatus`
- [ ] forecast seed는 `due`를 그대로 쓰고 별도 시작일을 추측하지 않는다.
- [ ] 정확한 날짜가 포함된 자연어 메모는 `home-model.js`로 후보를 만들고, 업무와 연결될 때만 해당 업무에 저장한다.
- [ ] `confirmScheduleCandidate(workId, candidateId)`와 undo 동작을 구현한다.
- [ ] `package.json`에 `test:product-ui:home-state`를 추가한다.
- [ ] `node product-ui/tests/verify-home-state.js`와 기존 `node product-ui/tests/verify-app-data-mode.js`가 통과하는지 확인한다.

## Task 3: 확정 디자인으로 홈 화면 교체

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/style.css`
- Modify: `product-ui/tests/verify-source-contract.js`
- Create: `product-ui/tests/verify-home-browser.js`
- Modify: `package.json`

- [ ] Playwright 기반 `verify-home-browser.js`에 다음 실패 검증을 작성한다.
  - 홈에서 별도 날짜와 기존 타이핑 환영 문구가 보이지 않는다.
  - 입력창 placeholder가 `지금 어떤 생각을 하시나요?`다.
  - 14개 날짜 셀과 `내 업무 일정` 제목이 렌더링된다.
  - forecast 마감 이벤트가 보이고 클릭하면 같은 `workId`의 워크벤치로 이동한다.
  - 왼쪽 아이콘 레일과 이전/다음 2주 버튼이 키보드로 조작 가능하다.
  - 390px에서 문서 전체 가로 overflow가 없다.
- [ ] `vHome()`을 다음 구조로 교체한다.
  - 홈 전용 슬림 아이콘 레일
  - 넓은 입력 카드와 첨부/전송 버튼
  - 입력 처리 결과를 보여주는 한 줄 확인·되돌리기 영역
  - 일요일부터 토요일까지 7열 × 2행 업무 달력
  - 공사·용역 다일 바, 마감 chip, 확인된 메모, 후보 chip
- [ ] 홈 라우트에서만 `body.is-home`과 `main.home-main`을 적용하고 기존 상단 헤더·푸터를 숨긴다.
- [ ] 워크벤치·목록·월간 달력 라우트에서는 기존 헤더·푸터를 유지한다.
- [ ] 이벤트의 버튼/링크에 `aria-label`, 현재 날짜에 `aria-current="date"`, 후보에 상태 텍스트를 제공한다.
- [ ] `style.css`에 홈 전용 시각 토큰과 레이아웃을 추가한다.
  - 거의 흰색 배경
  - 아주 연한 적색/주황 radial glow
  - 흰색 반투명 패널, 얇은 흰 테두리, 부드러운 그림자
  - 빨간 전송 버튼과 마감 포인트
  - 녹색 확인 메모
  - 내부 달력 스크롤과 모바일 레일 재배치
  - 버튼 `:active` 피드백과 `prefers-reduced-motion` 준수
- [ ] `verify-source-contract.js`의 과거 830px·타이핑 환영 문구 고정을 새 홈 계약으로 교체한다.
- [ ] `node product-ui/tests/verify-home-browser.js`와 `node product-ui/tests/verify-source-contract.js`가 통과하는지 확인한다.

## Task 4: 홈 입력에서 메모→일정 후보→확인 흐름 연결

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-showcase-e2e.js`
- Modify: `product-ui/tests/verify-app-data-mode-browser.js`

- [ ] E2E에 다음 실패 시나리오를 추가한다.
  1. 홈에서 펌프 업무 마감 이벤트를 클릭한다.
  2. 워크벤치에서 `업체 서류는 1월 8일까지 받기로 함`을 입력한다.
  3. 홈으로 돌아오면 `일정 후보`가 보인다.
  4. 확인 버튼을 누르면 녹색 개인 메모 일정으로 바뀐다.
  5. 되돌리기를 누르면 후보 상태로 복구된다.
- [ ] 홈 입력은 기존 `Intent` 분류와 `/api/ask` 응답을 그대로 사용한다.
- [ ] 질문은 홈 결과 영역에 근거 답변을 표시한다.
- [ ] 새 업무 지시는 업무를 만들되, 날짜 해석이 범위 후보이면 홈에 머물러 확인 문구와 후보를 보여준다.
- [ ] 기존 업무 메모는 업무를 선택/연결한 후 저장하고, 명시 날짜가 있으면 일정 후보도 함께 만든다.
- [ ] 비동기 질문 응답의 최신 요청 우선·페이지 이탈 보호 로직을 보존한다.
- [ ] 기존 `verify-app-data-mode-browser.js`와 변경한 `verify-showcase-e2e.js`를 실행한다.

## Task 5: 실제 유지보수 데이터와 네 가지 업무 요소를 시연 경로에서 검증

**Files:**
- Modify: `product-ui/app.js`
- Modify: `product-ui/tests/verify-local-maintenance-demo.js`
- Modify: `product-ui/tests/verify-showcase-e2e.js`

- [ ] 워크벤치 상단에 다음 네 가지 요소를 간결한 요약으로 노출하는 실패 검증을 작성한다.
  - 언제 해야 하는가
  - 무엇을 참고해야 하는가
  - 어떤 기준을 지켜야 하는가
  - 무엇을 만들어야 하는가
- [ ] 기존 forecast `due`, 연결 문서, briefing/OKF 근거, draft 산출물을 각 요소에 매핑한다.
- [ ] 값이 없으면 추측하지 않고 `확인 필요` 또는 `연결된 자료 없음`으로 표시한다.
- [ ] 로컬 유지보수 질문 `올해 정기점검보수 기본계획을 어떻게 수립해야 해?`의 기존 근거 답변과 문서 drawer가 그대로 동작하는지 확인한다.
- [ ] `node product-ui/tests/verify-local-maintenance-demo.js`가 통과하는지 확인한다.

## Task 6: 회귀 검증과 시각 확인

**Files:**
- Modify if needed: `product-ui/style.css`
- Modify if needed: `product-ui/app.js`
- Generated verification artifact: `product-ui/screenshots/home-two-week-context.png`

- [ ] `npm run test:product-ui`를 실행한다.
- [ ] `node --check product-ui/home-model.js`와 `node --check product-ui/app.js`를 실행한다.
- [ ] `git diff --check`를 실행한다.
- [ ] fixture 모드로 홈을 1920×1080과 390×844에서 캡처한다.
- [ ] 캡처에서 한글 글꼴, 14일 구조, 홈 배경 강도, 적색/주황 포인트, 업무 이벤트 가독성, 내부/전체 overflow를 확인한다.
- [ ] 실제 엔진이 없어도 fixture 시연이 가능하고, live/auto 모드 표시는 사실대로 유지되는지 확인한다.
- [ ] 변경 파일만 커밋하고 커밋 메시지를 `feat: ON_메모리 2주 업무 홈 통합`으로 남긴다.

