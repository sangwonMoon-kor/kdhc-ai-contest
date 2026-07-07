const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const vendorPath = path.join(root, 'vendor', 'three.min.js');
const html = fs.readFileSync(htmlPath, 'utf8');

const checks = [
  ['local Three.js vendor exists', () => fs.existsSync(vendorPath)],
  ['Three.js vendor script is loaded before inline app script', () => /<script src="vendor\/three\.min\.js"><\/script>\s*<script>/.test(html)],
  ['S0 has full-bleed Three.js mount', () => html.includes('id="s0three"')],
  ['S0 has memory-core caption rail', () => html.includes('id="s0phase"')],
  ['initS0Three is defined', () => /function initS0Three\(\)/.test(html)],
  ['updateS0Three is defined', () => /function updateS0Three\(p\)/.test(html)],
  ['renderS0Three is defined', () => /function renderS0Three\(\)/.test(html)],
  ['resizeS0Three is defined', () => /function resizeS0Three\(\)/.test(html)],
  ['WebGLRenderer is constructed', () => /new THREE\.WebGLRenderer/.test(html)],
  ['s0Update drives Three.js progress', () => /updateS0Three\(p\)/.test(html)],
];

const failures = checks.filter(([, test]) => {
  try {
    return !test();
  } catch (error) {
    return true;
  }
});

if (failures.length) {
  console.error('Three.js S0 opener verification failed:');
  failures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log('Three.js S0 opener verification passed.');
