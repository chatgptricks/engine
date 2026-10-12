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
const modules = new Map();
function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const unit = { exports: {} };
  modules.set(relative, unit.exports);
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

const { createCanvasElement } = load("lib/template-editor/model.ts");
const { layerSelectionAfterClick, LayersPanel } = load("components/template-editor/layers-panel.tsx");
const element = (id, groupId) => ({ ...createCanvasElement("shape"), id, name: id, groupId });
const scene = {
  background: "#fff",
  groups: [{ id: "outer", name: "Outer" }, { id: "inner", name: "Inner", parentId: "outer" }],
  elements: [element("a"), element("b"), element("c"), element("nested-a", "inner"), element("nested-b", "inner"), element("outer-a", "outer")],
};

test("successive taps toggle chosen layers while preserving unrelated selection and artwork", () => {
  const before = structuredClone(scene);
  let selection = layerSelectionAfterClick(scene, ["a"], ["b"], true);
  assert.deepEqual(selection, ["a", "b"]);
  selection = layerSelectionAfterClick(scene, selection, ["c"], true);
  selection = layerSelectionAfterClick(scene, selection, ["b"], true);
  assert.deepEqual(selection, ["a", "c"]);
  assert.deepEqual(layerSelectionAfterClick(scene, selection, ["b"], false), ["b"]);
  assert.deepEqual(scene, before);
});

test("grouped child taps add and remove the whole group without resurrecting remaining members", () => {
  const grouped = ["nested-a", "nested-b", "outer-a"];
  const selected = layerSelectionAfterClick(scene, ["a"], ["nested-a"], true);
  assert.deepEqual(selected, ["a", ...grouped]);
  assert.deepEqual(layerSelectionAfterClick(scene, selected, ["nested-b"], true), ["a"]);
  assert.deepEqual(layerSelectionAfterClick(scene, ["nested-a"], grouped, true), []);
});

test("isolated groups keep tap selection confined to the current subtree", () => {
  assert.deepEqual(layerSelectionAfterClick(scene, ["a", "nested-a"], ["nested-b"], true, "inner"), ["nested-a", "nested-b"]);
  assert.deepEqual(layerSelectionAfterClick(scene, ["nested-a", "nested-b"], ["nested-a"], true, "inner"), ["nested-b"]);
  assert.deepEqual(layerSelectionAfterClick(scene, ["nested-a"], ["outer-a"], false, "inner"), []);
});

test("Layers exposes a keyboard-independent mode and respects workspace permissions", () => {
  const props = { scene, selectedIds: ["a"], width: 360, height: 450, onSelect() {}, onChange() {}, onContextMenu() {} };
  const markup = renderToStaticMarkup(React.createElement(LayersPanel, props));
  assert.match(markup, /class="te-layer-multi-select"[^>]*aria-pressed="false"/);
  assert.match(markup, /Select multiple/);
  const readonly = renderToStaticMarkup(React.createElement(LayersPanel, { ...props, disabled: true }));
  assert.match(readonly, /class="te-layer-multi-select"[^>]*disabled=""/);
});
