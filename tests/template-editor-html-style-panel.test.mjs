/* Run: node --test tests/template-editor-html-style-panel.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url);
/** State updates made by components loaded with `handlers`. */
const updates = [];
/** Loads the TypeScript sources. With `handlers`, React's hooks are stand-ins, so a
 * component can be called as a function and its buttons clicked; effects run at once. */
function loader(handlers = false) {
  const cache = new Map();
  const load = relative => {
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
      if (handlers && name === "react") return { ...React, useState: initial => [typeof initial === "function" ? initial() : initial, value => updates.push(value)], useEffect: effect => { effect(); }, useId: () => "id" };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (resolved) return load(path.relative(root, resolved));
      }
      return requireModule(name);
    }, unit, unit.exports);
    return unit.exports;
  };
  return load;
}
const load = loader(), handlers = loader(true);
const model = load("lib/template-editor/model.ts");
const layer = load("lib/template-editor/html-layer.ts");
const edit = load("lib/template-editor/html-edit.ts");
const panel = load("components/template-editor/html-style-panel.tsx");
const { builtInBrandGuide } = load("lib/template-editor/brand-guide-seed.ts");
const { ElementInspector } = load("components/template-editor/element-inspector.tsx");
const Panel = handlers("components/template-editor/html-style-panel.tsx").HtmlStylePanel;
const Inspector = handlers("components/template-editor/element-inspector.tsx").ElementInspector;

const tokens = layer.htmlTokensForGuide(builtInBrandGuide("chatgptricks"));
const clean = html => layer.cleanHtmlLayer({ html, tokens }).html;
const HTML = clean(`<div class="card">
<h1 style="color: var(--color-accent); font-size: var(--title-size); font-weight: var(--title-weight)">AI vs Jobs</h1>
<p class="legend">US job <b>openings</b> since 2022</p>
<p class="note" style="color: #00d98a">Same green, written out</p>
<p class="aside" style="color: var(--color-green)">Accent under its palette name</p>
<svg viewBox="0 0 100 50"><path d="M0 0 L10 10" style="fill: #ff0000"/><text x="4" y="20" style="fill: var(--color-text)">7,669 <tspan>+96%</tspan></text></svg>
</div>`);
/** The number of the first element with this tag (and class) in HTML. */
const node = (tag, className) => {
  for (let index = 0; index < edit.htmlNodeCount(HTML); index++) {
    if (edit.htmlNodeInfo(HTML, index).tag !== tag) continue;
    let found = !className;
    if (className) edit.editHtmlNode(HTML, index, element => { found = element.attribs.class === className; });
    if (found) return index;
  }
  throw new Error(`no <${tag} class="${className}">`);
};
const H1 = node("h1"), LEGEND = node("p", "legend"), NOTE = node("p", "note"), ASIDE = node("p", "aside"), LABEL = node("text");
const layerOf = (extra = {}) => ({ ...model.createCanvasElement("html"), id: "chart", name: "Chart", html: HTML, tokens, ...extra });
const sceneOf = element => ({ background: "#0b1014", elements: [element] });
const noop = () => {};
const inspectorProps = (element, extra = {}) => ({ scene: sceneOf(element), selectedIds: [element.id], width: 360, height: 480, onChange: noop, onSelect: noop, onEditHtmlLayer: noop, onBreakHtmlLayer: noop, ...extra });
const inspector = (element, extra) => renderToStaticMarkup(React.createElement(ElementInspector, inspectorProps(element, extra)));
const selection = (node, range) => ({ elementId: "chart", node, ...(range ? { range } : {}) });

const words = markup => markup.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
/** Each button's visible words, accessible name, pressed and disabled states. */
const buttons = markup => [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, inner]) => ({
  text: words(inner),
  name: /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? words(inner.replace(/<([a-z]+)[^>]*aria-hidden="true"[^>]*>[^<]*<\/\1>/g, "")),
  pressed: /aria-pressed="([^"]*)"/.exec(attributes)?.[1],
  disabled: /\sdisabled=""/.test(attributes),
}));
const button = (markup, name) => { const found = buttons(markup).find(item => item.name === name || item.text === name); assert.ok(found, `a "${name}" button`); return found; };
const pressed = (markup, names) => names.filter(name => button(markup, name).pressed === "true");
const COLORS = ["Text", "Accent", "Accent 2", "Secondary", "Muted", "Surface", "Background"].map(label => `${label} color`);
const SIZES = ["Follow · 122", "Cover · 97", "Title · 56", "Body · 43", "List · 34", "Cover remark · 32", "Source · 24"];

/** React elements in a tree a component returned, depth first. */
function findAll(tree, predicate, found = []) {
  if (Array.isArray(tree)) { tree.forEach(child => findAll(child, predicate, found)); return found; }
  if (!tree || typeof tree !== "object") return found;
  if (predicate(tree)) found.push(tree);
  React.Children.forEach(tree.props?.children, child => findAll(child, predicate, found));
  return found;
}
const control = (tree, name) => {
  const text = (element, hidden) => React.Children.toArray(element.props?.children).map(child => typeof child === "string" || typeof child === "number" ? String(child) : !hidden && child?.props?.["aria-hidden"] ? "" : text(child, hidden)).join("").replace(/\s+/g, " ").trim();
  const found = findAll(tree, element => element.type === "button" && [element.props["aria-label"], text(element, false), text(element, true)].includes(name))[0];
  assert.ok(found, `a "${name}" button`);
  return found;
};
/** Clicks a button of the style panel; returns the onChange calls it made. */
function click(element, sel, name) {
  const changes = [];
  const tree = Panel({ scene: sceneOf(element), element, selection: sel, onChange: (scene, group) => changes.push({ scene, group, html: scene.elements[0].html }), onEditHtmlLayer: noop, onBreakHtmlLayer: noop });
  control(tree, name).props.onClick();
  return changes;
}

test("one selected HTML layer opens on an HTML tab with the brand's colors and sizes", () => {
  const markup = inspector(layerOf(), { htmlSelection: selection(H1) });
  const tabs = [...markup.matchAll(/data-section="([a-z]+)" aria-pressed="(true|false)">([^<]*)</g)].map(([, id, on, label]) => [id, on, label]);
  assert.deepEqual(tabs.map(([id]) => id), ["html", "position", "effects", "advanced"], "HTML comes first");
  assert.deepEqual(tabs[0], ["html", "true", "HTML"]);
  assert.match(markup, /<h3>Selected part<\/h3><p class="te-html-style-selection"><code>&lt;h1&gt;<\/code><span>AI vs Jobs<\/span><\/p>/);
  assert.deepEqual(buttons(markup).filter(item => item.name.endsWith(" color")).map(item => [item.name, item.text]), COLORS.map(label => [label, label.replace(/ color$/, "")]), "labelled swatches, brand roles first");
  assert.equal(button(markup, "Title · 56").name, "Title 56", "the dot is only for the eye");
  assert.match(markup, /style="background:#00D98A"/);
  for (const size of SIZES) assert.equal(button(markup, size).disabled, false);
  assert.match(markup, /aria-label="Brand colors"/);
  assert.match(markup, /aria-label="Brand text sizes"/);
  for (const name of ["Bold", "Clear style", "Break into layers"]) assert.equal(button(markup, name).disabled, false);
  assert.match(markup, /aria-describedby="[^"]+"[^>]*>Break into layers<\/button><p id="[^"]+" class="te-element-hint">Turns this HTML into separate text, image and shape layers\.<\/p>/);
  assert.doesNotMatch(markup, /Edit text/, "the words are already being edited");

  const two = renderToStaticMarkup(React.createElement(ElementInspector, { ...inspectorProps(layerOf()), scene: { background: "#000", elements: [layerOf(), { ...layerOf(), id: "other" }] }, selectedIds: ["chart", "other"] }));
  assert.doesNotMatch(two, /data-section="html"/, "only for exactly one HTML layer");
  const text = renderToStaticMarkup(React.createElement(ElementInspector, inspectorProps(model.createCanvasElement("text"))));
  assert.doesNotMatch(text, /data-section="html"/);
});

test("the current color, size and weight are marked: a brand variable, the same value, or an SVG fill", () => {
  const element = layerOf();
  let markup = inspector(element, { htmlSelection: selection(H1) });
  assert.deepEqual(pressed(markup, COLORS), ["Accent color"]);
  assert.deepEqual(pressed(markup, SIZES), ["Title · 56"]);
  assert.equal(button(markup, "Bold").pressed, "true", "the title's weight is 700");
  assert.deepEqual(pressed(inspector(element, { htmlSelection: selection(NOTE) }), COLORS), ["Accent color"], "#00d98a is the accent");
  assert.deepEqual(pressed(inspector(element, { htmlSelection: selection(ASIDE) }), COLORS), ["Accent color"], "--color-green is the accent's value");
  markup = inspector(element, { htmlSelection: selection(LABEL) });
  assert.match(markup, /<code>&lt;text&gt;<\/code>/);
  assert.deepEqual(pressed(markup, COLORS), ["Text color"], "an SVG text's color is its fill");
  markup = inspector(element, { htmlSelection: selection(LEGEND) });
  assert.deepEqual([...pressed(markup, COLORS), ...pressed(markup, SIZES)], [], "no inline style, nothing marked");
  assert.equal(button(markup, "Bold").pressed, "false");

  // Words styled earlier read as styled; the words around them don't.
  const html = edit.styleHtmlText(HTML, LEGEND, { start: 3, end: 6 }, { color: "var(--color-accent)", "font-weight": "700" });
  const styled = layerOf({ html: clean(html) });
  markup = inspector(styled, { htmlSelection: selection(LEGEND, { start: 3, end: 6 }) });
  assert.match(markup, /<h3>Selected words<\/h3><p class="te-html-style-selection"><q>job<\/q><\/p>/);
  assert.deepEqual(pressed(markup, COLORS), ["Accent color"]);
  assert.equal(button(markup, "Bold").pressed, "true");
  markup = inspector(styled, { htmlSelection: selection(LEGEND, { start: 0, end: 6 }) });
  assert.deepEqual(pressed(markup, COLORS), [], "“US job”: only part of it is accent");
  assert.equal(button(markup, "Bold").pressed, "false");
});

test("which words are selected decides what is styled", () => {
  const target = (range) => panel.htmlStyleTarget(HTML, selection(LEGEND, range));
  assert.deepEqual({ ...target({ start: 6, end: 3 }), info: undefined, current: undefined }, { info: undefined, words: "job", range: { start: 3, end: 6 }, partial: true, current: undefined }, "a backwards selection reads forwards");
  assert.equal(target({ start: 4, end: 4 }).words, undefined, "a caret styles the whole part");
  assert.equal(target({ start: 2, end: 3 }).words, undefined, "so does a selected space");
  assert.equal(target({ start: 0, end: 999 }).partial, false, "all the words style the part itself");
  assert.equal(target({ start: 7, end: 15 }).words, "openings", "words inside a <b>");
  assert.equal(panel.htmlStyleTarget(HTML, selection(999)), undefined);
});

test("without a part being edited, the tab says how to start; a part that's gone says so", () => {
  let markup = inspector(layerOf());
  assert.match(markup, /Double-click words on the slide to edit them, or select words to color them\./);
  assert.equal(button(markup, "Edit text").disabled, false);
  assert.equal(button(markup, "Break into layers").disabled, false);
  assert.doesNotMatch(markup, /Brand colors|role="alert"/);
  markup = inspector(layerOf(), { htmlSelection: { elementId: "another-layer", node: H1 } });
  assert.doesNotMatch(markup, /Brand colors/, "another layer's part isn't this one's");
  markup = inspector(layerOf(), { htmlSelection: selection(999) });
  assert.match(markup, /role="alert">That part of the HTML layer is gone\. Double-click the words again\.</);
  assert.equal(button(markup, "Edit text").disabled, false);
  markup = inspector(layerOf(), { onEditHtmlLayer: undefined, onBreakHtmlLayer: undefined });
  assert.equal(button(markup, "Edit text").disabled, true, "nothing to call");
  assert.equal(button(markup, "Break into layers").disabled, true);
  assert.equal(button(inspector(layerOf({ html: clean('<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"></path></svg>') })), "Edit text").disabled, true, "no words to edit");
  assert.equal(button(inspector(layerOf({ hidden: true })), "Edit text").disabled, true, "a hidden layer");
});

test("protection and locks disable what they protect", () => {
  const states = (element, sel) => {
    const markup = inspector(element, sel ? { htmlSelection: sel } : {});
    const names = [...COLORS, ...SIZES, "Bold", "Clear style", "Edit text", "Break into layers"];
    return Object.fromEntries(buttons(markup).flatMap(item => [item.name, item.text].filter(name => names.includes(name)).slice(0, 1).map(name => [name, item.disabled])));
  };
  const styleLocked = states(layerOf({ protected: ["style"] }), selection(H1));
  assert.ok([...COLORS, ...SIZES, "Bold", "Clear style"].every(name => styleLocked[name] === true), "style controls are off");
  assert.equal(styleLocked["Break into layers"], false);
  const free = states(layerOf(), selection(H1));
  assert.ok(Object.values(free).every(disabled => !disabled));
  assert.deepEqual(states(layerOf({ protected: ["content"] })), { "Edit text": true, "Break into layers": true });
  assert.deepEqual(states(layerOf({ protected: ["delete"] })), { "Edit text": false, "Break into layers": true });
  const locked = states(layerOf({ locked: true }), selection(H1));
  assert.ok(Object.values(locked).every(Boolean), "a locked layer changes nothing");
  assert.ok(Object.values(states(layerOf({ templateRole: "brand" }), selection(H1))).every(Boolean), "brand template layers stay as they are");

  // Clicks on disabled controls do nothing either.
  const changes = click(layerOf({ protected: ["style"] }), selection(H1), "Text color");
  assert.equal(changes.length, 0);
});

test("a deck without a brand guide has no brand colors or sizes, but Bold and Clear style", () => {
  const markup = inspector(layerOf({ tokens: undefined }), { htmlSelection: selection(LEGEND) });
  assert.match(markup, /This deck has no brand guide, so there are no brand colors or sizes\./);
  assert.doesNotMatch(markup, /Brand colors|Brand text sizes/);
  assert.equal(button(markup, "Bold").disabled, false);
  assert.equal(button(markup, "Clear style").disabled, false);
  const changes = click(layerOf({ tokens: undefined }), selection(LEGEND), "Bold");
  assert.match(changes[0].html, /<p class="legend" style="font-weight: 700">/);
});

test("a color goes on the selected words, or on the whole part; every click is its own undo step", () => {
  let changes = click(layerOf(), selection(LEGEND, { start: 3, end: 6 }), "Accent color");
  assert.equal(changes.length, 1);
  assert.match(changes[0].html, /<p class="legend">US <span style="color: var\(--color-accent\)">job<\/span> <b>openings<\/b> since 2022<\/p>/);
  assert.match(changes[0].group, /^html-style:chart:\d+$/);
  assert.equal(changes[0].scene.elements[0].id, "chart");
  const again = click(layerOf(), selection(LEGEND, { start: 3, end: 6 }), "Accent color");
  assert.notEqual(again[0].group, changes[0].group, "a new undo step");

  changes = click(layerOf(), selection(LEGEND), "Muted color");
  assert.match(changes[0].html, /<p class="legend" style="color: var\(--color-source\)">US job <b>openings<\/b>/);
  changes = click(layerOf(), selection(LABEL, { start: 0, end: 5 }), "Accent 2 color");
  assert.match(changes[0].html, /<text x="4" y="20" style="fill: var\(--color-text\)"><tspan style="fill: var\(--color-accent-end\)">7,669<\/tspan> <tspan>\+96%<\/tspan><\/text>/, "SVG words become a filled tspan");
  assert.equal(click(layerOf(), selection(H1), "Accent color").length, 0, "the color it has already: no change, no undo step");

  const tree = Panel({ scene: sceneOf(layerOf()), element: layerOf(), selection: selection(H1), onChange: noop, onEditHtmlLayer: noop, onBreakHtmlLayer: noop });
  const all = findAll(tree, element => element.type === "button");
  assert.ok(all.length >= COLORS.length + SIZES.length + 3);
  for (const item of all) {
    let prevented = false;
    item.props.onMouseDown({ preventDefault: () => { prevented = true; } });
    assert.ok(prevented, "every control keeps the canvas's focus and selection");
  }
});

test("a size brings the style's weight; Bold toggles; Clear style empties the part and its words", () => {
  let changes = click(layerOf(), selection(LEGEND), "Title · 56");
  assert.match(changes[0].html, /<p class="legend" style="font-size: var\(--title-size\); font-weight: var\(--title-weight\)">/);
  changes = click(layerOf(), selection(LEGEND, { start: 7, end: 15 }), "Body · 43");
  assert.match(changes[0].html, /<b style="font-size: var\(--body-size\); font-weight: var\(--body-weight\)">openings<\/b>/, "the <b> that holds exactly those words takes the size");

  assert.match(click(layerOf(), selection(LEGEND), "Bold")[0].html, /<p class="legend" style="font-weight: 700">/);
  assert.match(click(layerOf(), selection(H1), "Bold")[0].html, /<h1 style="color: var\(--color-accent\); font-size: var\(--title-size\)">/, "bold off removes the weight");
  assert.match(click(layerOf(), selection(H1, { start: 0, end: 2 }), "Bold")[0].html, /<span style="font-weight: 400">AI<\/span> vs Jobs/, "words in a bold part get a normal weight");

  const html = clean(`<p class="legend" style="color: var(--color-accent); font-size: var(--body-size); letter-spacing: 1px">US <span style="color: var(--color-text); font-weight: 700; font-family: var(--title-font)">job</span> openings <svg viewBox="0 0 10 10"><path d="M0 0h10v10z" style="fill: #00D98A"></path></svg></p>`);
  changes = click(layerOf({ html }), selection(0, { start: 3, end: 6 }), "Clear style");
  assert.match(changes[0].html, /^<p class="legend" style="letter-spacing: 1px">US <span>job<\/span> openings <svg/);
  assert.match(changes[0].html, /<path d="M0 0h10v10z" style="fill: #00D98A"/i, "an icon inside keeps its fill");
});

test("errors read as plain English in the panel", () => {
  updates.length = 0;
  const element = layerOf();
  const tree = Panel({ scene: sceneOf(element), element, selection: selection(LEGEND), onChange: () => assert.fail("nothing to save"), onEditHtmlLayer: noop, onBreakHtmlLayer: noop });
  element.html = "<p>Only one part now</p>";
  control(tree, "Accent color").props.onClick();
  assert.deepEqual(updates.at(-1), { key: `${LEGEND}::`, message: "That part of the HTML layer is gone. Click the text again." });
});

test("editing a part on the canvas brings up the HTML tab", () => {
  let markup = inspector(layerOf(), { initialSection: "position", htmlSelection: selection(H1) });
  assert.match(markup, /data-section="html" aria-pressed="true"/, "the inspector's own tab");
  markup = inspector(layerOf(), { initialSection: "position" });
  assert.match(markup, /data-section="position" aria-pressed="true"/, "no part, no switch");
  const sections = [];
  Inspector({ ...inspectorProps(layerOf()), initialSection: "position", onSectionChange: section => sections.push(section), htmlSelection: selection(H1) });
  assert.deepEqual(sections, ["html"], "the editor's tab");
  sections.length = 0;
  Inspector({ ...inspectorProps(layerOf()), initialSection: "position", onSectionChange: section => sections.push(section) });
  assert.deepEqual(sections, []);
});
