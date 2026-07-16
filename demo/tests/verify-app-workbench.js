const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'app.html');
const html = fs.readFileSync(appPath, 'utf8');

const checks = [
  ['keeps the original JARVIS home identity', () =>
    html.includes('Hello, <span>JARVIS?') &&
    html.includes('업무 일기예보') &&
    html.includes('오늘의 메모') &&
    html.includes('근거 문서 연결')],
  ['keeps original presentation-safe shell', () =>
    html.includes('assets/app-opening.mp4') &&
    html.includes('시연용 목업 · 샘플 데이터') &&
    /function toggleTheme\(/.test(html)],
  ['uses work-item routes', () =>
    ['#home', '#work/list', '#work/calendar', '#workbench/', '#draft/']
      .every((value) => html.includes(value))],
  ['does not expose memo and draft as global feature tabs', () =>
    !html.includes('id="tab-memo"') && !html.includes('id="tab-draft"')],
  ['provides work state and versioned persistence', () =>
    /const WORK_SEED\s*=/.test(html) &&
    html.includes("const STORAGE_KEY='jm-workbench-v1'") &&
    /function loadState\(/.test(html) && /function saveState\(/.test(html)],
  ['supports contextual workbench actions', () =>
    /function openWorkbench\(/.test(html) &&
    /function submitContextInput\(/.test(html) &&
    /function relinkLastInput\(/.test(html) &&
    /function undoLastAction\(/.test(html)],
  ['renders invalid links safely', () =>
    html.includes('업무를 찾을 수 없습니다') && /function renderNotFound\(/.test(html)],
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
