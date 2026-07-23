"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const workspaceModel = require("../workspace-model.js");
const workbenchModel = require("../workbench-model.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 9980 + (process.pid % 17);
const baseURL = `http://127.0.0.1:${port}`;
const targetWorkId = "work-maintenance-plan-2026";
const reviewCase = process.env.COMPLETION_REVIEW_CASE || "all";

function completionFixture() {
  const state = workspaceModel.createDemoState();
  const target = state.works.find((work) => work.id === targetWorkId);
  target.output.finalDocumentId = "APPR-2026-0723";
  target.todos = [
    { id: "todo-done", text: "계획서 결재", done: true, candidate: false, evidence: [] },
    { id: "todo-open", text: "현장 배포 확인", done: false, candidate: false, evidence: [] },
    { id: "todo-proposed", text: "추가 검토 후보", done: false, candidate: true, evidence: [] }
  ];
  target.records = [{
    id: "record-confirmed",
    kind: "decision",
    text: "점검 범위를 확정했습니다.",
    ts: "2026-07-22T09:00:00.000Z"
  }];

  const older = JSON.parse(JSON.stringify(target));
  older.id = "work-maintenance-plan-2025";
  older.title = "2025년 정기점검보수 기본계획 수립";
  older.todos = [];
  older.records = [];
  older.output.finalDocumentId = null;
  state.works.push(older);
  return workbenchModel.completeWork(state, older.id, {
    completedAtISO: "2026-01-02T09:00:00.000Z",
    completedBy: state.currentPersonId,
    completionDateISO: "2026-01-02",
    acknowledgeIncomplete: true
  }).state;
}

function snapshotFixture(removeLiveWork) {
  const state = workspaceModel.createDemoState();
  const target = state.works.find((work) => work.id === targetWorkId);
  target.title = "완료 묶음 스냅샷 제목";
  target.instruction = "완료 당시 지시";
  target.records = [{
    id: "snapshot-record",
    kind: "decision",
    text: "완료 당시 확정 기록",
    ts: "2026-07-23T01:00:00.000Z"
  }];
  const completed = workbenchModel.completeWork(state, targetWorkId, {
    completedAtISO: "2026-07-23T06:00:00.000Z",
    completedBy: state.currentPersonId,
    completionDateISO: "2026-07-23",
    acknowledgeIncomplete: true
  }).state;
  const live = completed.works.find((work) => work.id === targetWorkId);
  live.title = "변경된 현재 업무 제목";
  live.instruction = "완료 후 잘못 변경된 지시";
  live.records[0].text = "완료 후 잘못 변경된 기록";
  if (removeLiveWork) {
    completed.works = completed.works.filter((work) => work.id !== targetWorkId);
  }
  return completed;
}

function sameDateOrderingFixture() {
  const state = workspaceModel.createDemoState();
  const newerWork = JSON.parse(JSON.stringify(state.works[0]));
  newerWork.id = "work-same-day-newer";
  newerWork.title = "같은 날 나중에 완료";
  state.works.push(newerWork);
  let completed = workbenchModel.completeWork(state, targetWorkId, {
    completedAtISO: "2026-07-23T01:00:00.000Z",
    completedBy: state.currentPersonId,
    completionDateISO: "2026-07-23",
    acknowledgeIncomplete: true
  }).state;
  completed = workbenchModel.completeWork(completed, newerWork.id, {
    completedAtISO: "2026-07-23T12:00:00.000Z",
    completedBy: state.currentPersonId,
    completionDateISO: "2026-07-23",
    acknowledgeIncomplete: true
  }).state;
  completed.completionBundles.find((bundle) => bundle.workId === targetWorkId).id = "zzz-older-bundle";
  completed.completionBundles.find((bundle) => bundle.workId === newerWork.id).id = "aaa-newer-bundle";
  return completed;
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

async function installFixture(page, fixture, fixedNowISO) {
  await page.addInitScript(({ state, nowISO }) => {
    localStorage.setItem("jikmu.workbench.v1", JSON.stringify(state));
    localStorage.removeItem("jikmu.ui.v1");
    if (!nowISO) return;
    const NativeDate = Date;
    const fixedTime = NativeDate.parse(nowISO);
    class FixedDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedTime]));
      }
      static now() { return fixedTime; }
      static parse(value) { return NativeDate.parse(value); }
      static UTC(...args) { return NativeDate.UTC(...args); }
    }
    window.Date = FixedDate;
  }, { state: fixture, nowISO: fixedNowISO || null });
}

async function assertDialogDisposedOnRoute(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  await installFixture(page, completionFixture());
  await page.goto(`${baseURL}/?data=fixture#workbench/${targetWorkId}`, { waitUntil: "networkidle" });
  const opener = page.locator("[data-complete-work]");
  await opener.click();
  await page.locator("[data-completion-review]").waitFor();
  await page.evaluate(() => { location.hash = "#schedule"; });
  await page.waitForFunction(() => location.hash === "#schedule");
  await page.getByRole("heading", { name: "일정", exact: true }).waitFor();
  assert.equal(await page.locator("[data-completion-review]").count(), 0, "completion dialog survived a hash route change");
  await page.locator("#calNext").click();
  assert.equal(await page.getByRole("heading", { name: "일정", exact: true }).count(), 1, "route under the stale dialog is not usable");
  await page.goBack();
  await page.waitForFunction((workId) => location.hash === `#workbench/${workId}`, targetWorkId);
  await opener.waitFor();
  await opener.focus();
  await opener.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-completion-review]").count(), 0);
  assert.equal(await page.locator(":focus").getAttribute("data-complete-work"), "", "nominal focus return broke after route disposal");
  await page.close();
}

async function assertLocalCompletionDate(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  await installFixture(page, completionFixture(), "2026-07-22T15:30:00.000Z");
  await page.goto(`${baseURL}/?data=fixture#workbench/${targetWorkId}`, { waitUntil: "networkidle" });
  await page.locator("[data-complete-work]").click();
  assert.equal(
    await page.locator("[data-completion-date]").inputValue(),
    "2026-07-23",
    "completion date did not use the Asia/Seoul business calendar date"
  );
  await page.keyboard.press("Escape");
  await page.close();
}

async function assertSnapshotBackedReentry(browser) {
  const divergedPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  divergedPage.setDefaultTimeout(5000);
  await installFixture(divergedPage, snapshotFixture(false));
  await divergedPage.goto(`${baseURL}/?data=fixture#work/list`, { waitUntil: "networkidle" });
  await divergedPage.locator('[role="tab"][data-mode="completed"]').click();
  await divergedPage.locator(`[data-work-id="${targetWorkId}"]`).click();
  await divergedPage.waitForFunction((workId) => location.hash === `#workbench/${workId}`, targetWorkId);
  assert.equal(await divergedPage.locator("[data-work-title]").innerText(), "완료 묶음 스냅샷 제목",
    "completed-list reentry rendered divergent live work");
  assert((await divergedPage.locator("#recList").innerText()).includes("완료 당시 확정 기록"));
  assert(!(await divergedPage.locator("#recList").innerText()).includes("완료 후 잘못 변경된 기록"));
  assert.equal(await divergedPage.locator("[data-testid='workbench']").getAttribute("data-work-source"), "completion-snapshot");
  assert((await divergedPage.locator("[data-completion-snapshot-notice]").innerText()).includes("현재 업무 내용과"));

  await divergedPage.goto(`${baseURL}/?data=fixture#cloud`, { waitUntil: "networkidle" });
  await divergedPage.locator(`[data-cloud-bundle][data-work-id="${targetWorkId}"]`).click();
  await divergedPage.waitForFunction((workId) => location.hash === `#workbench/${workId}`, targetWorkId);
  assert.equal(await divergedPage.locator("[data-work-title]").innerText(), "완료 묶음 스냅샷 제목",
    "cloud reentry rendered divergent live work");
  await divergedPage.close();

  const missingPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  missingPage.setDefaultTimeout(5000);
  await installFixture(missingPage, snapshotFixture(true));
  await missingPage.goto(`${baseURL}/?data=fixture#cloud`, { waitUntil: "networkidle" });
  await missingPage.locator(`[data-cloud-bundle][data-work-id="${targetWorkId}"]`).click();
  await missingPage.waitForFunction((workId) => location.hash === `#workbench/${workId}`, targetWorkId);
  assert.equal(await missingPage.locator("[data-work-title]").innerText(), "완료 묶음 스냅샷 제목",
    "missing live work prevented snapshot reentry");
  assert((await missingPage.locator("[data-completion-snapshot-notice]").innerText()).includes("현재 업무 목록에는 없지만"));
  await missingPage.close();
}

async function assertCloudCompletedAtOrdering(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  await installFixture(page, sameDateOrderingFixture());
  await page.goto(`${baseURL}/?data=fixture#cloud`, { waitUntil: "networkidle" });
  assert.deepStrictEqual(
    await page.locator("[data-cloud-bundle]").evaluateAll((cards) => cards.map((card) => card.dataset.bundleId)),
    ["aaa-newer-bundle", "zzz-older-bundle"],
    "same-date cloud bundles were not ordered by completedAtISO"
  );
  await page.close();
}

async function assertDialogAccessibility(page) {
  const opener = page.locator("[data-complete-work]");
  await opener.focus();
  await opener.click();
  const dialog = page.locator('[role="dialog"][data-completion-review]');
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  assert(await dialog.getAttribute("aria-labelledby"), "completion review dialog is missing an accessible name");
  assert.equal(await page.locator(":focus").getAttribute("data-completion-date"), "");

  await page.locator("[data-confirm-completion]").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").getAttribute("data-completion-date"), "", "Tab escaped the completion dialog");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator(":focus").getAttribute("data-confirm-completion"), "", "Shift+Tab escaped the completion dialog");

  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0, "Escape did not close the completion review");
  assert.equal(await page.locator(":focus").getAttribute("data-complete-work"), "", "Escape did not return focus to the opener");

  await opener.click();
  await page.locator("[data-cancel-completion]").click();
  assert.equal(await dialog.count(), 0, "cancel did not close the completion review");
  assert.equal(await page.locator(":focus").getAttribute("data-complete-work"), "", "cancel did not return focus to the opener");
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await launchBrowser();
    const reviewCases = {
      "route-dispose": assertDialogDisposedOnRoute,
      "local-date": assertLocalCompletionDate,
      "snapshot-reentry": assertSnapshotBackedReentry,
      "cloud-order": assertCloudCompletedAtOrdering
    };
    if (reviewCase !== "all") {
      assert(reviewCases[reviewCase], `unknown completion review case: ${reviewCase}`);
      await reviewCases[reviewCase](browser);
      console.log(`Completion review case passed: ${reviewCase}`);
      return;
    }
    await assertDialogDisposedOnRoute(browser);
    await assertLocalCompletionDate(browser);
    await assertSnapshotBackedReentry(browser);
    await assertCloudCompletedAtOrdering(browser);

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    await installFixture(page, completionFixture());

    await page.goto(`${baseURL}/?data=fixture#workbench/${targetWorkId}`, { waitUntil: "networkidle" });
    await assertDialogAccessibility(page);

    await page.locator("[data-complete-work]").click();
    const dialog = page.locator('[role="dialog"][data-completion-review]');
    for (const selector of [
      "[data-review-output]",
      "[data-review-standards]",
      "[data-review-records]",
      "[data-review-open-items]"
    ]) {
      assert.equal(await dialog.locator(selector).count(), 1, `completion review is missing ${selector}`);
    }
    assert((await dialog.locator("[data-review-output]").innerText()).includes("APPR-2026-0723"));
    assert((await dialog.locator("[data-review-standards]").innerText()).includes("RULE-2026-0401"));
    assert((await dialog.locator("[data-review-records]").innerText()).includes("점검 범위를 확정했습니다."));
    assert((await dialog.locator("[data-review-open-items]").innerText()).includes("현장 배포 확인"));

    await page.locator("[data-completion-date]").fill("2026-07-23");
    assert.equal(await page.locator("[data-confirm-completion]").isDisabled(), false, "open items force-disabled completion");
    await page.locator("[data-confirm-completion]").click();
    assert.equal(await dialog.count(), 1, "completion ignored the acknowledgement requirement");
    assert((await dialog.getByRole("status").innerText()).includes("미완료"));
    assert.equal(await page.locator(":focus").getAttribute("data-acknowledge-open-items"), "");

    await page.locator("[data-acknowledge-open-items]").check();
    await page.locator("[data-confirm-completion]").click();
    await page.waitForFunction(() => location.hash === "#work/list");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("jikmu.workbench.v1")));
    const completedWork = stored.works.find((work) => work.id === "work-maintenance-plan-2026");
    const targetBundle = stored.completionBundles.find((bundle) => bundle.workId === "work-maintenance-plan-2026");
    assert.equal(completedWork.lifecycle.phase, "done");
    assert.equal(targetBundle.workId, targetWorkId);
    assert.equal(targetBundle.workSnapshot.id, targetWorkId);

    await page.locator('[role="tab"][data-mode="completed"]').click();
    const completedCard = page.locator(`[data-work-id="${targetWorkId}"]`);
    await completedCard.waitFor();
    await completedCard.click();
    await page.waitForFunction((workId) => location.hash === `#workbench/${workId}`, targetWorkId);
    assert.equal(await page.locator("[data-testid='workbench']").getAttribute("data-work-id"), targetWorkId);
    assert((await page.locator(".workbench-readonly").innerText()).includes("완료 당시 기록"));
    assert.equal(await page.locator("[data-completion-snapshot-notice]").count(), 0,
      "matching live work was falsely reported as diverged from its completion snapshot");
    for (const selector of [
      "[data-complete-work]",
      "[data-progress-form]",
      "[data-connect-references]",
      "#fileIn",
      "#goDraft",
      "[data-confirm-candidate]"
    ]) {
      assert.equal(await page.locator(selector).count(), 0, `completed work exposes mutable control ${selector}`);
    }

    await page.goto(`${baseURL}/?data=fixture#cloud`, { waitUntil: "networkidle" });
    const bundles = page.locator("[data-cloud-bundle]");
    assert.equal(await bundles.count(), 2);
    assert.equal(await bundles.nth(0).getAttribute("data-bundle-id"), targetBundle.id, "cloud bundles are not newest-first");
    const targetCard = page.locator(`[data-cloud-bundle][data-bundle-id="${targetBundle.id}"]`);
    assert.equal(await targetCard.getAttribute("data-work-id"), targetWorkId);
    const cloudSummary = await targetCard.innerText();
    for (const text of ["2026년 정기점검보수 기본계획 수립", "2026.07.23", "최종 결과물 있음", "기록 1건", "공식 기준 1건"]) {
      assert(cloudSummary.includes(text), `cloud bundle summary is missing ${text}`);
    }
    await targetCard.click();
    await page.waitForFunction((workId) => location.hash === `#workbench/${workId}`, targetWorkId);
    assert.equal(await page.locator("[data-testid='workbench']").getAttribute("data-work-id"), targetWorkId);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    assert(overflow.scrollWidth <= overflow.clientWidth, `completion flow overflows: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
    console.log("Completion browser contract passed: review, transition, read-only reentry, cloud bundle, dialog accessibility");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
