const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const jarvisPath = path.join(root, 'jarvis.html');
const adminPath = path.join(root, 'admin.html');
const openingPath = path.join(root, 'assets', 'opening.mp4');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const jarvisHtml = fs.readFileSync(jarvisPath, 'utf8');
const adminHtml = fs.readFileSync(adminPath, 'utf8');

const checks = [
  ['S0 video opener asset exists', () => fs.existsSync(openingPath)],
  ['S0 mounts the opening video', () => indexHtml.includes('id="s0video"') && indexHtml.includes('assets/opening.mp4')],
  ['S0 has video play and hero reveal handlers', () => /function playS0\(\)/.test(indexHtml) && /function s0RevealHero\(\)/.test(indexHtml)],
  ['S0 exposes Hello JARVIS as the first CTA', () => indexHtml.includes('Hello <span class="accent">JARVIS?</span>') && indexHtml.includes('href="jarvis.html"')],
  ['JARVIS mockup exists and keeps the search-first hero', () => jarvisHtml.includes('<span class="d3 accent">JARVIS?</span>') && jarvisHtml.includes('class="search"')],
  ['JARVIS lands questions on the four work screens', () => ['panel-today', 'panel-brief', 'panel-draft', 'panel-check'].every((id) => jarvisHtml.includes(`id="${id}"`)) && jarvisHtml.includes('id="clarify"')],
  ['JARVIS examples reflect the teammate engine use cases', () => ['순환수 펌프 정비공사', '도래하는 반복 업무', '인수인계', '반려'].every((text) => jarvisHtml.includes(text))],
  ['JARVIS can call the live engine with offline fallback', () => jarvisHtml.includes('askEngine') && jarvisHtml.includes('/api/ask') && fs.existsSync(path.join(root, 'engine-proxy.js'))],
  ['Main demo speaks the maintenance use case', () => ['지사 공무부', '순환수 펌프 정비공사'].every((t) => indexHtml.includes(t)) && !/요금정산|중간보고/.test(indexHtml)],
  ['JARVIS copy hides engine details behind evidence and actions', () => ['사내 결재문서', '근거 문서', '검증 상태', '다음 업무 액션'].some((text) => jarvisHtml.includes(text))],
  ['JARVIS links to the administrator console for the reveal layer', () => jarvisHtml.includes('admin.html')],
  ['Administrator console exists', () => fs.existsSync(adminPath)],
  ['Administrator console shows hidden engine layers', () => ['인제스트', '파싱', '온톨로지', '검증 상태', '구조화 이벤트'].every((text) => adminHtml.includes(text))],
  ['Administrator console exposes the passive AX loop', () => ['직원이 질문하면', '문서가 지식으로 바뀝니다', '사용 행동 → 구조화 이벤트'].every((text) => adminHtml.includes(text))],
  ['Legacy WebGL/storyboard opener is not required', () => !indexHtml.includes('id="s0three"') && !/new THREE\.WebGLRenderer/.test(indexHtml)],
];

const failures = checks.filter(([, test]) => {
  try {
    return !test();
  } catch (error) {
    return true;
  }
});

if (failures.length) {
  console.error('S0/JARVIS demo verification failed:');
  failures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log('S0/JARVIS demo verification passed.');
