import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url);
function loadModule(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText;
  const unit = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => Object.hasOwn(dependencies, name) ? dependencies[name] : requireModule(name), unit, unit.exports);
  return unit.exports;
}

const model = loadModule("lib/template-editor/model.ts");
const commands = loadModule("lib/template-editor/commands.ts", { "./model": model });
const style = loadModule("lib/template-editor/style-commands.ts", { "./model": model, "./commands": commands });
const spans = loadModule("lib/template-editor/spanning-photos.ts", { "./model": model });
const clipTiming = loadModule("lib/template-editor/clip-timing.ts", { "./model": model });
const agent = loadModule("lib/template-editor/agent-decks.ts", {
  "./model": model,
  "./style-commands": style,
  "./text-accents": loadModule("lib/template-editor/text-accents.ts", { "./model": model, "./brand-guide": loadModule("lib/template-editor/brand-guide.ts", { "./model": model }), "./color-utils": loadModule("lib/template-editor/color-utils.ts") }),
  "./agent-video-layers": loadModule("lib/template-editor/agent-video-layers.ts", { "./model": model }),
  "./spanning-photos": spans,
  "./video-slides": loadModule("lib/template-editor/video-slides.ts", { "./model": model, "./spanning-photos": spans, "./clip-timing": clipTiming }),
  "./html-layer": loadModule("lib/template-editor/html-layer.ts", { "./model": model }),
  "./captions": loadModule("lib/template-editor/captions.ts", { "./model": model, "./clip-timing": clipTiming }),
  "./frames": loadModule("lib/template-editor/frames.ts", { "./model": model }),
});

const text = (value, { id = "t", ...extra } = {}) => ({ ...model.createCanvasElement("text", { text: value, ...extra }), id });
const image = ({ id = "p", ...extra } = {}) => ({ ...model.createCanvasElement("image", { src: "https://example.com/a.jpg", x: 0, y: 0, width: 200, height: 100, ...extra }), id });

test("case modes change every word as Canva's do, and keep styled runs in place", () => {
  assert.equal(style.changeTextCaseMode(text("the best AI tools of 2026"), "upper").text, "THE BEST AI TOOLS OF 2026");
  assert.equal(style.changeTextCaseMode(text("The Best AI Tools"), "lower").text, "the best ai tools");
  assert.equal(style.changeTextCaseMode(text("the best of the AI tools"), "title").text, "The Best of the AI Tools");
  assert.equal(style.changeTextCaseMode(text("HELLO THERE. HOW ARE YOU?\nNEW LINE"), "sentence").text, "Hello there. How are you?\nNew line");
  const rich = text("the BIG news", { richText: 'the <span style="color: #00d98a">BIG</span> news' });
  const titled = style.changeTextCaseMode(rich, "sentence");
  assert.equal(titled.text, "The big news");
  assert.match(titled.richText, /<span style="color: #00d98a">big<\/span>/);
  // A word split across runs still reads as one word.
  const split = style.changeTextCaseMode(text("hello", { richText: "he<b>llo</b> world" }), "title");
  assert.equal(split.text, "Hello World");
  assert.equal(style.detectTextCase([text("ALL CAPS")]), "upper");
  assert.equal(style.detectTextCase([text("ALL CAPS"), text("lower")]), undefined);
});

test("flip toggles a photo layer and a shape's photo fill", () => {
  const flipped = style.flipElement(image(), "horizontal");
  assert.equal(flipped.flipX, true);
  assert.equal(style.flipElement(flipped, "horizontal").flipX, false);
  assert.equal(style.flipElement(image(), "vertical").flipY, true);
  const shape = model.createCanvasElement("shape", { id: "s", imageFill: { src: "https://example.com/a.jpg" } });
  assert.equal(style.flipElement(shape, "vertical").imageFill.flipY, true);
  const plain = model.createCanvasElement("shape", { id: "s" });
  assert.equal(style.flipElement(plain, "vertical"), plain);
});

test("borders are set, capped, removed at zero, and checked", () => {
  const bordered = style.setImageBorder(image(), { style: "dots", width: 400, color: "#FFFFFF" });
  assert.deepEqual(bordered.border, { style: "dots", width: model.IMAGE_BORDER_MAX_WIDTH, color: "#FFFFFF" });
  assert.equal("border" in style.setImageBorder(bordered, null), false);
  assert.equal("border" in style.setImageBorder(bordered, { style: "solid", width: 0, color: "#000000" }), false);
  assert.throws(() => style.setImageBorder(image(), { style: "wavy", width: 2, color: "#000000" }), /Border style/);
  assert.equal(style.borderDashArray({ style: "long-dash", width: 2, color: "#000" }), "8 4");
  assert.equal(style.borderDashArray({ style: "solid", width: 2, color: "#000" }), undefined);
});

test("a saved border survives parsing, and a broken one is refused like any bad field", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Borders", format: "square", slides: [{ id: "s1", layout: "blank", elements: [
    { id: "kept", type: "image", src: "https://example.com/a.jpg", x: 0, y: 0, width: 540, height: 540 },
    { id: "dropped", type: "image", src: "https://example.com/b.jpg", x: 540, y: 0, width: 540, height: 540 },
  ] }] });
  const elements = deck.pages[0].canvas.elements;
  elements[0] = { ...elements[0], border: { style: "short-dash", width: 3, color: "#FF0000" } };
  const parsed = model.parseLibrary(agent.editableDeckPackage(deck));
  assert.ok(parsed, "the package parses");
  assert.deepEqual(parsed.designs[0].pages[0].canvas.elements[0].border, { style: "short-dash", width: 3, color: "#FF0000" });
  elements[1] = { ...elements[1], border: { style: "nope", width: 3, color: "#FF0000" } };
  assert.equal(model.parseLibrary(agent.editableDeckPackage(deck)), null);
});

test("crop to a shape keeps the area and centre, and Original needs the picture's size", () => {
  const square = style.cropToAspect(image(), "1:1");
  assert.ok(Math.abs(square.width - square.height) < 1e-9);
  assert.ok(Math.abs(square.width * square.height - 20000) < 1e-6);
  assert.ok(Math.abs(square.x + square.width / 2 - 100) < 1e-9 && Math.abs(square.y + square.height / 2 - 50) < 1e-9);
  assert.equal(square.fit, "cover");
  const original = style.cropToAspect(image({ intrinsicWidth: 400, intrinsicHeight: 100 }), "original");
  assert.ok(Math.abs(original.width / original.height - 4) < 1e-9);
  assert.throws(() => style.cropToAspect(image(), "original"), /Original/);
});

test("copy style pastes a whole look on the same kind and only shared keys across kinds, skipping locked layers", () => {
  const source = text("Source", { id: "a", font: "inter", fontSize: 30, color: "#00D98A", opacity: 0.5 });
  const snapshot = style.copyStyle(source);
  const sameKind = style.pasteStyle(text("Target", { id: "b", font: "sfpro", fontSize: 12, color: "#FFFFFF" }), snapshot);
  assert.equal(sameKind.font, "inter"); assert.equal(sameKind.fontSize, 30); assert.equal(sameKind.color, "#00D98A"); assert.equal(sameKind.text, "Target");
  const photo = style.pasteStyle(image({ radius: 8 }), snapshot);
  assert.equal(photo.opacity, 0.5); assert.equal(photo.radius, 8); assert.equal(photo.font, undefined);
  const scene = { width: 360, height: 360, background: "#000000", elements: [source, text("Free", { id: "b" }), text("Locked", { id: "c", locked: true }), text("Hidden", { id: "d", hidden: true })] };
  const result = style.pasteStyleOnScene(scene, ["b", "c", "d"], snapshot);
  assert.deepEqual(result.changed, ["b"]);
  assert.deepEqual(result.skipped, ["c", "d"]);
  assert.equal(result.scene.elements[1].fontSize, 30);
  assert.equal(result.scene.elements[2].fontSize, scene.elements[2].fontSize);
});

const deckSpec = () => ({ id: "deck", name: "Toolbar", format: "square", slides: [{ id: "s1", layout: "blank", elements: [
  { id: "head", type: "text", text: "make it big", x: 60, y: 60, width: 900, height: 200, fontSize: 80, color: "#00D98A" },
  { id: "body", type: "text", text: "small words", x: 60, y: 400, width: 900, height: 200, fontSize: 40 },
  { id: "pic", type: "image", src: "https://example.com/a.jpg", x: 0, y: 600, width: 1080, height: 480, border: { style: "solid", width: 12, color: "#FFFFFF" }, cropAspect: "1:1" },
] }] });

test("agents set case, border and crop shape with the same commands, in output pixels", () => {
  const deck = agent.createAgentDeck(deckSpec());
  const pic = deck.pages[0].canvas.elements.find(element => element.id === "pic");
  assert.equal(pic.border.style, "solid");
  assert.ok(Math.abs(pic.border.width - 12 / 3) < 1e-9, "12 output px on a 1080 page is 4 scene units");
  assert.ok(Math.abs(pic.width - pic.height) < 1e-9);
  const updated = agent.updateAgentDeck(deck, { operations: [
    { op: "update_element", pageId: "s1", elementId: "head", properties: { textCase: "upper" } },
    { op: "update_element", pageId: "s1", elementId: "pic", properties: { border: null } },
  ] });
  const [head, , photo] = updated.pages[0].canvas.elements;
  assert.equal(head.text, "MAKE IT BIG");
  assert.equal(photo.border, undefined);
  assert.throws(() => agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "s1", elementId: "head", properties: { textCase: "shouting" } }] }), agent.AgentDeckValidationError);
});

test("agents copy one layer's look onto others, and capabilities list every toolbar command", () => {
  const deck = agent.createAgentDeck(deckSpec());
  const updated = agent.updateAgentDeck(deck, { operations: [{ op: "copy_style", pageId: "s1", from: "head", to: ["body"] }] });
  const body = updated.pages[0].canvas.elements.find(element => element.id === "body");
  assert.equal(body.text, "small words");
  assert.equal(body.color, "#00D98A");
  assert.ok(Math.abs(body.fontSize - 80 / 3) < 1e-9);
  assert.throws(() => agent.updateAgentDeck(deck, { operations: [{ op: "copy_style", pageId: "s1", from: "missing", to: ["body"] }] }), agent.AgentDeckValidationError);
  const toolbar = agent.agentCapabilities().toolbar;
  assert.deepEqual(toolbar.commands.map(command => command.id), style.ELEMENT_COMMANDS.map(command => command.id));
});
