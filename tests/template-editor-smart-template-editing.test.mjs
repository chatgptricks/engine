import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (cache.has(file)) return cache.get(file).exports;
  const unit = { exports: {} }; cache.set(file, unit);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name), unit, unit.exports);
  return unit.exports;
}
const model = load("lib/template-editor/model.ts");
const editing = load("lib/template-editor/smart-template-editing.ts");
const text = patch => ({ ...model.createCanvasElement("text", { text: "Useful words for a creative title", x: 20, y: 340, width: 320, height: 33, font: "bebascanva", fontSize: 39, lineHeight: .85, ...patch }), ...patch });
const image = patch => ({ ...model.createCanvasElement("image", patch), ...patch });

// The geometry reproduces the active library's imported cover and the edited
// Text + Media heading, whose first fragment was widened over its next run.
function legacyFixture() {
  const design = model.createBlankDesign("@chatgptricks", "portrait");
  design.customSize = { width: 1080, height: 1440 };
  design.templateId = "source-template";
  const cover = design.pages[0]; cover.label = "Cover";
  cover.canvas = { background: "#111111", groups: [{ id: "cover-title", name: "Title" }], elements: [
    text({ id: "cover-first", text: "A creative way", groupId: "cover-title", color: "#ffffff" }),
    text({ id: "cover-second", text: "to build your", y: 373, groupId: "cover-title", color: "#01d592" }),
    text({ id: "cover-third", text: "next great project", y: 406, groupId: "cover-title", color: "#ffffff" }),
    image({ id: "cover-logo", name: "Logo", src: "https://example.com/logo.png", x: 20, y: 15 }),
  ] };
  const slide = structuredClone(cover); slide.id = "interior-page"; slide.label = "Text + Media";
  slide.image.id = "interior-image";
  slide.canvas = { background: "#111111", groups: [{ id: "slide-title", name: "Title" }], elements: [
    text({ id: "slide-first", name: "Your", text: "Your  Title", x: 17.11, y: 61.43, width: 120.18, height: 25, font: "sfpro", fontSize: 17.904657081479534, lineHeight: 1.3962840227873552, align: "left", groupId: "slide-title", richText: '<span>Your  </span><span style="color:#01d592">Title</span>' }),
    text({ id: "slide-second", name: "text", text: " text", x: 93.03472222222223, y: 61.42939814814816, width: 35.64999954788774, height: 25, font: "sfpro", fontSize: 17.904657081479534, lineHeight: 1.3962840227873552, align: "left", groupId: "slide-title" }),
    image({ id: "slide-photo", name: "Photo", src: "https://example.com/photo.png", x: 18, y: 160, width: 324, height: 270, cropX: 37, cropY: 62 }),
  ] };
  design.pages.push(slide);
  const template = model.designAsTemplate(design, "@chatgptricks"); template.id = design.templateId;
  return { design, template };
}

test("smart controls recognize renamed source-linked projects and reused template drafts", () => {
  const { design, template } = legacyFixture();
  assert.equal(editing.supportsSmartTemplate(design), true);
  const renamed = { ...design, name: "My edited carousel" };
  assert.equal(editing.supportsSmartTemplate(renamed), false);
  assert.equal(editing.supportsSmartTemplate(renamed, [template]), true);
  assert.equal(editing.supportsSmartTemplate({ ...renamed, templateId: "other", purpose: "template", editingTemplateId: template.id }, [template]), true);
  assert.equal(editing.supportsSmartTemplate({ ...renamed, continuousCanvas: design.pages[0].canvas }, [template]), false);
  const smart = editing.updateSmartTemplateText(design, design.pages[0].id, "cover-first", { lines: 2 });
  assert.equal(editing.supportsSmartTemplate({ ...smart, name: "Renamed", templateId: "removed-template" }), true);
});

test("preview merges grouped cover text without mutating saved artwork or losing source identity", () => {
  const { design } = legacyFixture(), before = JSON.stringify(design), page = design.pages[0];
  const scene = editing.smartTemplatePage(design, page.id);
  const titles = scene.elements.filter(element => element.type === "text" && element.smartText);
  assert.equal(titles.length, 1);
  assert.equal(titles[0].id, "cover-first");
  assert.equal(titles[0].text, "A creative way to build your next great project");
  assert.match(titles[0].richText, /color:#01d592/);
  assert.equal(titles[0].align, "center");
  assert.equal(scene.elements.find(element => element.id === "cover-logo").src, page.canvas.elements.at(-1).src);
  assert.equal(JSON.stringify(design), before);
  assert.equal(page.canvas.elements.filter(element => element.type === "text").length, 3);
});

test("existing overlapping imported fragments become one left-aligned interior title", () => {
  const { design } = legacyFixture(), page = design.pages[1], before = JSON.stringify(design);
  const scene = editing.smartTemplatePage(design, page.id);
  const titles = scene.elements.filter(element => element.type === "text" && element.smartText);
  assert.equal(titles.length, 1);
  assert.equal(titles[0].id, "slide-first");
  assert.equal(titles[0].text, "Your  Title text");
  assert.equal(titles[0].smartText.role, "heading");
  assert.equal(titles[0].align, "left");
  assert.match(titles[0].richText, /color:#01d592/);
  assert.equal(JSON.stringify(design), before);
});

test("line choices migrate only the edited page and round-trip through persistence", () => {
  for (const lines of [2, 3, 4]) {
    const { design } = legacyFixture(), page = design.pages[0], untouched = design.pages[1], before = JSON.stringify(design);
    const preview = editing.smartTemplatePage(design, page.id);
    const next = editing.updateSmartTemplateText(design, page.id, "cover-first", { lines });
    assert.notEqual(next, design);
    assert.equal(next.id, design.id);
    assert.equal(next.pages[0].id, page.id);
    assert.equal(next.pages[1], untouched);
    const title = next.pages[0].canvas.elements.find(element => element.id === "cover-first");
    assert.equal(title.smartText.lines, lines);
    assert.equal(title.richText, preview.elements.find(element => element.id === "cover-first").richText);
    assert.deepEqual(next.pages[0].canvas.elements.find(element => element.id === "cover-logo"), preview.elements.find(element => element.id === "cover-logo"));
    const parsed = model.parseLibrary({ ...model.EMPTY_LIBRARY, designs: [JSON.parse(JSON.stringify(next))] });
    assert.ok(parsed);
    assert.equal(parsed.designs[0].pages[0].canvas.elements.find(element => element.id === "cover-first").smartText.lines, lines);
    assert.equal(JSON.stringify(design), before);
  }
});

test("line-only and unchanged-text edits preserve rich emphasis and word textures", () => {
  const { design } = legacyFixture(), id = design.pages[0].id;
  const smart = editing.updateSmartTemplateText(design, id, "cover-first", { lines: 2 });
  const title = smart.pages[0].canvas.elements.find(element => element.id === "cover-first");
  title.wordTextures = [{ id: "texture-a", src: "https://example.com/texture.png", objectFit: "cover", cropX: 50, cropY: 50 }];
  const changed = editing.updateSmartTemplateText(smart, id, "cover-first", { lines: 4, text: title.text });
  const result = changed.pages[0].canvas.elements.find(element => element.id === "cover-first");
  assert.equal(result.richText, title.richText);
  assert.equal(result.wordTextures, title.wordTextures);
  const rewritten = editing.updateSmartTemplateText(changed, id, "cover-first", { text: "My new wording" });
  const rewrittenTitle = rewritten.pages[0].canvas.elements.find(element => element.id === "cover-first");
  assert.equal(rewrittenTitle.text, "My new wording");
  assert.equal(rewrittenTitle.richText, undefined);
  assert.equal(rewrittenTitle.wordTextures, undefined);
  assert.equal(editing.updateSmartTemplateText(rewritten, id, "cover-first", { text: "My new wording" }), rewritten);
});

test("invalid, unrelated, missing, hidden, and locked targets do not migrate a document", () => {
  const { design } = legacyFixture(), id = design.pages[0].id;
  for (const [pageId, elementId, patch] of [[id, "missing", { lines: 2 }], ["missing", "cover-first", { lines: 2 }], [id, "cover-logo", { lines: 2 }], [id, "cover-first", {}], [id, "cover-first", { lines: 5 }]]) assert.equal(editing.updateSmartTemplateText(design, pageId, elementId, patch), design);
  const unrelated = { ...design, name: "Unrelated" };
  assert.equal(editing.smartTemplatePage(unrelated, id), null);
  assert.equal(editing.updateSmartTemplateText(unrelated, id, "cover-first", { lines: 2 }), unrelated);
  for (const protection of ["locked", "hidden", "group-locked", "content-protected"]) {
    const copy = structuredClone(design), target = copy.pages[0].canvas.elements[0];
    if (protection === "group-locked") copy.pages[0].canvas.groups[0].locked = true;
    else if (protection === "content-protected") target.protected = ["content"];
    else target[protection] = true;
    assert.equal(editing.updateSmartTemplateText(copy, id, target.id, { lines: 2 }), copy);
  }
});

test("spatial run merging handles changed grouping but preserves separate blocks and per-run styling", () => {
  const first = text({ id: "first", text: "First", x: 20, y: 50, width: 70, height: 25, groupId: undefined, color: "#ffffff", underline: true });
  const second = text({ id: "second", text: "second", x: 90, y: 50.001, width: 80, height: 25, groupId: "another", color: "#01d592", italic: true });
  const separate = text({ id: "separate", text: "Separate block", x: 220, y: 50, width: 110, height: 25, groupId: "another" });
  const below = text({ id: "below", text: "Separate paragraph", x: 20, y: 160, width: 110, height: 25, groupId: "another" });
  const scene = { background: "#111111", elements: [second, separate, below, first], groups: [{ id: "another", name: "Runs" }] }, before = JSON.stringify(scene);
  const merged = model.mergeTemplateText(scene);
  assert.equal(merged.elements.length, 3);
  const title = merged.elements.find(element => element.id === "first");
  assert.equal(title.text, "First second");
  assert.match(title.richText, /text-decoration:underline/);
  assert.match(title.richText, /font-style:italic/);
  assert.match(title.richText, /color:#01d592/);
  assert.equal(merged.elements.find(element => element.id === "separate"), separate);
  assert.equal(merged.elements.find(element => element.id === "below"), below);
  assert.equal(JSON.stringify(scene), before);
});

test("contextual selection maps any consumed title fragment to only that smart title", () => {
  const { design } = legacyFixture(), cover = design.pages[0].id;
  for (const fragment of ["cover-first", "cover-second", "cover-third"]) assert.deepEqual(editing.smartTemplateTextIds(design, cover, [fragment]), ["cover-first"]);
  assert.deepEqual(editing.smartTemplateTextIds(design, cover, ["cover-third", "cover-second", "cover-logo"]), ["cover-first"]);
  assert.deepEqual(editing.smartTemplateTextIds(design, cover, ["cover-logo"]), []);
  assert.deepEqual(editing.smartTemplateTextIds(design, cover, []), []);
  assert.deepEqual(editing.smartTemplateTextIds(design, cover, ["missing"]), []);
  assert.deepEqual(editing.smartTemplateTextIds(design, "interior-page", ["slide-second"]), ["slide-first"]);
  assert.deepEqual(editing.smartTemplateTextIds(design, "interior-page", ["cover-second"]), []);
});

test("new editable text receives fit controls but only the chosen new text is adopted", () => {
  const { design } = legacyFixture(), pageId = design.pages[0].id;
  const smart = editing.updateSmartTemplateText(design, pageId, "cover-first", { lines: 2 });
  const first = text({ id: "added-first", text: "A newly added title can fit automatically", x: 45, y: 70, fontSize: 22, height: 90, color: "#01d592", align: "right" });
  const second = text({ id: "added-second", text: "Another independent text", x: 45, y: 200, fontSize: 19, height: 60 });
  const locked = text({ id: "added-locked", text: "Locked", groupId: "locked-group" });
  smart.pages[0].canvas.groups.push({ id: "locked-group", name: "Locked", locked: true });
  smart.pages[0].canvas.elements.push(first, second, locked);
  const before = JSON.stringify(smart), preview = editing.smartTemplatePage(smart, pageId);
  assert.deepEqual(editing.smartTemplateTextIds(smart, pageId, [first.id]), [first.id]);
  assert.deepEqual(editing.smartTemplateTextIds(smart, pageId, [locked.id]), []);
  const previewFirst = preview.elements.find(element => element.id === first.id);
  assert.ok(previewFirst.smartText);
  for (const property of ["font", "fontSize", "color", "align", "x", "y", "width", "height"]) assert.equal(previewFirst[property], first[property]);
  const next = editing.updateSmartTemplateText(smart, pageId, first.id, { lines: 3 });
  assert.equal(next.pages[0].canvas.elements.find(element => element.id === first.id).smartText.lines, 3);
  assert.equal(next.pages[0].canvas.elements.find(element => element.id === second.id), second);
  assert.equal(next.pages[0].canvas.elements.find(element => element.id === second.id).smartText, undefined);
  assert.equal(next.pages[0].canvas.elements.find(element => element.id === locked.id), locked);
  assert.equal(next.pages[0].canvas.elements.find(element => element.id === "cover-first"), smart.pages[0].canvas.elements.find(element => element.id === "cover-first"));
  assert.equal(next.pages[1], smart.pages[1]);
  assert.equal(JSON.stringify(smart), before);
});
