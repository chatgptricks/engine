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
function loader(isolated = false) {
  const modules = new Map();
  function load(relative) {
    const filename = path.join(root, relative);
    if (modules.has(filename)) return modules.get(filename);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText;
    const unit = { exports: {} };
    modules.set(filename, unit.exports);
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => {
      if (name.endsWith(".css")) return {};
      if (isolated && name === "react") return { ...React, useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}], useEffect() {}, useLayoutEffect() {}, useMemo: work => work(), useCallback: work => work };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const file = [base, `${base}.ts`, `${base}.tsx`].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
        if (file) return load(path.relative(root, file));
      }
      return requireModule(name);
    }, unit, unit.exports);
    return unit.exports;
  }
  return load;
}
const load = loader();
const { CollaborationBar } = load("components/template-editor/collaboration-bar.tsx");
const { CollaborationOverlay } = load("components/template-editor/collaboration-overlay.tsx");
const { createCanvasElement } = load("lib/template-editor/model.ts");
const peer = (id, pageId = "page") => ({ id, name: id, color: "#d96834", pageId, selected: ["shape"], cursor: { x: 40, y: 80 } });

test("live collaboration includes every participant and reports its real connection state", () => {
  const collaboration = { status: "live", self: { id: "self", name: "Ana", color: "#345bd9" }, peers: [peer("Bruno"), peer("Carla"), peer("Daniel"), peer("Elena")], setAwareness() {} };
  const markup = renderToStaticMarkup(React.createElement(CollaborationBar, { collaboration }));
  assert.match(markup, /aria-label="Live collaboration"/);
  assert.match(markup, /Live · 5 people/);
  assert.match(markup, /te-collaboration-count">5</);
  const offline = renderToStaticMarkup(React.createElement(CollaborationBar, { collaboration: { ...collaboration, status: "offline" } }));
  assert.match(offline, /role="status">Offline</);
  assert.doesNotMatch(offline, /role="status">Live</);
});

test("peer cursors and selections match page scope, include more than two people, and stay visible at any zoom", () => {
  const shape = { ...createCanvasElement("shape", { name: "Square", x: 10, y: 20, width: 100, height: 80, rotation: 15 }), id: "shape" };
  const scene = { background: "#fff", elements: [shape] };
  const peers = [peer("Bruno"), peer("Carla"), peer("Daniel"), peer("Other page", "another"), peer("Master", "@master")];
  const markup = renderToStaticMarkup(React.createElement(CollaborationOverlay, { peers, pageId: "page", scene, viewScale: .5 }));
  for (const name of ["Bruno", "Carla", "Daniel"]) {
    assert.ok(markup.includes(`data-collaboration-name="${name}"`));
    assert.ok(markup.includes(`${name} selected Square`));
    assert.ok(markup.includes(`${name}&#x27;s cursor`));
  }
  assert.doesNotMatch(markup, /Other page|data-collaboration-name="Master"/);
  assert.match(markup, /left:10px;top:20px;width:100px;height:80px;transform:rotate\(15deg\);border-width:3px/);
  assert.match(markup, /left:40px;top:80px;transform:scale\(2\)/);
  const hidden = renderToStaticMarkup(React.createElement(CollaborationOverlay, { peers, pageId: "page", scene: { ...scene, elements: [{ ...shape, hidden: true }] }, viewScale: 1 }));
  assert.doesNotMatch(hidden, /selected Square/);
});

test("canvas awareness publishes canonical coordinates and clears cursors outside the artwork", () => {
  const { CanvasEditor } = loader(true)("components/template-editor/canvas.tsx");
  const originalElement = globalThis.Element;
  class FakeElement { closest() { return null; } }
  globalThis.Element = FakeElement;
  try {
    const values = [], target = new FakeElement();
    const tree = CanvasEditor({ scene: { background: "#fff", elements: [] }, width: 720, height: 450, selectedIds: [], onSelect() {}, onChange() {}, onCursorChange: value => values.push(value), collaborationPageId: "@continuous" });
    const stage = { contains: value => value === target, getBoundingClientRect: () => ({ left: 50, top: 100, width: 360, height: 225 }) };
    tree.props.ref.current = stage;
    tree.props.onPointerMoveCapture({ currentTarget: stage, target, pointerId: 1, clientX: 200, clientY: 175 });
    assert.deepEqual(values, [{ x: 300, y: 150 }]);
    tree.props.onPointerLeave();
    assert.deepEqual(values.at(-1), null);
    tree.props.onPointerMoveCapture({ currentTarget: stage, target: {}, pointerId: 1, clientX: 100, clientY: 110 });
    assert.equal(values.length, 2, "Portalled controls must not publish a canvas cursor");
  } finally { globalThis.Element = originalElement; }
});

test("live peer gestures move the artwork preview without changing the saved scene", () => {
  const { CanvasEditor } = loader(true)("components/template-editor/canvas.tsx");
  const shape = { ...createCanvasElement("shape", { x: 10, y: 20, width: 100, height: 80 }), id: "shape" };
  const scene = { background: "#fff", elements: [shape] }, changes = [];
  const preview = { elements: [{ id: "shape", x: 140, y: 70, width: 120, height: 95, rotation: 20 }] };
  function find(node, predicate) {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = find(child, predicate);
      if (found) return found;
    }
  }
  const props = { scene, selectedIds: [], onSelect() {}, onChange: next => changes.push(next), width: 360, height: 450, collaborationPageId: "page" };
  const tree = CanvasEditor({ ...props, peers: [{ ...peer("Bruno"), preview }] });
  const presented = find(tree, node => node.type?.name === "SceneLayers").props.scene;
  assert.equal(presented.elements[0].x, 140);
  assert.equal(presented.elements[0].rotation, 20);
  assert.equal(scene.elements[0].x, 10);
  assert.equal(changes.length, 0);
  const otherPage = CanvasEditor({ ...props, peers: [{ ...peer("Bruno", "another"), preview }] });
  assert.equal(find(otherPage, node => node.type?.name === "SceneLayers").props.scene.elements[0].x, 10);
  const finished = CanvasEditor({ ...props, peers: [{ ...peer("Bruno"), preview: null }] });
  assert.equal(find(finished, node => node.type?.name === "SceneLayers").props.scene.elements[0].x, 10);
});

test("remote text edits preserve the caret and selected words through insertions and deletions", () => {
  const { rebaseCollaboratorTextSelection } = loader()("components/template-editor/canvas.tsx");
  assert.deepEqual(rebaseCollaboratorTextSelection({ start: 5, end: 5 }, "Hello world", "Hi Hello world"), { start: 8, end: 8 });
  assert.deepEqual(rebaseCollaboratorTextSelection({ start: 6, end: 11 }, "Hello world", "Hi Hello world"), { start: 9, end: 14 });
  assert.deepEqual(rebaseCollaboratorTextSelection({ start: 9, end: 14 }, "Hi Hello world", "Hello world"), { start: 6, end: 11 });
  assert.deepEqual(rebaseCollaboratorTextSelection({ start: 4, end: 4 }, "One two", "One and two"), { start: 8, end: 8 });
  assert.deepEqual(rebaseCollaboratorTextSelection({ start: 6, end: 6 }, "Hello world", "Hello"), { start: 5, end: 5 });
});
