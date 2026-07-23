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
const captureCalendarFixture = {
  personalSchedule: {
    id: "personal-long-label",
    title: "2026년 정기점검보수 개인 검토 일정",
    startISO: "2026-01-06",
    endISO: "2026-01-06",
    status: "active"
  },
  scheduleCandidate: {
    id: "single-day-candidate-long-label",
    kind: "date",
    label: "2026년 정기점검보수 확인 필요 일정",
    startISO: "2026-01-06",
    endISO: "2026-01-06",
    confirmed: false
  }
};

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
  await page.evaluate((fixture) => {
    const storageKey = "jikmu.workbench.v1";
    const state = JSON.parse(localStorage.getItem(storageKey));
    const work = state && Array.isArray(state.works)
      ? state.works.find((item) => item.id === state.selectedWorkId) || state.works[0]
      : null;
    if (!state || !work) throw new Error("home capture could not resolve a valid workspace state");
    state.personalSchedules = (state.personalSchedules || [])
      .filter((item) => item.id !== fixture.personalSchedule.id);
    state.personalSchedules.push(Object.assign({}, fixture.personalSchedule, { ownerId: state.currentPersonId }));
    work.scheduleCandidates = (work.scheduleCandidates || [])
      .filter((item) => item.id !== fixture.scheduleCandidate.id);
    work.scheduleCandidates.push(fixture.scheduleCandidate);
    state.works.filter((item) => item.seedKey).forEach((item) => { item.repeat = false; });
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, captureCalendarFixture);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid="home-omni"]').waitFor();
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  const status = (await page.locator("#dataStatus").innerText()).trim();
  assert.equal(status, "시연용 샘플 데이터", "fixture capture data-mode label is not truthful");
  assert.equal(await page.locator("[data-calendar-date]").count(), 14, "home capture did not render 14 dates");
  assert.equal(await page.locator('[data-event-id="personal-long-label"]').count(), 1,
    "home capture is missing the long personal schedule");
  const candidate = page.locator('[data-event-id="single-day-candidate-long-label"]');
  assert.equal(await candidate.count(), 1, "home capture is missing the long confirmation-needed candidate");
  const candidateStatus = candidate.locator(".home-event-status");
  assert.equal(await candidateStatus.count(), 1, "home capture candidate must render exactly one visible status");
  assert.equal((await candidateStatus.innerText()).trim(), "후보 · 미확인",
    "home capture candidate visible status text changed");
  if (viewport.width === 390) {
    const longEventLayout = await page.evaluate(() => {
      return ["personal-long-label", "single-day-candidate-long-label"].map((eventId) => {
        const chip = document.querySelector(`[data-event-id="${eventId}"]`);
        const label = chip && chip.querySelector(".home-event-text");
        const status = chip && chip.querySelector(".home-event-status");
        const chipRect = chip && chip.getBoundingClientRect();
        const labelRect = label && label.getBoundingClientRect();
        const statusRect = status && status.getBoundingClientRect();
        const contained = (rect) => Boolean(rect && chipRect && rect.left >= chipRect.left && rect.right <= chipRect.right
          && rect.top >= chipRect.top && rect.bottom <= chipRect.bottom);
        return {
          eventId,
          label: label && label.textContent.trim(),
          status: status && status.textContent.trim(),
          labelClipped: Boolean(label && (label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight)),
          labelContained: contained(labelRect),
          statusClipped: Boolean(status && (status.scrollWidth > status.clientWidth || status.scrollHeight > status.clientHeight)),
          statusContained: !status || contained(statusRect)
        };
      });
    });
    const personal = longEventLayout.find((event) => event.eventId === "personal-long-label");
    const candidateLayout = longEventLayout.find((event) => event.eventId === "single-day-candidate-long-label");
    assert.equal(personal.label, "2026년 정기점검보수 개인 검토 일정", "390px home capture personal long label changed or is missing");
    assert.equal(candidateLayout.label, "2026년 정기점검보수 확인 필요 일정", "390px home capture candidate long label changed or is missing");
    assert.equal(candidateLayout.status, "후보 · 미확인", "390px home capture candidate status changed or is missing");
    for (const event of longEventLayout) {
      assert.equal(event.labelClipped, false, `${event.eventId} label overflows its 390px home capture chip`);
      assert.equal(event.labelContained, true, `${event.eventId} label escapes its 390px home capture chip`);
      assert.equal(event.statusClipped, false, `${event.eventId} status overflows its 390px home capture chip`);
      assert.equal(event.statusContained, true, `${event.eventId} status escapes its 390px home capture chip`);
    }
  }
  if (viewport.width === 1920) {
    const calendarOverflow = await page.locator(".home-calendar-scroll").evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
    assert(calendarOverflow.scrollHeight <= calendarOverflow.clientHeight,
      `desktop home capture clips calendar evidence vertically: ${calendarOverflow.scrollHeight} > ${calendarOverflow.clientHeight}`);
  }
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
