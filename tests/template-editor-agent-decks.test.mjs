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
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText;
  const unit = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => Object.hasOwn(dependencies, name) ? dependencies[name] : requireModule(name), unit, unit.exports);
  return unit.exports;
}
const model = loadModule("lib/template-editor/model.ts");
const agent = loadModule("lib/template-editor/agent-decks.ts", { "./model": model });
const { createAgentDeck, updateAgentDeck, agentCapabilities, editableDeckPackage, agentDeckView, AgentDeckValidationError } = agent;
const text = (id = "heading", extra = {}) => ({ id, type: "text", text: "Editable text", x: 192, y: 108, width: 1536, height: 180, fontSize: 96, ...extra });
const shape = (id = "accent", extra = {}) => ({ id, type: "shape", shape: "rectangle", x: 192, y: 350, width: 1000, height: 30, fill: "#00d98a", ...extra });
const spec = (extra = {}) => ({ id: "deck", name: "Agent presentation", format: "presentation", slides: [{ id: "intro", layout: "blank", elements: [text(), shape()] }], ...extra });
const changes = (...operations) => ({ operations });
const update = (properties, extra = {}) => ({ op: "update_element", pageId: "intro", elementId: "heading", properties, ...extra });
const invalid = (fn, pathPart) => assert.throws(fn, error => error instanceof AgentDeckValidationError && (!pathPart || error.issues.some(issue => issue.path.includes(pathPart))));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("presentation creation leaves all layers native, editable, and importable", () => {
  const deck = createAgentDeck(spec());
  assert.equal(deck.id, "deck");
  assert.deepEqual(model.formatDimensions(deck), { width: 1920, height: 1080 });
  assert.equal(deck.pages[0].id, "intro");
  const [heading, accent] = deck.pages[0].canvas.elements;
  assert.equal(heading.type, "text"); assert.equal(heading.text, "Editable text"); assert.equal(heading.locked, false);
  assert.equal(accent.type, "shape");
  near(heading.x, 36); near(heading.y, 20.25); near(heading.fontSize, 18);
  assert.ok(model.parseLibrary(editableDeckPackage(deck)));
  const portable = editableDeckPackage(deck); portable.designs[0].name = "Detached";
  assert.equal(deck.name, "Agent presentation");
});

test("reference font IDs survive editable deck creation, import, and rich text sanitizing", () => {
  for (const font of ["sfpro", "bebascanva"]) {
    const deck = createAgentDeck(spec({ slides: [{ id: "intro", elements: [text("heading", { font, fontWeight: 700 })] }] }));
    const imported = model.parseLibrary(editableDeckPackage(deck));
    assert.equal(imported.designs[0].pages[0].canvas.elements[0].font, font);
    assert.equal(imported.designs[0].pages[0].canvas.elements[0].fontWeight, 700);
    assert.ok(agentCapabilities().fonts.includes(font));
    const styled = `<span class="gf-font-${font}">Editable reference typography</span>`;
    assert.equal(model.sanitizeRichText(styled), styled);
  }
});

test("all presets and custom dimensions use the native 360-wide scene", () => {
  for (const [format, size] of Object.entries({ presentation: [1920, 1080], portrait: [1080, 1440], square: [1080, 1080], story: [1080, 1920], custom: [2560, 1440] })) {
    const deck = createAgentDeck({ name: format, format, ...(format === "custom" ? { size: { width: size[0], height: size[1] } } : {}), slides: [{ title: "Test", body: "Still editable" }] });
    assert.deepEqual(model.formatDimensions(deck), { width: size[0], height: size[1] });
    assert.equal(deck.pages[0].canvas.elements.every(element => element.type === "text"), true);
  }
  invalid(() => createAgentDeck({ name: "Missing size", format: "custom", slides: [{}] }), "size");
  invalid(() => createAgentDeck({ name: "Bad size", format: "presentation", size: { width: 1000, height: 500 }, slides: [{}] }), "size");
});

test("high-level layouts retain readable text, bullets, image and precise shapes", () => {
  const deck = createAgentDeck({ name: "Layouts", slides: [
    { layout: "title", title: "Native headline", body: "Native subtitle" },
    { layout: "content", title: "Steps", bullets: ["One", "Two"] },
    { layout: "split", title: "A source image", body: "Editable copy", image: { src: "https://example.com/photo.jpg", alt: "Mountain", fit: "contain" } },
    { layout: "quote", title: "An author", body: "A memorable quote" },
    { layout: "blank", elements: [shape()] },
  ] });
  assert.equal(deck.pages.length, 5);
  const bullets = deck.pages[1].canvas.elements.find(element => element.slot === "bullets");
  assert.equal(bullets.text, "One\nTwo"); assert.equal(bullets.listStyle, "bullet");
  const image = deck.pages[2].canvas.elements.find(element => element.type === "image");
  assert.equal(image.publicAlt, "Mountain"); assert.equal(image.fit, "contain");
  assert.equal(deck.pages[3].canvas.elements.some(element => element.text === "A memorable quote"), true);
  assert.equal(deck.pages[4].canvas.elements[0].type, "shape");
});

test("IDs and strict JSON boundaries reject ambiguous, malicious, and unsupported inputs", () => {
  invalid(() => createAgentDeck({ ...spec(), surprise: true }), "surprise");
  invalid(() => createAgentDeck(spec({ slides: [{ id: "intro", elements: [text("same"), shape("same")] }] })), "id");
  invalid(() => createAgentDeck(spec({ slides: [{ id: "same" }, { id: "same" }] })), "id");
  invalid(() => createAgentDeck(spec({ id: "intro" })), "id");
  invalid(() => createAgentDeck(spec({ slides: [{ elements: [text("a", { x: NaN })] }] })), "x");
  invalid(() => createAgentDeck(spec({ slides: [{ elements: [{ ...text(), font: "uninstalled" }] }] })), "font");
  invalid(() => createAgentDeck(JSON.parse('{"name":"Prototype","slides":[{}],"__proto__":{"polluted":true}}')), "__proto__");
  invalid(() => createAgentDeck({ name: "   ", slides: [{}] }), "name");
  assert.equal({}.polluted, undefined);
});

test("unsafe URLs and excessive slide/layer counts cannot enter native documents", () => {
  invalid(() => createAgentDeck({ name: "Unsafe", slides: [{ image: { src: "javascript:alert(1)" } }] }), "image");
  invalid(() => createAgentDeck({ name: "Too many", slides: Array.from({ length: 21 }, () => ({})) }), "slides");
  invalid(() => createAgentDeck({ name: "Too many layers", slides: [{ title: "Generated", elements: Array.from({ length: 100 }, (_, i) => shape(`shape-${i}`)) }] }), "elements");
});

test("generated page and layer IDs are unique and supplied IDs remain stable", () => {
  const deck = createAgentDeck({ name: "IDs", slides: Array.from({ length: 8 }, () => ({ title: "Test", body: "Copy" })) });
  const ids = deck.pages.flatMap(page => [page.id, ...page.canvas.elements.map(element => element.id)]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(createAgentDeck(spec()).pages[0].canvas.elements[0].id, "heading");
});

test("atomic edits preserve native resources and unrelated document content", () => {
  const deck = createAgentDeck(spec());
  deck.tags = ["campaign"]; deck.reviewStatus = "review"; deck.comments = [{ id: "comment", text: "Keep this", createdAt: new Date().toISOString() }];
  const changed = updateAgentDeck(deck, changes(update({ text: "Revised", x: 384, fontSize: 128 }), { op: "caption", caption: "A caption" }, { op: "rename", name: "Revised deck" }));
  near(changed.pages[0].canvas.elements[0].x, 72); near(changed.pages[0].canvas.elements[0].fontSize, 24);
  assert.equal(changed.pages[0].canvas.elements[0].text, "Revised");
  assert.deepEqual(changed.tags, deck.tags); assert.deepEqual(changed.comments, deck.comments); assert.equal(changed.reviewStatus, "review");
  assert.equal(changed.createdAt, deck.createdAt); assert.equal(deck.name, "Agent presentation"); assert.equal(changed.caption, "A caption");
  const snapshot = structuredClone(deck);
  invalid(() => updateAgentDeck(deck, changes(update({ text: "Do not retain" }), update({ text: "Missing" }, { elementId: "missing" }))), "elementId");
  assert.deepEqual(deck, snapshot);
});

test("add, remove, move, and update slides maintain valid editable scenes", () => {
  let deck = createAgentDeck(spec());
  deck = updateAgentDeck(deck, changes({ op: "add_slide", index: 0, slide: { id: "opening", title: "New opening" } }, { op: "move_slide", pageId: "intro", index: 0 }, { op: "update_slide", pageId: "opening", background: "#123456", label: "Conclusion" }));
  assert.deepEqual(deck.pages.map(page => page.id), ["intro", "opening"]);
  assert.equal(deck.pages[1].canvas.background, "#123456"); assert.equal(deck.pages[1].label, "Conclusion");
  deck = updateAgentDeck(deck, changes({ op: "remove_slide", pageId: "opening" }));
  assert.equal(deck.pages.length, 1);
  invalid(() => updateAgentDeck(deck, changes({ op: "remove_slide", pageId: "intro" })), "operations");
  invalid(() => updateAgentDeck(deck, changes({ op: "add_slide", index: 2, slide: {} })), "index");
});

test("add/remove elements update reading order and reject cross-type properties", () => {
  let deck = createAgentDeck(spec());
  deck = updateAgentDeck(deck, changes({ op: "add_element", pageId: "intro", element: text("additional") }));
  assert.equal(deck.pages[0].readingOrder.includes("additional"), true);
  deck = updateAgentDeck(deck, changes({ op: "remove_element", pageId: "intro", elementId: "additional" }));
  assert.equal(deck.pages[0].readingOrder.includes("additional"), false);
  invalid(() => updateAgentDeck(deck, changes(update({ src: "https://example.com/image.jpg" }))), "src");
  invalid(() => updateAgentDeck(deck, changes(update({ id: "replacement" }))), "id");
  invalid(() => updateAgentDeck(deck, changes({ op: "add_element", pageId: "intro", element: text() })), "id");
});

test("locks and protected content, geometry, styling, deletion cannot be bypassed", () => {
  for (const [flag, properties] of [["content", { text: "Replace" }], ["position", { x: 900 }], ["style", { color: "#123456" }]]) {
    const deck = createAgentDeck(spec({ slides: [{ id: "intro", elements: [text("heading", { protected: [flag] })] }] }));
    invalid(() => updateAgentDeck(deck, changes(update(properties))), "properties");
    // Unprotected fields remain editable.
    const permitted = flag === "content" ? { x: 500 } : { text: "Allowed" };
    assert.ok(updateAgentDeck(deck, changes(update(permitted))));
  }
  const locked = createAgentDeck(spec({ slides: [{ id: "intro", elements: [text("heading", { locked: true })] }] }));
  invalid(() => updateAgentDeck(locked, changes(update({ text: "Replace" }))), "properties");
  invalid(() => updateAgentDeck(locked, changes(update({ locked: false }))), "locked");
  const protectedDeck = createAgentDeck(spec({ slides: [{ id: "intro", elements: [text("heading", { protected: ["delete"] })] }, { id: "other" }] }));
  invalid(() => updateAgentDeck(protectedDeck, changes({ op: "remove_element", pageId: "intro", elementId: "heading" })), "operations");
  invalid(() => updateAgentDeck(protectedDeck, changes({ op: "remove_slide", pageId: "intro" })), "operations");
  invalid(() => updateAgentDeck(protectedDeck, changes(update({ protected: [] }))), "protected");
});

test("ancestor group locks protect elements", () => {
  const deck = createAgentDeck(spec());
  deck.pages[0].canvas.groups = [{ id: "parent", name: "Locked parent", locked: true }, { id: "child", name: "Child", parentId: "parent" }];
  deck.pages[0].canvas.elements[0].groupId = "child";
  invalid(() => updateAgentDeck(deck, changes(update({ text: "Replace" }))), "properties");
});

test("native template instantiation preserves editable layers and fills text slots", () => {
  for (const template of model.BUILT_IN_TEMPLATES) {
    const deck = createAgentDeck({ name: "Template copy", templateId: template.id });
    assert.equal(deck.pages.length, template.pages.length);
    assert.ok(deck.pages.every(page => page.canvas));
    assert.ok(model.parseLibrary(editableDeckPackage(deck)));
  }
  const native = createAgentDeck(spec());
  const template = { id: "custom-template", name: "Custom", category: "My templates", description: "Native", format: native.format, customSize: native.customSize, pages: native.pages };
  template.pages[0].canvas.elements[0].slot = "headline";
  const filled = createAgentDeck({ name: "Filled", templateId: template.id, slides: [{ id: "filled", slots: { headline: "Filled in" } }] }, [template]);
  assert.equal(filled.pages[0].id, "filled"); assert.equal(filled.pages[0].canvas.elements[0].text, "Filled in");
  assert.equal(native.pages[0].canvas.elements[0].text, "Editable text");
  invalid(() => createAgentDeck({ name: "Bad slot", templateId: template.id, slides: [{ slots: { missing: "Text" } }] }, [template]), "slots");
});

test("capability examples are executable and inspection returns pixel coordinates", () => {
  const capabilities = agentCapabilities();
  assert.doesNotThrow(() => JSON.stringify(capabilities));
  const deck = createAgentDeck(capabilities.example);
  assert.ok(updateAgentDeck(deck, capabilities.updateExample));
  const precise = createAgentDeck(spec());
  const view = agentDeckView(precise);
  near(view.slides[0].elements[0].x, 192); near(view.slides[0].elements[0].fontSize, 96);
  assert.equal(view.coordinates, "output pixels");
  assert.equal(agent.agentDeckSummary(precise).pages, 1);
});


test("explicit template catalog respects deleted and unavailable templates", () => {
  const template = model.BUILT_IN_TEMPLATES[0];
  assert.ok(createAgentDeck({ name: "Default catalog", templateId: template.id }));
  invalid(() => createAgentDeck({ name: "Unavailable", templateId: template.id }, []), "templateId");
  invalid(() => createAgentDeck({ name: "Other catalog", templateId: template.id }, [model.BUILT_IN_TEMPLATES[1]]), "templateId");
});
