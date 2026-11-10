/* Run: node --test tests/template-editor-html-break.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const unit = { exports: {} };
  cache.set(filename, unit);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
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
const layer = load("lib/template-editor/html-layer.ts");
const agent = load("lib/template-editor/agent-decks.ts");
const smart = load("lib/template-editor/smart-text.ts");
const { breakHtmlLayer, engineFontId, htmlPiecesToLayers, readingOrderAfterBreak } = load("lib/template-editor/html-break.ts");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
/** 936 design px across 312 scene units: 3 design px to a unit, as on a 1080 px slide. */
const htmlElement = (extra = {}) => ({ ...model.createCanvasElement("html"), id: "chart", name: "AI vs Jobs chart", html: "<p>Hi</p>", x: 24, y: 111, width: 312, height: 306, designWidth: 936, ...extra });
const scene = (elements, groups) => ({ background: "#0b1014", elements, ...(groups ? { groups } : {}) });
const near = (actual, expected, label = "") => assert.ok(Math.abs(actual - expected) < 1e-3, `${label} ${actual} != ${expected}`);
const valid = (elements, groups) => assert.ok(model.parseCanvasScene(scene(elements, groups)), "the layers make a valid scene");

const style = (extra = {}) => ({ fontFamily: '"GF SF Pro Display", system-ui, sans-serif', font: "sfpro", fontSize: 24, fontWeight: 400, italic: false, underline: false, strikethrough: false, color: "#FFFFFF", letterSpacing: 0, ...extra });
const run = (text, extra = {}) => ({ ...style(extra), text });
const shape = (extra = {}) => ({ kind: "shape", name: "Tile", box: { x: 30, y: 60, width: 90, height: 30 }, rotation: 0, opacity: 1, ellipse: false, fill: "#1A242B", radius: 9, ...extra });
const image = (extra = {}) => ({ kind: "image", name: "Logo", box: { x: 0, y: 0, width: 60, height: 30 }, rotation: 0, opacity: 1, src: PNG, fit: "cover", positionX: 50, positionY: 50, radius: 0, ellipse: false, naturalWidth: 120, naturalHeight: 60, ...extra });
const text = (lines, extra = {}) => ({
  kind: "text", name: "Text", box: { x: 30, y: 60, width: 300, height: lines.length * 30 }, rotation: 0, opacity: 1, align: "left", lineHeight: 30, padding: 4, style: style(),
  lines: lines.map((runs, index) => ({ box: { x: 30, y: 63 + index * 30, width: 300, height: 24 }, runs })), ...extra,
});

test("pieces land in scene units: x + px * width / designWidth, and sizes scale the same way", () => {
  const element = htmlElement();
  const [tile] = htmlPiecesToLayers(element, [shape({ stroke: { color: "#FFFFFF0F", width: 2, align: "inside" } })]);
  assert.equal(tile.type, "shape");
  assert.equal(tile.shape, "rectangle");
  near(tile.x, 24 + 30 / 3, "x"); near(tile.y, 111 + 60 / 3, "y"); near(tile.width, 30, "width"); near(tile.height, 10, "height");
  near(tile.radius, 3, "radius"); near(tile.strokeWidth, 2 / 3, "stroke");
  assert.equal(tile.strokeAlign, "inside");
  assert.equal(tile.stroke, "#FFFFFF0F");
  assert.equal(tile.fill, "#1A242B");
  assert.equal(tile.rotation, 0);
  assert.notEqual(tile.id, element.id);
  // A pill can't round more than half its height.
  near(htmlPiecesToLayers(element, [shape({ radius: 999 })])[0].radius, 5, "radius of a pill");
  valid([tile]);
});

test("a rotated layer's pieces turn with it around the layer's centre, adding their own angle", () => {
  const element = htmlElement({ x: 0, y: 0, width: 100, height: 100, designWidth: 100, rotation: 90 });
  const [corner] = htmlPiecesToLayers(element, [shape({ box: { x: 0, y: 0, width: 10, height: 10 }, radius: 0 })]);
  near(corner.x, 90, "x"); near(corner.y, 0, "y"); near(corner.rotation, 90, "rotation");
  const [turned] = htmlPiecesToLayers(element, [shape({ box: { x: 45, y: 45, width: 10, height: 10 }, rotation: 15 })]);
  near(turned.x, 45, "the centre stays put"); near(turned.y, 45);
  near(turned.rotation, 105, "rotation adds up");
  const [skewed] = htmlPiecesToLayers({ ...element, rotation: -30 }, [shape({ box: { x: 90, y: 45, width: 10, height: 10 } })]);
  const radians = -30 * Math.PI / 180;
  near(skewed.x + 5, 50 + 45 * Math.cos(radians), "x at -30°"); near(skewed.y + 5, 50 + 45 * Math.sin(radians), "y at -30°");
});

test("opacity multiplies, blend modes and blur carry over, and hairlines stay hairlines", () => {
  const element = htmlElement({ opacity: 0.8, blur: 2 });
  const [faded] = htmlPiecesToLayers(element, [shape({ opacity: 0.5, blendMode: "multiply" })]);
  near(faded.opacity, 0.4, "opacity");
  assert.equal(faded.blendMode, "multiply");
  assert.equal(faded.blur, 2);
  assert.equal(htmlPiecesToLayers(element, [shape({ blendMode: "plus-lighter" })])[0].blendMode, undefined, "unknown blend modes are dropped");
  // At 2 design px a unit, a 1 px rule is half a unit tall; layers are at least one unit, so it's a path filling half of one.
  const [rule] = htmlPiecesToLayers(htmlElement({ designWidth: 624 }), [shape({ box: { x: 0, y: 99, width: 600, height: 1 }, radius: 0, fill: "#FFFFFF40" })]);
  assert.equal(rule.shape, "path");
  near(rule.height, 1, "height"); near(rule.y, 111 + 99.5 / 2 - 0.5, "centred on the rule"); near(rule.width, 300, "width");
  assert.equal(rule.path, "M0 25H100V75H0Z");
  // The browser paints a box on whole px, so one starting at 99.25 px is painted 2 px tall from 99.
  const [painted] = htmlPiecesToLayers(htmlElement(), [shape({ box: { x: 0, y: 99.25, width: 300, height: 1.5 }, radius: 0, fill: "#FFFFFF40" })]);
  near(painted.y, 111 + 100 / 3 - 0.5, "centred on the painted rule");
  assert.equal(painted.path, "M0 16.665H100V83.335H0Z");
  assert.equal(rule.viewBox, "0 0 100 100");
  valid([faded, rule]);
});

test("gradients, ellipses, dashed borders and shadows become shape properties", () => {
  const gradient = { type: "linear", angle: 90, stops: [{ color: "#00D98A", position: 0 }, { color: "#32FFBB", position: 100 }] };
  const [swatch, dot, dashed] = htmlPiecesToLayers(htmlElement(), [
    shape({ gradient, fill: "#00D98A", shadow: { color: "#00000080", offsetX: 0, offsetY: 6, blur: 12, spread: 0 } }),
    shape({ ellipse: true, box: { x: 0, y: 0, width: 60, height: 30 } }),
    shape({ fill: undefined, stroke: { color: "#FFFFFF", width: 3, align: "inside", dash: [9, 6] } }),
  ]);
  assert.deepEqual(swatch.gradient, gradient);
  assert.deepEqual(swatch.shadow, { color: "#00000080", offsetX: 0, offsetY: 2, blur: 4, spread: 0 });
  assert.equal(dot.shape, "ellipse");
  assert.equal(dot.radius, 0);
  assert.equal(dashed.fill, "transparent");
  assert.deepEqual(dashed.strokeDash, [3, 2]);
  valid([swatch, dot, dashed]);
});

test("images keep their source, fit, crop, corners and alt text", () => {
  const [logo, avatar] = htmlPiecesToLayers(htmlElement(), [
    image({ fit: "contain", positionX: 0, positionY: 100, radius: 6, alt: "OpenAI logo" }),
    image({ ellipse: true, src: `/api/template-editor/assets/${"a".repeat(64)}`, box: { x: 0, y: 0, width: 90, height: 60 } }),
  ]);
  assert.equal(logo.type, "image");
  assert.equal(logo.src, PNG);
  assert.equal(logo.fit, "contain");
  assert.deepEqual([logo.cropX, logo.cropY, logo.radius], [0, 100, 2]);
  assert.equal(logo.publicAlt, "OpenAI logo");
  assert.deepEqual([logo.intrinsicWidth, logo.intrinsicHeight], [120, 60]);
  assert.equal(avatar.mask, "ellipse");
  // An image layer only takes a source Engine can draw.
  assert.equal(htmlPiecesToLayers(htmlElement(), [image({ src: "data:image/png;base64,bm90IGEgcG5n" })]).length, 0);
  valid([logo, avatar]);
});

test("text keeps its lines, font, size, spacing and colour, with room so it doesn't wrap again", () => {
  const element = htmlElement();
  const label600 = { letterSpacing: -0.24, fontWeight: 600 };
  const piece = text([[run("US job openings", label600)], [run("since 2017", label600)]], { style: style(label600), align: "left" });
  const [label] = htmlPiecesToLayers(element, [piece]);
  assert.equal(label.type, "text");
  assert.equal(label.text, "US job openings\nsince 2017");
  assert.equal(label.richText, undefined, "one style needs no rich text");
  assert.equal(label.font, "sfpro");
  near(label.fontSize, 8, "font size"); near(label.letterSpacing, -0.08, "letter spacing");
  assert.equal(label.fontWeight, 600);
  near(label.lineHeight, 30 / 24, "line height");
  near(label.padding, 4 / 3, "padding");
  assert.equal(label.textMode, "auto-height");
  assert.equal(label.verticalAlign, "top");
  // The first line box starts at the piece's top; the box adds padding all round and spare width on the right.
  near(label.x, 24 + (30 - 4) / 3, "x"); near(label.y, 111 + (60 - 4) / 3, "y");
  near(label.height, (60 + 8) / 3, "height");
  assert.ok(label.width > (300 + 8) / 3, "spare width so no line wraps");
  // Centred and right-aligned text keeps its centre and right edge.
  const [centred] = htmlPiecesToLayers(element, [{ ...piece, align: "center" }]);
  near(centred.x + centred.width / 2, label.x + (300 + 8) / 6, "centre");
  const [right] = htmlPiecesToLayers(element, [{ ...piece, align: "right" }]);
  near(right.x + right.width, 24 + (30 + 300 + 4) / 3, "right edge");
  valid([label, centred, right]);
});

test("an upright layer's pieces land where the canvas paints them, and text sits on its baseline", () => {
  // The canvas paints an upright HTML layer from the nearest whole unit, and boxes on whole design px.
  const element = htmlElement({ x: 24.4, y: 111.131 });
  const [tile, logo] = htmlPiecesToLayers(element, [shape({ box: { x: 0.4, y: 100.19, width: 141, height: 141 } }), image({ box: { x: 39.48, y: 139.67, width: 62.03, height: 62.03 } })]);
  near(tile.x, 24, "x from the whole unit"); near(tile.y, 111 + 100 / 3, "y on a whole px"); near(tile.width, 47, "width");
  near(logo.x, 24 + 39 / 3, "image x"); near(logo.y, 111 + 140 / 3, "image y"); near(logo.width, 63 / 3, "image width");
  // A drawn SVG is already cut on whole units: it isn't snapped again.
  const [plot] = htmlPiecesToLayers(element, [image({ graphic: true, box: { x: 60, y: 60, width: 795, height: 822 } })]);
  near(plot.x, 24 + 20, "graphic x"); near(plot.y, 111 + 20, "graphic y"); near(plot.height, 274, "graphic height");
  // A turned layer is drawn as it is, so its pieces aren't moved.
  const [turned] = htmlPiecesToLayers({ ...element, rotation: 180 }, [shape({ box: { x: 0, y: 0, width: 936, height: 918 }, radius: 0 })]);
  near(turned.x, 24.4, "turned x"); near(turned.y, 111.131, "turned y");

  // A text layer draws its first baseline layerBaseline below its first line box's top: the layer's top
  // is the baseline (on a whole px), less that, less the padding.
  const piece = text([[run("AI labs", { fontSize: 34, fontWeight: 700 })], [run("Second line", { fontSize: 34, fontWeight: 700 })]], {
    style: style({ fontSize: 34, fontWeight: 700 }), lineHeight: 40.8, padding: 4.4, layerBaseline: 30,
  });
  piece.lines[0].baseline = 69.38; piece.lines[1].baseline = 110.18;
  const [heading] = htmlPiecesToLayers(element, [piece]);
  near(heading.y, 111 + (69 - 30 - 4.4) / 3, "top from the baseline");
  near(heading.fontSize, 34 / 3, "font size"); near(heading.lineHeight, 1.2, "line height");
  // The first line without runs or a baseline doesn't count: the next line's baseline, one line up.
  const blank = { ...piece, lines: [{ box: piece.lines[0].box, runs: [] }, piece.lines[1]] };
  near(htmlPiecesToLayers(element, [blank])[0].y, 111 + (110 - 40.8 - 30 - 4.4) / 3, "top from the second line");
  // Without layerBaseline (measured without sceneScale), the first line box's top is used.
  const { layerBaseline: _unused, ...plain } = piece;
  void _unused;
  near(htmlPiecesToLayers(element, [plain])[0].y, 111 + (60 - 4.4) / 3, "top from the line box");
  valid([tile, logo, plot, turned, heading]);
});

test("runs in another colour, weight, size, style or font become rich-text spans", () => {
  const [value] = htmlPiecesToLayers(htmlElement(), [text([[
    run("7,669 ", { fontSize: 30, fontWeight: 700 }),
    run("+96% & <up>", { fontSize: 24, fontWeight: 600, color: "#D9D9D9" }),
  ], [run("since 2017", { fontSize: 30, fontWeight: 700, italic: true, underline: true }), run(" mono", { fontSize: 30, fontWeight: 700, font: "plexmono", fontFamily: layer.HTML_FONT_STACKS.plexmono })]], { style: style({ fontSize: 30, fontWeight: 700 }) })]);
  assert.equal(value.text, "7,669 +96% & <up>\nsince 2017 mono");
  assert.equal(value.richText, '7,669 <span style="font-size: 8px; color: #D9D9D9; font-weight: 600">+96% &amp; &lt;up&gt;</span><br><span style="font-style: italic; text-decoration-line: underline">since 2017</span><span class="gf-font-plexmono"> mono</span>');
  assert.equal(model.sanitizeRichText(value.richText), value.richText);
  valid([value]);
});

test("line spacing a text layer can't take becomes one layer per line, each where its line was", () => {
  const piece = text([[run("Tight")], [run("lines")]], { lineHeight: 9.6, box: { x: 0, y: 0, width: 120, height: 19.2 } });
  const lines = htmlPiecesToLayers(htmlElement(), [piece]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => line.text), ["Tight", "lines"]);
  assert.equal(new Set(lines.map(line => line.id)).size, 2);
  for (const line of lines) near(line.lineHeight, 0.5, "the closest it can take");
  // Each line keeps its centre: the second sits one (tight) line lower.
  near(lines[1].y - lines[0].y, 9.6 / 3, "line pitch");
  valid(lines);
});

test("fonts map to Engine's font ids, inverting the HTML font stacks", () => {
  for (const [id, stack] of Object.entries(layer.HTML_FONT_STACKS)) {
    const mapped = engineFontId({ fontFamily: stack });
    assert.equal(layer.HTML_FONT_STACKS[mapped], stack, `${id} maps to a font with the same stack`);
  }
  assert.equal(engineFontId({ fontFamily: "anything", font: "kyoto" }), "kyoto", "the id measured in the page wins");
  assert.equal(engineFontId({ fontFamily: "anything", font: "comic" }), "geist", "an unknown id doesn't");
  assert.equal(engineFontId({ fontFamily: '"GF SF Pro Display", system-ui, sans-serif' }), "sfpro");
  assert.equal(engineFontId({ fontFamily: '"GF Bebas Neue Canva", "Bebas Neue", system-ui, sans-serif' }), "bebascanva");
  assert.equal(engineFontId({ fontFamily: '"Bebas Neue", system-ui' }), "bebas");
  assert.equal(engineFontId({ fontFamily: '"GF GT Walsheim Condensed", system-ui' }), "walsheimcond");
  assert.equal(engineFontId({ fontFamily: '"IBM Plex Mono", monospace' }), "plexmono");
  assert.equal(engineFontId({ fontFamily: "Inter, sans-serif" }), "inter");
  assert.equal(engineFontId({ fontFamily: "Georgia, serif" }), "serif");
  assert.equal(engineFontId({ fontFamily: "monospace" }), "plexmono");
  assert.equal(engineFontId({ fontFamily: '"Comic Sans MS"' }), "geist");
  for (const id of Object.keys(layer.HTML_FONT_STACKS)) valid(htmlPiecesToLayers(htmlElement(), [text([[run("Hi")]], { style: style({ font: id }) })]));
});

test("clips become clipBounds on an upright layer, and pieces outside the layer's own clip are left out", () => {
  const element = htmlElement();
  const [clipped] = htmlPiecesToLayers(element, [shape({ clip: { x: 0, y: 0, width: 60, height: 75 } })]);
  assert.deepEqual(clipped.clipBounds, { x: 24, y: 111, width: 20, height: 25 });
  assert.equal(htmlPiecesToLayers({ ...element, rotation: 10 }, [shape({ clip: { x: 0, y: 0, width: 60, height: 75 } })])[0].clipBounds, undefined, "a turned layer can't take an upright clip");
  const cropped = { ...element, clipBounds: { x: 0, y: 0, width: 40, height: 400 } };
  assert.deepEqual(htmlPiecesToLayers(cropped, [shape({ clip: { x: 0, y: 0, width: 60, height: 75 } })])[0].clipBounds, { x: 24, y: 111, width: 16, height: 25 }, "the layer's own crop clips too");
  assert.deepEqual(htmlPiecesToLayers(cropped, [shape()])[0].clipBounds, cropped.clipBounds);
  assert.equal(htmlPiecesToLayers({ ...element, clipBounds: { x: 300, y: 0, width: 10, height: 10 } }, [shape({ clip: { x: 0, y: 0, width: 60, height: 75 } })]).length, 0);
  valid([clipped]);
});

test("breaking swaps the HTML layer for its layers in one group, at the same place in the stack, and selects them", () => {
  const element = htmlElement({ groupId: "card" });
  const below = { ...model.createCanvasElement("shape"), id: "below" }, above = { ...model.createCanvasElement("text"), id: "above" };
  const before = scene([below, element, above], [{ id: "card", name: "Card" }]);
  const layers = htmlPiecesToLayers(element, [shape(), image(), text([[run("Hi")]])]);
  const { scene: after, selectedIds, limited } = breakHtmlLayer(before, element.id, layers);
  assert.equal(limited, false);
  assert.deepEqual(after.elements.map(item => item.id), ["below", ...layers.map(item => item.id), "above"]);
  assert.deepEqual(selectedIds, layers.map(item => item.id));
  const group = after.groups.find(item => item.id !== "card");
  assert.equal(group.name, "AI vs Jobs chart");
  assert.equal(group.parentId, "card", "inside the layer's own group");
  assert.ok(after.elements.slice(1, -1).every(item => item.groupId === group.id));
  assert.ok(!after.elements.some(item => item.id === element.id));
  assert.ok(model.parseCanvasScene(after), "the slide is still valid");
  assert.deepEqual(before.elements.map(item => item.id), ["below", "chart", "above"], "the scene it was given is unchanged");
  // Clashing ids are replaced; a hidden layer breaks into a hidden group.
  const clash = breakHtmlLayer(before, element.id, [{ ...layers[0], id: "above" }]);
  assert.notEqual(clash.selectedIds[0], "above");
  assert.equal(breakHtmlLayer(scene([{ ...element, groupId: undefined, hidden: true }]), element.id, layers).scene.groups.at(-1).hidden, true);
});

test("a layer in a template's flow leaves a layout space, so the copy above it stays put", () => {
  const metrics = (item, words = smart.smartWords(item)) => ({ size: 20, widths: words.map(word => word.text.length * 10), space: 5 });
  const laidOut = canvas => smart.layoutSmartScene(canvas, metrics).scene.elements;
  const template = model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4");
  const templatePage = template.pages.findIndex(page => page.canvas?.elements.some(item => item.slot === "media" && item.smartFlow?.media));
  const deck = agent.createAgentDeck({ name: "AI vs Jobs", templateId: "chatgptricks-3x4", slides: [{ templatePage }] });
  const frame = deck.pages[0].canvas.elements.find(item => item.slot === "media");
  const withHtml = agent.updateAgentDeck(deck, { operations: [{ op: "add_html", pageId: deck.pages[0].id, id: "jobs-chart", name: "Jobs chart", replaces: frame.id, html: "<p>Jobs</p>" }] });
  const canvas = withHtml.pages[0].canvas, chart = canvas.elements.find(item => item.id === "jobs-chart");
  const slot = (elements, name) => elements.find(item => item.slot === name);
  const top = slot(canvas.elements, "title").smartText.anchorTop;
  // Something that followed the chart by id follows the space instead.
  canvas.elements.push({ ...model.createCanvasElement("text", { text: "Note", x: 24, y: 430, width: 312, height: 20 }), id: "note", smartFlow: { after: chart.id, gap: 4, bottom: 470 } });
  const layers = htmlPiecesToLayers(chart, [shape(), text([[run("Jobs")]])]);
  const { scene: after } = breakHtmlLayer(canvas, chart.id, layers);
  const space = after.elements.find(item => item.name === "Layout space");
  assert.ok(space, "a layout space takes the layer's place");
  assert.equal(after.elements.indexOf(space), canvas.elements.indexOf(chart), "first in the group, where the layer was");
  assert.deepEqual(space.smartFlow, chart.smartFlow);
  assert.equal(space.layoutRole, "media");
  assert.equal(space.groupId, layers.length && after.elements.find(item => item.id === layers[0].id).groupId);
  assert.deepEqual([space.fill, space.stroke, space.strokeWidth], ["transparent", "transparent", 0]);
  assert.equal(space.leadsGroup, true, "the space leads the group");
  assert.equal(model.parseCanvasScene(after).elements.find(item => item.id === space.id).leadsGroup, true, "and keeps that when saved");
  assert.equal(model.parseCanvasScene({ ...after, elements: after.elements.map(item => item.id === space.id ? { ...item, leadsGroup: "yes" } : item) }), null);
  assert.equal(after.elements.find(item => item.id === "note").smartFlow.after, space.id);
  // When the body grows, the space moves down and the broken-out layers go with it, as the HTML layer did.
  const longer = elements => elements.map(item => item.slot === "body" ? { ...item, text: "A much longer body that wraps onto more lines than before, so what follows it has to move down the slide" } : item);
  const settled = laidOut(after), grown = laidOut({ ...after, elements: longer(settled) });
  const shift = id => grown.find(item => item.id === id).y - settled.find(item => item.id === id).y;
  const htmlSettled = laidOut(canvas), htmlGrown = laidOut({ ...canvas, elements: longer(htmlSettled) });
  const htmlShift = htmlGrown.find(item => item.id === chart.id).y - htmlSettled.find(item => item.id === chart.id).y;
  assert.ok(htmlShift > 5, "a longer body pushes the HTML layer down");
  close(shift(space.id), htmlShift, "the space moves as the HTML layer did");
  for (const piece of layers) close(shift(piece.id), htmlShift, `${piece.name} moves with it`);
  close(slot(laidOut(after), "title").y, top, "the title stays at the top");
  // Without the space, the empty frame's space would pull the copy down over the new layers.
  const bare = { ...after, elements: after.elements.filter(item => item.id !== space.id && item.id !== "note") };
  assert.ok(slot(laidOut(bare), "title").y > top + 10);
  assert.ok(model.parseCanvasScene(after));
  // A layer outside any flow gets no space.
  const plain = breakHtmlLayer(scene([htmlElement()]), "chart", htmlPiecesToLayers(htmlElement(), [shape()]));
  assert.equal(plain.scene.elements.length, 1);
});
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-3, `${label}: ${actual} != ${expected}`);

test("a page's reading order reads the new words and pictures where the HTML layer was", () => {
  const element = htmlElement();
  const layers = htmlPiecesToLayers(element, [shape(), image(), text([[run("Hi")]])]);
  const [, logo, words] = layers;
  assert.deepEqual(readingOrderAfterBreak(["title", "chart", "source"], "chart", layers), ["title", logo.id, words.id, "source"], "shapes aren't read");
  const order = ["title", "source"];
  assert.equal(readingOrderAfterBreak(order, "chart", layers), order, "a list without the layer stays as it is");
  assert.equal(readingOrderAfterBreak(undefined, "chart", layers), undefined, "a page in visual order stays so");
  assert.deepEqual(readingOrderAfterBreak(["chart", logo.id], "chart", layers), [words.id, logo.id], "no id is listed twice");
  const full = Array.from({ length: 199 }, (_, index) => `t${index}`);
  assert.deepEqual(readingOrderAfterBreak([...full, "chart"], "chart", layers), full, "past 200 ids, the layer just leaves the list");
});

test("locked, protected and missing layers, and slides at their limits, say why they can't break", () => {
  const element = htmlElement();
  const layers = htmlPiecesToLayers(element, [shape()]);
  const fails = (canvas, pattern, id = element.id, pieces = layers) => assert.throws(() => breakHtmlLayer(canvas, id, pieces), pattern);
  fails(scene([element]), /isn't on this slide/, "nope");
  fails(scene([{ ...model.createCanvasElement("text"), id: "chart" }]), /Only an HTML layer/);
  fails(scene([{ ...element, locked: true }]), /locked\. Unlock it/);
  fails(scene([{ ...element, groupId: "g" }], [{ id: "g", name: "Group", locked: true }]), /locked group/);
  fails(scene([{ ...element, protected: ["delete"] }]), /protected/);
  fails(scene([{ ...element, protected: ["content"] }]), /protected/);
  fails(scene([{ ...element, templateRole: "brand" }]), /protected/);
  fails(scene([element]), /nothing in this layer/, element.id, []);
  const crowd = Array.from({ length: 99 }, (_, index) => ({ ...model.createCanvasElement("shape"), id: `s${index}` }));
  fails(scene([...crowd, element]), /101 layers.*at most 100/, element.id, [...layers, ...htmlPiecesToLayers(element, [shape()])]);
  assert.equal(breakHtmlLayer(scene([...crowd, element]), element.id, layers).scene.elements.length, 100, "exactly 100 is fine");
  const groups = Array.from({ length: 100 }, (_, index) => ({ id: `g${index}`, name: "Group" }));
  fails(scene([element], groups), /100 groups/);
  // An unlocked layer with style or position protection can still break.
  assert.ok(breakHtmlLayer(scene([{ ...element, protected: ["style", "position"] }]), element.id, layers));
});

test("every layer made from a full set of pieces passes the scene's own validation", () => {
  const element = htmlElement({ rotation: 7, opacity: 0.9 });
  const pieces = [
    shape({ name: "Background", box: { x: 0, y: 0, width: 936, height: 918 }, radius: 0, fill: "#0B1014" }),
    shape({ gradient: { type: "radial", angle: 0, stops: [{ color: "#00D98A00", position: 0 }, { color: "#32FFBB", position: 100 }] } }),
    shape({ name: "Border", fill: "#FFFFFF", box: { x: 0, y: 0, width: 0.4, height: 400 }, radius: 0 }),
    image({ graphic: true, alt: "x".repeat(3000), naturalWidth: 0 }),
    text([[run("A"), run("B", { color: "#00D98A80" })], [], [run("C")]], { shadow: { color: "#000000", offsetX: 1, offsetY: 1, blur: 2, spread: 0 }, gradient: { type: "linear", angle: 45, stops: [{ color: "#FFFFFF", position: 0 }, { color: "#000000", position: 100 }] } }),
  ];
  const layers = htmlPiecesToLayers(element, pieces);
  assert.equal(layers.length, pieces.length);
  const multiline = layers.find(item => item.type === "text");
  assert.equal(multiline.text, "AB\n\nC", "an empty line stays");
  assert.equal(multiline.richText, 'A<span style="color: #00D98A80">B</span><br><br>C');
  const { scene: after } = breakHtmlLayer(scene([element]), element.id, layers);
  assert.ok(model.parseCanvasScene(after));
  for (const item of after.elements) assert.ok(model.parseCanvasScene(scene([{ ...item, groupId: undefined }])), `${item.name} is valid on its own`);
});
