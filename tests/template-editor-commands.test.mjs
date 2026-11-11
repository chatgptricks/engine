/* Run: node --test tests/template-editor-commands.test.mjs */
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
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const compiled = vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename });
  const unit = { exports: {} };
  compiled(name => Object.hasOwn(dependencies, name) ? dependencies[name] : requireModule(name), unit, unit.exports);
  return unit.exports;
}
const model = loadModule("lib/template-editor/model.ts");
const commands = loadModule("lib/template-editor/commands.ts", { "./model": model });
const { copySelection, duplicateSelection, pasteSelection, removeSelection, setSelectionLocked, reorderSelection, alignSelection } = commands;

function element(id, overrides = {}) {
  return { ...model.createCanvasElement("shape"), id, name: id, x: 20, y: 30, width: 60, height: 40, ...overrides };
}
function freeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === "object") freeze(child); });
  return Object.freeze(value);
}
const scene = (...elements) => freeze({ background: "#fff", elements });
const ids = value => value.elements.map(item => item.id);
function visualBox(item) {
  const radians = item.rotation * Math.PI / 180;
  const width = Math.abs(item.width * Math.cos(radians)) + Math.abs(item.height * Math.sin(radians));
  const height = Math.abs(item.width * Math.sin(radians)) + Math.abs(item.height * Math.cos(radians));
  return { left: item.x + (item.width - width) / 2, top: item.y + (item.height - height) / 2, width, height };
}
const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`);

test("copy snapshots retain stacking order, include locked layers, and detach source data", () => {
  const source = scene(element("a"), element("b", { locked: true }), element("c"));
  const copied = copySelection(source, ["b", "a", "a", "missing"]);
  assert.deepEqual(copied.map(item => item.id), ["a", "b"]);
  assert.equal(copied[1].locked, true);
  copied[0].x = 100;
  copied[1].name = "changed";
  assert.equal(source.elements[0].x, 20);
  assert.equal(source.elements[1].name, "b");
});

test("a copy of a layer that leads its group is free: only the original keeps its place in the layout", () => {
  const space = element("space", { groupId: "g", leadsGroup: true, slot: "media", smartFlow: { after: "body", gap: 8, bottom: 400 } });
  const piece = element("piece", { groupId: "g", x: 30 });
  const source = { background: "#ffffff", groups: [{ id: "g", name: "Chart" }], elements: [space, piece] };
  const duplicate = duplicateSelection(source, ["space", "piece"]);
  const copy = duplicate.scene.elements.slice(2).find(item => item.name.startsWith("space"));
  assert.ok(copy, "the space is copied");
  assert.deepEqual([copy.leadsGroup, copy.smartFlow, copy.slot], [undefined, undefined, undefined]);
  assert.deepEqual(duplicate.scene.elements[0], space, "the original still leads");
  const pasted = pasteSelection(source, copySelection(source, ["space"]));
  assert.equal(pasted.scene.elements.at(-1).leadsGroup, undefined);
});

test("duplicate skips locked layers, preserves selection geometry and assigns fresh IDs each time", () => {
  const source = scene(element("a", { x: 10 }), element("b", { locked: true }), element("c", { x: 100, rotation: 37 }));
  const duplicate = duplicateSelection(source, ["a", "b", "c"]);
  assert.equal(duplicate.scene.elements.length, 5);
  assert.equal(duplicate.limited, false);
  assert.equal(duplicate.selectedIds.length, 2);
  assert.deepEqual(duplicate.scene.elements.slice(0, 3), source.elements);
  const [first, second] = duplicate.scene.elements.slice(3);
  assert.equal(first.x, 22);
  assert.equal(second.x - first.x, 90);
  assert.equal(second.rotation, 37);
  assert.equal(first.name, "a copy");
  assert.equal(first.locked, false);
  const other = duplicateSelection(source, ["a", "c"]);
  assert.equal(new Set([...duplicate.selectedIds, ...other.selectedIds]).size, 4);
  assert.ok(duplicate.selectedIds.every(id => !ids(source).includes(id)));
});

test("paste at a point anchors rotated visual bounds and preserves relative offsets", () => {
  const clipboard = freeze([element("a", { x: 10, y: 30, rotation: 90, locked: true }), element("b", { x: 120, y: 80 })]);
  const pasted = pasteSelection(scene(), clipboard, { x: 200, y: 300 });
  const boxes = pasted.scene.elements.map(visualBox);
  almost(Math.min(...boxes.map(box => box.left)), 200);
  almost(Math.min(...boxes.map(box => box.top)), 300);
  almost(pasted.scene.elements[1].x - pasted.scene.elements[0].x, 110);
  almost(pasted.scene.elements[1].y - pasted.scene.elements[0].y, 50);
  assert.ok(pasted.scene.elements.every(item => !item.locked));
  assert.equal(clipboard[0].locked, true);
  assert.equal(clipboard[0].x, 10);
});

test("insertion clamps the whole translation rather than distorting relative offsets", () => {
  const source = scene(element("a", { x: 9990, y: -9999 }), element("b", { x: 9999, y: -9990 }));
  const copied = duplicateSelection(source, ["a", "b"]).scene.elements.slice(2);
  assert.equal(copied[1].x, 10000);
  assert.equal(copied[1].x - copied[0].x, 9);
  const pasted = pasteSelection(scene(), copySelection(source, ["a", "b"]), { x: -1e9, y: -1e9 }).scene.elements;
  assert.equal(Math.min(...pasted.map(item => item.x)), -10000);
  assert.equal(Math.min(...pasted.map(item => item.y)), -10000);
  assert.equal(pasted[1].x - pasted[0].x, 9);
  assert.equal(pasted[1].y - pasted[0].y, 9);
});

test("capacity truncation is explicit and never inserts more than 100 layers", () => {
  const source = scene(...Array.from({ length: 99 }, (_, index) => element(`item-${index}`)));
  const added = duplicateSelection(source, ["item-0", "item-1", "item-2"]);
  assert.equal(added.scene.elements.length, 100);
  assert.equal(added.selectedIds.length, 1);
  assert.equal(added.limited, true);
  const blocked = duplicateSelection(added.scene, ["item-0"]);
  assert.equal(blocked.scene, added.scene);
  assert.deepEqual(blocked.selectedIds, ["item-0"]);
  assert.equal(blocked.limited, true);
});

test("delete protects locked layers; lock and unlock alter only selected flags", () => {
  const source = scene(element("a"), element("b", { locked: true }), element("c"));
  const deleted = removeSelection(source, ["a", "b"]);
  assert.deepEqual(ids(deleted.scene), ["b", "c"]);
  assert.deepEqual(deleted.selectedIds, ["b"]);
  assert.equal(deleted.scene.elements[0], source.elements[1]);
  const locked = setSelectionLocked(source, ["a", "b"], true);
  assert.equal(locked.scene.elements[0].locked, true);
  assert.equal(locked.scene.elements[1], source.elements[1]);
  assert.equal(locked.scene.elements[2], source.elements[2]);
  const unlocked = setSelectionLocked(source, ["b"], false);
  assert.equal(unlocked.scene.elements[1].locked, false);
  assert.equal(source.elements[1].locked, true);
});

test("forward and backward move contiguous selected blocks one neighboring step", () => {
  const source = scene(..."abcdef".split("").map(id => element(id)));
  assert.deepEqual(ids(reorderSelection(source, ["b", "c", "e"], "forward").scene), ["a", "d", "b", "c", "f", "e"]);
  assert.deepEqual(ids(reorderSelection(source, ["b", "c", "e"], "backward").scene), ["b", "c", "a", "e", "d", "f"]);
  assert.deepEqual(ids(reorderSelection(source, ["b", "c", "e"], "front").scene), ["a", "d", "f", "b", "c", "e"]);
  assert.deepEqual(ids(reorderSelection(source, ["b", "c", "e"], "back").scene), ["b", "c", "e", "a", "d", "f"]);
});

test("all reorder modes preserve selected and stationary order across every selection", () => {
  const source = scene(..."abcdef".split("").map(id => element(id, { locked: id === "c" })));
  for (let mask = 0; mask < 64; mask++) {
    const selected = source.elements.filter((_, index) => mask & (1 << index)).map(item => item.id);
    const movable = selected.filter(id => id !== "c");
    for (const order of ["forward", "backward", "front", "back"]) {
      const reordered = reorderSelection(source, selected, order).scene;
      assert.deepEqual(ids(reordered).filter(id => movable.includes(id)), ids(source).filter(id => movable.includes(id)));
      assert.deepEqual(ids(reordered).filter(id => !movable.includes(id)), ids(source).filter(id => !movable.includes(id)));
      assert.equal(new Set(ids(reordered)).size, source.elements.length);
      for (const item of reordered.elements) assert.equal(item, source.elements.find(original => original.id === item.id));
    }
  }
});

test("page alignment uses rotated visible edges while protecting locked elements", () => {
  const source = scene(element("a", { rotation: 37 }), element("locked", { locked: true }));
  for (const alignment of ["left", "center", "right", "top", "middle", "bottom"]) {
    const aligned = alignSelection(source, ["a", "locked"], alignment, { width: 360, height: 450 }).scene;
    const box = visualBox(aligned.elements[0]);
    if (alignment === "left") almost(box.left, 0);
    if (alignment === "center") almost(box.left + box.width / 2, 180);
    if (alignment === "right") almost(box.left + box.width, 360);
    if (alignment === "top") almost(box.top, 0);
    if (alignment === "middle") almost(box.top + box.height / 2, 225);
    if (alignment === "bottom") almost(box.top + box.height, 450);
    assert.equal(aligned.elements[1], source.elements[1]);
    assert.equal(aligned.elements[0].rotation, 37);
  }
});

test("group alignment retains offsets; default alignment aligns each selected layer", () => {
  const source = scene(element("a", { x: 20, width: 20 }), element("b", { x: 100, width: 50 }));
  const group = alignSelection(source, ["a", "b"], "center", { width: 360, height: 450 }, "group").scene;
  almost(group.elements[1].x - group.elements[0].x, 80);
  almost((group.elements[0].x + group.elements[1].x + group.elements[1].width) / 2, 180);
  const individual = alignSelection(source, ["a", "b"], "center", { width: 360, height: 450 }).scene;
  individual.elements.forEach(item => almost(item.x + item.width / 2, 180));
});

test("empty, locked, already aligned and invalid-input commands retain scene identity", () => {
  const source = scene(element("a", { x: 0 }), element("locked", { locked: true }));
  assert.equal(duplicateSelection(source, ["locked"]).scene, source);
  assert.equal(removeSelection(source, ["locked", "missing"]).scene, source);
  assert.equal(reorderSelection(source, ["locked"], "front").scene, source);
  assert.equal(reorderSelection(source, ["a"], "back").scene, source);
  assert.equal(setSelectionLocked(source, ["locked"], true).scene, source);
  assert.equal(alignSelection(source, ["a"], "left", { width: 360, height: 450 }).scene, source);
  assert.equal(alignSelection(source, ["a"], "left", { width: NaN, height: 450 }).scene, source);
  assert.equal(pasteSelection(source, [], { x: 5, y: 5 }).scene, source);
  assert.equal(pasteSelection(source, [source.elements[0]], { x: Infinity, y: 5 }).scene, source);
});

test("template and background pictures can be deleted unless the person locked them", () => {
  const photo = model.createCanvasElement("image");
  const source = scene(
    { ...photo, id: "slot", name: "Photo", templateRole: "media", protected: ["position", "delete"] },
    { ...photo, id: "bg", name: "Background", templateRole: "brand", protected: ["content", "position", "style", "delete"] },
    element("framed", { imageFill: { src: "data:image/png;base64,AA==", fit: "cover", x: 0, y: 0, scale: 1 }, templateRole: "media", protected: ["delete"] }),
    { ...photo, id: "locked", name: "Locked", templateRole: "media", locked: true },
    element("logo-card", { templateRole: "brand", protected: ["delete"] }),
  );
  assert.deepEqual(ids(removeSelection(source, ["slot", "bg", "framed", "locked", "logo-card"]).scene), ["locked", "logo-card"]);
});

test("a photo spanning two slides is deleted whole", () => {
  const photo = model.createCanvasElement("image");
  const source = scene(
    { ...photo, id: "start", templateRole: "media", span: { id: "wide", part: "start" }, protected: ["delete"] },
    { ...photo, id: "end", span: { id: "wide", part: "end" }, protected: ["delete"] },
    element("keep"),
  );
  assert.deepEqual(ids(removeSelection(source, ["start"]).scene), ["keep"]);
});

test("the top and bottom fades can be moved and deleted, but not restyled", () => {
  const fixed = { templateRole: "brand", protected: ["content", "position", "style", "delete"] };
  const gradient = { type: "linear", angle: 180, stops: [{ color: "#0B1014", position: 0 }, { color: "#0B101400", position: 100 }] };
  const top = element("top", { name: "Top fade", gradient, ...fixed }), bottom = element("bottom", { name: "Bottom fade", ...fixed });
  const source = scene(top, bottom, element("rule", fixed));
  for (const fade of [top, bottom]) {
    assert.equal(commands.canEditElement(source, fade, "position"), true);
    assert.equal(commands.canEditElement(source, fade, "delete"), true);
    assert.equal(commands.canEditElement(source, fade, "style"), false);
  }
  assert.equal(commands.canEditElement(source, source.elements[2], "position"), false);
  assert.equal(commands.canEditElement(scene({ ...top, locked: true }), { ...top, locked: true }, "delete"), false);
  assert.deepEqual(ids(removeSelection(source, ["top"]).scene), ["bottom", "rule"]);
});

test("the template keeps a deleted picture or fade deleted and a moved fade where it was dropped", () => {
  const smartTemplate = loadModule("lib/template-editor/smart-template.ts", { "./model": model, "./commands": commands });
  const fixed = { templateRole: "brand", protected: ["content", "position", "style", "delete"] };
  const photo = { ...model.createCanvasElement("image"), id: "photo", templateRole: "media", protected: ["position", "delete"] };
  const fade = element("fade", { name: "Bottom fade", y: 300, ...fixed }), rule = element("rule", { name: "Hairline", ...fixed });
  const previous = scene(photo, fade, rule);
  const deleted = smartTemplate.constrainSmartTemplate(previous, scene(rule));
  assert.deepEqual(ids(deleted), ["rule"], "the photo and the fade stay deleted; the hairline is never missing");
  assert.deepEqual(ids(smartTemplate.constrainSmartTemplate(previous, scene(photo, fade))), ["photo", "fade", "rule"]);
  const moved = smartTemplate.constrainSmartTemplate(previous, scene(photo, { ...fade, y: 340, height: 60, fill: "#ff0000" }, rule));
  assert.equal(moved.elements[1].y, 340);
  assert.equal(moved.elements[1].height, 60);
  assert.equal(moved.elements[1].fill, fade.fill, "only its place changes");
});

test("the template keeps a headline size the person set, and drops it for Auto size", () => {
  const smartTemplate = loadModule("lib/template-editor/smart-template.ts", { "./model": model, "./commands": commands });
  const rule = { role: "cover", lines: 3, minFontSize: 12, maxFontSize: 48, maxHeight: 110 };
  const headline = { ...model.createCanvasElement("text", { text: "Stocks fell" }), id: "h", smartText: rule, protected: ["position", "style", "delete"] };
  const previous = scene(headline);
  const sized = smartTemplate.constrainSmartTemplate(previous, scene({ ...headline, smartText: { ...rule, fontSize: 30, maxHeight: 999 } }));
  assert.equal(sized.elements[0].smartText.fontSize, 30);
  assert.equal(sized.elements[0].smartText.maxHeight, 110, "the template's own limits stay");
  assert.equal(smartTemplate.constrainSmartTemplate(sized, scene({ ...headline, smartText: rule })).elements[0].smartText.fontSize, undefined);
});
