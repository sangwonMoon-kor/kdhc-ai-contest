# ON_메모리 홈 캘린더 우선 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈에서 Google Calendar식 `다가오는 일정`을 자연어 입력보다 먼저 보여주고, 두 영역 사이의 시각적 간격과 오늘 이동 조작을 제공한다.

**Architecture:** 기존 `home-model.js`와 `workspace-model.js`의 14일 데이터·이벤트 선택 로직은 그대로 둔다. `app.js`는 홈 DOM 순서와 오늘 이동 이벤트만 바꾸고, `style.css`는 캘린더 툴바·날짜 셀·입력 카드 위계를 조정한다. 동작·반응형 계약은 기존 Playwright 홈 테스트와 정적 소스 계약에 추가한다.

**Tech Stack:** Vanilla JavaScript SPA, CSS, Node.js `assert`, Playwright 1.61.1

## Global Constraints

- 홈의 순서는 `다가오는 일정 → 36px 초점 전환 여백 → 빠른 자연어 입력 → 입력 결과·되돌리기`다.
- 모바일에서 캘린더와 입력 사이 간격은 `24px`다.
- 기존 `지금 어떤 생각을 하시나요?` 문구, 첨부, 전송, 피드백, 되돌리기 기능을 유지한다.
- 제목은 `다가오는 일정`이며 `내 업무 일정`은 홈에 남기지 않는다.
- 현재 14일 일정 모델, 업무·개인 일정·후보 의미, 이벤트 선택 경로를 유지한다.
- `오늘`, 이전 2주, 다음 2주 조작을 키보드로 사용할 수 있어야 한다.
- 새 캘린더 라이브러리나 외부 캘린더 동기화를 추가하지 않는다.
- 390px 화면에서 문서 전체의 가로 overflow가 없어야 한다.

---

## File Structure

- `product-ui/app.js`: 홈 DOM 순서, 캘린더 제목·접근성 이름, 오늘 버튼과 상태 초기화를 담당한다.
- `product-ui/style.css`: 홈 섹션 간격, 입력 카드 위계, Google Calendar식 툴바와 날짜 셀, 모바일 재배치를 담당한다.
- `product-ui/tests/verify-home-browser.js`: DOM 순서, 명칭, 날짜 이동, 섹션 간격, 모바일 overflow를 브라우저에서 검증한다.
- `product-ui/tests/verify-source-contract.js`: 새 구조와 문구가 정적 소스에 남아 있는지 검증한다.
- `product-ui/screenshots/home-two-week-context.png`: 최종 데스크톱 홈의 시각 회귀 기준이다.

### Task 1: 캘린더 우선 구조와 오늘 이동 동작

**Files:**
- Modify: `product-ui/tests/verify-home-browser.js:246-251, 304-319`
- Modify: `product-ui/tests/verify-source-contract.js:30-43`
- Modify: `product-ui/app.js:482-552`

**Interfaces:**
- Consumes: `window.JikmuHomeModel.buildTwoWeekWindow(simISO, offsetWeeks)`, `workspaceModel.selectHomeEvents(state, window)`
- Produces: `.home-capture-stack`, `#homeCalToday`, `#homeCalendarTitle`의 `다가오는 일정`, `aria-label="다가오는 2주 일정"`

- [ ] **Step 1: 브라우저 계약을 새 구조와 문구로 바꾼다**

`verify-home-browser.js`의 기존 제목 검증을 다음 코드로 교체한다.

```js
const homeHeading = page.getByRole("heading", { name: "다가오는 일정" });
assert.equal(await homeHeading.count(), 1, "upcoming schedule heading missing");
assert.equal(await page.getByRole("heading", { name: "내 업무 일정" }).count(), 0, "legacy owned-schedule heading remains");
assert.equal(await page.locator('.home-calendar-scroll[aria-label="다가오는 2주 일정"]').count(), 1, "calendar region lacks its new accessible name");
const homeOrder = await page.locator(".home-content").evaluate(function (container) {
  const calendar = container.querySelector(".home-calendar-panel");
  const capture = container.querySelector(".home-capture-stack");
  return Boolean(calendar && capture && (calendar.compareDocumentPosition(capture) & Node.DOCUMENT_POSITION_FOLLOWING));
});
assert.equal(homeOrder, true, "calendar does not precede the capture stack");
```

날짜 이동 검증을 다음 순서로 교체한다.

```js
const next = page.getByRole("button", { name: "다음 2주 보기" });
await next.focus();
await page.keyboard.press("Enter");
await page.waitForFunction(function () {
  const first = document.querySelector("[data-calendar-date]");
  return first && first.dataset.calendarDate === "2026-01-11";
});
const today = page.getByRole("button", { name: "오늘" });
await today.focus();
await page.keyboard.press("Enter");
await page.waitForFunction(function () {
  const first = document.querySelector("[data-calendar-date]");
  return first && first.dataset.calendarDate === "2025-12-28";
});
const previous = page.getByRole("button", { name: "이전 2주 보기" });
await previous.focus();
await page.keyboard.press("Enter");
await page.waitForFunction(function () {
  const first = document.querySelector("[data-calendar-date]");
  return first && first.dataset.calendarDate === "2025-12-14";
});
await today.focus();
await page.keyboard.press("Enter");
await page.waitForFunction(function () {
  const first = document.querySelector("[data-calendar-date]");
  return first && first.dataset.calendarDate === "2025-12-28";
});
```

- [ ] **Step 2: 정적 소스 계약을 추가한다**

`verify-source-contract.js`의 홈 계약 옆에 다음 검증을 추가한다.

```js
if (!app.includes('class="home-capture-stack"')) failures.push("home capture stack contract missing");
if (!app.includes('id="homeCalToday"')) failures.push("home today control missing");
if (!app.includes(">다가오는 일정</h1>")) failures.push("home upcoming schedule heading missing");
if (app.includes(">내 업무 일정</h1>")) failures.push("legacy home schedule heading remains");
const homeCalendarMarkup = app.indexOf('<section class="home-calendar-panel"');
const homeCaptureMarkup = app.indexOf('<div class="home-capture-stack"');
if (homeCalendarMarkup < 0 || homeCaptureMarkup < 0 || homeCalendarMarkup > homeCaptureMarkup) {
  failures.push("home calendar must be rendered before the capture stack");
}
```

- [ ] **Step 3: 테스트를 실행해 기존 구현이 실패하는지 확인한다**

Run:

```bash
npm run test:product-ui:source
npm run test:product-ui:home-browser
```

Expected:

```text
Product UI source contract failed:
- home capture stack contract missing
- home today control missing
- home upcoming schedule heading missing
- home calendar must be rendered before the capture stack

AssertionError [ERR_ASSERTION]: upcoming schedule heading missing
```

- [ ] **Step 4: `vHome()`의 구조와 오늘 이동을 구현한다**

`app.js`에서 `main.innerHTML`의 홈 본문을 다음 구조로 교체한다.

```js
main.innerHTML = `<div class="home-content">
    <section class="home-calendar-panel" aria-labelledby="homeCalendarTitle">
      <div class="home-calendar-toolbar">
        <h1 id="homeCalendarTitle">다가오는 일정</h1>
        <div class="home-calendar-tools">
          <button class="home-calendar-today" id="homeCalToday" type="button">오늘</button>
          <div class="home-calendar-range" aria-live="polite">${homeRangeLabel(calendarWindow)}</div>
          <div class="home-calendar-controls">
            <button id="homeCalPrev" type="button" aria-label="이전 2주 보기">${homeIcon("chevron-left")}</button>
            <button id="homeCalNext" type="button" aria-label="다음 2주 보기">${homeIcon("chevron-right")}</button>
          </div>
        </div>
        <a class="home-calendar-all" href="#schedule">전체 일정 ${homeIcon("chevron-right")}</a>
      </div>
      <div class="home-calendar-scroll" role="region" aria-label="다가오는 2주 일정" tabindex="0">
        <div class="home-calendar-inner">
          <div class="home-weekdays" aria-hidden="true">${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}</div>
          ${calendarWindow.weeks.map((week) => renderHomeCalendarWeek(week, events, sim)).join("")}
        </div>
      </div>
      <div class="home-calendar-legend" aria-label="일정 범례">
        <span><i class="legend-work"></i>공사·용역</span>
        <span><i class="legend-memo"></i>개인 일정·내 메모</span>
        <span><i class="legend-candidate"></i>확인 필요</span>
      </div>
    </section>
    <div class="home-capture-stack">
      <section class="home-compose" aria-label="생각 입력">
        <form class="omni" id="omni" data-testid="home-omni">
          <label class="sr-only" for="omniIn">생각 입력</label>
          <input id="omniIn" type="text" autocomplete="off" placeholder="지금 어떤 생각을 하시나요?" aria-label="생각 입력">
          <input id="homeAttachment" type="file" hidden>
          <button class="home-attach" id="homeAttachBtn" type="button" aria-label="파일 첨부">${homeIcon("attach")}</button>
          <button class="home-send" type="submit" aria-label="입력 보내기">${homeIcon("send")}<span>보내기</span></button>
        </form>
      </section>
      ${renderHomeFeedback()}
      <div id="homeResult"></div>
    </div>
</div>`;
```

기존 이전·다음 이벤트 연결 앞에 오늘 이동을 추가한다.

```js
$("#homeCalToday").onclick = () => { homeCalendarOffsetWeeks = 0; route(); };
$("#homeCalPrev").onclick = () => { homeCalendarOffsetWeeks -= 2; route(); };
$("#homeCalNext").onclick = () => { homeCalendarOffsetWeeks += 2; route(); };
```

- [ ] **Step 5: 집중 테스트를 실행해 통과하는지 확인한다**

Run:

```bash
npm run test:product-ui:source
npm run test:product-ui:home-browser
```

Expected:

```text
Product UI source contract passed
Home browser contract passed
```

- [ ] **Step 6: 구조와 동작을 커밋한다**

```bash
git add product-ui/app.js product-ui/tests/verify-home-browser.js product-ui/tests/verify-source-contract.js
git commit -m "feat: 홈에서 다가오는 일정을 먼저 표시"
```

### Task 2: 36px 위계와 Google Calendar식 시각 정돈

**Files:**
- Modify: `product-ui/tests/verify-home-browser.js:246-260, 323-330`
- Modify: `product-ui/app.js:660-666`
- Modify: `product-ui/style.css:152-235, 530-573`

**Interfaces:**
- Consumes: Task 1의 `.home-calendar-panel`, `.home-capture-stack`, `.home-calendar-tools`, `.home-calendar-today`
- Produces: 데스크톱 36px·모바일 24px 섹션 간격, 약 112px 입력 카드, 내부 스크롤 캘린더

- [ ] **Step 1: 데스크톱 시각 위계 실패 검증을 추가한다**

Task 1의 `homeOrder` 검증 다음에 아래 코드를 추가한다.

```js
const desktopHierarchy = await page.evaluate(function () {
  const calendar = document.querySelector(".home-calendar-panel").getBoundingClientRect();
  const capture = document.querySelector(".home-capture-stack").getBoundingClientRect();
  const compose = document.querySelector(".home-compose").getBoundingClientRect();
  return {
    sectionGap: Math.round(capture.top - calendar.bottom),
    composeHeight: Math.round(compose.height)
  };
});
assert(desktopHierarchy.sectionGap >= 34 && desktopHierarchy.sectionGap <= 38,
  `desktop section gap is not 36px: ${desktopHierarchy.sectionGap}`);
assert(desktopHierarchy.composeHeight >= 106 && desktopHierarchy.composeHeight <= 120,
  `desktop capture card is not visually secondary: ${desktopHierarchy.composeHeight}`);
assert.equal(await page.locator('[data-calendar-kind="personal"] .home-event-checkbox').count(), 1,
  "personal schedule lacks its to-do indicator");
```

모바일 overflow 검증 직전에 아래 코드를 추가한다.

```js
const mobileHierarchy = await page.evaluate(function () {
  const calendar = document.querySelector(".home-calendar-panel").getBoundingClientRect();
  const capture = document.querySelector(".home-capture-stack").getBoundingClientRect();
  const scroll = document.querySelector(".home-calendar-scroll");
  return {
    sectionGap: Math.round(capture.top - calendar.bottom),
    calendarScrollWidth: scroll.scrollWidth,
    calendarClientWidth: scroll.clientWidth
  };
});
assert(mobileHierarchy.sectionGap >= 22 && mobileHierarchy.sectionGap <= 26,
  `mobile section gap is not 24px: ${mobileHierarchy.sectionGap}`);
assert(mobileHierarchy.calendarScrollWidth > mobileHierarchy.calendarClientWidth,
  "mobile calendar no longer owns its horizontal overflow");
```

- [ ] **Step 2: 브라우저 테스트가 기존 스타일에서 실패하는지 확인한다**

Run:

```bash
npm run test:product-ui:home-browser
```

Expected:

```text
AssertionError [ERR_ASSERTION]: desktop section gap is not 36px: 18
```

- [ ] **Step 3: 개인 일정의 할 일 표시를 구현한다**

`app.js`의 `renderHomeEvent()`에서 아이콘 선택을 다음처럼 바꾼다.

```js
const icon = event2.kind === "personal"
  ? '<span class="home-event-checkbox" aria-hidden="true"></span>'
  : event2.kind === "memo"
    ? '<span class="home-event-symbol" aria-hidden="true">▤</span>'
    : '<span class="home-event-dot" aria-hidden="true"></span>';
```

`style.css`의 홈 이벤트 표시 규칙에 체크박스 형태를 추가한다.

```css
.home-event-checkbox{width:11px;height:11px;border:1.5px solid currentColor;border-radius:3px;flex:none}
```

- [ ] **Step 4: 홈 전용 데스크톱 스타일을 구현한다**

`style.css`의 홈 본문·입력·툴바 규칙을 다음 값으로 조정한다.

```css
.home-content{position:relative;min-width:0;display:flex;flex-direction:column;gap:36px;padding:0}
.home-capture-stack{min-width:0;display:flex;flex-direction:column;gap:12px}
.home-compose{border-radius:34px;min-height:112px;padding:18px 26px}
.home-compose .omni{height:100%;min-height:74px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:1fr auto;
  align-items:center;column-gap:16px;margin:0}
.home-compose .omni input[type="text"]{grid-column:1 / 3;grid-row:1;width:100%;min-width:0;border:0;background:transparent;
  color:var(--home-ink);font:inherit;font-size:1.12rem;letter-spacing:-.025em;padding:4px 10px;box-shadow:none}
.home-send svg{width:56px;height:56px;padding:15px;border-radius:50%;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;
  stroke-linejoin:round;background:linear-gradient(150deg,#ff252e 12%,var(--home-red) 54%,#c9000b 100%);
  box-shadow:0 8px 16px rgba(236,7,20,.18),inset 0 0 0 4px rgba(255,255,255,.34)}
.home-calendar-toolbar{display:grid;grid-template-columns:minmax(175px,1fr) auto minmax(120px,1fr);align-items:center;gap:16px;padding:0 18px 17px}
.home-calendar-tools{display:flex;align-items:center;gap:10px}
.home-calendar-today{min-height:38px;padding:0 14px;border:1px solid var(--home-line);border-radius:10px;background:rgba(255,255,255,.76);
  color:#2e333c;font-weight:700;transition:transform 140ms cubic-bezier(.23,1,.32,1),border-color 160ms ease,background-color 160ms ease}
.home-calendar-controls{display:flex;gap:8px}
.home-calendar-day{z-index:0;border-right:1px solid var(--home-line);padding:10px 0 0 10px;text-align:left;min-width:0}
```

활성·hover 대상에 오늘 버튼을 포함한다.

```css
.home-rail a:active,.home-attach:active,.home-send:active,.home-feedback button:active,.home-calendar-today:active,
.home-calendar-controls button:active,.home-calendar-all:active,.home-calendar-event:active{transform:scale(.97)}

@media (hover:hover) and (pointer:fine){
  .home-calendar-today:hover,.home-calendar-controls button:hover{border-color:rgba(242,13,24,.24);background:#fff}
}
```

- [ ] **Step 5: 태블릿·모바일 재배치 스타일을 구현한다**

`@media (max-width:1000px)` 홈 규칙을 다음처럼 조정한다.

```css
.home-content{padding:30px 0 0;gap:24px}
.home-calendar-toolbar{grid-template-columns:1fr auto}
.home-calendar-tools{grid-column:1 / -1;grid-row:2;justify-content:flex-end}
.home-calendar-all{grid-column:2;grid-row:1}
```

`@media (max-width:640px)` 홈 규칙을 다음처럼 조정한다.

```css
.home-compose{border-radius:28px;min-height:110px;padding:14px 16px}
.home-compose .omni{min-height:80px;grid-template-columns:auto minmax(0,1fr) auto;column-gap:8px}
.home-calendar-toolbar{grid-template-columns:1fr;gap:10px;padding:0 4px 14px}
.home-calendar-toolbar h1{font-size:1.16rem}
.home-calendar-tools{grid-column:1;grid-row:2;display:grid;grid-template-columns:auto minmax(0,1fr) auto;width:100%;gap:8px}
.home-calendar-range{grid-column:2;text-align:center;font-size:.78rem}
.home-calendar-controls{grid-column:3}
.home-calendar-all{display:none}
.home-calendar-today{min-height:36px;padding:0 11px}
```

- [ ] **Step 6: 집중 테스트를 실행해 통과하는지 확인한다**

Run:

```bash
npm run test:product-ui:home-browser
npm run test:product-ui:shell-browser
```

Expected:

```text
Home browser contract passed
Product shell browser contract passed
```

- [ ] **Step 7: 시각 위계 변경을 커밋한다**

```bash
git add product-ui/app.js product-ui/style.css product-ui/tests/verify-home-browser.js
git commit -m "style: 홈 캘린더와 입력 위계를 정돈"
```

### Task 3: 시각 캡처와 전체 회귀 검증

**Files:**
- Modify: `product-ui/screenshots/home-two-week-context.png`
- Verify: `product-ui/app.js`
- Verify: `product-ui/style.css`
- Verify: `product-ui/tests/verify-home-browser.js`

**Interfaces:**
- Consumes: Task 1·2에서 완성한 fixture 홈
- Produces: 1920×1080 데스크톱 시각 기준과 전체 제품 UI 회귀 결과

- [ ] **Step 1: 홈 캡처를 갱신한다**

Run:

```bash
npm run capture:product-ui:home
```

Expected: 명령이 종료 코드 `0`으로 끝난다. 첫 줄은 아래와 같고, 둘째 줄은 운영체제 임시 폴더의 `kdhc-home-two-week-mobile.png`와 `(390/390)`을 출력한다.

```text
Captured desktop home: product-ui/screenshots/home-two-week-context.png (1920/1920)
```

- [ ] **Step 2: 데스크톱 캡처를 육안 검토한다**

`product-ui/screenshots/home-two-week-context.png`를 열고 다음을 확인한다.

```text
1. 다가오는 일정이 입력 카드보다 위에 있다.
2. 두 카드 사이의 36px 간격이 정보 구분으로 보이고 과도한 단절로 보이지 않는다.
3. 오늘·날짜 범위·이전·다음·전체 일정의 시각 순서가 자연스럽다.
4. 업무 기간 막대와 개인 일정·확인 필요 상태가 셀 안에서 잘리지 않는다.
5. 입력 카드는 여전히 쉽게 찾을 수 있지만 달력보다 강하게 보이지 않는다.
```

- [ ] **Step 3: 문법·공백·집중 회귀 검증을 실행한다**

Run:

```bash
node --check product-ui/app.js
git diff --check
npm run test:product-ui:source
npm run test:product-ui:home-browser
npm run test:product-ui:schedule-browser
```

Expected:

```text
Product UI source contract passed
Home browser contract passed
Schedule browser contract passed
```

- [ ] **Step 4: 전체 제품 UI 회귀 검증을 실행한다**

로컬 유지보수 fixture가 없는 경우 보안 변환본으로 생성한 기존 ignored fixture를 복원한 뒤 실행한다.

Run:

```bash
if [ ! -f product-ui/fixtures/local-maintenance/manifest.json ]; then
  cp -R /private/tmp/on-memory-local-maintenance-fixture product-ui/fixtures/local-maintenance
fi
test -f product-ui/fixtures/local-maintenance/ask/maintenance-plan.json
test -f product-ui/fixtures/local-maintenance/documents/PROC-MAINT-31100.json
npm run test:product-ui
```

Expected:

```text
Brand name contract passed
Product UI source contract passed
Home browser contract passed
Schedule browser contract passed
Showcase E2E passed
```

- [ ] **Step 5: 시각 기준을 커밋한다**

```bash
git add product-ui/screenshots/home-two-week-context.png
git commit -m "test: 캘린더 우선 홈 캡처 갱신"
```

- [ ] **Step 6: 최종 상태를 확인한다**

Run:

```bash
git status --short --branch
git log -4 --pretty=%s
```

Expected:

```text
## feature/on-memory-workbench
test: 캘린더 우선 홈 캡처 갱신
style: 홈 캘린더와 입력 위계를 정돈
feat: 홈에서 다가오는 일정을 먼저 표시
docs: 홈 캘린더 우선 배치 구현 계획
```
