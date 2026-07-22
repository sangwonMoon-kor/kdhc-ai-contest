"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 8600 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const useTestClient = process.env.PRODUCT_UI_TEST_CLIENT === "1";

const testClient = String.raw`
(function () {
  const pending = [];
  let onStatus = function () {};
  let status = null;
  const summary = {
    versionLabel: "test-v1",
    simDate: "2026-01-02",
    docCount: 19,
    stats: { nodes: 193, edges: 938 },
    persona: { name: "테스트" }
  };
  const fixtures = {
    "/api/summary": summary,
    "/api/forecast": { items: [] },
    "/api/briefing": { stages: [], cautions: [] },
    "/api/documents": []
  };
  function publish(next) {
    status = Object.assign({}, status, next);
    onStatus(status);
  }
  function take(question) {
    const index = pending.findIndex(function (item) { return item.question === question; });
    if (index < 0) throw new Error("pending question not found: " + question);
    return pending.splice(index, 1)[0];
  }
  window.JikmuApi = {
    modeFromSearch: function (search) {
      return new URLSearchParams(search).get("data") || "auto";
    },
    createApiClient: function (options) {
      const mode = options.mode;
      onStatus = options.onStatus;
      status = mode === "fixture"
        ? { requestedMode: mode, activeMode: "fixture", source: "fixture", error: null }
        : { requestedMode: mode, activeMode: "live", source: "live", error: null };
      onStatus(status);
      return {
        request: function (apiPath, body) {
          if (apiPath === "/api/ask") {
            return new Promise(function (resolve, reject) {
              pending.push({ question: body.question, resolve: resolve, reject: reject });
            });
          }
          if (Object.prototype.hasOwnProperty.call(fixtures, apiPath)) return Promise.resolve(fixtures[apiPath]);
          return Promise.resolve({});
        },
        getStatus: function () { return Object.assign({}, status); }
      };
    }
  };
  window.__appBoundaryTest = {
    status: function (next) { publish(next); },
    pending: function () { return pending.map(function (item) { return item.question; }); },
    resolveAsk: function (question, answer) {
      take(question).resolve({ grounded: true, answer: [answer], docs: [] });
    },
    rejectAsk: function (question, message) {
      take(question).reject(new Error(message));
    }
  };
})();
`;

function startServer() {
  return new Promise(function (resolve, reject) {
    const server = spawn(process.execPath, ["tools/serve-product-ui.js"], {
      cwd: repoRoot,
      env: Object.assign({}, process.env, { PRODUCT_UI_PORT: String(port) }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const expected = `product-ui http://127.0.0.1:${port}`;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(function () {
      fail(new Error(`product-ui server did not claim port ${port}\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 5000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (server.exitCode === null) server.kill("SIGTERM");
      reject(error);
    }
    server.on("error", fail);
    server.on("exit", function (code, signal) {
      fail(new Error(`product-ui server exited before ready (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    server.stdout.on("data", function (chunk) {
      stdout += String(chunk);
      if (settled || !stdout.includes(expected)) return;
      settled = true;
      clearTimeout(timeout);
      resolve(server);
    });
    server.stderr.on("data", function (chunk) { stderr += String(chunk); });
  });
}

async function verifyServer(server) {
  assert.equal(server.exitCode, null, "spawned product-ui server exited before verification");
  const response = await fetch(`${base}/index.html`);
  assert.equal(response.ok, true, "spawned product-ui server did not serve index.html");
  const html = await response.text();
  assert(html.includes('id="dataStatus"') && html.includes('src="api-client.js"'), "spawned server did not serve the current product-ui worktree");
  const malformedStatus = await new Promise(function (resolve, reject) {
    const request = http.get({ host: "127.0.0.1", port: port, path: "/%E0%A4%A" }, function (rawResponse) {
      rawResponse.resume();
      rawResponse.on("end", function () { resolve(rawResponse.statusCode); });
    });
    request.on("error", reject);
  });
  assert.equal(malformedStatus, 400, "malformed percent path did not return 400");
  assert.equal(server.exitCode, null, "malformed percent path terminated the product-ui server");
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise(function (resolve) {
    const forceTimer = setTimeout(function () { server.kill("SIGKILL"); }, 1000);
    server.once("exit", function () {
      clearTimeout(forceTimer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function launchBrowser() {
  const bundled = chromium.executablePath();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled : undefined);
  return chromium.launch(Object.assign({ headless: true }, executablePath ? { executablePath: executablePath } : {}));
}

async function openApp(browser, mode, errors) {
  const page = await browser.newPage();
  page.on("pageerror", function (error) { errors.push(`pageerror: ${error.message}`); });
  page.on("console", function (message) {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  if (useTestClient) {
    await page.route("**/api-client.js", function (route) {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: testClient });
    });
  }
  await page.goto(`${base}/?data=${mode}#home`, { waitUntil: "networkidle" });
  await page.locator("#omniIn").waitFor();
  return page;
}

async function assertStatus(page, text, className) {
  const status = page.locator("#dataStatus");
  assert.equal(await status.textContent(), text);
  assert.equal(await status.evaluate(function (element, expected) { return element.classList.contains(expected); }, className), true);
  if (new URL(page.url()).hash === "#home") {
    const homeStatus = page.locator("#homeDataStatus");
    assert.equal(await homeStatus.count(), 1, "home does not render a data-mode status");
    assert.equal(await homeStatus.isVisible(), true, "home data-mode status is hidden");
    assert.equal(await homeStatus.textContent(), text);
    assert.equal(await homeStatus.evaluate(function (element, expected) { return element.classList.contains(expected); }, className), true);
  }
}

async function ask(page, question) {
  await page.locator("#omniIn").fill(question);
  await page.locator("#omni").press("Enter");
  await page.waitForFunction(function (asked) {
    return window.__appBoundaryTest.pending().includes(asked);
  }, question);
}

async function settleAsk(page, method, question, value) {
  await page.evaluate(function (args) {
    window.__appBoundaryTest[args.method](args.question, args.value);
  }, { method: method, question: question, value: value });
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    await verifyServer(server);
    browser = await launchBrowser();

    const redPage = await openApp(browser, "fixture", []);
    assert.equal(await redPage.evaluate(function () { return Boolean(window.__appBoundaryTest); }), true, "controlled app-boundary client was not installed");
    await redPage.close();

    const errors = [];
    const fixturePage = await openApp(browser, "fixture", errors);
    await assertStatus(fixturePage, "시연용 샘플 데이터", "fixture");
    await fixturePage.locator('.home-rail a[href="#work/list"]').click();
    await fixturePage.getByRole("heading", { name: "내 업무" }).waitFor();
    await assertStatus(fixturePage, "시연용 샘플 데이터", "fixture");
    await fixturePage.close();

    const livePage = await openApp(browser, "live", errors);
    await livePage.evaluate(function () {
      window.__appBoundaryTest.status({ requestedMode: "live", activeMode: "live", source: "live", error: "live failure" });
    });
    await assertStatus(livePage, "엔진 연결 오류", "error");
    await livePage.close();

    const autoPage = await openApp(browser, "auto", errors);
    await autoPage.evaluate(function () {
      window.__appBoundaryTest.status({ requestedMode: "auto", activeMode: "auto", source: "live", error: "auto live failure" });
    });
    await assertStatus(autoPage, "엔진 연결 오류", "error");
    await autoPage.evaluate(function () {
      window.__appBoundaryTest.status({ requestedMode: "auto", activeMode: "fixture", source: "fixture", error: null });
    });
    await assertStatus(autoPage, "시연용 샘플 데이터", "fixture");
    await autoPage.close();

    const askPage = await openApp(browser, "fixture", errors);
    const oldSuccess = "첫 번째 근거 찾아줘";
    const newSuccess = "두 번째 근거 찾아줘";
    await ask(askPage, oldSuccess);
    await ask(askPage, newSuccess);
    await settleAsk(askPage, "resolveAsk", newSuccess, "새 답변");
    await askPage.getByText("새 답변").waitFor();
    await settleAsk(askPage, "resolveAsk", oldSuccess, "오래된 답변");
    await askPage.waitForTimeout(20);
    assert.equal(await askPage.locator("#homeResult").innerText().then(function (text) { return text.includes("오래된 답변"); }), false, "older success overwrote newer answer");

    const oldFailure = "세 번째 근거 찾아줘";
    const newAfterFailure = "네 번째 근거 찾아줘";
    await ask(askPage, oldFailure);
    await ask(askPage, newAfterFailure);
    await settleAsk(askPage, "resolveAsk", newAfterFailure, "최신 답변");
    await askPage.getByText("최신 답변").waitFor();
    await settleAsk(askPage, "rejectAsk", oldFailure, "old request failed");
    await askPage.waitForTimeout(20);
    assert.equal(await askPage.locator("#homeResult").innerText().then(function (text) { return text.includes("답변을 가져오지 못했습니다"); }), false, "older rejection overwrote newer answer");

    const detachedSuccess = "다섯 번째 근거 찾아줘";
    await ask(askPage, detachedSuccess);
    const detachedSuccessBefore = await askPage.evaluate(function () {
      const box = document.getElementById("homeResult");
      window.__detachedSuccessBox = box;
      return box.innerHTML;
    });
    await askPage.evaluate(function () { location.hash = "#work/list"; });
    await askPage.locator("#omniIn").waitFor({ state: "detached" });
    await settleAsk(askPage, "resolveAsk", detachedSuccess, "분리된 성공");
    await askPage.waitForTimeout(20);
    assert.equal(await askPage.locator("#homeResult").count(), 0, "detached success rendered a home answer");
    const detachedSuccessAfter = await askPage.evaluate(function () {
      return { connected: window.__detachedSuccessBox.isConnected, html: window.__detachedSuccessBox.innerHTML };
    });
    assert.equal(detachedSuccessAfter.connected, false, "success answer box remained connected after navigation");
    assert.equal(detachedSuccessAfter.html, detachedSuccessBefore, "success mutated the disconnected answer box");

    await askPage.evaluate(function () { location.hash = "#home"; });
    await askPage.locator("#omniIn").waitFor();
    const detachedFailure = "여섯 번째 근거 찾아줘";
    await ask(askPage, detachedFailure);
    const detachedFailureBefore = await askPage.evaluate(function () {
      const box = document.getElementById("homeResult");
      window.__detachedFailureBox = box;
      return box.innerHTML;
    });
    await askPage.evaluate(function () { location.hash = "#work/list"; });
    await askPage.locator("#omniIn").waitFor({ state: "detached" });
    await settleAsk(askPage, "rejectAsk", detachedFailure, "detached request failed");
    await askPage.waitForTimeout(20);
    assert.equal(await askPage.locator("#homeResult").count(), 0, "detached rejection rendered a home error");
    const detachedFailureAfter = await askPage.evaluate(function () {
      return { connected: window.__detachedFailureBox.isConnected, html: window.__detachedFailureBox.innerHTML };
    });
    assert.equal(detachedFailureAfter.connected, false, "failure answer box remained connected after navigation");
    assert.equal(detachedFailureAfter.html, detachedFailureBefore, "rejection mutated the disconnected answer box");
    await askPage.close();

    const malformedRoutePage = await openApp(browser, "fixture", errors);
    await malformedRoutePage.evaluate(function () { location.hash = "#draft/%E0%A4%A"; });
    await malformedRoutePage.getByRole("heading", { name: "화면을 찾을 수 없습니다" }).waitFor();
    await malformedRoutePage.close();

    assert.deepEqual(errors, [], "SPA emitted console/page errors during stale-response handling");
    console.log("App data-mode browser contract passed");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
