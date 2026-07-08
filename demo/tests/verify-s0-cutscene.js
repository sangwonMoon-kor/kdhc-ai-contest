const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const jarvisPath = path.join(root, 'jarvis.html');
const openingPath = path.join(root, 'assets', 'opening.mp4');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const jarvisHtml = fs.readFileSync(jarvisPath, 'utf8');

const checks = [
  ['S0 video opener asset exists', () => fs.existsSync(openingPath)],
  ['S0 mounts the opening video', () => indexHtml.includes('id="s0video"') && indexHtml.includes('assets/opening.mp4')],
  ['S0 has video play and hero reveal handlers', () => /function playS0\(\)/.test(indexHtml) && /function s0RevealHero\(\)/.test(indexHtml)],
  ['S0 exposes Hello JARVIS as the first CTA', () => indexHtml.includes('Hello <span class="accent">JARVIS?</span>') && indexHtml.includes('href="jarvis.html"')],
  ['JARVIS mockup exists and keeps the search-first hero', () => /<h1 class="display">Hello, <span class="accent">JARVIS\?<\/span><\/h1>/.test(jarvisHtml)],
  ['JARVIS routes answer actions into the main demo', () => ['index.html#s1', 'index.html#s2', 'index.html#s3', 'index.html#s4'].every((href) => jarvisHtml.includes(href))],
  ['JARVIS examples reflect the teammate engine use cases', () => ['정산시스템 전환', '요금정산 중간보고', '산출근거 표 누락', '7월에 반복되는 업무'].every((text) => jarvisHtml.includes(text))],
  ['JARVIS copy hides engine details behind evidence and actions', () => ['사내 결재문서', '근거 문서', '검증 상태', '다음 업무 액션'].some((text) => jarvisHtml.includes(text))],
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
