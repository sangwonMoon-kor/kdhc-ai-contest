"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const failures = [];

if (!(index.indexOf('src="api-client.js"') < index.indexOf('src="app.js"'))) failures.push("api-client.js script order");
if (!index.includes('id="dataStatus"')) failures.push("missing data status element");
if (!app.includes("window.JikmuApi.createApiClient")) failures.push("app does not create API client");
if (/async function api\([^)]*\)\s*\{[\s\S]{0,500}fetch\(/.test(app)) failures.push("app still fetches API directly");
if (!/const isLiveError\s*=\s*status\.error\s*&&\s*status\.activeMode\s*!==\s*["']fixture["']/.test(app)) failures.push("auto-mode live error status missing");
if (!/let askSeq\s*=\s*0/.test(app) || !/const seq\s*=\s*\+\+askSeq/.test(app)) failures.push("stale ask guard missing");
if (/api\(["']\/api\/reset/.test(app)) failures.push("UI reset calls server reset");
if (!css.includes(".data-status")) failures.push("data status style missing");

if (failures.length) { console.error("App data-mode contract failed:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("App data-mode contract passed");
