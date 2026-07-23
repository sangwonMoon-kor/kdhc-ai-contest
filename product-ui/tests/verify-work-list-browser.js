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
    localStorage.setItem("jikmu.workbench.v1", JSON.stringify(fixture));
    localStorage.removeItem("jikmu.ui.v1");
  }, state);

  await page.goto(`${baseURL}/?data=fixture#work/list`, { waitUntil: "networkidle" });
  const activeTab = page.locator('[role="tab"][data-mode="active"]');
  const completedTab = page.locator('[role="tab"][data-mode="completed"]');
  assert.equal(await activeTab.getAttribute("aria-selected"), "true");
  assert.equal(await completedTab.getAttribute("aria-selected"), "false");
  assert.equal(await page.locator('[data-work-phase="done"]').count(), 0);
  assert.equal(await page.locator('[data-work-id="work-maintenance-plan-completed"]').count(), 0, "completed work leaked into the active list");

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
  await openWork(page, "w-problem-recognition-m1");
  await assertHeadline(page, {
    title: "2026년 동절기 옥외 설비 동파 방지 점검 결과 보고",
    phase: "설계",
    dateLabel: "일정 미정",
    dday: "",
    dateISO: null
  });

  await page.locator(".wb-back").click();
  await completedTab.click();
  assert.equal(await completedTab.getAttribute("aria-selected"), "true");
  assert.equal(await activeTab.getAttribute("aria-selected"), "false");
  assert.equal(await page.locator('[data-work-phase="done"]').count(), 1);
  await openWork(page, "work-maintenance-plan-completed");
  await assertHeadline(page, {
    title: "2025년 정기점검보수 기본계획 수립",
    phase: "완료",
    dateLabel: "완료일",
    dday: "D-day",
    dateISO: "2026-01-02",
    dateText: "2026.01.02"
  });
  assert.equal(await page.locator("[data-complete-work]").count(), 0, "completed work exposes the completion action");
  for (const selector of ["#wbOmni", "#fileIn", "#goDraft", "#goDraft1", "[data-td]", "[data-promote]", "[data-del]", "[data-hint]"]) {
    assert.equal(await page.locator(selector).count(), 0, `completed work exposes mutable control ${selector}`);
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
