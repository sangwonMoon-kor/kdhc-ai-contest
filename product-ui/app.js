"use strict";
/* ============================================================================
 * app.js — ON_메모리 · 업무 작업대 프론트엔드
 * 설계: docs/superpowers/specs/2026-07-21-workbench-rebuild-on-engine-design.md
 * 구조: 홈 만능 입력 → 내 업무(목록·달력) → 업무 작업대 → 기안 집중 화면
 * 원칙: 근거·질의·예보·초안·점검은 엔진 API, 업무 건 진행 상태만 브라우저 상태.
 *       수치·기한을 임의 생성하지 않는다(기한 미정). 시스템 용어를 노출하지 않는다.
 * ==========================================================================*/

/* ---------- 유틸 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function uid(p) { return (p || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmtD(iso) { if (!iso) return "기한 미정"; const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}.${m[2]}.${m[3]}` : String(iso); }
function fmtTs(ts) { const d = new Date(ts); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function ddayOf(dueISO, simISO) {
  if (!dueISO || !simISO) return null;
  return Math.round((new Date(dueISO + "T00:00:00") - new Date(simISO + "T00:00:00")) / 86400000);
}
function ddayLabel(n) { return n == null ? "" : n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`; }

/* ---------- 안전 저장소 (localStorage 불가 환경 폴백) ---------- */
const storage = (() => {
  try { const k = "__t" + Math.random(); localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
  catch (e) { const mem = new Map(); return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }; }
})();
const SKEY = "jikmu.workbench.v1";
const UKEY = "jikmu.ui.v1";
const TKEY = "jikmu.theme";

/* ---------- 엔진·fixture API ---------- */
function renderDataStatus(status) {
  const isLiveError = status.error && status.activeMode !== "fixture";
  const className = "data-status " + (isLiveError ? "error" : status.activeMode);
  const text = status.activeMode === "fixture" ? "시연용 샘플 데이터" : isLiveError ? "엔진 연결 오류" : "실제 엔진 연결";
  [document.getElementById("dataStatus"), document.getElementById("homeDataStatus")].forEach((el) => {
    if (!el) return;
    el.className = el.id === "homeDataStatus" ? `${className} home-data-status` : className;
    el.textContent = text;
  });
}
const apiClient = window.JikmuApi.createApiClient({
  mode: window.JikmuApi.modeFromSearch(location.search),
  fixtureBase: "fixtures",
  timeoutMs: 20000,
  onStatus: renderDataStatus,
});
async function api(path, body) { return apiClient.request(path, body); }
const cache = { summary: null, forecast: null, briefing: null };
async function loadSummary() { if (!cache.summary) cache.summary = await api("/api/summary"); return cache.summary; }
async function loadForecast() { if (!cache.forecast) cache.forecast = await api("/api/forecast"); return cache.forecast; }
async function loadBriefing() { if (!cache.briefing) cache.briefing = await api("/api/briefing"); return cache.briefing; }
const workspaceModel = window.OnMemoryWorkspaceModel;
const workbenchModel = window.OnMemoryWorkbenchModel;

/* ---------- 업무 건 상태 계층 ---------- */
let S = null;              // {v, works[], selectedWorkId}
let UI = null;             // {calYM, listFilter}
let lastAction = null;     // 메모리 한정 undo (마지막 1건)
let lastActionMessage = "";
let homeCalendarOffsetWeeks = 0;
let homeAttachmentFile = null;
let homeAttachmentMessage = "";
let engineDown = false;

function blankState() { return workspaceModel.createDemoState(); }
function validWork(w) {
  return w && typeof w === "object" && typeof w.id === "string" && typeof w.title === "string"
    && Array.isArray(w.todos) && Array.isArray(w.records) && Array.isArray(w.sources);
}
function normalizeRecord(record) {
  if (!record || typeof record !== "object") return record;
  const normalized = Object.assign({}, record);
  if ("dateISO" in normalized && typeof normalized.dateISO !== "string") delete normalized.dateISO;
  if ("startISO" in normalized && typeof normalized.startISO !== "string") delete normalized.startISO;
  if ("endISO" in normalized && typeof normalized.endISO !== "string") delete normalized.endISO;
  if ("calendarStatus" in normalized && typeof normalized.calendarStatus !== "string") delete normalized.calendarStatus;
  return normalized;
}
function normalizeScheduleCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.kind !== "string" || typeof candidate.label !== "string"
    || typeof candidate.startISO !== "string" || typeof candidate.endISO !== "string") return null;
  const normalized = {
    kind: candidate.kind,
    label: candidate.label,
    startISO: candidate.startISO,
    endISO: candidate.endISO,
    confirmed: candidate.confirmed === true,
  };
  if (typeof candidate.id === "string") normalized.id = candidate.id;
  return normalized;
}
function normalizeWork(w) {
  const normalized = Object.assign({}, w);
  if (typeof normalized.calendarStart !== "string") delete normalized.calendarStart;
  if (typeof normalized.calendarCategory !== "string") delete normalized.calendarCategory;
  normalized.records = normalized.records.map(normalizeRecord);
  if (Array.isArray(normalized.scheduleCandidates)) {
    normalized.scheduleCandidates = normalized.scheduleCandidates.map(normalizeScheduleCandidate).filter(Boolean);
  } else {
    delete normalized.scheduleCandidates;
  }
  return normalized;
}
function loadState() {
  try {
    const raw = storage.getItem(SKEY);
    if (!raw) return blankState();
    const j = JSON.parse(raw);
    const migrated = workspaceModel.migrateState(j);
    return Object.assign({}, migrated, { works: migrated.works.filter(validWork).map(normalizeWork) });
  } catch (e) { return blankState(); }
}
function saveState() { try { storage.setItem(SKEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 — 메모리로 계속 */ } }
function loadUI() {
  const defaults = { calYM: null, listFilter: null, workListMode: "active", scheduleScopes: [workspaceModel.SCOPE.MINE] };
  try {
    const parsed = JSON.parse(storage.getItem(UKEY) || "{}");
    const loaded = Object.assign({}, defaults, parsed);
    if (!Array.isArray(parsed.scheduleScopes)) loaded.scheduleScopes = defaults.scheduleScopes.slice();
    else loaded.scheduleScopes = parsed.scheduleScopes.filter((scope) => Object.values(workspaceModel.SCOPE).includes(scope));
    return loaded;
  } catch (e) { return defaults; }
}
function saveUI() { try { storage.setItem(UKEY, JSON.stringify(UI)); } catch (e) {} }

/* 시드: 엔진 반복 업무(forecast) → 업무 건 파생. seedKey 중복은 만들지 않아 사용자 변경을 보존 */
function seedFromForecast(fc, sim) {
  const have = new Set(S.works.map((w) => w.seedKey).filter(Boolean));
  for (const it of (fc && fc.items) || []) {
    const key = `${it.stageId}|${it.month}`;
    if (have.has(key)) continue;
    const work = workspaceModel.adaptForecastItem(it, null, sim);
    work.todos = [
        { id: uid("t"), text: "작년 문서 확인", done: false, candidate: false, evidence: (it.docs || []).slice(0, 3).map((d) => ({ docId: d, label: "과거 문서" })) },
        { id: uid("t"), text: "협조처·일정 확인", done: false, candidate: false, evidence: [] },
        { id: uid("t"), text: "초안 작성(작년 양식)", done: false, candidate: false, evidence: [], action: "draft" },
        { id: uid("t"), text: "제출 전 점검", done: false, candidate: false, evidence: [], action: "check" },
      ];
    S.works.push(work);
  }
  saveState();
}
function getWork(id) { return S.works.find((w) => w.id === id) || null; }
function progress(w) {
  const real = w.todos.filter((t) => !t.candidate);
  if (!real.length) return 0;
  return Math.round((real.filter((t) => t.done).length / real.length) * 100);
}
function nextTodo(w) { return w.todos.find((t) => !t.candidate && !t.done) || null; }
function urgentWorks(sim) {
  return S.works
    .filter((w) => w.due && progress(w) < 100)
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
function selectedWork() {
  const w = S.selectedWorkId && getWork(S.selectedWorkId);
  if (w) return w;
  return urgentWorks()[0] || null;
}

/* ---------- 행동(undo·대상 변경) ---------- */
function setAction(a, msg) { lastAction = a; lastActionMessage = msg; toast(msg, a); }
function undoLast() {
  if (!lastAction) return;
  const a = lastAction; lastAction = null; lastActionMessage = "";
  const w = getWork(a.workId);
  if (a.type === "addRecord" && w) {
    w.records = w.records.filter((r) => r.id !== a.recId);
    if (a.candidateId) w.scheduleCandidates = (w.scheduleCandidates || []).filter((c) => c.id !== a.candidateId);
  }
  if (a.type === "addTodo" && w) {
    w.todos = w.todos.filter((t) => t.id !== a.todoId);
    if (a.candidateId) w.scheduleCandidates = (w.scheduleCandidates || []).filter((c) => c.id !== a.candidateId);
  }
  if (a.type === "toggleTodo" && w) { const t = w.todos.find((x) => x.id === a.todoId); if (t) t.done = a.prev; }
  if (a.type === "promoteTodo" && w) { const t = w.todos.find((x) => x.id === a.todoId); if (t) t.candidate = true; }
  if (a.type === "createWork") S.works = S.works.filter((x) => x.id !== a.workId);
  if (a.type === "attachSource" && w) w.sources = w.sources.filter((s) => s.docId !== a.docId);
  if (a.type === "confirmScheduleCandidate" && w) {
    const candidate = (w.scheduleCandidates || []).find((c) => c.id === a.candidateId);
    if (candidate) candidate.confirmed = a.prevConfirmed;
    w.records = w.records.filter((r) => r.id !== a.recId);
  }
  if (a.type === "addPersonalSchedule") {
    S.personalSchedules = (S.personalSchedules || []).filter((item) => item.id !== a.personalId);
  }
  saveState(); hideToast(); route();
}
/* 대상 변경: 방금 입력으로 생긴 변경만 원래 업무에서 되돌리고 새 대상에 한 번 적용 */
function retarget(a) {
  if (!a || (a.type !== "addRecord" && a.type !== "addTodo")) return;
  const old = getWork(a.workId);
  const payload = old && (a.type === "addRecord"
    ? old.records.find((r) => r.id === a.recId)
    : old.todos.find((t) => t.id === a.todoId));
  if (!payload) return;
  chooseWork(`‘${payload.text.slice(0, 24)}…’을(를) 어느 업무로 옮길까요?`, (w) => {
    const source = getWork(a.workId);
    const moved = source && (a.type === "addRecord"
      ? source.records.find((r) => r.id === a.recId)
      : source.todos.find((t) => t.id === a.todoId));
    if (!moved) return;
    const candidate = a.candidateId
      ? (source.scheduleCandidates || []).find((c) => c.id === a.candidateId) || null
      : null;
    if (a.type === "addRecord") source.records = source.records.filter((r) => r.id !== a.recId);
    else source.todos = source.todos.filter((t) => t.id !== a.todoId);
    if (candidate) source.scheduleCandidates = source.scheduleCandidates.filter((c) => c.id !== a.candidateId);
    hideToast();
    if (a.type === "addRecord") w.records.push(moved); else w.todos.push(moved);
    if (candidate) {
      if (!Array.isArray(w.scheduleCandidates)) w.scheduleCandidates = [];
      w.scheduleCandidates.push(candidate);
    }
    lastAction = Object.assign({}, a, { workId: w.id });
    lastActionMessage = `${w.title}(으)로 옮겼습니다.`;
    saveState(); toast(lastActionMessage, lastAction); route();
  });
}

/* ---------- 토스트 / 업무 선택 ---------- */
let toastTimer = null;
function toast(msg, action) {
  const t = $("#toast");
  t.hidden = false;
  t.innerHTML = `<span>${esc(msg)}</span>` +
    (action && (action.type === "addRecord" || action.type === "addTodo") ? `<button id="tRetarget">대상 변경</button>` : "") +
    (action ? `<button id="tUndo">되돌리기</button>` : "") +
    `<button id="tClose" aria-label="닫기">✕</button>`;
  const u = $("#tUndo"); if (u) u.onclick = undoLast;
  const r = $("#tRetarget"); if (r) r.onclick = () => retarget(lastAction);
  $("#tClose").onclick = hideToast;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 9000);
}
function hideToast() { const t = $("#toast"); t.hidden = true; t.innerHTML = ""; }

function chooseWork(title, onPick, allowNew) {
  const body = $("#drawerBody");
  $("#drawerTitle").textContent = "업무 선택";
  body.innerHTML = `<p style="margin-bottom:10px">${esc(title)}</p>` +
    S.works.map((w) => `<button class="work-card" data-pick="${esc(w.id)}"><span class="t">${esc(w.title)}</span>
      <span class="meta">${w.due ? "마감 " + fmtD(w.due) : "기한 미정"}</span></button>`).join("") +
    (allowNew ? `<button class="btn ghost" id="pickNew" style="margin-top:6px">+ 새 업무로 만들기</button>` : "");
  openDrawerRaw();
  $$("#drawerBody [data-pick]").forEach((b) => { b.onclick = () => { closeDrawer(); const w = getWork(b.dataset.pick); if (w) onPick(w); }; });
  const pn = $("#pickNew"); if (pn) pn.onclick = () => { closeDrawer(); onPick(null); };
}

/* ---------- 근거 서랍 ---------- */
function openDrawerRaw() { $("#drawer").hidden = false; $("#drawerVeil").hidden = false; $("#drawerClose").focus(); }
function closeDrawer() { $("#drawer").hidden = true; $("#drawerVeil").hidden = true; }
function isValidISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
}
function openPersonalScheduleDrawer(personalId, initialISO) {
  const existing = (S.personalSchedules || []).find((item) => item.id === personalId) || null;
  const startISO = existing ? existing.startISO : initialISO || "";
  const endISO = existing ? existing.endISO || existing.startISO : initialISO || "";
  $("#drawerTitle").textContent = existing ? "개인 일정 수정" : "개인 일정 추가";
  $("#drawerBody").innerHTML = `<form class="personal-schedule-form" id="personalScheduleForm">
    <label>일정 제목<input id="personalTitle" type="text" required maxlength="80" value="${esc(existing ? existing.title : "")}"></label>
    <div class="personal-schedule-dates">
      <label>시작일<input id="personalStart" type="date" required value="${esc(startISO)}"></label>
      <label>종료일<input id="personalEnd" type="date" required value="${esc(endISO)}"></label>
    </div>
    <p class="form-error" id="personalScheduleError" role="alert"></p>
    <div class="candidate-actions">
      <button class="btn small" type="submit">저장</button>
      ${existing ? '<button class="btn ghost small" id="deletePersonalSchedule" type="button">삭제</button>' : ""}
    </div>
  </form>`;
  openDrawerRaw();
  $("#personalTitle").focus();
  $("#personalScheduleForm").onsubmit = (event) => {
    event.preventDefault();
    const title = $("#personalTitle").value.trim();
    const nextStartISO = $("#personalStart").value;
    const nextEndISO = $("#personalEnd").value;
    const error = $("#personalScheduleError");
    if (!title || !isValidISODate(nextStartISO) || !isValidISODate(nextEndISO) || nextStartISO > nextEndISO) {
      error.textContent = "제목과 날짜를 확인해 주세요. 종료일은 시작일보다 빠를 수 없습니다.";
      return;
    }
    if (existing) {
      existing.title = title;
      existing.startISO = nextStartISO;
      existing.endISO = nextEndISO;
    } else {
      if (!Array.isArray(S.personalSchedules)) S.personalSchedules = [];
      S.personalSchedules.push({ id: uid("personal-"), title, startISO: nextStartISO, endISO: nextEndISO, ownerId: S.currentPersonId, status: "active" });
    }
    saveState(); closeDrawer(); route();
  };
  const remove = $("#deletePersonalSchedule");
  if (remove) remove.onclick = () => {
    S.personalSchedules = S.personalSchedules.filter((item) => item.id !== existing.id);
    saveState(); closeDrawer(); route();
  };
}
async function openEvidence(ref) {
  const body = $("#drawerBody");
  $("#drawerTitle").textContent = "근거";
  body.innerHTML = `<p class="meta">불러오는 중…</p>`;
  openDrawerRaw();
  try {
    const id = String(ref.docId || ref);
    if (id.startsWith("okf:")) {
      const r = await api("/api/okf/" + encodeURIComponent(id.slice(4)));
      body.innerHTML = `<div class="meta">공식 업무 지식${r.type ? " · " + esc(r.type) : ""}</div>
        <h3 style="margin-bottom:8px">${esc(r.label || id)}</h3>
        ${r.description ? `<p style="margin-bottom:10px">${esc(r.description)}</p>` : ""}
        ${r.body ? `<pre>${esc(r.body.slice(0, 4000))}</pre>` : ""}`;
    } else {
      const r = await api("/api/documents/" + encodeURIComponent(id));
      const d = r.doc || {};
      body.innerHTML = `<div class="meta">${esc(d.kind || "문서")} · ${esc(d.date || "")} · ${esc(d.author || "")}</div>
        <h3 style="margin-bottom:8px">${esc(d.title || id)}</h3>
        <pre>${esc((d.text || "").slice(0, 6000))}</pre>
        ${(r.edges || []).length ? `<div class="meta" style="margin-top:10px">이 문서에서 확인된 업무 관계 ${r.edges.length}건</div>` : ""}`;
    }
  } catch (e) {
    body.innerHTML = `<p class="meta">근거를 불러오지 못했습니다${ref.label ? " — " + esc(ref.label) : ""}.</p>`;
  }
}
function evBtn(ev) { return `<button class="ev-btn" data-ev="${esc(ev.docId || "")}">근거 · ${esc(ev.label || ev.docId || "")}</button>`; }
function bindEvidence(root) {
  $$("[data-ev]", root).forEach((b) => { b.onclick = () => openEvidence({ docId: b.dataset.ev, label: b.textContent }); });
}

/* ---------- 라우터 ---------- */
const LEGACY = { "": "#home", "#": "#home", "#ask": "#home", "#briefing": "#work/list", "#forecast": "#schedule", "#work/calendar": "#schedule", "#check": "#work/list", "#draft": "#work/list", "#ingest": "#work/list", "#next": "#work/list", "#home": "#home" };
function parseHash() {
  let h = location.hash || "#home";
  if (LEGACY[h] && LEGACY[h] !== h) { location.replace(LEGACY[h]); h = LEGACY[h]; }
  const m = h.slice(1).split("/");
  try {
    return { v: m[0] || "home", a: m[1] ? decodeURIComponent(m[1]) : null };
  } catch (error) {
    return { v: "invalid-route", a: null };
  }
}
function nav(hash) { if (location.hash === hash) route(); else location.hash = hash; }
async function route() {
  const { v, a } = parseHash();
  const isHome = v === "home";
  const active = isHome ? "home" : v === "schedule" ? "schedule" : v === "cloud" ? "cloud" : "work";
  const main = $("#view");
  document.body.classList.toggle("is-home", isHome);
  main.classList.toggle("home-main", isHome);
  main.innerHTML = `<div class="app-shell">
    ${renderAppSidebar(active)}
    <section class="app-content${isHome ? " is-home-content" : ""}">
      ${renderShellUtilities()}
      <div class="app-view"></div>
    </section>
  </div>`;
  const view = $(".app-view", main);
  const shellThemeBtn = $("#shellThemeBtn", main);
  if (shellThemeBtn) shellThemeBtn.onclick = () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  renderDataStatus(apiClient.getStatus());
  closeDrawer();
  try {
    if (v === "home") await vHome(view);
    else if (v === "schedule") await vCalendar(view);
    else if (v === "cloud") vCloud(view);
    else if (v === "work") await vList(view);
    else if (v === "workbench") await vWorkbench(view, a);
    else if (v === "draft") await vDraft(view, a);
    else if (v === "graph") await vGraph(view);
    else if (v === "vision") vVision(view);
    else vNotFound(view, "화면을 찾을 수 없습니다.");
  } catch (e) {
    view.innerHTML = `<div class="view"><h1 class="pg" tabindex="-1">연결이 원활하지 않습니다</h1>
      <div class="card"><p>엔진에 연결하지 못했습니다. 로컬에서는 <code>cd service && npm start</code>로 서버를 켜 주세요.</p></div></div>`;
  }
  const h1 = $("h1.pg", view) || $("h1", view);
  if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: false }); }
}

/* ---------- 홈 ---------- */
async function vHome(main) {
  const sum = await loadSummary().catch(() => null);
  engineDown = !sum;
  const fc = await loadForecast().catch(() => ({ items: [] }));
  if (sum) seedFromForecast(fc, sum.simDate);
  const sim = sum ? sum.simDate : fc && fc.simDate;
  const homeModel = window.JikmuHomeModel;
  if (!sim || !homeModel || typeof homeModel.buildTwoWeekWindow !== "function" || typeof homeModel.buildCalendarEvents !== "function") {
    throw new Error("Home calendar model unavailable");
  }
  const calendarWindow = window.JikmuHomeModel.buildTwoWeekWindow(sim, homeCalendarOffsetWeeks);
  const events = workspaceModel.selectHomeEvents(S, calendarWindow);

  main.innerHTML = `<div class="home-content">
      <section class="home-compose" aria-label="생각 입력">
        <form class="omni" id="omni" data-testid="home-omni">
          <label class="sr-only" for="omniIn">생각 입력</label>
          <input id="omniIn" type="text" autocomplete="off" placeholder="지금 어떤 생각을 하시나요?" aria-label="생각 입력">
          <input id="homeAttachment" type="file" hidden>
          <button class="home-attach" id="homeAttachBtn" type="button" aria-label="파일 첨부">${homeIcon("attach")}</button>
          <button class="home-send" type="submit" aria-label="입력 보내기">${homeIcon("send")}<span>보내기</span></button>
        </form>
      </section>
      ${renderHomeFeedback()}
      <section class="home-calendar-panel" aria-labelledby="homeCalendarTitle">
        <div class="home-calendar-toolbar">
          <h1 id="homeCalendarTitle">내 업무 일정</h1>
          <div class="home-calendar-range" aria-live="polite">${homeRangeLabel(calendarWindow)}</div>
          <div class="home-calendar-controls">
            <button id="homeCalPrev" type="button" aria-label="이전 2주 보기">${homeIcon("chevron-left")}</button>
            <button id="homeCalNext" type="button" aria-label="다음 2주 보기">${homeIcon("chevron-right")}</button>
          </div>
          <a class="home-calendar-all" href="#schedule">전체 일정 ${homeIcon("chevron-right")}</a>
        </div>
        <div class="home-calendar-scroll" role="region" aria-label="2주 업무 달력" tabindex="0">
          <div class="home-calendar-inner">
            <div class="home-weekdays" aria-hidden="true">${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}</div>
            ${calendarWindow.weeks.map((week) => renderHomeCalendarWeek(week, events, sim)).join("")}
          </div>
        </div>
        <div class="home-calendar-legend" aria-label="일정 범례">
          <span><i class="legend-work"></i>공사·용역</span>
          <span><i class="legend-memo"></i>개인 일정·내 메모</span>
          <span><i class="legend-candidate"></i>확인 필요</span>
        </div>
      </section>
      <div id="homeResult"></div>
  </div>`;

  renderDataStatus(apiClient.getStatus());

  const homeAttachment = $("#homeAttachment");
  $("#homeAttachBtn").onclick = () => homeAttachment.click();
  homeAttachment.onchange = () => {
    homeAttachmentFile = homeAttachment.files && homeAttachment.files[0] ? homeAttachment.files[0] : null;
    homeAttachmentMessage = homeAttachmentFile
      ? `첨부 파일 ‘${homeAttachmentFile.name}’을 선택했습니다. 로컬 시연에서는 첨부 파일을 처리하지 않습니다. 계속하려면 선택 해제를 눌러 주세요.`
      : "";
    refreshHomeFeedback();
  };
  $("#omni").onsubmit = (e) => {
    e.preventDefault();
    const text = $("#omniIn").value;
    if (homeAttachmentFile) {
      homeAttachmentMessage = `로컬 시연에서는 첨부 파일을 처리하지 않습니다. ‘${homeAttachmentFile.name}’ 선택 해제 후 텍스트 지시를 보내 주세요.`;
      refreshHomeFeedback();
      return;
    }
    handleOmni(text, null, $("#homeResult"), sim);
  };
  bindHomeFeedbackActions();
  $("#homeCalPrev").onclick = () => { homeCalendarOffsetWeeks -= 2; route(); };
  $("#homeCalNext").onclick = () => { homeCalendarOffsetWeeks += 2; route(); };
  $$("[data-calendar-kind]", main).forEach((eventButton) => {
    eventButton.onclick = () => {
      if (eventButton.dataset.calendarKind === "candidate") {
        confirmScheduleCandidate(eventButton.dataset.workId, eventButton.dataset.eventId);
      } else if (eventButton.dataset.calendarKind === "personal") {
        openPersonalScheduleDrawer(eventButton.dataset.eventId);
      } else {
        nav("#workbench/" + eventButton.dataset.workId);
      }
    };
  });
}

function homeIcon(name) {
  const paths = {
    home: '<rect x="6" y="4" width="12" height="16" rx="2"></rect><path d="M9 9h6M9 13h6"></path>',
    folder: '<path d="M3.5 7.5h6l2-2h9v13h-17z"></path>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01"></path>',
    cloud: '<path d="M7 18h10a4 4 0 00.8-7.9A6 6 0 006.4 8.7 4.5 4.5 0 007 18z"></path>',
    attach: '<path d="M9.5 12.5l5.7-5.7a3.2 3.2 0 014.5 4.5l-8 8a5 5 0 01-7.1-7.1l8.4-8.4"></path>',
    send: '<path d="M3 11.5L21 4l-7.5 18-2.2-7.3zM11.3 14.7L21 4"></path>',
    "chevron-left": '<path d="M15 18l-6-6 6-6"></path>',
    "chevron-right": '<path d="M9 18l6-6-6-6"></path>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ""}</svg>`;
}

function renderAppSidebar(active) {
  const items = [
    { id: "home", href: "#home", label: "홈", icon: "home" },
    { id: "work", href: "#work/list", label: "내 업무", icon: "folder" },
    { id: "schedule", href: "#schedule", label: "일정", icon: "calendar" },
    { id: "cloud", href: "#cloud", label: "클라우드", icon: "cloud" },
  ];
  return `<aside class="app-sidebar" aria-label="주 메뉴">
    <a class="app-brand" href="#home" aria-label="ON_메모리 홈">ON_메모리</a>
    <nav>${items.map((item) => `<a class="${item.id === active ? "is-current" : ""}" href="${item.href}" aria-label="${item.label}"${item.id === active ? ' aria-current="page"' : ""}>${homeIcon(item.icon)}<span>${item.label}</span></a>`).join("")}</nav>
  </aside>`;
}

function renderShellUtilities() {
  return `<div class="shell-utilities" aria-label="화면 도구">
    <span class="data-status home-data-status" id="homeDataStatus" role="status" aria-live="polite">데이터 확인 중</span>
    <button class="icon-btn" id="shellThemeBtn" type="button" aria-label="화면 모드 전환">◐</button>
  </div>`;
}

function homeISODateParts(iso) {
  const parts = String(iso || "").split("-").map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function homeRangeLabel(window2) {
  const start = homeISODateParts(window2.startISO);
  const end = homeISODateParts(window2.endISO);
  return `${start.month}월 ${start.day}일 – ${end.month}월 ${end.day}일`;
}

function renderHomeFeedback() {
  if (homeAttachmentFile && homeAttachmentMessage) {
    return `<div class="home-feedback" id="homeFeedback" role="status" aria-live="polite">
      <span class="home-feedback-attachment" aria-hidden="true">${homeIcon("attach")}</span>
      <span>${esc(homeAttachmentMessage)}</span>
      <span class="home-feedback-divider" aria-hidden="true"></span>
      <button id="homeAttachmentClear" type="button" aria-label="첨부 파일 선택 해제">선택 해제</button>
    </div>`;
  }
  if (lastAction && lastActionMessage) {
    return `<div class="home-feedback" id="homeFeedback" role="status" aria-live="polite">
      <span class="home-feedback-check" aria-hidden="true">✓</span>
      <span>${esc(lastActionMessage)}</span>
      <span class="home-feedback-divider" aria-hidden="true"></span>
      <button id="homeUndo" type="button">되돌리기</button>
    </div>`;
  }
  return `<div class="home-feedback is-empty" id="homeFeedback" role="status" aria-live="polite">입력 결과를 확인하고 필요하면 되돌릴 수 있습니다.</div>`;
}

function clearHomeAttachment() {
  homeAttachmentFile = null;
  homeAttachmentMessage = "";
  const input = $("#homeAttachment");
  if (input) input.value = "";
  refreshHomeFeedback();
}

function bindHomeFeedbackActions() {
  const undo = $("#homeUndo"); if (undo) undo.onclick = undoLast;
  const clear = $("#homeAttachmentClear"); if (clear) clear.onclick = clearHomeAttachment;
}

function refreshHomeFeedback() {
  const feedback = $("#homeFeedback");
  if (!feedback) return;
  feedback.outerHTML = renderHomeFeedback();
  bindHomeFeedbackActions();
}

function homeEventClass(event2) {
  if (event2.kind !== "work") return "";
  const work = getWork(event2.workId);
  return work && work.calendarCategory === "construction" ? " is-construction" : " is-service";
}

function homeEventDateLabel(event2) {
  return event2.startISO === event2.endISO
    ? fmtD(event2.startISO)
    : `${fmtD(event2.startISO)}부터 ${fmtD(event2.endISO)}까지`;
}

function homeEventLabel(event2) {
  if (event2.kind === "deadline") return `${event2.label} 마감, ${fmtD(event2.startISO)}, 업무 작업대 열기`;
  if (event2.kind === "memo") return `확인된 메모, ${event2.label}, ${homeEventDateLabel(event2)}, 업무 작업대 열기`;
  if (event2.kind === "candidate") return `일정 후보 미확인, ${event2.label}, ${homeEventDateLabel(event2)}, 눌러서 확인`;
  if (event2.kind === "personal") return `개인 일정, ${event2.label}, ${homeEventDateLabel(event2)}, 눌러서 수정`;
  return `${event2.label}, ${fmtD(event2.startISO)}부터 ${fmtD(event2.endISO)}까지, 업무 작업대 열기`;
}

function renderHomeEvent(event2, column, span, row) {
  const status = event2.kind === "candidate" ? '<span class="home-event-status">후보 · 미확인</span>' : "";
  const icon = event2.kind === "memo" ? '<span class="home-event-symbol" aria-hidden="true">▤</span>' : '<span class="home-event-dot" aria-hidden="true"></span>';
  return `<button type="button" class="home-calendar-event home-event--${esc(event2.kind)}${homeEventClass(event2)}"
    style="grid-column:${column} / span ${span};grid-row:${row}"
    data-calendar-kind="${esc(event2.kind)}" data-work-id="${esc(event2.workId)}" data-event-id="${esc(event2.id)}"
    data-event-start="${esc(event2.startISO)}" data-event-end="${esc(event2.endISO)}"
    aria-label="${esc(homeEventLabel(event2))}">${event2.kind === "work" ? "" : icon}<span class="home-event-text">${esc(event2.label)}</span>${status}</button>`;
}

function renderHomeCalendarWeek(days, events, sim) {
  const first = days[0];
  const last = days[days.length - 1];
  const weekEvents = events
    .filter((event2) => event2.startISO <= last && event2.endISO >= first)
    .sort((a, b) => a.startISO.localeCompare(b.startISO) || a.endISO.localeCompare(b.endISO) || a.kind.localeCompare(b.kind));
  const lanes = Math.max(3, weekEvents.length);
  const dayCells = days.map((iso, index) => {
    const date = homeISODateParts(iso);
    const current = iso === sim;
    return `<div class="home-calendar-day${index === 0 ? " is-sunday" : ""}${current ? " is-current" : ""}"
      style="grid-column:${index + 1};grid-row:1 / span ${lanes + 1}" data-calendar-date="${iso}"
      aria-label="${date.year}년 ${date.month}월 ${date.day}일"${current ? ' aria-current="date"' : ""}>
      <time datetime="${iso}">${date.day}</time>
    </div>`;
  }).join("");
  const eventButtons = weekEvents.map((event2, index) => {
    const visibleStart = event2.startISO < first ? first : event2.startISO;
    const visibleEnd = event2.endISO > last ? last : event2.endISO;
    const column = days.indexOf(visibleStart) + 1;
    const span = days.indexOf(visibleEnd) - days.indexOf(visibleStart) + 1;
    return renderHomeEvent(event2, column, span, index + 2);
  }).join("");
  return `<div class="home-calendar-week" style="grid-template-rows:48px repeat(${lanes},38px)">${dayCells}${eventButtons}</div>`;
}

/* ---------- 만능 입력 처리 ---------- */
async function handleOmni(text, fixedWork, resultBox, sim) {
  const t = String(text || "").trim();
  if (!t) return;
  // 방어: intent.js 미로드 시(정적 파일 서빙 오류 등) 조용히 죽지 않고 안내한다.
  if (!window.JikmuIntent) {
    if (resultBox) resultBox.innerHTML = `<div class="card" style="margin-top:18px"><p>입력 처리 모듈을 불러오지 못했습니다. 페이지를 새로고침(Ctrl+Shift+R) 해 주세요.</p></div>`;
    return;
  }
  const { classifyIntent, matchWork, extractDueText } = window.JikmuIntent;
  const c = classifyIntent(t);
  const target = fixedWork || matchWork(t, S.works);
  const personalCandidate = !fixedWork && !target ? parseScheduleCandidate(t, sim) : null;

  if (!fixedWork && c.intent === "list") return nav("#work/list");

  if (c.intent === "question") return renderAsk(resultBox, t, target);

  if (personalCandidate && c.intent !== "draft" && c.intent !== "instruction") {
    return renderPersonalScheduleCandidate(resultBox, personalCandidate);
  }

  if (c.intent === "draft") {
    const w = target || fixedWork;
    if (w) { S.selectedWorkId = w.id; saveState(); return nav("#draft/" + w.id); }
    return confirmTarget(t, c, resultBox, sim); // 대상 불명 → 한 번 확인
  }

  if (c.intent === "instruction") {
    if (target) {
      S.selectedWorkId = target.id; saveState();
      const rec = { id: uid("r"), ts: Date.now(), kind: "note", text: "지시 연결: " + t };
      target.records.push(rec);
      const candidate = addScheduleCandidate(target, t, sim);
      saveState();
      setAction({ type: "addRecord", workId: target.id, recId: rec.id, candidateId: candidate && candidate.id }, candidate ? `${target.title}에 지시와 일정 후보를 연결했습니다.` : `${target.title}에 지시를 연결했습니다.`);
      return nav("#workbench/" + target.id);
    }
    const candidate = parseScheduleCandidate(t, sim);
    return createWorkFrom(t, extractDueText(t), candidate && candidate.kind === "range" ? candidate : null);
  }

  if (c.intent === "record" || c.intent === "todo") return applyRecordOrTodo(t, c.intent, fixedWork, target, sim);

  // unclear — 모르는 것(의도)만 한 번 확인
  if (resultBox) {
    resultBox.innerHTML = `<div class="card" style="margin-top:18px">
      <div class="blk-k">어떻게 처리할까요? — 한 번만 확인합니다</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ghost small" data-as="question">질문으로 찾기</button>
        <button class="btn ghost small" data-as="record">진행 기록으로 남기기</button>
        <button class="btn ghost small" data-as="todo">할 일 후보로 추가</button>
      </div></div>`;
    $$("[data-as]", resultBox).forEach((b) => {
      b.onclick = () => {
        const as = b.dataset.as;
        resultBox.innerHTML = "";
        if (as === "question") renderAsk(resultBox, t, target);
        else applyRecordOrTodo(t, as, fixedWork, target, sim);
      };
    });
  }
}
function parseScheduleCandidate(text, sim) {
  if (!window.JikmuHomeModel || typeof window.JikmuHomeModel.parseScheduleCandidate !== "function") return null;
  return window.JikmuHomeModel.parseScheduleCandidate(text, sim);
}
function addScheduleCandidate(work, text, sim) {
  const parsed = parseScheduleCandidate(text, sim);
  if (!parsed) return null;
  const candidate = Object.assign({ id: uid("sc") }, parsed);
  if (!Array.isArray(work.scheduleCandidates)) work.scheduleCandidates = [];
  work.scheduleCandidates.push(candidate);
  return candidate;
}
function applyRecordOrTodo(t, kind, fixedWork, target, sim) {
  const apply = (w) => {
    if (!w) return;
    if (kind === "record") {
      const rec = { id: uid("r"), ts: Date.now(), kind: "decision", text: t };
      w.records.push(rec);
      const candidate = addScheduleCandidate(w, t, sim);
      saveState();
      setAction({ type: "addRecord", workId: w.id, recId: rec.id, candidateId: candidate && candidate.id }, candidate ? `${w.title}에 결정 기록과 일정 후보를 추가했습니다.` : `${w.title}에 결정 기록을 추가했습니다.`);
    } else {
      const td = { id: uid("t"), text: t, done: false, candidate: true, evidence: [] };
      w.todos.push(td);
      const candidate = addScheduleCandidate(w, t, sim);
      saveState();
      setAction({ type: "addTodo", workId: w.id, todoId: td.id, candidateId: candidate && candidate.id }, candidate ? `${w.title}의 할 일과 일정 후보로 추가했습니다.` : `${w.title}의 할 일 후보로 추가했습니다(반영 전).`);
    }
    route();
  };
  if (fixedWork) return apply(fixedWork);
  if (target) return chooseWork(`이 내용을 ‘${target.title}’에 붙일까요? 다른 업무를 골라도 됩니다.`, apply);
  return chooseWork("어느 업무에 붙일까요?", apply);
}
function confirmScheduleCandidate(workId, candidateId) {
  const work = getWork(workId);
  const candidate = work && (work.scheduleCandidates || []).find((item) => item.id === candidateId);
  if (!candidate || candidate.confirmed) return;
  candidate.confirmed = true;
  const record = {
    id: uid("r"),
    ts: Date.now(),
    kind: "schedule",
    text: candidate.label,
    dateISO: candidate.startISO,
    startISO: candidate.startISO,
    endISO: candidate.endISO,
    calendarStatus: "confirmed",
  };
  work.records.push(record);
  saveState();
  setAction({ type: "confirmScheduleCandidate", workId, candidateId, prevConfirmed: false, recId: record.id }, `${work.title} 일정을 확정했습니다.`);
  route();
}
function confirmTarget(t, c, resultBox, sim) {
  chooseWork("어느 업무의 기안인가요?", (w) => { if (w) { S.selectedWorkId = w.id; saveState(); nav("#draft/" + w.id); } }, false);
}
function createWorkFrom(t, dueText, rangeCandidate) {
  const currentPerson = (S.org && S.org.people || []).find((item) => item.id === S.currentPersonId) || null;
  const currentSection = currentPerson && (S.org && S.org.sections || []).find((item) => item.id === currentPerson.sectionId) || null;
  const w = {
    id: uid("w-new-"), seedKey: null,
    title: t.length > 38 ? t.slice(0, 38) + "…" : t,
    instruction: t, requester: "직접 입력", due: null, dueText: dueText || null,
    stageId: null, stageName: "", doneWhen: "완료 조건 확인 필요", repeat: false,
    departmentId: currentSection ? currentSection.departmentId : null,
    sectionId: currentSection ? currentSection.id : null,
    relations: [{ personId: S.currentPersonId, kind: "owner" }],
    schedule: { startISO: null, endISO: null, milestones: [] },
    todos: [{ id: uid("t"), text: "기한·완료 조건 확인", done: false, candidate: false, evidence: [] }],
    records: [], sources: [], draft: { savedAt: null, values: null },
  };
  if (rangeCandidate) w.scheduleCandidates = [Object.assign({ id: uid("sc") }, rangeCandidate)];
  S.works.unshift(w); S.selectedWorkId = w.id; saveState();
  if (rangeCandidate) {
    setAction({ type: "createWork", workId: w.id }, "새 업무를 만들고 일정 후보로 남겼습니다. 날짜 범위를 확인한 뒤 확정해 주세요.");
    return route();
  }
  setAction({ type: "createWork", workId: w.id }, `새 업무로 만들었습니다 — 기한은 ‘${dueText || "기한 미정"}’으로 표시합니다.`);
  nav("#workbench/" + w.id);
}

/* ---------- 질문(근거 답변) ---------- */
let askSeq = 0;
async function renderAsk(box, q, target) {
  if (!box) return;
  const seq = ++askSeq;
  box.innerHTML = `<div class="card ask-panel" data-testid="grounded-answer"><div class="blk-k">근거를 찾는 중…</div></div>`;
  try {
    const r = await api("/api/ask", { question: q });
    if (seq !== askSeq || !document.body.contains(box)) return;
    const ans = (r.llm && r.llm.answer) ? [r.llm.answer] : (r.answer || []); // r.llm = LLM 합성(있을 때만), 없으면 템플릿
    box.innerHTML = `<div class="card ask-panel" data-testid="grounded-answer">
      <div class="blk-k">근거 답변 ${r.grounded ? `<span class="badge grounded">근거 있음</span>` : `<span class="badge warn">근거 없음</span>`}
        ${target ? `<span class="sub"> · 관련 업무: ${esc(target.title)}</span>` : ""}</div>
      <div class="ans">${ans.map((a) => `<p>${esc(a)}</p>`).join("") || "<p>답을 찾지 못했습니다.</p>"}</div>
      ${(r.knowledge || []).slice(0, 6).map((k) => `<div class="k-item">${esc(k.text)}<span class="st">${esc(k.status || "")} ${k.confidence ? (k.confidence * 100 | 0) + "%" : ""}</span>
        ${(k.evidence || []).slice(0, 2).map(evBtn).join("")}</div>`).join("")}
      ${(r.docs || []).length ? `<div class="blk-k" style="margin-top:12px">관련 문서</div>` + r.docs.slice(0, 3).map((d) => evBtn({ docId: d.id, label: d.title })).join("") : ""}
      ${target ? `<div style="margin-top:12px"><button class="btn ghost small" id="askGoWb">이 업무 작업대 열기</button></div>` : ""}
    </div>`;
    bindEvidence(box);
    const g = $("#askGoWb", box); if (g) g.onclick = () => nav("#workbench/" + target.id);
  } catch (e) {
    if (seq !== askSeq || !document.body.contains(box)) return;
    box.innerHTML = `<div class="card ask-panel" data-testid="grounded-answer"><p>답변을 가져오지 못했습니다 — 엔진 연결을 확인해 주세요.</p></div>`;
  }
}

/* ---------- 내 업무: 목록 ---------- */
async function vList(main) {
  const sum = await loadSummary().catch(() => null);
  const fc = await loadForecast().catch(() => ({ items: [] }));
  if (sum) seedFromForecast(fc, sum.simDate);
  const sim = sum ? sum.simDate : null;
  const workMode = UI.workListMode === "completed" ? "completed" : "active";
  let works = workbenchModel.selectWorkList(S, workMode);
  const filtered = UI.listFilter === "repeat";
  if (filtered) works = works.filter((w) => w.repeat);
  works.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));

  main.innerHTML = `<div class="view">
    <h1 class="pg" tabindex="-1">내 업무</h1>
    <div class="list-tools">
      <div class="cap-tabs" role="tablist" aria-label="업무 상태">
        <button class="${workMode === "active" ? "on" : ""}" role="tab" data-mode="active"
          aria-selected="${workMode === "active"}" aria-controls="workCards">진행</button>
        <button class="${workMode === "completed" ? "on" : ""}" role="tab" data-mode="completed"
          aria-selected="${workMode === "completed"}" aria-controls="workCards">완료</button>
      </div>
      ${filtered ? `<span class="filter-chip">반복 업무만 <button id="clrF" aria-label="필터 해제">✕</button></span>` : ""}
      <button class="btn ghost small" id="toCal">달력 보기</button>
      <button class="btn ghost small" id="newWork" style="margin-left:auto">+ 새 업무</button>
    </div>
    <div id="workCards" role="tabpanel">${works.length ? "" : `<div class="empty">${workMode === "completed" ? "완료한 업무가 없습니다." : "업무가 없습니다 — 홈에서 지시를 적거나 새 업무를 만들어 보세요."}</div>`}</div>
  </div>`;
  const box = $("#workCards");
  for (const w of works) {
    const nt = nextTodo(w);
    const dd = ddayOf(w.due, sim);
    const headline = workbenchModel.headlineFor(w, sim);
    const b = document.createElement("button");
    b.className = "work-card";
    b.dataset.workId = w.id;
    b.dataset.workPhase = headline.phaseKey;
    b.innerHTML = `<span class="t">${esc(w.title)}
        ${w.repeat ? `<span class="badge repeat">반복</span>` : ""}
        ${!w.due ? `<span class="badge nodue">기한 확인 필요</span>` : ""}
        <span class="badge stage">${esc(headline.phaseLabel)}</span></span>
      <span class="meta"><span>지시: ${esc(w.requester || "—")}</span>
        <span>${headline.isComplete ? "완료일" : "마감"}: <b>${headline.isComplete
          ? fmtD(headline.dateISO)
          : (w.due ? fmtD(w.due) + (dd != null ? " · " + ddayLabel(dd) : "") : esc(w.dueText || "기한 미정"))}</b></span>
        ${headline.isComplete ? "" : `<span>진행 ${progress(w)}%</span>`}</span>
      ${headline.isComplete ? "" : (nt ? `<span class="next">다음: ${esc(nt.text)}</span>` : `<span class="next">모든 할 일 완료 — ${esc(w.doneWhen)}</span>`)
      }${headline.isComplete ? "" : `<span class="prog"><i style="width:${progress(w)}%"></i></span>`}`;
    b.onclick = () => { S.selectedWorkId = w.id; saveState(); nav("#workbench/" + w.id); };
    box.appendChild(b);
  }
  $$('[role="tab"][data-mode]', main).forEach((tab) => {
    tab.onclick = () => {
      UI.workListMode = tab.dataset.mode;
      saveUI();
      route();
    };
  });
  $("#toCal").onclick = () => nav("#schedule");
  $("#newWork").onclick = () => createWorkFrom("새 업무 — 제목을 지시로 바꿔 주세요", null);
  const clr = $("#clrF"); if (clr) clr.onclick = () => { UI.listFilter = null; saveUI(); route(); };
}

/* ---------- 일정: 월간 조직 레이어 ---------- */
function scheduleAddDays(iso, amount) {
  if (!isValidISODate(iso)) return null;
  const parts = iso.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + amount, 12));
  return date.toISOString().slice(0, 10);
}
function scheduleMonthWindow(year, month) {
  const monthISO = `${year}-${String(month).padStart(2, "0")}`;
  const firstISO = `${monthISO}-01`;
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const last = new Date(Date.UTC(year, month, 0, 12));
  const lastISO = last.toISOString().slice(0, 10);
  const startISO = scheduleAddDays(firstISO, -first.getUTCDay());
  const endISO = scheduleAddDays(lastISO, 6 - last.getUTCDay());
  const days = [];
  for (let iso = startISO; iso <= endISO; iso = scheduleAddDays(iso, 1)) days.push(iso);
  return { startISO, endISO, days, weeks: Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7)) };
}
function scheduleEventLabel(event2) {
  const prefix = event2.kind === "personal" ? "개인 일정" : "업무 일정";
  return `${prefix}, ${event2.label}, ${homeEventDateLabel(event2)}`;
}
function renderScheduleEvent(event2, days, row, firstMarkers) {
  const first = days[0];
  const last = days[6];
  const visibleStart = event2.startISO < first ? first : event2.startISO;
  const visibleEnd = event2.endISO > last ? last : event2.endISO;
  const column = days.indexOf(visibleStart) + 1;
  const span = days.indexOf(visibleEnd) - days.indexOf(visibleStart) + 1;
  const isFirst = !firstMarkers.has(event2.id);
  if (isFirst) firstMarkers.add(event2.id);
  const milestones = (event2.milestones || []).filter((item) => item.dateISO >= visibleStart && item.dateISO <= visibleEnd);
  return `<button type="button" class="schedule-event schedule-event--${esc(event2.kind)} scope-${esc(event2.primaryScope)}"
    style="grid-column:${column} / span ${span};grid-row:${row}"
    ${isFirst ? `data-schedule-event="${esc(event2.id)}"` : `data-schedule-continuation="${esc(event2.id)}"`}
    data-event-kind="${esc(event2.kind)}" data-event-id="${esc(event2.id)}" data-work-id="${esc(event2.workId || "")}"
    data-primary-scope="${esc(event2.primaryScope)}" data-visible-scopes="${esc((event2.visibleScopes || []).join(" "))}"
    aria-label="${esc(scheduleEventLabel(event2))}" title="${esc(event2.label)}">
    <span class="schedule-event-label">${esc(event2.label)}</span>
    ${milestones.map((item) => `<span class="schedule-milestone" title="${esc(`${fmtD(item.dateISO)} · ${item.label}`)}"><i aria-hidden="true"></i>${esc(item.label)}</span>`).join("")}
  </button>`;
}
function renderScheduleWeek(days, events, monthPrefix, sim, firstMarkers) {
  const first = days[0];
  const last = days[6];
  const weekEvents = events
    .filter((event2) => event2.startISO <= last && event2.endISO >= first)
    .sort((a, b) => a.startISO.localeCompare(b.startISO) || b.endISO.localeCompare(a.endISO) || a.label.localeCompare(b.label));
  const lanes = Math.max(2, weekEvents.length);
  const dayCells = days.map((iso, index) => {
    const date = homeISODateParts(iso);
    const isOutside = !iso.startsWith(monthPrefix);
    return `<div class="schedule-day${isOutside ? " is-outside" : ""}${iso === sim ? " is-current" : ""}" style="grid-column:${index + 1};grid-row:1 / span ${lanes + 1}" data-schedule-date="${iso}">
      <time datetime="${iso}"${iso === sim ? ' aria-current="date"' : ""}>${date.day}</time>
      <button class="schedule-add-personal" type="button" data-add-personal="${iso}" aria-label="${date.year}년 ${date.month}월 ${date.day}일에 개인 일정 추가">+</button>
    </div>`;
  }).join("");
  const bars = weekEvents.map((event2, index) => renderScheduleEvent(event2, days, index + 2, firstMarkers)).join("");
  return `<div class="schedule-week" style="grid-template-rows:52px repeat(${lanes},38px)">${dayCells}${bars}</div>`;
}
async function vCalendar(main) {
  const sum = await loadSummary().catch(() => null);
  const fc = await loadForecast().catch(() => ({ items: [] }));
  if (sum) seedFromForecast(fc, sum.simDate);
  const sim = sum ? sum.simDate : "2026-01-02";
  if (!UI.calYM) UI.calYM = sim.slice(0, 7);
  if (!Array.isArray(UI.scheduleScopes)) UI.scheduleScopes = [workspaceModel.SCOPE.MINE];
  const [Y, M] = UI.calYM.split("-").map(Number);
  const calendarWindow = scheduleMonthWindow(Y, M);
  const events = workspaceModel.selectScheduleEvents(S, calendarWindow, UI.scheduleScopes);
  const firstMarkers = new Set();
  const scopeItems = [
    { value: workspaceModel.SCOPE.MINE, label: "내 업무" },
    { value: workspaceModel.SCOPE.SECTION, label: "우리 과" },
    { value: workspaceModel.SCOPE.DEPARTMENT, label: "부서 전체" },
  ];

  main.innerHTML = `<div class="view schedule-view">
    <div class="schedule-title-row">
      <div><h1 class="pg" tabindex="-1">일정</h1><p class="sub">업무는 전체 기간으로, 개인 일정은 녹색으로 표시합니다.</p></div>
      <a class="btn ghost small" href="#work/list">내 업무 목록</a>
    </div>
    <div class="schedule-toolbar">
      <fieldset class="schedule-layers" aria-label="표시 범위">
        <legend class="sr-only">표시 범위</legend>
        ${scopeItems.map((item) => `<label><input type="checkbox" value="${item.value}"${UI.scheduleScopes.includes(item.value) ? " checked" : ""}><span>${item.label}</span></label>`).join("")}
      </fieldset>
      <div class="schedule-month-controls">
        <button class="icon-btn" id="calPrev" type="button" aria-label="이전 달">‹</button>
        <h2>${Y}년 ${M}월</h2>
        <button class="icon-btn" id="calNext" type="button" aria-label="다음 달">›</button>
      </div>
    </div>
    ${UI.scheduleScopes.length ? `<div class="schedule-scroll" role="region" aria-label="${Y}년 ${M}월 조직 일정" tabindex="0">
      <div class="schedule-calendar">
        <div class="schedule-weekdays" aria-hidden="true">${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}</div>
        ${calendarWindow.weeks.map((week) => renderScheduleWeek(week, events, UI.calYM, sim, firstMarkers)).join("")}
      </div>
    </div>` : '<div class="empty schedule-empty">표시할 범위를 선택하세요</div>'}
    <div class="schedule-legend" aria-label="일정 색상 안내">
      <span><i class="legend-mine"></i>내 업무</span><span><i class="legend-section"></i>우리 과</span><span><i class="legend-department"></i>부서 전체</span><span><i class="legend-personal"></i>개인 일정</span>
    </div>
  </div>`;

  $$(".schedule-layers input", main).forEach((input) => {
    input.onchange = () => {
      UI.scheduleScopes = workspaceModel.toggleScheduleScope(UI.scheduleScopes, input.value);
      saveUI(); route();
    };
  });
  $("#calPrev", main).onclick = () => { const date = new Date(Date.UTC(Y, M - 2, 1)); UI.calYM = date.toISOString().slice(0, 7); saveUI(); route(); };
  $("#calNext", main).onclick = () => { const date = new Date(Date.UTC(Y, M, 1)); UI.calYM = date.toISOString().slice(0, 7); saveUI(); route(); };
  $$("[data-add-personal]", main).forEach((button) => { button.onclick = () => openPersonalScheduleDrawer(null, button.dataset.addPersonal); });
  $$(".schedule-event", main).forEach((button) => {
    button.onclick = () => {
      if (button.dataset.eventKind === "personal") openPersonalScheduleDrawer(button.dataset.eventId);
      else { S.selectedWorkId = button.dataset.workId; saveState(); nav("#workbench/" + button.dataset.workId); }
    };
  });
}
function renderPersonalScheduleCandidate(resultBox, candidate) {
  if (!resultBox) return;
  resultBox.innerHTML = `<div class="card personal-candidate" role="status">
    <div class="blk-k">개인 일정 후보 · 확인 전</div>
    <p><b>${esc(candidate.label)}</b></p>
    <p class="sub">${esc(homeEventDateLabel(candidate))}</p>
    <div class="candidate-actions">
      <button class="btn small" id="confirmPersonalSchedule" type="button">개인 일정으로 확정</button>
      <button class="btn ghost small" id="cancelPersonalSchedule" type="button">취소</button>
    </div>
  </div>`;
  $("#confirmPersonalSchedule", resultBox).onclick = () => {
    const personal = {
      id: uid("personal-"),
      title: candidate.label,
      startISO: candidate.startISO,
      endISO: candidate.endISO,
      ownerId: S.currentPersonId,
      status: "active",
    };
    if (!Array.isArray(S.personalSchedules)) S.personalSchedules = [];
    S.personalSchedules.push(personal);
    saveState();
    setAction({ type: "addPersonalSchedule", personalId: personal.id }, "개인 일정을 확정했습니다.");
    route();
  };
  $("#cancelPersonalSchedule", resultBox).onclick = () => { resultBox.innerHTML = ""; };
}

/* ---------- 클라우드 ---------- */
function vCloud(main) {
  main.innerHTML = `<div class="view cloud-view">
    <h1 class="pg" tabindex="-1">클라우드</h1>
    <div class="card cloud-empty">
      <div class="cloud-empty-icon" aria-hidden="true">${homeIcon("cloud")}</div>
      <h2>연결된 자료가 아직 없습니다</h2>
      <p>공사 자료와 업무 산출물은 데이터 연결 단계에서 이곳에 모입니다.</p>
      <p class="sub">지금은 화면 흐름만 확인할 수 있으며, 임의의 문서나 과거 데이터를 만들지 않습니다.</p>
    </div>
  </div>`;
}

/* ---------- 업무 작업대 ---------- */
async function vWorkbench(main, id) {
  const sum = await loadSummary().catch(() => null);
  const fc = await loadForecast().catch(() => ({ items: [] }));
  if (sum) seedFromForecast(fc, sum.simDate);
  const w = getWork(id);
  if (!w) return vNotFound(main, "업무를 찾을 수 없습니다", id);
  S.selectedWorkId = w.id; saveState();
  const sim = sum ? sum.simDate : null;
  const headline = workbenchModel.headlineFor(w, sim);
  const ownerPerson = (S.org && S.org.people || []).find((person) =>
    (w.relations || []).some((relation) => relation && relation.kind === "owner" && relation.personId === person.id));
  const ownerSection = ownerPerson && (S.org && S.org.sections || []).find((section) => section.id === ownerPerson.sectionId);
  const ownerLabel = [ownerSection && ownerSection.name, ownerPerson && ownerPerson.name].filter(Boolean).join(" · ")
    || w.requester || "담당자 미정";
  const headlineDday = ddayLabel(headline.dday);
  const bf = await loadBriefing().catch(() => null);
  const nt = nextTodo(w);
  const cautions = bf && Array.isArray(bf.cautions) ? bf.cautions.slice(0, 2) : [];
  const showcaseSources = (w.sources || []).filter((source) => source && source.docId);
  const showcaseStage = bf && Array.isArray(bf.stages) ? bf.stages.find((stage) => stage && stage.id === w.stageId) : null;
  const showcaseDue = w.due ? fmtD(w.due) : "확인 필요";
  const showcaseOutput = w.draft && w.draft.savedAt ? "저장된 초안 있음" : "확인 필요";

  main.innerHTML = `<div class="view" data-testid="workbench" data-work-id="${esc(w.id)}">
    <a class="wb-back" href="#work/list">← 내 업무</a>
    <header class="workbench-headline">
      <div class="workbench-headline__title">
        <p class="eyebrow">현재 업무</p>
        <h1 class="pg" data-work-title>${esc(w.title)}</h1>
        <div class="workbench-headline__meta">
          <span class="phase-badge" data-work-phase="${esc(headline.phaseKey)}">${esc(headline.phaseLabel)}</span>
          <span data-owner>${esc(ownerLabel)}</span>
        </div>
      </div>
      <div class="workbench-deadline">
        <span data-date-label>${headline.dateISO ? esc(headline.dateLabel) : "일정 미정"}</span>
        <strong data-dday>${headlineDday}</strong>
        ${headline.dateISO
          ? `<time data-date-iso datetime="${esc(headline.dateISO)}">${fmtD(headline.dateISO)}</time>`
          : `<time data-date-iso></time><button class="btn ghost small" type="button" data-add-work-date>날짜 추가</button>`}
      </div>
      ${headline.isComplete ? "" : '<button class="btn" type="button" data-complete-work>업무 완료</button>'}
    </header>
    <section class="card wb-context">
      <div class="inst">${esc(w.instruction || "원래 지시가 기록되지 않았습니다")}</div>
      <div class="kv">
        <span>지시자 <b>${esc(w.requester || "—")}</b></span>
        <span>기한 <b>${w.due ? fmtD(w.due) + " (" + ddayLabel(ddayOf(w.due, sim)) + ")" : esc(w.dueText || "기한 미정")}</b></span>
        <span>단계 <b>${w.stageName ? esc(w.stageName) : "—"}</b>${w.stageId ? ` <button class="ev-btn" data-ev="okf:${esc(w.stageId)}">근거 · 단계 지식</button>` : ""}</span>
        <span>완료 조건 <b>${esc(w.doneWhen || "확인 필요")}</b></span>
        <span>진행 <b>${progress(w)}%</b></span>
      </div>
    </section>

    <section class="card" data-testid="workbench-showcase">
      <div class="blk-k">업무 시연 요약</div>
      <div class="kv">
        <span data-showcase="due">언제 해야 하는가 <b>${esc(showcaseDue)}</b></span>
        <span data-showcase="sources">무엇을 참고해야 하는가 <b>${showcaseSources.length ? showcaseSources.map((source) => evBtn({ docId: source.docId, label: source.docId })).join("") : "연결된 자료 없음"}</b></span>
        <span data-showcase="criterion">어떤 기준을 지켜야 하는가 <b>${showcaseStage && showcaseStage.desc ? `${esc(showcaseStage.name || showcaseStage.id)} · ${esc(showcaseStage.desc)} ${evBtn({ docId: `okf:${showcaseStage.id}`, label: showcaseStage.name || showcaseStage.id })}` : "확인 필요"}</b></span>
        <span data-showcase="output">무엇을 만들어야 하는가 <b>${esc(showcaseOutput)}</b></span>
      </div>
    </section>

    <section class="card wb-now">
      <div class="k">${headline.isComplete ? "완료 당시 남은 일" : "지금 할 일"}</div>
      ${headline.isComplete
        ? `<p class="sub workbench-readonly">완료 당시 기록을 읽기 전용으로 보여드립니다.</p>${nt ? `<div class="todo-line"><div class="tx"><b>${esc(nt.text)}</b></div></div>` : "<p>완료 당시 남은 일이 없습니다.</p>"}`
        : (nt ? `<div class="todo-line">
          <button class="todo-check" role="checkbox" aria-checked="false" data-td="${esc(nt.id)}" aria-label="완료: ${esc(nt.text)}">✓</button>
          <div class="tx"><b>${esc(nt.text)}</b><div>${(nt.evidence || []).map(evBtn).join("") || `<span class="sub">연결된 근거 없음</span>`}
          ${nt.action === "draft" ? `<button class="ev-btn" id="goDraft1">기안 집중 화면 →</button>` : ""}
          ${nt.action === "check" ? `<button class="ev-btn" id="goCheck1">제출 전 점검 →</button>` : ""}</div></div>
        </div>` : `<p>남은 할 일이 없습니다 — 완료 조건(${esc(w.doneWhen)})을 확인하세요.</p>`)}
    </section>

    <section class="card">
      <div class="blk-k">전체 체크리스트 <span class="sub">완료 ${w.todos.filter((t) => t.done && !t.candidate).length}/${w.todos.filter((t) => !t.candidate).length}</span></div>
      <div id="todoList">
        ${w.todos.map((t) => headline.isComplete
          ? `<div class="todo${t.done ? " done" : ""}${t.candidate ? " cand" : ""}">${t.candidate ? '<span class="cand-k">할 일 후보</span>' : ""}
              <div class="tx">${esc(t.text)}</div></div>`
          : (t.candidate
            ? `<div class="todo cand"><span class="cand-k">할 일 후보 — 진행률 미반영</span><div class="tx">${esc(t.text)}</div>
              <div class="ops"><button class="btn small" data-promote="${esc(t.id)}">반영</button><button class="btn ghost small" data-del="${esc(t.id)}">삭제</button></div></div>`
            : `<div class="todo${t.done ? " done" : ""}">
              <button class="todo-check" role="checkbox" aria-checked="${t.done}" data-td="${esc(t.id)}" aria-label="${t.done ? "완료 해제" : "완료"}: ${esc(t.text)}">✓</button>
              <div class="tx">${esc(t.text)}<div>${(t.evidence || []).map(evBtn).join("")}</div></div>
            </div>`)).join("")}
      </div>
    </section>

    <section class="card">
      <div class="blk-k">진행 기록</div>
      <div id="recList">${w.records.length ? w.records.slice().sort((a, b) => b.ts - a.ts).map((r) => `
        <div class="rec ${esc(r.kind)}"><span class="dot"></span>
          <div><div>${esc(r.text)}</div><span class="ts">${fmtTs(r.ts)}${r.kind === "hint" ? " · 다음 담당자 메모로 남김" : ""}</span></div>
          ${!headline.isComplete && r.kind !== "hint" ? `<div class="ops"><button class="btn ghost small" data-hint="${esc(r.id)}">다음 담당자에게</button></div>` : ""}
        </div>`).join("") : `<p class="sub">아직 기록이 없습니다 — 아래 입력창에 결정·변경을 적어 보세요.</p>`}</div>
      <div id="hintFlow"></div>
    </section>

    ${headline.isComplete ? "" : `<section class="card">
      <div class="blk-k">자료 붙이기 <span class="sub">문서를 이 업무의 근거로 저장합니다(검토 후 반영)</span></div>
      <label class="attach-zone" id="dropZone">파일 선택(HWP·PDF·DOCX·XLSX·TXT) 또는 아래에 붙여넣기
        <input type="file" id="fileIn" accept=".hwp,.hwpx,.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv">
      </label>
      <textarea id="pasteIn" rows="3" style="width:100%;margin-top:8px;border:1px solid var(--line-strong);border-radius:10px;padding:10px;font-family:inherit;background:var(--surface);color:var(--ink)" placeholder="문서 내용을 붙여넣어도 됩니다"></textarea>
      <div style="margin-top:8px"><button class="btn ghost small" id="ingestBtn">검토 후보 만들기</button></div>
      <div id="ingestPanel"></div>
    </section>`}

    <section class="card wb-output">
      <div class="blk-k">만들어야 할 결과물</div>
      <div class="kv" style="margin-bottom:10px">
        <span>산출물 <b>${esc(w.title)}(안)</b></span>
        <span>임시 저장 <b>${w.draft && w.draft.savedAt ? fmtTs(w.draft.savedAt) : "없음"}</b></span>
      </div>
      ${headline.isComplete ? '<p class="sub">완료 당시 결과물 정보입니다.</p>' : `<button class="btn" id="goDraft">기안 ${w.draft && w.draft.savedAt ? "이어서 쓰기" : "시작"}</button>`}
      ${cautions.length ? `<div class="blk-k" style="margin-top:14px">제출 전 주의</div>` + cautions.map((c) => `
        <div class="k-item">${esc(c.text)}${(c.evidence || []).slice(0, 2).map(evBtn).join("")}</div>`).join("") : ""}
    </section>

    ${headline.isComplete ? "" : `<form class="wb-input" id="wbOmni">
      <input id="wbIn" type="text" autocomplete="off" placeholder="이 업무에 이어서 말하기 — 질문·결정·할 일" aria-label="이 업무에 이어서 말하기">
      <button class="btn" type="submit">말하기</button>
    </form>`}
    <div id="wbResult"></div>
  </div>`;

  bindEvidence(main);
  $$("[data-td]", main).forEach((b) => {
    b.onclick = () => {
      const t = w.todos.find((x) => x.id === b.dataset.td); if (!t) return;
      const prev = t.done; t.done = !t.done; saveState();
      setAction({ type: "toggleTodo", workId: w.id, todoId: t.id, prev }, t.done ? `완료: ${t.text}` : `완료 해제: ${t.text}`);
      route();
    };
  });
  $$("[data-promote]", main).forEach((b) => {
    b.onclick = () => {
      const t = w.todos.find((x) => x.id === b.dataset.promote); if (!t) return;
      t.candidate = false; saveState();
      setAction({ type: "promoteTodo", workId: w.id, todoId: t.id }, "체크리스트에 반영했습니다 — 진행률에 포함됩니다.");
      route();
    };
  });
  $$("[data-del]", main).forEach((b) => {
    b.onclick = () => { w.todos = w.todos.filter((x) => x.id !== b.dataset.del); saveState(); lastAction = null; lastActionMessage = ""; hideToast(); route(); };
  });
  $$("[data-hint]", main).forEach((b) => { b.onclick = () => hintFlow(w, w.records.find((r) => r.id === b.dataset.hint)); });
  const gd = $("#goDraft"); if (gd) gd.onclick = () => nav("#draft/" + w.id);
  const gd1 = $("#goDraft1"); if (gd1) gd1.onclick = () => nav("#draft/" + w.id);
  const gc1 = $("#goCheck1"); if (gc1) gc1.onclick = () => nav("#draft/" + w.id);
  const wbOmni = $("#wbOmni");
  if (wbOmni) wbOmni.onsubmit = (e) => {
      e.preventDefault();
      const input = $("#wbIn");
      const text = input.value;
      input.value = "";
      handleOmni(text, w, $("#wbResult"), sim);
    };
  const fileIn = $("#fileIn");
  if (fileIn) fileIn.onchange = (e) => { if (e.target.files[0]) ingestFlow(w, e.target.files[0], null); };
  const ingestBtn = $("#ingestBtn");
  if (ingestBtn) ingestBtn.onclick = () => { const t = $("#pasteIn").value.trim(); if (t) ingestFlow(w, null, t); };
}

/* ---------- 다음 담당자 메모(힌트) ---------- */
async function hintFlow(w, rec) {
  if (!rec) return;
  const box = $("#hintFlow");
  box.innerHTML = `<div class="k-item">다음 담당자 메모로 구조화하는 중…</div>`;
  try {
    const r = await api("/api/hint/stage", { text: rec.text, stageId: w.stageId || null });
    const trs = (r && r.triples) || [];
    if (!trs.length) { box.innerHTML = `<div class="k-item">구조화할 내용을 찾지 못했습니다 — 문장을 조금 더 구체적으로 적어 보세요.</div>`; return; }
    box.innerHTML = `<div class="card" style="margin-top:10px"><div class="blk-k">다음 담당자에게 이렇게 남길까요?</div>
      ${trs.slice(0, 3).map((t, i) => `<label class="cand-item"><input type="radio" name="hintTr" value="${i}" ${i === 0 ? "checked" : ""}>
        <span>${esc(t.from.name)} — ${esc(relLabel(t.rel))} — ${esc(t.to.name)}</span></label>`).join("")}
      <div style="margin-top:8px"><button class="btn small" id="hintCommit">남기기</button>
      <button class="btn ghost small" id="hintCancel">취소</button></div></div>`;
    $("#hintCancel").onclick = () => { box.innerHTML = ""; };
    $("#hintCommit").onclick = async () => {
      const i = +($('input[name="hintTr"]:checked') || { value: 0 }).value;
      try {
        await api("/api/hint/commit", { triple: trs[i], text: rec.text });
        rec.kind = "hint"; saveState();
        box.innerHTML = "";
        toast("다음 담당자 브리핑에 반영되었습니다.");
        route();
      } catch (e) { box.innerHTML = `<div class="k-item">반영에 실패했습니다 — 잠시 후 다시 시도해 주세요.</div>`; }
    };
  } catch (e) { box.innerHTML = `<div class="k-item">엔진 연결을 확인해 주세요.</div>`; }
}
function relLabel(rel) {
  return { causes_risk: "이런 위험이 있음", mitigated_by: "이렇게 예방함", is_controlled_by: "이 규칙을 지킴", requires_document: "이 문서가 필요함", cross_checks: "서로 대조 확인", involves_actor: "협의 대상", has_tacit_knowledge: "업무 요령", references_contract_type: "계약 유형" }[rel] || "관련";
}

/* ---------- 자료 붙이기(인제스트) ---------- */
function bufToB64(buf) {
  const u8 = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function extractFileText(file) {
  const buf = await file.arrayBuffer();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "hwp") return await extractHwp(buf);
  if (ext === "hwpx") return { text: await extractHwpx(buf) };
  if (ext === "docx") return { text: await extractDocx(buf) };
  if (ext === "pptx") return { text: await extractPptx(buf) };
  if (ext === "xlsx") return { text: await extractXlsx(buf) };
  if (ext === "pdf") {
    const r = await extractPdf(buf);
    if (r.text && r.text.length >= 10) return r;
    // 텍스트 레이어 없음 → 서버 비전 추출 폴백
    if (buf.byteLength > 8 * 1024 * 1024) throw new Error("스캔본이 8MB를 넘습니다 — 페이지를 나눠 첨부해 주세요.");
    const sr = await api("/api/extract", { filename: file.name, mime: "application/pdf", dataB64: bufToB64(buf) });
    if (sr.ok === false) {
      const reason = typeof sr.reason === "string" ? sr.reason.trim() : "";
      if (!reason) throw new Error("스캔 PDF 텍스트 추출 응답이 올바르지 않습니다.");
      throw new Error(reason);
    }
    if (sr.ok !== true || typeof sr.text !== "string" || !sr.text.trim()) {
      throw new Error("스캔 PDF 텍스트 추출 응답이 올바르지 않습니다.");
    }
    return { text: sr.text };
  }
  if (["txt", "md", "csv"].includes(ext)) return { text: decodeSmart(buf) };
  throw new Error("지원하지 않는 형식입니다(." + ext + ") — 텍스트를 붙여넣어 주세요.");
}
async function ingestFlow(w, file, pastedText) {
  const panel = $("#ingestPanel");
  panel.innerHTML = `<div class="k-item">문서를 읽는 중…</div>`;
  let text = pastedText;
  try {
    if (file) {
      const r = await extractFileText(file);
      text = r.text;
      if (r.warn && r.note) toast(r.note);
    }
    if (!text || text.trim().length < 10) throw new Error("추출된 내용이 너무 짧습니다.");
    panel.innerHTML = `<div class="k-item">업무 관계 후보를 만드는 중…</div>`;
    const r = await api("/api/ingest", { text });
    if (r.guard && r.guard.flagged) {
      panel.innerHTML = `<div class="f-item r">사람에 대한 평가로 읽힐 수 있는 표현이 있어요.<div class="fx">${esc(r.guard.suggestion || "업무 절차 표현으로 바꿔서 다시 시도해 주세요.")}</div></div>`;
      return;
    }
    const trs = r.triples || [];
    const cp = r.caseProposal || null;
    panel.innerHTML = `<div class="card" style="margin-top:10px">
      <div class="blk-k">검토 후 반영 — 이 문서에서 찾은 업무 관계 ${trs.length}건</div>
      <div style="max-height:260px;overflow-y:auto">
        ${trs.map((t, i) => `<label class="cand-item"><input type="checkbox" data-tr="${i}" checked>
          <span>${esc(t.from.name)} — ${esc(relLabel(t.rel))} — ${esc(t.to.name)}
          <span class="sub">(${((t.confidence || 0) * 100) | 0}%)</span></span></label>`).join("") || `<p class="sub">규칙으로 찾은 관계가 없습니다 — 문서 원문은 그대로 저장됩니다.</p>`}
      </div>
      ${cp ? `<div class="blk-k" style="margin-top:12px">대표 사례로도 정리할까요?</div>
        <label class="cand-item"><input type="radio" name="caseD" value="create" ${cp.suggest === "create" ? "checked" : ""}> 새 사례로 만들기</label>
        ${cp.matchedCaseId ? `<label class="cand-item"><input type="radio" name="caseD" value="merge" ${cp.suggest === "merge" ? "checked" : ""}> 기존 사례에 합치기 (${esc(cp.matchedCaseTitle || cp.matchedCaseId)})</label>` : ""}
        <label class="cand-item"><input type="radio" name="caseD" value="skip" ${!cp.suggest || cp.suggest === "ambiguous" ? "checked" : ""}> 이번에는 넘어가기</label>` : ""}
      <div style="margin-top:10px"><button class="btn small" id="ingCommit">반영</button>
      <button class="btn ghost small" id="ingCancel">취소</button></div></div>`;
    $("#ingCancel").onclick = () => { panel.innerHTML = ""; };
    $("#ingCommit").onclick = async () => {
      const sel = $$("#ingestPanel [data-tr]").filter((c) => c.checked).map((c) => trs[+c.dataset.tr]);
      let caseDecision = null;
      if (cp) {
        const v = ($('input[name="caseD"]:checked') || { value: "skip" }).value;
        caseDecision = { action: v };
        if (v === "merge" && cp.matchedCaseId) caseDecision.caseId = cp.matchedCaseId;
      }
      try {
        const cr = await api("/api/ingest/commit", { doc: r.doc, triples: sel, caseDecision });
        const docId = (cr && cr.doc && cr.doc.id) || (r.doc && r.doc.id);
        if (docId) { w.sources.push({ docId, role: "붙인 자료" }); saveState(); setAction({ type: "attachSource", workId: w.id, docId }, "자료를 이 업무의 근거로 저장했습니다."); }
        panel.innerHTML = "";
        route();
      } catch (e) { panel.innerHTML = `<div class="f-item r">반영에 실패했습니다 — 잠시 후 다시 시도해 주세요.</div>`; }
    };
  } catch (e) {
    panel.innerHTML = `<div class="f-item r">${esc(e.message || "문서를 읽지 못했습니다.")}</div>`;
  }
}

/* ---------- 기안 집중 화면 ---------- */
async function vDraft(main, id) {
  const w = getWork(id);
  if (!w) return vNotFound(main, "업무를 찾을 수 없습니다", id, true);
  S.selectedWorkId = w.id; saveState();
  main.innerHTML = `<div class="view">
    <a class="wb-back" href="#workbench/${esc(w.id)}">← 같은 업무 작업대로</a>
    <h1 class="pg" tabindex="-1">기안 집중 — ${esc(w.title)}</h1>
    <div id="draftBody"><div class="card"><p class="sub">작년 양식을 불러오는 중…</p></div></div>
  </div>`;
  const body = $("#draftBody");
  if (!w.stageId) {
    body.innerHTML = `<div class="card"><p>이 업무는 아직 단계가 정해지지 않아 과거 양식을 찾을 수 없습니다.</p>
      <p class="sub" style="margin-top:6px">아래에 초안을 직접 쓰고 제출 전 점검만 활용할 수 있습니다.</p>
      <textarea id="freeDraft" rows="8" style="width:100%;margin-top:10px;border:1px solid var(--line-strong);border-radius:10px;padding:12px;font-family:inherit;background:var(--surface);color:var(--ink)">${esc((w.draft && w.draft.freeText) || "")}</textarea>
      <div class="draft-tools"><button class="btn ghost" id="dSave">임시 저장</button><button class="btn" id="dCheck">제출 전 점검</button></div>
      <div id="checkOut" data-testid="precheck-results"></div></div>`;
    $("#dSave").onclick = () => { w.draft = { savedAt: Date.now(), freeText: $("#freeDraft").value }; saveState(); toast("임시 저장했습니다."); };
    $("#dCheck").onclick = () => runCheck($("#freeDraft").value, $("#checkOut"));
    return;
  }
  try {
    const r = await api("/api/draft", { task: w.stageId });
    if (!r.ok) { body.innerHTML = `<div class="card"><p>${esc(r.reason || "초안을 만들 수 없습니다.")}</p></div>`; return; }
    const vals = (w.draft && w.draft.values) || {};
    let phIdx = 0;
    body.innerHTML = `<div class="draft-doc" data-testid="draft-document">
      <h2>${esc(r.title)}</h2>
      <p class="sub" style="text-align:center;margin-bottom:14px">작년 문서(${esc(r.baseTitle)} · ${esc(r.baseDate)}) 구조 기준
        <button class="ev-btn" data-ev="${esc(r.baseDocId)}">근거 · 작년 원문</button></p>
      ${r.sections.map((s) => `<h3>${esc(s.h || "")}</h3><p>${s.tokens.map((t) => {
        if (t.text != null) return esc(t.text);
        const k = "p" + (phIdx++);
        const val = vals[k] || "";
        return `<span class="ph ${t.ph}" title="${esc(t.label)}"><input data-ph="${k}" value="${esc(val)}" placeholder="${esc(t.original)}" aria-label="${esc(t.label)}"></span>`;
      }).join("")}</p>`).join("")}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="blk-k">확인 목록</div>
      <ul class="checklist">${(r.checklist || []).map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>
      <div class="draft-tools">
        <button class="btn ghost" id="dSave">임시 저장</button>
        <button class="btn" id="dCheck">제출 전 점검</button>
        <span class="sub" id="saveStamp">${w.draft && w.draft.savedAt ? "저장됨 " + fmtTs(w.draft.savedAt) : ""}</span>
      </div>
      <div id="checkOut" data-testid="precheck-results"></div>
    </div>`;
    bindEvidence(body);
    const collectValues = () => { const o = {}; $$("[data-ph]", body).forEach((i) => { if (i.value.trim()) o[i.dataset.ph] = i.value.trim(); }); return o; };
    $("#dSave").onclick = () => { w.draft = { savedAt: Date.now(), values: collectValues() }; saveState(); $("#saveStamp").textContent = "저장됨 " + fmtTs(w.draft.savedAt); toast("임시 저장했습니다 — 새로고침해도 유지됩니다."); };
    $("#dCheck").onclick = () => {
      let pi = 0;
      const vals = collectValues();
      const text = r.title + "\n" + r.sections.map((s) => (s.h || "") + "\n" + s.tokens.map((t) => {
        if (t.text != null) return t.text;
        const k = "p" + (pi++);
        return vals[k] || ("[" + t.label + "]"); // 미입력은 라벨 그대로 — ‘확인 필요’ 잔존을 점검이 잡아낸다
      }).join("")).join("\n");
      runCheck(text, $("#checkOut"));
    };
  } catch (e) {
    body.innerHTML = `<div class="card"><p>엔진 연결을 확인해 주세요.</p></div>`;
  }
}
async function runCheck(text, out) {
  out.innerHTML = `<p class="sub" style="margin-top:12px">과거 반려·감사 이력과 대조하는 중…</p>`;
  try {
    const r = await api("/api/check", { text });
    out.innerHTML = r.count === 0
      ? `<div class="f-item" style="border-color:var(--mint);background:var(--mint-soft)">지적 이력과 겹치는 위험 표현이 없습니다.</div>`
      : r.findings.map((f) => `<div class="f-item ${f.cls === "r" ? "r" : ""}"><b>${esc(f.name)}</b> <span class="sub">${esc(f.level)}</span>
          <div class="fx">${esc(f.desc)}</div><div class="fx">보완: ${esc(f.fix)}</div>
          <div>${(f.evidence || []).slice(0, 3).map(evBtn).join("")}</div></div>`).join("");
    bindEvidence(out);
  } catch (e) { out.innerHTML = `<div class="f-item r">점검을 실행하지 못했습니다 — 엔진 연결을 확인해 주세요.</div>`; }
}

/* ---------- 지식 지도 / 소개 / 미발견 ---------- */
async function vGraph(main) {
  main.innerHTML = `<div class="view"><h1 class="pg" tabindex="-1">업무 지식 지도</h1>
    <p class="sub" style="margin-bottom:12px">이 자리에 축적된 업무 지식을 이름으로 찾아 관계와 근거를 확인합니다.</p>
    <input class="g-search" id="gq" placeholder="예: 펌프, 검수, 안전관리관" aria-label="지식 검색">
    <div id="gOut" class="card"><p class="sub">불러오는 중…</p></div></div>`;
  try {
    const g = await api("/api/graph");
    const nodes = g.nodes || [];
    const edges = g.edges || [];
    const counts = {};
    nodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    const render = (q) => {
      const out = $("#gOut");
      if (!q) {
        out.innerHTML = `<div>${Object.entries(counts).map(([t, c]) => `<span class="g-type">${esc(t)} ${c}</span>`).join("")}</div>
          <p class="sub" style="margin-top:8px">전체 지식 ${nodes.length}개 · 관계 ${edges.length}건 — 검색어를 입력해 보세요.</p>`;
        return;
      }
      const hits = nodes.filter((n) => n.name.includes(q)).slice(0, 8);
      out.innerHTML = hits.length ? hits.map((n) => {
        const rel = edges.filter((e) => e.from === n.key || e.to === n.key).slice(0, 6);
        return `<div class="k-item"><b>${esc(n.name)}</b> <span class="g-type">${esc(n.type)}</span>
          ${rel.map((e) => `<div class="sub">· ${esc(e.fromName || e.from)} — ${esc(relLabel(e.rel))} — ${esc(e.toName || e.to)}</div>`).join("")}</div>`;
      }).join("") : `<p class="sub">‘${esc(q)}’와 맞는 지식이 없습니다.</p>`;
    };
    render("");
    $("#gq").oninput = (e) => render(e.target.value.trim());
  } catch (e) { $("#gOut").innerHTML = `<p class="sub">지식 지도를 불러오지 못했습니다.</p>`; }
}
function vVision(main) {
  main.innerHTML = `<div class="view"><h1 class="pg" tabindex="-1">서비스 소개</h1>
    <div class="card"><p><b>사람은 떠나도, 업무는 남게.</b></p>
      <p style="margin-top:8px">ON_메모리는 순환근무 조직의 업무 기억을 개인이 아니라 자리(직무)에 남기는 AI 업무 승계 비서입니다.
      상급자의 지시를 받는 순간 해야 할 일과 과거 자료를 한 화면(업무 작업대)에 정리하고,
      그 과정에서 쌓인 결정·메모·산출물이 다음 담당자의 브리핑이 됩니다.</p>
      <p style="margin-top:8px" class="sub">모든 답변과 점검은 실제 문서·지식 근거를 함께 보여주며, 수치·기한을 임의로 만들지 않습니다.</p></div></div>`;
}
function vNotFound(main, msg, id, isDraft) {
  main.innerHTML = `<div class="view"><h1 class="pg" tabindex="-1">${esc(msg)}</h1>
    <div class="card"><p>${id ? `요청한 업무(${esc(id)})가 없거나 초기화로 삭제되었습니다.` : "주소를 확인해 주세요."}</p>
      ${isDraft ? `<p class="sub" style="margin-top:6px">빈 기안은 만들지 않습니다 — 업무를 먼저 선택해 주세요.</p>` : ""}
      <div style="margin-top:12px;display:flex;gap:8px">
        <a class="btn" href="#work/list">내 업무로</a><a class="btn ghost" href="#home">홈으로</a></div></div></div>`;
}

/* ---------- 테마 / 초기화 / 부팅 ---------- */
function applyTheme(mode) {
  const m = mode || storage.getItem(TKEY) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", m);
  try { storage.setItem(TKEY, m); } catch (e) {}
}
async function boot() {
  S = loadState();
  UI = loadUI();
  applyTheme();
  $("#themeBtn").onclick = () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  $("#drawerClose").onclick = closeDrawer;
  $("#drawerVeil").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); hideToast(); } });
  $("#resetBtn").onclick = () => {
    if (!confirm("저장된 업무·기록·기안 임시 저장을 지우고 기본 샘플로 복원할까요?")) return;
    storage.removeItem(SKEY); storage.removeItem(UKEY);
    S = blankState(); UI = loadUI(); lastAction = null; lastActionMessage = "";
    cache.forecast = null;
    toast("기본 샘플로 복원했습니다.");
    nav("#home"); route();
  };
  try {
    const sum = await loadSummary();
    $("#simDate").textContent = "기준일 " + sum.simDate + " · " + (sum.versionLabel || "");
  } catch (e) { $("#simDate").textContent = "엔진 연결 안 됨"; }
  window.addEventListener("hashchange", route);
  route();
}
boot();
