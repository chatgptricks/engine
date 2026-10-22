import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url);

function loader({ isolatedHandlers = false, controlHooks } = {}) {
  const modules = new Map();
  function load(relative) {
    const filename = path.join(root, relative);
    if (modules.has(filename)) return modules.get(filename);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
    }).outputText;
    const unit = { exports: {} };
    modules.set(filename, unit.exports);
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => {
      if (name.endsWith(".css")) return {};
      if (controlHooks && name === "react" && relative === "components/template-editor/controls.tsx") return { ...React, ...controlHooks };
      // Handler tests exercise a single initial render, without simulating React lifecycle.
      // SSR assertions below always use real React hooks and rendering.
      if (isolatedHandlers && name === "react" && relative === "components/template-editor/element-inspector.tsx") {
        return { ...React, useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useEffect() {} };
      }
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (resolved) return load(path.relative(root, resolved));
      }
      return requireModule(name);
    }, unit, unit.exports);
    return unit.exports;
  }
  return load;
}

const load = loader();
const loadHandlers = loader({ isolatedHandlers: true });
const { createCanvasElement } = load("lib/template-editor/model.ts");
const { QuickToolbar } = load("components/template-editor/quick-toolbar.tsx");
const { ElementInspector } = load("components/template-editor/element-inspector.tsx");
const HandlerInspector = loadHandlers("components/template-editor/element-inspector.tsx").ElementInspector;

const text = extra => createCanvasElement("text", { id: "title", name: "Title", text: "Engine", ...extra });
const shape = extra => createCanvasElement("shape", { id: "shape", name: "Shape", ...extra });
const image = extra => createCanvasElement("image", { id: "photo", name: "Photo", ...extra });
const photo = { src: "https://images.example/photo.png", objectFit: "cover", cropX: 20, cropY: 70, cropScale: 2, publicAlt: "Visible landscape", directive: "Private image note", intrinsicWidth: 1600, intrinsicHeight: 1200 };
const sceneWith = (elements, groups) => ({ background: "#fff", elements, ...(groups ? { groups } : {}) });
const quickProps = scene => ({ scene, selectedIds: scene.elements.map(item => item.id), disabled: false, onChange() {}, onDuplicate() {}, onDelete() {}, onMore() {}, onAddText() {}, onUpload() {} });
const inspectorProps = scene => ({ scene, selectedIds: scene.elements.map(item => item.id), width: 360, height: 450, onChange() {}, onSelect() {} });

function nodes(node, predicate, disabled = false) {
  if (!node || typeof node !== "object") return [];
  const inheritedDisabled = disabled || Boolean(node.props?.disabled);
  return [
    ...(predicate(node) ? [{ node, disabled: inheritedDisabled }] : []),
    ...React.Children.toArray(node.props?.children).flatMap(child => nodes(child, predicate, inheritedDisabled)),
  ];
}
function control(tree, label) {
  const found = nodes(tree, node => node.props?.["aria-label"] === label || node.props?.label === label)[0];
  assert.ok(found, `Missing control: ${label}`);
  return found;
}
const quickMarkup = props => renderToStaticMarkup(React.createElement(QuickToolbar, props));
const inspectorMarkup = props => renderToStaticMarkup(React.createElement(ElementInspector, props));

// Preserve hook state across the actual numeric input's focus, input and blur handlers.
function numericInput(getProps) {
  const slots = [];
  let cursor = 0;
  const { NumberInput } = loader({ controlHooks: {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
  } })("components/template-editor/controls.tsx");
  const render = () => { cursor = 0; return NumberInput(getProps()); };
  return {
    get input() { return render(); },
    focus() { render().props.onFocus({}); },
    change(value) { render().props.onChange({ target: { value, valueAsNumber: value === "" ? NaN : Number(value) } }); },
    blur() { render().props.onBlur({}); },
  };
}

test("empty selection offers creation actions without exposing object formatting", () => {
  const scene = sceneWith([text()]);
  const called = [];
  const tree = QuickToolbar({ ...quickProps(scene), selectedIds: [], onAddText: () => called.push("text"), onUpload: () => called.push("upload"), onBackground: () => called.push("background"), onInspect: () => called.push("inspect") });
  control(tree, "Edit page background").node.props.onClick();
  const markup = quickMarkup({ ...quickProps(scene), selectedIds: [], onInspect() {} });
  assert.match(markup, /Select an element/);
  assert.match(markup, /Add text/);
  assert.match(markup, /Upload/);
  assert.doesNotMatch(markup, /Quick font|Quick photo fit|Quick shape fill/);
  assert.deepEqual(called, ["background"]);
});

test("selection-keyed toolbar controls have distinct sibling identities", () => {
  function verify(node) {
    if (!node || typeof node !== "object") return;
    const children = React.Children.toArray(node.props?.children).filter(React.isValidElement);
    const keys = children.map(child => child.key);
    assert.equal(new Set(keys).size, keys.length, `Duplicate sibling keys under ${typeof node.type === "string" ? node.type : "control"}`);
    children.forEach(verify);
  }
  for (const elements of [[text()], [text(), text({ id: "second" })], [shape()], [shape(), shape({ id: "second" })], [shape({ imageFill: photo })]]) {
    verify(QuickToolbar(quickProps(sceneWith(elements))));
  }
});

test("legacy selection navigation remains callable when contextual inspect is absent", () => {
  const scene = sceneWith([text()]);
  const called = [];
  const tree = QuickToolbar({ ...quickProps(scene), onEdit: () => called.push("edit"), onPosition: () => called.push("position") });
  control(tree, "Edit selection properties").node.props.onClick();
  control(tree, "Position selection").node.props.onClick();
  assert.deepEqual(called, ["edit", "position"]);
});

test("quick text styles change editable layers while preserving direct and inherited locks", () => {
  const editable = text({ id: "editable" });
  const locked = text({ id: "locked", locked: true });
  const inherited = text({ id: "inherited", groupId: "locked-group" });
  const protectedText = text({ id: "protected", protected: ["style"] });
  const scene = sceneWith([editable, locked, inherited, protectedText], [{ id: "locked-group", name: "Locked", locked: true }]);
  let changed;
  const tree = QuickToolbar({ ...quickProps(scene), onChange: next => { changed = next; } });
  control(tree, "Quick font").node.props.onChange({ target: { value: "inter" } });
  assert.equal(changed.elements[0].font, "inter");
  assert.equal(changed.elements[1], locked);
  assert.equal(changed.elements[2], inherited);
  assert.equal(changed.elements[3], protectedText);
});

test("quick fit changes photo content while keeping frame geometry and outline intact", () => {
  const frame = shape({ id: "frame", width: 250, height: 180, rotation: 15, stroke: "#12345680", strokeWidth: 4, strokeAlign: "outside", imageFill: photo });
  const locked = shape({ id: "locked", locked: true, imageFill: photo });
  const protectedFrame = shape({ id: "protected", protected: ["style"], imageFill: photo });
  const scene = sceneWith([frame, locked, protectedFrame]);
  let changed;
  const tree = QuickToolbar({ ...quickProps(scene), onChange: next => { changed = next; } });
  control(tree, "Quick photo fit").node.props.onChange({ target: { value: "contain" } });
  assert.deepEqual(changed.elements[0], { ...frame, imageFill: { ...photo, objectFit: "contain" } });
  assert.equal(changed.elements[1], locked);
  assert.equal(changed.elements[2], protectedFrame);
});

test("readonly handlers cannot modify typography or photo fit even when called directly", () => {
  let changes = 0;
  const textScene = sceneWith([text()]);
  const textTree = QuickToolbar({ ...quickProps(textScene), disabled: true, onChange: () => { changes++; } });
  const font = control(textTree, "Quick font");
  assert.equal(font.disabled, true);
  font.node.props.onChange({ target: { value: "inter" } });
  const photoScene = sceneWith([image()]);
  const photoTree = QuickToolbar({ ...quickProps(photoScene), disabled: true, onChange: () => { changes++; } });
  const fit = control(photoTree, "Quick photo fit");
  assert.equal(fit.disabled, true);
  fit.node.props.onChange({ target: { value: "contain" } });
  assert.equal(changes, 0);
});

test("quick output typography units preserve model scale and ignore invalid size values", () => {
  const scene = sceneWith([text({ fontSize: 20 })]);
  const changes = [];
  const tree = QuickToolbar({ ...quickProps(scene), outputScale: 4, onChange: next => changes.push(next) });
  const size = control(tree, "Quick font size").node;
  assert.equal(size.props.value, 80);
  for (const valueAsNumber of [NaN, 0, 2001]) size.props.onChange({ target: { valueAsNumber } });
  assert.equal(changes.length, 0);
  size.props.onChange({ target: { valueAsNumber: 100 } });
  assert.equal(changes[0].elements[0].fontSize, 25);
});

test("quick font size supports clearing and typing through incomplete values before committing a valid size", () => {
  let scene = sceneWith([text({ fontSize: 20 })]);
  const changes = [];
  const field = numericInput(() => control(QuickToolbar({ ...quickProps(scene), onChange: next => { changes.push(next); scene = next; } }), "Quick font size").node.props);
  assert.equal(field.input.props.value, 60);
  field.focus();
  field.change("");
  assert.equal(field.input.props.value, "");
  field.change("1");
  assert.equal(field.input.props.value, "1");
  assert.equal(scene.elements[0].fontSize, 20);
  field.change("12");
  assert.equal(field.input.props.value, "12");
  assert.equal(scene.elements[0].fontSize, 4);
  field.change("12.5");
  assert.equal(scene.elements[0].fontSize, 12.5 / 3);
  field.change("99999");
  assert.equal(field.input.props.value, "99999");
  assert.equal(changes.length, 2, "Out-of-range drafts must not change the artwork");
  field.blur();
  assert.equal(field.input.props.value, 12.5, "Blur restores the last accepted size");
  scene = sceneWith([text({ fontSize: 30 })]);
  assert.equal(field.input.props.value, 90, "Unfocused controls reflect external document changes");
});

test("mixed font sizes keep an unfinished draft and apply valid values to the selected text", () => {
  let scene = sceneWith([text({ id: "first", fontSize: 10 }), text({ id: "second", fontSize: 20 })]);
  const field = numericInput(() => control(QuickToolbar({ ...quickProps(scene), onChange: next => { scene = next; } }), "Quick font size").node.props);
  assert.equal(field.input.props.value, "");
  field.focus();
  field.change("2");
  assert.equal(field.input.props.value, "2");
  assert.deepEqual(scene.elements.map(item => item.fontSize), [10, 20]);
  field.change("24");
  field.blur();
  assert.equal(field.input.props.value, 24);
  assert.deepEqual(scene.elements.map(item => item.fontSize), [8, 8]);
});

test("numeric controls pass Escape to their drawer while retaining native undo and composition", () => {
  const { NumberField } = load("components/template-editor/controls.tsx");
  const tree = NumberField({ label: "Font size", value: 60, min: 3, onChange() {} });
  const field = numericInput(() => control(tree, "Font size").node.props);
  function press(key, isComposing = false) {
    let stopped = false, prevented = false, blurred = false;
    field.input.props.onKeyDown({ key, metaKey: true, nativeEvent: { isComposing }, defaultPrevented: false, currentTarget: { blur() { blurred = true; } }, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    return { stopped, prevented, blurred };
  }
  assert.deepEqual(press("Escape"), { stopped: false, prevented: false, blurred: false });
  assert.deepEqual(press("z"), { stopped: true, prevented: false, blurred: false });
  assert.deepEqual(press("Enter"), { stopped: true, prevented: false, blurred: true });
  assert.deepEqual(press("Enter", true), { stopped: true, prevented: false, blurred: false });
  assert.deepEqual(press("Escape", true), { stopped: true, prevented: false, blurred: false });
});

test("Inspector passes Escape and button undo to the editor without intercepting native text undo", () => {
  const tree = HandlerInspector(inspectorProps(sceneWith([text()])));
  function press({ key, editing = false, composing = false, metaKey = false, ctrlKey = false, shiftKey = false }) {
    let stopped = false, prevented = false;
    tree.props.onKeyDown({ key, metaKey, ctrlKey, shiftKey, altKey: false, defaultPrevented: false, nativeEvent: { isComposing: composing }, target: { closest() { return editing ? {} : null; } }, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    return { stopped, prevented };
  }
  for (const event of [{ key: "Escape" }, { key: "Escape", editing: true }, { key: "z", metaKey: true }, { key: "z", metaKey: true, shiftKey: true }, { key: "y", ctrlKey: true }]) {
    assert.deepEqual(press(event), { stopped: false, prevented: false });
  }
  for (const event of [{ key: "z", metaKey: true, editing: true }, { key: "a", editing: true }, { key: "Delete" }, { key: "Escape", composing: true }]) {
    assert.deepEqual(press(event), { stopped: true, prevented: false });
  }
});

test("all locked and style protected text shows disabled formatting controls", () => {
  for (const item of [text({ locked: true }), text({ protected: ["style"] }), text({ groupId: "locked-group" })]) {
    const scene = sceneWith([item], [{ id: "locked-group", name: "Locked", locked: true }]);
    const tree = QuickToolbar(quickProps(scene));
    assert.equal(control(tree, "Quick font").disabled, true);
    assert.equal(control(tree, "Quick bold").disabled, true);
  }
});

test("Inspector mutation guards reject protected style and position without changing artwork", () => {
  const item = text({ protected: ["style", "position"] });
  const scene = sceneWith([item]);
  const changes = [];
  const props = { ...inspectorProps(scene), onChange: next => changes.push(next) };
  control(HandlerInspector({ ...props, initialSection: "edit" }), "Font size").node.props.onChange(90);
  control(HandlerInspector({ ...props, initialSection: "position" }), "X").node.props.onChange(60);
  assert.equal(changes.length, 0);
});

function inspectorTabs(tree) {
  return nodes(tree, node => node.type === "button" && Boolean(node.props?.["data-section"]));
}
function activeInspectorSection(tree) {
  const active = inspectorTabs(tree).filter(({ node }) => node.props["aria-pressed"] === true);
  assert.equal(active.length, 1, "Exactly one valid inspector category must be active");
  return active[0].node.props["data-section"];
}

test("Inspector categories match text, standalone photo, shape and photo-frame selections", () => {
  const cases = [
    { elements: [text()], sections: ["edit", "position", "effects", "advanced"] },
    { elements: [image()], sections: ["photo", "position", "effects", "advanced"] },
    { elements: [shape()], sections: ["edit", "outline", "position", "effects", "advanced"] },
    { elements: [shape({ imageFill: photo })], sections: ["edit", "outline", "photo", "position", "effects", "advanced"] },
    { elements: [text(), shape(), image()], sections: ["edit", "outline", "photo", "position", "effects", "advanced"] },
  ];
  for (const { elements, sections } of cases) {
    const tree = HandlerInspector(inspectorProps(sceneWith(elements)));
    assert.deepEqual(inspectorTabs(tree).map(({ node }) => node.props["data-section"]), sections);
  }
  assert.equal(inspectorTabs(HandlerInspector({ ...inspectorProps(sceneWith([text()])), selectedIds: [] })).length, 0);
});

test("changing element type normalizes an unavailable category before rendering", () => {
  const cases = [
    { element: text(), requested: "outline", effective: "edit" },
    { element: shape(), requested: "photo", effective: "edit" },
    { element: image(), requested: "edit", effective: "photo" },
    { element: image(), requested: "outline", effective: "photo" },
    { element: shape({ imageFill: photo }), requested: "outline", effective: "outline" },
  ];
  for (const { element, requested, effective } of cases) {
    const props = { ...inspectorProps(sceneWith([element])), initialSection: requested };
    assert.equal(activeInspectorSection(HandlerInspector(props)), effective);
    const html = inspectorMarkup(props);
    assert.match(html, new RegExp(`data-section="${effective}"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-section="${effective}"`));
  }
});

test("Inspector category tabs navigate through their explicit controlled callback", () => {
  const scene = sceneWith([shape({ imageFill: photo })]);
  const requested = [];
  const tree = HandlerInspector({ ...inspectorProps(scene), onSectionChange: section => requested.push(section) });
  for (const { node, disabled } of inspectorTabs(tree)) {
    assert.equal(disabled, false);
    node.props.onClick();
  }
  assert.deepEqual(requested, ["edit", "outline", "photo", "position", "effects", "advanced"]);
});

test("Inspector shows only the requested category content", () => {
  const scene = sceneWith([text(), shape({ imageFill: photo })]);
  const props = inspectorProps(scene);
  const edit = HandlerInspector({ ...props, initialSection: "edit" });
  control(edit, "Font size");
  assert.equal(nodes(edit, node => node.props?.label === "X").length, 0);
  assert.equal(nodes(edit, node => node.props?.label === "Border width").length, 0);
  const position = HandlerInspector({ ...props, initialSection: "position" });
  control(position, "X");
  assert.equal(nodes(position, node => node.props?.label === "Font size").length, 0);
  const outline = HandlerInspector({ ...props, initialSection: "outline" });
  control(outline, "Border width");
  assert.equal(nodes(outline, node => node.props?.label === "Font size").length, 0);
  const photoTree = HandlerInspector({ ...props, initialSection: "photo" });
  control(photoTree, "Fill image frame");
  assert.equal(nodes(photoTree, node => node.props?.label === "Border width").length, 0);
});

test("Inspector keeps navigation usable for locked and readonly selections while formatting stays disabled", () => {
  for (const extra of [{ locked: true }, { protected: ["style", "position"] }, {}]) {
    const scene = sceneWith([text(extra)]);
    const props = { ...inspectorProps(scene), disabled: !extra.locked && !extra.protected };
    const tree = HandlerInspector(props);
    assert.equal(control(tree, "Font size").disabled, true);
    assert.equal(control(HandlerInspector({ ...props, initialSection: "position" }), "X").disabled, true);
    for (const { disabled } of inspectorTabs(tree)) assert.equal(disabled, false);
  }
});

test("contextual toolbar dispatches explicit categories and retains accessible active state", () => {
  const cases = [
    { element: text(), labels: ["Text properties", "Position selection", "Effects"], sections: ["edit", "position", "effects"] },
    { element: shape(), labels: ["Shape fill and geometry", "Shape outline", "Position selection", "Effects"], sections: ["edit", "outline", "position", "effects"] },
    { element: image(), labels: ["Photo properties", "Position selection", "Effects"], sections: ["photo", "position", "effects"] },
    { element: shape({ imageFill: photo }), labels: ["Shape fill and geometry", "Shape outline", "Photo properties", "Position selection", "Effects"], sections: ["edit", "outline", "photo", "position", "effects"] },
  ];
  for (const { element, labels, sections } of cases) {
    const scene = sceneWith([element]);
    const requested = [];
    const tree = QuickToolbar({ ...quickProps(scene), activeSection: "position", onInspect: section => requested.push(section), onEdit() { throw new Error("Legacy Edit must not replace contextual navigation"); } });
    for (const label of labels) {
      const { node, disabled } = control(tree, label);
      assert.equal(disabled, false);
      assert.equal(node.props.type, "button");
      assert.equal(node.props["aria-controls"], "te-editor-panel");
      let preserved = false;
      node.props.onMouseDown({ preventDefault() { preserved = true; } });
      assert.equal(preserved, true);
      node.props.onClick();
    }
    assert.deepEqual(requested, sections);
    assert.equal(control(tree, "Position selection").node.props["aria-pressed"], true);
    assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Edit selection properties").length, 0);
  }
});

test("photo-frame quick outline remains available and preserves the photo and crop", () => {
  const frame = shape({ imageFill: photo, stroke: "transparent", strokeWidth: 0, strokeAlign: "outside" });
  const scene = sceneWith([frame]);
  let changed;
  const tree = QuickToolbar({ ...quickProps(scene), onInspect() {}, onChange: next => { changed = next; } });
  control(tree, "Shape outline");
  control(tree, "Quick shape border").node.props.onChange({ type: "solid", color: "#abcdef" });
  assert.deepEqual(changed.elements[0], { ...frame, stroke: "#abcdef", strokeWidth: 1 });
  assert.equal(changed.elements[0].imageFill, frame.imageFill);
  assert.equal(nodes(tree, node => node.props?.label === "Quick shape fill").length, 0);
});

test("quick text paint routes selected-word solid color through the formatter and gradients to the layer", () => {
  const item = text({ richText: '<b>Engine</b>', textureFill: photo });
  const scene = sceneWith([item]);
  const formatted = [], changed = [];
  const tree = QuickToolbar({ ...quickProps(scene), onFormatText: patch => { formatted.push(patch); return true; }, onChange: next => changed.push(next) });
  const picker = control(tree, "Quick text color").node;
  picker.props.onChange({ type: "solid", color: "#123456" });
  assert.deepEqual(formatted, [{ color: "#123456", colorRoleId: undefined, textureFill: null }]);
  assert.equal(changed.length, 0);
  const gradient = { type: "linear", angle: 90, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 100 }] };
  picker.props.onChange({ type: "gradient", gradient });
  assert.equal(formatted.length, 1);
  assert.deepEqual(changed[0].elements[0].gradient, gradient);
  assert.equal(changed[0].elements[0].textureFill, undefined);
  assert.equal(changed[0].elements[0].richText, '<b>Engine</b>');
});

test("quick whole-layer solid paint removes old gradients and respects locked and protected layers", () => {
  const gradient = { type: "linear", angle: 90, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 100 }] };
  const editable = text({ gradient, richText: '<span style="color:#ff0000; font-weight:700">Engine</span>' });
  const locked = text({ id: "locked", locked: true, gradient });
  const protectedText = text({ id: "protected", protected: ["style"], gradient });
  const scene = sceneWith([editable, locked, protectedText]);
  let changed;
  const tree = QuickToolbar({ ...quickProps(scene), onFormatText: () => false, onChange: next => { changed = next; } });
  control(tree, "Quick text color").node.props.onChange({ type: "solid", color: "#123456" });
  assert.equal(changed.elements[0].gradient, undefined);
  assert.equal(changed.elements[0].color, "#123456");
  assert.equal(changed.elements[0].richText, '<span style="font-weight:700">Engine</span>');
  assert.equal(changed.elements[1], locked);
  assert.equal(changed.elements[2], protectedText);
});

test("readonly contextual navigation remains available while destructive actions are disabled", () => {
  const scene = sceneWith([shape({ imageFill: photo })]);
  const requested = [];
  const tree = QuickToolbar({ ...quickProps(scene), disabled: true, onInspect: section => requested.push(section) });
  for (const label of ["Shape fill and geometry", "Shape outline", "Photo properties", "Position selection", "Effects"]) {
    const { node, disabled } = control(tree, label);
    assert.equal(disabled, false);
    node.props.onClick();
  }
  assert.deepEqual(requested, ["edit", "outline", "photo", "position", "effects"]);
  assert.equal(control(tree, "Duplicate selection").disabled, true);
  assert.equal(control(tree, "Delete selection").disabled, true);
});

test("Unlock acts on a direct lock and explains an inherited group lock", () => {
  let unlocks = 0;
  const direct = sceneWith([text({ locked: true })]);
  const directTree = QuickToolbar({ ...quickProps(direct), onUnlock: () => { unlocks++; } });
  const directUnlock = nodes(directTree, node => node.type === "button" && node.props?.title === "Unlock selection")[0];
  assert.ok(directUnlock);
  assert.equal(directUnlock.disabled, false);
  directUnlock.node.props.onClick();
  assert.equal(unlocks, 1);
  const inherited = sceneWith([text({ groupId: "parent" })], [{ id: "parent", name: "Parent", locked: true }]);
  const inheritedTree = QuickToolbar({ ...quickProps(inherited), onUnlock: () => { unlocks++; } });
  const inheritedUnlock = nodes(inheritedTree, node => node.type === "button" && node.props?.title === "Unlock the parent group in Layers")[0];
  assert.ok(inheritedUnlock);
  assert.equal(inheritedUnlock.disabled, true);
});

test("Duplicate capacity counts the editable layers that the command will actually copy", () => {
  const editable = text({ id: "editable" });
  const locked = text({ id: "locked", locked: true });
  const padding = Array.from({ length: 97 }, (_, index) => shape({ id: `padding-${index}` }));
  const scene = sceneWith([editable, locked, ...padding]);
  const props = { ...quickProps(scene), selectedIds: [editable.id, locked.id] };
  assert.equal(control(QuickToolbar(props), "Duplicate selection").disabled, false);
  assert.equal(control(QuickToolbar({ ...props, scene: sceneWith([...scene.elements, shape({ id: "last" })]) }), "Duplicate selection").disabled, true);
});

test("content protection blocks texture and replacement actions without disabling permitted photo styling", () => {
  const textScene = sceneWith([text({ protected: ["content"] })]);
  const textTree = QuickToolbar({ ...quickProps(textScene), onTextTexture() {} });
  assert.equal(control(textTree, "Text texture").disabled, true);
  assert.equal(control(textTree, "Quick font").disabled, false);
  for (const item of [image({ protected: ["content"] }), shape({ protected: ["content"], imageFill: photo })]) {
    const scene = sceneWith([item]);
    const replacement = () => {};
    const tree = QuickToolbar({ ...quickProps(scene), onReplacePhoto: replacement });
    const replace = nodes(tree, node => node.type === "button" && node.props?.onClick === replacement)[0];
    assert.ok(replace);
    assert.equal(replace.disabled, true);
    assert.equal(control(tree, "Quick photo fit").disabled, false);
  }
});

test("Inspector public descriptions respect content protection independently of photo style", () => {
  const scene = sceneWith([image({ protected: ["content"] })]);
  const changes = [];
  const props = { ...inspectorProps(scene), onChange: next => changes.push(next) };
  const tree = HandlerInspector({ ...props, initialSection: "advanced" });
  const description = control(tree, "Public image description");
  assert.equal(description.disabled, true);
  description.node.props.onChange({ target: { value: "Replacement description" } });
  assert.equal(changes.length, 0);
  const fit = control(HandlerInspector({ ...props, initialSection: "photo" }), "Fit entire image");
  assert.equal(fit.disabled, false);
  fit.node.props.onClick();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].elements[0].fit, "contain");
  assert.equal(changes[0].elements[0].publicAlt, undefined);
});

test("mixed selection protection is evaluated for each relevant element type", () => {
  const textProtected = sceneWith([text({ protected: ["style"] }), shape()]);
  const textTree = HandlerInspector({ ...inspectorProps(textProtected), initialSection: "edit" });
  assert.equal(control(textTree, "Font size").disabled, true);
  assert.equal(control(textTree, "Fill").disabled, false);
  const shapeProtected = sceneWith([text(), shape({ protected: ["style"] })]);
  const shapeTree = HandlerInspector({ ...inspectorProps(shapeProtected), initialSection: "edit" });
  assert.equal(control(shapeTree, "Font size").disabled, false);
  assert.equal(control(shapeTree, "Fill").disabled, true);
  assert.equal(control(HandlerInspector({ ...inspectorProps(shapeProtected), initialSection: "outline" }), "Border width").disabled, true);
});

test("mixed locked selection keeps contextual categories aligned with the Inspector", () => {
  const scene = sceneWith([text(), shape({ locked: true })]);
  let openedTexture = 0;
  const tree = QuickToolbar({ ...quickProps(scene), onInspect() {}, onTextTexture: () => { openedTexture++; }, onMergeShapes() {} });
  control(tree, "Text properties");
  control(tree, "Quick font");
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Shape outline").length, 0);
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Merge shapes").length, 0);
  const texture = control(tree, "Text texture");
  assert.equal(texture.disabled, false);
  texture.node.props.onClick();
  assert.equal(openedTexture, 1);
  assert.match(quickMarkup({ ...quickProps(scene), onInspect() {} }), /2 selected/);
  assert.deepEqual(inspectorTabs(HandlerInspector(inspectorProps(scene))).map(({ node }) => node.props["data-section"]), ["edit", "position", "effects", "advanced"]);

  const otherScene = sceneWith([shape(), text({ locked: true })]);
  const otherTree = QuickToolbar({ ...quickProps(otherScene), onInspect() {}, onMergeShapes() {} });
  control(otherTree, "Shape fill and geometry");
  control(otherTree, "Shape outline");
  assert.equal(nodes(otherTree, node => node.props?.["aria-label"] === "Text properties").length, 0);
  assert.equal(nodes(otherTree, node => node.props?.["aria-label"] === "Merge shapes").length, 0);
});

test("Inspector outline color creates a visible border without replacing a photo or changing existing widths", () => {
  const frame = shape({ id: "frame", stroke: "transparent", strokeWidth: 0, strokeAlign: "outside", imageFill: photo });
  const existing = shape({ id: "existing", strokeWidth: 4, strokeAlign: "inside" });
  const protectedShape = shape({ id: "protected", protected: ["style"], strokeWidth: 0 });
  const scene = sceneWith([frame, existing, protectedShape]);
  let changed;
  const tree = HandlerInspector({ ...inspectorProps(scene), initialSection: "outline", onChange: next => { changed = next; } });
  control(tree, "Border color").node.props.onChange({ type: "solid", color: "#123456" });
  assert.deepEqual(changed.elements[0], { ...frame, stroke: "#123456", strokeWidth: 1 });
  assert.deepEqual(changed.elements[1], { ...existing, stroke: "#123456" });
  assert.equal(changed.elements[2], protectedShape);
  assert.equal(changed.elements[0].imageFill, frame.imageFill);
});

test("Inspector readonly and inherited locked selections preserve their scene", () => {
  for (const readonly of [true, false]) {
    const scene = sceneWith([text({ groupId: "locked-group" })], [{ id: "locked-group", name: "Locked", locked: !readonly }]);
    const changes = [];
    const props = { ...inspectorProps(scene), disabled: readonly, onChange: next => changes.push(next) };
    const tree = HandlerInspector(props);
    control(tree, "Font size").node.props.onChange(90);
    assert.equal(changes.length, 0);
    const html = inspectorMarkup(props);
    assert.match(html, /<fieldset disabled=""/);
  }
});
