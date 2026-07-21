"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const required = ["index.html", "style.css", "app.js", "intent.js", "extract.js", "source-baseline.json"];
const failures = [];

for (const name of required) {
  if (!fs.existsSync(path.join(root, name))) failures.push(`missing ${name}`);
}
if (!failures.length) {
  const index = read("index.html");
  const app = read("app.js");
  const style = read("style.css");
  const baseline = JSON.parse(read("source-baseline.json"));
  if (!index.includes('<main id="view"')) failures.push("missing SPA view root");
  if (!(index.indexOf('src="intent.js"') < index.indexOf('src="app.js"'))) failures.push("intent.js must load before app.js");
  for (const route of ["#home", "#work/list", "#work/calendar", "#workbench/", "#draft/"]) {
    if (!app.includes(route)) failures.push(`missing route ${route}`);
  }
  if (!/function typeIntro\(/.test(app)) failures.push("home type intro missing");
  if (!style.includes("시각 정본: kdhc-ai-contest demo/app.html v4")) failures.push("approved UI provenance missing");
  if (!/main\{width:min\(830px,/.test(style)) failures.push("approved 830px reading width missing");
  if (!style.includes('[data-theme="dark"]')) failures.push("dark mode token set missing");
  if (baseline.repository !== "creationy/jikmu-memory") failures.push("wrong baseline repository");
  if (baseline.commit !== "13e232e") failures.push("wrong baseline commit");
}

if (failures.length) {
  console.error("Product UI source contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Product UI source contract passed");
