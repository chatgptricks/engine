/* Run: node --test tests/template-editor-html-edit.test.mjs */
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
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (resolved) return load(path.relative(root, resolved));
    }
    return requireModule(name);
  }, unit, unit.exports);
  return unit.exports;
}

const model = load("lib/template-editor/model.ts");
const layer = load("lib/template-editor/html-layer.ts");
const edit = load("lib/template-editor/html-edit.ts");
const { builtInBrandGuide } = load("lib/template-editor/brand-guide-seed.ts");
const clean = html => layer.cleanHtmlLayer({ html }).html;
/** The number of the first element with this tag. */
const nodeOf = (html, tag) => Array.from({ length: edit.htmlNodeCount(html) }, (_, index) => index).find(index => edit.htmlNodeInfo(html, index).tag === tag);

const CHART = clean(`<div class="chart"><p class="legend"><span class="swatch"></span>US job <b>openings</b></p>
<table><tr><td>Jobs</td><td>7.5M</td></tr></table>
<svg viewBox="0 0 100 50"><path d="M0 0 L10 10"/><text x="90" y="20">7,669 <tspan class="delta">+96%</tspan></text><rect width="4" height="4"/></svg>
<ul><li>One</li><li>Two &amp; three</li></ul></div>`);

test("every drawn element carries its number, and the number finds it in the saved markup", () => {
  const drawn = layer.prepareHtmlLayer({ html: CHART }).html;
  const numbered = [...drawn.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\sdata-te-node="(\d+)"/gi)].map(match => [match[1].toLowerCase(), Number(match[2])]);
  assert.equal(numbered.length, edit.htmlNodeCount(CHART), "every element is numbered once");
  numbered.forEach(([tag, index], position) => {
    assert.equal(index, position, "numbers follow document order");
    assert.equal(edit.htmlNodeInfo(CHART, index).tag, tag, `node ${index} is a ${tag}`);
  });
  assert.doesNotMatch(clean(drawn), /data-te-node/, "numbers are never saved");
  const table = numbered.find(([tag]) => tag === "td")[1];
  assert.equal(edit.htmlNodeInfo(CHART, table).text, "Jobs", "a table without a tbody keeps its numbers");
  const label = numbered.find(([tag]) => tag === "text")[1];
  assert.deepEqual({ ...edit.htmlNodeInfo(CHART, label), style: undefined }, { node: label, tag: "text", text: "7,669 +96%", ownText: "7,669 ", svg: true, style: undefined });
  assert.equal(edit.htmlNodeInfo(CHART, 999), undefined);
});

test("new words replace a part's words; markup typed in the canvas is cleaned when saved", () => {
  const legend = 1;
  assert.equal(edit.htmlNodeInfo(CHART, legend).tag, "p");
  let html = edit.setHtmlNodeContent(CHART, legend, '<span class="swatch" data-te-node="2"></span>US job <b data-te-node="3">postings</b><br>2026');
  const element = { ...model.createCanvasElement("html"), id: "chart", html: CHART };
  const saved = edit.withHtmlLayerMarkup(element, html);
  assert.equal(edit.htmlNodeInfo(saved.html, legend).text, "US job postings2026");
  assert.doesNotMatch(saved.html, /data-te-node/);
  assert.match(saved.html, /<br \/>|<br>/);
  html = edit.setHtmlNodeContent(CHART, legend, 'Hi <img src="https://evil.example/x.png" onerror="alert(1)"><script>alert(1)</script>');
  const cleaned = edit.withHtmlLayerMarkup(element, html).html;
  assert.doesNotMatch(cleaned, /evil|onerror|script|alert/, "pasted markup is cleaned like any other");
  assert.equal(edit.withHtmlLayerMarkup(element, CHART), element, "no change keeps the same layer");

  const label = nodeOf(CHART, "text");
  assert.equal(edit.htmlNodeInfo(CHART, label).tag, "text");
  html = edit.setHtmlNodeText(CHART, label, "7,700 ");
  assert.equal(edit.htmlNodeInfo(html, label).text, "7,700 +96%", "the tspan inside stays");
  assert.match(clean(html), /viewBox="0 0 100 50"|viewbox="0 0 100 50"/);
  assert.throws(() => edit.setHtmlNodeText(CHART, 999, "x"), /gone/);
});

test("brand styles go on a part, or on the selected words in a span (a tspan in an SVG)", () => {
  const legend = 1;
  let html = edit.styleHtmlNode(CHART, legend, { color: "var(--color-accent)", "font-size": "var(--title-size)" });
  assert.deepEqual(edit.htmlNodeInfo(html, legend).style, { color: "var(--color-accent)", "font-size": "var(--title-size)" });
  html = edit.styleHtmlNode(html, legend, { color: null });
  assert.deepEqual(edit.htmlNodeInfo(html, legend).style, { "font-size": "var(--title-size)" });
  assert.match(clean(html), /style="font-size: ?var\(--title-size\)"/, "the sanitizer keeps brand variables");

  // "US job openings": words 3 to 10 cross into the <b>.
  html = edit.styleHtmlText(CHART, legend, { start: 3, end: 10 }, { color: "var(--color-accent)" });
  const saved = clean(html);
  assert.match(saved, /US <span style="color: ?var\(--color-accent\)">job <\/span><b><span style="color: ?var\(--color-accent\)">ope<\/span>nings<\/b>/);
  assert.equal(edit.htmlNodeInfo(saved, legend).text, "US job openings", "the words don't change");
  // Styling the same words again changes their span instead of nesting another.
  const again = clean(edit.styleHtmlText(saved, legend, { start: 3, end: 7 }, { color: "var(--color-text)" }));
  assert.match(again, /US <span style="color: ?var\(--color-text\)">job <\/span><b>/);
  assert.equal((again.match(/<span/g) ?? []).length, (saved.match(/<span/g) ?? []).length, "no new span");
  assert.match(clean(edit.styleHtmlText(saved, legend, { start: 7, end: 15 }, { "font-weight": "400" })), /<b style="font-weight: ?400">/, "an element that holds exactly the words takes the style");
  const whole = edit.styleHtmlText(CHART, legend, { start: 0, end: 15 }, { "font-weight": "700" });
  assert.deepEqual(edit.htmlNodeInfo(whole, legend).style, { "font-weight": "700" }, "all the words style the part itself");

  const label = nodeOf(CHART, "text");
  html = edit.styleHtmlText(CHART, label, { start: 0, end: 5 }, { color: "var(--color-accent)" });
  assert.match(clean(html), /<text x="90" y="20"><tspan style="fill: ?var\(--color-accent\)">7,669<\/tspan> <tspan/);
  assert.deepEqual(edit.htmlNodeInfo(edit.styleHtmlNode(CHART, label, { color: "var(--color-text)" }), label).style, { fill: "var(--color-text)" }, "SVG colors are fills");
  assert.equal(edit.styleHtmlText(CHART, legend, { start: 4, end: 4 }, { color: "red" }), edit.editHtmlNode(CHART, legend, () => {}), "no words selected, no change");
});

test("the style panel offers the brand's colors and text styles", () => {
  const tokens = layer.htmlTokensForGuide(builtInBrandGuide("chatgptricks"));
  const colors = edit.htmlBrandColors(tokens);
  assert.deepEqual(colors.slice(0, 3).map(color => [color.label, color.css]), [["Text", "var(--color-text)"], ["Accent", "var(--color-accent)"], ["Accent 2", "var(--color-accent-end)"]]);
  assert.equal(new Set(colors.map(color => color.value.toLowerCase())).size, colors.length, "each color once");
  const styles = edit.htmlBrandTextStyles(tokens);
  assert.ok(styles.length >= 4);
  assert.deepEqual(styles.find(style => style.name === "title")?.css, { fontSize: "var(--title-size)", fontWeight: "var(--title-weight)", fontFamily: "var(--title-font)" });
  assert.ok(styles.every((style, index) => !index || Number.parseFloat(styles[index - 1].size) >= Number.parseFloat(style.size)), "largest first");
  assert.deepEqual(edit.htmlBrandColors(undefined), []);
  assert.deepEqual(edit.htmlBrandTextStyles({}), []);
  assert.deepEqual(edit.parseInlineStyle("color: red; background: url('a;b.png') ; font: 12px/1.2 \"A;B\""), { color: "red", background: "url('a;b.png')", font: "12px/1.2 \"A;B\"" });
});
