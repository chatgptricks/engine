import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url);
function load(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText;
  const unit = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => Object.hasOwn(dependencies, name) ? dependencies[name] : requireModule(name), unit, unit.exports);
  return unit.exports;
}
const { commonValue, boldState, booleanState, imageResolution } = load("lib/template-editor/property-utils.ts");
const { groupMemberIds, buildLayerRows } = load("lib/template-editor/layer-tree.ts");
const colors = load("lib/template-editor/color-utils.ts");
const { ColorField } = load("components/template-editor/controls.tsx", { "@/components/engine/icons": { CloseIcon: () => null }, "@/lib/template-editor/color-utils": colors });
const model = load("lib/template-editor/model.ts");
const geometry = load("lib/template-editor/canvas-geometry.ts");
const commands = load("lib/template-editor/commands.ts", { "./model": model });
const properties = load("lib/template-editor/property-utils.ts");
const { preflightDesign } = load("lib/template-editor/preflight.ts", { "./model": model, "./canvas-geometry": geometry, "./commands": commands, "./property-utils": properties });

test("color parser expands shorthand and preserves alpha without accepting unsafe CSS", () => {
  assert.deepEqual(colors.parseColor("#AbC"), { rgb: "#aabbcc", alpha: 1 });
  assert.deepEqual(colors.parseColor("#0f08"), { rgb: "#00ff00", alpha: 136 / 255 });
  assert.deepEqual(colors.parseColor("#11223380"), { rgb: "#112233", alpha: 128 / 255 });
  assert.deepEqual(colors.parseColor("transparent"), { rgb: "#000000", alpha: 0 });
  assert.equal(colors.parseColor("url(javascript:evil)"), null);
  assert.equal(colors.colorWithAlpha("#abc", 0), "#aabbcc00");
  assert.equal(colors.colorWithAlpha("#abc", .5), "#aabbcc80");
  assert.equal(colors.colorWithAlpha("#abc", 1), "#aabbcc");
});
test("color control paints the real alpha color while using valid native picker RGB", () => {
  const markup = renderToStaticMarkup(React.createElement(ColorField, { label: "Fill", value: "#abc8", onChange() {} }));
  assert.match(markup, /background:#abc8/);
  assert.match(markup, /type="color" value="#aabbcc"/);
  assert.match(markup, /aria-label="Fill alpha"/);
  const none = renderToStaticMarkup(React.createElement(ColorField, { label: "Fill", value: "transparent", onChange() {} }));
  assert.match(none, /background:transparent/);
  assert.match(none, /aria-pressed="true"/);
  const mixed = renderToStaticMarkup(React.createElement(ColorField, { label: "Fill", value: "Mixed", onChange() {} }));
  assert.match(mixed, /data-mixed="true"/);
  assert.match(mixed, /Mixed/);
});

test("mixed selection properties never borrow one selected layer's value", () => {
  const selection = [{ fontSize: 12, font: "inter", italic: false }, { fontSize: 24, font: "inter", italic: true }];
  assert.equal(commonValue(selection, "fontSize"), undefined);
  assert.equal(commonValue(selection, "font"), "inter");
  assert.equal(booleanState(selection, "italic"), "mixed");
  assert.equal(commonValue([], "fontSize"), undefined);
});
test("semibold remains distinct from bold, with mixed accessibility state", () => {
  assert.equal(boldState([{ fontWeight: 600 }]), false);
  assert.equal(boldState([{ fontWeight: 700 }, { fontWeight: 900 }]), true);
  assert.equal(boldState([{ fontWeight: 600 }, { fontWeight: 700 }]), "mixed");
});
test("image export resolution accounts for zoom and cover vs contain", () => {
  const wide = { width: 100, height: 200, intrinsicWidth: 1000, intrinsicHeight: 200 };
  assert.equal(imageResolution({ ...wide, fit: "cover" }).low, true);
  assert.equal(imageResolution({ ...wide, fit: "contain" }).low, false);
  assert.equal(imageResolution({ ...wide, fit: "contain", cropScale: 4 }).low, true);
  assert.equal(imageResolution({ width: 100, height: 100 }), null);
});
const element = (id, groupId, name = id) => ({ id, name, type: "text", text: name, groupId });
const scene = {
  background: "#fff",
  groups: [{ id: "g", name: "Header" }, { id: "nested", name: "Copy", parentId: "g" }],
  elements: [element("back"), element("body", "nested", "Story title"), element("icon", "g"), element("front")],
};
test("layer tree respects front-to-back order and nested group depth", () => {
  const rows = buildLayerRows(scene);
  assert.deepEqual(rows.map(row => row.kind === "element" ? row.element.id : row.group.id), ["front", "g", "icon", "nested", "body", "back"]);
  assert.deepEqual(rows.map(row => row.depth), [0, 0, 1, 1, 2, 0]);
  assert.deepEqual(groupMemberIds(scene, "g"), ["body", "icon"]);
});
test("collapse and isolation affect panel rows without removing artwork", () => {
  const collapsed = buildLayerRows(scene, new Set(["g"]));
  assert.deepEqual(collapsed.map(row => row.kind), ["element", "group", "element"]);
  const isolated = buildLayerRows(scene, new Set(), "nested");
  assert.deepEqual(isolated.map(row => row.element.id), ["body"]);
  assert.equal(scene.elements.length, 4);
});
test("search reveals collapsed ancestor groups and can find a whole group", () => {
  const title = buildLayerRows(scene, new Set(["g"]), undefined, "story");
  assert.deepEqual(title.map(row => row.kind === "element" ? row.element.id : row.group.id), ["g", "nested", "body"]);
  const header = buildLayerRows(scene, new Set(["g"]), undefined, "header");
  assert.deepEqual(header.map(row => row.kind === "element" ? row.element.id : row.group.id), ["g", "icon", "nested", "body"]);
});
test("group descendant resolution terminates defensively for cyclic input", () => {
  const malformed = { groups: [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }], elements: [element("child", "b")] };
  assert.deepEqual(groupMemberIds(malformed, "a"), ["child"]);
});

const designWith = (elements, extra = {}) => ({ id: "d", name: "Design", format: "portrait", pages: [{ id: "page-1", canvas: { background: "#fff", elements } }], ...extra });
test("preflight distinguishes confirmed failures from sources not yet checked", () => {
  const image = model.createCanvasElement("image", { name: "Hero", x: 0, y: 0, width: 300, height: 300, intrinsicWidth: 200, intrinsicHeight: 200 });
  const text = model.createCanvasElement("text", { name: "Title", text: "Headline", x: 0, y: 0, width: 100, height: 40 });
  const design = designWith([image, text]);
  assert.deepEqual(preflightDesign(design).map(issue => issue.code), ["image-resolution"]);
  const issues = preflightDesign(design, { imageAvailable: () => false, fontAvailable: () => false, measureText: () => ({ width: 100, height: 55 }) });
  assert.deepEqual(issues.map(issue => issue.code), ["image-resolution", "image-unavailable", "font-unavailable", "text-overflow"]);
  assert.equal(issues.find(issue => issue.code === "image-unavailable").severity, "error");
});
test("preflight checks shape photo fills using mask dimensions, fit and crop zoom", () => {
  const photo=model.createCanvasElement("shape",{name:"Photo star",width:100,height:100,x:0,y:0});
  photo.imageFill={src:"data:image/png;base64,iVBORw0KGgo=",objectFit:"contain",cropX:50,cropY:50,cropScale:1,intrinsicWidth:300,intrinsicHeight:30};
  const design=designWith([photo]);
  assert.deepEqual(preflightDesign(design),[]);
  photo.imageFill.objectFit="cover";
  const problems=preflightDesign(design,{imageAvailable:(src,element)=>{assert.equal(src,photo.imageFill.src);assert.equal(element.id,photo.id);return false;}});
  assert.deepEqual(problems.map(issue=>issue.code),["image-resolution","image-unavailable"]);
  photo.imageFill.objectFit="contain";photo.imageFill.cropScale=2;
  assert.deepEqual(preflightDesign(design).map(issue=>issue.code),["image-resolution"]);
});
test("preflight checks only active title and word textures and uses measured word bounds",()=>{
  const text=model.createCanvasElement("text",{name:"Title",width:200,height:50,x:0,y:0,text:"Photo title",richText:'<span data-texture-id="word-1">Photo</span> title'});
  const texture={src:"https://public.example/texture.png",objectFit:"cover",cropX:50,cropY:50,intrinsicWidth:300,intrinsicHeight:300};
  text.textureFill=texture;text.wordTextures=[{...texture,id:"word-1"},{...texture,id:"unused",src:"https://unpainted.example/secret.png"}];
  const requested=[];const issues=preflightDesign(designWith([text]),{measureTexture:(_element,id)=>id==="word-1"?{width:20,height:10}:undefined,imageAvailable:src=>{requested.push(src);return false;}});
  assert.deepEqual(issues.map(issue=>issue.code),["image-resolution","image-unavailable","image-unavailable"]);
  assert.equal(new Set(issues.map(issue=>issue.id)).size,issues.length);
  assert.deepEqual(requested,[texture.src,texture.src]);
});
test("preflight honors hidden groups, parked artwork, safe areas and template placeholders", () => {
  const title = model.createCanvasElement("text", { id: "t", text: "{{headline}}", x: 0, y: 0, width: 100, height: 40 });
  const hidden = model.createCanvasElement("text", { text: "{{hidden}}", groupId: "hidden" });
  const parked = model.createCanvasElement("text", { text: "{{parked}}", x: -2000 });
  const design = designWith([title, hidden, parked]);
  design.pages[0].canvas.groups = [{ id: "hidden", name: "Hidden", hidden: true }];
  design.pages[0].canvas.layout = { safeArea: { enabled: true, top: 10, left: 10, right: 10, bottom: 10 } };
  assert.deepEqual(preflightDesign(design).map(issue => issue.code), ["unresolved-placeholder", "safe-area"]);
});
test("preflight uses custom export scale and includes master artwork only where enabled", () => {
  const image = model.createCanvasElement("image", { x: 0, y: 0, width: 100, height: 100, intrinsicWidth: 250, intrinsicHeight: 250 });
  assert.equal(preflightDesign(designWith([image], { customSize: { width: 720, height: 900 } })).length, 0);
  const master = model.createCanvasElement("text", { text: "{{brand}}", x: 10, y: 10 });
  const design = designWith([], { masterScene: { background: "transparent", elements: [master] } });
  assert.equal(preflightDesign(design)[0].master, true);
  design.pages[0].useMaster = false;
  assert.equal(preflightDesign(design).length, 0);
});
