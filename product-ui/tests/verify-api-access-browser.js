"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const workspaceModel = require("../workspace-model.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 9350 + (process.pid % 300);
const baseURL = `http://127.0.0.1:${port}`;
const allowedId = "ACTUAL-CLIENT-ALLOWED";
const deniedId = "ACTUAL-CLIENT-DENIED";
const unknownId = "PROC-MAINT-99999";

function response(route, value, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value)
  });
}

function accessState() {
  const state = workspaceModel.createDemoState();
  const work = state.works.find((item) => item.id === "work-maintenance-plan-2026");
  work.sources = [{
    docId: allowedId,
    category: "memory",
    title: "Persisted allowed source",
    role: "live legacy grant",
    access: "none"
  }, {
    docId: deniedId,
    category: "memory",
    title: "Persisted denied source",
    role: "explicit denial",
    access: "full"
  }, {
    docId: unknownId,
    category: "memory",
    title: "Unknown source",
    role: "not indexed",
    access: "full"
  }];
  work.todos = [{
    id: "todo-denied-access",
    text: "Denied evidence",
    done: false,
    candidate: false,
    evidence: [{ docId: deniedId, label: "Denied evidence" }]
  }, {
    id: "todo-unknown-access",
    text: "Unknown evidence",
    done: false,
    candidate: false,
    evidence: [{ docId: unknownId, label: "Unknown evidence" }]
  }];
  return state;
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
    const timer = setTimeout(() => reject(new Error(`access-browser server timeout\n${stdout}\n${stderr}`)), 5000);
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
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function installRoutes(page, mode, detailRequests) {
  const liveIndex = [
    { id: allowedId, kind: "전자결재", title: "Canonical allowed document", author: "API" },
    { id: deniedId, kind: "감사문서", title: "Canonical denied document", author: "API", access: "none" }
  ];
  const fixtureIndex = liveIndex.map((document) => ({
    ...document,
    access: document.access === "none" ? "none" : "full"
  }));
  const detail = (id) => ({
    doc: {
      id,
      kind: "전자결재",
      title: `${id} detail`,
      author: "API",
      text: id === allowedId ? "ALLOWED ACTUAL CLIENT BODY" : "DENIED OR UNKNOWN SECRET BODY"
    },
    edges: []
  });
  const summary = { docCount: 2, stats: { nodes: 0, edges: 0 } };
  const forecast = { items: [] };
  const briefing = { stages: [], cautions: [] };

  if (mode === "fixture") {
    await page.route("**/fixtures/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/fixtures/manifest.json")) {
        return response(route, { contractVersion: 1, documentIndex: [] });
      }
      if (pathname.endsWith("/fixtures/summary.json")) return response(route, summary);
      if (pathname.endsWith("/fixtures/forecast.json")) return response(route, forecast);
      if (pathname.endsWith("/fixtures/briefing.json")) return response(route, briefing);
      if (pathname.endsWith("/fixtures/documents/index.json")) return response(route, fixtureIndex);
      const detailMatch = /\/fixtures\/documents\/([^/]+)\.json$/.exec(pathname);
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1]);
        detailRequests.push(id);
        return response(route, detail(id));
      }
      return response(route, {}, 404);
    });
    return;
  }

  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/summary") return response(route, summary);
    if (pathname === "/api/forecast") return response(route, forecast);
    if (pathname === "/api/briefing") return response(route, briefing);
    if (pathname === "/api/documents") return response(route, liveIndex);
    const detailMatch = /^\/api\/documents\/([^/]+)$/.exec(pathname);
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1]);
      detailRequests.push(id);
      return response(route, detail(id));
    }
    return response(route, {}, 404);
  });
}

async function verifyMode(browser, mode) {
  const errors = [];
  const detailRequests = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript((state) => {
    localStorage.setItem("jikmu.workbench.v1", JSON.stringify(state));
    localStorage.removeItem("jikmu.ui.v1");
  }, accessState());
  await installRoutes(page, mode, detailRequests);
  await page.goto(`${baseURL}/?data=${mode}#workbench/work-maintenance-plan-2026`, { waitUntil: "networkidle" });
  await page.locator("[data-testid='workbench']").waitFor();

  const allowed = page.locator(`[data-doc-id="${allowedId}"]`);
  assert.equal(await allowed.getAttribute("data-access"), "full",
    `${mode} actual client did not grant a canonical indexed document`);
  await allowed.locator(`[data-ev="${allowedId}"]`).click();
  await page.locator("#drawer:not([hidden])").waitFor();
  await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
  assert((await page.locator("#drawerBody").innerText()).includes("ALLOWED ACTUAL CLIENT BODY"),
    `${mode} actual client did not open an allowed indexed document`);
  await page.locator("#drawerClose").click();

  for (const id of [deniedId, unknownId]) {
    const card = page.locator(`[data-doc-id="${id}"]`);
    assert.equal(await card.getAttribute("data-access"), "none",
      `${mode} actual client did not fail closed for ${id}`);
    assert.equal(await card.locator("[data-ev]").count(), 0,
      `${mode} actual client exposed a viewer action for ${id}`);
    await page.locator(`[data-ev="${id}"]`).first().click();
    await page.locator("#drawer:not([hidden])").waitFor();
    await page.waitForFunction(() => !document.querySelector("#drawerBody")?.textContent.includes("불러오는 중"));
    const drawerText = await page.locator("#drawerBody").innerText();
    assert(drawerText.includes("본문 열람 권한이 없습니다"),
      `${mode} actual client did not deny ${id} at the detail boundary`);
    assert.equal(drawerText.includes("DENIED OR UNKNOWN SECRET BODY"), false,
      `${mode} actual client exposed the body for ${id}`);
    await page.locator("#drawerClose").click();
  }

  assert.deepEqual(detailRequests, [allowedId],
    `${mode} actual client requested denied or unknown document detail`);
  assert.deepEqual(errors, [], `${mode} actual client emitted browser errors`);
  await page.close();
}

(async () => {
  let server;
  let browser;
  try {
    server = await startServer();
    const bundled = chromium.executablePath();
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      || (fs.existsSync(bundled) ? bundled : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const mode of ["fixture", "live", "auto"]) await verifyMode(browser, mode);
    console.log("Actual API-client access browser contract passed in fixture, live, and auto modes");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
