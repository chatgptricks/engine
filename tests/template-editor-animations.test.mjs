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

// A loader that resolves @/ and relative imports, for components and their libraries.
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
const motion = load("lib/template-editor/animations.ts");
const agent = load("lib/template-editor/agent-decks.ts");
const video = load("lib/template-editor/export-video.ts");
const { animationKeyframes, sampleTimeline } = load("components/template-editor/animation-preview.ts");
const { AnimatePanel } = load("components/template-editor/animate-panel.tsx");

const box = { x: 100, y: 100, width: 100, height: 50, rotation: 0 };
const text = (extra = {}) => ({ ...model.createCanvasElement("text", { text: "Engine", x: 20, y: 20, width: 200, height: 60, ...extra }), id: extra.id ?? "t" });

test("animations are checked, and the defaults aren't stored", () => {
  assert.deepEqual(model.parseElementAnimation({ kind: "rise", mode: "both", speed: 0.7, delay: 0 }), { kind: "rise", speed: 0.7 });
  assert.deepEqual(model.parseElementAnimation({ kind: "pan", mode: "exit", direction: "right", delay: 2 }), { kind: "pan", mode: "exit", direction: "right", delay: 2 });
  for (const bad of [{ kind: "spin" }, { kind: "fade", speed: 0.1 }, { kind: "fade", speed: 4 }, { kind: "fade", delay: -1 }, { kind: "fade", mode: "loop" }, { kind: "fade", direction: "sideways" }, "fade"]) assert.equal(model.parseElementAnimation(bad), null, JSON.stringify(bad));
  assert.deepEqual(motion.setElementAnimation(text(), { kind: "rise", mode: "both", speed: 0.7, direction: "up" }).animation, { kind: "rise" });
  assert.deepEqual(motion.setElementAnimation(text(), { kind: "fade", direction: "left" }).animation, { kind: "fade" }, "fade has no direction");
  assert.equal("animation" in motion.setElementAnimation(text({ animation: { kind: "pop" } }), null), false);
});

test("a saved animation survives parsing, and a broken one is refused like any bad field", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Motion", format: "square", slides: [{ id: "s1", layout: "blank", elements: [{ id: "a", type: "text", text: "Hi", x: 0, y: 0, width: 500, height: 200 }] }] });
  deck.pages[0].canvas.elements[0] = { ...deck.pages[0].canvas.elements[0], animation: { kind: "wipe", direction: "down", delay: 1 } };
  assert.deepEqual(model.parseLibrary(agent.editableDeckPackage(deck)).designs[0].pages[0].canvas.elements[0].animation, { kind: "wipe", direction: "down", delay: 1 });
  deck.pages[0].canvas.elements[0] = { ...deck.pages[0].canvas.elements[0], animation: { kind: "wipe", delay: 99 } };
  assert.equal(model.parseLibrary(agent.editableDeckPackage(deck)), null);
});

test("poses: hidden before the entrance, at rest between, and out the way it came in", () => {
  const length = 5;
  assert.equal(motion.animationPose({ kind: "fade", delay: 1 }, 0.5, length, box).opacity, 0, "waits for its delay");
  assert.equal(motion.animationPose({ kind: "fade" }, 0, length, box).opacity, 0);
  assert.ok(motion.isRestPose(motion.animationPose({ kind: "fade" }, 2.5, length, box)));
  const rising = motion.animationPose({ kind: "rise" }, 0.1, length, box);
  assert.ok(rising.y > 0 && rising.x === 0, "rise comes up from below");
  const leaving = motion.animationPose({ kind: "rise" }, length - 0.05, length, box);
  assert.ok(leaving.y < 0, "and leaves upwards");
  assert.ok(motion.animationPose({ kind: "pan" }, 0.1, length, box).x > 0, "pan left comes in from the right");
  assert.ok(motion.animationPose({ kind: "pop" }, 0.05, length, box).scale < 1);
  assert.ok(motion.animationPose({ kind: "stomp" }, 0.05, length, box).scale > 1);
  assert.ok(motion.animationPose({ kind: "blur" }, 0.1, length, box).blur > 0);
  assert.ok(motion.animationPose({ kind: "tumble" }, 0.1, length, box).rotate < 0);
  const wipe = motion.animationPose({ kind: "wipe" }, 0.2, length, box);
  assert.ok(wipe.clip.right > 0 && wipe.clip.right < 1 && wipe.clip.left === 0, "a wipe to the right uncovers it left to right");
  const baseline = motion.animationPose({ kind: "baseline" }, 0.2, length, box);
  assert.ok(baseline.y > 0 && baseline.clip.bottom > 0, "baseline rises out of its own box");
  assert.ok(motion.isRestPose(motion.animationPose({ kind: "rise", mode: "enter" }, length - 0.05, length, box)), "on enter only: no exit");
  assert.ok(motion.isRestPose(motion.animationPose({ kind: "rise", mode: "exit" }, 0, length, box)), "on exit only: there from the start");
  assert.ok(motion.animationPose({ kind: "fade", mode: "exit" }, length - 0.01, length, box).opacity < 0.1);
});

test("a still page plays 5 seconds, longer when delays need it", () => {
  assert.equal(motion.stillPageLength([text({ animation: { kind: "fade" } })]), 5);
  assert.equal(motion.stillPageLength([text({ animation: { kind: "fade", delay: 6, speed: 1 } })]), 9);
  assert.equal(motion.stillPageLength([text({ animation: { kind: "fade", delay: 6, speed: 1, mode: "enter" } })]), 8);
  assert.equal(motion.stillPageLength([text({ animation: { kind: "fade", delay: 30, speed: 3 } }), text({ id: "b", animation: { kind: "fade", delay: 30, speed: 3 } })]), 37);
  assert.ok(motion.pageMotion({ canvas: { background: "#fff", elements: [text({ animation: { kind: "pop" } })] } }));
  assert.equal(motion.pageMotion({ canvas: { background: "#fff", elements: [text({ hidden: true, animation: { kind: "pop" } })] } }), false, "a hidden layer doesn't make the page move");
  assert.equal(video.pageExportsVideo({ canvas: { background: "#fff", elements: [text()] } }), false);
  assert.equal(video.pageExportsVideo({ canvas: { background: "#fff", elements: [text({ animation: { kind: "pop" } })] } }), true);
});

test("agents animate any layer by name or with settings, change part of it, and remove it", () => {
  const deck = agent.createAgentDeck({ id: "deck", name: "Motion", format: "square", slides: [{ id: "s1", layout: "blank", elements: [
    { id: "a", type: "text", text: "Hi", x: 0, y: 0, width: 500, height: 200, animation: "rise" },
    { id: "pic", type: "image", src: "https://example.com/a.jpg", x: 0, y: 300, width: 500, height: 500, animation: { kind: "pan", direction: "right", delay: 0.4 } },
    { id: "box", type: "shape", shape: "rectangle", fill: "#00D98A", x: 0, y: 900, width: 200, height: 100 },
  ] }] });
  const [head, pic] = deck.pages[0].canvas.elements;
  assert.deepEqual(head.animation, { kind: "rise" });
  assert.deepEqual(pic.animation, { kind: "pan", direction: "right", delay: 0.4 });
  const slower = agent.updateAgentDeck(deck, { operations: [
    { op: "update_element", pageId: "s1", elementId: "a", properties: { animation: { speed: 1.2, mode: "enter" } } },
    { op: "update_element", pageId: "s1", elementId: "pic", properties: { animation: { kind: "wipe" } } },
    { op: "update_element", pageId: "s1", elementId: "box", properties: { animation: "pop" } },
  ] });
  const [a, p, b] = slower.pages[0].canvas.elements;
  assert.deepEqual(a.animation, { kind: "rise", mode: "enter", speed: 1.2 }, "a partial object keeps the kind");
  assert.deepEqual(p.animation, { kind: "wipe", delay: 0.4 }, "a new kind starts from its own direction");
  assert.deepEqual(b.animation, { kind: "pop" });
  const removed = agent.updateAgentDeck(slower, { operations: [{ op: "update_element", pageId: "s1", elementId: "a", properties: { animation: null } }] });
  assert.equal("animation" in removed.pages[0].canvas.elements[0], false);
  assert.throws(() => agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "s1", elementId: "a", properties: { animation: "spin" } }] }), agent.AgentDeckValidationError);
  assert.throws(() => agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: "s1", elementId: "a", properties: { animation: { kind: "fade", speed: 9 } } }] }), agent.AgentDeckValidationError);
  assert.ok(agent.agentCapabilities().toolbar.commands.some(command => command.id === "element.animate"));
});

test("the MP4 cuts layers into still runs around the ones that move, and draws a pose about the layer's centre", () => {
  const elements = [text({ id: "bg" }), text({ id: "a", animation: { kind: "rise" } }), text({ id: "b" }), text({ id: "c" }), text({ id: "d", animation: { kind: "fade" } })];
  const stack = video.motionStack(["bg", "a", "b", "c", "d"], elements);
  assert.deepEqual(stack.map(item => item.still ?? item.moving.id), [["bg"], "a", ["b", "c"], "d"]);
  const calls = [];
  const context = new Proxy({ globalAlpha: 1, filter: "none" }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args.map(value => Math.round(value * 100) / 100)]), set: (target, key, value) => { target[key] = value; calls.push([`=${String(key)}`, value]); return true; } });
  video.drawPosed(context, box, { ...motion.REST_POSE, opacity: 0.5, y: 10, blur: 2, clip: { top: 0, right: 0.5, bottom: 0, left: 0 } }, 3, () => calls.push(["draw"]));
  assert.deepEqual(calls.find(call => call[0] === "translate"), ["translate", 450, 405], "to the centre (150, 125) and 10 units down: (150, 135) in output pixels");
  assert.deepEqual(calls.find(call => call[0] === "rect"), ["rect", -150, -75, 150, 150], "the right half cut away");
  assert.equal(context.globalAlpha, 0.5);
  assert.equal(context.filter, "blur(6px)");
  assert.ok(calls.some(call => call[0] === "draw"));
  calls.length = 0;
  video.drawPosed(context, box, { ...motion.REST_POSE, opacity: 0 }, 3, () => calls.push(["draw"]));
  assert.equal(calls.length, 0, "an invisible pose draws nothing");
});

test("the preview's keyframes are the same poses, with a wipe's cut as a clip-path", () => {
  const frames = animationKeyframes({ kind: "wipe" }, 2, box, { opacity: 0.8, filter: "" });
  assert.equal(frames[0].offset, 0);
  assert.equal(frames.at(-1).offset, 1);
  assert.equal(frames[0].clipPath, "inset(0% 100% 0% 0%)");
  assert.equal(frames[30].clipPath, "inset(0% 0% 0% 0%)", "at rest after 0.7 s");
  assert.equal(frames[30].opacity, 0.8, "the layer's own transparency is kept");
  assert.equal("clipPath" in animationKeyframes({ kind: "rise" }, 2, box, { opacity: 1, filter: "" })[0], false, "no clip on a move, so shadows aren't cut");
  assert.equal(sampleTimeline({ kind: "fade", delay: 3 }).animation.delay, 0, "a chosen tile plays at once");
});

test("the Animate panel shows None and the ten motions, and the chosen one's controls", () => {
  const html = renderToStaticMarkup(React.createElement(AnimatePanel, { elements: [text({ animation: { kind: "rise" } })], disabled: false, update() {}, pageLength: () => ({ elements: [], length: 5 }) }));
  for (const label of ["No animation", ...model.ANIMATION_KINDS.map(kind => `${motion.ANIMATION_LABELS[kind]} animation`)]) assert.ok(html.includes(`aria-label="${label}"`), label);
  assert.match(html, /aria-label="Rise animation" aria-pressed="true"/);
  for (const label of ["On enter", "Medium", "Seconds", "Direction", "Delay", "Play page"]) assert.ok(html.includes(label), label);
  assert.equal(renderToStaticMarkup(React.createElement(AnimatePanel, { elements: [text({ animation: { kind: "fade" } })], disabled: false, update() {}, pageLength: () => ({ elements: [], length: 5 }) })).includes('aria-label="Direction"'), false, "fade has no direction");
  let changed;
  const tree = AnimatePanel({ elements: [text()], disabled: false, update: (group, transform) => { changed = [group, transform(text())]; }, pageLength: () => ({ elements: [], length: 5 }) });
  const tiles = React.Children.toArray(tree.props.children[0].props.children).flat();
  tiles.find(node => node.props?.label === "Pop").props.onClick();
  assert.equal(changed[0], "animation");
  assert.deepEqual(changed[1].animation, { kind: "pop" });
});
