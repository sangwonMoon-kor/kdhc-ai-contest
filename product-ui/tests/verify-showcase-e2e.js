"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const local = !process.env.PRODUCT_UI_URL;
const base = process.env.PRODUCT_UI_URL || "http://127.0.0.1:8410/?data=fixture";
const server = local ? spawn(process.execPath, [path.resolve(__dirname, "..", "..", "tools", "serve-product-ui.js")], {
  env: { ...process.env, PRODUCT_UI_PORT: "8410" }, stdio: ["ignore", "pipe", "inherit"]
}) : null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browserCandidates = [
  process.env.BROWSER_PATH,
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
let browser;

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch("http://127.0.0.1:8410/index.html"); if (r.ok) return; } catch (e) {}
    await wait(100);
  }
  throw new Error("product UI server did not start");
}

(async () => {
  if (local) await waitForServer();
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(base + (base.includes("#") ? "" : "#home"));
  await page.evaluate(() => {
    localStorage.removeItem("jikmu.workbench.v1");
    localStorage.removeItem("jikmu.ui.v1");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="home-omni"]');
  await page.fill("#omniIn", "팀장님이 다음 주까지 펌프 정비계획 올리래");
  await page.locator('[data-testid="home-omni"]').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => location.hash.startsWith("#workbench/"));
  await page.waitForSelector('[data-testid="workbench"]');
  if (!(await page.textContent("main")).includes("순환수 펌프")) throw new Error("pump workbench did not open");

  await page.fill("#wbIn", "운영부 일정은 5월 둘째 주로 확정");
  await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("운영부 일정은 5월 둘째 주로 확정"));

  await page.fill("#wbIn", "작년 펌프 정비 추진 보고 찾아줘");
  await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
  await page.waitForSelector('[data-testid="grounded-answer"] .badge.grounded');
  if (!(await page.textContent("#wbResult")).includes("관련 문서")) throw new Error("grounded documents missing");
  const evidence = page.locator("#wbResult [data-ev]").first();
  if (!(await evidence.count())) throw new Error("evidence link missing");
  await evidence.click();
  await page.waitForSelector("#drawer:not([hidden])");
  await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
  if ((await page.textContent("#drawerBody")).includes("불러오지 못했습니다")) throw new Error("evidence detail failed");
  await page.click("#drawerClose");

  await page.click("#goDraft");
  await page.waitForFunction(() => location.hash.startsWith("#draft/"));
  await page.waitForSelector('[data-testid="draft-document"]');
  await page.click("#dCheck");
  await page.waitForSelector('[data-testid="precheck-results"] .f-item');
  if ((await page.locator('[data-testid="precheck-results"] .f-item').count()) < 1) throw new Error("precheck findings missing");
  const expectedStatus = base.includes("data=fixture") ? "시연용 샘플 데이터" : base.includes("data=live") ? "실제 엔진 연결" : null;
  if (expectedStatus && (await page.textContent("#dataStatus")).trim() !== expectedStatus) throw new Error(`data status mismatch: expected ${expectedStatus}`);

  fs.mkdirSync(path.resolve(__dirname, "..", "screenshots"), { recursive: true });
  await page.screenshot({ path: path.resolve(__dirname, "..", "screenshots", "showcase-golden.png"), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base + (base.includes("#") ? "" : "#home"));
  await mobile.waitForSelector('[data-testid="home-omni"]');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("390px horizontal overflow");

  if (consoleErrors.length) throw new Error("console errors: " + consoleErrors.join(" | "));
  console.log("Showcase E2E passed");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close();
    if (server && server.exitCode === null) server.kill("SIGTERM");
  });
