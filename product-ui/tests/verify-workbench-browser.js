"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const workspaceModel = require("../workspace-model.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 10100 + (process.pid % 80);
const baseURL = `http://127.0.0.1:${port}`;
const expectedSections = ["headline", "progress", "official", "memory", "output", "completion"];

function fixtureState() {
  const state = workspaceModel.createDemoState();
  const work = state.works[0];
  work.stageId = "design-and-costing";
  work.stageName = "설계·내역 작성";
  work.output.templateId = "TPL-MAINTENANCE-REPORT";
  work.output.priorDocumentId = "APPR-2025-0409";
  work.todos = [{
    id: "todo-restricted-evidence",
    text: "제한 문서 확인",
    done: false,
    candidate: false,
    evidence: [{ docId: "RESTRICTED-2026", label: "제한 문서 할 일 근거" }]
  }];
  const newWork = state.works.find((item) => item.id === "work-maintenance-contract-2026");
  newWork.output.templateId = "TPL-COMPANY-BASIC";
  work.sources.push({
    docId: "RESTRICTED-2026",
    category: "official",
    title: "제한 감사 기준",
    issuer: "감사실",
    effectiveDate: "2026-01-15",
    version: "V1.0",
    role: "감사 적용 기준",
    access: "full",
    body: "권한 없는 문서의 비공개 본문"
  }, {
    docId: "LEGACY-NOTE-01",
    title: "이전 담당자 참고 자료",
    author: "이전 담당자",
    role: "인수인계 자료",
    access: "full"
  });
  return state;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["tools/serve-product-ui.js"], {
      cwd: repoRoot,
      env: Object.assign({}, process.env, { PRODUCT_UI_PORT: String(port) }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`server timeout\n${stdout}\n${stderr}`)), 5000);
    server.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (!stdout.includes(baseURL)) return;
      clearTimeout(timer);
      resolve(server);
    });
    server.stderr.on("data", (chunk) => { stderr += String(chunk); });
    server.on("error", reject);
  });
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => server.kill("SIGKILL"), 1000);
    server.once("exit", () => { clearTimeout(timer); resolve(); });
    server.kill("SIGTERM");
  });
}

async function launchBrowser() {
  const bundled = chromium.executablePath();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (fs.existsSync(bundled) ? bundled : undefined);
  return chromium.launch(Object.assign({ headless: true }, executablePath ? { executablePath } : {}));
}

async function assertSectionOrder(page) {
  const sectionLabels = await page.locator("[data-workbench-section]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-workbench-section")));
  assert.deepStrictEqual(sectionLabels, expectedSections);
}

async function assertNoOverflow(page, width) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert(dimensions.scrollWidth <= dimensions.clientWidth,
    `${width}px workbench overflows: ${dimensions.scrollWidth} > ${dimensions.clientWidth}`);
}

async function assertToneCandidateRequiresExplicitApply(page, originalText) {
  const input = page.locator("[data-ph]").first();
  await input.fill(originalText);
  const valuesBeforeRequest = await page.locator("[data-ph]").evaluateAll((fields) =>
    fields.map((field) => field.value));
  await page.getByRole("button", { name: "공기업 문체 교정안 요청", exact: true }).click();
  const boundary = page.locator(".tone-candidate-boundary");
  await boundary.waitFor();
  assert.equal(await boundary.getAttribute("role"), "status", "tone boundary is not announced as status");
  assert((await boundary.innerText()).includes("문체 교정 연결 준비됨"));
  assert((await boundary.innerText()).includes("현재 초안은 변경되지 않았습니다."));
  assert((await boundary.innerText()).includes("적용은 사용자가 선택합니다."));
  assert.deepStrictEqual(await page.locator("[data-ph]").evaluateAll((fields) =>
    fields.map((field) => field.value)), valuesBeforeRequest,
  "tone request mutated one or more draft fields before explicit apply");
  assert.equal(await page.getByRole("button", { name: "교정안 적용", exact: true }).count(), 0,
    "tone boundary exposed an apply action without an API candidate");
}

async function assertUntouchedDefaultFixture(browser) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()}`));
  await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-plan-2026`, { waitUntil: "networkidle" });
  const personalNote = page.locator('[data-doc-id="tip-inspection-order"]');
  const personalNoteText = await personalNote.innerText();
  assert(personalNoteText.includes("개인 메모 · 연결된 문서 본문 없음"),
    "local personal note renders a working-looking document action");
  assert.equal(await personalNote.locator("[data-ev]").count(), 0,
    "local personal note exposes a document body action");
  assert.equal(await personalNote.locator("[data-request-access]").count(), 0,
    "local personal note exposes an irrelevant access-request action");
  await page.locator("#goDraft").click();
  await page.waitForFunction(() => location.hash === "#draft/work-maintenance-plan-2026");
  await page.locator('[data-testid="draft-document"]').waitFor();
  assert.deepStrictEqual(errors, [], "untouched default recurring draft or personal note produced a failed request/console error");
  await page.close();
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await launchBrowser();
    await assertUntouchedDefaultFixture(browser);
    const state = fixtureState();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript((fixture) => {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(fixture));
      localStorage.removeItem("jikmu.ui.v1");
    }, state);
    const canonicalDocuments = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "product-ui", "fixtures", "documents", "index.json"),
      "utf8"
    )).map((document) => Object.assign({}, document, { access: "full" }));
    canonicalDocuments.push({
      id: "RESTRICTED-2026",
      kind: "감사문서",
      title: "현재 접근 제한 감사 기준",
      date: "2026-01-15",
      author: "감사실",
      access: "none"
    });
    const briefing = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "product-ui", "fixtures", "briefing.json"),
      "utf8"
    ));
    briefing.cautions = [{
      text: "제한 문서 주의사항",
      evidence: [{ docId: "RESTRICTED-2026", label: "제한 문서 주의 근거" }]
    }];
    await page.route("**/fixtures/documents/index.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(canonicalDocuments)
    }));
    await page.route("**/fixtures/briefing.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(briefing)
    }));
    const restrictedDetailRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/fixtures/documents/RESTRICTED-2026.json")) {
        restrictedDetailRequests.push(request.url());
      }
    });

    await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-plan-2026`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="workbench"]').waitFor();
    await assertSectionOrder(page);
    assert.equal(await page.getByText("업무 시연 요약", { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-reference-category="official"] [data-doc-id="RULE-2026-0401"]').count(), 1);
    assert.equal(await page.locator('[data-reference-category="memory"] [data-doc-id="APPR-2025-0409"]').count(), 1);
    assert.equal(await page.locator('[data-reference-category="official"] [data-author-type="personal"]').count(), 0);

    const recurringOutput = page.locator('[data-workbench-section="output"]');
    const recurringOutputText = await recurringOutput.innerText();
    for (const value of [
      "과거 구조를 활용한 초안",
      "회사 템플릿",
      "TPL-MAINTENANCE-REPORT",
      "과거 문서",
      "APPR-2025-0409",
      "공식 지침",
      "2건"
    ]) {
      assert(recurringOutputText.includes(value), `recurring output missed ${value}`);
    }
    for (const source of ["template", "prior", "official"]) {
      assert.equal(await recurringOutput.locator(`[data-output-source="${source}"]`).count(), 1,
        `recurring output missed ${source} provenance`);
    }
    await recurringOutput.getByRole("button", { name: "과거 문서 구조로 초안 열기", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#draft/work-maintenance-plan-2026");
    await page.locator('[data-testid="draft-document"]').waitFor();
    await assertToneCandidateRequiresExplicitApply(page, "사용자가 작성한 원문");
    await page.evaluate(() => { location.hash = "#workbench/work-maintenance-plan-2026"; });
    await page.locator('[data-testid="workbench"]').waitFor();

    const official = page.locator('[data-doc-id="RULE-2026-0401"]');
    const officialText = await official.innerText();
    for (const value of ["계약·조달 운영지침", "본사 계약총괄", "2026.04.01", "V2026.04-R03", "업무 지침", "열람 가능"]) {
      assert(officialText.includes(value), `official reference missed ${value}`);
    }

    const memory = page.locator('[data-doc-id="APPR-2025-0409"]');
    const memoryText = await memory.innerText();
    for (const value of ["2025년", "설계·내역 작성", "이지훈 과장", "전년도 기안", "확인 가능"]) {
      assert(memoryText.includes(value), `memory reference missed ${value}`);
    }
    assert((await page.locator('[data-doc-id="LEGACY-NOTE-01"]').innerText()).includes("분류 확인 필요"));

    const restricted = page.locator('[data-doc-id="RESTRICTED-2026"]');
    const restrictedText = await restricted.innerText();
    for (const value of ["현재 접근 제한 감사 기준", "감사실", "본문 열람 권한이 없습니다", "접근 요청"]) {
      assert(restrictedText.includes(value), `restricted reference missed ${value}`);
    }
    assert.equal(restrictedText.includes("권한 없는 문서의 비공개 본문"), false);
    assert.equal(await restricted.locator("[data-ev]").count(), 0, "restricted reference exposes its document viewer");
    assert.equal(await restricted.getAttribute("data-access"), "none",
      "stale persisted access overrode the current canonical denial");
    const restrictedEvidenceButtons = page.locator('[data-ev="RESTRICTED-2026"]');
    assert.equal(await restrictedEvidenceButtons.count(), 3,
      "restricted document was not exercised through todo and caution evidence");
    for (let index = 0; index < await restrictedEvidenceButtons.count(); index += 1) {
      await restrictedEvidenceButtons.nth(index).click();
      await page.locator("#drawer:not([hidden])").waitFor();
      await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
      const deniedDrawerText = await page.locator("#drawerBody").innerText();
      assert(deniedDrawerText.includes("본문 열람 권한이 없습니다"),
        `restricted generic evidence ${index} did not fail closed at the detail boundary: ${deniedDrawerText}`);
      assert.equal(deniedDrawerText.includes("권한 없는 문서의 비공개 본문"), false,
        "restricted body leaked through the evidence drawer");
      await page.locator("#drawerClose").click();
    }
    assert.deepStrictEqual(restrictedDetailRequests, [],
      "restricted evidence issued a document detail request");

    const progress = page.locator('[data-workbench-section="progress"]');
    assert((await progress.innerText()).includes("첫 메모"));
    const progressInput = page.locator("[data-progress-input]");
    assert.equal(await progressInput.count(), 1, "dedicated progress-note input is missing");
    assert.notEqual(await progressInput.getAttribute("id"), "omniIn", "progress-note input reused the global omni input");

    const rawText = "7월 30일까지 도면을 발송하고 담당자에게 확인 요청";
    const headlineDateBefore = await page.locator("[data-date-iso]").getAttribute("datetime");
    const milestonesBefore = await page.locator("[data-work-milestone]").count();
    const todosBefore = await page.locator("#todoList .todo").count();
    await progressInput.fill(rawText);
    await page.locator("[data-save-progress]").click();
    const savedNote = page.locator("[data-progress-note]").filter({ hasText: rawText }).first();
    await savedNote.waitFor();
    assert((await savedNote.innerText()).includes(rawText), "saved progress note lost its raw text");

    const scheduleProposal = savedNote.locator('[data-progress-candidate][data-candidate-type="schedule"]');
    const followupProposal = savedNote.locator('[data-progress-candidate][data-candidate-type="followup"]');
    assert.equal(await scheduleProposal.getAttribute("data-status"), "proposed");
    assert.equal(await followupProposal.getAttribute("data-status"), "proposed");
    assert.equal(await page.locator("[data-date-iso]").getAttribute("datetime"), headlineDateBefore,
      "proposed schedule changed the headline date");
    assert.equal(await page.locator("[data-work-milestone]").count(), milestonesBefore,
      "proposed schedule was applied before confirmation");
    assert.equal(await page.locator("#todoList .todo").count(), todosBefore,
      "proposed follow-up was applied before confirmation");

    await scheduleProposal.locator("[data-confirm-candidate]").click();
    const confirmedSchedule = page.locator("[data-progress-note]").filter({ hasText: rawText }).first()
      .locator('[data-progress-candidate][data-candidate-type="schedule"]');
    await confirmedSchedule.waitFor();
    assert.equal(await confirmedSchedule.getAttribute("data-status"), "confirmed");
    assert.equal(await page.locator("[data-date-iso]").getAttribute("datetime"), headlineDateBefore,
      "confirmed schedule changed the headline date");
    assert.equal(await page.locator("[data-work-milestone]").count(), milestonesBefore + 1,
      "confirmed schedule was not added as a milestone");

    const proposedFollowupAfterRender = page.locator("[data-progress-note]").filter({ hasText: rawText }).first()
      .locator('[data-progress-candidate][data-candidate-type="followup"]');
    await proposedFollowupAfterRender.locator("[data-confirm-candidate]").click();
    const confirmedFollowup = page.locator("[data-progress-note]").filter({ hasText: rawText }).first()
      .locator('[data-progress-candidate][data-candidate-type="followup"]');
    assert.equal(await confirmedFollowup.getAttribute("data-status"), "confirmed");
    assert.equal(await page.locator("#todoList .todo").count(), todosBefore + 1,
      "confirmed follow-up was not added to the checklist");

    const decisionText = "검토 범위를 변경하기로 결정";
    await page.locator("[data-progress-input]").fill(decisionText);
    await page.locator("[data-save-progress]").click();
    const decisionNote = page.locator("[data-progress-note]").filter({ hasText: decisionText }).first();
    assert.equal(await decisionNote.locator('[data-candidate-type="decision"]').getAttribute("data-status"), "proposed");
    assert.equal(await decisionNote.locator('[data-candidate-type="change"]').getAttribute("data-status"), "proposed");

    const referenceText = "배관 규격 참고 메모";
    await page.locator("[data-progress-input]").fill(referenceText);
    await page.locator("[data-save-progress]").click();
    const referenceCandidate = page.locator("[data-progress-note]").filter({ hasText: referenceText }).first()
      .locator('[data-progress-candidate][data-candidate-type="reference"]');
    await referenceCandidate.locator("[data-dismiss-candidate]").click();
    const dismissedReference = page.locator("[data-progress-note]").filter({ hasText: referenceText }).first()
      .locator('[data-progress-candidate][data-candidate-type="reference"]');
    assert.equal(await dismissedReference.getAttribute("data-status"), "dismissed");
    assert((await page.locator("[data-progress-note]").filter({ hasText: referenceText }).first().innerText()).includes(referenceText),
      "dismissing a candidate removed the raw progress note");

    await page.evaluate(() => {
      window.__originalProgressAnalyzer = window.OnMemoryWorkbenchModel.analyzeProgressText;
      window.OnMemoryWorkbenchModel.analyzeProgressText = () => [];
    });
    const emptyText = "분석 후보 없이 남길 원문";
    await page.locator("[data-progress-input]").fill(emptyText);
    await page.locator("[data-save-progress]").click();
    const emptyNote = page.locator("[data-progress-note]").filter({ hasText: emptyText }).first();
    await emptyNote.waitFor();
    assert.equal(await emptyNote.locator("[data-progress-candidate]").count(), 0);
    const emptyAnalysis = await page.evaluate((text) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return stored.works[0].records.find((record) => record.text === text).analysis;
    }, emptyText);
    assert.equal(emptyAnalysis.status, "empty");

    await page.evaluate(() => {
      window.OnMemoryWorkbenchModel.analyzeProgressText = () => { throw new Error("forced browser analysis failure"); };
    });
    const failedText = "분석 실패에도 남길 원문";
    await page.locator("[data-progress-input]").fill(failedText);
    await page.locator("[data-save-progress]").click();
    const failedNote = page.locator("[data-progress-note]").filter({ hasText: failedText }).first();
    await failedNote.waitFor();
    assert((await failedNote.innerText()).includes(failedText), "failed analysis lost the raw progress note");
    const failedAnalysis = await page.evaluate((text) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return stored.works[0].records.find((record) => record.text === text).analysis;
    }, failedText);
    assert.equal(failedAnalysis.status, "failed");
    assert.equal(failedAnalysis.error, "forced browser analysis failure");
    await page.evaluate(() => {
      window.OnMemoryWorkbenchModel.analyzeProgressText = window.__originalProgressAnalyzer;
      delete window.__originalProgressAnalyzer;
    });

    const storedAfterCandidates = await page.evaluate((text) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      const work = stored.works[0];
      const note = work.records.find((record) => record.text === text);
      return {
        headlineDate: work.lifecycle.designDeadlineISO,
        milestone: work.schedule.milestones.find((item) => item.sourceNoteId === note.id),
        statuses: note.analysis.candidates.map((candidate) => candidate.status)
      };
    }, rawText);
    assert.equal(storedAfterCandidates.headlineDate, headlineDateBefore);
    assert(storedAfterCandidates.milestone, "confirmed schedule milestone was not persisted");
    assert.deepStrictEqual(storedAfterCandidates.statuses, ["confirmed", "confirmed"]);
    await assertSectionOrder(page);

    await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-contract-2026`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="workbench"][data-work-id="work-maintenance-contract-2026"]').waitFor();
    await assertSectionOrder(page);
    const officialEmpty = page.locator('[data-workbench-section="official"]');
    assert((await officialEmpty.innerText()).includes("연결된 공식 지침 없음"));
    assert.equal(await officialEmpty.getByRole("button", { name: "자료 연결", exact: true }).count(), 1);
    const memoryEmpty = page.locator('[data-workbench-section="memory"]');
    assert((await memoryEmpty.innerText()).includes("처음 진행하는 업무"));
    assert((await memoryEmpty.innerText()).includes("신규 초안"));
    const newOutput = page.locator('[data-workbench-section="output"]');
    const newOutputText = await newOutput.innerText();
    for (const value of [
      "공식 기준에서 시작하는 새 초안",
      "처음 진행하는 업무",
      "회사 템플릿",
      "TPL-COMPANY-BASIC",
      "공식 지침",
      "0건",
      "확인 필요"
    ]) {
      assert(newOutputText.includes(value), `new output missed ${value}`);
    }
    assert.equal(await newOutput.locator('[data-output-source="first-work"]').count(), 1);
    assert.equal(await newOutput.locator('[data-output-source="template"]').count(), 1);
    assert.equal(await newOutput.locator('[data-output-source="official"]').count(), 1);
    await newOutput.getByRole("button", { name: "빈 초안 시작", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#draft/work-maintenance-contract-2026");
    await page.locator("#freeDraft").waitFor();
    await page.evaluate(() => { location.hash = "#workbench/work-maintenance-contract-2026"; });
    await page.locator('[data-testid="workbench"]').waitFor();

    const completedState = fixtureState();
    const completedWork = completedState.works.find((item) => item.id === "work-maintenance-contract-2026");
    completedWork.lifecycle.phase = "done";
    completedWork.lifecycle.completedAtISO = "2026-07-23T12:00:00.000Z";
    completedWork.lifecycle.completedBy = completedState.currentPersonId;
    const completedPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await completedPage.addInitScript((fixture) => {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(fixture));
      localStorage.removeItem("jikmu.ui.v1");
    }, completedState);
    await completedPage.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-contract-2026`, { waitUntil: "networkidle" });
    assert.equal(await completedPage.locator("[data-progress-input]").count(), 0,
      "completed work exposes the progress-note input");
    assert.equal(await completedPage.locator("[data-save-progress]").count(), 0,
      "completed work exposes the progress-note mutation action");
    await completedPage.close();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-plan-2026`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="workbench"][data-work-id="work-maintenance-plan-2026"]').waitFor();
    await assertSectionOrder(page);
    assert.equal(await page.locator(".reference-grid").evaluateAll((nodes) =>
      nodes.every((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length === 1)), true);
    await assertNoOverflow(page, 390);
    console.log("Workbench browser contract passed: vertical semantics, references, empty/access states, 390px layout");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
