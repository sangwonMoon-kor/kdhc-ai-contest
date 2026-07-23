"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const workspaceModel = require("../workspace-model.js");
const workbenchModel = require("../workbench-model.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 9900 + (process.pid % 80);
const baseURL = `http://127.0.0.1:${port}`;

function completedFixture() {
  const state = workspaceModel.createDemoState();
  const completedWork = JSON.parse(JSON.stringify(state.works[0]));
  completedWork.id = "work-maintenance-plan-completed";
  completedWork.title = "2025년 정기점검보수 기본계획 수립";
  completedWork.todos = [
    { id: "completed-open-todo", text: "후속 확인", done: false, candidate: false, evidence: [], action: "draft" },
    { id: "completed-candidate", text: "검토 후보", done: false, candidate: true, evidence: [] }
  ];
  completedWork.records = [{ id: "completed-record", ts: Date.parse("2026-01-01T09:00:00.000Z"), kind: "decision", text: "완료 전 결정" }];
  state.works.push(completedWork);
  const result = workbenchModel.completeWork(state, completedWork.id, {
    completedAtISO: "2026-01-02T09:00:00.000Z",
    completedBy: state.currentPersonId,
    completionDateISO: "2026-01-02",
    acknowledgeIncomplete: true
  });
  assert.equal(result.state.v, 3);
  assert.equal(result.state.completionBundles.length, 1);
  return result.state;
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
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled : undefined);
  return chromium.launch(Object.assign({ headless: true }, executablePath ? { executablePath } : {}));
}

async function openWork(page, workId) {
  await page.locator(`[data-work-id="${workId}"]`).click();
  await page.waitForFunction((id) => location.hash === `#workbench/${id}`, workId);
}

async function assertHeadline(page, expected) {
  const headline = page.locator(".workbench-headline");
  await headline.waitFor();
  assert.equal(await headline.locator("[data-work-title]").innerText(), expected.title);
  assert.equal(await headline.locator("[data-work-phase]").innerText(), expected.phase);
  assert.equal(await headline.locator("[data-date-label]").innerText(), expected.dateLabel);
  assert.equal(await headline.locator("[data-dday]").innerText(), expected.dday);
  const date = headline.locator("[data-date-iso]");
  if (expected.dateISO) {
    assert.equal(await date.getAttribute("datetime"), expected.dateISO);
    assert.equal(await date.innerText(), expected.dateText);
  } else {
    assert.equal(await page.getByRole("button", { name: "날짜 추가", exact: true }).count(), 1);
  }
  assert.equal(await page.getByText("진행 중", { exact: true }).count(), 0, "generic progress badge remains visible");
}

async function assertWidth(browser, width, state) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1080 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript((fixture) => {
    if (!localStorage.getItem("jikmu.workbench.v1")) {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(fixture));
    }
    localStorage.removeItem("jikmu.ui.v1");
  }, state);

  await page.goto(`${baseURL}/?data=fixture#work/list`, { waitUntil: "networkidle" });
  const activeTab = page.locator('[role="tab"][data-mode="active"]');
  const completedTab = page.locator('[role="tab"][data-mode="completed"]');
  assert.equal(await activeTab.getAttribute("aria-selected"), "true");
  assert.equal(await completedTab.getAttribute("aria-selected"), "false");
  assert.equal(await page.locator('[data-work-phase="done"]').count(), 0);
  assert.equal(await page.locator('[data-work-id="work-maintenance-plan-completed"]').count(), 0, "completed work leaked into the active list");
  if (width === 390) {
    const listDimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    assert(listDimensions.scrollWidth <= listDimensions.clientWidth,
      `390px active work list overflows: ${listDimensions.scrollWidth} > ${listDimensions.clientWidth}`);
  }

  if (width === 1920) {
    await page.locator("#newWork").click();
    await page.waitForFunction(() => location.hash.startsWith("#workbench/w-new-"));
    const created = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return stored.works.find((work) => work.id === stored.selectedWorkId);
    });
    assert.deepStrictEqual(created.lifecycle, {
      phase: "design",
      designDeadlineISO: null,
      completionDateISO: null,
      completedAtISO: null,
      completedBy: null
    }, "new work did not persist a complete v3 lifecycle");
    assert.deepStrictEqual(created.output, {
      mode: "new",
      templateId: null,
      priorDocumentId: null,
      finalDocumentId: null
    }, "new work did not persist a complete v3 output contract");
    await page.locator(".wb-back").click();
    await page.getByRole("heading", { name: "내 업무", exact: true }).waitFor();
    assert.equal(await page.locator(`[data-work-id="${created.id}"]`).count(), 1,
      "new work disappeared from the active list before reload");
  }

  await openWork(page, "work-maintenance-plan-2026");
  await assertHeadline(page, {
    title: "2026년 정기점검보수 기본계획 수립",
    phase: "설계",
    dateLabel: "설계 발송일",
    dday: "D-209",
    dateISO: "2026-07-30",
    dateText: "2026.07.30"
  });

  await page.locator(".wb-back").click();
  await openWork(page, "work-maintenance-contract-2026");
  await assertHeadline(page, {
    title: "2026년 정기점검보수 계약 후 시공 관리",
    phase: "시공",
    dateLabel: "준공일",
    dday: "D-259",
    dateISO: "2026-09-18",
    dateText: "2026.09.18"
  });

  await page.locator(".wb-back").click();
  const legacyDueCardText = await page.locator('[data-work-id="w-problem-recognition-m1"]').innerText();
  assert(legacyDueCardText.includes("일정 미정"),
    "active list did not use the canonical lifecycle date empty state");
  assert.equal(/D(?:-|\+|‑)\d+/.test(legacyDueCardText), false,
    "active list derived a D-day from legacy due");
  await openWork(page, "w-problem-recognition-m1");
  await assertHeadline(page, {
    title: "2026년 동절기 옥외 설비 동파 방지 점검 결과 보고",
    phase: "설계",
    dateLabel: "일정 미정",
    dday: "",
    dateISO: null
  });
  const missingDateHeadlineText = await page.locator(".workbench-headline").innerText();
  assert.equal(/D(?:-|\+|‑)\d+/.test(missingDateHeadlineText), false,
    "workbench headline context derived a D-day from legacy due");
  if (width === 1920) {
    const addDate = page.locator("[data-add-work-date]");
    const headlineBeforeDateConfirmation = await page.locator(".workbench-headline").innerText();
    await addDate.focus();
    await addDate.click();
    const dateDialog = page.locator('[role="dialog"][data-work-date-dialog]');
    await dateDialog.waitFor();
    assert.equal(await dateDialog.getAttribute("aria-modal"), "true");
    assert(await dateDialog.getAttribute("aria-labelledby"), "work date dialog is missing an accessible name");
    assert.equal(await page.locator(":focus").getAttribute("data-work-date-input"), "");
    await page.locator("[data-work-date-input]").fill("2025-12-30");
    assert.equal(await page.locator(".workbench-headline").innerText(), headlineBeforeDateConfirmation,
      "headline changed before explicit date confirmation");
    await page.keyboard.press("Escape");
    assert.equal(await dateDialog.count(), 0, "Escape did not close the work date dialog");
    assert.equal(await page.locator(":focus").getAttribute("data-add-work-date"), "",
      "Escape did not return focus to the date opener");
    assert.equal(await page.evaluate((workId) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return stored.works.find((work) => work.id === workId).lifecycle.designDeadlineISO;
    }, "w-problem-recognition-m1"), null, "Escape persisted an unconfirmed date");

    await addDate.click();
    await page.locator("[data-work-date-input]").fill("2025-12-30");
    await page.locator("[data-cancel-work-date]").click();
    assert.equal(await dateDialog.count(), 0, "cancel did not close the work date dialog");
    assert.equal(await page.locator(":focus").getAttribute("data-add-work-date"), "",
      "cancel did not return focus to the date opener");

    await addDate.click();
    await page.locator("[data-work-date-input]").fill("2025-12-30");
    await page.locator("[data-confirm-work-date]").click();
    await page.waitForFunction(() =>
      document.querySelector("[data-date-iso]")?.getAttribute("datetime") === "2025-12-30");
    assert.equal(await page.locator("[data-dday]").innerText(), "D+3", "overdue confirmed date did not render as D+N");
    assert.equal(await page.evaluate((workId) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return stored.works.find((work) => work.id === workId).lifecycle.designDeadlineISO;
    }, "w-problem-recognition-m1"), "2025-12-30", "confirmed design date was not persisted");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("[data-dday]").innerText(), "D+3", "confirmed design date did not survive reload");

    await page.evaluate((workId) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      const work = stored.works.find((item) => item.id === workId);
      work.lifecycle.completionDateISO = null;
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(stored));
    }, "work-maintenance-contract-2026");
    await page.goto(`${baseURL}/?data=fixture&date-reload=1#workbench/work-maintenance-contract-2026`, { waitUntil: "networkidle" });
    await page.locator("[data-add-work-date]").click();
    await page.locator("[data-work-date-input]").fill("2026-01-05");
    await page.locator("[data-confirm-work-date]").click();
    await page.waitForFunction(() =>
      document.querySelector("[data-date-iso]")?.getAttribute("datetime") === "2026-01-05");
    const contractLifecycle = await page.evaluate((workId) => {
      const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
      return stored.works.find((work) => work.id === workId).lifecycle;
    }, "work-maintenance-contract-2026");
    assert.equal(contractLifecycle.completionDateISO, "2026-01-05",
      "contract-or-later date confirmation did not persist completionDateISO");
    assert.equal(contractLifecycle.designDeadlineISO, null,
      "contract-or-later date confirmation wrote the design deadline field");
  }

  await page.locator(".wb-back").click();
  await completedTab.click();
  assert.equal(await completedTab.getAttribute("aria-selected"), "true");
  assert.equal(await activeTab.getAttribute("aria-selected"), "false");
  assert.equal(await page.locator('[data-work-phase="done"]').count(), 1);
  assert.equal(
    await page.locator('[data-work-id="work-maintenance-plan-completed"]').getAttribute("data-work-id"),
    "work-maintenance-plan-completed",
    "completed list did not preserve the workId"
  );
  await openWork(page, "work-maintenance-plan-completed");
  assert.equal(
    await page.locator('[data-testid="workbench"]').getAttribute("data-work-id"),
    "work-maintenance-plan-completed",
    "completed list did not reenter the same workId"
  );
  await assertHeadline(page, {
    title: "2025년 정기점검보수 기본계획 수립",
    phase: "완료",
    dateLabel: "완료일",
    dday: "D-day",
    dateISO: "2026-01-02",
    dateText: "2026.01.02"
  });
  assert((await page.locator(".workbench-readonly").innerText()).includes("완료 당시 기록"));
  assert.equal(await page.locator("[data-complete-work]").count(), 0, "completed work exposes the completion action");
  for (const selector of ["#wbOmni", "#fileIn", "#goDraft", "#goDraft1", "[data-td]", "[data-promote]", "[data-del]", "[data-hint]"]) {
    assert.equal(await page.locator(selector).count(), 0, `completed work exposes mutable control ${selector}`);
  }

  const completedRecordCount = await page.evaluate((workId) => {
    const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
    return stored.works.find((work) => work.id === workId).records.length;
  }, "work-maintenance-plan-completed");
  await page.goto(`${baseURL}/?data=fixture#home`, { waitUntil: "networkidle" });
  await page.locator("#omniIn").fill("2025년 정기점검보수 기본계획 수립 일정은 2월로 확정");
  await page.locator("#omni").evaluate((form) => form.requestSubmit());
  const completedPick = page.locator('[data-pick="work-maintenance-plan-completed"]');
  if (await completedPick.count()) await completedPick.click();
  await page.waitForTimeout(50);
  const afterGlobalRecordCount = await page.evaluate((workId) => {
    const stored = JSON.parse(localStorage.getItem("jikmu.workbench.v1"));
    return stored.works.find((work) => work.id === workId).records.length;
  }, "work-maintenance-plan-completed");
  assert.equal(afterGlobalRecordCount, completedRecordCount, "global input mutated a completed work");
  assert((await page.locator("#homeResult").innerText()).includes("완료된 업무"), "global input guard does not explain why the work is read-only");

  await page.goto(`${baseURL}/?data=fixture#draft/work-maintenance-plan-completed`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => location.hash === "#workbench/work-maintenance-plan-completed");
  assert.equal(await page.locator('[data-work-phase="done"]').count(), 1, "completed draft route did not resolve to the read-only workbench");
  for (const selector of ["#dSave", "#dCheck", "#freeDraft", "[data-ph]"]) {
    assert.equal(await page.locator(selector).count(), 0, `completed draft route exposes mutable control ${selector}`);
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert(overflow.scrollWidth <= overflow.clientWidth, `${width}px workbench overflows: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
  await page.close();
}

async function run() {
  let server;
  let browser;
  try {
    const state = completedFixture();
    server = await startServer();
    browser = await launchBrowser();
    await assertWidth(browser, 1920, state);
    await assertWidth(browser, 390, state);
    console.log("Work list browser contract passed at 1920px and 390px");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
