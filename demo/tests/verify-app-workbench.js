const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'app.html');
const html = fs.readFileSync(appPath, 'utf8');

const checks = [
  ['product title identifies the workbench prototype', () => html.includes('제품 프로토타입 v4 · 업무 작업대')],
  ['primary navigation exposes only Home and My Work', () =>
    html.includes('id="navHome"') && html.includes('id="navWork"') && !html.includes('id="navDraft"')],
  ['screen hierarchy includes home, my work, workbench, draft, and clarification views', () =>
    ['view-home', 'view-work', 'view-workbench', 'view-draft', 'view-clarify']
      .every((id) => html.includes(`id="${id}"`))],
  ['my work supports list and calendar views of work items', () =>
    html.includes('목록 보기') && html.includes('달력 보기') &&
    html.includes('id="workList"') && html.includes('id="workCalendar"')],
  ['work item state and selected context are explicit', () =>
    /const WORK_ITEMS\s*=/.test(html) && /let selectedWorkId\s*=/.test(html) &&
    /function getSelectedWork\(/.test(html)],
  ['home routing distinguishes intent from target work', () =>
    /function routeInput\(/.test(html) && /function submitHomeInput\(/.test(html) &&
    html.includes('어느 업무에 연결할까요?')],
  ['workbench opens by work id and keeps a contextual input', () =>
    /function openWorkbench\(/.test(html) && html.includes('id="contextInput"') &&
    /function submitContextInput\(/.test(html)],
  ['workbench prioritizes action, evidence, and output', () =>
    ['업무 작업대', '지금 할 일', '함께 볼 자료', '만들어야 할 결과물', '작년 양식으로 기안 시작']
      .every((text) => html.includes(text))],
  ['input feedback names the work and supports undo', () =>
    html.includes('id="workFeedback"') && /function undoLastAction\(/.test(html) &&
    html.includes('id="relinkButton"') && /function relinkLastInput\(/.test(html) && html.includes('되돌리기')],
  ['todo actions carry explicit links to evidence', () =>
    /function focusSource\(/.test(html) && html.includes('todo-source') && html.includes('source-role')],
  ['progress is derived from checklist completion', () =>
    /function getProgress\(/.test(html) && html.includes('완료')],
  ['ambiguous intent is confirmed instead of silently stored', () =>
    /function showIntentClarification\(/.test(html) && html.includes('data-intent="question"') &&
    html.includes('data-intent="note"') && html.includes('data-intent="todo"')],
  ['draft is opened from and returns to the selected workbench', () =>
    /function openDraft\(/.test(html) && /function returnToWorkbench\(/.test(html) &&
    html.includes('id="draftWorkTitle"') && html.includes('id="draftBackground"') &&
    html.includes('id="draftDetails"') && html.includes('draftText')],
  ['deep links preserve the selected work id', () =>
    html.includes('#workbench/') && html.includes('#draft/')],
  ['calendar keeps multiple work items on the same date', () =>
    !html.includes('Object.fromEntries(WORK_ITEMS.map')],
  ['optional engine connection is local-only and race guarded', () =>
    /function normalizeEngineUrl\(/.test(html) && /let engineSeq\s*=/.test(html) &&
    !html.includes("localStorage.setItem('jm-engine'")],
  ['legacy feature-store routing is removed', () =>
    !html.includes('const ORDER = ["cal","memo","draft"]') &&
    !html.includes('id="panel-memo"')],
  ['sample-data disclosure and safe text rendering remain', () =>
    html.includes('시연용 목업 · 샘플 데이터') && /function escapeHtml\(/.test(html)],
];

const failures = checks.filter(([, test]) => {
  try {
    return !test();
  } catch (error) {
    return true;
  }
});

if (failures.length) {
  console.error(`Work-item workbench verification failed (${failures.length}/${checks.length}):`);
  failures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log(`Work-item workbench verification passed (${checks.length}/${checks.length}).`);
