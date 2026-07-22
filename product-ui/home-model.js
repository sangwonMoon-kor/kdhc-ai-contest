(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JikmuHomeModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAY_MS = 86400000;

  function dateAtNoon(iso) {
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(iso || ""));
    if (!match) return null;
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], 12));
    return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3] ? date : null;
  }

  function isoAtNoon(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(iso, count) {
    const date = dateAtNoon(iso);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + count);
    return isoAtNoon(date);
  }

  function overlaps(startISO, endISO, window) {
    return startISO && endISO && window && startISO <= window.endISO && endISO >= window.startISO;
  }

  function buildTwoWeekWindow(simISO, offsetWeeks) {
    const simDate = dateAtNoon(simISO);
    if (!simDate) throw new Error("Invalid simulation date");
    const weeks = Number.isInteger(offsetWeeks) ? offsetWeeks : 0;
    const start = new Date(simDate);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay() + weeks * 7);
    const startISO = isoAtNoon(start);
    const days = Array.from({ length: 14 }, (_, index) => addDays(startISO, index));
    return {
      startISO,
      endISO: days[13],
      days,
      weeks: [days.slice(0, 7), days.slice(7, 14)]
    };
  }

  function parseScheduleCandidate(text, simISO) {
    const label = String(text || "").trim();
    const simDate = dateAtNoon(simISO);
    if (!label || !simDate) return null;

    const explicitISO = /\b(\d{4}-\d{2}-\d{2})\b/.exec(label);
    if (explicitISO && dateAtNoon(explicitISO[1])) {
      return { kind: "date", label, startISO: explicitISO[1], endISO: explicitISO[1], confirmed: false };
    }

    const monthDay = /(\d{1,2})월\s*(\d{1,2})일/.exec(label);
    if (monthDay) {
      const year = simDate.getUTCFullYear();
      const candidateISO = `${year}-${String(monthDay[1]).padStart(2, "0")}-${String(monthDay[2]).padStart(2, "0")}`;
      if (dateAtNoon(candidateISO)) {
        return { kind: "date", label, startISO: candidateISO, endISO: candidateISO, confirmed: false };
      }
    }

    if (/다음\s*주/.test(label)) {
      const thisWeekStart = addDays(isoAtNoon(simDate), -simDate.getUTCDay());
      const startISO = addDays(thisWeekStart, 7);
      return { kind: "range", label, startISO, endISO: addDays(startISO, 6), confirmed: false };
    }
    return null;
  }

  function event(kind, source, startISO, endISO, work) {
    return {
      kind,
      id: source.id,
      workId: work.id,
      label: source.label || source.text || work.title,
      startISO,
      endISO
    };
  }

  function buildCalendarEvents(works, window) {
    if (!window || !window.startISO || !window.endISO) throw new Error("Invalid calendar window");
    const events = [];
    for (const work of Array.isArray(works) ? works : []) {
      if (!work || !work.id) continue;
      if (work.calendarStart && work.due && overlaps(work.calendarStart, work.due, window)) {
        events.push(event("work", work, work.calendarStart, work.due, work));
      }
      if (work.repeat && work.due && overlaps(work.due, work.due, window)) {
        events.push(event("deadline", work, work.due, work.due, work));
      }
      for (const memo of Array.isArray(work.records) ? work.records : []) {
        const startISO = memo && (memo.startISO || memo.dateISO);
        const endISO = memo && (memo.endISO || startISO);
        if (startISO && endISO && overlaps(startISO, endISO, window)) {
          events.push(event("memo", memo, startISO, endISO, work));
        }
      }
      for (const candidate of Array.isArray(work.scheduleCandidates) ? work.scheduleCandidates : []) {
        if (candidate && !candidate.confirmed && candidate.startISO && candidate.endISO && overlaps(candidate.startISO, candidate.endISO, window)) {
          events.push(event("candidate", candidate, candidate.startISO, candidate.endISO, work));
        }
      }
    }
    return events;
  }

  return { buildTwoWeekWindow, parseScheduleCandidate, buildCalendarEvents };
});
