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

async function assertToneCandidateRequiresExplicitApply(page) {
  const input = page.locator("[data-ph]").first();
  const previousText = await input.inputValue();
  const originalText = "사용자가 입력한 금액 근거";
  await input.fill(originalText);
  await page.getByRole("button", { name: "공기업 문체 교정안 요청", exact: true }).click();
  const boundary = page.locator(".tone-candidate-boundary");
  await boundary.waitFor();
  const boundaryText = await boundary.innerText();
  assert(boundaryText.includes("문체 교정 연결 준비됨"), "tone request did not open the honest status boundary");
  assert(boundaryText.includes("현재 초안은 변경되지 않았습니다."), "tone boundary claimed or implied draft mutation");
  assert(boundaryText.includes("적용은 사용자가 선택합니다."), "tone boundary lost the explicit-apply contract");
  assert.equal(await input.inputValue(), originalText, "tone request mutated the draft before explicit apply");
  assert.equal(await page.getByRole("button", { name: "교정안 적용", exact: true }).count(), 0,
    "tone boundary exposed an apply action without an API candidate");
  await input.fill(previousText);
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
      output: {
        mode: "new",
        templateId: "TPL-COMPANY-BASIC",
        priorDocumentId: null,
        finalDocumentId: null
      },
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

    const dossier = page.locator(".workbench-dossier");
    await dossier.waitFor();
    assert.deepEqual(await dossier.locator("[data-workbench-section]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-workbench-section"))),
    ["headline", "progress", "official", "memory", "output", "completion"],
    "workbench dossier semantic order changed");
    const headlineSection = dossier.locator('[data-workbench-section="headline"]');
    const memorySection = dossier.locator('[data-workbench-section="memory"]');
    const outputSection = dossier.locator('[data-workbench-section="output"]');
    const completionSection = dossier.locator('[data-workbench-section="completion"]');
    assert((await headlineSection.innerText()).includes("2026.04.09"), "workbench headline did not use the forecast due date");
    for (const documentId of ["APPR-2024-0408", "APPR-2025-0409"]) {
      assert.equal(await memorySection.locator(`[data-doc-id="${documentId}"]`).count(), 1,
        `workbench memory missed linked document: ${documentId}`);
    }
    assert((await memorySection.innerText()).includes("분류 확인 필요"), "unclassified forecast sources lost their review status");
    assert((await outputSection.innerText()).includes("산출물 2026년 순환수 펌프 정비공사 추진 보고(안)"), "workbench output no longer uses its title-based display");
    assert((await outputSection.innerText()).includes("과거 구조를 활용한 초안"), "recurring work did not expose its output starting mode");
    for (const source of ["template", "prior", "official"]) {
      assert.equal(await outputSection.locator(`[data-output-source="${source}"]`).count(), 1,
        `recurring output missed ${source} provenance`);
    }
    assert.equal(await outputSection.getByRole("button", { name: "과거 문서 구조로 초안 열기", exact: true }).count(), 1,
      "recurring output lost its existing draft route");
    assert.equal((await outputSection.innerText()).includes("결재 상신"), false, "workbench output conflated completion criteria with the output");
    assert((await completionSection.innerText()).includes("결재 상신"), "workbench completion section missed the done-when condition");
    assert.equal(await headlineSection.locator('[data-ev="okf:design-and-costing"]').count(), 1, "workbench headline missed its selected-stage OKF evidence control");

    await memorySection.locator('[data-doc-id="APPR-2024-0408"] [data-ev="APPR-2024-0408"]').click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    assert((await page.locator("#drawerBody").innerText()).includes("2024년 순환수 펌프 정비공사 추진 보고"), "memory document evidence drawer showed unexpected detail");
    await page.click("#drawerClose");

    await headlineSection.locator('[data-ev="okf:design-and-costing"]').click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    assert((await page.locator("#drawerBody").innerText()).includes("설계·내역 작성"), "headline criterion evidence drawer showed unexpected detail");
    await page.click("#drawerClose");

    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, missingWork.id);
    await page.waitForSelector(".workbench-dossier");
    const missingDossier = page.locator(".workbench-dossier");
    assert((await missingDossier.locator('[data-workbench-section="headline"]').innerText()).includes("일정 미정"), "missing due used an arbitrary dueText value");
    assert((await missingDossier.locator('[data-workbench-section="official"]').innerText()).includes("연결된 공식 지침 없음"), "missing official references were synthesized");
    const missingMemoryText = await missingDossier.locator('[data-workbench-section="memory"]').innerText();
    assert(missingMemoryText.includes("처음 진행하는 업무") && missingMemoryText.includes("신규 초안"), "missing memory did not show the first-work empty state");
    assert((await missingDossier.locator('[data-workbench-section="progress"]').innerText()).includes("첫 메모"), "missing records did not show the first-note guidance");
    const missingOutput = missingDossier.locator('[data-workbench-section="output"]');
    const missingOutputText = await missingOutput.innerText();
    assert(missingOutputText.includes("공식 기준에서 시작하는 새 초안"), "new work did not expose its output starting mode");
    assert(missingOutputText.includes("처음 진행하는 업무"), "new output missed first-work rationale");
    assert(missingOutputText.includes("TPL-COMPANY-BASIC"), "new output missed its company template");
    assert(missingOutputText.includes("공식 지침") && missingOutputText.includes("0건"), "new output missed its official-source count");
    assert.equal(await missingOutput.getByRole("button", { name: "빈 초안 시작", exact: true }).count(), 1,
      "new output missed its blank draft path");
    await missingOutput.getByRole("button", { name: "빈 초안 시작", exact: true }).click();
    await page.waitForFunction((id) => location.hash === "#draft/" + id, missingWork.id);
    await page.locator("#freeDraft").waitFor();
    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, missingWork.id);
    await page.waitForSelector(".workbench-dossier");

    await page.evaluate((id) => { location.hash = "#workbench/" + encodeURIComponent(id); }, savedDraftWork.id);
    await page.waitForSelector(".workbench-dossier");
    const savedDraftOutput = page.locator('[data-workbench-section="output"]');
    const savedDraftOutputText = await savedDraftOutput.innerText();
    assert(savedDraftOutputText.includes("임시 저장") && savedDraftOutputText.includes("기안 이어서 쓰기"), "saved draft presence was not shown truthfully in the dossier");
    assert.equal(savedDraftOutputText.includes("저장된 현장 확인 기안"), false, "an arbitrary draft field was presented as the output identity");
    assert.equal(savedDraftOutputText.includes("결재 상신"), false, "saved draft incorrectly fell back to the completion condition");
    assert((await page.locator('[data-workbench-section="completion"]').innerText()).includes("결재 상신"), "saved draft completion condition left its dedicated section");

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
    await assertToneCandidateRequiresExplicitApply(page);
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
