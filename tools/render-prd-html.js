const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const inputPath = path.join(root, 'docs', 'PRD.md');
const outputPath = path.join(root, 'docs', 'PRD.html');

const markdown = fs.readFileSync(inputPath, 'utf8');

const usedIds = new Map();
const toc = [];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripInline(value) {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>]/g, '')
    .trim();
}

function slugify(value) {
  const base = stripInline(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    || 'section';
  const count = usedIds.get(base) || 0;
  usedIds.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

function inline(value) {
  const parts = String(value).split(/(`[^`]*`)/g);
  return parts.map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    }
    return escapeHtml(part)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/⭐/g, '<span class="star">⭐</span>')
      .replace(/✅/g, '<span class="ok">✅</span>')
      .replace(/⬜/g, '<span class="todo">⬜</span>')
      .replace(/⚠️/g, '<span class="warn">⚠️</span>');
  }).join('');
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderTable(rows) {
  const [header, , ...body] = rows;
  const head = splitTableRow(header).map((cell) => `<th>${inline(cell)}</th>`).join('');
  const bodyRows = body.map((row) => {
    const cells = splitTableRow(row).map((cell) => `<td>${inline(cell)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}

function renderMarkdown(source) {
  const lines = source.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    const tag = list.type === 'ol' ? 'ol' : 'ul';
    html.push(`<${tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
    list = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushList();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\|/.test(trimmed) && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) {
      flushParagraph();
      flushList();
      const rows = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html.push(renderTable(rows));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const text = heading[2];
      const id = slugify(text);
      if (level <= 3) {
        toc.push({ level, id, text: stripInline(text) });
      }
      html.push(`<h${level} id="${id}">${inline(text)}<a class="anchor" href="#${id}" aria-label="section link">#</a></h${level}>`);
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push('<hr>');
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (bullet || ordered) {
      flushParagraph();
      const type = ordered ? 'ol' : 'ul';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet || ordered)[1]);
      continue;
    }

    if (/^\s{2,}\S/.test(line) && list && list.items.length) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return html.join('\n');
}

const body = renderMarkdown(markdown);
const tocHtml = toc.map((item) =>
  `<a class="toc-l${item.level}" href="#${item.id}">${inline(item.text)}</a>`
).join('\n');

const title = toc[0]?.text || 'PRD';
const generated = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light;--bg:#f4f5f7;--paper:#fff;--ink:#1d2126;--muted:#68717d;--line:#e3e6ea;--accent:#e8590c;--accent-soft:#fff2e9;--ok:#15803d;--warn:#b45309;--shadow:0 16px 48px rgba(20,26,34,.10)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#f8fafc,#eef1f5);color:var(--ink);font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;line-height:1.72;font-size:16px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.top{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.86);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}.top-inner{max-width:1180px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:14px}.brand{font-weight:850;letter-spacing:-.02em}.badge{margin-left:auto;font-size:12px;font-weight:800;color:#9a3412;background:var(--accent-soft);border:1px solid #fed7aa;border-radius:999px;padding:4px 10px}.layout{max-width:1180px;margin:0 auto;padding:34px 24px 70px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:26px}.toc{position:sticky;top:70px;align-self:start;max-height:calc(100vh - 94px);overflow:auto;padding:18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.74)}.toc-title{font-size:12px;font-weight:850;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}.toc a{display:block;color:#3d4651;padding:5px 0;font-size:13px;line-height:1.35}.toc .toc-l1{font-weight:850;color:var(--ink);margin-top:8px}.toc .toc-l2{padding-left:8px}.toc .toc-l3{padding-left:20px;color:var(--muted)}
.doc{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:48px 54px}.meta{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 24px}.pill{font-size:12px;font-weight:800;color:var(--muted);background:#f5f6f8;border:1px solid var(--line);border-radius:999px;padding:5px 11px}h1,h2,h3,h4{letter-spacing:-.025em;line-height:1.25;margin:1.35em 0 .55em}h1{font-size:40px;margin-top:0}h2{font-size:27px;border-top:1px solid var(--line);padding-top:30px}h3{font-size:21px}h4{font-size:18px}p{margin:.65em 0}blockquote{margin:22px 0;padding:16px 20px;border-left:4px solid var(--accent);background:var(--accent-soft);border-radius:0 12px 12px 0;font-weight:750}hr{border:0;border-top:1px solid var(--line);margin:34px 0}ul,ol{padding-left:1.35em;margin:.65em 0 1em}li{margin:.24em 0}code{font-family:"Cascadia Mono",Consolas,monospace;font-size:.92em;background:#f1f3f5;border:1px solid #e8eaee;border-radius:6px;padding:.12em .36em}pre{overflow:auto;background:#12161d;color:#f4f6f8;border-radius:14px;padding:20px;border:1px solid #252b35}pre code{background:transparent;border:0;color:inherit;padding:0}.table-wrap{overflow:auto;margin:16px 0 22px;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;min-width:620px}th,td{padding:11px 13px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th{background:#f8fafc;font-size:13px;font-weight:850;color:#3d4651}tr:last-child td{border-bottom:0}.anchor{opacity:0;margin-left:8px;font-size:.72em;color:#a1a8b2}h1:hover .anchor,h2:hover .anchor,h3:hover .anchor{opacity:1}.star{color:#e8590c}.ok{color:var(--ok)}.todo{color:#64748b}.warn{color:var(--warn)}.footer{margin-top:36px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
@media(max-width:900px){.layout{display:block;padding:20px 14px 48px}.toc{position:static;margin-bottom:16px;max-height:none}.doc{padding:30px 22px;border-radius:14px}h1{font-size:30px}h2{font-size:23px}.top-inner{padding:10px 14px}.badge{display:none}table{min-width:560px}}
@media print{.top,.toc{display:none}.layout{display:block;padding:0}.doc{border:0;box-shadow:none;padding:0}body{background:#fff}.anchor{display:none}}
</style>
</head>
<body>
<header class="top"><div class="top-inner"><div class="brand">ON_메모리 PRD</div><span class="badge">HTML · ${generated}</span></div></header>
<div class="layout">
<nav class="toc" aria-label="목차"><div class="toc-title">Contents</div>${tocHtml}</nav>
<main class="doc">
<div class="meta"><span class="pill">Product Requirements Document</span><span class="pill">Hello JARVIS</span><span class="pill">${generated}</span></div>
${body}
<div class="footer">Generated from <code>docs/PRD.md</code>. GitHub 공개용 정적 HTML.</div>
</main>
</div>
</body>
</html>
`;

fs.writeFileSync(outputPath, html, 'utf8');
console.log(`Rendered ${path.relative(root, outputPath)} from ${path.relative(root, inputPath)}`);
