"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 8800 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;
const scannedPdf = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`, "latin1");
const extractFailureReason = "LLM 미연결 — 스캔 PDF를 텍스트로 저장하거나 내용을 붙여넣어 주세요.";

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["tools/serve-product-ui.js"], {
      cwd: repoRoot,
      env: { ...process.env, PRODUCT_UI_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const expected = `product-ui ${base}`;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`fixture-flow server did not start\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (server.exitCode === null) server.kill("SIGTERM");
      reject(error);
    }
    server.on("error", fail);
    server.on("exit", (code, signal) => fail(new Error(`fixture-flow server exited early (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`)));
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

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const force = setTimeout(() => server.kill("SIGKILL"), 1000);
    server.once("exit", () => { clearTimeout(force); resolve(); });
    server.kill("SIGTERM");
  });
}

async function settlePanel(page, selector, loadingText) {
  await page.waitForFunction(({ selector, loadingText }) => {
    const element = document.querySelector(selector);
    return element && !element.textContent.includes(loadingText);
  }, { selector, loadingText });
}

async function run() {
  let server;
  let browser;
  try {
    server = await startServer();
    const candidates = [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      chromium.executablePath(),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ].filter(Boolean);
    const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", locale: "ko-KR" });
    const errors = [];
    const apiRequests = [];
    const fixtureBodyRequests = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("response", (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (/^\/api(?:\/|$)/.test(url.pathname)) apiRequests.push(url.href);
      if (url.pathname.includes("/fixtures/") && (request.method() !== "GET" || request.postData() !== null)) {
        fixtureBodyRequests.push(`${request.method()} ${url.pathname}`);
      }
    });

    await page.goto(`${base}/?data=fixture#home`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("jikmu.workbench.v1");
      localStorage.removeItem("jikmu.ui.v1");
    });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await page.locator("#dataStatus").innerText()).trim(), "시연용 샘플 데이터");

    await page.evaluate(() => { location.hash = "#graph"; });
    await page.getByRole("heading", { name: "업무 지식 지도" }).waitFor();
    await settlePanel(page, "#gOut", "불러오는 중");
    const graphText = (await page.locator("#gOut").innerText()).trim();
    assert(!graphText.includes("불러오지 못했습니다"), "fixture graph route rendered an error");
    assert(graphText.includes("전체 지식 193개") && graphText.includes("관계 938건"), "fixture graph counts diverged from the captured engine graph");
    await page.locator("#gq").fill("펌프");
    assert((await page.locator("#gOut").innerText()).includes("순환수 펌프"), "fixture graph search did not render captured pump knowledge");

    await page.evaluate(() => { location.hash = "#draft/w-problem-recognition-m1"; });
    await page.getByRole("heading", { name: /기안 집중/ }).waitFor();
    await settlePanel(page, "#draftBody", "불러오는 중");
    const nonDesignDraft = page.locator('[data-testid="draft-document"]');
    assert.equal(await nonDesignDraft.count(), 1, "problem-recognition fixture draft rendered an error");
    const nonDesignText = (await nonDesignDraft.innerText()).trim();
    assert(nonDesignText.includes("2026년 동절기 옥외 설비 동파 방지 점검 결과 보고(안)"), "problem-recognition fixture draft title mismatch");
    assert.equal(await nonDesignDraft.locator("[data-ev]").first().getAttribute("data-ev"), "APPR-2025-0106", "problem-recognition draft evidence mismatch");

    await page.evaluate(() => { location.hash = "#workbench/w-design-and-costing-m4"; });
    await page.locator('[data-testid="workbench"]').waitFor();
    await page.locator("#wbIn").fill("운영부 일정은 5월 둘째 주로 확정");
    await page.locator("#wbOmni").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("#recList")?.textContent.includes("운영부 일정은 5월 둘째 주로 확정"));
    await page.locator("[data-hint]").first().click();
    await settlePanel(page, "#hintFlow", "구조화하는 중");
    assert.equal(await page.locator("#hintCommit").count(), 1, "fixture hint staging did not produce a candidate");
    await page.locator("#hintCommit").click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("다음 담당자 브리핑에 반영"));
    await page.waitForFunction(() => document.querySelector("#recList")?.textContent.includes("다음 담당자 메모로 남김"));

    await page.locator("#fileIn").setInputFiles({ name: "fixture-scan.pdf", mimeType: "application/pdf", buffer: scannedPdf });
    await page.locator("#ingestPanel [data-tr]").first().waitFor();
    assert((await page.locator("#ingestPanel [data-tr]").count()) > 0, "fixture scanned-PDF extraction did not reach ingest staging");

    await page.route("**/fixtures/extract/scanned-pdf.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, reason: extractFailureReason })
    }));
    await page.locator("#fileIn").setInputFiles({ name: "unavailable-scan.pdf", mimeType: "application/pdf", buffer: scannedPdf });
    await settlePanel(page, "#ingestPanel", "문서를 읽는 중");
    const extractFailureText = (await page.locator("#ingestPanel").innerText()).trim();
    assert(extractFailureText.includes(extractFailureReason), "scanned-PDF extraction failure did not show the server reason");
    assert(!extractFailureText.includes("추출된 내용이 너무 짧습니다."), "scanned-PDF extraction failure fell through to the generic short-text error");
    await page.unroute("**/fixtures/extract/scanned-pdf.json");

    await page.route("**/fixtures/extract/scanned-pdf.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, text: "", model: "fixture" })
    }));
    await page.locator("#fileIn").setInputFiles({ name: "malformed-scan.pdf", mimeType: "application/pdf", buffer: scannedPdf });
    await settlePanel(page, "#ingestPanel", "문서를 읽는 중");
    assert((await page.locator("#ingestPanel").innerText()).includes("스캔 PDF 텍스트 추출 응답이 올바르지 않습니다."), "malformed scanned-PDF success response was not rejected explicitly");
    await page.unroute("**/fixtures/extract/scanned-pdf.json");

    await page.locator("#pasteIn").fill("2026년 순환수 펌프 정비 계획 보고\n운영부와 정비 일정을 확인하고 설계내역서 산출근거를 첨부한다.");
    await page.locator("#ingestBtn").click();
    await settlePanel(page, "#ingestPanel", "후보를 만드는 중");
    assert((await page.locator("#ingestPanel [data-tr]").count()) > 0, "fixture ingest staging did not produce reviewable triples");
    await page.locator("#ingCommit").click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("자료를 이 업무의 근거로 저장"));
    const ingestedReference = page.locator('[data-doc-id="DOC-FIXTURE-001"]');
    await ingestedReference.waitFor();
    assert.equal(await ingestedReference.getAttribute("data-access"), "full",
      "ingested fixture document was not added to the canonical access index");
    await ingestedReference.locator('[data-ev="DOC-FIXTURE-001"]').click();
    await page.locator("#drawer:not([hidden])").waitFor();
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    const ingestedDrawerText = (await page.locator("#drawerBody").innerText()).trim();
    assert(ingestedDrawerText.includes("2026년 순환수 펌프 정비 계획 보고"),
      "ingested fixture evidence did not open its routed detail");
    assert(ingestedDrawerText.includes("운영부와 정비 일정을 확인"),
      "ingested fixture evidence drawer omitted its document body");
    await page.locator("#drawerClose").click();

    assert.deepEqual(apiRequests, [], `fixture flows requested live API routes: ${apiRequests.join(" | ")}`);
    assert.deepEqual(fixtureBodyRequests, [], `fixture flows sent action bodies to fixture files: ${fixtureBodyRequests.join(" | ")}`);
    assert.deepEqual(errors, [], `fixture flows emitted browser errors: ${errors.join(" | ")}`);
    console.log("Fixture reachable-flow E2E passed (graph, non-design draft, hint, scanned-PDF extract, ingest)");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
