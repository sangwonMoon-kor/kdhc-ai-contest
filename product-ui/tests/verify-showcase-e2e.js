"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const local = !process.env.PRODUCT_UI_URL;
const localOrigin = "http://127.0.0.1:8410";
const target = new URL(process.env.PRODUCT_UI_URL || `${localOrigin}/?data=fixture`);
const mode = target.searchParams.get("data") || "auto";
const browserCandidates = [
  process.env.BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

if (!new Set(["http:", "https:"]).has(target.protocol) || !target.hostname || target.username || target.password) {
  throw new Error("PRODUCT_UI_URL must be an absolute http(s) URL without credentials");
}
if (!new Set(["fixture", "live", "auto"]).has(mode)) throw new Error(`Unsupported data mode: ${mode}`);
if (local && (target.origin !== localOrigin || target.protocol !== "http:")) {
  throw new Error(`Local showcase E2E must own ${localOrigin}; set PRODUCT_UI_URL for another server`);
}
target.hash = "#home";

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
      env: { ...process.env, PRODUCT_UI_PORT: "8410" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const expected = `product-ui ${localOrigin}`;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`product UI server did not claim port 8410\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopServer(server).finally(() => reject(error));
    }
    server.on("error", fail);
    server.on("exit", (code, signal) => fail(new Error(`product UI server exited before ready (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`)));
    server.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (settled || !stdout.includes(expected)) return;
      settled = true;
      clearTimeout(timeout);
      resolve(server);
    });
    server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  });
}

async function verifyCurrentWorktree() {
  const response = await fetch(new URL("/index.html", target));
  assert.equal(response.ok, true, "product UI server did not serve index.html");
  const html = await response.text();
  assert(html.includes('id="dataStatus"') && html.includes('src="api-client.js"') && html.includes('src="app.js"'), "server did not serve the current product UI worktree");
}

function observePage(page, name, errors, apiRequests) {
  page.on("console", (message) => {
    const locationUrl = message.location().url;
    if (message.type() === "error") errors.push(`${name} console: ${message.text()} (${locationUrl})`);
  });
  page.on("pageerror", (error) => errors.push(`${name} pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${name} HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("dialog", (dialog) => dialog.accept());
  if (mode === "fixture") {
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (/^\/api(?:\/|$)/.test(requestUrl.pathname)) apiRequests.push(requestUrl.href);
    });
  }
}

function workIdFromHash(page, route) {
  const match = new URL(page.url()).hash.match(new RegExp(`^#${route}/([^/?#]+)$`));
  if (!match) throw new Error(`expected #${route}/<workId>, received ${new URL(page.url()).hash}`);
  return decodeURIComponent(match[1]);
}

function assertRouteWorkId(page, route, workId) {
  const actual = workIdFromHash(page, route);
  assert.equal(actual, workId, `${route} route changed work identity`);
}

async function assertDataStatus(page) {
  const status = (await page.textContent("#dataStatus")).trim();
  if (mode === "fixture") assert.equal(status, "시연용 샘플 데이터");
  else if (mode === "live") assert.equal(status, "실제 엔진 연결");
  else assert(["시연용 샘플 데이터", "실제 엔진 연결"].includes(status), `auto data status was not truthful: ${status}`);
  return status;
}

async function waitForStableUi(page) {
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  const toast = page.locator("#toast");
  if (!(await toast.getAttribute("hidden"))) {
    await page.locator("#tClose").click();
    await toast.waitFor({ state: "hidden" });
  }
  await page.waitForFunction(() => document.fonts.status === "loaded" && document.querySelector("#toast")?.hidden);
  await wait(50);
}

async function run() {
  let server;
  let browser;
  try {
    if (local) server = await startServer();
    await verifyCurrentWorktree();
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const errors = [];
    const apiRequests = [];
    const desktop = await browser.newContext({
      viewport: { width: 1920, height: 1080 }, colorScheme: "light", reducedMotion: "reduce", locale: "ko-KR", timezoneId: "Asia/Seoul"
    });
    const page = await desktop.newPage();
    observePage(page, "desktop", errors, apiRequests);

    await page.goto(target.href, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("jikmu.workbench.v1");
      localStorage.removeItem("jikmu.ui.v1");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="home-omni"]');
    await page.fill("#omniIn", "팀장님이 다음 주까지 펌프 정비계획 올리래");
    await page.locator('[data-testid="home-omni"]').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => location.hash.startsWith("#workbench/"));
    await page.waitForSelector('[data-testid="workbench"]');
    const workId = workIdFromHash(page, "workbench");
    if (!(await page.textContent("main")).includes("순환수 펌프")) throw new Error("pump workbench did not open");

    await page.fill("#wbIn", "운영부 일정은 5월 둘째 주로 확정");
    await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("main")?.textContent.includes("운영부 일정은 5월 둘째 주로 확정"));
    assertRouteWorkId(page, "workbench", workId);

    await page.fill("#wbIn", "작년 펌프 정비 추진 보고 찾아줘");
    await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
    await page.waitForSelector('[data-testid="grounded-answer"] .badge.grounded');
    assertRouteWorkId(page, "workbench", workId);
    if (!(await page.textContent("#wbResult")).includes("관련 문서")) throw new Error("grounded documents missing");
    const evidence = page.locator("#wbResult [data-ev]").first();
    assert.equal(await evidence.getAttribute("data-ev"), "okf:case-01-circulation-pump-estimate-audit", "first pump-answer evidence changed");
    await evidence.click();
    await page.waitForSelector("#drawer:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    const drawerText = (await page.textContent("#drawerBody")).trim();
    assert(drawerText, "evidence drawer detail was empty");
    assert(drawerText.includes("순환수 펌프 정비공사 설계내역 및 감사 대응 사례"), "pump evidence drawer showed unexpected fixture detail");
    await page.click("#drawerClose");

    await page.click("#goDraft");
    await page.waitForFunction(() => location.hash.startsWith("#draft/"));
    assertRouteWorkId(page, "draft", workId);
    const draft = page.locator('[data-testid="draft-document"]');
    await draft.waitFor();
    const activeStatus = await assertDataStatus(page);
    if (activeStatus === "실제 엔진 연결") {
      const draftText = (await draft.innerText()).trim();
      assert(draftText.includes("2026년 순환수 펌프 정비공사 추진 보고(안)"), "live draft missed the current generated title");
      assert(draftText.includes("2025년 순환수 펌프 정비공사 추진 보고"), "live draft missed its current-basis title");
      assert.equal(await draft.locator("[data-ev]").first().getAttribute("data-ev"), "APPR-2025-0409", "live draft lacked its current-basis evidence control");
    }
    await page.click("#dCheck");
    const precheck = page.locator('[data-testid="precheck-results"]');
    await precheck.locator(".f-item").first().waitFor();
    const findings = precheck.locator(".f-item");
    const precheckText = (await precheck.innerText()).trim();
    assert(precheckText && !/불러오지 못했습니다|연결을 확인해 주세요|점검에 실패|엔진 연결 오류/.test(precheckText), `precheck rendered an error: ${precheckText}`);
    if (activeStatus === "시연용 샘플 데이터") {
      assert.equal(await findings.count(), 5, "precheck did not render all five risky fixture findings");
      assert(precheckText.includes("구두 지시") && precheckText.includes("산출근거"), "precheck missed required meaningful fixture risks");
      assert((await precheck.locator("[data-ev]").count()) > 0, "fixture precheck findings lacked evidence controls");
    } else {
      assert.equal(await findings.count(), 1, "live precheck did not render the current single leftover finding");
      assert(precheckText.includes("초안 미완성 항목 잔존"), "live precheck missed the expected leftover finding");
    }
    await waitForStableUi(page);

    fs.mkdirSync(path.resolve(__dirname, "..", "screenshots"), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, "..", "screenshots", "showcase-golden.png"), fullPage: true });

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 }, colorScheme: "light", reducedMotion: "reduce", locale: "ko-KR", timezoneId: "Asia/Seoul"
    });
    const mobile = await mobileContext.newPage();
    observePage(mobile, "mobile", errors, apiRequests);
    await mobile.goto(target.href, { waitUntil: "networkidle" });
    await mobile.waitForSelector('[data-testid="home-omni"]');
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("390px horizontal overflow");

    if (mode === "fixture") assert.deepEqual(apiRequests, [], `fixture mode requested API routes: ${apiRequests.join(" | ")}`);
    assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
    console.log(`Showcase E2E passed (active data: ${activeStatus}; fixture API requests: ${mode === "fixture" ? apiRequests.length : "n/a"})`);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
