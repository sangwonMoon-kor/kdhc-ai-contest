"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const port = 8800 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const forecastWorkId = "w-problem-recognition-m1";

function cssRgb(value) {
  const channels = String(value).match(/[\d.]+/g);
  assert(channels && channels.length >= 3, `invalid CSS color: ${value}`);
  return channels.slice(0, 3).map(Number);
}

function contrastRatio(first, second) {
  function luminance(rgb) {
    const linear = rgb.map(function (channel) {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  }
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

const seededState = {
  v: 1,
  selectedWorkId: "calendar-work",
  works: [{
    id: "calendar-work",
    title: "냉각수 펌프 정비공사",
    instruction: "승인된 홈 달력 렌더링 검증",
    requester: "시설운영팀",
    due: "2026-01-04",
    calendarStart: "2025-12-29",
    calendarCategory: "construction",
    repeat: false,
    todos: [],
    records: [{
      id: "confirmed-memo",
      ts: 1767312000000,
      kind: "schedule",
      text: "현장 사진 정리",
      dateISO: "2026-01-02",
      calendarStatus: "confirmed"
    }],
    scheduleCandidates: [{
      id: "schedule-candidate",
      kind: "range",
      label: "다음 주 업체 서류 확인",
      startISO: "2026-01-04",
      endISO: "2026-01-10",
      confirmed: false
    }],
    sources: [],
    draft: { savedAt: null, values: null }
  }]
};

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
  return chromium.launch(Object.assign({ headless: true }, executablePath ? { executablePath } : {}));
}

async function goHome(page) {
  await page.evaluate(function () { location.hash = "#home"; });
  await page.locator("#omniIn").waitFor();
}

async function run() {
  let server;
  let browser;
  const errors = [];
  try {
    server = await startServer();
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", function (error) { errors.push(`pageerror: ${error.message}`); });
    page.on("console", function (message) {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(function (state) {
      localStorage.setItem("jikmu.workbench.v1", JSON.stringify(state));
    }, seededState);
    await page.goto(`${base}/?data=fixture#home`, { waitUntil: "networkidle" });
    await page.locator("#omniIn").waitFor();

    assert.equal(await page.locator("body").evaluate(function (element) { return element.classList.contains("is-home"); }), true, "home route does not set body.is-home");
    assert.equal(await page.locator("main#view").evaluate(function (element) { return element.classList.contains("home-main"); }), true, "home route does not set main.home-main");
    assert.equal(await page.locator("header.top").isVisible(), false, "legacy header remains visible on home");
    assert.equal(await page.locator("footer.foot").isVisible(), false, "legacy footer remains visible on home");
    assert.equal(await page.locator("#heroLine").count(), 0, "legacy typing greeting remains on home");
    assert.equal((await page.locator("body").innerText()).includes("오늘 할 일부터 챙겨드릴게요"), false, "legacy welcome copy remains visible");
    assert.equal(await page.locator("#simDate").isVisible(), false, "separate simulation date remains visible on home");
    assert.equal(await page.locator("#omniIn").getAttribute("placeholder"), "지금 어떤 생각을 하시나요?", "home placeholder changed");
    await page.locator("#omniIn").focus();
    const composeFocus = await page.locator(".home-compose").evaluate(function (element) {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor };
    });
    assert.equal(composeFocus.outlineStyle, "solid", "primary home input does not expose a solid focus-within ring");
    assert(composeFocus.outlineWidth >= 2, "primary home input focus-within ring is too thin");
    assert.notEqual(composeFocus.outlineColor, "rgba(0, 0, 0, 0)", "primary home input focus-within ring is transparent");
    for (const selector of [".home-send", ".home-calendar-all", ".app-sidebar a.is-current"]) {
      const textColor = cssRgb(await page.locator(selector).evaluate(function (element) { return getComputedStyle(element).color; }));
      assert(contrastRatio(textColor, [255, 255, 255]) >= 4.5, `${selector} text misses WCAG AA contrast on white`);
      assert(contrastRatio(textColor, [251, 250, 249]) >= 4.5, `${selector} text misses WCAG AA contrast on the home background`);
    }
    const currentRail = page.locator(".app-sidebar a.is-current");
    await currentRail.hover();
    const hoveredRailColor = cssRgb(await currentRail.evaluate(function (element) { return getComputedStyle(element).color; }));
    assert(contrastRatio(hoveredRailColor, [255, 255, 255]) >= 4.5, "hovered current rail text misses WCAG AA contrast on white");
    assert(contrastRatio(hoveredRailColor, [251, 250, 249]) >= 4.5, "hovered current rail text misses WCAG AA contrast on the home background");
    const railHoverRule = await page.evaluate(function () {
      const selectors = [];
      function find(rules) {
        for (const rule of Array.from(rules || [])) {
          if (rule.selectorText) selectors.push(rule.selectorText);
          if (rule.selectorText && rule.selectorText.split(",").map(function (value) { return value.trim(); }).includes(".is-home .app-sidebar nav a:hover") && rule.style.color) return rule.style.color;
          if (rule.cssRules) {
            const nested = find(rule.cssRules);
            if (nested) return nested;
          }
        }
        return "";
      }
      const color = Array.from(document.styleSheets).map(function (sheet) { return find(sheet.cssRules); }).find(Boolean) || "";
      return { color: color, selectors: selectors.filter(function (selector) { return selector.includes("app-sidebar"); }) };
    });
    assert.equal(railHoverRule.color, "var(--home-red-deep)", `desktop rail hover rule uses a non-AA red text token: ${JSON.stringify(railHoverRule)}`);
    const constructionColor = cssRgb(await page.locator(".home-event--work.is-construction").first().evaluate(function (element) { return getComputedStyle(element).color; }));
    for (const gradientColor of [[255, 232, 229], [255, 220, 217]]) {
      assert(contrastRatio(constructionColor, gradientColor) >= 4.5, "construction-event text misses WCAG AA contrast on its gradient");
    }
    const attachment = page.locator("#homeAttachment");
    await attachment.setInputFiles({ name: "정비 점검표.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture") });
    const selectedFileFeedback = await page.locator("#homeFeedback").innerText();
    assert(selectedFileFeedback.includes("정비 점검표.pdf") && selectedFileFeedback.includes("로컬 시연에서는 첨부 파일을 처리하지 않습니다"), "selected attachment feedback is not truthful");
    assert.equal(await page.getByRole("button", { name: "첨부 파일 선택 해제" }).count(), 1, "attachment clear control is missing");
    await page.locator("#omni").evaluate(function (form) { form.requestSubmit(); });
    const fileOnlyFeedback = await page.locator("#homeFeedback").innerText();
    assert(fileOnlyFeedback.includes("로컬 시연에서는 첨부 파일을 처리하지 않습니다") && fileOnlyFeedback.includes("선택 해제"), "file-only submit was not explicitly rejected");
    assert.equal(await attachment.evaluate(function (input) { return input.files[0] && input.files[0].name; }), "정비 점검표.pdf", "selected filename was not retained for submit");
    await page.locator("#omniIn").fill("이번 주 내가 해야 할 일");
    await page.locator("#omni").evaluate(function (form) { form.requestSubmit(); });
    assert.equal(new URL(page.url()).hash, "#home", "text-plus-file submit reached normal input handling");
    assert((await page.locator("#homeFeedback").innerText()).includes("선택 해제"), "text-plus-file rejection does not explain how to continue");
    await page.getByRole("button", { name: "첨부 파일 선택 해제" }).click();
    assert.equal(await attachment.evaluate(function (input) { return input.files.length; }), 0, "attachment clear did not remove the selected file");
    assert.equal(await page.getByRole("button", { name: "첨부 파일 선택 해제" }).count(), 0, "attachment clear control remained after clearing");
    await page.locator("#omni").evaluate(function (form) { form.requestSubmit(); });
    await page.waitForFunction(function () { return location.hash === "#work/list"; });
    assert.equal(new URL(page.url()).hash, "#work/list", "normal text submission did not resume after attachment clear");
    await goHome(page);
    assert.equal(await page.getByRole("heading", { name: "내 업무 일정" }).count(), 1, "calendar heading missing");
    assert.equal(await page.locator("[data-calendar-date]").count(), 14, "home calendar must render exactly 14 dates");
    assert.equal(await page.locator("[data-calendar-date]").first().getAttribute("data-calendar-date"), "2025-12-28", "calendar does not start from summary.simDate week");
    assert.equal(await page.locator('[data-calendar-date="2026-01-02"]').getAttribute("aria-current"), "date", "simulation date is not exposed as current date");

    assert((await page.locator('[data-calendar-kind="work"]').count()) >= 1, "multi-day work bar missing");
    assert.equal(await page.locator('[data-calendar-kind="memo"]').count(), 1, "confirmed memo missing");
    const candidate = page.locator('[data-calendar-kind="candidate"]');
    assert.equal(await candidate.count(), 1, "schedule candidate chip missing");
    assert((await candidate.innerText()).includes("후보"), "candidate does not expose the visible Korean candidate label");
    assert((await candidate.innerText()).includes("미확인"), "candidate does not expose visible status text");
    const candidateAriaLabel = await candidate.getAttribute("aria-label");
    assert(candidateAriaLabel.includes("일정 후보 미확인"), "candidate status is missing from its accessible name");
    assert(candidateAriaLabel.includes("2026.01.04") && candidateAriaLabel.includes("2026.01.10"), "candidate range accessible name omits one of its dates");
    await candidate.click();
    await page.waitForFunction(function () { return !document.querySelector('[data-calendar-kind="candidate"]'); });
    const confirmationFeedback = await page.locator("#homeFeedback").innerText();
    assert(confirmationFeedback.includes("냉각수 펌프 정비공사 일정을 확정했습니다."), "schedule confirmation feedback is not cohesive Korean copy");
    assert.equal(confirmationFeedback.includes("schedule confirmed"), false, "English schedule confirmation feedback remains");
    const confirmedRange = page.locator('[data-calendar-kind="memo"][data-event-start="2026-01-04"][data-event-end="2026-01-10"]');
    assert.equal(await confirmedRange.count(), 1, "confirmed range collapsed instead of retaining both dates");
    const confirmedRangeAriaLabel = await confirmedRange.getAttribute("aria-label");
    assert(confirmedRangeAriaLabel.includes("2026.01.04") && confirmedRangeAriaLabel.includes("2026.01.10"), "confirmed memo range accessible name omits one of its dates");

    const deadline = page.locator(`[data-calendar-kind="deadline"][data-work-id="${forecastWorkId}"]`);
    assert.equal(await deadline.count(), 1, "forecast deadline event missing");
    await deadline.click();
    await page.waitForFunction(function (expected) { return location.hash === `#workbench/${expected}`; }, forecastWorkId);
    await page.locator(".app-sidebar").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).hash, `#workbench/${forecastWorkId}`, "forecast deadline changed work identity");
    assert.equal(await page.locator("header.top").isVisible(), false, "legacy header returned on a non-home route");
    assert.equal(await page.locator("footer.foot").isVisible(), false, "legacy footer returned on a non-home route");
    assert.equal(await page.locator('.app-sidebar a[href="#work/list"]').getAttribute("aria-current"), "page", "workbench does not retain the 내 업무 menu state");
    assert.equal(await page.locator("body").evaluate(function (element) { return element.classList.contains("is-home"); }), false, "home body class leaked to workbench");

    await goHome(page);
    const previous = page.getByRole("button", { name: "이전 2주 보기" });
    await previous.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(function () {
      const first = document.querySelector("[data-calendar-date]");
      return first && first.dataset.calendarDate === "2025-12-14";
    });
    const next = page.getByRole("button", { name: "다음 2주 보기" });
    await next.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(function () {
      const first = document.querySelector("[data-calendar-date]");
      return first && first.dataset.calendarDate === "2025-12-28";
    });

    const railLinks = page.locator(".app-sidebar nav a");
    assert.equal(await railLinks.count(), 4, "common sidebar does not expose four routes");
    const workRailLink = page.locator('.app-sidebar a[href="#work/list"]');
    assert((await workRailLink.getAttribute("aria-label")), "rail link lacks an accessible name");
    await workRailLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(function () { return location.hash === "#work/list"; });
    assert.equal(new URL(page.url()).hash, "#work/list", "icon rail is not keyboard operable");

    await page.setViewportSize({ width: 390, height: 844 });
    await goHome(page);
    const overflow = await page.evaluate(function () {
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });
    assert(overflow.scrollWidth <= overflow.clientWidth, `390px home has document overflow: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
    assert.deepEqual(errors, [], "home emitted console/page errors");
    console.log("Home browser contract passed");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
