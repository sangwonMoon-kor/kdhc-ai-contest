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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript((fixture) => {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(fixture));
      localStorage.removeItem("jikmu.ui.v1");
    }, completionFixture());

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
