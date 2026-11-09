/* Run: node --test tests/template-editor-platform-cards.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const unit = { exports: {} };
  cache.set(filename, unit);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => {
    if (name.endsWith(".css")) return {};
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (resolved) return load(path.relative(root, resolved));
    }
    return requireModule(name);
  }, unit, unit.exports);
  return unit.exports;
}

const { X_POST_COLORS } = load("lib/template-editor/model.ts");
const { cleanHtmlLayer } = load("lib/template-editor/html-layer.ts");
const cards = load("lib/template-editor/platform-cards.ts");

test("each platform's colors are #RRGGBB in capitals, and X's include our X card's", () => {
  for (const platform of cards.PLATFORMS) {
    for (const color of cards.PLATFORM_COLORS[platform]) assert.match(color, /^#[0-9A-F]{6}$/, `${platform}: ${color}`);
  }
  for (const color of Object.values(X_POST_COLORS)) assert.ok(cards.PLATFORM_COLORS.x.includes(color.toUpperCase()), color);
  // The design proof's Reddit card: dark mode, the four default avatars and their white.
  assert.deepEqual([...cards.PLATFORM_COLORS.reddit].sort(), ["#0E1113", "#2F3336", "#F2F4F5", "#8BA2AD", "#EEF1F3", "#FF4500", "#FF8717", "#24A0ED", "#46D160", "#FFFFFF"].sort());
});

test("the mark is two classes, and only both together mark a card", () => {
  assert.equal(cards.platformCardClass("reddit"), "platform-card platform-reddit");
  assert.equal(cards.platformOfClass("platform-card platform-reddit"), "reddit");
  assert.equal(cards.platformOfClass("  card platform-x\tplatform-card "), "x");
  assert.equal(cards.platformOfClass("platform-reddit"), null);
  assert.equal(cards.platformOfClass("platform-card"), null);
  assert.equal(cards.platformOfClass("platform-card platform-tiktok"), null);
  assert.equal(cards.platformOfClass(undefined), null);
});

test("a layer is a card when its outermost element carries the mark", () => {
  assert.equal(cards.platformOfLayer('<style>.name { color: #F2F4F5 }</style>\n<div class="platform-card platform-reddit"><p class="name">u/someone</p></div>'), "reddit");
  assert.equal(cards.platformOfLayer("<!-- the card --><section id='c' class='platform-card platform-x' style='padding: 44px'>…</section>"), "x");
  assert.equal(cards.platformOfLayer('<div title="a > b" class="platform-card platform-reddit">…</div>'), "reddit");
  assert.equal(cards.platformOfLayer('<div><div class="platform-card platform-reddit">…</div></div>'), null, "the mark must be on the outermost element");
  assert.equal(cards.platformOfLayer('<div class="card">…</div>'), null);
  assert.equal(cards.platformOfLayer("plain words"), null);
  assert.equal(cards.platformOfLayer(""), null);
});

test("the layer's cleaner keeps the class mark (and drops a data attribute)", () => {
  const clean = cleanHtmlLayer({ html: '<div class="platform-card platform-reddit" data-platform="reddit"><p>Word for word.</p></div>' });
  assert.match(clean.html, /class="platform-card platform-reddit"/);
  assert.doesNotMatch(clean.html, /data-platform/);
  assert.equal(cards.platformOfLayer(clean.html), "reddit");
});

test("colors are read as written or as a render page computes them", () => {
  assert.equal(cards.hexColor("#fff"), "#FFFFFF");
  assert.equal(cards.hexColor(" #0e1113 "), "#0E1113");
  assert.equal(cards.hexColor("#0E1113CC"), "#0E1113");
  assert.equal(cards.hexColor("#f0f8"), "#FF00FF");
  assert.equal(cards.hexColor("rgb(14, 17, 19)"), "#0E1113");
  assert.equal(cards.hexColor("rgba(139,162,173,.5)"), "#8BA2AD");
  assert.equal(cards.hexColor("rgb(14 17 19 / 50%)"), "#0E1113");
  assert.equal(cards.hexColor("rgb(100%, 0%, 0%)"), "#FF0000");
  for (const value of ["red", "var(--color-text)", "rgb(.)", "#12345", "transparent"]) assert.equal(cards.hexColor(value), null, value);
});

test("a platform's colors pass only for that platform", () => {
  assert.equal(cards.isPlatformColor("reddit", "rgb(14, 17, 19)"), true);
  assert.equal(cards.isPlatformColor("reddit", "#ff4500"), true);
  assert.equal(cards.isPlatformColor("reddit", "#000000"), false);
  assert.equal(cards.isPlatformColor("x", "#000"), true);
  assert.equal(cards.isPlatformColor("x", "#0E1113"), false);
  assert.equal(cards.isPlatformColor("x", "black"), false, "named colors aren't read");
});
