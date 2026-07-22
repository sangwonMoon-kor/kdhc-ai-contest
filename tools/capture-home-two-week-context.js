"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..");
const port = 8410;
const origin = `http://127.0.0.1:${port}`;
const output = path.join(repoRoot, "product-ui", "screenshots", "home-two-week-context.png");
const mobileOutput = path.join(os.tmpdir(), "kdhc-home-two-week-mobile.png");

function stopServer(server) {
  if (!server || server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
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
      env: { ...process.env, PRODUCT_UI_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`home capture server did not claim port ${port}\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopServer(server).finally(() => reject(error));
    }
    server.on("error", fail);
    server.on("exit", (code, signal) => fail(new Error(`home capture server exited early (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`)));
    server.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (settled || !stdout.includes(`product-ui ${origin}`)) return;
      settled = true;
      clearTimeout(timeout);
      resolve(server);
    });
    server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  });
}

async function capture(page, viewport, file) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/?data=fixture#home`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("jikmu.workbench.v1");
    localStorage.removeItem("jikmu.ui.v1");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid="home-omni"]').waitFor();
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  const status = (await page.locator("#dataStatus").innerText()).trim();
  assert.equal(status, "시연용 샘플 데이터", "fixture capture data-mode label is not truthful");
  assert.equal(await page.locator("[data-calendar-date]").count(), 14, "home capture did not render 14 dates");
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert(overflow.scrollWidth <= overflow.clientWidth, `${viewport.width}px home has document overflow: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
  await page.screenshot({ path: file });
  return overflow;
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await chromium.launch({ headless: true });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: "light", reducedMotion: "reduce" });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: "light", reducedMotion: "reduce" });
    const desktopOverflow = await capture(desktop, { width: 1920, height: 1080 }, output);
    const mobileOverflow = await capture(mobile, { width: 390, height: 844 }, mobileOutput);
    console.log(`Captured desktop home: ${path.relative(repoRoot, output)} (${desktopOverflow.scrollWidth}/${desktopOverflow.clientWidth})`);
    console.log(`Captured mobile home: ${mobileOutput} (${mobileOverflow.scrollWidth}/${mobileOverflow.clientWidth})`);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
