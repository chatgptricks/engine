import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), modules = new Map();
function load(relative) {
  const filename = path.join(root, relative); if (modules.has(filename)) return modules.get(filename);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText;
  const unit = { exports: {} }; modules.set(filename, unit.exports);
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(name => name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : requireModule(name), unit, unit.exports);
  return unit.exports;
}
const vector = load("lib/template-editor/vector.ts"), model = load("lib/template-editor/model.ts");
const shape = (id, patch = {}) => ({ ...model.createCanvasElement("shape"), id, x: 0, y: 0, width: 100, height: 100, ...patch });
const area = polygons => polygons.reduce((sum, polygon) => sum + polygon.reduce((total, ring, index) => { const signed = ring.reduce((value, point, i) => { const next = ring[(i + 1) % ring.length]; return value + point[0] * next[1] - next[0] * point[1]; }, 0) / 2; return total + (index === 0 ? Math.abs(signed) : -Math.abs(signed)); }, 0), 0);
const close = (actual, expected, precision = 1e-7) => assert.ok(Math.abs(actual - expected) <= precision, `${actual} expected ${expected}`);

test("polygon boolean operations compute union, intersection, subtraction and xor with holes", () => {
  const one = vector.shapeToPolygons(shape("one")), two = vector.shapeToPolygons(shape("two", { x: 50 }));
  close(area(vector.booleanPolygons([one, two], "union")), 15000);
  close(area(vector.booleanPolygons([one, two], "intersect")), 5000);
  close(area(vector.booleanPolygons([one, two], "subtract")), 5000);
  close(area(vector.booleanPolygons([one, two], "xor")), 10000);
  const inner = vector.shapeToPolygons(shape("inner", { x: 25, y: 25, width: 50, height: 50 }));
  const hole = vector.booleanPolygons([one, inner], "subtract");
  assert.equal(hole[0].length, 2); close(area(hole), 7500);
});

test("combining selected shapes preserves unrelated layers and refuses locked or protected artwork", () => {
  const source = { background: "#fff", elements: [shape("base"), model.createCanvasElement("text"), shape("top", { x: 50, fill: "#abcdef" })] };
  const original = structuredClone(source), result = vector.combineShapes(source, ["base", "top"], "union");
  assert.equal(result.scene.elements.length, 2); assert.equal(result.scene.elements[0].type, "text");
  const combined = result.scene.elements[1]; assert.equal(combined.shape, "path"); assert.equal(combined.fill, "#abcdef");
  close(area(vector.shapeToPolygons(combined)), 15000); assert.ok(model.parseCanvasScene(result.scene));
  assert.deepEqual(source, original);
  for (const property of [{ locked: true }, { protected: ["delete"] }, { protected: ["position"] }]) {
    const locked = { ...source, elements: [shape("base", property), shape("top", { x: 50 })] };
    assert.equal(vector.combineShapes(locked, ["base", "top"], "union").scene, locked);
  }
  const disjoint = { background: "#fff", elements: [shape("a"), shape("b", { x: 200 })] };
  assert.equal(vector.combineShapes(disjoint, ["a", "b"], "intersect").scene.elements.length, 0);
});

test("curve sampling supports relative commands, reflected controls and elliptical arcs", () => {
  const linear = vector.flattenVectorPath("M10 20h40v30h-40z");
  assert.deepEqual(linear, [[[10, 20], [50, 20], [50, 50], [10, 50], [10, 20]]]);
  const curved = vector.flattenVectorPath("M0 0c0 100 100 100 100 0s100 -100 100 0q50 100 100 0t100 0z");
  assert.ok(curved[0].length > 50); assert.deepEqual(curved[0].at(-1), [0, 0]);
  const circle = vector.shapeToPolygons(shape("circle", { shape: "ellipse" }));
  close(area(circle), Math.PI * 2500, 20);
  const rotated = vector.shapeToPolygons(shape("rotated", { rotation: 37 }));
  close(area(rotated), 10000);
  assert.equal(model.isSafeVectorPath("M0 0L"), false);
  assert.equal(model.isSafeVectorPath("M0 0A10 10 0 9 1 20 20"), false);
});

test("SVG import retains independent paths, group hierarchy, original curves and affine transforms", () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100"><g id="Group" fill="#123456" transform="translate(20 10)"><rect id="Box" x="10" y="20" width="40" height="30"/><g id="Nested" transform="rotate(30)"><path id="Curve" d="M0 0C0 40 40 40 40 0Z"/></g></g><circle cx="120" cy="60" r="20" fill="rgb(255,0,0)"/></svg>';
  const imported = vector.importSVG(source);
  assert.equal(imported.elements.length, 3); assert.equal(imported.groups.length, 2);
  assert.equal(imported.groups[1].parentId, imported.groups[0].id);
  assert.equal(imported.elements[0].name, "Box"); assert.equal(imported.elements[0].fill, "#123456");
  close(imported.elements[0].x, 36); close(imported.elements[0].y, 18); close(imported.elements[0].width, 72);
  assert.equal(imported.elements[1].path, "M0 0C0 40 40 40 40 0Z"); close(imported.elements[1].rotation, 30);
  assert.equal(imported.elements[2].fill, "#ff0000"); assert.ok(model.parseCanvasScene(imported));
});

test("SVG importer rejects active content, unsafe attributes, malformed markup and oversized scenes", () => {
  const invalid = [
    '<svg><script>alert(1)</script><rect width="10" height="10"/></svg>',
    '<svg><foreignObject><div>HTML</div></foreignObject></svg>',
    '<svg><use href="https://evil.test/x.svg#x"/></svg>',
    '<svg><path onclick="x()" d="M0 0L10 10Z"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///tmp/x">]><svg/>',
    '<svg><path d="M0 0L10 10Z"></svg>',
    '<svg><rect width=10 height="10"/></svg>',
    '<svg><path d="M0 0L10 10Z" fill="url(https://evil.test/x)"/></svg>',
    '<svg><text>Unsupported text</text></svg>',
  ];
  for (const value of invalid) assert.throws(() => vector.importSVG(value));
  assert.throws(() => vector.importSVG(`<svg>${'<rect width="10" height="10"/>'.repeat(101)}</svg>`), /100 editable/);
});

test("SVG gradients, fill rules, opacity, dash and skew normalize into safe artwork", () => {
  const source = '<svg viewBox="0 0 100 100"><defs><linearGradient id="gradient"><stop offset="0" stop-color="#000"/><stop offset="100%" stop-color="#fff" stop-opacity=".5"/></linearGradient></defs><g opacity=".5"><path d="M0 0H80V80H0ZM20 20H60V60H20Z" fill="url(#gradient)" fill-rule="evenodd" transform="skewX(10)" stroke="#f00" stroke-width="2" stroke-dasharray="2 3" opacity=".5"/><rect x="0" y="0" width="10" height="10" fill="#f00" fill-opacity=".5"/></g></svg>';
  const imported = vector.importSVG(source);
  assert.equal(imported.elements[0].fillRule, "evenodd"); assert.equal(imported.elements[0].opacity, .5); assert.equal(imported.groups[0].opacity, .5);
  assert.equal(imported.elements[0].gradient.stops[1].color, "#ffffff80");
  assert.deepEqual(imported.elements[0].strokeDash, [7.2, 10.8]);
  assert.equal(imported.elements[1].fill, "#ff000080"); assert.ok(model.parseCanvasScene(imported));
});
