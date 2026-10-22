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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), require = createRequire(import.meta.url);
function loader(handlers = false) {
  const cache = new Map();
  const load = relative => {
    const filename = path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename);
    const unit = { exports: {} }; cache.set(filename, unit.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(name => {
      if (name.endsWith(".css")) return {};
      if (handlers && name === "react") return { ...React, useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useEffect() {} };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const found = [base, `${base}.ts`, `${base}.tsx`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (found) return load(path.relative(root, found));
      }
      return require(name);
    }, unit, unit.exports);
    return unit.exports;
  };
  return load;
}
const load = loader(), handlers = loader(true);
const { createCanvasElement } = load("lib/template-editor/model.ts");
const { ElementInspector } = load("components/template-editor/element-inspector.tsx");
const Inspector = handlers("components/template-editor/element-inspector.tsx").ElementInspector;
const Advanced = handlers("components/template-editor/advanced-properties.tsx").AdvancedProperties;
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found; }
}
const control = (tree, label) => { const node = find(tree, node => node.props?.label === label || node.props?.["aria-label"] === label); assert.ok(node, label); return node; };
const props = elements => ({ scene: { background: "#fff", elements }, selectedIds: elements.map(item => item.id), width: 360, height: 480, onChange() {}, onSelect() {} });

test("the text inspector keeps common formatting first and advanced controls in closed native disclosures", () => {
  const markup = renderToStaticMarkup(React.createElement(ElementInspector, props([createCanvasElement("text")])));
  assert.ok(markup.indexOf('aria-label="Font size"') < markup.indexOf("<summary>Spacing</summary>"));
  for (const title of ["Spacing", "Text box &amp; saved styles", "Text content"]) assert.match(markup, new RegExp(`<details[^>]*><summary>${title}</summary>`));
  assert.doesNotMatch(markup, /<details[^>]*\sopen(?:[\s=>])/);
  for (const label of ["Text sizing", "Vertical text alignment", "Text padding", "Letter spacing"]) assert.ok(markup.includes(label), `${label} stays available`);
});

test("shape paint changes preserve photo frames and protected fills", () => {
  const photo = { src: "https://example.test/photo.png", objectFit: "cover", cropX: 20, cropY: 30 };
  const frame = createCanvasElement("shape", { imageFill: photo, stroke: "#ffffff", strokeWidth: 4 });
  const protectedShape = createCanvasElement("shape", { protected: ["style"] });
  let changed;
  const tree = Inspector({ ...props([frame, protectedShape]), onChange: scene => { changed = scene; } });
  const paint = { type: "gradient", gradient: { type: "linear", angle: 90, stops: [{ color: "#00d98a", position: 0 }, { color: "#32ffbb", position: 100 }] } };
  control(tree, "Fill").props.onChange(paint);
  assert.deepEqual(changed.elements[0].gradient, paint.gradient);
  assert.deepEqual(changed.elements[0].imageFill, photo);
  assert.equal(changed.elements[0].strokeWidth, 4);
  assert.equal(changed.elements[1], protectedShape);
});

test("common flip actions preserve frame geometry and enforce style protection", () => {
  const photo = { src: "https://example.test/photo.png", objectFit: "cover", cropX: 20, cropY: 30 };
  const frame = createCanvasElement("shape", { imageFill: photo, rotation: 20, width: 90 });
  const protectedPhoto = createCanvasElement("image", { protected: ["style"] });
  let changed;
  const tree = Inspector({ ...props([frame, protectedPhoto]), initialSection: "photo", onChange: scene => { changed = scene; } });
  control(tree, "Flip photo horizontally").props.onClick();
  assert.deepEqual(changed.elements[0], { ...frame, imageFill: { ...photo, flipX: true } });
  assert.equal(changed.elements[1], protectedPhoto);
});

test("shadow presets preserve paint and custom effects and reject disabled changes", () => {
  const source = createCanvasElement("text", { blur: 2, blendMode: "multiply" });
  let changed;
  const base = { elements: [source], sections: ["effects"], update: (_group, transform) => { changed = transform(source); } };
  control(Advanced(base), "Soft shadow").props.onClick();
  assert.equal(changed.blur, 2); assert.equal(changed.blendMode, "multiply"); assert.equal(changed.shadow.blur, 8);
  changed = undefined;
  control(Advanced({ ...base, styleDisabled: true }), "Lift shadow").props.onClick();
  assert.equal(changed, undefined);
});
