/* Run: node --test tests/template-editor-rendering.test.mjs */
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
function loadModule(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const compiled = vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename });
  const unit = { exports: {} };
  compiled(name => {
    if(name.endsWith(".css")) return {};
    if(Object.hasOwn(dependencies,name)) return dependencies[name];
    if(name.startsWith("@/") || name.startsWith("./") || name.startsWith("../")) {
      const base=name.startsWith("@/") ? path.join(root,name.slice(2)) : path.resolve(path.dirname(filename),name);
      const resolved=[base,`${base}.ts`,`${base}.tsx`].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
      if(resolved) return loadModule(path.relative(root,resolved));
    }
    return requireModule(name);
  }, unit, unit.exports);
  return unit.exports;
}

const model = loadModule("lib/template-editor/model.ts");
const geometry = loadModule("lib/template-editor/canvas-geometry.ts");
const continuous = loadModule("lib/template-editor/continuous-carousel.ts", { "./model": model, "./canvas-geometry": geometry });
const canvas = loadModule("components/template-editor/canvas.tsx", {
  "@/lib/template-editor/canvas-geometry": geometry,
  "@/lib/engine/util": loadModule("lib/engine/util.ts"),
});
const { DesignFrame, DesignPreview } = loadModule("components/template-editor/preview.tsx", {
  "@/lib/template-editor/model": model,
  "@/lib/template-editor/continuous-carousel": continuous,
  "./canvas": canvas,
  "@/components/engine/slide-templates": {
    SlideFrame() { throw new Error("Canvas artwork unexpectedly used the legacy renderer."); },
  },
});
const css = fs.readFileSync(path.join(root, "components/template-editor/canvas.css"), "utf8");
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
  // React 19 hoists image preloads outside the component's actual frame.
  .replace(/<link\b[^>]*>/g, "");
const cssRule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `Missing CSS rule ${selector}`);
  return rule[1];
};
function freeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === "object") freeze(child); });
  return Object.freeze(value);
}
const shape = (id, overrides = {}) => ({ ...model.createCanvasElement("shape"), id, name: id, ...overrides });
function panorama(format) {
  const design = model.createBlankDesign("Continuous rendering", format);
  design.pages.push(model.duplicatePage(design.pages[0]), model.duplicatePage(design.pages[0]));
  design.continuousCanvas = {
    background: "#dce5d8",
    elements: [
      model.createCanvasElement("image", { x: -25, y: 0, width: 1140, height: 640, src: "/template-editor/forest.svg", cropX: 27, cropY: 68 }),
      model.createCanvasElement("text", { text: "A heading across the seam", x: 335, y: 180, width: 530, height: 90, rotation: 11, fontSize: 32, letterSpacing: 2 }),
      shape("hidden-artwork", { hidden: true, x: 10, width: 900 }),
    ],
  };
  return freeze(design);
}
const editorProps = scene => ({
  scene, width: 360, height: 450, selectedIds: [],
  onSelect() { assert.fail("Server rendering must not change selection."); },
  onChange() { assert.fail("Server rendering must not modify artwork."); },
});

test("continuous slides crop the same image and rotated text at exact offsets in every export format", () => {
  for (const format of Object.keys(model.FORMATS)) {
    const design = panorama(format);
    for (const [index, page] of design.pages.entries()) {
      const props = { design, page };
      const frame = DesignFrame(props);
      assert.equal(frame.props.style.width, 360);
      assert.equal(frame.props.style.height, 360 * model.FORMATS[format].height / model.FORMATS[format].width);
      const sliced = frame.props.children.props.scene;
      assert.equal(sliced.background, design.continuousCanvas.background);
      sliced.elements.forEach((element, layer) => {
        const original = design.continuousCanvas.elements[layer];
        assert.equal(element.x, original.x - index * 360);
        assert.deepEqual({ ...element, x: original.x }, original, "Cropping must not resize media or reflow text.");
      });
      const exported = render(DesignFrame, props);
      assert.match(exported, /width:1140px;height:640px/);
      assert.match(exported, /object-position:27% 68%/);
      assert.doesNotMatch(exported, /hidden-artwork/);
      assert.ok(render(DesignPreview, props).includes(exported), "Thumbnail and export must use the identical frame.");
    }
  }
  assert.match(cssRule(".te-canvas-scene"), /overflow:\s*hidden/);
});

test("slide seams and the previous-slide guide exist only in the editor, never in exported frames", () => {
  const design = panorama("portrait");
  const previous = freeze({ background: "#ffffff", elements: [shape("previous-slide-guide")] });
  const editor = render(canvas.CanvasEditor, {
    ...editorProps(design.continuousCanvas), width: 1080, slideWidth: 360,
  });
  assert.equal((editor.match(/class="te-canvas-slide-seam"/g) ?? []).length, 2);
  assert.match(editor, /class="te-canvas-slide-marker" style="left:720px"/);
  assert.match(editor, /Slide 3/);
  const onion = render(canvas.CanvasEditor, { ...editorProps(design.continuousCanvas), onionScene: previous });
  assert.match(onion, /data-onion-skin="true"/);
  for (const page of design.pages) {
    const output = render(DesignFrame, { design, page });
    assert.doesNotMatch(output, /data-onion-skin|previous-slide-guide|te-canvas-slide-|data-layer-id|te-canvas-outline|contenteditable/);
  }
});

test("onion artwork is clipped and noninteractive while parked current layers retain selective clipping", () => {
  const scene = freeze({ background: "#fffafa", elements: [
    shape("partial", { x: -40, y: 100, width: 80, height: 60 }),
    shape("parked", { x: -120, y: 100, width: 60, height: 60 }),
  ] });
  const previous = freeze({ background: "#cc22ff", elements: [shape("ghost", { x: -100, width: 700 })] });
  const props = { ...editorProps(scene), onionScene: previous, onionOpacity: .5 };
  const html = render(canvas.CanvasEditor, props);
  assert.equal((html.match(/data-onion-skin="true"/g) ?? []).length, 1);
  assert.match(html, /data-onion-skin="true" aria-hidden="true" style="opacity:0.5"/);
  assert.match(html, /style="width:360px;height:450px;background:#fffafa(?:;|")/);
  assert.match(html, /te-canvas-editor-scene" style="background:transparent"/);
  assert.doesNotMatch(html, /#cc22ff/);
  assert.equal((html.match(/data-element-id="ghost"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-layer-id="ghost"/);
  assert.equal((html.match(/data-layer-id=/g) ?? []).length, 2);
  const ghostStyle = cssRule(".te-canvas-onion-skin");
  assert.match(ghostStyle, /inset:\s*0/);
  assert.match(ghostStyle, /overflow:\s*hidden/);
  assert.match(ghostStyle, /pointer-events:\s*none/);
  assert.match(html, /class="te-canvas-page-layer is-clipped"><div[^>]*data-element-id="partial"/);
  assert.match(html, /class="te-canvas-page-layer"><div[^>]*data-element-id="parked"/);
  assert.doesNotMatch(render(canvas.CanvasEditor, { ...props, clipToCanvas: false }), /class="te-canvas-page-layer is-clipped"/);
  assert.equal(scene.elements[0].x, -40);
  assert.equal(previous.background, "#cc22ff");
});


test("translucent page backgrounds are painted once with and without onion skin", () => {
  const scene = freeze({background: "#11223380", elements: []});
  const previous = freeze({background: "#ffffff", elements: [shape("previous")]});
  for (const onionScene of [undefined, previous]) {
    const output = render(canvas.CanvasEditor, {...editorProps(scene), onionScene});
    assert.equal((output.match(/background:#11223380/g) ?? []).length, 1);
  }
  const output = render(canvas.SceneRenderer, {scene});
  assert.equal((output.match(/background:#11223380/g) ?? []).length, 1);
});

test("fixed text boxes keep the accents and descenders of their lines and still cut text that overflows", () => {
  const fit = loadModule("lib/template-editor/text-fit.ts");
  // The Follow page's first line: Bebas Neue at line height .836 in a box one line tall, where Á rises above the box.
  const follow = { ...model.createCanvasElement("text"), id: "follow", name: "Follow this page", text: "SIGUE ESTA PÁGINA", font: "bebas", fontSize: 40.67, lineHeight: .836, width: 315, height: 34, textMode: "fixed", verticalAlign: "bottom" };
  const output = render(canvas.SceneRenderer, { scene: freeze({ background: "#0b0f14", elements: [
    follow,
    { ...follow, id: "fitted", textMode: "auto-fit", autoFitFontSize: 30 },
    { ...follow, id: "rich", richText: 'SIGUE <span style="font-size:60px">MÁS</span>' },
    { ...follow, id: "grows", textMode: "auto-height" },
  ] }) });
  const frame = id => output.match(new RegExp(`data-element-id="${id}"[^>]*>(?:<span[^>]*>.*?</span>)?<div class="([^"]+)" style="([^"]*)"`));
  assert.equal(frame("follow")[1], "te-canvas-text-frame is-fixed");
  assert.match(frame("follow")[2], new RegExp(`--te-glyph-overhang:${fit.glyphOverhang(40.67, .836)}px`));
  assert.match(frame("fitted")[2], new RegExp(`--te-glyph-overhang:${fit.glyphOverhang(30, .836)}px`), "auto-fit text is sized to its fitted font");
  assert.match(frame("rich")[2], new RegExp(`--te-glyph-overhang:${fit.glyphOverhang(60, .836)}px`), "the largest run sets the room");
  assert.equal(frame("grows")[1], "te-canvas-text-frame", "a box that grows with its text never clips");
  // Ink reach from the middle of a line box in em, measured in Chromium: Bebas Neue's Á .612,
  // Inter's Á .633, Lora's descenders .637. The clip clears each at every line height.
  for (const reach of [.612, .633, .637]) for (const lineHeight of [.5, .836, 1, 1.2, 1.5]) {
    assert.ok(fit.glyphOverhang(100, lineHeight) >= 100 * (reach - lineHeight / 2) - .01, `reach ${reach} at line height ${lineHeight}`);
  }
  assert.equal(fit.glyphOverhang(40, 1.4), 0, "loose lines keep their ink inside the box");
  // The clip reaches past the box by that room; once the text overflows, the box cuts it exactly.
  assert.match(cssRule(".te-canvas-text-frame.is-fixed"), /clip-path:\s*inset\(calc\(-1 \* var\(--te-glyph-overhang,\s*0px\)\) 0\)/);
  assert.doesNotMatch(cssRule(".te-canvas-text-frame.is-fixed"), /overflow/);
  assert.match(cssRule(".te-canvas-text-frame.is-fixed[data-overflow]"), /clip-path:\s*none;\s*overflow:\s*hidden/);
  // No other stylesheet may cut the box again.
  for (const file of fs.readdirSync(path.join(root, "components/template-editor")).filter(name => name.endsWith(".css"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, "components/template-editor", file), "utf8"), /\.te-canvas-text-frame\.is-fixed\s*\{[^}]*overflow/, file);
  }
});
