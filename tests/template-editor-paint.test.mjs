import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText;
  const unit = { exports: {} }; cache.set(filename, unit.exports);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : requireModule(name), unit, unit.exports);
  return unit.exports;
}
const model = load("lib/template-editor/model.ts"), paint = load("lib/template-editor/paint.ts");
const mint = paint.GRADIENT_PRESETS[0].paint;
const photo = { src: "https://images.example/texture.jpg", objectFit: "cover", cropX: 50, cropY: 50 };
const richText = '<b>Hello</b> <span class="gf-font-inter" style="color:#f008; font-size:22px; font-style:italic" data-texture-id="photo">world</span>';
const text = patch => model.createCanvasElement("text", { text: "Hello world", richText, color: "#fff", textureFill: photo, wordTextures: [{ ...photo, id: "photo" }], ...patch });

test("whole-text gradients replace conflicting colors and textures, preserving words and font styling", () => {
  const original = text({ colorRoleId: "brand" });
  const changed = paint.applyElementPaint(original, mint);
  assert.deepEqual(changed.gradient, mint.gradient);
  assert.equal(changed.textureFill, undefined);
  assert.equal(changed.wordTextures, undefined);
  assert.equal(changed.colorRoleId, undefined);
  assert.equal(changed.text, original.text);
  assert.equal(model.richTextToPlain(changed.richText), original.text);
  assert.match(changed.richText, /<b>Hello<\/b>/);
  assert.match(changed.richText, /class="gf-font-inter" style="font-size:22px; font-style:italic"/);
  assert.doesNotMatch(changed.richText, /color:|data-texture-id/);
  assert.ok(model.parseCanvasScene({ background: "#fff", elements: [changed] }));
  assert.equal(original.richText, richText);
  assert.equal(original.textureFill, photo);
});

test("whole-text solid color removes a previous gradient and inline paint overrides", () => {
  const changed = paint.applyElementPaint(text({ gradient: mint.gradient }), { type: "solid", color: "#1238" });
  assert.equal(changed.color, "#11223388");
  assert.equal(changed.gradient, undefined);
  assert.equal(changed.textureFill, undefined);
  assert.doesNotMatch(changed.richText, /color:|data-texture-id/);
  assert.match(changed.richText, /font-style:italic/);
});

test("shape fill switches between gradient and solid without changing the outline or photo", () => {
  const original = model.createCanvasElement("shape", { fill: "#123456", stroke: "#654321", strokeWidth: 3, imageFill: photo });
  const changed = paint.applyElementPaint(original, mint);
  assert.deepEqual(changed.gradient, mint.gradient);
  assert.equal(changed.imageFill, original.imageFill);
  assert.equal(changed.stroke, original.stroke);
  assert.equal(changed.strokeWidth, original.strokeWidth);
  const solid = paint.applyElementPaint(changed, { type: "solid", color: "transparent" });
  assert.equal(solid.fill, "#00000000");
  assert.equal(solid.gradient, undefined);
});

test("selected-word solids clear local textures while gradients remain a whole-layer operation", () => {
  assert.deepEqual(paint.paintTextFormattingPatch({ type: "solid", color: "#ff0000" }), { color: "#ff0000", colorRoleId: undefined, textureFill: null });
  assert.equal(paint.paintTextFormattingPatch(mint), undefined);
});

test("recent swatches deduplicate normalized solids and gradients, retaining the latest 12", () => {
  let recent = [];
  for (let index = 0; index < 15; index++) recent = paint.addRecentPaint(recent, { type: "solid", color: `#${index.toString(16).padStart(6, "0")}` });
  assert.equal(recent.length, 12);
  recent = paint.addRecentPaint(recent, mint);
  recent = paint.addRecentPaint(recent, { ...mint, gradient: { ...mint.gradient, angle: 450, stops: [...mint.gradient.stops].reverse() } });
  assert.equal(recent.length, 12);
  assert.equal(recent.filter(item => item.type === "gradient").length, 1);
  assert.deepEqual(recent[0], mint);
  recent = paint.addRecentPaint(recent, { type: "solid", color: "white" });
  recent = paint.addRecentPaint(recent, { type: "solid", color: "#fff" });
  assert.equal(recent.filter(item => item.type === "solid" && item.color === "#ffffff").length, 1);
  assert.deepEqual(paint.recentPaintsFromStorage(JSON.stringify(recent)), recent);
});

test("corrupted storage and unsafe or unsaveable paints are ignored", () => {
  for (const raw of [null, "{broken", "{}", "null"]) assert.deepEqual(paint.recentPaintsFromStorage(raw), []);
  const invalid = [null, {}, { type: "solid", color: "url(https://example.com)" }, { type: "gradient", gradient: { ...mint.gradient, stops: [] } }, { type: "gradient", gradient: { ...mint.gradient, stops: [{ color: "#fff", position: -10 }, { color: "#000", position: 100 }] } }];
  assert.deepEqual(paint.recentPaintsFromStorage(JSON.stringify([...invalid, mint])), [mint]);
});

test("moving a stop keeps its selected index while committed gradient remains sorted", () => {
  const changed = paint.updatePaintStop(mint, 0, { position: 100, color: "#ff0000" });
  assert.deepEqual(changed.gradient.stops[0], { position: 100, color: "#ff0000" });
  assert.equal(paint.updatePaintStop(changed, 0, { position: NaN }), changed);
  assert.equal(paint.updatePaintStop(changed, 0, { position: 101 }), changed);
  const moved = paint.updatePaintStop(changed, 1, { position: 0 });
  const committed = paint.applyElementPaint(text(), moved);
  assert.equal(committed.gradient.stops[0].position, 0);
  assert.equal(committed.gradient.stops[1].color, "#ff0000");
});

test("multi-selection shows a common normalized fill or an explicit mixed state", () => {
  assert.deepEqual(paint.commonElementPaint([text({ color: "#fff" }), text({ color: "#ffffff" })]), { type: "solid", color: "#fff" });
  assert.equal(paint.commonElementPaint([text({ color: "#fff" }), text({ color: "#000" })]), undefined);
  assert.equal(paint.commonElementPaint([]), undefined);
  assert.equal(paint.commonElementPaint([text(), model.createCanvasElement("image")]), undefined);
});
