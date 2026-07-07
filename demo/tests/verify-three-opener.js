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
  ['S0 has knowledge-graph connection caption', () => html.includes('흩어진 문서가 서로 연결됩니다')],
  ['S0 has organic graph motion caption', () => html.includes('연결된 업무 맥락이 살아 움직입니다')],
  ['knowledge graph nodes are constructed', () => /var graphNodes = \[\]/.test(html) && /new THREE\.SphereGeometry/.test(html)],
  ['knowledge graph links are rendered', () => /new THREE\.LineSegments/.test(html)],
  ['knowledge graph opacity is scroll-driven', () => /var network = easeInOut\(segment\(p,\s*\.30,\s*\.58\)\)/.test(html)],
  ['graph does not collapse into the core', () => !/graphCollapse\s*=/.test(html) && !/\.lerp\(d\.sink,\s*graphCollapse\)/.test(html)],
  ['core does not expand into a sun-like stage', () => !/coreScale\s*=\s*mix\(coreScale,\s*2\.8/.test(html) && !/coreScale\s*=\s*mix\(coreScale/.test(html)],
  ['S0 scales graph down on narrow screens', () => /var viewportFit = s\.mount\.clientWidth < 600 \? \.58 : 1;/.test(html)],
  ['S0 mobile caption avoids bottom controls', () => /#s0 \.s0-caption\{bottom:13vh\}/.test(html) && /#s0 \.s0-hint\{display:none\}/.test(html)],
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
