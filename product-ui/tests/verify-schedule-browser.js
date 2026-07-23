"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 9600 + (process.pid % 300);
const base = `http://127.0.0.1:${port}`;
const currentPersonId = "person-kim-hannan";

const state = {
  v: 2,
  currentPersonId,
  currentRoleId: "role-maintenance-planning",
  selectedWorkId: "mine-work",
  personalSchedules: [{ id: "personal-seed", title: "개인 검토", startISO: "2026-01-07", endISO: "2026-01-07", ownerId: currentPersonId, status: "active" }],
  works: [
    { id: "mine-work", title: "내 담당 정비", due: "2026-01-09", departmentId: "dept-plant", sectionId: "section-maintenance", relations: [{ personId: currentPersonId, kind: "owner" }], schedule: { startISO: "2026-01-02", endISO: "2026-01-09", milestones: [{ id: "inspection", dateISO: "2026-01-05", label: "현장 점검" }] }, todos: [], records: [], sources: [], draft: { savedAt: null, values: null } },
    { id: "section-work", title: "우리 과 정비", due: "2026-01-13", departmentId: "dept-plant", sectionId: "section-maintenance", relations: [{ personId: "person-other", kind: "owner" }], schedule: { startISO: "2026-01-11", endISO: "2026-01-13", milestones: [] }, todos: [], records: [], sources: [], draft: { savedAt: null, values: null } },
    { id: "department-work", title: "타 과 발전 업무", due: "2026-01-16", departmentId: "dept-plant", sectionId: "section-other", relations: [{ personId: "person-other", kind: "owner" }], schedule: { startISO: "2026-01-15", endISO: "2026-01-16", milestones: [] }, todos: [], records: [], sources: [], draft: { savedAt: null, values: null } },
    { id: "overlap-work", title: "세 범위 중첩 업무", due: "2026-01-22", departmentId: "dept-plant", sectionId: "section-maintenance", relations: [{ personId: currentPersonId, kind: "participant" }], schedule: { startISO: "2026-01-20", endISO: "2026-01-22", milestones: [] }, todos: [], records: [], sources: [], draft: { savedAt: null, values: null } }
  ]
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["tools/serve-product-ui.js"], { cwd: repoRoot, env: Object.assign({}, process.env, { PRODUCT_UI_PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`server timeout\n${stdout}\n${stderr}`)), 5000);
    server.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (!stdout.includes(base)) return;
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

async function setScope(page, scope, checked) {
  const input = page.locator(`.schedule-layers input[value="${scope}"]`);
  if ((await input.isChecked()) !== checked) await input.locator("..").click();
  await page.waitForFunction(({ value, expected }) => {
    const item = document.querySelector(`.schedule-layers input[value="${value}"]`);
    return item && item.checked === expected;
  }, { value: scope, expected: checked });
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript((seed) => {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(seed));
      localStorage.removeItem("jikmu.ui.v1");
    }, state);
    await page.goto(`${base}/?data=fixture#schedule`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "일정", exact: true }).waitFor();

    const mine = page.locator('.schedule-layers input[value="mine"]');
    const section = page.locator('.schedule-layers input[value="section"]');
    const department = page.locator('.schedule-layers input[value="department"]');
    assert.equal(await mine.isChecked(), true, "mine must be selected by default");
    assert.equal(await section.isChecked(), false, "section must be independently disabled by default");
    assert.equal(await department.isChecked(), false, "department must be independently disabled by default");
    assert.equal(await page.locator('[data-schedule-event="mine-work"]').count(), 1, "mine layer omits owner work");
    assert.equal(await page.locator('[data-schedule-event="overlap-work"]').count(), 1, "mine layer omits participant work");
    assert.equal(await page.locator('[data-schedule-event="personal-seed"][data-event-kind="personal"]').count(), 1, "mine layer omits personal schedule");
    assert.equal(await page.locator('[data-schedule-event="section-work"]').count(), 0, "section-only work leaked into mine layer");
    assert.equal(await page.locator('[data-schedule-event="department-work"]').count(), 0, "department-only work leaked into mine layer");

    await section.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector('.schedule-layers input[value="section"]')?.checked === true);
    assert.equal(await page.locator('[data-schedule-event="section-work"]').count(), 1, "section layer does not add section work");
    assert.equal(await page.locator('[data-schedule-event="overlap-work"]').count(), 1, "overlapping work was duplicated across mine and section");
    assert.equal(await page.locator('[data-schedule-event="overlap-work"]').getAttribute("data-primary-scope"), "mine", "mine does not win the primary-scope priority");

    await setScope(page, "mine", false);
    assert.equal(await page.locator('[data-schedule-event="mine-work"]').count(), 1, "same-section owner work should remain in the section layer");
    assert.equal(await page.locator('[data-schedule-event="personal-seed"]').count(), 0, "personal schedule leaked outside mine layer");
    assert.equal(await page.locator('[data-schedule-event="overlap-work"]').getAttribute("data-primary-scope"), "section", "section does not become primary after mine is disabled");

    await setScope(page, "department", true);
    assert.equal(await page.locator('[data-schedule-event="department-work"]').count(), 1, "department layer does not add department work");
    await setScope(page, "mine", true);
    assert.equal(await page.locator('[data-schedule-event="overlap-work"]').count(), 1, "three selected layers duplicated one work");
    assert.equal(await page.locator('[data-schedule-event="overlap-work"]').getAttribute("data-primary-scope"), "mine", "three-layer priority is not mine first");
    assert.equal(await page.locator('[data-work-id="mine-work"] .schedule-milestone').count(), 1, "work milestone is not rendered on its range bar");

    await setScope(page, "mine", false);
    await setScope(page, "section", false);
    await setScope(page, "department", false);
    assert.equal(await page.getByText("표시할 범위를 선택하세요", { exact: true }).count(), 1, "all-off layers do not show an explicit empty state");

    await setScope(page, "mine", true);
    await page.getByRole("button", { name: "2026년 1월 10일에 개인 일정 추가" }).click();
    await page.locator("#personalTitle").fill("직접 등록 일정");
    await page.locator("#personalStart").fill("2026-01-11");
    await page.locator("#personalEnd").fill("2026-01-10");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    assert((await page.locator("#personalScheduleError").innerText()).includes("종료일"), "invalid personal date range was accepted");
    await page.locator("#personalEnd").fill("2026-01-12");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.locator('[data-event-kind="personal"]', { hasText: "직접 등록 일정" }).waitFor();

    await page.getByRole("button", { name: "다음 달" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "2026년 2월" }).waitFor();
    await page.getByRole("button", { name: "이전 달" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "2026년 1월" }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    assert(overflow.scrollWidth <= overflow.clientWidth, `390px schedule overflows: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
    console.log("Schedule browser contract passed");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
