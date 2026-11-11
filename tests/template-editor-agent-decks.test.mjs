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
const spans = loadModule("lib/template-editor/spanning-photos.ts", { "./model": model });
const htmlLayer = loadModule("lib/template-editor/html-layer.ts", { "./model": model });
const agent = loadModule("lib/template-editor/agent-decks.ts", { "./model": model, "./text-accents": loadModule("lib/template-editor/text-accents.ts", { "./model": model, "./brand-guide": loadModule("lib/template-editor/brand-guide.ts", { "./model": model }), "./color-utils": loadModule("lib/template-editor/color-utils.ts") }), "./agent-video-layers": loadModule("lib/template-editor/agent-video-layers.ts", { "./model": model }), "./spanning-photos": spans, "./video-slides": loadModule("lib/template-editor/video-slides.ts", { "./model": model, "./spanning-photos": spans }), "./html-layer": htmlLayer, "./frames": loadModule("lib/template-editor/frames.ts", { "./model": model }) });
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

// Template composition: `templatePage` builds any carousel length from a template's page types.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const layer = (type, id, patch = {}) => ({ ...model.createCanvasElement(type, patch), ...patch, id });
const photoFill = (src = "https://example.com/texture.png") => ({ src, objectFit: "cover", cropX: 50, cropY: 50 });
/** A brand carousel template: Cover, Text + Media, List, Follow (as imported, before smart preparation). */
function brandTemplate() {
  const design = model.createBlankDesign("@chatgptricks", "portrait");
  design.customSize = { width: 1080, height: 1440 };
  const furniture = page => [
    layer("image", `${page}-logo`, { name: "Logo", src: "https://example.com/logo.png", x: 20, y: 15, width: 24, height: 24 }),
    layer("text", `${page}-handle`, { text: "@chatgptricks", x: 50, y: 18, width: 120, height: 14, fontSize: 10, color: "#ffffff" }),
  ];
  const base = design.pages[0];
  const make = (id, label, elements) => ({ ...structuredClone(base), id, label, image: { ...base.image, id: `${id}-image` }, canvas: { background: "#0b1014", elements: [...elements, ...furniture(id)] } });
  design.pages = [
    make("cover", "Cover", [layer("text", "cover-title", { text: "A creative way to build your next great project", x: 20, y: 340, width: 320, height: 99, font: "bebascanva", fontSize: 39, lineHeight: .85, color: "#ffffff", align: "center" })]),
    make("text-media", "Text + Media", [
      layer("text", "tm-title", { text: "Your Title text", x: 18, y: 60, width: 324, height: 25, font: "sfpro", fontSize: 18, lineHeight: 1.3, color: "#ffffff" }),
      layer("image", "tm-photo", { name: "Photo", src: "https://example.com/photo.png", x: 18, y: 160, width: 324, height: 270 }),
    ]),
    make("list", "List", [
      layer("text", "list-title", { text: "Three things to try", x: 18, y: 60, width: 324, height: 25, font: "sfpro", fontSize: 18, color: "#ffffff" }),
      layer("text", "list-body", { text: "1. First idea\n2. Second idea\n3. Third idea", x: 18, y: 110, width: 324, height: 80, font: "sfpro", fontSize: 14, color: "#ffffff" }),
    ]),
    make("follow", "Follow", [layer("text", "follow-button", { text: "Follow", x: 130, y: 300, width: 100, height: 20, fontSize: 16, color: "#ffffff" })]),
  ];
  const template = model.designAsTemplate(design, "@chatgptricks"); template.id = "brand-carousel";
  return template;
}
/** An already-smart template whose detail page carries every kind of layer reference. */
function richTemplate() {
  const base = model.createBlankDesign("Rich", "portrait").pages[0];
  const page = (id, label, canvas, extra = {}) => ({ ...structuredClone(base), id, label, image: { ...base.image, id: `${id}-image` }, canvas, ...extra });
  const smart = { role: "heading", lines: 0, minFontSize: 12, maxFontSize: 40, maxHeight: 80 };
  return {
    id: "rich-template", name: "Rich", description: "", category: "My templates", format: "portrait",
    pages: [
      page("intro", "Intro", { background: "#111111", elements: [layer("text", "intro-title", { slot: "headline", text: "Intro", x: 20, y: 40, width: 320, height: 40, fontSize: 24, smartText: smart })] }),
      page("detail", "Detail", {
        background: "#111111",
        groups: [{ id: "g-parent", name: "Brand" }, { id: "g-child", name: "Lockup", parentId: "g-parent" }],
        elements: [
          layer("image", "logo", { name: "Logo", src: "https://example.com/logo.png", x: 20, y: 10, width: 20, height: 20, groupId: "g-child", templateRole: "brand", protected: ["content", "position", "style", "delete"] }),
          layer("text", "handle", { text: "@brand", x: 45, y: 12, width: 80, height: 14, fontSize: 10, groupId: "g-parent", templateRole: "brand", protected: ["content", "position", "style", "delete"] }),
          layer("text", "detail-title", { text: "Detail", x: 20, y: 40, width: 320, height: 40, fontSize: 24, smartText: smart }),
          layer("text", "rich", { text: "Bold word here", richText: 'Bold <span data-texture-id="tex-1">word</span> here', wordTextures: [{ ...photoFill(), id: "tex-1" }], componentId: "comp-1", componentInstanceId: "inst-1", x: 20, y: 90, width: 320, height: 30, fontSize: 14 }),
          layer("image", "detail-photo", { name: "Photo", src: "https://example.com/photo.png", templateRole: "media", smartFlow: { after: "detail-title", gap: 8, bottom: 420, resize: true }, x: 20, y: 130, width: 320, height: 290 }),
        ],
      }, { readingOrder: ["detail-title", "rich", "detail-photo"] }),
      page("outro", "Outro", { background: "#111111", elements: [layer("text", "outro-cta", { slot: "cta", text: "Follow for more", x: 20, y: 200, width: 320, height: 40, fontSize: 24, smartText: smart })] }),
    ],
  };
}
const deckIds = deck => deck.pages.flatMap(page => [page.id, page.image.id, ...page.canvas.elements.map(element => element.id), ...(page.canvas.groups ?? []).map(group => group.id)]);
const templateIds = template => new Set(template.pages.flatMap(page => [page.id, page.image.id, ...(page.canvas?.elements ?? []).map(element => element.id), ...(page.canvas?.groups ?? []).map(group => group.id)]));
/** Everything a copy must share with its template page, without identities. */
function constraints(scene) {
  return scene.elements.map(element => {
    const copy = structuredClone(element);
    for (const key of ["id", "groupId", "componentInstanceId"]) delete copy[key];
    if (copy.wordTextures) copy.wordTextures = copy.wordTextures.map(texture => ({ ...texture, id: undefined }));
    if (copy.richText) copy.richText = copy.richText.replace(/data-texture-id="[^"]+"/g, "data-texture-id");
    return copy;
  });
}

test("templatePage composes subsets, reorders and repeats of template pages into a valid deck", () => {
  const template = brandTemplate();
  const carousel = createAgentDeck({ name: "Recreated post", templateId: template.id, slides: [
    { templatePage: 0, title: "OpenAI just shipped memory for everyone" },
    { templatePage: 1, title: "It remembers your projects", slots: { "smart-media": PNG } },
    { templatePage: 1, title: "You can turn it off" },
    { templatePage: 1, title: "Or delete single memories", image: { src: "https://example.com/settings.png", alt: "Memory settings" } },
    { templatePage: 2, title: "Try these prompts", body: "1. Summarise my week\n2. Plan my trip" },
    { templatePage: 3 },
  ] }, [template]);
  assert.deepEqual(carousel.pages.map(page => page.label), ["Cover", "Text + Media", "Text + Media", "Text + Media", "List", "Follow"]);
  assert.equal(carousel.templateId, template.id);
  const ids = deckIds(carousel);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => !templateIds(template).has(id)));
  const title = page => page.canvas.elements.find(element => element.slot === "smart-text-0").text;
  assert.deepEqual(carousel.pages.slice(0, 5).map(title), ["OpenAI just shipped memory for everyone", "It remembers your projects", "You can turn it off", "Or delete single memories", "Try these prompts"]);
  const photos = carousel.pages.slice(1, 4).map(page => page.canvas.elements.find(element => element.slot === "smart-media"));
  assert.deepEqual(photos.map(photo => photo.src), [PNG, "https://example.com/photo.png", "https://example.com/settings.png"]);
  assert.equal(photos[2].publicAlt, "Memory settings");
  assert.ok(model.parseLibrary(editableDeckPackage(carousel)));
  // Subset in a new order, and a single slide.
  const subset = createAgentDeck({ name: "Short", templateId: template.id, slides: [{ templatePage: 3 }, { templatePage: 0 }] }, [template]);
  assert.deepEqual(subset.pages.map(page => page.label), ["Follow", "Cover"]);
  assert.deepEqual(createAgentDeck({ name: "One", templateId: template.id, slides: [{ templatePage: 2 }] }, [template]).pages.map(page => page.label), ["List"]);
  // The maximum length is still 20 slides, all from one page type.
  assert.equal(createAgentDeck({ name: "Long", templateId: template.id, slides: Array.from({ length: 20 }, () => ({ templatePage: 1 })) }, [template]).pages.length, 20);
  invalid(() => createAgentDeck({ name: "Too long", templateId: template.id, slides: Array.from({ length: 21 }, () => ({ templatePage: 1 })) }, [template]), "slides");
});

test("repeated template pages get fresh identities with every layer reference remapped", () => {
  const template = richTemplate(), snapshot = structuredClone(template);
  const deck = createAgentDeck({ name: "Repeats", templateId: template.id, slides: [
    { id: "first", templatePage: 1 }, { templatePage: 1, label: "Second detail" }, { templatePage: 1, slots: { "detail-photo": PNG } },
  ] }, [template]);
  assert.deepEqual(template, snapshot);
  assert.equal(deck.pages[0].id, "first");
  assert.equal(deck.pages[1].label, "Second detail");
  const ids = deckIds(deck), original = templateIds(template);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => !original.has(id)));
  const instances = new Set(), textures = new Set();
  for (const page of deck.pages) {
    const scene = page.canvas, byName = name => scene.elements.find(element => element.name === name || element.text === name);
    const [parent, child] = scene.groups;
    assert.equal(child.parentId, parent.id);
    const logo = byName("Logo"), handle = byName("@brand"), heading = byName("Detail"), rich = byName("Bold word here"), photo = byName("Photo");
    assert.equal(logo.groupId, child.id); assert.equal(handle.groupId, parent.id);
    assert.deepEqual(page.readingOrder, [heading.id, rich.id, photo.id]);
    assert.equal(photo.smartFlow.after, heading.id);
    assert.equal(rich.wordTextures.length, 1);
    assert.equal(rich.richText, `Bold <span data-texture-id="${rich.wordTextures[0].id}">word</span> here`);
    assert.equal(rich.componentId, "comp-1");
    instances.add(rich.componentInstanceId); textures.add(rich.wordTextures[0].id);
    assert.deepEqual(logo.protected, ["content", "position", "style", "delete"]);
  }
  assert.equal(instances.size, 3); assert.equal(textures.size, 3);
  // A listed slot without a slot name (its template layer id) still targets the copy's layer.
  assert.deepEqual(deck.pages.map(page => page.canvas.elements.find(element => element.name === "Photo").src), ["https://example.com/photo.png", "https://example.com/photo.png", PNG]);
  // Copies are independent: editing one leaves the others alone.
  const edited = updateAgentDeck(deck, changes({ op: "update_element", pageId: "first", elementId: deck.pages[0].canvas.elements[2].id, properties: { text: "Only here" } }));
  assert.deepEqual(edited.pages.map(page => page.canvas.elements[2].text), ["Only here", "Detail", "Detail"]);
  // Brand layers stay protected in every copy.
  invalid(() => updateAgentDeck(deck, changes({ op: "update_element", pageId: deck.pages[1].id, elementId: deck.pages[1].canvas.elements[0].id, properties: { x: 100 } })), "properties");
  assert.ok(model.parseLibrary(editableDeckPackage(deck)));
});

test("composed decks keep the same smart-template constraints as a full template copy", () => {
  const template = brandTemplate();
  const full = createAgentDeck({ name: "Full copy", templateId: template.id }, [template]);
  const order = [3, 1, 0, 1, 2];
  const composed = createAgentDeck({ name: "Composed", templateId: template.id, slides: order.map(templatePage => ({ templatePage })) }, [template]);
  order.forEach((source, index) => {
    assert.deepEqual(constraints(composed.pages[index].canvas), constraints(full.pages[source].canvas), `slide ${index} differs from template page ${source}`);
    assert.equal(composed.pages[index].canvas.layout?.margins?.enabled, full.pages[source].canvas.layout?.margins?.enabled);
  });
  // The cover keeps its cover role on slide 3, and interior pages never become covers on slide 1.
  const role = page => page.canvas.elements.find(element => element.smartText)?.smartText.role;
  assert.equal(role(composed.pages[2]), "cover"); assert.equal(role(composed.pages[1]), "heading");
  const media = composed.pages[1].canvas.elements.find(element => element.slot === "smart-media");
  assert.equal(media.templateRole, "media"); assert.deepEqual(media.smartFlow, { after: "smart-text-0", gap: 8, bottom: 430, resize: true });
  assert.ok(composed.pages[1].canvas.elements.filter(element => element.templateRole === "brand").every(element => element.protected.includes("content")));
  // Per-page summary for composition, including pages without slots.
  const pages = agent.agentTemplatePages(template);
  assert.deepEqual(pages.map(page => [page.index, page.label, page.slots.map(slot => slot.slot)]), [[0, "Cover", ["smart-text-0"]], [1, "Text + Media", ["smart-text-0", "smart-media"]], [2, "List", ["smart-text-0", "smart-text-1"]], [3, "Follow", []]]);
  assert.equal(pages[1].slots[0].role, "heading"); assert.equal(pages[1].slots[1].type, "photo");
  assert.ok(pages.every(page => page.slots.every(slot => !("pageIndex" in slot) && !("pageId" in slot))));
});

test("templatePage is all-or-none, in range, and only available with templateId", () => {
  const template = brandTemplate(), create = (slides, extra = {}) => createAgentDeck({ name: "Checked", templateId: template.id, slides, ...extra }, [template]);
  invalid(() => create([{ templatePage: 0 }, {}, { templatePage: 3 }]), "$.slides[1].templatePage");
  invalid(() => create([{}, {}, {}, { templatePage: 3 }]), "$.slides[0].templatePage");
  assert.throws(() => create([{ templatePage: 0 }, { templatePage: 4 }]), error => error instanceof AgentDeckValidationError && error.issues[0].path === "$.slides[1].templatePage" && /0 to 3/.test(error.issues[0].message));
  for (const value of [-1, 1.5, "1", 20, null]) invalid(() => create([{ templatePage: value }]), "templatePage");
  invalid(() => createAgentDeck({ name: "No template", slides: [{ templatePage: 0, title: "Hello" }] }), "templatePage");
  invalid(() => updateAgentDeck(create([{ templatePage: 0 }]), changes({ op: "add_slide", slide: { templatePage: 1 } })), "templatePage");
  invalid(() => create([{ templatePage: 1, layout: "content" }]), "slides[0]");
  invalid(() => create([{ templatePage: 1, slots: { missing: "Text" } }]), "slots");
  const continuous = { ...structuredClone(template), id: "continuous", continuousCanvas: { background: "#000000", elements: [] } };
  invalid(() => createAgentDeck({ name: "Continuous", templateId: continuous.id, slides: [{ templatePage: 0 }] }, [continuous]), "slides");
});

test("without templatePage, template decks keep the exact page-count contract", () => {
  const template = brandTemplate();
  assert.throws(() => createAgentDeck({ name: "Short", templateId: template.id, slides: [{}, {}, {}] }, [template]), error => error instanceof AgentDeckValidationError && error.issues[0].path === "$.slides" && /exactly 4 slides/.test(error.issues[0].message));
  const copy = createAgentDeck({ name: "Copy", templateId: template.id }, [template]);
  assert.deepEqual(copy.pages.map(page => page.label), ["Cover", "Text + Media", "List", "Follow"]);
  const filled = createAgentDeck({ name: "Filled", templateId: template.id, slides: [{ title: "Cover copy" }, { slots: { "smart-media": PNG } }, {}, {}] }, [template]);
  assert.equal(filled.pages[0].canvas.elements.find(element => element.slot === "smart-text-0").text, "Cover copy");
  assert.equal(filled.pages[1].canvas.elements.find(element => element.slot === "smart-media").src, PNG);
  // Full copies also accept a listed slot that only has its template layer id.
  const rich = richTemplate();
  const richCopy = createAgentDeck({ name: "Rich copy", templateId: rich.id, slides: [{}, { slots: { "detail-photo": PNG } }, {}] }, [rich]);
  assert.equal(richCopy.pages[1].canvas.elements.find(element => element.name === "Photo").src, PNG);
  for (const builtIn of model.BUILT_IN_TEMPLATES) assert.equal(createAgentDeck({ name: "Built in", templateId: builtIn.id }).pages.length, builtIn.pages.length);
});

test("photo slots accept PNG data URLs, including chart-sized ones; base64 SVG is rejected", () => {
  const template = brandTemplate(), media = slot => [{ templatePage: 1, slots: { "smart-media": slot } }];
  const chart = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG.split(",")[1], "base64"), Buffer.alloc(150_000)]).toString("base64")}`;
  assert.ok(chart.length > 200_000);
  const deck = createAgentDeck({ name: "Chart", templateId: template.id, slides: media(chart) }, [template]);
  assert.equal(deck.pages[0].canvas.elements.find(element => element.slot === "smart-media").src, chart);
  assert.ok(createAgentDeck({ name: "Chart image", templateId: template.id, slides: [{ templatePage: 1, image: { src: chart } }] }, [template]));
  const vector = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 10L5 4L10 6" stroke="#00d98a" stroke-width="1"/></svg>';
  assert.ok(createAgentDeck({ name: "Passive SVG", templateId: template.id, slides: media(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(vector)}`) }, [template]));
  invalid(() => createAgentDeck({ name: "Base64 SVG", templateId: template.id, slides: media(`data:image/svg+xml;base64,${Buffer.from(vector).toString("base64")}`) }, [template]), "slots");
  invalid(() => createAgentDeck({ name: "SVG text", templateId: template.id, slides: media(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>1</text></svg>')}`) }, [template]), "slots");
  invalid(() => createAgentDeck({ name: "Fake PNG", templateId: template.id, slides: media(`data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`) }, [template]), "slots");
  invalid(() => createAgentDeck({ name: "Long text", templateId: template.id, slides: [{ templatePage: 1, slots: { "smart-text-0": "x".repeat(20_001) } }] }, [template]), "slots");
});

test("capabilities document composition with an executable example and per-page template types", () => {
  const capabilities = agentCapabilities();
  assert.deepEqual(capabilities.deckSchema.properties.slides.items.properties.templatePage, { type: "integer", minimum: 0, maximum: 19, description: capabilities.deckSchema.properties.slides.items.properties.templatePage.description });
  assert.equal(capabilities.updateSchema.properties.operations.items.oneOf.find(variant => variant.properties.op.const === "add_slide").properties.slide.properties.templatePage.type, "integer");
  const example = capabilities.templateExample;
  assert.ok(example.slides.every(slide => Number.isInteger(slide.templatePage)));
  const deck = createAgentDeck(example);
  assert.equal(deck.pages.length, example.slides.length);
  assert.ok(capabilities.templates.every(template => template.pageTypes.length === template.pages && template.pageTypes.every((page, index) => page.index === index)));
  assert.ok(capabilities.notes.some(note => note.includes("templatePage")));
  assert.ok(capabilities.imageSources.some(source => source.includes("png")));
});
