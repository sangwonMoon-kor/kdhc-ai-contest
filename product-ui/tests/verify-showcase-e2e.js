"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const local = !process.env.PRODUCT_UI_URL;
const localOrigin = "http://127.0.0.1:8410";
const target = new URL(process.env.PRODUCT_UI_URL || `${localOrigin}/?data=fixture`);
const mode = target.searchParams.get("data") || "auto";
const browserCandidates = [
  process.env.BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

if (!new Set(["http:", "https:"]).has(target.protocol) || !target.hostname || target.username || target.password) {
  throw new Error("PRODUCT_UI_URL must be an absolute http(s) URL without credentials");
}
if (!new Set(["fixture", "live", "auto"]).has(mode)) throw new Error(`Unsupported data mode: ${mode}`);
if (local && (target.origin !== localOrigin || target.protocol !== "http:")) {
  throw new Error(`Local showcase E2E must own ${localOrigin}; set PRODUCT_UI_URL for another server`);
}
target.hash = "#home";

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => server.kill("SIGKILL"), 1000);
    server.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["tools/serve-product-ui.js"], {
      cwd: repoRoot,
      env: { ...process.env, PRODUCT_UI_PORT: "8410" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const expected = `product-ui ${localOrigin}`;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`product UI server did not claim port 8410\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopServer(server).finally(() => reject(error));
    }
    server.on("error", fail);
    server.on("exit", (code, signal) => fail(new Error(`product UI server exited before ready (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`)));
    server.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (settled || !stdout.includes(expected)) return;
      settled = true;
      clearTimeout(timeout);
      resolve(server);
    });
    server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  });
}

async function verifyCurrentWorktree() {
  const response = await fetch(new URL("/index.html", target));
  assert.equal(response.ok, true, "product UI server did not serve index.html");
  const html = await response.text();
  assert(html.includes('id="dataStatus"') && html.includes('src="api-client.js"') && html.includes('src="app.js"'), "server did not serve the current product UI worktree");
}

function observePage(page, name, errors, apiRequests) {
  page.on("console", (message) => {
    const locationUrl = message.location().url;
    if (message.type() === "error") errors.push(`${name} console: ${message.text()} (${locationUrl})`);
  });
  page.on("pageerror", (error) => errors.push(`${name} pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${name} HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("dialog", (dialog) => dialog.accept());
  if (mode === "fixture") {
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (/^\/api(?:\/|$)/.test(requestUrl.pathname)) apiRequests.push(requestUrl.href);
    });
  }
}

function workIdFromHash(page, route) {
  const match = new URL(page.url()).hash.match(new RegExp(`^#${route}/([^/?#]+)$`));
  if (!match) throw new Error(`expected #${route}/<workId>, received ${new URL(page.url()).hash}`);
  return decodeURIComponent(match[1]);
}

function assertRouteWorkId(page, route, workId) {
  const actual = workIdFromHash(page, route);
  assert.equal(actual, workId, `${route} route changed work identity`);
}

async function assertDataStatus(page) {
  const status = (await page.textContent("#dataStatus")).trim();
  if (mode === "fixture") assert.equal(status, "시연용 샘플 데이터");
  else if (mode === "live") assert.equal(status, "실제 엔진 연결");
  else assert(["시연용 샘플 데이터", "실제 엔진 연결"].includes(status), `auto data status was not truthful: ${status}`);
  return status;
}

async function waitForStableUi(page) {
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  const toast = page.locator("#toast");
  if (!(await toast.getAttribute("hidden"))) {
    await page.locator("#tClose").click();
    await toast.waitFor({ state: "hidden" });
  }
  await page.waitForFunction(() => document.fonts.status === "loaded" && document.querySelector("#toast")?.hidden);
  await wait(50);
}

async function run() {
  let server;
  let browser;
  try {
    if (local) server = await startServer();
    await verifyCurrentWorktree();
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const errors = [];
    const apiRequests = [];
    const missingWork = {
      id: "w-showcase-missing-data",
      title: "임의 제목은 산출물이 아님",
      instruction: "누락값 표시 검증",
      requester: "검증",
      due: null,
      dueText: "임의 기한 메모",
      stageId: "unlinked-stage",
      stageName: "",
      doneWhen: "",
      repeat: false,
      todos: [],
      records: [],
      sources: [],
      draft: { savedAt: null, values: null }
    };
    const savedDraftWork = {
      id: "w-showcase-saved-draft",
      title: "기존 결과물 제목",
      instruction: "저장된 초안 표시 검증",
      requester: "검증",
      due: null,
      stageId: null,
      stageName: "",
      doneWhen: "결재 상신",
      repeat: false,
      todos: [],
      records: [],
      sources: [],
      draft: { savedAt: 1767225600000, freeText: "저장된 현장 확인 기안" }
    };
    const desktop = await browser.newContext({
      viewport: { width: 1920, height: 1080 }, colorScheme: "light", reducedMotion: "reduce", locale: "ko-KR", timezoneId: "Asia/Seoul"
    });
    const page = await desktop.newPage();
    observePage(page, "desktop", errors, apiRequests);

    await page.goto(target.href, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("jikmu.workbench.v1");
      localStorage.removeItem("jikmu.ui.v1");
    });
    await page.addInitScript((works) => {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify({ v: 1, works, selectedWorkId: works[0].id }));
    }, [missingWork, savedDraftWork]);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="home-omni"]');

    for (let index = 0; index < 7; index += 1) {
      await page.click("#homeCalNext");
    }
    const pumpDeadline = page.locator('[data-calendar-kind="deadline"]').filter({ hasText: "순환수 펌프" });
    await pumpDeadline.click();
    await page.waitForFunction(() => location.hash.startsWith("#workbench/"));
    await page.waitForSelector('[data-testid="workbench"]');
    const workId = workIdFromHash(page, "workbench");
    if (!(await page.textContent("main")).includes("순환수 펌프")) throw new Error("pump deadline did not open its workbench");

    const seededWork = await page.evaluate((id) => {
      const state = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return state.works.find((work) => work.id === id);
    }, workId);
    assert.deepEqual({
      due: seededWork.due,
      sources: seededWork.sources.map((source) => source.docId),
      doneWhen: seededWork.doneWhen,
      draft: seededWork.draft
    }, {
      due: "2026-04-09",
      sources: ["APPR-2024-0408", "APPR-2025-0409"],
      doneWhen: "결재 상신",
      draft: { savedAt: null, values: null }
    }, "pump showcase seed values changed");

    const showcase = page.locator('[data-testid="workbench-showcase"]');
    await showcase.waitFor();
    const showcaseText = (await showcase.innerText()).trim();
    for (const label of ["언제 해야 하는가", "무엇을 참고해야 하는가", "어떤 기준을 지켜야 하는가", "무엇을 만들어야 하는가"]) {
      assert(showcaseText.includes(label), `workbench showcase missed: ${label}`);
    }
    assert(showcaseText.includes("2026.04.09"), "workbench showcase did not use the forecast due date");
    for (const documentId of ["APPR-2024-0408", "APPR-2025-0409"]) {
      assert(showcaseText.includes(documentId), `workbench showcase missed linked document: ${documentId}`);
    }
    assert(showcaseText.includes("설계·내역 작성"), "workbench showcase missed the selected briefing stage criterion");
    assert(showcaseText.includes("완료 조건 결재 상신"), "workbench showcase did not truthfully use the completion condition");
    assert.equal(showcaseText.includes("2026년 순환수 펌프 정비공사 추진 보고(안)"), false, "workbench showcase synthesized a deliverable from an empty draft");
    assert(showcaseText.includes("결재 상신"), "workbench showcase missed the done-when condition");
    assert.equal(await showcase.locator('[data-ev="okf:design-and-costing"]').count(), 1, "workbench showcase missed its selected-stage OKF evidence control");
    const legacyOutput = page.locator(".wb-output");
    assert((await legacyOutput.innerText()).includes("산출물 2026년 순환수 펌프 정비공사 추진 보고(안)"), "legacy workbench output no longer uses its original title-based display");

    await showcase.locator('[data-ev="APPR-2024-0408"]').click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    assert((await page.locator("#drawerBody").innerText()).includes("2024년 순환수 펌프 정비공사 추진 보고"), "summary document evidence drawer showed unexpected detail");
    await page.click("#drawerClose");

    await showcase.locator('[data-ev="okf:design-and-costing"]').click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    assert((await page.locator("#drawerBody").innerText()).includes("설계·내역 작성"), "summary criterion evidence drawer showed unexpected detail");
    await page.click("#drawerClose");

    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, missingWork.id);
    await page.waitForSelector('[data-testid="workbench-showcase"]');
    const missingShowcase = page.locator('[data-testid="workbench-showcase"]');
    assert((await missingShowcase.locator('[data-showcase="due"]').innerText()).includes("확인 필요"), "missing due used an arbitrary dueText value");
    assert((await missingShowcase.locator('[data-showcase="sources"]').innerText()).includes("연결된 자료 없음"), "missing sources were synthesized");
    assert((await missingShowcase.locator('[data-showcase="criterion"]').innerText()).includes("확인 필요"), "unlinked stage used global criteria");
    assert((await missingShowcase.locator('[data-showcase="output"]').innerText()).includes("확인 필요"), "empty draft or title synthesized an output");

    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, savedDraftWork.id);
    await page.waitForSelector('[data-testid="workbench-showcase"]');
    const savedDraftShowcase = page.locator('[data-testid="workbench-showcase"] [data-showcase="output"]');
    assert((await savedDraftShowcase.innerText()).includes("저장 초안 저장된 현장 확인 기안"), "saved non-empty draft value was not shown truthfully in the showcase");
    assert.equal((await savedDraftShowcase.innerText()).includes("완료 조건 결재 상신"), false, "saved draft incorrectly fell back to the completion condition");

    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, workId);
    await page.waitForSelector('[data-testid="workbench"]');

    await page.fill("#wbIn", "업체 서류는 1월 8일까지 받기로 함");
    await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("업체 서류는 1월 8일까지 받기로 함"));
    assertRouteWorkId(page, "workbench", workId);

    await page.evaluate(() => { location.hash = "#home"; });
    await page.waitForSelector('[data-testid="home-omni"]');
    for (let index = 0; index < 7; index += 1) {
      await page.click("#homeCalPrev");
    }
    const datedCandidate = page.locator('[data-calendar-kind="candidate"]').filter({ hasText: "업체 서류는 1월 8일까지 받기로 함" });
    await datedCandidate.waitFor();
    assert.equal(await datedCandidate.getAttribute("data-event-start"), "2026-01-08", "explicit memo date did not create its schedule candidate");
    assert.equal(await datedCandidate.getAttribute("data-event-end"), "2026-01-08", "explicit memo candidate changed its single day");
    await datedCandidate.click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('[data-calendar-kind="candidate"]')).some((item) => item.textContent.includes("업체 서류는 1월 8일까지 받기로 함")));
    const confirmedMemo = page.locator('[data-calendar-kind="memo"]').filter({ hasText: "업체 서류는 1월 8일까지 받기로 함" });
    await confirmedMemo.waitFor();
    assert((await page.locator("#homeFeedback").innerText()).includes("일정을 확정했습니다."), "candidate confirmation did not show Korean inline feedback");
    await page.click("#homeUndo");
    await datedCandidate.waitFor();

    await page.fill("#omniIn", "팀장님이 다음 주까지 계약 보증서 현황 올리래");
    await page.locator('[data-testid="home-omni"]').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("#homeFeedback")?.textContent.includes("날짜 범위를 확인"));
    assert.equal(new URL(page.url()).hash, "#home", "new range instruction left home");
    const rangeCandidate = page.locator('[data-calendar-kind="candidate"]').filter({ hasText: "팀장님이 다음 주까지 계약 보증서 현황 올리래" });
    await rangeCandidate.waitFor();
    assert.equal(await rangeCandidate.getAttribute("data-event-start"), "2026-01-04", "range candidate start changed");
    assert.equal(await rangeCandidate.getAttribute("data-event-end"), "2026-01-10", "range candidate end changed");

    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, workId);
    await page.waitForSelector('[data-testid="workbench"]');
    await page.fill("#wbIn", "운영부 일정은 5월 둘째 주로 확정");
    await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("운영부 일정은 5월 둘째 주로 확정"));
    assertRouteWorkId(page, "workbench", workId);

    await page.fill("#wbIn", "작년 펌프 정비 추진 보고 찾아줘");
    await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
    await page.waitForSelector('[data-testid="grounded-answer"] .badge.grounded');
    assertRouteWorkId(page, "workbench", workId);
    if (!(await page.textContent("#wbResult")).includes("관련 문서")) throw new Error("grounded documents missing");
    const evidence = page.locator("#wbResult [data-ev]").first();
    assert.equal(await evidence.getAttribute("data-ev"), "okf:case-01-circulation-pump-estimate-audit", "first pump-answer evidence changed");
    await evidence.click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    const drawerText = (await page.textContent("#drawerBody")).trim();
    assert(drawerText, "evidence drawer detail was empty");
    assert(drawerText.includes("순환수 펌프 정비공사 설계내역 및 감사 대응 사례"), "pump evidence drawer showed unexpected fixture detail");
    await page.click("#drawerClose");

    await page.click("#goDraft");
    await page.waitForFunction(() => location.hash.startsWith("#draft/"));
    assertRouteWorkId(page, "draft", workId);
    const draft = page.locator('[data-testid="draft-document"]');
    await draft.waitFor();
    const activeStatus = await assertDataStatus(page);
    if (activeStatus === "실제 엔진 연결") {
      const draftText = (await draft.innerText()).trim();
      assert(draftText.includes("2026년 순환수 펌프 정비공사 추진 보고(안)"), "live draft missed the current generated title");
      assert(draftText.includes("2025년 순환수 펌프 정비공사 추진 보고"), "live draft missed its current-basis title");
      assert.equal(await draft.locator("[data-ev]").first().getAttribute("data-ev"), "APPR-2025-0409", "live draft lacked its current-basis evidence control");
    }
    await page.click("#dCheck");
    const precheck = page.locator('[data-testid="precheck-results"]');
    await precheck.locator(".f-item").first().waitFor();
    const findings = precheck.locator(".f-item");
    const precheckText = (await precheck.innerText()).trim();
    assert(precheckText && !/불러오지 못했습니다|연결을 확인해 주세요|점검에 실패|엔진 연결 오류/.test(precheckText), `precheck rendered an error: ${precheckText}`);
    if (activeStatus === "시연용 샘플 데이터") {
      assert.equal(await findings.count(), 5, "precheck did not render all five risky fixture findings");
      assert(precheckText.includes("구두 지시") && precheckText.includes("산출근거"), "precheck missed required meaningful fixture risks");
      assert((await precheck.locator("[data-ev]").count()) > 0, "fixture precheck findings lacked evidence controls");
    } else {
      assert.equal(await findings.count(), 1, "live precheck did not render the current single leftover finding");
      assert(precheckText.includes("초안 미완성 항목 잔존"), "live precheck missed the expected leftover finding");
    }
    await waitForStableUi(page);

    fs.mkdirSync(path.resolve(__dirname, "..", "screenshots"), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, "..", "screenshots", "showcase-golden.png"), fullPage: true });

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 }, colorScheme: "light", reducedMotion: "reduce", locale: "ko-KR", timezoneId: "Asia/Seoul"
    });
    const mobile = await mobileContext.newPage();
    observePage(mobile, "mobile", errors, apiRequests);
    await mobile.goto(target.href, { waitUntil: "networkidle" });
    await mobile.waitForSelector('[data-testid="home-omni"]');
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("390px horizontal overflow");

    if (mode === "fixture") assert.deepEqual(apiRequests, [], `fixture mode requested API routes: ${apiRequests.join(" | ")}`);
    assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
    console.log(`Showcase E2E passed (active data: ${activeStatus}; fixture API requests: ${mode === "fixture" ? apiRequests.length : "n/a"})`);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
