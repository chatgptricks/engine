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

const model = load("lib/template-editor/model.ts");
const fx = load("lib/template-editor/text-effects.ts");
const agent = load("lib/template-editor/agent-decks.ts");
const style = load("lib/template-editor/style-commands.ts");
const { needsPdfRaster } = load("lib/template-editor/pdf-options.ts");
const { TextEffectsPanel } = load("components/template-editor/text-effects-panel.tsx");

const text = (extra = {}) => ({ ...model.createCanvasElement("text", { text: "Engine", fontSize: 40, color: "#112233", ...extra }), id: extra.id ?? "t" });

test("effects are checked: kinds, colors and Canva's ranges", () => {
  assert.deepEqual(model.parseTextEffect({ kind: "drop", direction: -45, offset: 20, color: "#000000" }), { kind: "drop", direction: -45, offset: 20, color: "#000000" });
  assert.deepEqual(model.parseTextEffect({ kind: "outline", thickness: 200 }), { kind: "outline", thickness: 200 });
  assert.equal(model.parseTextEffect({ kind: "sparkle" }), null);
  assert.equal(model.parseTextEffect({ kind: "drop", direction: 200 }), null);
  assert.equal(model.parseTextEffect({ kind: "glow", intensity: 101 }), null);
  assert.equal(model.parseTextEffect({ kind: "glow", color: "red; x" }), null);
  assert.equal(model.parseTextEffect("glow"), null);
});

test("a saved effect survives parsing, and a broken one is refused like any bad field", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Effects", format: "square", slides: [{ id: "s1", layout: "blank", elements: [{ id: "a", type: "text", text: "Hi", x: 0, y: 0, width: 500, height: 200 }] }] });
  deck.pages[0].canvas.elements[0] = { ...deck.pages[0].canvas.elements[0], textEffect: { kind: "neon", intensity: 70 } };
  const parsed = model.parseLibrary(agent.editableDeckPackage(deck));
  assert.deepEqual(parsed.designs[0].pages[0].canvas.elements[0].textEffect, { kind: "neon", intensity: 70 });
  deck.pages[0].canvas.elements[0] = { ...deck.pages[0].canvas.elements[0], textEffect: { kind: "neon", intensity: -1 } };
  assert.equal(model.parseLibrary(agent.editableDeckPackage(deck)), null);
});

test("defaults are Canva's, and a color left out follows the text", () => {
  const drop = fx.textEffectSettings({ kind: "drop" }, "#ffffff");
  assert.equal(drop.direction, -45);
  assert.equal(drop.offset, 20);
  assert.equal(drop.color, "#000000");
  assert.equal(fx.textEffectSettings({ kind: "glow" }, "#00D98A").color, "#00D98A");
  assert.equal(fx.textEffectSettings({ kind: "glow", intensity: 90 }, "#fff").intensity, 90);
});

test("every effect draws in CSS that grows with the font and reaches past the glyphs", () => {
  for (const kind of model.TEXT_EFFECT_KINDS) {
    const small = fx.textEffectStyle({ kind }, "#ffffff", 20), big = fx.textEffectStyle({ kind }, "#ffffff", 80);
    assert.ok(Object.keys(small.style).length > 0, kind);
    assert.ok(big.reach > small.reach && small.reach > 0, `${kind} reach grows with the font`);
  }
  // Drop at −45 goes up and to the right, at the transparency's alpha.
  assert.match(fx.textEffectStyle({ kind: "drop", offset: 40, blur: 0 }, "#fff", 100).style.filter, /^drop-shadow\(14\.14px -14\.14px 0px rgba\(0,0,0,0\.7\)\)$/);
  assert.equal(fx.textEffectStyle({ kind: "hollow" }, "#ff0000", 40).style.WebkitTextFillColor, "transparent");
  assert.match(fx.textEffectStyle({ kind: "hollow" }, "#ff0000", 40).style.WebkitTextStroke, /#ff0000$/);
  assert.equal(fx.textEffectStyle({ kind: "outline" }, "#fff", 40).style.paintOrder, "stroke fill");
  assert.equal(fx.textEffectStyle({ kind: "echo" }, "#fff", 40).style.filter.match(/drop-shadow/g).length, 3);
  assert.match(fx.textEffectStyle({ kind: "glitch" }, "#fff", 40).style.filter, /#00FFFF.*#FF00FF/);
  assert.match(fx.textEffectStyle({ kind: "splice" }, "#fff", 40).style.textShadow, /#808080$/);
  assert.equal(fx.textEffectStyle({ kind: "highlight", transparency: 50, color: "#000000" }, "#fff", 40).style["--te-highlight"], "rgba(0,0,0,0.5)");
});

test("agents set an effect by name or with settings, and remove it with null", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Effects", format: "square", slides: [{ id: "s1", layout: "blank", elements: [
    { id: "a", type: "text", text: "Hi", x: 0, y: 0, width: 500, height: 200, textEffect: "glow" },
    { id: "pic", type: "image", src: "https://example.com/a.jpg", x: 0, y: 300, width: 500, height: 500 },
  ] }] });
  assert.deepEqual(deck.pages[0].canvas.elements[0].textEffect, { kind: "glow" });
  const set = agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "s1", elementId: "a", properties: { textEffect: { kind: "outline", thickness: 120, color: "#00D98A" } } }] });
  assert.deepEqual(set.pages[0].canvas.elements[0].textEffect, { kind: "outline", thickness: 120, color: "#00D98A" });
  const removed = agent.updateAgentDeck(set, { operations: [{ op: "update_element", pageId: "s1", elementId: "a", properties: { textEffect: null } }] });
  assert.equal("textEffect" in removed.pages[0].canvas.elements[0], false);
  assert.throws(() => agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "s1", elementId: "a", properties: { textEffect: "sparkle" } }] }), agent.AgentDeckValidationError);
  assert.throws(() => agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "s1", elementId: "pic", properties: { textEffect: "glow" } }] }), agent.AgentDeckValidationError);
  assert.ok(agent.agentCapabilities().toolbar.commands.some(command => command.id === "text.effect"));
});

test("Copy style carries the effect, and the PDF uses the editor's snapshot for it", () => {
  const source = text({ id: "a", textEffect: { kind: "echo" } }), target = text({ id: "b" });
  const pasted = style.pasteStyleOnScene({ background: "#fff", elements: [source, target] }, ["b"], style.copyStyle(source));
  assert.deepEqual(pasted.scene.elements[1].textEffect, { kind: "echo" });
  assert.equal(needsPdfRaster([text()]), false);
  assert.equal(needsPdfRaster([text({ textEffect: { kind: "drop" } })]), true);
});

test("the Effects panel shows None and the nine effects, and the chosen one's controls", () => {
  const html = renderToStaticMarkup(React.createElement(TextEffectsPanel, { texts: [text({ textEffect: { kind: "glitch" } })], disabled: false, update() {} }));
  for (const label of ["No text effect", ...model.TEXT_EFFECT_KINDS.map(kind => `${fx.TEXT_EFFECTS[kind].label} text effect`)]) assert.ok(html.includes(`aria-label="${label}"`), label);
  assert.match(html, /aria-label="Glitch text effect" aria-pressed="true"/);
  assert.match(html, /Direction/);
  assert.match(html, /Second color/);
  let changed;
  const tree = TextEffectsPanel({ texts: [text()], disabled: false, update: (group, transform) => { changed = [group, transform(text())]; } });
  const tiles = React.Children.toArray(tree.props.children[0].props.children).flat();
  const drop = tiles.find(node => node.props?.["aria-label"] === "Drop text effect");
  drop.props.onClick();
  assert.equal(changed[0], "text-effect");
  assert.deepEqual(changed[1].textEffect, { kind: "drop" });
});
