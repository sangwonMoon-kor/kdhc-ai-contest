const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const storyboardDir = path.join(root, 'assets', 'storyboard');
const cutFiles = Array.from({ length: 6 }, (_, index) =>
  path.join(storyboardDir, `s0-cut-${String(index + 1).padStart(2, '0')}.jpg`)
);

const checks = [
  ['S0 has cutscene mount', () => html.includes('id="s0cutscene"')],
  ['S0 uses storyboard cutscene instead of WebGL mount', () => !html.includes('id="s0three"') && !/new THREE\.WebGLRenderer/.test(html)],
  ['all six storyboard cuts exist', () => cutFiles.every((file) => fs.existsSync(file))],
  ['S0 references all six storyboard cuts', () => cutFiles.every((file) => html.includes(`assets/storyboard/${path.basename(file)}`))],
  ['S0 has cinematic cut metadata', () => /const S0_CUTS = \[/.test(html) && /title: '문서요정이 깔끔한 결과를 보여줍니다'/.test(html)],
  ['initS0Cutscene is defined', () => /function initS0Cutscene\(\)/.test(html)],
  ['updateS0Cutscene is defined', () => /function updateS0Cutscene\(p\)/.test(html)],
  ['s0Update drives cutscene progress', () => /updateS0Cutscene\(p\)/.test(html)],
  ['cutscene has film motion styling', () => /@keyframes s0FilmGrain/.test(html) && /s0-slide active/.test(html)],
  ['S0 keeps skip and title transition behavior', () => /skipS0\(\)/.test(html) && /s0stage\.classList\.toggle\('done'/.test(html)],
];

const failures = checks.filter(([, test]) => {
  try {
    return !test();
  } catch (error) {
    return true;
  }
});

if (failures.length) {
  console.error('S0 storyboard cutscene verification failed:');
  failures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log('S0 storyboard cutscene verification passed.');
