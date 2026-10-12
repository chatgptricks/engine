import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), loaded = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (loaded.has(filename)) return loaded.get(filename);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText;
  const unit = { exports: {} }; loaded.set(filename, unit.exports);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : requireModule(name), unit, unit.exports);
  return unit.exports;
}
const model = load("lib/template-editor/model.ts"), commands = load("lib/template-editor/commands.ts"), advanced = load("lib/template-editor/advanced.ts"), carousel = load("lib/template-editor/continuous-carousel.ts"), geometry = load("lib/template-editor/canvas-geometry.ts");
const scene = elements => ({ background: "#ffffff", elements });
const element = (id, patch = {}) => ({ ...model.createCanvasElement("shape"), id, name: id, width: 40, height: 20, x: 0, y: 0, ...patch });
const document = elements => { const design = model.createBlankDesign("Example", "portrait"); design.pages[0].canvas = scene(elements); return design; };
const library = design => ({ ...structuredClone(model.EMPTY_LIBRARY), designs: [design] });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);

test("advanced artwork, groups, layouts and document resources survive canonical backup round trips", () => {
  const text = model.createCanvasElement("text", { richText: '<b>A</b><br><span style="color:#abc; font-size:24px">B</span>', text: "A\nB", textMode: "auto-height", verticalAlign: "bottom", padding: 8, paragraphSpacing: 7, strikethrough: true, listStyle: "bullet", slot: "headline", protected: ["position"], anchors: { horizontal: "right", vertical: "bottom" }, groupId: "inner", gradient: { type: "linear", angle: 45, stops: [{ color: "#fff", position: 0 }, { color: "#000", position: 100 }] }, shadow: { color: "#12345680", offsetX: 2, offsetY: 3, blur: 8, spread: 1 }, blur: 2, blendMode: "multiply", strokeDash: [2, 5] });
  const image = model.createCanvasElement("image", { cropScale: 3, flipX: true, flipY: false, mask: "ellipse", intrinsicWidth: 2400, intrinsicHeight: 1800 });
  const pathElement = element("path", { shape: "path", path: "M0 0 L100 50 A5 5 0 0 1 50 100Z", viewBox: "0 0 100 100" });
  const design = document([text, image, pathElement]);
  design.pages[0].label = "Cover"; design.pages[0].useMaster = true;
  design.pages[0].canvas.groups = [{ id: "outer", name: "Outer", locked: false }, { id: "inner", name: "Inner", parentId: "outer", hidden: false }];
  design.pages[0].canvas.layout = { rulers: true, showGuides: true, guides: [{ id: "guide", axis: "x", position: 24, locked: true }], margins: { enabled: true, top: 24, right: 24, bottom: 24, left: 24 }, safeArea: { enabled: true, top: 18, right: 18, bottom: 36, left: 18 }, grid: { enabled: true, size: 12, columns: 6, rows: 4, gutter: 8 }, snapping: { enabled: true, objects: true, page: true, guides: true, grid: true, spacing: true, tolerance: 8 } };
  design.styles = [advanced.textStyleFromElement(text, "Headline")];
  design.components = [advanced.componentFromSelection(scene([image]), [image.id], "Photo")];
  design.parameters = [{ id: "headline", name: "Headline", type: "text", required: true, maxLength: 50, defaultValue: "Hi" }];
  design.masterScene = scene([element("master", { master: true })]);
  design.customSize = { width: 1440, height: 1920 }; design.tags = ["news"]; design.folderId = "news"; design.favorite = true; design.reviewStatus = "review";
  design.colorRoles = [{ id: "ink", name: "Ink", color: "#abc" }];
  design.comments = [{ id: "comment", pageId: design.pages[0].id, elementId: text.id, text: "Review headline", createdAt: new Date().toISOString(), resolved: false }];
  const withVersion = advanced.saveDesignVersion(design, "Ready");
  const input = { ...library(withVersion), folders: [{ id: "news", name: "News" }], templates: [model.designAsTemplate(design, "Template")] };
  const parsed = model.parseLibrary(JSON.stringify(input));
  assert.ok(parsed); assert.deepEqual(parsed.designs[0], withVersion); assert.deepEqual(parsed.folders, input.folders);
  assert.deepEqual(parsed.templates[0].colorRoles, design.colorRoles);
  assert.deepEqual(model.parseLibrary(parsed), parsed);
});

test("legacy workspace schema migrates to version 2 and every serialized library retains version 2", () => {
  const original = library(document([element("one")]));
  const migrated = model.parseLibrary({ ...original, version: 1 });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.designs, original.designs);
  assert.equal(model.parseLibrary(JSON.stringify(migrated)).version, 2);
  assert.equal(model.parseLibrary({ ...original, version: 99 }), null);
  assert.equal(model.EMPTY_LIBRARY.version, 2);
});

test("invalid extensions, cycles, references and executable vector paths are rejected atomically", () => {
  const valid = document([element("one")]);
  const invalid = [
    design => { design.pages[0].canvas.elements[0].groupId = "missing"; },
    design => { design.pages[0].canvas.groups = [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }]; },
    design => { design.pages[0].canvas.elements[0].gradient = { type: "linear", angle: 0, stops: [{ color: "url(x)", position: 0 }, { color: "#fff", position: 100 }] }; },
    design => { design.pages[0].canvas.elements[0].path = 'M0 0<script>alert(1)</script>'; },
    design => { design.pages[0].canvas.layout = { guides: [{ id: "a", axis: "x", position: NaN }] }; },
    design => { design.pages[0].canvas.layout = { grid: { enabled: true, size: 0, columns: 3, rows: 3, gutter: 4 } }; },
    design => { design.customSize = { width: 0, height: 2000 }; },
    design => { design.comments = [{ id: "c", text: "Review", createdAt: "not a date" }]; },
  ];
  for (const mutate of invalid) { const design = structuredClone(valid); mutate(design); assert.equal(model.parseLibrary(library(design)), null); }
  assert.equal(model.isSafeVectorPath("M1e999 0Z"), false);
  assert.equal(model.sanitizeRichText('<span style="font-size:99999px">x</span>'), undefined);
  assert.equal(model.sanitizeRichText('<span style="color:expression(alert(1))">x</span>'), undefined);
  assert.equal(model.richTextToPlain('<b>&lt;A&gt;</b><br>&#x1f680; &amp; B'), "<A>\n🚀 & B");
});

test("group nesting, inherited visibility/lock and copy-paste identities remain valid", () => {
  let source = scene([element("a"), element("b", { x: 80 }), element("c", { x: 160 })]);
  source = commands.groupSelection(source, ["a", "b"], "Inner").scene;
  const inner = source.groups[0].id;
  source = commands.groupSelection(source, ["a", "c"], "Outer").scene;
  const outer = source.groups.find(group => !group.parentId).id;
  assert.equal(source.groups.find(group => group.id === inner).parentId, outer);
  assert.deepEqual(commands.expandGroupSelection(source, ["a"]), ["a", "b", "c"]);
  assert.deepEqual(commands.expandGroupSelection(source, ["a"], outer), ["a", "b"]);
  const hidden = commands.setGroupHidden(source, outer, true).scene;
  assert.ok(hidden.elements.every(item => commands.isElementHidden(hidden, item)));
  const locked = commands.setGroupLocked(source, outer, true).scene;
  assert.equal(commands.removeSelection(locked, ["a", "b"]).scene, locked);
  const pasted = commands.pasteSelection(source, commands.copySelection(source, ["a", "b", "c"])).scene;
  assert.equal(pasted.groups.length, 4);
  assert.equal(new Set(pasted.groups.map(group => group.id)).size, 4);
  assert.ok(model.parseLibrary(library(document(pasted.elements.map(item => ({ ...item, groupId: undefined }))))));
  const design = document(pasted.elements); design.pages[0].canvas = pasted;
  assert.ok(model.parseLibrary(library(design)));
  const copy = model.cloneDesign(design);
  assert.notEqual(copy.pages[0].canvas.groups[0].id, pasted.groups[0].id);
  assert.ok(model.parseLibrary(library(copy)));
  const ungrouped = commands.ungroupSelection(source, ["a"]).scene;
  assert.equal(ungrouped.groups.length, 1); assert.equal(ungrouped.groups[0].parentId, undefined);
});

test("alignment scopes retain key object and group offsets; distribution uses rotated visual edges", () => {
  const source = scene([element("a", { x: 10, width: 30 }), element("b", { x: 90, width: 50, rotation: 30 }), element("c", { x: 240, width: 70 }), element("locked", { x: 999, locked: true })]);
  const centered = commands.alignSelectionTo(source, ["a", "b"], "center", { scope: "page", page: { x: 360, y: 0, width: 360, height: 450 }, mode: "group" }).scene;
  close(centered.elements[1].x - centered.elements[0].x, 80);
  close(geometry.sceneVisualBounds(scene(centered.elements.slice(0, 2))).x + geometry.sceneVisualBounds(scene(centered.elements.slice(0, 2))).width / 2, 540);
  const keyAligned = commands.alignSelectionTo(source, ["a", "b", "c"], "left", { scope: "key-object", keyObjectId: "b", page: { width: 360, height: 450 } }).scene;
  assert.deepEqual(keyAligned.elements[1], source.elements[1]);
  close(geometry.elementVisualBounds(keyAligned.elements[0]).x, geometry.elementVisualBounds(source.elements[1]).x);
  const distributed = commands.distributeSelection(source, ["a", "b", "c", "locked"], "horizontal", "gaps").scene;
  const boxes = distributed.elements.slice(0, 3).map(geometry.elementVisualBounds);
  close(boxes[1].x - boxes[0].x - boxes[0].width, boxes[2].x - boxes[1].x - boxes[1].width);
  assert.equal(distributed.elements[3], source.elements[3]);
  const matching = commands.matchSelectionSize(source, ["a", "b", "c"], "both", "b").scene;
  assert.ok(matching.elements.slice(0, 3).every(item => item.width === 50 && item.height === 20));
});

test("protected properties survive delete, transforms and appearance while unrelated edits work", () => {
  const source = scene([element("protected", { protected: ["position", "delete", "style"] }), element("free", { x: 80 })]);
  assert.equal(commands.removeSelection(source, ["protected", "free"]).scene.elements.length, 1);
  const transformed = commands.transformSelection(source, ["protected", "free"], { x: 15, rotation: 30 }).scene;
  assert.deepEqual(transformed.elements[0], source.elements[0]);
  assert.equal(transformed.elements[1].rotation, 30);
  const styled = commands.pasteAppearance(source, ["protected", "free"], commands.copyAppearance(element("style", { fill: "#123456", opacity: .5 }))).scene;
  assert.deepEqual(styled.elements[0], source.elements[0]); assert.equal(styled.elements[1].fill, "#123456");
});

test("continuous mode preserves groups, guides and advanced artwork through merge and split", () => {
  const design = document([element("a", { groupId: "group", shape: "star", starPoints: 5, innerRadius: .4 })]);
  design.pages[0].canvas.groups = [{ id: "group", name: "First" }];
  design.pages[0].canvas.layout = { rulers: true, guides: [{ id: "guide", axis: "x", position: 50 }] };
  design.pages.push(model.duplicatePage(design.pages[0]));
  const continuous = carousel.enableContinuousCarousel(design);
  assert.equal(continuous.continuousCanvas.groups.length, 2);
  assert.deepEqual(continuous.continuousCanvas.layout.guides.map(item => item.position), [50, 410]);
  assert.ok(model.parseLibrary(library(continuous)));
  const separated = carousel.splitContinuousCarousel(continuous);
  assert.ok(model.parseLibrary(library(separated)));
  assert.ok(separated.pages.every(page => page.canvas.elements[0].shape === "star" && page.canvas.groups.length === 1));
  assert.ok(separated.pages.every(page => page.canvas.layout.guides[0].position === 50));
});

test("parameter instantiation validates required fields, supports literal slots and escapes rich text", () => {
  const text = model.createCanvasElement("text", { text: "Hello {{name}}", richText: "Hello <b>{{name}}</b>" });
  const image = model.createCanvasElement("image", { slot: "photo" });
  const template = model.designAsTemplate(document([text, image]), "Parametric");
  template.parameters = [{ id: "name", name: "name", type: "text", required: true, maxLength: 40 }, { id: "photo", name: "Photo", type: "image", required: true }];
  assert.throws(() => advanced.instantiateTemplate(template, { name: "Alice" }), /Photo/);
  const created = advanced.instantiateTemplate(template, { name: "<script>x</script>", photo: "/template-editor/folds.svg" });
  assert.equal(created.pages[0].canvas.elements[0].text, "Hello <script>x</script>");
  assert.equal(created.pages[0].canvas.elements[0].richText, "Hello <b>&lt;script&gt;x&lt;/script&gt;</b>");
  assert.throws(() => advanced.instantiateTemplate(template, { name: "Alice", photo: "javascript:alert(1)" }), /invalid artwork/);
  assert.throws(() => advanced.instantiateTemplate(template, { name: "x".repeat(41), photo: "/template-editor/folds.svg" }), /40-character/);
  assert.deepEqual(advanced.parseTabularData('name,body\r\n"Alice, A","line 1\nline 2"\r\nBob,"He said ""hi"""'), [{ name: "Alice, A", body: "line 1\nline 2" }, { name: "Bob", body: 'He said "hi"' }]);
  assert.throws(() => advanced.parseTabularData("name,name\na,b"), /unique/);
  assert.throws(() => advanced.parseTabularData("__proto__,body\nx,y"), /column/);
  const colorText = model.createCanvasElement("text", { text: "Preserve words", slot: "ink" });
  const colorTemplate = model.designAsTemplate(document([colorText]), "Colors");
  colorTemplate.parameters = [{ id: "ink", name: "Ink", type: "color", defaultValue: "" }];
  assert.ok(model.parseLibrary({ ...model.EMPTY_LIBRARY, templates: [colorTemplate] }));
  const colored = advanced.instantiateTemplate(colorTemplate, { ink: "#123456" });
  assert.equal(colored.pages[0].canvas.elements[0].text, "Preserve words"); assert.equal(colored.pages[0].canvas.elements[0].color, "#123456");
});

test("shared styles, reusable components and master composition operate across pages", () => {
  const text = model.createCanvasElement("text", { fontSize: 20 });
  const style = advanced.textStyleFromElement(text, "Title");
  const design = document([text]);
  design.pages[0].canvas = advanced.applyTextStyle(design.pages[0].canvas, [text.id], style).scene;
  design.pages.push(model.duplicatePage(design.pages[0]));
  const changed = advanced.updateTextStyle(design, { ...style, fontSize: 40, color: "#123456" });
  assert.ok(changed.pages.every(page => page.canvas.elements[0].fontSize === 40));
  const component = advanced.componentFromSelection(scene([element("a"), element("b", { x: 60 })]), ["a", "b"], "Badge");
  const inserted = advanced.insertComponent(design.pages[0].canvas, component, { x: 90, y: 100 });
  const linked = { ...design, pages: [{ ...design.pages[0], canvas: inserted.scene }], components: [component] };
  const replacement = { ...component, scene: { ...component.scene, elements: component.scene.elements.map(item => ({ ...item, fill: "#abcdef" })) } };
  const updated = advanced.updateComponentInstances(linked, replacement);
  assert.ok(updated.pages[0].canvas.elements.filter(item => item.componentId).every(item => item.fill === "#abcdef"));
  assert.ok(model.parseLibrary(library(updated)));
  updated.masterScene = scene([element("master", { x: 20 })]);
  const composition = advanced.composeScene(updated, 0);
  assert.equal(composition.elements[0].id, "master-master"); assert.equal(composition.elements[0].locked, true);
  assert.equal(composition.elements[1].id, updated.pages[0].canvas.elements[0].id);
  updated.pages[0].useMaster = false; assert.equal(advanced.composeScene(updated, 0).elements.length, updated.pages[0].canvas.elements.length);
});

test("linked component updates preserve instance rotation, scale and content overrides", () => {
  const text = model.createCanvasElement("text", { text: "Default", x: 10, y: 20, width: 80, height: 30 });
  const component = advanced.componentFromSelection(scene([text, element("icon", { x: 100 })]), [text.id, "icon"], "Header");
  const inserted = advanced.insertComponent(scene([]), component, { x: 60, y: 70 });
  const transformed = commands.transformSelection(inserted.scene, inserted.selectedIds, { scaleX: 1.5, scaleY: 1.5, rotation: 30 });
  transformed.scene.elements[0].text = "Custom title";
  const design = document(transformed.scene.elements); design.pages[0].canvas = transformed.scene; design.components = [component];
  const replacement = { ...component, scene: { ...component.scene, elements: component.scene.elements.map(item => item.type === "text" ? { ...item, color: "#123456", text: "New default" } : { ...item, fill: "#abc" }) } };
  const updated = advanced.updateComponentInstances(design, replacement);
  const actual = updated.pages[0].canvas.elements;
  actual.forEach((item, index) => { close(item.x, transformed.scene.elements[index].x); close(item.y, transformed.scene.elements[index].y); close(item.width, transformed.scene.elements[index].width); close(item.rotation, 30); });
  assert.equal(actual[0].text, "Custom title"); assert.equal(actual[0].color, "#123456"); assert.ok(model.parseLibrary(library(updated)));
});

test("saved versions restore artwork and resize reflow obeys top/bottom anchors", () => {
  const design = document([element("top", { y: 20, anchors: { horizontal: "left", vertical: "top" } }), element("bottom", { y: 400, anchors: { horizontal: "right", vertical: "bottom" } })]);
  const saved = advanced.saveDesignVersion(design, "Original");
  saved.pages[0].canvas.elements[0].y = 200;
  const restored = advanced.restoreDesignVersion(saved, saved.versions[0].id);
  assert.equal(restored.pages[0].canvas.elements[0].y, 20);
  assert.equal(restored.id, design.id); assert.equal(restored.name, design.name);
  const resized = advanced.resizeDesignDocument(restored, { width: 1080, height: 1920 }, "reflow");
  assert.equal(resized.pages[0].canvas.elements[0].y, 20); assert.equal(resized.pages[0].canvas.elements[1].y, 590);
  const contained = advanced.resizeDesignDocument(restored, { width: 1080, height: 1080 }, "contain");
  close(contained.pages[0].canvas.elements[0].width / contained.pages[0].canvas.elements[0].height, 2);
  assert.ok(model.parseLibrary(library(resized)));
});

test("reflow applies both anchors and retains native pixels for text, frames, strokes and shared styles", () => {
  const left = model.createCanvasElement("text", { x: 30, y: 40, width: 100, height: 40, fontSize: 32, richText: '<span style="font-size:40px">Words</span>', padding: 4, letterSpacing: 2, paragraphSpacing: 8, anchors: { horizontal: "left", vertical: "top" } });
  const right = element("right", { x: 240, y: 350, width: 80, height: 40, radius: 12, strokeWidth: 4, strokeDash: [2, 6], shadow: { color: "#000", offsetX: 4, offsetY: 6, blur: 10, spread: 2 }, anchors: { horizontal: "right", vertical: "bottom" } });
  const stretch = element("stretch", { x: 20, y: 20, width: 320, height: 410, anchors: { horizontal: "stretch", vertical: "stretch" } });
  const design = document([left, right, stretch]); design.styles = [advanced.textStyleFromElement(left, "Body")];
  design.pages[0].canvas.layout = { guides: [{ id: "guide", axis: "x", position: 24 }], margins: { enabled: true, top: 24, right: 24, bottom: 24, left: 24 }, grid: { enabled: true, size: 8, columns: 3, rows: 3, gutter: 8 } };
  design.components = [advanced.componentFromSelection(scene([left]), [left.id], "Label")];
  const resized = advanced.resizeDesignDocument(design, { width: 2160, height: 1920 }, "reflow"), actual = resized.pages[0].canvas.elements;
  const oldScale = 3, outputScale = 6, oldHeight = 450, newHeight = 320;
  close(actual[0].x * outputScale, left.x * oldScale); close(actual[0].y * outputScale, left.y * oldScale);
  close(actual[0].fontSize * outputScale, left.fontSize * oldScale); close(actual[0].width * outputScale, left.width * oldScale); close(actual[0].padding * outputScale, left.padding * oldScale);
  assert.match(actual[0].richText, /font-size:20px/);
  close((360 - actual[1].x - actual[1].width) * outputScale, (360 - right.x - right.width) * oldScale);
  close((newHeight - actual[1].y - actual[1].height) * outputScale, (oldHeight - right.y - right.height) * oldScale);
  close(actual[1].radius * outputScale, right.radius * oldScale); close(actual[1].strokeWidth * outputScale, right.strokeWidth * oldScale); close(actual[1].shadow.blur * outputScale, right.shadow.blur * oldScale);
  close(actual[2].x * outputScale, 60); close((360 - actual[2].x - actual[2].width) * outputScale, 60);
  close(actual[2].y * outputScale, 60); close((newHeight - actual[2].y - actual[2].height) * outputScale, 60);
  close(resized.styles[0].fontSize * outputScale, design.styles[0].fontSize * oldScale);
  close(resized.components[0].width * outputScale, design.components[0].width * oldScale);
  close(resized.pages[0].canvas.layout.guides[0].position * outputScale, 72);
  close(resized.pages[0].canvas.layout.margins.left * outputScale, 72);
  close(resized.pages[0].canvas.layout.grid.gutter * outputScale, 24);
  assert.equal(design.pages[0].canvas.elements[0].fontSize, 32); assert.ok(model.parseLibrary(library(resized)));
});

test("continuous resize centers the entire panorama and custom template application respects canonical dimensions", () => {
  const original = document([element("left", { x: 10 })]); original.pages.push(model.duplicatePage(original.pages[0]));
  const panorama = carousel.enableContinuousCarousel(original);
  const contained = advanced.resizeDocument(panorama, { width: 1080, height: 1080 }, "contain");
  close(contained.continuousCanvas.elements[0].x, 80); // (720 - 720*.8)/2 + 10*.8
  const reflowed = advanced.resizeDocument(panorama, { width: 2160, height: 1350 }, "reflow");
  close(reflowed.continuousCanvas.elements[0].width * 6, panorama.continuousCanvas.elements[0].width * 3);
  const source = document([element("square", { x: 80, y: 20, width: 100, height: 50 })]); source.customSize = { width: 1440, height: 1440 };
  const template = model.designAsTemplate(source, "Custom square"), target = document([]); target.customSize = { width: 2160, height: 1080 };
  const applied = advanced.applyTemplateToDesign(target, template, { pageId: target.pages[0].id, templatePageId: template.pages[0].id, mode: "replace" });
  assert.deepEqual(applied.customSize, target.customSize);
  close(applied.pages[0].canvas.elements[0].width, 50); close(applied.pages[0].canvas.elements[0].height, 25);
});

test("template application chooses any page, preserves matching slots and merges conflicting resources", () => {
  const existing = model.createCanvasElement("text", { text: "Existing content", slot: "headline" });
  const design = document([existing]);
  const source = document([model.createCanvasElement("text", { text: "Page one" })]);
  source.pages.push(model.duplicatePage(source.pages[0]));
  source.pages[1].canvas.elements[0].text = "Page two";
  source.pages[1].canvas.elements[0].slot = "headline";
  const template = model.designAsTemplate(source, "Two pages");
  template.parameters = [{ id: "headline", name: "Headline", type: "text", required: true }];
  const style = advanced.textStyleFromElement(existing, "Shared");
  design.styles = [style]; template.styles = [{ ...style, fontSize: style.fontSize + 10 }];
  template.pages[1].canvas.elements[0].textStyleId = style.id;
  const replaced = advanced.applyTemplateToDesign(design, template, { pageId: design.pages[0].id, templatePageId: template.pages[1].id, mode: "replace" });
  assert.equal(replaced.pages[0].id, design.pages[0].id);
  assert.equal(replaced.pages[0].canvas.elements[0].text, "Existing content");
  assert.equal(replaced.styles.length, 2);
  assert.notEqual(replaced.pages[0].canvas.elements[0].textStyleId, style.id);
  assert.ok(model.parseLibrary(library(replaced)));
  const all = advanced.applyTemplateToDesign(design, template, { pageId: design.pages[0].id, templatePageId: template.pages[1].id, mode: "append-all", values: { headline: "New content" } });
  assert.equal(all.pages.length, 3); assert.equal(all.pages[1].canvas.elements[0].text, "Page one"); assert.equal(all.pages[2].canvas.elements[0].text, "New content");
  const full = { ...design, pages: Array.from({ length: 20 }, () => model.duplicatePage(design.pages[0])) };
  assert.throws(() => advanced.applyTemplateToDesign(full, template, { pageId: full.pages[0].id, templatePageId: template.pages[0].id, mode: "append-page" }), /20 pages/);
});

test("continuous template pages apply without dangling group references or layer overflow", () => {
  const source = document([element("source", { groupId: "g", width: 400 })]);
  source.pages[0].canvas.groups = [{ id: "g", name: "Template group" }];
  source.pages.push(model.duplicatePage(source.pages[0]));
  const continuousTemplate = model.designAsTemplate(carousel.enableContinuousCarousel(source), "Panorama");
  const design = carousel.enableContinuousCarousel(document([element("existing")]));
  const applied = advanced.applyTemplateToDesign(design, continuousTemplate, { pageId: design.pages[0].id, templatePageId: continuousTemplate.pages[1].id, mode: "append-all" });
  assert.equal(applied.pages.length, 4); assert.ok(model.parseLibrary(library(applied)));
  const full = { ...design, continuousCanvas: scene(Array.from({ length: 100 }, (_, index) => element(`item${index}`, { x: -500, y: -500 }))) };
  assert.throws(() => advanced.applyTemplateToDesign(full, continuousTemplate, { pageId: full.pages[0].id, templatePageId: continuousTemplate.pages[1].id, mode: "replace" }), /100-element/);
});

test("nested isolation scopes every selection and structural command without changing siblings", () => {
  const original = { ...scene([element("a", { groupId: "inner" }), element("outside", { groupId: "outer", x: 200 }), element("b", { groupId: "inner", x: 80 })]), groups: [{ id: "outer", name: "Outer" }, { id: "inner", name: "Inner", parentId: "outer" }] };
  assert.deepEqual(commands.scopeSelection(original, ["a", "b", "outside"], "inner"), ["a", "b"]);
  assert.deepEqual(commands.expandGroupSelection(original, ["a", "outside"], "inner"), ["a"]);
  const deleted = commands.constrainSceneToIsolation(original, commands.removeSelection(original, ["a", "b", "outside"]).scene, "inner");
  assert.deepEqual(deleted.elements.map(item => item.id), ["outside"]);
  assert.equal(deleted.elements[0], original.elements[1]);
  assert.deepEqual(deleted.groups, original.groups);
  const grouped = commands.groupSelection(original, ["a", "b", "outside"], "New inner", "inner").scene;
  const newGroup = grouped.groups.find(group => group.name === "New inner");
  assert.equal(newGroup.parentId, "inner"); assert.equal(grouped.elements[1], original.elements[1]);
  assert.equal(grouped.groups.find(group => group.id === "outer").parentId, undefined);
  const ungrouped = commands.ungroupSelection(grouped, ["a", "outside"], "inner").scene;
  assert.ok(ungrouped.groups.some(group => group.id === "inner")); assert.ok(ungrouped.groups.some(group => group.id === "outer"));
  assert.equal(ungrouped.elements[0].groupId, "inner"); assert.equal(ungrouped.elements[1], original.elements[1]);
  assert.equal(commands.ungroupSelection(original, ["a"], "inner").scene, original);
  const copied = commands.copySelection(grouped, ["a", "outside"], "inner");
  assert.deepEqual(copied.map(item => item.id), ["a"]);
  assert.equal(copied.groups.length, 1); assert.equal(copied.groups[0].parentId, undefined);
  const added = commands.constrainSceneToIsolation(original, commands.duplicateSelection(original, ["a", "b", "outside"], undefined, "inner").scene, "inner");
  assert.equal(added.elements.length, 5); assert.equal(added.groups.length, original.groups.length);
  assert.deepEqual(commands.scopeSelection(added, added.elements.map(item => item.id), "inner").length, 4);
  assert.equal(added.elements.find(item => item.id === "outside"), original.elements[1]);
  const locked = commands.constrainSceneToIsolation(original, commands.setGroupLocked(original, "inner", true).scene, "inner");
  assert.equal(locked.groups.find(group => group.id === "inner").locked, true);
  assert.equal(commands.isElementLocked(locked, locked.elements[0]), true);
  assert.equal(commands.isElementLocked(locked, locked.elements[1]), false);
  assert.ok(model.parseCanvasScene(added));
});

test("applying a template bakes source masters locally and remaps component resource dependencies", () => {
  const label = model.createCanvasElement("text", { text: "Label", colorRoleId: "ink", slot: "headline" });
  const source = document([label]);
  source.styles = [advanced.textStyleFromElement(label, "Headline")];
  label.textStyleId = source.styles[0].id;
  source.colorRoles = [{ id: "ink", name: "Ink", color: "#ff0000" }];
  source.parameters = [{ id: "headline", name: "Headline", type: "text", defaultValue: "Template words" }];
  source.components = [advanced.componentFromSelection(source.pages[0].canvas, [label.id], "Label")];
  source.masterScene = scene([element("source-logo")]);
  const template = model.designAsTemplate(source, "Source");
  const target = document([]);
  target.masterScene = scene([element("target-logo")]);
  target.styles = [{ ...source.styles[0], fontSize: 80 }];
  target.colorRoles = [{ id: "ink", name: "Ink", color: "#0000ff" }];
  target.parameters = [{ id: "headline", name: "Headline", type: "text", defaultValue: "Target words" }];
  const applied = advanced.applyTemplateToDesign(target, template, { pageId: target.pages[0].id, templatePageId: template.pages[0].id, mode: "replace", preserveSlots: false });
  assert.deepEqual(applied.masterScene, target.masterScene);
  assert.equal(applied.pages[0].canvas.elements.filter(item => item.master).length, 0);
  assert.equal(applied.pages[0].canvas.elements.length, 2);
  const componentText = applied.components[0].scene.elements[0];
  assert.notEqual(componentText.textStyleId, source.styles[0].id); assert.notEqual(componentText.colorRoleId, "ink"); assert.notEqual(componentText.slot, "headline");
  assert.ok(applied.styles.some(style => style.id === componentText.textStyleId));
  assert.ok(applied.colorRoles.some(role => role.id === componentText.colorRoleId));
  assert.ok(model.parseLibrary(library(applied)));
});

test("continuous template replacement preserves slots from the chosen slide", () => {
  const source = document([model.createCanvasElement("text", { text: "First", slot: "headline", x: 40 })]);
  source.pages.push(model.duplicatePage(source.pages[0])); source.pages[1].canvas.elements[0].text = "Second";
  const target = carousel.enableContinuousCarousel(source);
  const templateSource = document([model.createCanvasElement("text", { text: "Default", slot: "headline" })]);
  templateSource.parameters = [{ id: "headline", name: "Headline", type: "text", defaultValue: "Default" }];
  const template = model.designAsTemplate(templateSource, "Slot");
  const applied = advanced.applyTemplateToDesign(target, template, { pageId: target.pages[1].id, templatePageId: template.pages[0].id, mode: "replace" });
  const text = applied.continuousCanvas.elements.filter(item => item.type === "text" && item.x >= 360);
  assert.equal(text.at(-1).text, "Second");
});

test("template masters retain page clipping through panorama offsets, slicing, copies and resizing", () => {
  const source = document([]);
  source.masterScene = scene([element("wide-master", { x: -60, y: -20, width: 480, height: 520 })]);
  const template = model.designAsTemplate(source, "Clipped master");
  const target = document([]); target.pages.push(model.duplicatePage(target.pages[0]));
  const panorama = carousel.enableContinuousCarousel(target);
  const applied = advanced.applyTemplateToDesign(panorama, template, { pageId: panorama.pages[1].id, templatePageId: template.pages[0].id, mode: "replace" });
  const layer = applied.continuousCanvas.elements.find(item => item.name === "wide-master");
  assert.deepEqual(layer.clipBounds, { x: 360, y: 0, width: 360, height: 450 });
  assert.equal(layer.master, undefined);
  const sliced = carousel.sliceSceneForPage(applied, applied.pages[1]);
  assert.deepEqual(sliced.elements.find(item => item.id === layer.id).clipBounds, { x: 0, y: 0, width: 360, height: 450 });
  const split = carousel.splitContinuousCarousel(applied);
  assert.equal(split.pages[0].canvas.elements.filter(item => item.name === "wide-master").length, 0);
  assert.deepEqual(split.pages[1].canvas.elements.find(item => item.name === "wide-master").clipBounds, { x: 0, y: 0, width: 360, height: 450 });
  const merged = carousel.enableContinuousCarousel(split);
  assert.deepEqual(merged.continuousCanvas.elements.find(item => item.name === "wide-master").clipBounds, layer.clipBounds);
  const resized = advanced.resizeDesignDocument(applied, { width: 2160, height: 1080 }, "reflow");
  assert.deepEqual(resized.continuousCanvas.elements.find(item => item.name === "wide-master").clipBounds, { x: 360, y: 0, width: 360, height: 180 });
  const square = document([]); square.customSize = { width: 1080, height: 1080 };
  const fitted = advanced.applyTemplateToDesign(square, template, { pageId: square.pages[0].id, templatePageId: template.pages[0].id, mode: "replace" });
  assert.deepEqual(fitted.pages[0].canvas.elements[0].clipBounds, { x: 36, y: 0, width: 288, height: 360 });
  assert.ok(model.parseLibrary(library(applied)));
  const invalid = structuredClone(applied); invalid.continuousCanvas.elements[0].clipBounds.width = -1;
  assert.equal(model.parseLibrary(library(invalid)), null);
  const clipboard = commands.copySelection(applied.continuousCanvas, [layer.id], undefined, { x: 360, y: 0 });
  const pasted = commands.pasteSelection(scene([]), clipboard, undefined, { x: 0, y: 0 }).scene.elements[0];
  close(pasted.x, layer.x - 360 + 12); assert.deepEqual(pasted.clipBounds, { x: 0, y: 0, width: 360, height: 450 });
  const duplicate = commands.duplicateSelection({ ...applied.continuousCanvas, elements: [{ ...layer, locked: false }] }, [layer.id]).scene.elements[1];
  close(duplicate.x, layer.x + 12); assert.deepEqual(duplicate.clipBounds, layer.clipBounds);
});

test("named versions restore linked resources and copied version components retain fresh identities", () => {
  const label = model.createCanvasElement("text", { text: "Old label" });
  let design = document([]);
  const component = advanced.componentFromSelection(scene([label]), [label.id], "Reusable label");
  design.components = [component];
  design.styles = [advanced.textStyleFromElement(label, "Old style")];
  design.colorRoles = [{ id: "ink", name: "Ink", color: "#112233" }];
  design.parameters = [{ id: "headline", name: "Headline", type: "text", defaultValue: "Old words" }];
  design.pages[0].canvas = advanced.insertComponent(design.pages[0].canvas, component).scene;
  design = advanced.saveDesignVersion(design, "Before changes");
  const versionId = design.versions[0].id;
  const altered = { ...design, components: [{ ...component, name: "Changed", scene: scene([{ ...label, text: "Changed label" }]) }], styles: [], colorRoles: [], parameters: [] };
  const restored = advanced.restoreDesignVersion(altered, versionId);
  assert.deepEqual(restored.components, design.components); assert.deepEqual(restored.styles, design.styles); assert.deepEqual(restored.colorRoles, design.colorRoles); assert.deepEqual(restored.parameters, design.parameters);
  assert.ok(model.parseLibrary(library(restored)));
  const copied = model.cloneDesign(design), copiedVersion = copied.versions[0];
  assert.notEqual(copiedVersion.components[0].scene.elements[0].id, component.scene.elements[0].id);
  assert.equal(copiedVersion.pages[0].canvas.elements[0].componentSourceId, copiedVersion.components[0].scene.elements[0].id);
  const restoredCopy = advanced.restoreDesignVersion(copied, versionId);
  const replacement = { ...restoredCopy.components[0], scene: scene([{ ...restoredCopy.components[0].scene.elements[0], text: "Updated again" }]) };
  assert.equal(advanced.updateComponentInstances(restoredCopy, replacement).pages[0].canvas.elements[0].text, "Updated again");
  const empty = advanced.saveDesignVersion(document([]), "Empty"); empty.styles = design.styles;
  assert.deepEqual(advanced.restoreDesignVersion(empty, empty.versions[0].id).styles, []);
  const legacy = structuredClone(design); for (const key of ["styles", "components", "colorRoles", "parameters"]) delete legacy.versions[0][key];
  assert.ok(model.parseLibrary(library(legacy))); assert.deepEqual(advanced.restoreDesignVersion(legacy, versionId).components, design.components);
});

test("every shape accepts a photo fill atomically while keeping frame geometry, outline and provenance", () => {
  const photo = model.createCanvasElement("image", { src: "https://example.com/photo.jpg", name: "Photograph", fit: "contain", cropX: 12, cropY: 90, cropScale: 3, flipX: true, intrinsicWidth: 2400, intrinsicHeight: 1600, directive: "Search note", rightsNote: "Licensed", sourceUrl: "https://example.com/credit", provenance: { source: "upload", imageId: "original-photo", description: "A landscape", cosmosManual: false } });
  for (const shape of ["rectangle", "ellipse", "triangle", "diamond", "polygon", "star", "arrow", "path"]) {
    const frame = element(`frame-${shape}`, { shape, ...(shape === "path" ? { path: "M0 0H100V100H0Z", viewBox: "0 0 100 100" } : {}), strokeAlign: "outside", strokeWidth: 4, rotation: 35, opacity: .7, anchors: { horizontal: "left", vertical: "top" }, shadow: { color: "#000", offsetX: 2, offsetY: 3, blur: 4, spread: 1 } });
    const input = scene([frame, photo]), filled = commands.fillShapeWithImage(input, frame.id, photo, photo.id);
    assert.equal(filled.scene.elements.length, 1); assert.deepEqual(filled.selectedIds, [frame.id]);
    const actual = filled.scene.elements[0], { imageFill, ...geometry } = actual;
    assert.deepEqual(geometry, frame); assert.equal(actual.id, frame.id);
    assert.equal(imageFill.objectFit, "cover"); assert.equal(imageFill.cropX, 50); assert.equal(imageFill.cropY, 50); assert.equal(imageFill.cropScale, 1);
    assert.equal(imageFill.flipX, true); assert.deepEqual(imageFill.provenance, photo.provenance); assert.equal(imageFill.sourceUrl, photo.sourceUrl); assert.equal(imageFill.rightsNote, photo.rightsNote);
    assert.ok(model.parseCanvasScene(filled.scene)); assert.equal(input.elements.length, 2);
    const preserved = commands.fillShapeWithImage(input, frame.id, photo, { preserveCrop: true }).scene.elements[0].imageFill;
    assert.equal(preserved.objectFit, "contain"); assert.equal(preserved.cropX, 12); assert.equal(preserved.cropScale, 3);
  }
});

test("frame filling refuses inherited hidden/locked/protected content and never consumes protected sources", () => {
  const frame = element("frame"), photo = model.createCanvasElement("image", { src: "/template-editor/folds.svg" });
  const blocked = [
    { ...frame, locked: true }, { ...frame, hidden: true }, { ...frame, protected: ["content"] },
    { ...frame, groupId: "locked-group" }, { ...frame, groupId: "hidden-group" },
  ];
  for (const target of blocked) {
    const input = { ...scene([target, photo]), groups: [{ id: "locked-group", name: "Locked", locked: true }, { id: "hidden-group", name: "Hidden", hidden: true }] };
    assert.equal(commands.fillShapeWithImage(input, frame.id, photo, photo.id).scene, input);
  }
  for (const patch of [{ locked: true }, { hidden: true }, { protected: ["content"] }, { protected: ["delete"] }, { groupId: "hidden-group" }]) {
    const source = { ...photo, ...patch }, input = { ...scene([frame, source]), groups: [{ id: "hidden-group", name: "Hidden", hidden: true }] };
    assert.equal(commands.fillShapeWithImage(input, frame.id, source, source.id).scene, input);
  }
  const input = scene([frame, photo]);
  assert.throws(() => commands.fillShapeWithImage(input, frame.id, { src: "javascript:alert(1)", objectFit: "cover", cropX: 50, cropY: 50 }), /valid photo/);
  assert.equal(input.elements.length, 2);
});

test("photo frames and outline alignment persist in copies, history, templates and continuous conversion", () => {
  const fill = { src: "/template-editor/folds.svg", objectFit: "cover", cropX: 25, cropY: 60, cropScale: 2, intrinsicWidth: 1000, intrinsicHeight: 800 };
  const frame = element("photo-frame", { imageFill: fill, strokeAlign: "inside", strokeWidth: 8 });
  let design = document([frame]); design.pages.push(model.duplicatePage(design.pages[0])); design = advanced.saveDesignVersion(design, "Framed");
  const panorama = carousel.enableContinuousCarousel(design), split = carousel.splitContinuousCarousel(panorama);
  assert.deepEqual(split.pages[0].canvas.elements[0].imageFill, fill); assert.equal(split.pages[0].canvas.elements[0].strokeAlign, "inside");
  const copy = model.cloneDesign(design); assert.deepEqual(copy.versions[0].pages[0].canvas.elements[0].imageFill, fill);
  const template = model.designAsTemplate(design, "Frames"), rebuilt = model.createDesign(template);
  assert.deepEqual(rebuilt.pages[0].canvas.elements[0].imageFill, fill); assert.ok(model.parseLibrary(library(copy)));
  const appearance = commands.copyAppearance(frame), protectedFrame = element("protected-frame", { protected: ["content"] });
  const applied = commands.pasteAppearance(scene([protectedFrame]), [protectedFrame.id], appearance).scene.elements[0];
  assert.equal(applied.imageFill, undefined); assert.equal(applied.strokeAlign, "inside"); assert.equal(applied.strokeWidth, 8);
  const duplicates = commands.duplicateSelection(scene([frame]), [frame.id]).scene;
  duplicates.elements[1].imageFill.cropX = 99; assert.equal(frame.imageFill.cropX, 25);
});

test("photo and outline validation rejects unsafe assets, invalid crop, metadata and alignment", () => {
  const fill = { src: "https://example.com/photo.jpg", objectFit: "cover", cropX: 50, cropY: 50 };
  for (const patch of [{ src: "javascript:alert(1)" }, { src: "data:image/svg+xml;base64,PHN2Zz4=" }, { src: "https://user:pass@example.com/p.jpg" }, { cropX: -1 }, { cropY: 101 }, { cropScale: 21 }, { intrinsicHeight: Infinity }, { objectFit: "stretch" }, { sourceUrl: "javascript:alert(1)" }, { provenance: { cosmosManual: "yes" } }]) {
    assert.equal(model.parseCanvasScene(scene([element("frame", { imageFill: { ...fill, ...patch } })])), null);
  }
  assert.equal(model.parseCanvasScene(scene([element("frame", { strokeAlign: "diagonal" })])), null);
  assert.equal(model.parseShapeImageFill(fill).src, fill.src);
});

test("word and whole-title textures keep safe resource references and receive fresh IDs in copies", () => {
  const fill = { src: "https://example.com/texture.jpg", objectFit: "cover", cropX: 50, cropY: 50, cropScale: 1 };
  const text = model.createCanvasElement("text", { text: "Blue sky", richText: '<b><span data-texture-id="word-blue" style="color:#abc">Blue</span></b> <u>sky</u>', wordTextures: [{ ...fill, id: "word-blue" }] });
  const design = document([text]);
  assert.ok(model.parseLibrary(library(design)));
  const copied = model.cloneDesign(design).pages[0].canvas.elements[0];
  assert.notEqual(copied.wordTextures[0].id, text.wordTextures[0].id); assert.ok(copied.richText.includes(copied.wordTextures[0].id));
  const duplicated = commands.duplicateSelection(scene([text]), [text.id]).scene.elements[1];
  assert.notEqual(duplicated.wordTextures[0].id, text.wordTextures[0].id); assert.ok(duplicated.richText.includes(duplicated.wordTextures[0].id));
  const whole = commands.applyTextTexture(scene([text]), [text.id], fill).scene.elements[0];
  assert.equal(whole.wordTextures, undefined); assert.deepEqual(whole.textureFill, fill);
  assert.equal(whole.richText, '<b><span style="color:#abc">Blue</span></b> <u>sky</u>');
  const clear = commands.applyTextTexture(scene([whole]), [text.id], null).scene.elements[0];
  assert.equal(clear.textureFill, undefined); assert.equal(clear.richText, whole.richText);
  const protectedText = { ...text, protected: ["style"] }, protectedScene = scene([protectedText]);
  assert.equal(commands.applyTextTexture(protectedScene, [text.id], fill).scene, protectedScene);
  assert.equal(model.sanitizeRichText("<span data-texture-id='word-blue'>Blue</span>"), '<span data-texture-id="word-blue">Blue</span>');
  assert.equal(model.sanitizeRichText('<span data-texture-id="bad/id">Blue</span>'), undefined);
  const dangling = structuredClone(design); dangling.pages[0].canvas.elements[0].wordTextures = [];
  assert.equal(model.parseLibrary(library(dangling)), null);
  const unsafe = structuredClone(design); unsafe.pages[0].canvas.elements[0].wordTextures[0].src = "javascript:alert(1)";
  assert.equal(model.parseLibrary(library(unsafe)), null);
});

test("image template parameters fill photo frames and text textures while preserving words and outlines", () => {
  const frame = element("frame", { slot: "photo", strokeAlign: "outside", strokeWidth: 5 }), title = model.createCanvasElement("text", { text: "Preserve these words", slot: "photo" });
  const source = document([frame, title]); source.parameters = [{ id: "photo", name: "Photo", type: "image", required: true }];
  const template = model.designAsTemplate(source, "Photo template"), generated = advanced.instantiateTemplate(template, { photo: "https://example.com/photo.jpg" });
  assert.equal(generated.pages[0].canvas.elements[0].imageFill.src, "https://example.com/photo.jpg");
  assert.equal(generated.pages[0].canvas.elements[0].strokeAlign, "outside"); assert.equal(generated.pages[0].canvas.elements[0].strokeWidth, 5);
  assert.equal(generated.pages[0].canvas.elements[1].textureFill.src, "https://example.com/photo.jpg"); assert.equal(generated.pages[0].canvas.elements[1].text, "Preserve these words");
  assert.ok(model.parseLibrary(library(generated)));
});

test("linked components update word textures through remapped IDs while retaining manual photo overrides", () => {
  const texture = { id: "word-texture", src: "https://example.com/original.jpg", objectFit: "cover", cropX: 50, cropY: 50 };
  const title = model.createCanvasElement("text", { text: "Photo", richText: '<span data-texture-id="word-texture">Photo</span>', wordTextures: [texture] });
  const component = advanced.componentFromSelection(scene([title]), [title.id], "Photo title");
  let design = document([]); design.components = [component]; design.pages[0].canvas = advanced.insertComponent(design.pages[0].canvas, component).scene;
  const modified = structuredClone(component); modified.scene.elements[0].wordTextures[0].src = "https://example.com/updated.jpg";
  design = advanced.updateComponentInstances(design, modified);
  assert.equal(design.pages[0].canvas.elements[0].wordTextures[0].src, "https://example.com/updated.jpg");
  design.pages[0].canvas.elements[0].wordTextures[0].src = "https://example.com/manual.jpg";
  const next = structuredClone(modified); next.scene.elements[0].wordTextures[0].src = "https://example.com/latest.jpg";
  const updated = advanced.updateComponentInstances(design, next);
  assert.equal(updated.pages[0].canvas.elements[0].wordTextures[0].src, "https://example.com/manual.jpg");
  assert.ok(model.parseLibrary(library(updated)));
  const frame = element("component-frame", { imageFill: { src: "https://example.com/original.jpg", objectFit: "cover", cropX: 50, cropY: 50 } });
  const photoComponent = advanced.componentFromSelection(scene([frame]), [frame.id], "Photo frame");
  const framed = document([]); framed.components = [photoComponent]; framed.pages[0].canvas = advanced.insertComponent(framed.pages[0].canvas, photoComponent).scene;
  framed.pages[0].canvas.elements[0].imageFill.src = "https://example.com/manual.jpg";
  const revised = structuredClone(photoComponent); revised.scene.elements[0].width += 20;
  assert.equal(advanced.updateComponentInstances(framed, revised).pages[0].canvas.elements[0].imageFill.src, "https://example.com/manual.jpg");
});

test("private review links round trip on designs and are omitted from duplicates and templates", () => {
  const design = document([element("one")]); design.reviewLinks = [{ id: "link", url: "/review/opaque-token", expiresAt: new Date(Date.now() + 10000).toISOString() }];
  assert.deepEqual(model.parseLibrary(library(design)).designs[0].reviewLinks, design.reviewLinks);
  assert.equal(model.cloneDesign(design).reviewLinks, undefined); assert.equal(model.designAsTemplate(design, "Template").reviewLinks, undefined);
  for (const url of ["javascript:alert(1)", "//external.test/review", "https://user:secret@example.com/review", "/review/\\evil"]) {
    const unsafe = structuredClone(design); unsafe.reviewLinks[0].url = url; assert.equal(model.parseLibrary(library(unsafe)), null);
  }
});

test("whole-document and template copies regenerate master and component scene identities with logical bindings remapped", () => {
  const component = advanced.componentFromSelection(scene([element("part")]), ["part"], "Component");
  const design = document([]); design.components = [component];
  const inserted = advanced.insertComponent(design.pages[0].canvas, component);
  design.pages[0].canvas = inserted.scene;
  design.masterScene = { ...inserted.scene, elements: inserted.scene.elements.map(item => ({ ...item, master: true })) };
  design.comments = [{ id: "comment", elementId: design.masterScene.elements[0].id, text: "Master note", createdAt: new Date().toISOString() }];
  const versioned = advanced.saveDesignVersion(design, "Original");
  const duplicated = model.cloneDesign(versioned), template = model.designAsTemplate(versioned, "Template"), fromTemplate = model.createDesign(template), editing = model.editTemplateDesign(template);
  for (const copy of [duplicated, template, fromTemplate, editing]) {
    assert.notEqual(copy.masterScene.elements[0].id, design.masterScene.elements[0].id);
    assert.notEqual(copy.components[0].scene.elements[0].id, component.scene.elements[0].id);
    assert.equal(copy.pages[0].canvas.elements[0].componentId, component.id);
    assert.equal(copy.pages[0].canvas.elements[0].componentSourceId, copy.components[0].scene.elements[0].id);
    assert.equal(copy.masterScene.elements[0].componentSourceId, copy.components[0].scene.elements[0].id);
  }
  assert.equal(duplicated.comments[0].elementId, duplicated.masterScene.elements[0].id);
  assert.notEqual(duplicated.versions[0].masterScene.elements[0].id, versioned.versions[0].masterScene.elements[0].id);
  assert.ok(model.parseLibrary(library(duplicated)));
});
