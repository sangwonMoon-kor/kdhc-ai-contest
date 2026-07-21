/* ============================================================================
 * extract.js — 파일 → 텍스트 추출기 (의존성 0)
 * 브라우저(<script> 전역)와 Node(require, test/extract.test.js) 겸용.
 *  - txt/csv: 인코딩 자동판별(utf-8/euc-kr)
 *  - docx/hwpx/xlsx/pptx: ZIP+XML — 내장 DecompressionStream(deflate-raw)
 *  - hwp(5.0): CFB 컨테이너 → BodyText/Section* 압축 해제 → 문단 레코드 파싱
 *  - pdf: 오브젝트 스캔(+ObjStm) → 페이지 콘텐츠 → ToUnicode CMap 매핑
 *  - doc/xls/ppt(레거시 바이너리): 텍스트 런 스캔(제한적)
 * ==========================================================================*/

/* ---------------------------- 공통 유틸 ---------------------------- */
/* 관대한 inflate — 유효 블록은 이미 방출되므로 말미 잉여("trailing junk")만 삼킨다.
 * CFB(HWP) 스트림은 실제 deflate보다 길게 저장돼 잉여가 남고, PDF는 endstream 앞
 * 개행이 붙는다. Node zlib는 이를 눈감아 주지만 브라우저 DecompressionStream은
 * 예외를 던진다 → 청크를 모으며 인지된 말미 예외만 무시해 양쪽 동작을 일치시킨다. */
async function inflateBytes(u8, raw) {
  const ds = new DecompressionStream(raw ? "deflate-raw" : "deflate");
  const writer = ds.writable.getWriter(), reader = ds.readable.getReader();
  const chunks = []; let total = 0;
  const pump = (async () => { try { await writer.write(u8); await writer.close(); } catch (e) {} })();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
  } catch (e) {
    if (!/junk|corrupt|unexpected end|incorrect|invalid/i.test(String(e && e.message))) { await pump.catch(() => {}); throw e; }
  }
  await pump.catch(() => {});
  const out = new Uint8Array(total); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
/* 바이트 보존 latin1 (TextDecoder("latin1")=windows-1252라 0x80–0x9F가 왜곡됨) */
function latin1Str(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}
function tidyText(s) {
  return String(s || "").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeSmart(buf) {
  const dec = (enc) => { try { return new TextDecoder(enc).decode(buf); } catch (e) { return null; } };
  const u8 = dec("utf-8") || "";
  if (!/�/.test(u8)) return u8;
  const kr = dec("euc-kr");
  if (kr && (kr.match(/[가-힣]/g) || []).length > (u8.match(/[가-힣]/g) || []).length) return kr;
  return u8;
}

/* ZIP 엔트리 해제(저장·deflate). CRC 미검증 — 추출 용도로 충분 */
async function unzipMatch(buf, wantRe) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let i = buf.byteLength - 22;
  while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
  if (i < 0) throw new Error("ZIP 형식이 아닙니다");
  const count = dv.getUint16(i + 10, true);
  let off = dv.getUint32(i + 16, true);
  const out = [];
  for (let e = 0; e < count; e++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    if (wantRe.test(name)) {
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      const cdata = u8.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
      let data = null;
      if (method === 0) data = cdata;
      else if (method === 8) data = await inflateBytes(cdata, true);
      if (data) out.push({ name, text: new TextDecoder().decode(data) });
    }
    off += 46 + nlen + elen + clen;
  }
  return out;
}

function xmlToText(xml, paraRe) {
  let s = String(xml);
  if (paraRe) s = s.replace(paraRe, "\n");
  s = s.replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractDocx(buf) {
  const es = await unzipMatch(buf, /^word\/document\.xml$/);
  if (!es.length) throw new Error("word/document.xml 없음");
  return xmlToText(es[0].text.replace(/<w:tab[^>]*\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n"), /<\/w:p>/g);
}
async function extractHwpx(buf) {
  const es = await unzipMatch(buf, /^Contents\/section\d+\.xml$/i);
  if (!es.length) throw new Error("Contents/section*.xml 없음");
  return es.sort((a, b) => a.name.localeCompare(b.name)).map((e) => xmlToText(e.text, /<\/(hp:)?p>/g)).join("\n\n");
}
async function extractPptx(buf) {
  const es = await unzipMatch(buf, /^ppt\/slides\/slide\d+\.xml$/);
  if (!es.length) throw new Error("ppt/slides 없음");
  return es.sort((a, b) => (+a.name.match(/\d+/)[0]) - (+b.name.match(/\d+/)[0])).map((e) => xmlToText(e.text, /<\/a:p>/g)).join("\n\n");
}
async function extractXlsx(buf) {
  const es = await unzipMatch(buf, /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/);
  const ssXml = (es.find((e) => e.name.includes("sharedStrings")) || {}).text || "";
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlToText(m[1]));
  const lines = [];
  for (const e of es.filter((x) => x.name.includes("worksheets")).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const row of e.text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] || "", inner = c[2] || "";
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const ist = (inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        if (/t="s"/.test(attrs) && v != null) cells.push(shared[+v] || "");
        else if (ist != null) cells.push(xmlToText(ist));
        else if (v != null) cells.push(v);
      }
      if (cells.some((x) => String(x).trim())) lines.push(cells.join(" | "));
    }
  }
  if (!lines.length) throw new Error("시트에서 텍스트를 찾지 못함");
  return lines.join("\n");
}

/* 레거시 바이너리(doc/xls/ppt): 인코딩별 한글 텍스트 런 스캔 — 제한적 */
function scanBinaryText(buf) {
  let best = "";
  for (const enc of ["utf-16le", "euc-kr", "utf-8"]) {
    let s = ""; try { s = new TextDecoder(enc).decode(buf); } catch (e) { continue; }
    const runs = s.match(/[가-힣][가-힣0-9A-Za-z .,·()\-:%/]{3,}/g) || [];
    const joined = runs.filter((r) => r.replace(/[^가-힣]/g, "").length >= 2).join("\n");
    if (joined.length > best.length) best = joined;
  }
  return best.split("\n").filter((l, i, a) => l !== a[i - 1]).join("\n");
}

/* ============================================================================
 * HWP 5.0 — CFB(OLE 복합문서) → FileHeader 플래그 → BodyText/Section* 해제
 *  본문은 기본 zlib(raw deflate) 압축. 문단 텍스트는 HWPTAG_PARA_TEXT(67)
 *  레코드의 UTF-16LE — 제어문자 {0,10,13,24..31}=1유닛, 나머지<32=8유닛.
 * ==========================================================================*/
function cfbOpen(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 1536 || u8[0] !== 0xd0 || u8[1] !== 0xcf || u8[2] !== 0x11 || u8[3] !== 0xe0) return null;
  const dv = new DataView(buf);
  const FREE = 0xffffffff, END = 0xfffffffe;
  const secSize = 1 << dv.getUint16(30, true), miniSize = 1 << dv.getUint16(32, true);
  const maxSec = Math.ceil(u8.length / secSize) + 1;
  const secOff = (n) => (n + 1) * secSize; // v3(512)·v4(4096) 공통
  // DIFAT → FAT 섹터 목록 (109개 초과분은 체인)
  const difat = [];
  for (let i = 0; i < 109; i++) { const v = dv.getUint32(76 + i * 4, true); if (v < maxSec) difat.push(v); }
  let ds = dv.getUint32(68, true);
  for (let g = 0; g < 1024 && ds !== END && ds !== FREE && ds < maxSec; g++) {
    const base = secOff(ds);
    for (let i = 0; i < secSize / 4 - 1; i++) { const v = dv.getUint32(base + i * 4, true); if (v < maxSec) difat.push(v); }
    ds = dv.getUint32(base + secSize - 4, true);
  }
  const perSec = secSize / 4;
  const fat = new Uint32Array(difat.length * perSec);
  difat.forEach((s, idx) => { const base = secOff(s); for (let i = 0; i < perSec; i++) fat[idx * perSec + i] = dv.getUint32(base + i * 4, true); });
  const chain = (start) => { const o = []; let s = start, g = 0; while (s !== END && s !== FREE && s < fat.length && g++ < maxSec + 4) { o.push(s); s = fat[s]; } return o; };
  const readChain = (start, size) => {
    const secs = chain(start), out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize));
    return out.subarray(0, Math.min(size, out.length));
  };
  // 디렉터리(평면 스캔 — HWP 스트림명은 유일)
  const dirStart = dv.getUint32(48, true);
  const dirRaw = readChain(dirStart, chain(dirStart).length * secSize);
  const entries = [];
  for (let off = 0; off + 128 <= dirRaw.length; off += 128) {
    const d = new DataView(dirRaw.buffer, dirRaw.byteOffset + off, 128);
    const nlen = d.getUint16(64, true), type = d.getUint8(66);
    if (!type || nlen < 2 || nlen > 64) continue;
    entries.push({
      name: new TextDecoder("utf-16le").decode(dirRaw.subarray(off, off + nlen - 2)),
      type, start: d.getUint32(116, true), size: d.getUint32(120, true),
    });
  }
  // 미니 스트림(4096B 미만 스트림 저장소) — Root 체인 + miniFAT
  const root = entries.find((e) => e.type === 5);
  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0);
  const mfSecs = chain(dv.getUint32(60, true));
  const miniFat = new Uint32Array(mfSecs.length * perSec);
  mfSecs.forEach((s, idx) => { const base = secOff(s); for (let i = 0; i < perSec; i++) miniFat[idx * perSec + i] = dv.getUint32(base + i * 4, true); });
  const cutoff = dv.getUint32(56, true) || 4096;
  const read = (e) => {
    if (e.size >= cutoff || e.type === 5) return readChain(e.start, e.size);
    const out = new Uint8Array(Math.ceil(e.size / miniSize) * miniSize);
    let s = e.start, i = 0, g = 0;
    while (s !== END && s !== FREE && s < miniFat.length && g++ < miniFat.length + 4) { out.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i++ * miniSize); s = miniFat[s]; }
    return out.subarray(0, e.size);
  };
  return { entries, read };
}

/* 문단 텍스트 레코드의 UTF-16 코드 유닛 워크 */
function hwpParaText(b) {
  let out = "";
  const n = b.length - (b.length % 2);
  for (let i = 0; i < n; i += 2) {
    const c = b[i] | (b[i + 1] << 8);
    if (c >= 32) { out += String.fromCharCode(c); continue; }
    if (c === 9) { out += "\t"; i += 14; }              // 탭(인라인 컨트롤 8유닛)
    else if (c === 10 || c === 13) out += "\n";          // 줄/문단 끝
    else if (c === 24) out += "-";                       // 하이픈
    else if (c === 30 || c === 31) out += " ";           // 묶음/고정폭 빈칸
    else if (c === 0 || (c >= 25 && c <= 29)) { /* 1유닛 예약 — 무시 */ }
    else i += 14;                                        // 확장/인라인 컨트롤(8유닛) 스킵
  }
  return out.replace(/\n+$/, "");
}
function hwpSectionText(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const paras = [];
  let off = 0;
  while (off + 4 <= u8.length) {
    const h = dv.getUint32(off, true); off += 4;
    const tag = h & 0x3ff;
    let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) { if (off + 4 > u8.length) break; size = dv.getUint32(off, true); off += 4; }
    if (off + size > u8.length) size = u8.length - off; // 손상 방어
    if (tag === 67) { const t = hwpParaText(u8.subarray(off, off + size)); if (t.trim()) paras.push(t); } // HWPTAG_PARA_TEXT
    off += size;
  }
  return paras.join("\n");
}

/* HWPML — 한글의 단일 파일 XML 포맷(.hwp지만 ZIP·CFB 아님).
 * <BODY><SECTION><P><TEXT><CHAR>텍스트</CHAR> 구조 — CHAR 텍스트를 문단 단위로 잇는다. */
function extractHwpml(buf) {
  const xml = new TextDecoder("utf-8").decode(buf);
  const bi = xml.indexOf("<BODY");
  const body = (bi >= 0 ? xml.slice(bi) : xml).replace(/<TAB\b[^>]*\/?>/gi, "\t");
  const text = xmlToText(body, /<\/P>/gi); // </P>→개행, 나머지 태그 제거 + 엔티티 복원
  if (text.replace(/\s/g, "").length < 5) throw new Error("HWPML 본문 텍스트를 찾지 못했습니다");
  return tidyText(text);
}

async function extractHwp(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x50 && u8[1] === 0x4b) return { text: await extractHwpx(buf) }; // 확장자만 .hwp인 HWPX(ZIP)
  const head = new TextDecoder("utf-8").decode(u8.subarray(0, 400)); // BOM 자동 처리
  if (/<\?xml/i.test(head) && /<HWPML/i.test(head)) return { text: extractHwpml(buf) }; // HWPML(XML)
  const cfb = cfbOpen(buf);
  if (!cfb) throw new Error("HWP 5.0 형식이 아닙니다(HWP 3.x 등 레거시 추정) — 한글에서 다시 저장하거나 텍스트를 붙여넣어 주세요");
  const ent = (name) => cfb.entries.find((e) => e.name === name);
  const fhE = ent("FileHeader");
  if (!fhE) throw new Error("FileHeader 스트림 없음 — HWP 파일이 아닙니다");
  const fh = cfb.read(fhE);
  if (latin1Str(fh.subarray(0, 17)) !== "HWP Document File") throw new Error("HWP 시그니처 불일치");
  const flags = new DataView(fh.buffer, fh.byteOffset).getUint32(36, true);
  const prvText = () => { const e = ent("PrvText"); return e ? tidyText(new TextDecoder("utf-16le").decode(cfb.read(e))) : ""; };
  if (flags & 2) throw new Error("암호화된 문서입니다 — 암호를 해제해 저장한 뒤 다시 첨부해 주세요");
  if (flags & 4) { // 배포용(열람 전용) — 본문이 난독화되어 미리보기만 가능
    const t = prvText();
    if (t) return { text: t, warn: true, note: "배포용 문서 — 미리보기 텍스트만 추출" };
    throw new Error("배포용(열람 전용) 문서입니다 — 원본 hwp로 저장 후 다시 첨부해 주세요");
  }
  const secs = cfb.entries.filter((e) => e.type === 2 && /^Section\d+$/.test(e.name)).sort((a, b) => +a.name.slice(7) - +b.name.slice(7));
  const parts = [];
  for (const s of secs) {
    let data = cfb.read(s);
    if (flags & 1) { try { data = await inflateBytes(data, true); } catch (e) { continue; } } // 본문 압축(zlib raw)
    parts.push(hwpSectionText(data));
  }
  const text = tidyText(parts.join("\n"));
  if (text.length >= 10) return { text };
  const t = prvText();
  if (t) return { text: t, warn: true, note: "본문 해석 실패 — 미리보기 텍스트만 추출" };
  throw new Error("본문 텍스트를 찾지 못했습니다 — 텍스트를 직접 붙여넣어 주세요");
}

/* ============================================================================
 * PDF — xref 없이 오브젝트 전수 스캔(+ObjStm 해체) 후 페이지 트리 순회.
 *  텍스트는 콘텐츠 스트림의 Tj/TJ/'/" 를 폰트별 ToUnicode CMap으로 복원.
 *  (HWP/워드 내보내기 PDF는 서브셋 폰트라 ToUnicode 없이는 복원 불가)
 * ==========================================================================*/
function pdfLiteralBytes(s, i) { // s[i] === "(" — 이스케이프·중첩 처리, [bytes, next]
  i++;
  let depth = 1; const out = [];
  const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
  while (i < s.length && depth) {
    const ch = s[i];
    if (ch === "\\") {
      const nx = s[i + 1];
      if (nx >= "0" && nx <= "7") { let oct = "", j = i + 1; while (j < s.length && oct.length < 3 && s[j] >= "0" && s[j] <= "7") oct += s[j++]; out.push(parseInt(oct, 8) & 255); i = j; continue; }
      if (nx === "\r") { i += s[i + 2] === "\n" ? 3 : 2; continue; } // 줄 계속
      if (nx === "\n") { i += 2; continue; }
      out.push(esc[nx] != null ? esc[nx] : (nx || "").charCodeAt(0) & 255); i += 2; continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (!depth) { i++; break; } }
    out.push(ch.charCodeAt(0) & 255); i++;
  }
  return [Uint8Array.from(out), i];
}

function pdfStrParser(str) {
  const isWs = (ch) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\0";
  const isDelim = (ch) => "()<>[]{}/%".indexOf(ch) >= 0;
  function skipWs(i) {
    for (;;) {
      while (i < str.length && isWs(str[i])) i++;
      if (str[i] === "%") { while (i < str.length && str[i] !== "\n" && str[i] !== "\r") i++; continue; }
      return i;
    }
  }
  function name(i) {
    let j = i + 1;
    while (j < str.length && !isWs(str[j]) && !isDelim(str[j])) j++;
    return [str.slice(i + 1, j).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), j];
  }
  function value(i) { // → [값, next] · 이름=문자열, 참조={r}, 16진문자열={hex}, 리터럴={lit}
    i = skipWs(i);
    if (i >= str.length) return [null, i];
    const c = str[i];
    if (c === "<" && str[i + 1] === "<") {
      i += 2; const d = {};
      for (;;) {
        i = skipWs(i);
        if (i >= str.length) return [d, i];
        if (str[i] === ">" && str[i + 1] === ">") return [d, i + 2];
        if (str[i] !== "/") { const sk = value(i); if (sk[1] <= i) return [d, i + 1]; i = sk[1]; continue; }
        const kn = name(i); const vv = value(kn[1]); d[kn[0]] = vv[0]; i = vv[1];
      }
    }
    if (c === "<") { let j = str.indexOf(">", i + 1); if (j < 0) j = str.length; return [{ hex: str.slice(i + 1, j) }, j + 1]; }
    if (c === "[") {
      i++; const a = [];
      for (;;) { i = skipWs(i); if (i >= str.length || str[i] === "]") return [a, i + 1]; const vv = value(i); if (vv[1] <= i) return [a, i + 1]; a.push(vv[0]); i = vv[1]; }
    }
    if (c === "/") return name(i);
    if (c === "(") { const lb = pdfLiteralBytes(str, i); return [{ lit: lb[0] }, lb[1]]; }
    if (c === ")" || c === ">" || c === "]" || c === "}" || c === "{") return [null, i + 1];
    if (/[-+.0-9]/.test(c)) {
      let j = i + 1; while (j < str.length && /[-+.0-9eE]/.test(str[j])) j++;
      const n1 = parseFloat(str.slice(i, j));
      if (Number.isInteger(n1) && n1 >= 0) { // 참조 lookahead: "n g R"
        const k = skipWs(j);
        if (/[0-9]/.test(str[k] || "")) {
          let k2 = k + 1; while (k2 < str.length && /[0-9]/.test(str[k2])) k2++;
          const k3 = skipWs(k2);
          if (str[k3] === "R" && !/[A-Za-z0-9#_]/.test(str[k3 + 1] || "")) return [{ r: n1 }, k3 + 1];
        }
      }
      return [n1, j];
    }
    let j = i; while (j < str.length && /[A-Za-z]/.test(str[j])) j++;
    const w = str.slice(i, j);
    if (w === "true") return [true, j];
    if (w === "false") return [false, j];
    if (w === "null") return [null, j];
    return [null, Math.max(j, i + 1)];
  }
  return { skipWs, value };
}

/* ToUnicode CMap → 코드→문자열 매핑 (bfchar/bfrange, 1·2바이트 코드) */
function pdfParseCMap(txt) {
  const m = new Map();
  let w = 1;
  const hex2str = (h) => {
    if (h.length % 4 === 2) h = "00" + h;
    let t = "";
    for (let k = 0; k + 3 < h.length; k += 4) t += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
    return t;
  };
  const cs = txt.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  if (cs && cs[1].length >= 4) w = 2;
  for (const mm of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const p of mm[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (p[1].length >= 4) w = 2;
      m.set(parseInt(p[1], 16), hex2str(p[2]));
    }
  for (const mm of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const p of mm[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g)) {
      const lo = parseInt(p[1], 16), hi = Math.min(parseInt(p[2], 16), lo + 65535);
      if (p[1].length >= 4) w = 2;
      if (p[3]) {
        const h = p[3];
        for (let c = lo; c <= hi; c++)
          m.set(c, h.length <= 4 ? String.fromCharCode(parseInt(h, 16) + (c - lo)) : hex2str(h.slice(0, -4)) + String.fromCharCode(parseInt(h.slice(-4), 16) + (c - lo)));
      } else {
        const ds = [...p[4].matchAll(/<([0-9A-Fa-f]+)>/g)];
        ds.forEach((d, k) => { if (lo + k <= hi) m.set(lo + k, hex2str(d[1])); });
      }
    }
  return { m, w };
}

/* 콘텐츠 스트림 → 텍스트 (Tm y변화=줄바꿈, x간격·TJ 커닝=공백 근사) */
function pdfContentText(cbytes, fonts) {
  const s = latin1Str(cbytes);
  const isWs = (ch) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\0";
  let i = 0, out = "", st = [], fm = null, size = 12, em = 12, lastY = null, lastEndX = null;
  const dec = (b) => {
    if (!fm) return "";
    let t = "";
    if (fm.two) { for (let k = 0; k + 1 < b.length; k += 2) { const u = fm.m ? fm.m.get((b[k] << 8) | b[k + 1]) : null; if (u != null) t += u; } }
    else for (let k = 0; k < b.length; k++) { const u = fm.m ? fm.m.get(b[k]) : null; if (u != null) t += u; else if (b[k] >= 32 && b[k] < 127) t += String.fromCharCode(b[k]); }
    return t;
  };
  const show = (b) => { const t = dec(b); out += t; if (t) lastEndX = (lastEndX == null ? 0 : lastEndX) + t.length * em * 0.9; };
  while (i < s.length) {
    const c = s[i];
    if (isWs(c)) { i++; continue; }
    if (c === "%") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "(") { const lb = pdfLiteralBytes(s, i); st.push({ b: lb[0] }); i = lb[1]; continue; }
    if (c === "<" && s[i + 1] === "<") { // 인라인 사전(BDC 등) 스킵
      let d = 0, j = i;
      while (j < s.length) {
        if (s[j] === "<" && s[j + 1] === "<") { d++; j += 2; }
        else if (s[j] === ">" && s[j + 1] === ">") { d--; j += 2; if (!d) break; }
        else j++;
      }
      i = j; continue;
    }
    if (c === "<") {
      let j = s.indexOf(">", i + 1); if (j < 0) j = s.length;
      const h = s.slice(i + 1, j).replace(/[^0-9A-Fa-f]/g, "");
      const b = new Uint8Array(h.length >> 1);
      for (let k = 0; k + 1 < h.length; k += 2) b[k >> 1] = parseInt(h.slice(k, k + 2), 16);
      st.push({ b }); i = j + 1; continue;
    }
    if (c === "[") { st.push("["); i++; continue; }
    if (c === "]") { const a = []; while (st.length && st[st.length - 1] !== "[") a.unshift(st.pop()); st.pop(); st.push(a); i++; continue; }
    if (c === "/") { let j = i + 1; while (j < s.length && !isWs(s[j]) && "()<>[]{}/%".indexOf(s[j]) < 0) j++; st.push({ n: s.slice(i + 1, j) }); i = j; continue; }
    if (/[-+.0-9]/.test(c)) { let j = i + 1; while (j < s.length && /[-+.0-9eE]/.test(s[j])) j++; st.push(parseFloat(s.slice(i, j))); i = j; continue; }
    let j = i; while (j < s.length && /[A-Za-z'"*]/.test(s[j])) j++;
    const op = j > i ? s.slice(i, j) : s[i];
    i = Math.max(j, i + 1);
    if (op === "BI") { const k = s.indexOf("EI", i); i = k < 0 ? s.length : k + 2; st.length = 0; continue; } // 인라인 이미지
    if (op === "Tf") { const nm = st[st.length - 2], sz = st[st.length - 1]; if (nm && nm.n != null) fm = fonts.get(nm.n) || null; if (typeof sz === "number" && sz > 0) { size = sz; em = size; } }
    else if (op === "Tm") {
      const n = st.length, a = st[n - 6], e = st[n - 2], f = st[n - 1];
      if (typeof a === "number" && a) em = Math.abs(a) * size;
      if (typeof f === "number") {
        if (lastY != null && Math.abs(f - lastY) > 0.5) { out += "\n"; lastEndX = null; }
        else if (typeof e === "number" && lastEndX != null && e - lastEndX > em * 0.55 && out && !/\s$/.test(out)) out += " ";
        lastY = f;
        if (typeof e === "number" && (lastEndX == null || e > lastEndX)) lastEndX = e;
      }
    } else if (op === "Td" || op === "TD") {
      const ty = st[st.length - 1];
      if (typeof ty === "number" && ty !== 0) { out += "\n"; lastEndX = null; if (lastY != null) lastY += ty; }
    } else if (op === "T*") { out += "\n"; lastEndX = null; }
    else if (op === "Tj") { const b = st[st.length - 1]; if (b && b.b) show(b.b); }
    else if (op === "'" || op === '"') { out += "\n"; lastEndX = null; const b = st[st.length - 1]; if (b && b.b) show(b.b); }
    else if (op === "TJ" && Array.isArray(st[st.length - 1])) {
      for (const it of st[st.length - 1]) {
        if (it && it.b) show(it.b);
        else if (typeof it === "number") { if (it < -170 && out && !/\s$/.test(out)) out += " "; if (lastEndX != null) lastEndX -= (it / 1000) * em; }
      }
    }
    st.length = 0; // 연산자가 피연산자를 소비
  }
  return out;
}

async function extractPdf(buf) {
  const bytes = new Uint8Array(buf);
  const latin = latin1Str(bytes);
  if (!latin.startsWith("%PDF-")) throw new Error("PDF 형식이 아닙니다");
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(latin)) { const e = new Error("암호화된 PDF"); e.kind = "encrypted"; throw e; }
  const P = pdfStrParser(latin);

  /* 오브젝트 전수 스캔 — xref 불요. 증분 갱신은 나중 정의가 이긴다 */
  const objects = new Map();
  const objRe = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = objRe.exec(latin))) {
    const vv = P.value(m.index + m[0].length);
    let j = P.skipWs(vv[1]), streamAt = -1;
    if (latin.startsWith("stream", j)) {
      let k = j + 6;
      if (latin[k] === "\r") k++;
      if (latin[k] === "\n") k++;
      streamAt = k;
      const e = latin.indexOf("endstream", k);
      if (e > 0) objRe.lastIndex = e; // 스트림 바이너리 내부 "N G obj" 오탐 방지
    }
    objects.set(+m[1], { val: vv[0], streamAt });
  }
  const deref = (v, d) => (v && typeof v === "object" && v.r != null && (d || 0) < 32 ? deref((objects.get(v.r) || {}).val, (d || 0) + 1) : v);

  async function streamOf(o) {
    if (!o || o.streamAt < 0) return null;
    const d = o.val || {};
    let end = -1;
    const len = deref(d.Length);
    if (typeof len === "number" && len >= 0 && o.streamAt + len <= bytes.length) end = o.streamAt + len;
    else { end = latin.indexOf("endstream", o.streamAt); if (end < 0) return null; }
    const data = bytes.subarray(o.streamAt, end);
    const fl = Array.isArray(d.Filter) ? d.Filter : d.Filter ? [d.Filter] : [];
    if (!fl.length) return data;
    if (fl.length !== 1 || fl[0] !== "FlateDecode") return null; // 미지원 필터(이미지 등)
    const pm = deref(Array.isArray(d.DecodeParms) ? d.DecodeParms[0] : d.DecodeParms);
    if (pm && deref(pm.Predictor) > 1) return null; // 예측자는 콘텐츠 스트림에 안 쓰임
    try { const out = await inflateBytes(data, false); return out.length ? out : null; } catch (e) { return null; }
  }

  /* ObjStm 해체 — PDF 1.5+는 페이지/폰트 사전이 압축 스트림 안에 숨는다 */
  for (const o of [...objects.values()]) {
    const d = o.val;
    if (!d || d.Type !== "ObjStm") continue;
    const data = await streamOf(o);
    if (!data) continue;
    const t = latin1Str(data);
    const PS = pdfStrParser(t);
    const first = +deref(d.First) || 0;
    const nums = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < nums.length; k += 2) {
      if (Number.isFinite(nums[k]) && !objects.has(nums[k])) {
        const vv = PS.value(first + nums[k + 1]);
        objects.set(nums[k], { val: vv[0], streamAt: -1 });
      }
    }
  }

  /* 페이지 순서: Catalog→Pages 트리 우선, 실패 시 스캔 순 */
  let catalog = null;
  for (const o of objects.values()) if (o.val && typeof o.val === "object" && o.val.Type === "Catalog") catalog = o.val;
  const pages = [];
  (function walk(v, d) {
    if (!v || d > 64 || pages.length > 500) return;
    const n = deref(v);
    if (!n || typeof n !== "object") return;
    const kids = n.Type === "Pages" ? deref(n.Kids) : null;
    if (Array.isArray(kids)) kids.forEach((k) => walk(k, d + 1));
    else if (n.Type === "Page") pages.push(n);
  })(catalog && catalog.Pages, 0);
  if (!pages.length) for (const o of objects.values()) if (o.val && typeof o.val === "object" && o.val.Type === "Page") pages.push(o.val);
  if (!pages.length) throw new Error("페이지를 찾지 못했습니다");

  const fmCache = new Map();
  async function fontOf(fref) {
    const key = fref && fref.r != null ? fref.r : null;
    if (key != null && fmCache.has(key)) return fmCache.get(key);
    const f = deref(fref) || {};
    let cm = null;
    if (f.ToUnicode && f.ToUnicode.r != null) {
      const data = await streamOf(objects.get(f.ToUnicode.r));
      if (data) cm = pdfParseCMap(latin1Str(data));
    }
    const fm = { m: cm && cm.m, two: f.Subtype === "Type0" || !!(cm && cm.w === 2) };
    if (key != null) fmCache.set(key, fm);
    return fm;
  }

  const out = [];
  for (const pg of pages.slice(0, 300)) {
    const cparts = [];
    (function collect(x, d) {
      if (!x || d > 8) return;
      if (Array.isArray(x)) return x.forEach((y) => collect(y, d + 1));
      if (x.r != null) { const o = objects.get(x.r); if (!o) return; if (o.streamAt >= 0) cparts.push(o); else collect(o.val, d + 1); }
    })(pg.Contents, 0);
    const bufs = [];
    for (const o of cparts) { const dd = await streamOf(o); if (dd) bufs.push(dd); }
    if (!bufs.length) { out.push(""); continue; }
    let rnode = pg, res = null, g = 0; // Resources는 부모 상속 가능
    while (rnode && g++ < 16) { if (rnode.Resources) { res = deref(rnode.Resources); break; } rnode = deref(rnode.Parent); }
    const fdict = res ? deref(res.Font) || {} : {};
    const fonts = new Map();
    for (const k of Object.keys(fdict)) fonts.set(k, await fontOf(fdict[k]));
    let total = 0; bufs.forEach((b) => (total += b.length + 1));
    const joined = new Uint8Array(total);
    let p = 0; bufs.forEach((b) => { joined.set(b, p); p += b.length; joined[p++] = 32; });
    out.push(pdfContentText(joined, fonts));
  }
  return { text: tidyText(out.join("\n\n")), pages: pages.length };
}

/* Node(테스트)용 export — 브라우저에선 전역 함수로 사용 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { decodeSmart, unzipMatch, xmlToText, extractDocx, extractHwpx, extractPptx, extractXlsx, scanBinaryText, extractHwp, extractPdf, tidyText };
}
