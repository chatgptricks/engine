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
const model = load("lib/template-editor/model.ts"), helper = load("lib/template-editor/text-word-textures.ts");
const photo = (name = "new") => ({ src: `https://images.example/${name}.jpg`, objectFit: "cover", cropX: 50, cropY: 50 });
const text = (value, patch = {}) => ({ ...model.createCanvasElement("text"), id: "title", text: value, ...patch });
const words = helper.textTextureWords;
const apply = helper.applyWordTexture;
const scene = element => ({ background: "#ffffff", elements: [element] });
const safeRoundTrip = element => {
  assert.equal(model.richTextToPlain(element.richText), element.text);
  const parsed = model.parseCanvasScene(scene(element));
  assert.ok(parsed, "result remains a valid saveable scene");
  assert.deepEqual(parsed.elements[0].wordTextures, element.wordTextures);
};

test("word chips identify repeated occurrences and use DOM-compatible offsets", () => {
  const element = text("Hello, hello!\nHello 👋 café.");
  const chips = words(element);
  assert.deepEqual(chips.map(({ text, start, end, line }) => ({ text, start, end, line })), [
    { text: "Hello", start: 0, end: 5, line: 0 },
    { text: "hello", start: 7, end: 12, line: 0 },
    { text: "Hello", start: 14, end: 19, line: 1 },
    { text: "café", start: 23, end: 27, line: 1 },
  ]);
  assert.equal(new Set(chips.map(word => word.id)).size, chips.length);
  const output = apply(element, [chips[1].id], photo(), "selected");
  assert.deepEqual(words(output).map(word => word.textureId), [undefined, "selected", undefined, undefined]);
  assert.equal(output.text, element.text); safeRoundTrip(output);
});

test("noncontiguous words preserve emphasis, custom font, alpha color and entities", () => {
  const original = text("Bold & italic third", { richText: '<b>Bold</b> &amp; <span class="gf-font-geist" style="font-style:italic; color:#abc8; font-size:22px; text-decoration:underline line-through">italic</span> <s>third</s>' });
  const output = apply(original, [0, 2], photo(), "photo");
  assert.match(output.richText, /<b><span data-texture-id="photo">Bold<\/span><\/b>/);
  assert.match(output.richText, /class="gf-font-geist" style="font-style:italic; color:#abc8; font-size:22px; text-decoration:underline line-through">italic/);
  assert.match(output.richText, /&amp;/);
  assert.match(output.richText, /<s><span data-texture-id="photo">third<\/span><\/s>/);
  assert.deepEqual(words(output).map(word => word.textureId), ["photo", undefined, "photo"]);
  assert.equal(output.wordTextures.length, 1);
  assert.ok(!output.richText.includes("https://"));
  assert.equal(original.wordTextures, undefined); safeRoundTrip(output);
});

test("ranges select entire intersecting words across styled runs and newlines", () => {
  const original = text("cooperate & second\nthird", { richText: 'co<b>operate</b> &amp; second<br><i>third</i>' });
  const chips = words(original);
  const output = apply(original, [{ start: 2, end: 4 }, { start: chips[2].start + 1, end: chips[2].end - 1 }], photo(), { textureId: "range" });
  assert.deepEqual(words(output).map(word => word.textureId), ["range", undefined, "range"]);
  assert.match(output.richText, /<b><span data-texture-id="range">operate<\/span><\/b>/);
  assert.match(output.richText, /<br><i><span data-texture-id="range">third<\/span><\/i>/);
  assert.equal(output.text, original.text); safeRoundTrip(output);
});

test("whole-title removal on one word cannot inherit the original whole texture", () => {
  const original = text("First, second!", { textureFill: photo("base"), richText: '<b>First,</b> <span style="color:#ff000080">second!</span>' });
  const output = apply(original, [1], null, { baseTextureId: "base" });
  assert.equal(output.textureFill, undefined);
  assert.deepEqual(words(output).map(word => word.textureId), ["base", undefined]);
  assert.match(output.richText, /style="color:#ff000080">second<span data-texture-id="base">!<\/span>/);
  assert.match(output.richText, /<span data-texture-id="base"> <\/span>/);
  assert.equal(output.wordTextures[0].src, photo("base").src); safeRoundTrip(output);
});

test("local replacement preserves the whole background and preexisting word overrides", () => {
  const original = text("First second third", { textureFill: photo("base"), richText: 'First <span data-texture-id="old" style="font-weight:700">second</span> third', wordTextures: [{ ...photo("old"), id: "old" }] });
  const output = apply(original, [2], photo("chosen"), { textureId: "chosen", baseTextureId: "base" });
  assert.equal(output.textureFill, undefined);
  assert.deepEqual(words(output).map(word => word.textureId), ["base", "old", "chosen"]);
  assert.match(output.richText, /style="font-weight:700"><span data-texture-id="old">second/);
  assert.equal(output.wordTextures.length, 3); safeRoundTrip(output);
});

test("removing an inherited texture preserves nested styles and cleans dead resources", () => {
  const original = text("First second", { richText: '<span data-texture-id="old" style="font-weight:700">First <i>second</i></span>', wordTextures: [{ ...photo("old"), id: "old" }] });
  const output = apply(original, [1], null);
  assert.deepEqual(words(output).map(word => word.textureId), ["old", undefined]);
  assert.match(output.richText, /<i>second<\/i>/);
  assert.match(output.richText, /style="font-weight:700"/);
  const cleared = apply(output, [0], null);
  assert.deepEqual(words(cleared).map(word => word.textureId), [undefined, undefined]);
  // The untouched space keeps its inherited baseline; Remove all also clears it.
  const entirelyCleared = apply(cleared, "all", null);
  assert.equal(entirelyCleared.wordTextures, undefined);
  assert.ok(!entirelyCleared.richText.includes("data-texture-id")); safeRoundTrip(entirelyCleared);
});

test("all mode replaces or removes whole and word textures while retaining typography", () => {
  const original = text("Styled title", { textureFill: photo("base"), richText: '<b><span data-texture-id="old" style="color:#abc8">Styled</span></b> title', wordTextures: [{ ...photo("old"), id: "old" }] });
  const output = apply(original, "all", photo("whole"));
  assert.deepEqual(output.textureFill, photo("whole"));
  assert.equal(output.wordTextures, undefined);
  assert.match(output.richText, /<b><span style="color:#abc8">Styled<\/span><\/b>/);
  assert.deepEqual(words(output).map(word => word.textureId), ["whole", "whole"]);
  const cleared = apply(output, "all", null);
  assert.equal(cleared.textureFill, undefined);
  assert.equal(cleared.wordTextures, undefined);
  assert.ok(!cleared.richText.includes("data-texture-id")); safeRoundTrip(cleared);
});

test("content/style protections and every ancestor lock/hidden state block scene commands", () => {
  for (const patch of [{ locked: true }, { hidden: true }, { protected: ["content"] }, { protected: ["style"] }]) {
    const element = text("Protected title", patch), original = scene(element);
    assert.equal(apply(element, [0], photo(), "new"), element);
    const result = helper.applyTextWordTexture(original, "title", [0], photo(), "new");
    assert.equal(result.scene, original);
    assert.deepEqual(result.selectedIds, ["title"]);
  }
  for (const state of [{ locked: true }, { hidden: true }]) {
    const original = { ...scene(text("Nested title", { groupId: "child" })), groups: [{ id: "parent", name: "Parent", ...state }, { id: "child", parentId: "parent", name: "Child" }] };
    assert.equal(helper.applyTextWordTexture(original, "title", [0], photo(), "new").scene, original);
  }
  const original = scene(text("Editable title", { protected: ["position", "delete"] }));
  assert.notEqual(helper.applyTextWordTexture(original, "title", [0], photo(), "new").scene, original);
});

test("replacement at the 30-resource limit cleans obsolete textures before enforcing the cap", () => {
  const tokens = Array.from({ length: 31 }, (_, index) => `word${index}`);
  const resources = tokens.slice(0, 30).map((_, index) => ({ ...photo(`photo${index}`), id: `r${index}` }));
  const original = text(tokens.join(" "), { richText: tokens.map((token, index) => index < 30 ? `<span data-texture-id="r${index}">${token}</span>` : token).join(" "), wordTextures: resources });
  const output = apply(original, [0], photo("replacement"), "replacement");
  assert.equal(output.wordTextures.length, 30);
  assert.ok(!output.wordTextures.some(resource => resource.id === "r0"));
  assert.equal(words(output)[0].textureId, "replacement"); safeRoundTrip(output);
  assert.throws(() => apply(original, [30], photo("extra"), "extra"), /30 active/);
  assert.equal(original.wordTextures.length, 30);
  const reused = apply(original, [30], photo("photo0"), "unused-hint");
  assert.equal(reused.wordTextures.length, 30);
  assert.equal(words(reused)[30].textureId, "r0");
});

test("unused resources do not count toward the limit and choosing many words uses one resource", () => {
  const original = text("One two three", { wordTextures: Array.from({ length: 30 }, (_, index) => ({ ...photo(`unused${index}`), id: `unused${index}` })) });
  const output = apply(original, [0, 1, 2, 1], photo(), "new");
  assert.equal(output.wordTextures.length, 1);
  assert.deepEqual(words(output).map(word => word.textureId), ["new", "new", "new"]);
  assert.equal(apply(original, [], photo(), "new"), original); safeRoundTrip(output);
});

test("unsafe assets, stale uploads, malformed ranges and colliding IDs fail atomically", () => {
  const original = text("First second", { richText: '<span data-texture-id="existing">First</span> second', wordTextures: [{ ...photo("existing"), id: "existing" }] });
  const before = JSON.stringify(original);
  assert.throws(() => apply(original, [1], { ...photo(), src: "javascript:alert(1)" }, "bad"), /valid image/);
  assert.throws(() => apply(original, [1], photo(), 'bad"id'), /identifier/);
  assert.throws(() => apply(original, [1], photo(), "existing"), /already belongs/);
  assert.throws(() => apply(original, [1], photo(), { expectedText: "Old text" }), /changed/);
  assert.throws(() => apply(original, [1], photo(), { expectedRichText: "Old HTML" }), /changed/);
  for (const selection of [[99], [-1], [1.5], ["missing"], [{ start: -1, end: 5 }], [{ start: 0, end: 99 }], [{ start: 3, end: 3 }]]) assert.throws(() => apply(original, selection, photo(), "new"), /changed/);
  assert.equal(JSON.stringify(original), before);
});

test("preview IDs produce deterministic outputs and original resources stay immutable", () => {
  const original = text("One two", { textureFill: photo("base") });
  Object.freeze(original.textureFill); Object.freeze(original);
  const options = { textureId: "preview", baseTextureId: "preview-base", expectedText: original.text };
  const first = apply(original, [1], photo(), options), second = apply(original, [1], photo(), options);
  assert.deepEqual(first, second);
  first.wordTextures[0].cropX = 0;
  assert.equal(original.textureFill.cropX, 50);
  assert.equal(second.wordTextures[0].cropX, 50);
  const originalScene = scene(original), result = helper.applyTextWordTexture(originalScene, "title", [1], photo(), options);
  assert.equal(result.scene.elements.length, 1);
  assert.equal(result.scene.elements[0].id, original.id);
  assert.deepEqual(result.selectedIds, ["title"]); assert.equal(result.limited, false);
});

test("reapplying the same texture or clearing untextured words is a semantic no-op", () => {
  const original = text("First second", { richText: '<b>First</b> <i>second</i>' });
  const first = apply(original, [0], photo(), "first");
  let repeated = first;
  for (let index = 0; index < 50; index++) repeated = apply(repeated, [0], photo(), `hint-${index}`);
  assert.equal(repeated, first);
  assert.equal(repeated.richText, first.richText);
  const originalScene = scene(first);
  assert.equal(helper.applyTextWordTexture(originalScene, first.id, [0], photo()).scene, originalScene);
  assert.equal(apply(first, [1], null), first);
  const whole = apply(original, "all", photo());
  assert.equal(apply(whole, [0], photo()), whole);
  assert.equal(apply(whole, "all", photo()), whole);
  assert.equal(apply(original, "all", null), original);
  let alternating = first;
  for (let index = 0; index < 50; index++) alternating = apply(alternating, [0], photo(index % 2 ? "a" : "b"), `alternating-${index}`);
  assert.equal((alternating.richText.match(/<span/g) ?? []).length, 1);
  assert.match(alternating.richText, /<b><span data-texture-id="alternating-49">First<\/span><\/b>/);
});

test("legacy rich mirrors and unsafe HTML use the same visible text source as the renderer", () => {
  const mismatched = text("Old mirror", { richText: "Visible <b>title</b>" });
  assert.deepEqual(words(mismatched).map(word => word.text), ["Visible", "title"]);
  const output = apply(mismatched, [1], photo(), "new");
  assert.equal(output.text, "Visible title"); safeRoundTrip(output);
  const unsafe = text("<Safe> title", { richText: '<img src="invalid">' });
  const fallback = apply(unsafe, [1], photo(), "new");
  assert.equal(fallback.text, "<Safe> title"); assert.match(fallback.richText, /&lt;Safe&gt;/); safeRoundTrip(fallback);
});
