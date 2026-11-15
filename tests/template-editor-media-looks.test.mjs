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
const looks = load("lib/template-editor/media-looks.ts");
const agent = load("lib/template-editor/agent-decks.ts");
const style = load("lib/template-editor/style-commands.ts");
const { needsPdfRaster } = load("lib/template-editor/pdf-options.ts");
const { MediaLooksPanel } = load("components/template-editor/media-looks-panel.tsx");

const image = (extra = {}) => ({ ...model.createCanvasElement("image", { src: "https://example.com/a.jpg", x: 0, y: 0, width: 200, height: 100, ...extra }), id: extra.id ?? "p" });
const frame = (extra = {}) => ({ ...model.createCanvasElement("shape", { imageFill: { src: "https://example.com/b.jpg", objectFit: "cover", cropX: 50, cropY: 50 }, ...extra }), id: extra.id ?? "s" });
/** A colour through a matrix, 0..255 channels, clamped as the browser does. */
const apply = (m, [r, g, b]) => [0, 1, 2].map(row => Math.round(Math.max(0, Math.min(1, m[row * 5] * r / 255 + m[row * 5 + 1] * g / 255 + m[row * 5 + 2] * b / 255 + m[row * 5 + 4])) * 255));

test("looks are checked: filters, colours and the −100..100 scales; zeros mean no look", () => {
  assert.deepEqual(model.parseMediaLook({ filter: "mono", intensity: 60, brightness: 20 }), { filter: "mono", intensity: 60, brightness: 20 });
  assert.deepEqual(model.parseMediaLook({ filter: "duotone", shadow: "#000000", highlight: "#00D98A" }), { filter: "duotone", shadow: "#000000", highlight: "#00D98A" });
  assert.equal(model.parseMediaLook({ filter: "sparkle" }), null);
  assert.equal(model.parseMediaLook({ contrast: 101 }), null);
  assert.equal(model.parseMediaLook({ filter: "duotone", shadow: "red; x" }), null);
  assert.equal(model.parseMediaLook({ brightness: 0 }), null);
});

test("each filter changes colour as named, and intensity mixes it with the original", () => {
  const red = [200, 40, 40];
  const mono = apply(looks.lookMatrix({ filter: "mono" }), red);
  assert.ok(mono[0] === mono[1] && mono[1] === mono[2], "mono is grey");
  assert.equal(looks.lookMatrix({}), null);
  assert.equal(looks.lookMatrix({ filter: "vivid", intensity: 0 }), null);
  const half = apply(looks.lookMatrix({ filter: "mono", intensity: 50 }), red);
  assert.ok(half[0] < red[0] && half[0] > mono[0], "half mono sits between");
  const warm = apply(looks.lookMatrix({ filter: "warm" }), [128, 128, 128]), cool = apply(looks.lookMatrix({ filter: "cool" }), [128, 128, 128]);
  assert.ok(warm[0] > warm[2] && cool[2] > cool[0], "warm leans red, cool leans blue");
  const vivid = apply(looks.lookMatrix({ filter: "vivid" }), red);
  assert.ok(vivid[0] - vivid[1] > red[0] - red[1], "vivid is more saturated");
  // Duotone: black to the darks colour, white to the lights colour.
  const duo = looks.lookMatrix({ filter: "duotone", shadow: "#102030", highlight: "#00D98A" });
  assert.deepEqual(apply(duo, [0, 0, 0]), [16, 32, 48]);
  assert.deepEqual(apply(duo, [255, 255, 255]), [0, 217, 138]);
});

test("adjustments move light and colour the right way", () => {
  const grey = [128, 128, 128];
  assert.ok(apply(looks.lookMatrix({ brightness: 50 }), grey)[0] > 128);
  assert.ok(apply(looks.lookMatrix({ brightness: -50 }), grey)[0] < 128);
  assert.ok(apply(looks.lookMatrix({ contrast: 60 }), [200, 200, 200])[0] > 200);
  assert.ok(apply(looks.lookMatrix({ contrast: 60 }), [60, 60, 60])[0] < 60);
  const flat = apply(looks.lookMatrix({ saturation: -100 }), [200, 40, 40]);
  assert.ok(flat[0] === flat[1], "no saturation is grey");
  const hot = apply(looks.lookMatrix({ temperature: 100 }), grey), pink = apply(looks.lookMatrix({ tint: 100 }), grey);
  assert.ok(hot[0] > hot[2] && pink[1] < pink[0]);
});

test("a saved look survives parsing on photos and photo frames, and a broken one is refused", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Looks", format: "square", slides: [{ id: "s1", layout: "blank", elements: [{ id: "p", type: "image", src: "https://example.com/a.jpg", x: 0, y: 0, width: 540, height: 540 }] }] });
  const elements = deck.pages[0].canvas.elements;
  elements[0] = { ...elements[0], look: { filter: "vintage", intensity: 70, contrast: 10 } };
  elements.push({ ...frame(), imageFill: { ...frame().imageFill, look: { filter: "mono" } } });
  const parsed = model.parseLibrary(agent.editableDeckPackage(deck));
  assert.deepEqual(parsed.designs[0].pages[0].canvas.elements[0].look, { filter: "vintage", intensity: 70, contrast: 10 });
  assert.deepEqual(parsed.designs[0].pages[0].canvas.elements[1].imageFill.look, { filter: "mono" });
  elements[0] = { ...elements[0], look: { filter: "nope" } };
  assert.equal(model.parseLibrary(agent.editableDeckPackage(deck)), null);
  // A look with only zeros is no look, not an error.
  elements[0] = { ...elements[0], look: { brightness: 0 } };
  assert.equal(model.parseLibrary(agent.editableDeckPackage(deck)).designs[0].pages[0].canvas.elements[0].look, undefined);
});

test("agents set a filter by name, adjust without losing it, and clear it with null", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Looks", format: "square", slides: [{ id: "s1", layout: "blank", elements: [
    { id: "p", type: "image", src: "https://example.com/a.jpg", x: 0, y: 0, width: 540, height: 540, look: "vivid" },
    { id: "t", type: "text", text: "Hi", x: 0, y: 600, width: 500, height: 100 },
  ] }] });
  assert.deepEqual(deck.pages[0].canvas.elements[0].look, { filter: "vivid" });
  const step = (properties, id = "p", from = deck) => agent.updateAgentDeck(from, { operations: [{ op: "update_element", pageId: "s1", elementId: id, properties }] });
  const adjusted = step({ look: { brightness: 20, temperature: -10 } });
  assert.deepEqual(adjusted.pages[0].canvas.elements[0].look, { filter: "vivid", brightness: 20, temperature: -10 });
  const duo = step({ look: { filter: "duotone", highlight: "#FF0066" } }, "p", adjusted);
  assert.deepEqual(duo.pages[0].canvas.elements[0].look, { filter: "duotone", highlight: "#FF0066", brightness: 20, temperature: -10 });
  assert.equal(step({ look: null }, "p", adjusted).pages[0].canvas.elements[0].look, undefined);
  assert.deepEqual(step({ look: { filter: null } }, "p", adjusted).pages[0].canvas.elements[0].look, { brightness: 20, temperature: -10 });
  assert.throws(() => step({ look: { brightness: 300 } }), agent.AgentDeckValidationError);
  assert.throws(() => step({ look: "mono" }, "t"), agent.AgentDeckValidationError);
  assert.ok(agent.agentCapabilities().toolbar.commands.some(command => command.id === "media.filter"));
  assert.ok(agent.agentCapabilities().toolbar.commands.some(command => command.id === "media.adjust"));
});

test("copy style carries the look from photo to photo and onto a photo frame; the PDF draws looks from the snapshot", () => {
  const source = looks.setMediaLook(image(), { filter: "warm", contrast: 15 });
  const snapshot = style.copyStyle(source);
  assert.deepEqual(style.pasteStyle(image({ id: "q" }), snapshot).look, { filter: "warm", contrast: 15 });
  assert.deepEqual(style.pasteStyle(frame(), snapshot).imageFill.look, { filter: "warm", contrast: 15 });
  assert.equal(style.pasteStyle(looks.setMediaLook(image({ id: "r" }), { filter: "mono" }), style.copyStyle(image({ id: "plain" }))).look, undefined, "a plain photo's style clears the look");
  assert.equal(needsPdfRaster([image()]), false);
  assert.equal(needsPdfRaster([source]), true);
  assert.equal(needsPdfRaster([looks.setMediaLook(frame(), { filter: "mono" })]), true);
});

test("the panel shows the picture in each filter and marks the one in use", () => {
  const html = renderToStaticMarkup(React.createElement(MediaLooksPanel, { photos: [looks.setMediaLook(image(), { filter: "duotone" })], disabled: false, update: () => {} }));
  for (const label of ["Original", "Mono", "Noir", "Vintage", "Vivid", "Warm", "Cool", "Fade", "Duotone"]) assert.match(html, new RegExp(`aria-label="${label} filter"`));
  assert.match(html, /aria-label="Duotone filter" aria-pressed="true"/);
  assert.equal((html.match(/<feColorMatrix/g) ?? []).length, 8, "every filter tile but Original has its matrix");
  assert.match(html, /Lights/);
  for (const label of ["Brightness", "Contrast", "Saturation", "Temperature", "Tint"]) assert.match(html, new RegExp(label));
});
