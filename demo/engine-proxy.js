#!/usr/bin/env node
"use strict";
/* ============================================================================
 * engine-proxy.js — 직무 메모리 엔진용 CORS 프록시
 *
 * 팀원 엔진(creationy/jikmu-memory service)은 CORS 헤더를 보내지 않아
 * jarvis.html(파일/Pages 도메인)에서 브라우저가 직접 호출할 수 없다.
 * 팀원 리포는 수정하지 않고, 이 프록시를 앞에 세워 헤더만 얹는다.
 *
 * 사용:
 *   1) 엔진 실행:   (팀원 리포) cd service && node server.js        → :8343
 *   2) 프록시 실행: node demo/engine-proxy.js                        → :8399
 *      원격 엔진으로 보내려면: TARGET=https://jikmu-memory.vercel.app node demo/engine-proxy.js
 *   3) 데모 연결:   jarvis.html?engine=http://localhost:8399
 * ==========================================================================*/
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8399);
const TARGET = (process.env.TARGET || "http://localhost:8343").replace(/\/+$/, "");
const target = new URL(TARGET);
const client = target.protocol === "https:" ? https : http;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  const opt = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };
  const up = client.request(opt, (ur) => {
    res.writeHead(ur.statusCode || 502, { ...ur.headers, ...CORS });
    ur.pipe(res);
  });
  up.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", ...CORS });
    res.end(JSON.stringify({ error: "engine unreachable", detail: String(e.message || e), target: TARGET }));
  });
  req.pipe(up);
}).listen(PORT, () => {
  console.log(`engine-proxy: http://localhost:${PORT}  →  ${TARGET}`);
  console.log(`jarvis 연결: demo/jarvis.html?engine=http://localhost:${PORT}`);
});
