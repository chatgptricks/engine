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
  const other = {...source, name: "Other"}, otherBefore = JSON.stringify(other), prepared = template.prepareSmartTemplate(other);
  assert.equal(JSON.stringify(other), otherBefore);
  const otherText = prepared.pages[0].canvas.elements.find(element => element.type === "text");
  assert.ok(otherText.smartText, "every template gets smart text slots");
  assert.equal(otherText.align, first.align, "only the brand template re-aligns copy");
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

const page = (elements, extra = {}) => {
  const source = model.designAsTemplate(model.createBlankDesign("Any template", "portrait"), "Any template");
  source.name = "Any template";
  source.pages[0].canvas = {background: "#111111", elements, ...extra};
  return source;
};
const prepared = source => template.prepareSmartTemplate(source).pages[0].canvas;
const byName = (scene, name) => scene.elements.find(element => element.name === name);

test("any template infers fixed branding, text slots and photo slots, and honours explicit roles", () => {
  const heading = text({name: "Heading", text: "A headline for this post", y: 40, height: 60, smartText: undefined});
  const photo = model.createCanvasElement("image", {name: "Hero", x: 20, y: 120, width: 320, height: 260});
  const logo = model.createCanvasElement("image", {name: "Logo", x: 20, y: 420, width: 40, height: 20});
  const handle = text({name: "Handle", text: "@studio", y: 430, height: 14, smartText: undefined});
  const sticker = model.createCanvasElement("shape", {name: "Sticker", x: 280, y: 400, width: 60, height: 40, layoutRole: "free"});
  const scene = prepared(page([heading, photo, logo, handle, sticker]));
  assert.ok(byName(scene, "Heading").smartText);
  assert.equal(byName(scene, "Hero").templateRole, "media");
  assert.equal(byName(scene, "Logo").templateRole, "brand");
  assert.equal(byName(scene, "Handle").templateRole, "brand");
  assert.equal(byName(scene, "Handle").smartText, undefined);
  assert.equal(byName(scene, "Sticker").templateRole, undefined);
  assert.equal(commands.canEditElement(scene, byName(scene, "Sticker"), "position"), true);
  assert.equal(commands.canEditElement(scene, byName(scene, "Hero"), "content"), true);
  assert.equal(commands.canEditElement(scene, byName(scene, "Hero"), "position"), false);
  assert.ok(model.parseCanvas(scene), "prepared scenes persist");
  const forced = prepared(page([{...photo, layoutRole: "fixed"}, {...heading, layoutRole: "free"}, {...handle, layoutRole: "text"}]));
  assert.equal(forced.elements[0].templateRole, "brand");
  assert.equal(forced.elements[1].smartText, undefined);
  assert.ok(forced.elements[2].smartText, "an explicit text slot overrides the handle heuristic");
});

test("copy that grows pushes the photo below it, which keeps its bottom edge", () => {
  const heading = text({name: "Heading", text: "Short", y: 40, height: 30, width: 300, fontSize: 24, smartText: undefined});
  const photo = model.createCanvasElement("image", {name: "Hero", x: 30, y: 82, width: 300, height: 300});
  const scene = prepared(page([heading, photo]));
  const media = byName(scene, "Hero");
  assert.equal(media.smartFlow.after, byName(scene, "Heading").slot);
  assert.equal(media.smartFlow.resize, true);
  const long = {...scene, elements: scene.elements.map(element => element.name === "Heading" ? {...element, text: "A much longer headline that needs several lines of space"} : element)};
  const fitted = smart.layoutSmartScene(long, metrics).scene, grown = byName(fitted, "Heading"), moved = byName(fitted, "Hero");
  assert.ok(grown.height > 30);
  assert.equal(Math.round((moved.y - grown.y - grown.height) * 100) / 100, 12);
  assert.equal(moved.y + moved.height, 382);
  assert.ok(moved.height >= 300 * .65 - .01, "a photo never gives up more than about a third of its height");
  assert.equal(smart.layoutSmartScene(fitted, metrics).scene, fitted);
});

test("automatic fit shrinks type a little inside the authored box before moving anything", () => {
  const element = text({text: "One two three four five six", width: 230, height: 22, fontSize: 20, lineHeight: 1.1, smartText: {role: "body", lines: 0, minFontSize: 9, maxFontSize: 33, maxHeight: 80, baseHeight: 22, softMinFontSize: 17}});
  const layout = fit(element);
  assert.ok(layout.fontSize < 20 && layout.fontSize >= 17, `shrinks first (got ${layout.fontSize})`);
  assert.ok(layout.height <= 22.01);
  const longer = fit({...element, text: "One two three four five six seven eight nine ten eleven twelve"});
  assert.equal(longer.fontSize, 17, "then grows the box at the soft minimum");
  assert.ok(longer.height > 22);
});

test("copy at the foot of the page grows upwards and lifts the heading above it", () => {
  const height = 450;
  const heading = text({name: "Heading", text: "Big title", y: 370, height: 34, width: 300, fontSize: 30, smartText: undefined});
  const body = text({name: "Body", text: "Small line", y: 412, height: 16, width: 300, fontSize: 14, smartText: undefined});
  const scene = prepared(page([heading, body]));
  const last = byName(scene, "Body"), above = byName(scene, "Heading");
  assert.equal(last.smartText.anchorBottom, 428);
  assert.equal(above.smartFlow.direction, "up");
  assert.ok(above.smartText.maxHeight > 34);
  const long = {...scene, elements: scene.elements.map(element => element.name === "Body" ? {...element, text: "A longer supporting line that wraps onto a few more lines below the title"} : element)};
  const fitted = smart.layoutSmartScene(long, metrics).scene, b = byName(fitted, "Body"), h = byName(fitted, "Heading");
  assert.equal(Math.round((b.y + b.height) * 100) / 100, 428, "bottom edge stays put");
  assert.ok(b.y < 412, "body grew upwards");
  assert.equal(Math.round((b.y - h.y - h.height) * 100) / 100, 8, "heading keeps its gap");
  assert.ok(h.y >= 20 && h.y + h.height <= height);
  assert.equal(smart.layoutSmartScene(fitted, metrics).scene, fitted);
});

test("editing a template releases its smart rules but keeps author choices and protection", () => {
  const heading = text({name: "Heading", text: "Title", y: 40, height: 40, smartText: undefined});
  const photo = model.createCanvasElement("image", {name: "Hero", x: 30, y: 92, width: 300, height: 260, protected: ["content"]});
  const sticker = model.createCanvasElement("shape", {name: "Sticker", layoutRole: "free"});
  const source = page([heading, photo, sticker]);
  const saved = {...source, pages: template.prepareSmartTemplate(source).pages};
  const draft = model.editTemplateDesign(saved).pages[0].canvas;
  for (const element of draft.elements) { assert.equal(element.templateRole, undefined); assert.equal(element.smartFlow, undefined); }
  assert.equal(byName(draft, "Heading").smartText, undefined);
  assert.equal(commands.canEditElement(draft, byName(draft, "Heading"), "position"), true);
  assert.deepEqual(byName(draft, "Hero").protected, ["content"]);
  assert.equal(byName(draft, "Sticker").layoutRole, "free");
  assert.ok(model.createDesign(model.designAsTemplate(model.editTemplateDesign(saved), "Again")).pages[0].canvas.elements.some(element => element.smartText), "the next copy is smart again");
});

test("agents see the same slots a person does and fill them without breaking the template style", () => {
  const agent = load("lib/template-editor/agent-decks.ts");
  const heading = text({name: "Heading", text: "Sample headline", y: 40, height: 40, smartText: undefined});
  const photo = model.createCanvasElement("image", {name: "Hero", x: 30, y: 92, width: 300, height: 260});
  const handle = text({name: "Handle", text: "@studio", y: 400, height: 14, smartText: undefined});
  const source = {...page([handle, heading, photo]), id: "agent-template"};
  const slots = agent.agentTemplateSlots(source);
  assert.deepEqual(slots.map(slot => slot.type).sort(), ["photo", "text"]);
  const textSlot = slots.find(slot => slot.type === "text");
  assert.equal(textSlot.sample, "Sample headline");
  assert.ok(textSlot.maxCharacters > 8 && textSlot.fixedStyle);
  const deck = agent.createAgentDeck({name: "Post", templateId: "agent-template", slides: [{title: "Agent copy", slots: {[slots.find(slot => slot.type === "photo").slot]: "https://example.com/photo.jpg"}}]}, [source]);
  const scene = deck.pages[0].canvas;
  assert.equal(byName(scene, "Heading").text, "Agent copy");
  assert.equal(byName(scene, "Handle").text, "@studio", "brand text is never used as the title");
  assert.equal(byName(scene, "Hero").src, "https://example.com/photo.jpg");
  assert.equal(byName(scene, "Heading").font, heading.font);
});

test("real template patterns: repeated sample headlines stay copy, gradient overlays are not frames, titles span the photo below", () => {
  const fade = model.createCanvasElement("shape", {name: "Image fade", x: -4, y: 200, width: 368, height: 170, gradient: {type: "linear", angle: 180, stops: [{color: "#000000", position: 0}, {color: "#000000", position: 100}]}});
  const photo = model.createCanvasElement("image", {name: "Hero", x: 0, y: 0, width: 360, height: 350});
  const title = text({name: "Title", text: "Your Title text", x: 36, y: 300, width: 280, height: 24, fontSize: 17, smartText: undefined});
  const body = text({name: "Body", text: "Your Content text", x: 36, y: 326, width: 280, height: 20, fontSize: 14, smartText: undefined});
  const source = page([photo, fade, title, body]);
  const heading = text({name: "Title", text: "Your Title text", x: 18, y: 60, width: 110, height: 25, fontSize: 18, smartText: undefined});
  const frame = model.createCanvasElement("shape", {name: "Shape", x: 18, y: 93, width: 324, height: 320});
  source.pages.push({...source.pages[0], id: "second", canvas: {background: "#111111", elements: [heading, frame]}});
  const prepared = template.prepareSmartTemplate(source);
  const first = prepared.pages[0].canvas, second = prepared.pages[1].canvas;
  assert.ok(byName(first, "Title").smartText, "a headline repeated across pages is still copy");
  assert.ok(byName(first, "Body").smartText.maxHeight > 60, "a gradient overlay does not box the copy in");
  assert.equal(byName(second, "Title").width, 324, "the title spans the photo frame it heads");
  assert.equal(byName(second, "Photo frame").smartFlow.resize, true);
});

test("template drafts join imported title fragments into one readable block", () => {
  const runs = ["Your", "Title", "text"].map((word, index) => ({...text({text: word, x: 17 + index * 40, y: 61, width: 40, height: 25, fontSize: 18, smartText: undefined}), groupId: "title"}));
  const source = page(runs, {groups: [{id: "title", name: "Title"}]});
  const draft = model.editTemplateDesign(source).pages[0].canvas;
  const texts = draft.elements.filter(element => element.type === "text");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "Your Title text");
  assert.equal(texts[0].textMode, "auto-height");
  assert.ok(texts[0].width > 120);
});
