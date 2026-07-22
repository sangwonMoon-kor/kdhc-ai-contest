"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const productRoot = path.join(root, "product-ui");
const files = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--", "product-ui"], {
  cwd: root,
  encoding: "utf8"
}).split("\0").filter(Boolean);

const legacyBrand = new RegExp("직무" + "\\s*" + "메모리", "g");
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".md", ".svg", ".txt", ".xml", ".yaml", ".yml"]);
const failures = [];

for (const relative of files) {
  const extension = path.extname(relative).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  if (legacyBrand.test(content)) failures.push(`${relative}: legacy brand in text content`);
  legacyBrand.lastIndex = 0;
}

assert.equal(failures.length, 0, `Legacy product name remains in current product UI:\n${failures.join("\n")}`);

const productIndex = fs.readFileSync(path.join(productRoot, "index.html"), "utf8");
const productApp = fs.readFileSync(path.join(productRoot, "app.js"), "utf8");
assert.match(productIndex, /ON_메모리/, "product UI metadata must use ON_메모리");
assert.match(productApp, /ON_메모리/, "product UI home must use ON_메모리");

console.log("ON_메모리 brand contract passed");
