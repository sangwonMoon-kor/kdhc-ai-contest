"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 9300 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;

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

async function assertShell(page, hash, activeHref) {
  await page.goto(`${base}/?data=fixture${hash}`, { waitUntil: "networkidle" });
  const sidebar = page.locator(".app-sidebar");
  await sidebar.waitFor();
  assert.equal(await sidebar.locator(".app-brand").innerText(), "ON_메모리");
  assert.deepStrictEqual(await sidebar.locator("nav a").allInnerTexts(), ["홈", "내 업무", "일정", "클라우드"]);
  assert.equal(await sidebar.locator(`nav a[href="${activeHref}"]`).getAttribute("aria-current"), "page");
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    await assertShell(page, "#home", "#home");
    await assertShell(page, "#work/list", "#work/list");
    await assertShell(page, "#schedule", "#schedule");
    await assertShell(page, "#cloud", "#cloud");
    await assertShell(page, "#workbench/work-maintenance-plan-2026", "#work/list");

    await page.goto(`${base}/?data=fixture#work/calendar`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => location.hash === "#schedule");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/?data=fixture#home`, { waitUntil: "networkidle" });
    const mobileLinks = page.locator(".app-sidebar nav a");
    assert.deepStrictEqual(await mobileLinks.allInnerTexts(), ["홈", "내 업무", "일정", "클라우드"]);
    await mobileLinks.nth(0).focus();
    const focus = await mobileLinks.nth(0).evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    assert(focus.width >= 2 && focus.style !== "none", "mobile menu focus ring is missing");
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    assert(overflow.scrollWidth <= overflow.clientWidth, `mobile shell overflows: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
    console.log("Product shell browser contract passed");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
