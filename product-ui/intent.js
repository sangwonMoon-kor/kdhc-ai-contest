"use strict";
/* ============================================================================
 * intent.js — 만능 입력 의도 분류 (순수 함수, 프론트 라우팅 전용)
 * 우선순위(워크벤치 설계 스펙 §5.1):
 *   1 업무 전체 보기 > 2 질문 > 3 전달 지시 > 4 결정·진행 기록 > 5 기안 > 6 할 일 후보 > 7 확인 필요
 * 엔진 qa.js의 의도 분류와 별개다 — 여기 결과가 "질문"일 때만 /api/ask로 위임한다.
 * 브라우저 전역(JikmuIntent) + Node(module.exports) 겸용.
 * ==========================================================================*/
(function (root) {
  const RE = {
    list: /(내\s*업무|할\s*일)\s*(전체|목록)?/,
    listCtx: /(내\s*업무|이번\s*주|이번주|오늘|내일|내가)/,
    question: /(찾아\s*줘|찾아줘|어디(에|서)?\s|어디\s*(있|야)|알려\s*줘|알려줘|궁금|뭐(야|지|예요)|무엇|어떻게 (해|하나|처리)|\?$)/,
    instruction: /((팀장|부장|과장|차장|소장|지사장)님?(이|께서)\s*.*(올리래|하래|하라고|시켰|지시)|올리라고 (했|하셨)|제출하라)/,
    record: /(확정|결정(했|됨|남)?|변경(했|됨)|합의(했|됨)?)/,
    draft: /(초안\s*(써|작성|만들)|기안\s*(써|작성)|보고서\s*(써|만들|작성)|(써|만들어|작성해)\s*줘)/,
    todo: /(확인(해야|하기)|요청하기|챙기(기|자)|준비하기|보내기|까지\s|기한)/,
  };

  function classifyIntent(text) {
    const t = String(text || "").trim();
    if (!t) return { intent: "unclear" };
    // 1) 대상 없는 전체 보기
    if (RE.list.test(t) && RE.listCtx.test(t) && !RE.instruction.test(t) && !RE.draft.test(t)) return { intent: "list" };
    // 2) 명시적 질문 — "기안 자료 찾아줘"는 기안이 아니라 질문(회귀 계약)
    if (RE.question.test(t) || /\?\s*$/.test(t)) return { intent: "question" };
    // 3) 전달 지시
    if (RE.instruction.test(t)) return { intent: "instruction", dueText: extractDueText(t) };
    // 4) 결정·진행 기록 — "일정은 5월로 확정"은 Todo가 아니라 기록(회귀 계약)
    if (RE.record.test(t)) return { intent: "record" };
    // 5) 기안(생성 동사)
    if (RE.draft.test(t)) return { intent: "draft" };
    // 6) 할 일 후보
    if (RE.todo.test(t)) return { intent: "todo" };
    return { intent: "unclear" };
  }

  /* 기한 문구만 캡처 — 날짜를 임의 생성하지 않는다(스펙: 미확인 기한은 '기한 미정') */
  function extractDueText(t) {
    const m = String(t).match(/((다음\s*주|이번\s*주|이번\s*달|다음\s*달|\d{1,2}월(\s*\d{1,2}일)?|\d{4}-\d{2}-\d{2}|월요일|금요일)\s*까지)/);
    return m ? m[1].replace(/\s+/g, " ") : null;
  }

  /* 대상 업무 추정: 제목·지시문 토큰 겹침 점수(2자 이상 토큰) */
  function matchWork(text, works) {
    const toks = String(text || "").split(/[\s,.·()~!?"'“”]+/).filter((w) => w.length >= 2);
    let best = null, bestScore = 0;
    for (const w of works || []) {
      const title = w.title || "", instr = w.instruction || "";
      let s = 0;
      for (const tk of toks) {
        if (title.includes(tk)) s += 2;       // 제목 일치가 강한 신호(2자 설비명 포함)
        else if (instr.includes(tk)) s += 1;
      }
      if (s > bestScore) { bestScore = s; best = w; }
    }
    return bestScore >= 2 ? best : null;
  }

  const api = { classifyIntent, extractDueText, matchWork };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JikmuIntent = api;
})(typeof window !== "undefined" ? window : globalThis);
