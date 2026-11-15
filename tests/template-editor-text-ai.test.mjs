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

// A loader that resolves @/ and relative imports, for components and their libraries.
const modules = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const unit = { exports: {} };
  modules.set(filename, unit.exports);
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

const { createCanvasElement } = load("lib/template-editor/model.ts");
const ai = load("lib/template-editor/text-ai.ts");
const { accentedText, textAccents } = load("lib/template-editor/text-accents.ts");
const { TextAiMenu, textAiLayer } = load("components/template-editor/text-ai-menu.tsx");
const { QuickToolbar } = load("components/template-editor/quick-toolbar.tsx");

const text = (value, extra = {}) => ({ ...createCanvasElement("text", { text: value, ...extra }), id: extra.id ?? "t" });
const accented = (value, phrase, extra) => { const start = value.indexOf(phrase); return { ...text(value, extra), ...accentedText(value, [{ start, end: start + phrase.length, style: "accent" }]) }; };
const phrases = element => textAccents(element).map(accent => [element.text.slice(accent.start, accent.end), accent.style]);
const scene = elements => ({ background: "#fff", elements });

test("requests are checked: actions, their choices, counts and selections", () => {
  assert.throws(() => ai.parseTextAiRequest({ action: "nope", text: "Hi" }), /action must be one of/);
  assert.throws(() => ai.parseTextAiRequest({ action: "shorten", text: "  " }), /empty/);
  assert.throws(() => ai.parseTextAiRequest({ action: "tone", text: "Hi" }), /Pick a tone/);
  assert.throws(() => ai.parseTextAiRequest({ action: "tone", text: "Hi", tone: "angry" }), /tone must be/);
  assert.throws(() => ai.parseTextAiRequest({ action: "translate", text: "Hi" }), /Pick a language/);
  assert.throws(() => ai.parseTextAiRequest({ action: "translate", text: "Hi", language: "<script>" }), /language name/);
  assert.throws(() => ai.parseTextAiRequest({ action: "custom", text: "Hi", instruction: " " }), /Write what/);
  assert.throws(() => ai.parseTextAiRequest({ action: "shorten", text: "Hi", count: 9 }), /count must be 1 to 5/);
  assert.throws(() => ai.parseTextAiRequest({ action: "shorten", text: "x".repeat(4001) }), /longer than 4000/);
  assert.throws(() => ai.parseTextAiRequest({ action: "shorten", text: "Hello", selection: { start: 3, end: 2 } }), /selection must be/);
  assert.equal(ai.parseTextAiRequest({ action: "alternatives", text: "Hi" }).count, 5);
  assert.equal(ai.parseTextAiRequest({ action: "punchier", text: "Hi" }).count, 1);
  // A selection of the whole box is the box.
  assert.equal(ai.parseTextAiRequest({ action: "shorten", text: "Hello", selection: { start: 0, end: 5 } }).selection, undefined);
  assert.deepEqual(ai.parseTextAiRequest({ action: "shorten", text: "Hello world", selection: { start: 6, end: 11 } }).selection, { start: 6, end: 11 });
});

test("the context says the box's role, what fits, the slide's other words and the accented phrases", () => {
  const cover = accented("OpenAI ships GPT-6 today", "GPT-6", { id: "cover", width: 300, height: 120, fontSize: 30, smartText: { role: "cover", lines: 3, minFontSize: 20, maxFontSize: 40, maxHeight: 200 } });
  const other = text("Source: OpenAI", { id: "src" }), hidden = text("Secret", { id: "h", hidden: true });
  const context = ai.textAiContextFor(scene([cover, other, hidden]), cover);
  assert.equal(context.role, "cover");
  assert.equal(context.lines, 3);
  assert.deepEqual(context.slideTexts, ["Source: OpenAI"]);
  assert.deepEqual(context.accents, ["GPT-6"]);
  assert.equal(context.maxChars, 20 * 3);
  assert.equal(ai.textAiContextFor(scene([other]), text("Point", { listStyle: "bullet", fontSize: 14 })).role, "list");
});

test("the prompt carries the rules, the ask, the selection and the brand brief", () => {
  const request = ai.parseTextAiRequest({ action: "tone", tone: "playful", text: "Engine makes slides", selection: { start: 7, end: 12 }, instruction: "Keep it short" });
  const { instructions, input } = ai.textAiPrompt(request, { role: "heading", slideTexts: ["Other line"], accents: [], brief: "BRIEF: no full stops" });
  assert.match(instructions, /Never invent facts/);
  assert.match(instructions, /square brackets/);
  assert.match(instructions, /Only the selected part changes/);
  assert.match(instructions, /BRIEF: no full stops/);
  assert.match(input, /playful tone/);
  assert.match(input, /Also: Keep it short/);
  assert.match(input, /Selected part to change:\n"""makes"""/);
  assert.match(input, /- Other line/);
});

test("the model's options are cleaned: unchanged, duplicate and empty ones go, accents must be in the text", () => {
  const request = ai.parseTextAiRequest({ action: "alternatives", text: "Old line", count: 3 });
  const options = ai.parseTextAiOptions({ options: [
    { text: "Old line", accents: [] },
    { text: "New line one", accents: ["one", "missing"] },
    { text: "New line one", accents: [] },
    { text: "  ", accents: [] },
    { text: "Line two", accents: [] },
    { text: "Line three", accents: [] },
    { text: "Line four", accents: [] },
  ] }, request);
  assert.deepEqual(options, [{ text: "New line one", accents: ["one"] }, { text: "Line two", accents: [] }, { text: "Line three", accents: [] }]);
  // Highlight keeps the box's own words and picks only the phrase.
  const highlight = ai.parseTextAiRequest({ action: "highlight", text: "The fastest model yet" });
  assert.deepEqual(ai.parseTextAiOptions({ options: [{ text: "Changed words", accents: ["fastest model"] }] }, highlight), [{ text: "The fastest model yet", accents: ["fastest model"] }]);
  // Fix may return the same text when there was nothing to fix.
  assert.equal(ai.parseTextAiOptions({ options: [{ text: "Fine", accents: [] }] }, ai.parseTextAiRequest({ action: "fix", text: "Fine" })).length, 1);
  assert.deepEqual(ai.parseTextAiOptions("garbage", request), []);
});

test("new accents only on covers, boxes that have some, or highlight; never the whole text", () => {
  const options = [{ text: "Big news today", accents: ["Big news"] }, { text: "All of it", accents: ["All of it"] }];
  assert.deepEqual(ai.keepTextAiAccents(options, { action: "rephrase" }, { role: "heading", accents: [] }).map(option => option.accents), [[], []]);
  assert.deepEqual(ai.keepTextAiAccents(options, { action: "rephrase" }, { role: "cover", accents: [] }).map(option => option.accents), [["Big news"], []]);
  assert.deepEqual(ai.keepTextAiAccents(options, { action: "highlight" }, { role: "body", accents: [] }).map(option => option.accents), [["Big news"], []]);
  assert.deepEqual(ai.keepTextAiAccents(options, { action: "shorten" }, { role: "body", accents: ["old"] }).map(option => option.accents), [["Big news"], []]);
});

test("accent ranges don't overlap and take each phrase's first free place", () => {
  assert.deepEqual(ai.accentRanges("big big deal", ["big", "big deal", "deal"]), [{ start: 0, end: 3, style: "accent" }, { start: 4, end: 12, style: "accent" }]);
});

test("placing an option keeps accents that survive and colored words, and drops ones that don't", () => {
  const start = "OpenAI ships GPT-6".indexOf("GPT-6");
  const element = { ...text("OpenAI ships GPT-6", { fill: "#111111" }), ...accentedText("OpenAI ships GPT-6", [{ start, end: start + 5, style: "accent" }]) };
  const placed = ai.applyTextAiOption(element, { text: "GPT-6 is here from OpenAI", accents: ["GPT-6"] });
  assert.equal(placed.text, "GPT-6 is here from OpenAI");
  assert.deepEqual(phrases(placed), [["GPT-6", "accent"]]);
  const plain = ai.applyTextAiOption(element, { text: "Nothing accented", accents: [] });
  assert.equal(plain.richText, undefined);
  assert.deepEqual(phrases(plain), []);
  assert.equal(plain.fill, "#111111");
});

test("Add as new layer makes a free copy under the box with the option's text", () => {
  const element = { ...accented("Cover text", "Cover", { id: "cover", name: "Title", y: 100, height: 60 }), slot: "title", locked: true, templateRole: "media" };
  const layer = textAiLayer(element, { text: "New cover", accents: ["New"] }, 450, "copy");
  assert.equal(layer.id, "copy");
  assert.equal(layer.name, "Title (AI)");
  assert.equal(layer.y, 168);
  assert.equal(layer.locked, false);
  assert.equal(layer.slot, undefined);
  assert.equal(layer.templateRole, undefined);
  assert.deepEqual(phrases(layer), [["New", "accent"]]);
  // It stays on the slide.
  assert.equal(textAiLayer({ ...element, y: 400 }, { text: "x", accents: [] }, 450, "c").y, 450 - 60);
});

test("the AI menu opens on an instruction box and the actions", () => {
  const element = text("Engine", { id: "title" });
  const html = renderToStaticMarkup(React.createElement(TextAiMenu, { scene: scene([element]), element, deck: { format: "portrait" }, close() {}, update() {}, onChange() {} }));
  assert.match(html, /aria-label="Tell the AI what to do"/);
  for (const action of ai.TEXT_AI_ACTIONS.filter(item => item.id !== "custom")) assert.ok(html.includes(action.label), action.label);
  assert.match(html, /\[brackets\]/);
});

test("the text bar has an AI button for one editable text box when it knows the deck", () => {
  const props = elements => ({ scene: scene(elements), selectedIds: elements.map(item => item.id), disabled: false, onChange() {}, onDuplicate() {}, onDelete() {}, onMore() {}, onAddText() {}, onUpload() {} });
  const one = [text("Engine", { id: "a" })], two = [text("A", { id: "a" }), text("B", { id: "b" })];
  const markup = (elements, extra) => renderToStaticMarkup(React.createElement(QuickToolbar, { ...props(elements), ...extra }));
  assert.match(markup(one, { aiDeck: { format: "portrait" } }), /<button[^>]*aria-label="AI"[^>]*>/);
  assert.doesNotMatch(markup(one, { aiDeck: { format: "portrait" } }), /<button[^>]*aria-label="AI"[^>]*disabled/);
  assert.match(markup(two, { aiDeck: { format: "portrait" } }), /<button[^>]*aria-label="AI"[^>]*disabled=""/);
  assert.doesNotMatch(markup(one, {}), /aria-label="AI"/);
});
