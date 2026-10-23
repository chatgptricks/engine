import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (cache.has(file)) return cache.get(file).exports;
  const unit = {exports: {}}; cache.set(file, unit);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {filename: file})(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name), unit, unit.exports);
  return unit.exports;
}
const model = load("lib/template-editor/model.ts"), smart = load("lib/template-editor/smart-text.ts"), template = load("lib/template-editor/smart-template.ts"), commands = load("lib/template-editor/commands.ts");
const text = (patch = {}) => ({...model.createCanvasElement("text", {text: "A smarter way to build your next creative project", width: 300, height: 100, fontSize: 24, lineHeight: 1.1, letterSpacing: 0}), smartText: {role: "cover", lines: 3, minFontSize: 12, maxFontSize: 48, maxHeight: 110}, ...patch});
const metrics = (element, words = smart.smartWords(element)) => ({size: 20, widths: words.map(word => word.text.length * 10), space: 5});
const fit = element => smart.fitSmartText(element, metrics(element));

test("2, 3 and 4 lines change font size and preserve every word without single-word title lines", () => {
  const sizes = [];
  for (const count of [2, 3, 4]) {
    const element = text(); element.smartText.lines = count;
    const layout = fit(element);
    assert.equal(layout.lines.length, count);
    assert.equal(layout.overflow, false);
    assert.equal(layout.lines.map(line => line.text).join(" "), element.text);
    assert.ok(layout.lines.every(line => line.text.split(" ").length >= 2));
    assert.ok(layout.lines.every(line => line.width <= element.width));
    assert.ok(layout.height <= element.smartText.maxHeight + .01);
    sizes.push(layout.fontSize);
  }
  assert.ok(new Set(sizes).size > 1);
});

test("short titles explain an impossible target instead of inventing copy", () => {
  const layout = fit(text({text: "Hello world"}));
  assert.equal(layout.lines.length, 1);
  assert.match(layout.warning, /Add more words/);
  assert.equal(layout.lines[0].text, "Hello world");
});

test("long copy stops at the readable minimum and reports overflow without losing content", () => {
  const element = text({text: "Long content ".repeat(80).trim(), width: 180});
  const layout = fit(element);
  assert.equal(layout.fontSize, element.smartText.minFontSize);
  assert.equal(layout.overflow, true);
  assert.match(layout.warning, /shortening/);
  assert.equal(layout.lines.map(line => line.text).join(" "), element.text);
});

test("rich word fragments retain nested emphasis, colors, entities and texture references", () => {
  const element = text({text: "First green & gold last", richText: '<b>First <span style="color:#01d592" data-texture-id="texture-one">green &amp; gold</span> last</b>'});
  const words = smart.smartWords(element);
  assert.deepEqual(words.map(word => word.text), ["First", "green", "&", "gold", "last"]);
  for (const word of words) assert.equal(model.sanitizeRichText(word.html), word.html);
  assert.match(words[1].html, /data-texture-id="texture-one"/);
  assert.match(words[3].html, /color:#01d592/);
  assert.match(words[4].html, /^<b>last<\/b>$/);
});

test("Auto body fit keeps paragraph boundaries", () => {
  const element = text({text: "First paragraph here\nSecond paragraph here", smartText: {role: "body", lines: 0, minFontSize: 12, maxFontSize: 24, maxHeight: 150}});
  const layout = fit(element);
  assert.ok(layout.lines.some(line => line.text === "First paragraph here"));
  assert.ok(layout.lines.some(line => line.text === "Second paragraph here"));
});

test("flow moves and resizes media after a changing headline while retaining its bottom edge", () => {
  const heading = text({slot: "headline", y: 20});
  const media = model.createCanvasElement("shape", {y: 140, width: 300, height: 260, smartFlow: {after: "headline", gap: 12, bottom: 400, resize: true}, templateRole: "media"});
  const scene = {background: "#111111", elements: [media, heading]};
  const fitted = smart.layoutSmartScene(scene, metrics).scene;
  const frame = fitted.elements[0], title = fitted.elements[1];
  assert.equal(frame.y, title.y + title.height + 12);
  assert.equal(frame.y + frame.height, 400);
  assert.equal(smart.layoutSmartScene(fitted, metrics).scene, fitted);
});

test("new ChatGPTricks copies merge imported title runs; source and unrelated templates remain intact", () => {
  const source = model.designAsTemplate(model.createBlankDesign("@chatgptricks", "portrait"), "@chatgptricks");
  source.name = "@chatgptricks"; source.customSize = {width: 1080, height: 1440};
  const first = {...text({text: "A creative", y: 300, height: 26, groupId: "title-group"}), smartText: undefined};
  const second = {...text({text: "new idea", y: 326, height: 26, groupId: "title-group"}), smartText: undefined};
  const logo = model.createCanvasElement("image", {name: "Logo"});
  source.pages[0].canvas = {background: "#111111", groups: [{id: "title-group", name: "Title"}], elements: [first, second, logo]};
  const before = JSON.stringify(source), design = model.createDesign(source);
  assert.equal(JSON.stringify(source), before);
  const headings = design.pages[0].canvas.elements.filter(element => element.type === "text");
  assert.equal(headings.length, 1);
  assert.equal(headings[0].text, "A creative new idea");
  assert.equal(headings[0].align, "center");
  assert.equal(headings[0].smartText.lines, 3);
  assert.equal(commands.canEditElement(design.pages[0].canvas, headings[0], "content"), true);
  assert.equal(commands.canEditElement(design.pages[0].canvas, headings[0], "style"), false);
  const library = {...model.EMPTY_LIBRARY, designs: [design]};
  assert.deepEqual(model.parseLibrary(library).designs[0].pages[0].canvas.elements[0].smartText, headings[0].smartText);
  const other = {...source, name: "Other"}; assert.equal(template.prepareSmartTemplate(other), other);
  assert.deepEqual(template.prepareSmartTemplate(template.prepareSmartTemplate(source)), template.prepareSmartTemplate(source));
});

test("template constraints retain branding, accept text and line counts, and keep new elements editable", () => {
  const title = text(), logo = model.createCanvasElement("image", {templateRole: "brand", name: "Logo"});
  const previous = {background: "#111111", elements: [title, logo]};
  const added = model.createCanvasElement("shape");
  const changed = {...previous, background: "#ffffff", elements: [{...title, text: "Changed words", font: "geist", x: 999, smartText: {...title.smartText, lines: 4}}, added]};
  const next = template.constrainSmartTemplate(previous, changed);
  assert.equal(next.background, previous.background);
  assert.equal(next.elements[0].text, "Changed words");
  assert.equal(next.elements[0].smartText.lines, 4);
  assert.equal(next.elements[0].x, title.x);
  assert.ok(next.elements.includes(logo));
  assert.equal(commands.canEditElement(next, added, "position"), true);
  assert.equal(commands.removeSelection(previous, [title.id, logo.id]).scene, previous);
  const copied = commands.duplicateSelection(previous, [title.id]);
  const copy = copied.scene.elements.at(-1);
  assert.equal(copy.smartText, undefined);
  assert.equal(commands.canEditElement(copied.scene, copy, "position"), true);
});

test("invalid persisted smart rules are rejected and cyclic flow stays bounded", () => {
  const element = text();
  for (const patch of [{lines: 8}, {lines: "3"}, {minFontSize: -1}, {maxFontSize: 0}, {maxHeight: Infinity}, {role: "unknown"}]) assert.equal(model.parseCanvas({background: "#111111", elements: [{...element, smartText: {...element.smartText, ...patch}}]}), null);
  const a = text({slot: "a", smartFlow: {after: "b", gap: 4, bottom: 450}}), b = text({slot: "b", smartFlow: {after: "a", gap: 4, bottom: 450}});
  assert.equal(smart.layoutSmartScene({background: "#111111", elements: [a, b]}, metrics).scene.elements.length, 2);
});


test("public reviews retain smart layout without exposing private slot names", () => {
  const reviews = load("lib/template-editor/review-snapshot.ts");
  const design = model.createBlankDesign("Review", "portrait"), heading = text({slot:"private-headline"});
  const frame = model.createCanvasElement("shape", {smartFlow:{after:"private-headline",gap:8,bottom:400,resize:true}});
  design.pages[0].canvas.elements = [heading,frame];
  const snapshot = reviews.prepareReviewSnapshot(design), elements = snapshot.pages[0].canvas.elements;
  assert.equal(elements[0].slot,undefined);
  assert.deepEqual(elements[0].smartText,heading.smartText);
  assert.equal(elements[1].smartFlow.after,heading.id);
  assert.equal(JSON.stringify(snapshot).includes("private-headline"),false);
  assert.equal(smart.layoutSmartScene(snapshot.pages[0].canvas,metrics).scene.elements[1].y,smart.layoutSmartScene(design.pages[0].canvas,metrics).scene.elements[1].y);
});

test("blank paragraph lines remain visible in automatic body layout", () => {
  const element = text({text:"First paragraph\n\nSecond paragraph",smartText:{role:"body",lines:0,minFontSize:12,maxFontSize:24,maxHeight:150}});
  const layout=fit(element);
  assert.deepEqual(layout.lines.map(line=>line.text),["First paragraph","","Second paragraph"]);
});
