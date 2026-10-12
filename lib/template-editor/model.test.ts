import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_BRAND,
  EMPTY_LIBRARY,
  FORMATS,
  cloneDesign,
  createBlankDesign,
  createBlankTemplateDesign,
  createCanvasElement,
  createDesign,
  designAsTemplate,
  duplicatePage,
  editTemplateDesign,
  parseLibrary,
  resizeCanvasScene,
  sceneForPage,
  storyForDesign,
  activeBrandKit,
  createBrandKit,
  libraryBrandKits,
  withBrandKits,
  type SavedBrandKit,
  type EditorLibrary,
  type CanvasElement,
  type CanvasScene,
} from "./model";

function library(): EditorLibrary {
  return {
    ...structuredClone(EMPTY_LIBRARY),
    designs: [createDesign(BUILT_IN_TEMPLATES[0])],
    templates: [],
    brand: { ...DEFAULT_BRAND },
  };
}

function brandLibrary(): EditorLibrary {
  const first = createBrandKit("Studio one");
  first.assets = [{ id: "logo-one", name: "Primary logo", src: "/template-editor/forest.svg", width: 800, height: 400, kind: "logo" }];
  const second = createBrandKit("Studio two", { ...DEFAULT_BRAND, font: "space", background: "#ffffff", text: "#123456" });
  second.palette = ["#ffffff", "#123456", "#ff0000"];
  return withBrandKits(library(), [first, second], second.id);
}

test("legacy brand-only libraries migrate once without losing designs or brand settings", () => {
  const legacy: Record<string, unknown> = { ...library(), brand: { name: "Legacy studio", font: "space", background: "#ffffff", text: "#123456" } };
  delete legacy.brandKits;
  delete legacy.activeBrandKitId;
  const migrated = parseLibrary(legacy)!;
  assert.ok(migrated);
  assert.equal(migrated.activeBrandKitId, "brand-default");
  assert.deepEqual(migrated.brand, legacy.brand);
  assert.deepEqual(migrated.brandKits, [{ ...migrated.brand, id: "brand-default", palette: ["#ffffff", "#123456"], assets: [] }]);
  assert.deepEqual(migrated.designs, legacy.designs);
  assert.deepEqual(parseLibrary(JSON.stringify(migrated)), migrated);
  assert.equal(parseLibrary(legacy)!.activeBrandKitId, migrated.activeBrandKitId);
});

test("multiple brand kits and image assets round-trip with the active projection canonicalized", () => {
  const input = brandLibrary();
  assert.deepEqual(parseLibrary(JSON.stringify(input)), input);
  const active = activeBrandKit(input);
  assert.equal(active.name, "Studio two");
  input.brand = { ...DEFAULT_BRAND, name: "Stale compatibility projection" };
  const parsed = parseLibrary(input)!;
  assert.deepEqual(parsed.brand, { name: active.name, font: active.font, background: active.background, text: active.text });
  assert.equal(parsed.brandKits[0].assets[0].kind, "logo");
  parsed.brandKits[0].assets[0].name = "Edited copy";
  assert.equal(input.brandKits[0].assets[0].name, "Primary logo");
});

test("brand helpers do not mutate their inputs and keep active-kit changes synchronized", () => {
  const input = brandLibrary();
  const original = structuredClone(input);
  const kits = libraryBrandKits(input);
  kits[0].name = "Changed studio";
  kits[0].assets[0].name = "Changed logo";
  const changed = withBrandKits(input, kits, kits[0].id);
  assert.equal(changed.brand.name, "Changed studio");
  assert.equal(changed.activeBrandKitId, kits[0].id);
  assert.equal(activeBrandKit(changed).assets[0].name, "Changed logo");
  assert.deepEqual(input, original);
  kits[0].palette.push("#777777");
  assert.ok(!changed.brandKits[0].palette.includes("#777777"));
  const removedActive = withBrandKits(changed, [changed.brandKits[1]]);
  assert.equal(removedActive.activeBrandKitId, changed.brandKits[1].id);
  assert.equal(removedActive.brand.name, "Studio two");
  assert.throws(() => withBrandKits(input, []), /valid brand kits/);
  assert.notEqual(createBrandKit().id, createBrandKit().id);
});

test("brand imports reject duplicate IDs, dangling selections, and invalid bounds", () => {
  const invalidKits: unknown[] = [null, {}, [], Array.from({ length: 21 }, () => createBrandKit())];
  for (const brandKits of invalidKits) assert.equal(parseLibrary({ ...brandLibrary(), brandKits }), null);
  const repeated = createBrandKit();
  assert.equal(parseLibrary({ ...brandLibrary(), brandKits: [repeated, repeated], activeBrandKitId: repeated.id }), null);
  for (const activeBrandKitId of [null, 1, "missing", "../invalid"]) assert.equal(parseLibrary({ ...brandLibrary(), activeBrandKitId }), null);
  const invalidFields: Partial<Record<keyof SavedBrandKit, unknown[]>> = {
    id: ["", "bad id", "../outside"],
    name: [null, "x".repeat(201)],
    font: ["unknown-font", "url(https://example.com)"],
    background: ["red;background:url(https://example.com)"],
    text: ["var(--external-color)"],
    palette: [null, ["url(https://example.com)"], Array(21).fill("#ffffff")],
    assets: [null, Array.from({ length: 41 }, (_, index) => ({ id: `asset-${index}`, name: "Asset", src: "/a.png", width: 1, height: 1, kind: "image" }))],
  };
  for (const [field, values] of Object.entries(invalidFields)) for (const value of values!) {
    const input = brandLibrary();
    Object.assign(input.brandKits[0], { [field]: value });
    assert.equal(parseLibrary(input), null, `${field}=${String(value)}`);
  }
  const allowed = library();
  allowed.brandKits = Array.from({ length: 20 }, () => createBrandKit());
  allowed.activeBrandKitId = allowed.brandKits[0].id;
  allowed.brandKits[0].palette = Array(20).fill("#ffffff");
  allowed.brandKits[0].assets = Array.from({ length: 40 }, (_, index) => ({ id: `asset-${index}`, name: "Asset", src: "/a.png", width: 1, height: 1, kind: "image" }));
  assert.ok(parseLibrary(allowed));
});

test("brand assets obey existing image safety rules and strict asset metadata", () => {
  const invalidFields: Record<string, unknown[]> = {
    id: ["", "../bad"], name: [null, "x".repeat(201)],
    src: ["javascript:alert(1)", "blob:https://example.com/abc", "file:///tmp/a.png", "//example.com/a.png", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64,SGVsbG8=", `https://example.com/${"x".repeat(2_000_000)}`],
    width: [0, -1, Infinity, 100001, "100"], height: [0, NaN, 100001], kind: ["video", "svg", null],
  };
  for (const [field, values] of Object.entries(invalidFields)) for (const value of values) {
    const input = brandLibrary();
    Object.assign(input.brandKits[0].assets[0], { [field]: value });
    assert.equal(parseLibrary(input), null, `${field}=${String(value).slice(0, 100)}`);
  }
  const duplicateAsset = brandLibrary();
  duplicateAsset.brandKits[0].assets.push({ ...duplicateAsset.brandKits[0].assets[0] });
  assert.equal(parseLibrary(duplicateAsset), null);
  const raster = brandLibrary();
  raster.brandKits[0].assets[0].src = `data:image/png;base64,${Buffer.from("\x89PNG\r\n\x1a\n", "binary").toString("base64")}`;
  assert.ok(parseLibrary(raster));
  const untrusted = brandLibrary();
  Object.assign(untrusted.brandKits[0].assets[0], { onload: "alert(1)", style: "position:fixed" });
  Object.assign(untrusted.brandKits[0], { secret: "discard this" });
  const safe = parseLibrary(untrusted)!;
  assert.ok(!("onload" in safe.brandKits[0].assets[0]));
  assert.ok(!("secret" in safe.brandKits[0]));
});

test("brand asset payloads still count toward the shared whole-library limit", () => {
  const input = brandLibrary();
  const payload = `data:image/png;base64,${Buffer.from("\x89PNG\r\n\x1a\n" + "0".repeat(1_499_900), "binary").toString("base64")}`;
  assert.ok(payload.length < 2_000_000);
  input.brandKits[0].assets = Array.from({ length: 16 }, (_, index) => ({ id: `asset-${index}`, name: "Large asset", src: payload, width: 100, height: 100, kind: "image" }));
  assert.equal(parseLibrary(input), null);
});

test("every built-in template can become a valid, independent persisted design", () => {
  const designs = BUILT_IN_TEMPLATES.map(createDesign);
  assert.equal(BUILT_IN_TEMPLATES.length, 8);
  assert.ok(designs.some((d) => d.pages.length >= 3));
  assert.ok(designs.some((d) => d.format === "story"));
  const original: EditorLibrary = { ...EMPTY_LIBRARY, designs };
  assert.deepEqual(parseLibrary(JSON.stringify(original)), original);
  assert.deepEqual(FORMATS.story, {
    label: "Story",
    width: 1080,
    height: 1920,
  });
  for (const design of designs) {
    const template = BUILT_IN_TEMPLATES.find(
      (t) => t.id === design.templateId,
    )!;
    assert.notEqual(design.pages[0].id, template.pages[0].id);
    assert.notEqual(design.pages[0].image.id, template.pages[0].image.id);
    assert.notEqual(design.pages[0].style, template.pages[0].style);
  }
});

test("copying a design isolates page, image and style changes from the original", () => {
  const original = createDesign(BUILT_IN_TEMPLATES[0]);
  original.caption = "A caption worth keeping";
  const copy = cloneDesign(original);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, `${original.name} copy`);
  assert.equal(copy.caption, original.caption);
  copy.pages[0].style.heading = "Changed";
  copy.pages[0].image.url = "/another-image.png";
  assert.notEqual(copy.pages[0].style.heading, original.pages[0].style.heading);
  assert.notEqual(copy.pages[0].image.url, original.pages[0].image.url);
  assert.equal(
    new Set([...original.pages, ...copy.pages].map((p) => p.image.id)).size,
    original.pages.length * 2,
  );
});

test("page duplication and saved templates allocate independent identities", () => {
  const design = createDesign(BUILT_IN_TEMPLATES[0]);
  const repeated = duplicatePage(design.pages[0]);
  assert.notEqual(repeated.id, design.pages[0].id);
  assert.notEqual(repeated.image.id, design.pages[0].image.id);
  const template = designAsTemplate(design, "  My series  ");
  assert.equal(template.name, "My series");
  assert.equal(template.custom, true);
  assert.equal(template.format, design.format);
  assert.notEqual(template.pages[0].id, design.pages[0].id);
  template.pages[0].style.heading = "Reusable";
  assert.notEqual(
    template.pages[0].style.heading,
    design.pages[0].style.heading,
  );
  const next = createDesign(template);
  assert.equal(next.templateId, template.id);
  assert.equal(next.pages[0].style.heading, "Reusable");
});

test("renderer adapter preserves page order, every page style, and caption", () => {
  const design = createDesign(BUILT_IN_TEMPLATES[0]);
  design.pages.reverse();
  design.caption = "The edited caption";
  const story = storyForDesign(design);
  assert.equal(story.title, design.name);
  assert.equal(story.leadImageId, design.pages[0].image.id);
  assert.equal(story.caption.draft, design.caption);
  assert.equal(story.curation.captionEdited, design.caption);
  assert.deepEqual(
    story.curation.order,
    design.pages.map((p) => p.image.id),
  );
  assert.deepEqual(story.curation.selectedImageIds, story.curation.order);
  for (const p of design.pages)
    assert.deepEqual(story.curation.slideStyles[p.image.id], p.style);
});

test("malformed, unsupported, and over-capacity libraries cannot replace saved work", () => {
  for (const value of [
    null,
    undefined,
    "{",
    [],
    {},
    { ...EMPTY_LIBRARY, version: 99 },
  ])
    assert.equal(parseLibrary(value), null);
  const invalidPages = library();
  invalidPages.designs[0].pages = [];
  assert.equal(parseLibrary(invalidPages), null);
  invalidPages.designs[0].pages = Array.from({ length: 21 }, () =>
    duplicatePage(BUILT_IN_TEMPLATES[0].pages[0]),
  );
  assert.equal(parseLibrary(invalidPages), null);
  assert.equal(
    parseLibrary({
      ...EMPTY_LIBRARY,
      designs: Array.from({ length: 151 }, () =>
        createDesign(BUILT_IN_TEMPLATES[1]),
      ),
    }),
    null,
  );
  const template = designAsTemplate(
    createDesign(BUILT_IN_TEMPLATES[1]),
    "Reusable",
  );
  assert.equal(
    parseLibrary({
      ...EMPTY_LIBRARY,
      templates: Array.from({ length: 81 }, () => template),
    }),
    null,
  );
  assert.equal(
    parseLibrary({
      ...library(),
      brand: { ...DEFAULT_BRAND, font: "url(https://example.com)" },
    }),
    null,
  );
});

test("unsafe rich HTML is dropped while its plain text remains usable", () => {
  for (const html of [
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"></svg>',
    '<b onclick="alert(1)">A thought</b>',
    '<span style="background:url(https://example.com)">A thought</span>',
    '<span class="gf-font-geist" onmouseover="alert(1)">A thought</span>',
    "<style>body { display: none; }</style>",
    "<b><i>unbalanced</b></i>",
    '<span style="font-weight:700; color:red">A thought</span>',
  ]) {
    const input = library();
    input.designs[0].pages[0].style.heading = "Safe plain text";
    input.designs[0].pages[0].style.headingHtml = html;
    input.designs[0].pages[0].style.bodyHtml = html;
    const parsed = parseLibrary(input)!;
    assert.ok(parsed);
    assert.equal(parsed.designs[0].pages[0].style.heading, "Safe plain text");
    assert.equal(parsed.designs[0].pages[0].style.headingHtml, undefined);
    assert.equal(parsed.designs[0].pages[0].style.bodyHtml, undefined);
  }
});

test("supported inline formatting survives round trips without introducing arbitrary attributes", () => {
  const input = library();
  const html =
    '<b>Hello</b><br><span class="gf-font-geist" style="font-weight: 700; font-style: italic; text-decoration-line: underline">world &amp; everyone</span>';
  input.designs[0].pages[0].style.headingHtml = html;
  const parsed = parseLibrary(input)!;
  assert.equal(parsed.designs[0].pages[0].style.headingHtml, html);
  assert.deepEqual(parseLibrary(JSON.stringify(parsed)), parsed);
});

test("image imports reject executable or temporary URLs and mislabeled raster payloads", () => {
  for (const url of [
    "javascript:alert(1)",
    "blob:https://example.com/id",
    "file:///etc/passwd",
    "//example.com/track.png",
    "/%2fexample.com/x",
    "https://user:password@example.com/x.png",
    "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=",
    "data:image/png;base64,PHNjcmlwdD4=",
    "data:image/png;base64,not*base64",
  ]) {
    const input = library();
    input.designs[0].pages[0].image.url = url;
    assert.equal(parseLibrary(input), null, url);
  }
  const input = library();
  input.designs[0].pages[0].image.url =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=";
  assert.ok(parseLibrary(input));
  input.designs[0].pages[0].image.url = "https://example.com/image.jpg";
  assert.ok(parseLibrary(input));
});

test("duplicate identities and invalid frame dimensions are rejected", () => {
  const input = library();
  input.designs.push({ ...input.designs[0] });
  assert.equal(parseLibrary(input), null);
  input.designs.pop();
  input.designs[0].pages[1].id = input.designs[0].pages[0].id;
  assert.equal(parseLibrary(input), null);
  const duplicatedImage = library();
  duplicatedImage.designs[0].pages[1].image.id =
    duplicatedImage.designs[0].pages[0].image.id;
  assert.equal(parseLibrary(duplicatedImage), null);
  for (const width of [0, -1, Infinity, NaN, 30_001]) {
    const sized = library();
    sized.designs[0].pages[0].image.width = width;
    assert.equal(parseLibrary(sized), null);
  }
});

test("numeric style controls are finite and bounded, and unknown fields are removed", () => {
  const input = library();
  input.designs[0].pages[0].style.textScale = 50;
  input.designs[0].pages[0].style.mediaX = -999;
  input.designs[0].pages[0].style.textOpacity = Infinity;
  input.designs[0].pages[0].style.bgColor =
    "url(https://example.com/track.png)";
  Object.assign(input.designs[0].pages[0].style, {
    extra: "unexpected",
    constructor: { prototype: { polluted: true } },
  });
  const style = parseLibrary(input)!.designs[0].pages[0].style;
  assert.equal(style.textScale, 2.5);
  assert.equal(style.mediaX, -200);
  assert.equal(style.textOpacity, undefined);
  assert.equal(style.bgColor, undefined);
  assert.equal(Object.hasOwn(style, "extra"), false);
  assert.equal(Object.hasOwn(style, "constructor"), false);
});

test("custom template backups round-trip and do not share mutable page objects", () => {
  const input = library();
  input.templates = [designAsTemplate(input.designs[0], "Weekly series")];
  const parsed = parseLibrary(input)!;
  assert.deepEqual(parsed, input);
  parsed.templates[0].pages[0].style.heading = "Changed after loading";
  assert.notEqual(
    input.templates[0].pages[0].style.heading,
    parsed.templates[0].pages[0].style.heading,
  );
  assert.notEqual(
    parsed.templates[0].pages[0].style.heading,
    parsed.designs[0].pages[0].style.heading,
  );
});

test("manual template drafts start blank and retain their purpose after saving", () => {
  const drafts = Object.keys(FORMATS).map((format) =>
    createBlankTemplateDesign(
      "  My new template  ",
      format as keyof typeof FORMATS,
    ),
  );
  for (const draft of drafts) {
    assert.equal(draft.name, "My new template");
    assert.equal(draft.purpose, "template");
    assert.equal(draft.templateId, "blank-template");
    assert.equal(draft.editingTemplateId, undefined);
    assert.equal(draft.caption, "");
    assert.equal(draft.pages.length, 1);
    assert.equal(draft.pages[0].image.url, "/template-editor/folds.svg");
    assert.deepEqual(draft.pages[0].style, {
      template: "text",
      heading: "",
      body: "",
      bgMode: "color",
      bgColor: "#f3efe6",
      textColor: "#263e35",
      font: "geist",
      align: "center",
      textAlign: "left",
    });
  }
  assert.equal(new Set(drafts.map((d) => d.id)).size, drafts.length);
  assert.equal(new Set(drafts.map((d) => d.pages[0].id)).size, drafts.length);
  assert.equal(
    new Set(drafts.map((d) => d.pages[0].image.id)).size,
    drafts.length,
  );
  const input: EditorLibrary = { ...EMPTY_LIBRARY, designs: drafts };
  assert.deepEqual(parseLibrary(JSON.stringify(input)), input);
  assert.equal(
    createBlankTemplateDesign("   ", "portrait").name,
    "Untitled template",
  );
});

test("editing a saved template creates an independent persisted draft", () => {
  const template = designAsTemplate(
    createDesign(BUILT_IN_TEMPLATES[0]),
    "My series",
  );
  const original = structuredClone(template);
  const draft = editTemplateDesign(template);
  const anotherDraft = editTemplateDesign(template);
  assert.equal(draft.purpose, "template");
  assert.equal(draft.editingTemplateId, template.id);
  assert.equal(draft.templateId, template.id);
  assert.equal(draft.format, template.format);
  assert.equal(draft.name, template.name);
  assert.notEqual(draft.id, anotherDraft.id);
  for (const [index, page] of draft.pages.entries()) {
    assert.notEqual(page.id, template.pages[index].id);
    assert.notEqual(page.image.id, template.pages[index].image.id);
    assert.deepEqual(page.style, template.pages[index].style);
  }
  draft.pages[0].style.heading = "Only the draft changes";
  draft.pages[0].image.url = "/another-image.png";
  draft.pages.push(duplicatePage(draft.pages[0]));
  assert.deepEqual(template, original);
  assert.deepEqual(anotherDraft.pages[0].style, original.pages[0].style);
  const input: EditorLibrary = {
    ...EMPTY_LIBRARY,
    designs: [draft],
    templates: [template],
  };
  assert.deepEqual(parseLibrary(JSON.stringify(input)), input);
});

test("using or copying a template produces an ordinary design without an editing target", () => {
  const blank = createBlankTemplateDesign("My template", "square");
  const template = designAsTemplate(blank, blank.name);
  const editingDraft = editTemplateDesign(template);
  const designs = [
    createDesign(template),
    cloneDesign(blank),
    cloneDesign(editingDraft),
  ];
  for (const design of designs) {
    assert.equal(Object.hasOwn(design, "purpose"), false);
    assert.equal(Object.hasOwn(design, "editingTemplateId"), false);
    assert.equal(design.format, "square");
    assert.equal(design.pages[0].style.template, "text");
  }
  assert.equal(editingDraft.purpose, "template");
  assert.equal(editingDraft.editingTemplateId, template.id);
  const input: EditorLibrary = { ...EMPTY_LIBRARY, designs };
  assert.deepEqual(parseLibrary(JSON.stringify(input)), input);
});

test("imported template draft metadata is validated without changing legacy designs", () => {
  const input = library();
  const draft = createBlankTemplateDesign("Manual template", "portrait");
  for (const purpose of ["design", "", null, true, {}]) {
    assert.equal(
      parseLibrary({ ...input, designs: [{ ...draft, purpose }] }),
      null,
    );
  }
  for (const editingTemplateId of ["", "../other", "a b", null, 123, {}]) {
    assert.equal(
      parseLibrary({ ...input, designs: [{ ...draft, editingTemplateId }] }),
      null,
    );
  }
  assert.equal(
    parseLibrary({
      ...input,
      designs: [{ ...input.designs[0], editingTemplateId: "some-template" }],
    }),
    null,
  );
  assert.ok(
    parseLibrary({
      ...input,
      designs: [{ ...draft, editingTemplateId: "some-template" }],
    }),
  );
  assert.deepEqual(parseLibrary(input), input);
});

function canvasLibrary(elements: CanvasElement[]): EditorLibrary {
  const input = library();
  input.designs[0].pages[0].canvas = { background: "#f3efe6", elements };
  return input;
}

test("empty designs and empty template drafts persist genuinely empty scenes", () => {
  const design = createBlankDesign("  A blank post  ", "story");
  const draft = createBlankTemplateDesign("My blank template", "square");
  assert.equal(design.name, "A blank post");
  assert.equal(design.templateId, "blank-design");
  assert.equal(Object.hasOwn(design, "purpose"), false);
  assert.equal(draft.purpose, "template");
  assert.deepEqual(design.pages[0].canvas, {
    background: DEFAULT_BRAND.background,
    elements: [],
  });
  assert.deepEqual(draft.pages[0].canvas, design.pages[0].canvas);
  assert.notEqual(draft.pages[0].canvas, design.pages[0].canvas);
  assert.equal(createBlankDesign(" ", "portrait").name, "Untitled design");
  const input: EditorLibrary = { ...EMPTY_LIBRARY, designs: [design, draft] };
  assert.deepEqual(parseLibrary(JSON.stringify(input)), input);
});

test("independent text, image and shape layers retain stacking, transforms and styling", () => {
  const elements = [
    createCanvasElement("shape", {
      name: "Accent",
      shape: "ellipse",
      fill: "#ffee99",
      stroke: "#336633",
      strokeWidth: 2,
      rotation: -35,
      radius: 24,
    }),
    createCanvasElement("image", {
      name: "Product",
      src: "/template-editor/sculpture.svg",
      fit: "contain",
      cropX: 21,
      cropY: 78,
      radius: 18,
      opacity: 0.8,
      width: 120,
      height: 180,
    }),
    createCanvasElement("text", {
      name: "Title",
      text: "A title\nwith another line",
      font: "dmserif",
      fontSize: 36,
      fontWeight: 500,
      italic: true,
      underline: true,
      align: "center",
      color: "#123456",
      lineHeight: 1.4,
      letterSpacing: 2.5,
      x: -20,
      y: 260,
      rotation: 15,
      locked: true,
    }),
    createCanvasElement("text", {
      name: "Body",
      text: "An independent caption",
      fontSize: 14,
      y: 360,
    }),
  ];
  const input = canvasLibrary(elements);
  const parsed = parseLibrary(JSON.stringify(input))!;
  assert.deepEqual(parsed, input);
  assert.deepEqual(
    parsed.designs[0].pages[0].canvas!.elements.map((element) => element.name),
    ["Accent", "Product", "Title", "Body"],
  );
  assert.equal(
    new Set(elements.map((element) => element.id)).size,
    elements.length,
  );
  parsed.designs[0].pages[0].canvas!.elements[0].x = 200;
  assert.notEqual(
    parsed.designs[0].pages[0].canvas!.elements[0].x,
    elements[0].x,
  );
});

test("optional layer visibility preserves true, false and legacy absence in saved scenes", () => {
  const elements = [
    createCanvasElement("text", { hidden: true }),
    createCanvasElement("image", { hidden: false }),
    createCanvasElement("shape"),
  ];
  const input = canvasLibrary(elements);
  const parsed = parseLibrary(JSON.stringify(input))!;
  assert.deepEqual(parsed, input);
  assert.equal(parsed.designs[0].pages[0].canvas!.elements[0].hidden, true);
  assert.equal(parsed.designs[0].pages[0].canvas!.elements[1].hidden, false);
  assert.equal("hidden" in parsed.designs[0].pages[0].canvas!.elements[2], false);
  for (const hidden of [null, "false", "true", 0, 1, {}, []]) {
    const malformed = canvasLibrary([createCanvasElement("shape")]);
    Object.assign(malformed.designs[0].pages[0].canvas!.elements[0], { hidden });
    assert.equal(parseLibrary(malformed), null, String(hidden));
  }
});

test("all design and template copy paths isolate canvas layers and regenerate their identities", () => {
  const design = createBlankDesign("Layered original", "portrait");
  const originalScene: CanvasScene = {
    background: "#aabbcc",
    elements: [
      createCanvasElement("text", { text: "Keep this", hidden: true }),
      createCanvasElement("image", { hidden: false }),
      createCanvasElement("shape"),
    ],
  };
  design.pages[0].canvas = originalScene;
  const template = designAsTemplate(design, "Reusable layers");
  const copies = [
    duplicatePage(design.pages[0]),
    cloneDesign(design).pages[0],
    template.pages[0],
    createDesign(template).pages[0],
    editTemplateDesign(template).pages[0],
  ];
  const ids = new Set(originalScene.elements.map((element) => element.id));
  for (const page of copies) {
    const scene = page.canvas!;
    assert.notEqual(scene, originalScene);
    assert.notEqual(scene.elements, originalScene.elements);
    assert.equal(scene.background, "#aabbcc");
    for (const [index, element] of scene.elements.entries()) {
      assert.equal(ids.has(element.id), false);
      ids.add(element.id);
      assert.notEqual(element, originalScene.elements[index]);
      assert.equal(element.hidden, originalScene.elements[index].hidden);
      assert.equal("hidden" in element, "hidden" in originalScene.elements[index]);
      element.x = 300;
      element.hidden = !element.hidden;
    }
    scene.background = "#000000";
  }
  assert.equal(originalScene.background, "#aabbcc");
  assert.ok(originalScene.elements.every((element) => element.x === 36));
  assert.deepEqual(originalScene.elements.map(element => element.hidden), [true, false, undefined]);
});

test("continuous carousel scenes round-trip on designs and templates with at least two slides", () => {
  const input = canvasLibrary([]);
  const design = input.designs[0];
  design.pages.push(duplicatePage(design.pages[0]));
  design.continuousCanvas = {
    background: "#fff0",
    elements: [createCanvasElement("image", { x: 330, width: 200, cropX: 18, cropY: 70, hidden: true })],
  };
  input.templates = [designAsTemplate(design, "Continuous series")];
  assert.deepEqual(parseLibrary(JSON.stringify(input)), input);
  for (const target of ["designs", "templates"] as const) {
    const oneSlide = structuredClone(input);
    oneSlide[target][0].pages = oneSlide[target][0].pages.slice(0, 1);
    assert.equal(parseLibrary(oneSlide), null, `${target} requires two slides`);
    for (const invalidScene of [null, {}, { background: "#fff", elements: [] as unknown[], extra: true }]) {
      const malformed = structuredClone(input);
      Object.assign(malformed[target][0], { continuousCanvas: invalidScene });
      if (invalidScene && "background" in invalidScene) {
        const normalized = parseLibrary(malformed)!;
        assert.deepEqual(normalized[target][0].continuousCanvas, { background: "#fff", elements: [] });
      } else {
        assert.equal(parseLibrary(malformed), null);
      }
    }
    const overPages = structuredClone(input);
    while (overPages[target][0].pages.length <= 20) overPages[target][0].pages.push(duplicatePage(overPages[target][0].pages[0]));
    assert.equal(parseLibrary(overPages), null);
  }
});

test("continuous scenes enforce one global 100-layer cap and unique IDs", () => {
  const input = canvasLibrary([]);
  const design = input.designs[0];
  design.pages.push(duplicatePage(design.pages[0]));
  design.continuousCanvas = { background: "#fff", elements: Array.from({ length: 100 }, () => createCanvasElement("shape")) };
  assert.ok(parseLibrary(input));
  design.continuousCanvas.elements.push(createCanvasElement("text"));
  assert.equal(parseLibrary(input), null);
  design.continuousCanvas.elements.pop();
  design.continuousCanvas.elements[1].id = design.continuousCanvas.elements[0].id;
  assert.equal(parseLibrary(input), null);
});

test("continuous design copies, saved templates and template drafts get independent scene identities", () => {
  const original = createBlankDesign("Continuous original", "portrait");
  original.pages.push(duplicatePage(original.pages[0]));
  original.continuousCanvas = {
    background: "#aabbcc",
    elements: [
      createCanvasElement("text", { text: "Across\nslides", x: 350, hidden: true, letterSpacing: 3 }),
      createCanvasElement("image", { x: 400, cropX: 10, cropY: 90, hidden: false }),
    ],
  };
  const template = designAsTemplate(original, "Reusable continuous");
  const copies = [cloneDesign(original), template, createDesign(template), editTemplateDesign(template)];
  const ids = new Set(original.continuousCanvas.elements.map(element => element.id));
  for (const copy of copies) {
    const scene = copy.continuousCanvas!;
    assert.notEqual(scene, original.continuousCanvas);
    assert.notEqual(scene.elements, original.continuousCanvas.elements);
    assert.equal(scene.background, original.continuousCanvas.background);
    for (const [index, element] of scene.elements.entries()) {
      assert.equal(ids.has(element.id), false);
      ids.add(element.id);
      assert.deepEqual({ ...element, id: original.continuousCanvas.elements[index].id }, original.continuousCanvas.elements[index]);
      element.x += 100;
      element.hidden = !element.hidden;
    }
    scene.background = "#000";
  }
  assert.deepEqual(original.continuousCanvas.elements.map(element => element.x), [350, 400]);
  assert.deepEqual(original.continuousCanvas.elements.map(element => element.hidden), [true, false]);
  assert.equal(original.continuousCanvas.background, "#aabbcc");
});

test("legacy migration is deterministic, does not rewrite pages, and preserves built-in content", () => {
  for (const template of BUILT_IN_TEMPLATES) {
    const design = createDesign(template);
    const original = structuredClone(design);
    for (const page of design.pages) {
      const scene = sceneForPage(page, design.format);
      assert.deepEqual(sceneForPage(page, design.format), scene);
      assert.equal(page.canvas, undefined);
      const text = scene.elements
        .filter((element) => element.type === "text")
        .map((element) => element.text);
      if (page.style.heading) assert.ok(text.includes(page.style.heading));
      if (page.style.body) assert.ok(text.includes(page.style.body));
      if (page.style.template !== "quote")
        assert.ok(
          scene.elements.some(
            (element) =>
              element.type === "image" && element.src === page.image.url,
          ),
        );
      const copied = duplicatePage(page);
      copied.canvas = scene;
      assert.ok(
        parseLibrary({
          ...EMPTY_LIBRARY,
          designs: [{ ...design, pages: [copied] }],
        }),
      );
    }
    assert.deepEqual(design, original);
  }
  const existing = createBlankDesign("Already migrated", "square").pages[0];
  existing.canvas!.elements.push(createCanvasElement("shape"));
  assert.equal(sceneForPage(existing, "square"), existing.canvas);
});

test("migration supports every legacy layout at each format without coupling text and media", () => {
  for (const format of ["portrait", "square", "story"] as const) {
    for (const layout of [
      "plain",
      "text",
      "overlay",
      "fullbleed",
      "quote",
      "stacked",
      "blur",
      "split",
      "masonry",
    ] as const) {
      const page = duplicatePage(BUILT_IN_TEMPLATES[0].pages[0]);
      page.style = {
        template: layout,
        heading: "Headline",
        body: "Body copy",
        font: "geist",
        textColor: "#fefefe",
        bgMode: "color",
        bgColor: "#303030",
        mediaInX: 20,
        mediaInY: -10,
        letterSpacing: 0.1,
      };
      const scene = sceneForPage(page, format);
      const texts = scene.elements.filter((element) => element.type === "text");
      assert.equal(
        texts.some((element) => element.text === "Headline"),
        layout !== "plain",
      );
      assert.equal(
        texts.some((element) => element.text === "Body copy"),
        layout !== "plain",
      );
      for (const text of texts)
        assert.equal(text.letterSpacing, text.fontSize * 0.1);
      const images = scene.elements.filter(
        (element) => element.type === "image",
      );
      assert.equal(images.length > 0, layout !== "text" && layout !== "quote");
      for (const image of images) {
        assert.equal(image.cropX, 30);
        assert.equal(image.cropY, 60);
      }
      assert.equal(scene.background, "#303030");
      assert.ok(
        parseLibrary({
          ...EMPTY_LIBRARY,
          designs: [
            {
              ...createDesign(BUILT_IN_TEMPLATES[0]),
              format,
              pages: [{ ...page, canvas: scene }],
            },
          ],
        }),
      );
    }
  }
});

test("scene parsing rejects malformed geometry and required fields instead of silently changing artwork", () => {
  for (const [field, values] of Object.entries({
    x: [NaN, Infinity, -10_001, 10_001, "0"],
    y: [-Infinity, -10_001, 10_001],
    width: [0, -1, 10_001, null],
    height: [0, -1, 10_001],
    rotation: [-3601, 3601, NaN],
    opacity: [-0.1, 1.1],
    locked: ["false", 0, null],
    fontSize: [0, 501],
    lineHeight: [0.4, 5.1],
    fontWeight: [0, 901],
    letterSpacing: [-21, 101, NaN],
    italic: [0, "false"],
    underline: [0, "false"],
    align: ["justify", null],
  })) {
    for (const value of values) {
      const input = canvasLibrary([createCanvasElement("text")]);
      Object.assign(input.designs[0].pages[0].canvas!.elements[0], {
        [field]: value,
      });
      assert.equal(parseLibrary(input), null, `${field}=${String(value)}`);
    }
  }
  for (const field of [
    "id",
    "name",
    "x",
    "height",
    "rotation",
    "opacity",
    "locked",
    "text",
    "font",
    "lineHeight",
  ]) {
    const input = canvasLibrary([createCanvasElement("text")]);
    Reflect.deleteProperty(
      input.designs[0].pages[0].canvas!.elements[0],
      field,
    );
    assert.equal(parseLibrary(input), null, `missing ${field}`);
  }
});

test("scenes enforce the layer cap, unique layer IDs and known element types", () => {
  const elements = Array.from({ length: 100 }, () =>
    createCanvasElement("shape"),
  );
  assert.ok(parseLibrary(canvasLibrary(elements)));
  assert.equal(
    parseLibrary(canvasLibrary([...elements, createCanvasElement("text")])),
    null,
  );
  assert.equal(
    parseLibrary(canvasLibrary([elements[0], { ...elements[0] }])),
    null,
  );
  const invalid = canvasLibrary([createCanvasElement("text")]);
  Object.assign(invalid.designs[0].pages[0].canvas!.elements[0], {
    type: "html",
  });
  assert.equal(parseLibrary(invalid), null);
  for (const canvas of [
    null,
    {},
    [],
    { background: "#fff", elements: "wrong" },
  ]) {
    const input = library();
    Object.assign(input.designs[0].pages[0], { canvas });
    assert.equal(parseLibrary(input), null);
  }
});

test("scene media and styling reject executable URLs, arbitrary CSS and invalid variant values", () => {
  for (const src of [
    "javascript:alert(1)",
    "blob:temporary",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,PHNjcmlwdD4=",
    "//example.com/track",
  ]) {
    assert.equal(
      parseLibrary(canvasLibrary([createCanvasElement("image", { src })])),
      null,
    );
  }
  for (const patch of [
    { fit: "fill" },
    { cropX: -1 },
    { cropY: 101 },
    { radius: -1 },
    { radius: 5001 },
  ]) {
    const input = canvasLibrary([createCanvasElement("image")]);
    Object.assign(input.designs[0].pages[0].canvas!.elements[0], patch);
    assert.equal(parseLibrary(input), null);
  }
  for (const patch of [
    { shape: "script" },
    { fill: "url(https://example.com)" },
    { stroke: "expression(alert(1))" },
    { strokeWidth: 201 },
    { radius: -1 },
  ]) {
    const input = canvasLibrary([createCanvasElement("shape")]);
    Object.assign(input.designs[0].pages[0].canvas!.elements[0], patch);
    assert.equal(parseLibrary(input), null);
  }
  for (const patch of [
    { font: "url(https://example.com)" },
    { color: "var(--tracking)" },
    { text: "x".repeat(20_001) },
  ]) {
    const input = canvasLibrary([createCanvasElement("text")]);
    Object.assign(input.designs[0].pages[0].canvas!.elements[0], patch);
    assert.equal(parseLibrary(input), null);
  }
  const background = canvasLibrary([]);
  background.designs[0].pages[0].canvas!.background =
    "url(https://example.com)";
  assert.equal(parseLibrary(background), null);
});

test("scene parser keeps text literal and removes unknown HTML and event handler fields", () => {
  const literal = '<img src="x" onerror="alert(1)">';
  const input = canvasLibrary([createCanvasElement("text", { text: literal })]);
  Object.assign(input.designs[0].pages[0].canvas!.elements[0], {
    html: literal,
    onClick: "alert(1)",
    constructor: { polluted: true },
  });
  const element = parseLibrary(input)!.designs[0].pages[0].canvas!.elements[0];
  assert.equal(element.type, "text");
  assert.equal(element.type === "text" && element.text, literal);
  assert.equal(Object.hasOwn(element, "html"), false);
  assert.equal(Object.hasOwn(element, "onClick"), false);
  assert.equal(Object.hasOwn(element, "constructor"), false);
});

test("format resizing preserves type, horizontal geometry and stacking, and round-trips normal scenes", () => {
  const scene: CanvasScene = {
    background: "#f3efe6",
    elements: [
      createCanvasElement("image", {
        x: 40,
        y: 70,
        width: 200,
        height: 150,
        rotation: 20,
      }),
      createCanvasElement("shape", { x: -12, y: 120, width: 90, height: 80 }),
      createCanvasElement("text", {
        x: 30,
        y: 200,
        height: 64,
        fontSize: 24,
        text: "Keep my type",
      }),
    ],
  };
  const original = structuredClone(scene);
  for (const from of ["portrait", "square", "story"] as const) {
    for (const to of ["portrait", "square", "story"] as const) {
      const resized = resizeCanvasScene(scene, from, to);
      const restored = resizeCanvasScene(resized, to, from);
      assert.equal(resized.background, scene.background);
      for (const [index, element] of resized.elements.entries()) {
        assert.equal(element.id, scene.elements[index].id);
        assert.equal(element.x, scene.elements[index].x);
        assert.equal(element.width, scene.elements[index].width);
        assert.equal(element.rotation, scene.elements[index].rotation);
        assert.notEqual(element, scene.elements[index]);
        assert.ok(
          Math.abs(restored.elements[index].y - scene.elements[index].y) < 1e-9,
        );
        assert.ok(
          Math.abs(
            restored.elements[index].height - scene.elements[index].height,
          ) < 1e-9,
        );
        if (element.type === "text") {
          assert.equal(element.height, 64);
          assert.equal(element.fontSize, 24);
        }
      }
      const input = canvasLibrary(resized.elements);
      input.designs[0].format = to;
      assert.ok(parseLibrary(input));
    }
  }
  assert.deepEqual(scene, original);
});

test("format resizing keeps tiny layers and extreme geometry within persistence bounds", () => {
  const tiny: CanvasScene = {
    background: "#fff",
    elements: [
      createCanvasElement("image", { height: 1 }),
      createCanvasElement("shape", { height: 1 }),
    ],
  };
  const smaller = resizeCanvasScene(tiny, "story", "square");
  assert.ok(smaller.elements.every((element) => element.height === 1));
  assert.ok(parseLibrary(canvasLibrary(smaller.elements)));
  const large: CanvasScene = {
    background: "#fff",
    elements: [
      createCanvasElement("image", { y: 10_000, height: 10_000 }),
      createCanvasElement("shape", { y: -10_000, height: 10_000 }),
      createCanvasElement("text", { y: 10_000, height: 10_000 }),
    ],
  };
  const larger = resizeCanvasScene(large, "square", "story");
  assert.deepEqual(
    larger.elements.map((element) => element.y),
    [10_000, -10_000, 10_000],
  );
  assert.ok(larger.elements.every((element) => element.height === 10_000));
  assert.ok(parseLibrary(canvasLibrary(larger.elements)));
});
