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
  work.sources.push({
    docId: "RESTRICTED-2026",
    category: "official",
    title: "제한 감사 기준",
    issuer: "감사실",
    effectiveDate: "2026-01-15",
    version: "V1.0",
    role: "감사 적용 기준",
    access: "none",
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

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await launchBrowser();
    const state = fixtureState();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript((fixture) => {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(fixture));
      localStorage.removeItem("jikmu.ui.v1");
    }, state);

    await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-plan-2026`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="workbench"]').waitFor();
    await assertSectionOrder(page);
    assert.equal(await page.getByText("업무 시연 요약", { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-reference-category="official"] [data-doc-id="RULE-2026-0401"]').count(), 1);
    assert.equal(await page.locator('[data-reference-category="memory"] [data-doc-id="APPR-2025-0409"]').count(), 1);
    assert.equal(await page.locator('[data-reference-category="official"] [data-author-type="personal"]').count(), 0);

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
    for (const value of ["제한 감사 기준", "감사실", "본문 열람 권한이 없습니다", "접근 요청"]) {
      assert(restrictedText.includes(value), `restricted reference missed ${value}`);
    }
    assert.equal(restrictedText.includes("권한 없는 문서의 비공개 본문"), false);
    assert.equal(await restricted.locator("[data-ev]").count(), 0, "restricted reference exposes its document viewer");

    const progress = page.locator('[data-workbench-section="progress"]');
    assert((await progress.innerText()).includes("첫 메모"));

    await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-contract-2026`, { waitUntil: "networkidle" });
    await assertSectionOrder(page);
    const officialEmpty = page.locator('[data-workbench-section="official"]');
    assert((await officialEmpty.innerText()).includes("연결된 공식 지침 없음"));
    assert.equal(await officialEmpty.getByRole("button", { name: "자료 연결", exact: true }).count(), 1);
    const memoryEmpty = page.locator('[data-workbench-section="memory"]');
    assert((await memoryEmpty.innerText()).includes("처음 진행하는 업무"));
    assert((await memoryEmpty.innerText()).includes("신규 초안"));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/?data=fixture#workbench/work-maintenance-plan-2026`, { waitUntil: "networkidle" });
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
