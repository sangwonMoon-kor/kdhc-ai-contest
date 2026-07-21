const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'app.html'), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
assert(inlineScript, 'missing inline app script');
assert.doesNotThrow(() => new Function(inlineScript[1]), 'inline app script must parse');

assert(/<script src="ai-contract\.js"><\/script>\s*<script>/.test(html));
['buildAiRequest', 'requestAiDecision', 'applyAiDecision', 'setAiPending'].forEach((name) => {
  assert(new RegExp(`function ${name}\\(`).test(html), `missing ${name}()`);
});

assert(html.includes('id="homeAiStatus" role="status" aria-live="polite" hidden'));
assert(html.includes('id="workAiStatus" role="status" aria-live="polite" hidden'));
assert(html.includes('업무 맥락을 확인하고 있습니다…'));
assert(html.includes('AI 응답 · 시연용 샘플 데이터 기반'));
assert(html.includes('샘플 응답'));

const buildRequest = html.match(/function buildAiRequest\([\s\S]*?(?=\n\s*async function requestAiDecision\()/);
assert(buildRequest, 'missing buildAiRequest body');
assert(buildRequest[0].includes('WORK_SEED'), 'AI context must come from immutable WORK_SEED');
assert(!buildRequest[0].includes('WORK_ITEMS'), 'AI context must not use mutable WORK_ITEMS');
['notes', 'todos', 'draftText', 'instruction', 'requester', 'complete', 'nextAction', 'meta'].forEach((field) => {
  assert(!new RegExp(`\\b${field}\\b`).test(buildRequest[0]), `AI context leaks ${field}`);
});
assert(/const aiHistory\s*=\s*\[\]/.test(html));
assert(/aiHistory\.splice\(0,aiHistory\.length-6\)/.test(html));
assert(!/persist(?:ed|ableState)[\s\S]{0,300}\baiHistory\b/.test(html));

assert(!html.includes('OPENAI_API_KEY'));
assert(!/Authorization\s*:\s*['"]Bearer/.test(html));
assert(/fetch\(['"]\/api\/ai['"]/.test(html));
assert(/catch\s*\([^)]*\)\s*\{[^}]*fallback/s.test(html));
assert(/location\.protocol===['"]http:['"]\|\|location\.protocol===['"]https:['"]/.test(html));
assert(html.includes("new URLSearchParams(location.search).get('engine')"));

console.log('OpenAI search static verification passed.');
