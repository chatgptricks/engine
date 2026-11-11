/* Run: node --test tests/template-editor-spanning-photos.test.mjs */
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
const geometry = loadModule("lib/template-editor/canvas-geometry.ts", { "./model": model });
const carousel = loadModule("lib/template-editor/continuous-carousel.ts", { "./model": model, "./canvas-geometry": geometry });
const htmlLayer = loadModule("lib/template-editor/html-layer.ts", { "./model": model });
const agent = loadModule("lib/template-editor/agent-decks.ts", { "./model": model, "./agent-video-layers": loadModule("lib/template-editor/agent-video-layers.ts", { "./model": model }), "./spanning-photos": spans, "./video-slides": loadModule("lib/template-editor/video-slides.ts", { "./model": model, "./spanning-photos": spans }), "./html-layer": htmlLayer, "./frames": loadModule("lib/template-editor/frames.ts", { "./model": model }) });
const commands = loadModule("lib/template-editor/commands.ts", { "./model": model });
const smartTemplate = loadModule("lib/template-editor/smart-template.ts", { "./model": model, "./commands": commands });
const { spanPhoto, setSeam, unlinkSpan, syncSpans, reconcileSpans, spanPairs, findSpan, seamOf, spanBlocker, withoutSpans, widePhotoGeometry } = spans;

const near = (actual, expected, message = "", tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${message} ${actual} != ${expected}`);
const photoUrl = "https://example.com/skyline.jpg";
const image = (id, extra = {}) => ({ ...model.createCanvasElement("image", { name: "Skyline", src: photoUrl, x: 40, y: 120, width: 200, height: 150, fit: "cover", cropX: 30, cropY: 50, radius: 0, intrinsicWidth: 1600, intrinsicHeight: 900, ...extra }), id });
const text = (id, extra = {}) => ({ ...model.createCanvasElement("text", { text: "A title", x: 24, y: 24, width: 312, height: 40, ...extra }), id });
function deck(...scenes) {
  const design = model.createBlankDesign("Spans", "portrait");
  const first = design.pages[0];
  design.pages = scenes.map((elements, index) => ({ ...structuredClone(first), id: `page-${index + 1}`, canvas: { background: "#0B1014", elements } }));
  return design;
}
const page = (design, index) => design.pages[index].canvas.elements;
const half = (design, index, part) => page(design, index).find(element => element.span?.part === part);
// The @chatgptricks Wide photo pair's pages, read from the template so pages added before it don't break these tests.
const [{ startPage: WIDE, endPage: WIDE_END }] = spanPairs(model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4"));
const checkPair = (design, startPage) => {
  const start = half(design, startPage, "start"), end = half(design, startPage + 1, "end");
  assert.ok(start && end, "both halves exist");
  assert.equal(start.span.id, end.span.id);
  near(end.x, start.x - 360, "the end half sits one page to the left");
  for (const key of ["y", "width", "height", "src", "cropX", "cropY", "fit", "rotation", "intrinsicWidth", "intrinsicHeight"]) assert.deepEqual(end[key], start[key], key);
  return { start, end };
};
const commit = (design, change) => syncSpans(design, change(structuredClone(design)));

test("span links an image across the seam in its own proportions and continues on a free next page", () => {
  const design = deck([text("title-1"), image("photo")], [text("title-2")]);
  const result = spanPhoto(design, "page-1", "photo");
  assert.equal(result.addedPage, false);
  assert.equal(result.design.pages.length, 2);
  const { start, end } = checkPair(result.design, 0);
  // The frame keeps its height and takes the photo's 16:9, centered on the seam, uncropped.
  near(start.height, 150); near(start.width, 150 * 16 / 9); near(seamOf(start), .5);
  near(start.y, 120); assert.equal(start.fit, "cover"); assert.equal(start.cropX, 50); assert.equal(start.cropScale, undefined);
  assert.equal(result.start.elementId, "photo"); assert.equal(result.end.pageId, "page-2"); assert.equal(result.end.elementId, end.id);
  // The second half sits under the next page's text.
  assert.deepEqual(page(result.design, 1).map(element => element.id), [end.id, "title-2"]);
  assert.ok(model.parseCanvasScene(result.design.pages[1].canvas), "span links survive validation");
  assert.deepEqual(model.parseCanvasScene(result.design.pages[0].canvas).elements.find(element => element.id === "photo").span, start.span);
});

test("span adds a slide when the next one has its own photo, or on the last slide", () => {
  const busy = deck([image("photo")], [image("other")]);
  const added = spanPhoto(busy, "page-1", "photo", .3);
  assert.equal(added.addedPage, true);
  assert.equal(added.design.pages.length, 3);
  assert.deepEqual(page(added.design, 2).map(element => element.id), ["other"]);
  const { start } = checkPair(added.design, 0);
  near(seamOf(start), .3);
  const last = spanPhoto(deck([text("title")], [image("photo")]), "page-2", "photo");
  assert.equal(last.design.pages.length, 3); assert.equal(last.addedPage, true);
  checkPair(last.design, 1);
  // A wide photo shrinks just enough for the seam: at most 360 on either side of it.
  const wide = spanPhoto(deck([image("photo", { height: 300, width: 300, intrinsicWidth: 3000, intrinsicHeight: 1000 })], []), "page-1", "photo", .3);
  const fitted = half(wide.design, 0, "start");
  near(fitted.width, 360 / .7); near(fitted.height, 360 / .7 / 3); near(seamOf(fitted), .3);
  assert.ok(fitted.x >= 0 && fitted.x + fitted.width <= 720 + 1e-9);
});

test("editing either half moves both, and the photo is never cropped at the outer edges", () => {
  const design = spanPhoto(deck([image("photo", { width: 500, height: 281.25 })], [text("title-2")]), "page-1", "photo").design;
  const endId = half(design, 1, "end").id;
  // Drag the end half on slide 2: the start half follows.
  let next = commit(design, draft => { const end = page(draft, 1).find(element => element.id === endId); end.x += 30; end.y += 10; end.cropX = 70; return draft; }).design;
  let pair = checkPair(next, 0);
  near(pair.start.y, half(design, 0, "start").y + 10); assert.equal(pair.start.cropX, 70);
  near(pair.end.x, half(design, 1, "end").x + 30);
  // Dragging past the right edge of slide 2 stops at that edge.
  next = commit(next, draft => { page(draft, 0).find(element => element.id === "photo").x = 300; return draft; }).design;
  pair = checkPair(next, 0);
  near(pair.start.x + pair.start.width, 720);
  // Effects and flips are shared; names and ids are each half's own.
  next = commit(next, draft => { Object.assign(page(draft, 0).find(element => element.id === "photo"), { flipX: true, opacity: .8, name: "Renamed" }); return draft; }).design;
  pair = checkPair(next, 0);
  assert.equal(pair.end.flipX, true); assert.equal(pair.end.opacity, .8); assert.equal(pair.end.name, "Skyline"); assert.equal(pair.end.id, endId);
  // It stays upright, so neither slide crops a corner.
  next = commit(next, draft => { page(draft, 1).find(element => element.id === endId).rotation = 12; return draft; }).design;
  pair = checkPair(next, 0);
  assert.equal(pair.start.rotation, 0); assert.equal(pair.end.rotation, 0);
  // An unrelated edit leaves both halves untouched.
  const untouched = commit(next, draft => { page(draft, 1).find(element => element.id === "title-2").text = "New"; return draft; });
  assert.equal(untouched.unlinked.length, 0);
  assert.deepEqual(half(untouched.design, 0, "start"), pair.start);
});

test("replacing the photo keeps the seam and height and takes the new photo's shape", () => {
  const design = spanPhoto(deck([image("photo")], []), "page-1", "photo", .4).design;
  const next = commit(design, draft => { Object.assign(half(draft, 1, "end"), { src: "https://example.com/square.jpg", intrinsicWidth: 1000, intrinsicHeight: 1000 }); return draft; }).design;
  const { start } = checkPair(next, 0);
  assert.equal(start.src, "https://example.com/square.jpg");
  near(start.width, 150); near(start.height, 150); near(seamOf(start), .4);
});

test("deleting a half deletes both; deleting or moving a slide unlinks them with a report", () => {
  const design = spanPhoto(deck([image("photo")], [text("title-2")], [text("title-3")]), "page-1", "photo").design;
  const removed = commit(design, draft => { draft.pages[1].canvas.elements = page(draft, 1).filter(element => !element.span); return draft; });
  assert.equal(page(removed.design, 0).some(element => element.id === "photo"), false);
  assert.deepEqual(removed.unlinked, []);
  const start = half(design, 0, "start"), end = half(design, 1, "end");
  // Delete slide 2: slide 1 keeps the half it shows, as an ordinary photo.
  const deleted = commit(design, draft => { draft.pages.splice(1, 1); return draft; });
  const kept = page(deleted.design, 0).find(element => element.id === "photo");
  assert.equal(kept.span, undefined); near(kept.x, start.x); near(kept.width, start.width);
  assert.deepEqual(deleted.unlinked, [0]);
  assert.equal(spans.describeSpanChange(deleted), "The photo on slide 1 no longer continues on a neighboring slide. It keeps the half it shows.");
  // Move slide 2 to the end: both halves unlink and stay where they are.
  const moved = commit(design, draft => { draft.pages.push(draft.pages.splice(1, 1)[0]); return draft; });
  assert.deepEqual(moved.unlinked.sort(), [0, 2]);
  assert.equal(spans.describeSpanChange(moved), "Slides 1 and 3 no longer share photos with a neighboring slide. Each keeps the half it shows.");
  assert.equal(spans.describeSpanChange(removed), undefined, "deleting the photo is no surprise");
  assert.equal(spanPairs(moved.design).length, 0);
  near(page(moved.design, 2).find(element => element.id === end.id).x, end.x);
  // Swapping the pair's order breaks it too: a start half only pairs with the slide after it.
  const swapped = commit(design, draft => { draft.pages.reverse(); return draft; });
  assert.equal(spanPairs(swapped.design).length, 0);
});

test("dragging the photo fully onto one slide stops it spanning", () => {
  const design = spanPhoto(deck([image("photo", { width: 120, height: 90 })], []), "page-1", "photo").design;
  const left = commit(design, draft => { half(draft, 0, "start").x = 20; return draft; });
  assert.equal(page(left.design, 1).length, 0, "the empty half is removed");
  assert.equal(page(left.design, 0)[0].span, undefined); assert.deepEqual(left.unlinked, []);
  // The editor says so, with Undo.
  assert.deepEqual(left.onePage, [0]);
  assert.equal(spans.describeSpanChange(left), "The photo is all on slide 1 now, so it no longer spans two slides.");
  const right = commit(design, draft => { half(draft, 1, "end").x = 100; return draft; });
  assert.equal(page(right.design, 0).length, 0);
  const moved = page(right.design, 1)[0];
  assert.equal(moved.span, undefined); near(moved.x, 100);
  assert.deepEqual(right.onePage, [1]);
  // Agents get the same result without a notice.
  const agentMove = structuredClone(design); half(agentMove, 0, "start").x = 20;
  assert.deepEqual(reconcileSpans(agentMove).onePage, []);
});

test("template photos stay in their frames, except a spanning photo, whose seam moves, and can be deleted", () => {
  const design = model.createDesign(model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4"));
  const { start, end } = checkPair(design, WIDE);
  const scene = design.pages[WIDE].canvas;
  assert.equal(commands.canEditElement(scene, start, "position"), true, "the Wide photo can move its seam");
  assert.equal(commands.canEditElement(scene, start, "delete"), true, "a template photo can be deleted");
  assert.equal(commands.canEditElement(design.pages[WIDE_END].canvas, end, "delete"), true);
  const media = design.pages[3].canvas.elements.find(element => element.templateRole === "media");
  assert.equal(commands.canEditElement(design.pages[3].canvas, media, "position"), false, "other template photos stay put");
  // The template constraint keeps a dragged half where it was dropped, and still restores other media.
  const dragged = { ...scene, elements: scene.elements.map(element => element.id === start.id ? { ...element, x: element.x - 40 } : element) };
  near(smartTemplate.constrainSmartTemplate(scene, dragged).elements.find(element => element.id === start.id).x, start.x - 40);
  const frame = design.pages[3].canvas;
  const nudged = { ...frame, elements: frame.elements.map(element => element.id === media.id ? { ...element, x: element.x + 10 } : element) };
  near(smartTemplate.constrainSmartTemplate(frame, nudged).elements.find(element => element.id === media.id).x, media.x);
  // Dragging the Wide photo moves the seam, refits it and keeps the titles level.
  const moved = syncSpans(design, { ...design, pages: design.pages.map((item, index) => index === WIDE ? { ...item, canvas: smartTemplate.constrainSmartTemplate(scene, dragged) } : item) }).design;
  const pair = checkPair(moved, WIDE);
  assert.ok(seamOf(pair.start) > .5, "more of the photo on the first slide");
  const title = index => moved.pages[index].canvas.elements.find(element => element.slot === "title");
  near(title(WIDE).y, title(WIDE_END).y);
});

test("duplicates, pastes and reused ids never make a third half", () => {
  const design = spanPhoto(deck([image("photo")], [text("title-2")]), "page-1", "photo").design;
  const copy = withoutSpans(model.duplicatePage(design.pages[1]));
  assert.ok(copy.canvas.elements.every(element => !element.span));
  // A pasted copy of a half on the same page is an ordinary photo; the pair stays.
  const pasted = commit(design, draft => { page(draft, 0).push({ ...structuredClone(half(draft, 0, "start")), id: "pasted", x: 50 }); return draft; });
  assert.equal(page(pasted.design, 0).find(element => element.id === "pasted").span, undefined);
  checkPair(pasted.design, 0); assert.deepEqual(pasted.unlinked, []);
  // Two pairs that share an id get their own ids.
  const twice = deck(...[0, 1].flatMap(() => [[image("a")], []]));
  let both = spanPhoto(twice, "page-1", "a").design;
  both = spanPhoto(both, "page-3", page(both, 2)[0].id).design;
  const id = half(both, 0, "start").span.id;
  for (const element of [half(both, 2, "start"), half(both, 3, "end")]) element.span.id = id;
  const settled = reconcileSpans(both).design;
  assert.equal(spanPairs(settled).length, 2);
  assert.notEqual(half(settled, 0, "start").span.id, half(settled, 2, "start").span.id);
  checkPair(settled, 0); checkPair(settled, 2);
});

test("the seam moves without cropping, shrinking only when needed, and unlinking keeps what each slide shows", () => {
  const design = spanPhoto(deck([image("photo", { width: 600, height: 337.5 })], []), "page-1", "photo").design;
  const base = half(design, 0, "start");
  near(base.width, 600);
  // 42%: the photo fits as it is.
  let moved = setSeam(design, "page-1", "photo", .42);
  let { start } = checkPair(moved, 0);
  near(seamOf(start), .42); near(start.width, 600);
  // 20%: 80% must fit on slide 2, so the photo shrinks around its center, keeping its shape.
  moved = setSeam(moved, "page-2", half(moved, 1, "end").id, .2, base);
  ({ start } = checkPair(moved, 0));
  near(start.width, 450); near(start.height, 450 * 9 / 16); near(seamOf(start), .2);
  near(start.x + start.width, 720, "the photo ends at the right edge of slide 2");
  near(start.y + start.height / 2, base.y + base.height / 2);
  // From the size the drag began with, going back to 50% restores it.
  near(half(setSeam(moved, "page-1", "photo", .5, base), 0, "start").width, 600);
  // The slider clamps to 10%-90%.
  near(seamOf(half(setSeam(design, "page-1", "photo", .02), 0, "start")), .1);
  const unlinked = unlinkSpan(design, "page-2", half(design, 1, "end").id);
  assert.equal(spanPairs(unlinked).length, 0);
  near(page(unlinked, 1)[0].x, half(design, 1, "end").x);
  assert.equal(findSpan(unlinked, "page-1", "photo"), undefined);
});

test("span explains when a photo can't span", () => {
  const twenty = deck(...Array.from({ length: 20 }, (_, index) => [image(`p${index}`)]));
  assert.match(spanBlocker(twenty, "page-1", "p0"), /20 slides/);
  assert.throws(() => spanPhoto(twenty, "page-1", "p0"), /20 slides/);
  assert.match(spanBlocker(deck([image("photo", { locked: true })]), "page-1", "photo"), /Unlock/);
  assert.equal(spanBlocker(deck([image("photo")]), "page-1", "photo"), undefined);
  assert.match(spanBlocker({ ...deck([image("photo")], []), continuousCanvas: { background: "#000", elements: [] } }, "page-1", "photo"), /continuous/);
});

test("continuous carousel joins the halves into one layer and splits them into linked halves again", () => {
  const design = spanPhoto(deck([image("photo")], [text("title-2")]), "page-1", "photo").design;
  const start = half(design, 0, "start");
  const joined = carousel.enableContinuousCarousel(design);
  const images = joined.continuousCanvas.elements.filter(element => element.type === "image");
  assert.equal(images.length, 1, "one layer, not two overlapping halves");
  assert.equal(images[0].span, undefined); near(images[0].x, start.x);
  const split = carousel.splitContinuousCarousel(joined);
  const { start: again } = checkPair(split, 0);
  near(again.x, start.x); near(again.width, start.width);
  // A photo inside one slide stays an ordinary layer.
  const plain = carousel.splitContinuousCarousel(carousel.enableContinuousCarousel(deck([image("solo", { x: 20, width: 100 })], [])));
  assert.equal(spanPairs(plain).length, 0);
  // So does one hanging off the strip's edge: linking would have to move it.
  const hanging = carousel.splitContinuousCarousel(carousel.enableContinuousCarousel(deck([image("edge", { x: -40, width: 500 })], [])));
  assert.equal(spanPairs(hanging).length, 0);
  near(page(hanging, 0)[0].x, -40);
  // A template slot stays with the start half after the round trip. Only the
  // Wide pages are joined: the whole template has more layers than a
  // continuous carousel takes.
  const template = model.createDesign(model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4"));
  template.pages = template.pages.slice(WIDE, WIDE_END + 1);
  const round = carousel.splitContinuousCarousel(carousel.enableContinuousCarousel(template));
  const wide = checkPair(round, 0);
  assert.equal(wide.start.slot, "wide-photo"); assert.equal(wide.end.slot, undefined); assert.equal(wide.end.templateRole, undefined);
});

test("Wide photo pages: one photo slot fills both, balanced and level", () => {
  const template = model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4");
  const labels = template.pages.map(item => item.label);
  assert.deepEqual(labels.slice(WIDE), ["Wide photo · start", "Wide photo · end"]);
  for (const item of template.pages.slice(WIDE)) assert.deepEqual(model.parseCanvasScene(item.canvas), item.canvas, item.label);
  const design = model.createDesign(template);
  // A fresh copy is already settled: nothing moves on the first edit.
  assert.equal(reconcileSpans(design).design, design);
  const { start, end } = checkPair(design, WIDE);
  near(start.height * 3, 916.88); near(start.width * 3, 916.88 * 16 / 9); near(seamOf(start), .5);
  near(start.y * 3, 335.12);
  const titles = [WIDE, WIDE_END].map(index => page(design, index).find(element => element.slot === "title"));
  near(titles[0].y * 3, 90); near(titles[1].y * 3, 90);
  assert.equal(end.slot, undefined, "the photo is filled once, on the first page");
  // A 3:1 panorama runs edge to edge at 2160 x 720 and the block moves down to stay balanced.
  const panorama = commit(design, draft => { Object.assign(half(draft, WIDE, "start"), { src: photoUrl, intrinsicWidth: 3000, intrinsicHeight: 1000 }); return draft; }).design;
  const wide = checkPair(panorama, WIDE).start;
  near(wide.width * 3, 2160); near(wide.height * 3, 720); near(wide.x, 0);
  const top = 90 + (1162 - (181.12 + 64 + 720)) / 2;
  for (const index of [WIDE, WIDE_END]) {
    near(page(panorama, index).find(element => element.slot === "title").y * 3, top, "titles level", 1e-6);
    near(page(panorama, index).find(element => element.slot === "body").y * 3, top + 85.72, "bodies level", 1e-6);
  }
  near(wide.y * 3, top + 245.12);
  // Moving the seam on an edge-to-edge photo shrinks it just enough, and the block rebalances.
  const moved = setSeam(panorama, panorama.pages[WIDE_END].id, half(panorama, WIDE_END, "end").id, .42);
  const shifted = checkPair(moved, WIDE).start;
  near(seamOf(shifted), .42); near(shifted.width, 360 / .58); near(shifted.x + shifted.width, 720);
  const geometry = widePhotoGeometry(shifted, .42, false);
  near(page(moved, WIDE_END).find(element => element.slot === "title").y, geometry.titleY);
  // Dragging the photo moves the seam (never past 10%-90%) and the photo stays as large as fits there.
  const dragged = commit(moved, draft => { const element = half(draft, WIDE, "start"); element.x = 340; element.y = 10; return draft; }).design;
  const after = checkPair(dragged, WIDE).start;
  near(seamOf(after), .1); near(after.width, 400); near(after.y, widePhotoGeometry(after, .1, false).y);
  const back = checkPair(commit(dragged, draft => { const element = half(draft, WIDE, "start"); element.x = 360 - element.width / 2; return draft; }).design, WIDE).start;
  near(seamOf(back), .5); near(back.width * 3, 2160, "dragging back to the middle restores the full width");
  // A resize keeps its smaller size, in the photo's own shape.
  const resized = checkPair(commit(panorama, draft => { const element = half(draft, WIDE, "start"); element.width = 480; element.height = 160; element.x = 120; return draft; }).design, WIDE).start;
  near(resized.width, 480); near(resized.height, 160); near(seamOf(resized), .5);
  near(page(commit(panorama, draft => { const element = half(draft, WIDE, "start"); element.width = 480; element.height = 160; element.x = 120; return draft; }).design, WIDE_END).find(element => element.slot === "title").y, widePhotoGeometry(resized, .5, false).titleY);
});

test("on @chatgptricks Text + Media pages, Span makes the Wide photo pair and keeps the copy", () => {
  const template = model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4");
  const design = model.createDesign(template);
  // Cover, Text + Media, List, ...: the List page has columns, so a new end page is added.
  const media = page(design, 1).find(element => element.slot === "media");
  Object.assign(media, { src: photoUrl, intrinsicWidth: 1500, intrinsicHeight: 1000, publicAlt: "Data center at dusk" });
  assert.match(spanBlocker(design, design.pages[0].id, page(design, 0).find(element => element.slot === "photo").id), /cover/);
  const result = spanPhoto(design, design.pages[1].id, media.id, .45);
  assert.equal(result.addedPage, true);
  assert.equal(result.design.pages.length, design.pages.length + 1);
  assert.deepEqual(result.design.pages.slice(1, 4).map(item => item.label), ["Wide photo · start", "Wide photo · end", "List"]);
  assert.equal(result.design.pages[1].id, design.pages[1].id, "the slide keeps its id");
  const { start } = checkPair(result.design, 1);
  assert.equal(start.src, photoUrl); assert.equal(start.publicAlt, "Data center at dusk"); near(seamOf(start), .45);
  near(start.width / start.height, 1.5);
  const textOf = (index, slot) => page(result.design, index).find(element => element.slot === slot)?.text;
  assert.equal(textOf(1, "title"), page(design, 1).find(element => element.slot === "title").text);
  assert.equal(textOf(2, "source"), page(design, 1).find(element => element.slot === "source").text);
  assert.equal(page(result.design, 1).some(element => element.slot === "source"), false, "one source line, on the second page");
  // A next page with only a title, body and source becomes the end page and keeps its copy.
  const pair = model.createDesign(template);
  pair.pages = [pair.pages[1], model.duplicatePage(pair.pages[1])];
  const second = page(pair, 1);
  second.find(element => element.slot === "title").text = "Second title";
  const reused = spanPhoto(pair, pair.pages[0].id, page(pair, 0).find(element => element.slot === "media").id);
  assert.equal(reused.addedPage, false); assert.equal(reused.design.pages.length, 2);
  assert.equal(reused.design.pages[1].id, pair.pages[1].id);
  assert.equal(page(reused.design, 1).find(element => element.slot === "title").text, "Second title");
});

const invalid = (fn, pathPart, pattern) => assert.throws(fn, error => error instanceof agent.AgentDeckValidationError && error.issues.some(issue => issue.path.includes(pathPart) && (!pattern || pattern.test(issue.message))));

test("agents fill the Wide photo pair once, with the photo's size and a seam", () => {
  const deck = agent.createAgentDeck({ name: "Where AI gets built", templateId: "chatgptricks-3x4", slides: [
    { templatePage: 0, slots: { "cover-headline": "THE BIGGEST DATA CENTER YET" } },
    { templatePage: WIDE, slots: { title: "Where AI gets built", body: "A campus the size of a town", "wide-photo": photoUrl }, photoSize: { width: 3000, height: 2000 }, seam: .42 },
    { templatePage: WIDE_END, slots: { title: "And what it costs", body: "Power for a million homes", source: "Source: the company" } },
    { templatePage: 3 },
  ] });
  const { start, end } = checkPair(deck, 1);
  assert.equal(start.src, photoUrl); assert.equal(end.src, photoUrl);
  near(start.width / start.height, 1.5); near(seamOf(start), .42); near(start.height * 3, 916.88);
  near(page(deck, 1).find(element => element.slot === "title").y, page(deck, 2).find(element => element.slot === "title").y, "titles level");
  assert.ok(model.parseLibrary(agent.editableDeckPackage(deck)));
  const view = agent.agentDeckView(deck);
  const viewed = view.slides[1].elements.find(element => element.id === start.id);
  assert.deepEqual(viewed.span, { id: start.span.id, part: "start", partnerPageId: deck.pages[2].id, seam: .42 });
  assert.equal(view.slides[2].elements.find(element => element.id === end.id).span.partnerPageId, deck.pages[1].id);
  // engine_list_templates marks the pair.
  const types = agent.agentCapabilities().templates.find(item => item.id === "chatgptricks-3x4").pageTypes;
  assert.deepEqual([types[WIDE].pair.part, types[WIDE].pair.with, types[WIDE_END].pair.part, types[WIDE_END].pair.with], ["start", WIDE_END, "end", WIDE]);
  assert.match(types[WIDE].pair.note, new RegExp(`page ${WIDE} then page ${WIDE_END}`));
});

test("agents get clear errors for a lone half, a second-half photo or a misplaced seam", () => {
  const base = { name: "Pair", templateId: "chatgptricks-3x4" };
  invalid(() => agent.createAgentDeck({ ...base, slides: [{ templatePage: WIDE }, { templatePage: 1 }] }), "$.slides[0].templatePage", new RegExp(`page ${WIDE} then page ${WIDE_END}`));
  invalid(() => agent.createAgentDeck({ ...base, slides: [{ templatePage: WIDE_END }, { templatePage: WIDE }] }), "$.slides[0].templatePage", /second half/);
  invalid(() => agent.createAgentDeck({ ...base, slides: [{ templatePage: WIDE }, { templatePage: WIDE_END, image: { src: photoUrl } }] }), "$.slides[1].image", /second half/);
  invalid(() => agent.createAgentDeck({ ...base, slides: [{ templatePage: 1, seam: .4 }] }), "$.slides[0].seam", /continues on the next page/);
  invalid(() => agent.createAgentDeck({ name: "Free", format: "square", slides: [{ layout: "blank", seam: .4 }] }), "$.slides[0].seam", /span/);
  // A pair used twice gets two independent photos.
  const twice = agent.createAgentDeck({ ...base, slides: [{ templatePage: WIDE, slots: { "wide-photo": photoUrl } }, { templatePage: WIDE_END }, { templatePage: WIDE, slots: { "wide-photo": "https://example.com/other.jpg" } }, { templatePage: WIDE_END }] });
  assert.equal(spanPairs(twice).length, 2);
  assert.notEqual(half(twice, 0, "start").span.id, half(twice, 2, "start").span.id);
  assert.equal(half(twice, 3, "end").src, "https://example.com/other.jpg");
});

test("agents span any image, and edits to either half reach both", () => {
  const photo = { id: "photo", type: "image", src: photoUrl, x: 300, y: 200, width: 800, height: 450 };
  let deck = agent.createAgentDeck({ id: "deck", name: "Free", format: "presentation", slides: [{ id: "a", layout: "blank", elements: [{ ...photo, span: "next", seam: .4 }] }, { id: "b", layout: "blank" }] });
  let pair = checkPair(deck, 0);
  near(seamOf(pair.start), .4); assert.equal(deck.pages.length, 2);
  const endId = pair.end.id;
  deck = agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "b", elementId: endId, properties: { cropX: 20, opacity: .5 } }] });
  pair = checkPair(deck, 0);
  assert.equal(pair.start.cropX, 20); assert.equal(pair.start.opacity, .5);
  deck = agent.updateAgentDeck(deck, { operations: [{ op: "span_photo", pageId: "b", elementId: endId, seam: .6 }] });
  near(seamOf(checkPair(deck, 0).start), .6);
  const unlinked = agent.updateAgentDeck(deck, { operations: [{ op: "unlink_span", pageId: "a", elementId: "photo" }] });
  assert.equal(spanPairs(unlinked).length, 0);
  invalid(() => agent.updateAgentDeck(unlinked, { operations: [{ op: "unlink_span", pageId: "a", elementId: "photo" }] }), "elementId", /doesn't continue/);
  const removed = agent.updateAgentDeck(deck, { operations: [{ op: "remove_element", pageId: "a", elementId: "photo" }] });
  assert.equal(removed.pages[1].canvas.elements.length, 0, "removing one half removes both");
  const moved = agent.updateAgentDeck(deck, { operations: [{ op: "add_slide", slide: { id: "c", layout: "blank" }, index: 1 }] });
  assert.equal(spanPairs(moved).length, 0, "a slide between the halves unlinks them");
  // add_element with span, and span_photo on a plain image; a busy next slide gets a new slide after this one.
  const plain = agent.createAgentDeck({ id: "plain", name: "Plain", format: "presentation", slides: [{ id: "a", layout: "blank", elements: [photo] }, { id: "b", layout: "blank", elements: [{ ...photo, id: "other" }] }] });
  const spanned = agent.updateAgentDeck(plain, { operations: [{ op: "span_photo", pageId: "a", elementId: "photo" }] });
  assert.equal(spanned.pages.length, 3); checkPair(spanned, 0);
  const added = agent.updateAgentDeck(plain, { operations: [{ op: "add_element", pageId: "b", element: { ...photo, id: "third", span: "next" } }] });
  assert.equal(added.pages.length, 3); checkPair(added, 1);
  invalid(() => agent.updateAgentDeck(plain, { operations: [{ op: "add_element", pageId: "a", element: { ...photo, id: "fourth", seam: .3 } }] }), "seam", /span/);
});
