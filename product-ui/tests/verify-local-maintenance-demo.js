"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const localFixtureRoot = path.join(repoRoot, "product-ui", "fixtures", "local-maintenance");
const localOrigin = "http://127.0.0.1:8422";
const target = `${localOrigin}/?data=fixture#home`;
const browserCandidates = [
  process.env.BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

function assertLocalFixture() {
  for (const relative of [
    "manifest.json",
    "ask/maintenance-plan.json",
    "documents/PROC-MAINT-31100.json"
  ]) {
    const file = path.join(localFixtureRoot, relative);
    assert(fs.existsSync(file), `local maintenance fixture missing: ${relative}; run tools/build-local-maintenance-fixture.js first`);
  }
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
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
      env: { ...process.env, PRODUCT_UI_PORT: "8422" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`local demo server did not become ready\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopServer(server).finally(() => reject(error));
    }
    server.on("error", fail);
    server.on("exit", (code, signal) => fail(new Error(`local demo server exited early (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`)));
    server.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (settled || !stdout.includes(`product-ui ${localOrigin}`)) return;
      settled = true;
      clearTimeout(timeout);
      resolve(server);
    });
    server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  });
}

async function run() {
  assertLocalFixture();
  let server;
  let browser;
  try {
    server = await startServer();
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
      reducedMotion: "reduce",
      locale: "ko-KR",
      timezoneId: "Asia/Seoul"
    });
    const page = await context.newPage();
    const errors = [];
    const apiRequests = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (/^\/api(?:\/|$)/.test(url.pathname)) apiRequests.push(url.href);
    });

    await page.goto(target, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("jikmu.workbench.v1");
      localStorage.removeItem("jikmu.ui.v1");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="home-omni"]');

    await page.fill("#omniIn", "올해 정기점검보수 기본계획을 어떻게 수립해야 해?");
    await page.locator('[data-testid="home-omni"]').evaluate((form) => form.requestSubmit());
    await page.waitForSelector('#homeResult [data-testid="grounded-answer"] .badge.grounded');

    const answerText = (await page.locator("#homeResult").innerText()).trim();
    for (const expected of ["작업 항목", "예산", "과거 기록", "관련 부서", "자료관리"]) {
      assert(answerText.includes(expected), `grounded answer missed: ${expected}`);
    }

    const evidence = page.locator('#homeResult [data-ev="PROC-MAINT-31100"]').first();
    assert.equal(await evidence.count(), 1, "maintenance evidence control was not rendered");
    await evidence.click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));

    const drawerText = (await page.locator("#drawerBody").innerText()).trim();
    assert(drawerText.includes("정기점검보수 기본계획 수립 절차"), "drawer missed the maintenance procedure title");
    assert(drawerText.includes("체크리스트"), "drawer missed the structured checklist");
    assert(drawerText.includes("기술정산"), "drawer missed the post-work settlement step");
    assert.deepEqual(apiRequests, [], `fixture mode called live API: ${apiRequests.join(", ")}`);
    assert.deepEqual(errors, [], errors.join("\n"));
    await context.close();
    console.log("Local maintenance demo flow passed");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
