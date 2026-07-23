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
  const requests = [];
  const webSaves = [];
  let rejectNextWebSave = false;
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
          requests.push(apiPath);
          if (apiPath === "/api/ask") {
            return new Promise(function (resolve, reject) {
              pending.push({ question: body.question, resolve: resolve, reject: reject });
            });
          }
          if (apiPath === "/api/ingest/web") {
            webSaves.push(JSON.parse(JSON.stringify(body)));
            if (rejectNextWebSave) {
              rejectNextWebSave = false;
              return Promise.reject(new Error("web save failed"));
            }
            return Promise.resolve({ added: 2, tier: "웹출처" });
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
    resolveGroundedAsk: function (question, answer, evidence) {
      take(question).resolve({
        grounded: true,
        answer: [answer],
        docs: [],
        knowledge: [{
          text: "저장된 웹 근거를 사용한 답변",
          status: "웹출처",
          confidence: 0.5,
          evidence: evidence
        }]
      });
    },
    resolveWebAsk: function (question, answer, evidence, results) {
      take(question).resolve({
        grounded: false,
        answer: [],
        docs: [],
        web: { used: true, composed: { answer: answer, evidence: evidence }, results: results }
      });
    },
    rejectAsk: function (question, message) {
      take(question).reject(new Error(message));
    },
    requests: function () { return requests.slice(); },
    webSaves: function () { return JSON.parse(JSON.stringify(webSaves)); },
    rejectNextWebSave: function () { rejectNextWebSave = true; }
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

async function assertWorkbenchRoute(browser, mode, errors) {
  const page = await openApp(browser, mode, errors);
  await page.evaluate(function () {
    location.hash = "#workbench/work-maintenance-plan-2026";
  });
  const workbench = page.locator('[data-testid="workbench"][data-work-id="work-maintenance-plan-2026"]');
  await workbench.waitFor();
  assert.deepStrictEqual(await workbench.locator("[data-workbench-section]").evaluateAll(function (sections) {
    return sections.map(function (section) { return section.getAttribute("data-workbench-section"); });
  }), ["headline", "progress", "official", "memory", "output", "completion"],
  `${mode} data mode did not open the workbench route`);
  await page.close();
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
    await fixturePage.locator('.app-sidebar a[href="#work/list"]').click();
    await fixturePage.getByRole("heading", { name: "내 업무" }).waitFor();
    await assertStatus(fixturePage, "시연용 샘플 데이터", "fixture");
    await fixturePage.close();
    for (const mode of ["fixture", "live", "auto"]) {
      await assertWorkbenchRoute(browser, mode, errors);
    }

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

    const webQuestion = "웹에서 절연저항 기준 찾아줘";
    const webResults = [
      { title: "안전한 출처", url: "https://example.com/safe", snippet: "안전한 웹 근거" },
      { title: "위험한 출처", url: "javascript:alert(1)", snippet: "위험한 웹 근거" }
    ];
    await ask(askPage, webQuestion);
    await askPage.evaluate(function (args) {
      window.__appBoundaryTest.resolveWebAsk(
        args.question,
        "웹 합성 답변입니다 [W1].",
        [
          { tag: "웹", title: "안전한 출처", text: "안전한 웹 근거", url: "https://example.com/safe" },
          { tag: "웹", title: "위험한 출처", text: "위험한 웹 근거", url: "javascript:alert(1)" }
        ],
        args.results
      );
    }, { question: webQuestion, results: webResults });
    const webPanel = askPage.locator('[data-testid="web-reference"]');
    await webPanel.waitFor();
    assert.equal(await webPanel.getByText("웹 참고", { exact: true }).count(), 1, "web answer is not clearly labeled");
    assert.equal(await webPanel.getByText("미검증 · 사업소 실무 아님", { exact: true }).count(), 1, "web answer lacks its verification warning");
    assert.equal(await webPanel.getByText("웹 합성 답변입니다 [W1].", { exact: true }).count(), 1, "composed web answer was not rendered");
    assert.equal(await webPanel.locator('a[href="https://example.com/safe"]').count(), 1, "safe web evidence URL was not linked");
    assert.equal(await webPanel.locator('a[href^="javascript:"]').count(), 0, "unsafe web evidence URL was rendered as a link");

    const saveButton = webPanel.getByRole("button", { name: "OKF에 저장(웹출처)" });
    await saveButton.click();
    await webPanel.getByText("웹출처 2건을 OKF에 저장했습니다.", { exact: true }).waitFor();
    assert.deepStrictEqual(await askPage.evaluate(function () { return window.__appBoundaryTest.webSaves(); }), [{
      question: webQuestion,
      results: webResults
    }], "web save request did not preserve the exact question and search results");

    const persistedWebQuestion = "저장된 웹 근거 찾아줘";
    await ask(askPage, persistedWebQuestion);
    await askPage.evaluate(function (question) {
      window.__appBoundaryTest.resolveGroundedAsk(question, "저장된 웹 근거 답변입니다.", [
        { docId: "web:https://example.com/persisted", label: "저장된 안전한 출처", text: "저장된 안전한 웹 근거", web: true, url: "https://example.com/persisted" },
        { docId: "web:javascript:alert(1)", label: "저장된 위험한 출처", text: "저장된 위험한 웹 근거", web: true, url: "javascript:alert(1)" }
      ]);
    }, persistedWebQuestion);
    const persistedPanel = askPage.locator('[data-testid="grounded-answer"]');
    await persistedPanel.getByText("저장된 웹 근거 답변입니다.", { exact: true }).waitFor();
    const safePersistedEvidence = persistedPanel.locator('a.ev-btn[href="https://example.com/persisted"]');
    assert.equal(await safePersistedEvidence.count(), 1, "persisted safe web evidence was not rendered as an external link");
    assert.equal(await safePersistedEvidence.getAttribute("target"), "_blank", "persisted web evidence link does not open externally");
    assert.equal(await safePersistedEvidence.getAttribute("rel"), "noopener noreferrer", "persisted web evidence link lacks opener isolation");
    assert.equal((await safePersistedEvidence.innerText()).includes("웹출처 · 미검증"), true, "persisted web evidence lacks its web/unverified label");

    const unsafePersistedEvidence = persistedPanel.locator(".ev-btn").filter({ hasText: "저장된 위험한 출처" });
    assert.equal(await unsafePersistedEvidence.count(), 1, "persisted unsafe web evidence lost its visible label");
    assert.equal(await unsafePersistedEvidence.evaluate(function (element) { return element.tagName; }), "SPAN", "persisted unsafe web evidence is interactive");
    assert.equal((await unsafePersistedEvidence.innerText()).includes("웹출처 · 미검증"), true, "persisted unsafe web evidence lacks its web/unverified label");
    assert.equal(await unsafePersistedEvidence.locator("a").count(), 0, "persisted unsafe web evidence was rendered as an anchor");
    assert.equal(await unsafePersistedEvidence.getAttribute("data-ev"), null, "persisted unsafe web evidence was wired as a document reference");
    const documentRequestsBeforeUnsafeClick = await askPage.evaluate(function () {
      return window.__appBoundaryTest.requests().filter(function (apiPath) { return apiPath.startsWith("/api/documents/"); }).length;
    });
    await unsafePersistedEvidence.click();
    await askPage.waitForTimeout(20);
    assert.equal(await askPage.locator("#drawer").getAttribute("hidden"), "", "persisted unsafe web evidence opened the document drawer");
    assert.equal(await askPage.evaluate(function () {
      return window.__appBoundaryTest.requests().filter(function (apiPath) { return apiPath.startsWith("/api/documents/"); }).length;
    }), documentRequestsBeforeUnsafeClick, "persisted unsafe web evidence requested a document");

    const failedWebQuestion = "웹에서 저장 실패 근거 찾아줘";
    await ask(askPage, failedWebQuestion);
    await askPage.evaluate(function (args) {
      window.__appBoundaryTest.resolveWebAsk(args.question, "실패 확인 답변 [W1].", [{
        tag: "웹", title: "안전한 출처", text: "안전한 웹 근거", url: "https://example.com/safe"
      }], args.results);
      window.__appBoundaryTest.rejectNextWebSave();
    }, { question: failedWebQuestion, results: webResults.slice(0, 1) });
    const failedWebPanel = askPage.locator('[data-testid="web-reference"]');
    await failedWebPanel.getByRole("button", { name: "OKF에 저장(웹출처)" }).click();
    await failedWebPanel.getByText("웹출처를 저장하지 못했습니다. 다시 시도해 주세요.", { exact: true }).waitFor();

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
