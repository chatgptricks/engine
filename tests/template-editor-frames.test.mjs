import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
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
const frames = loadModule("lib/template-editor/frames.ts", { "./model": model });
const commands = loadModule("lib/template-editor/commands.ts", { "./model": model });
const spans = loadModule("lib/template-editor/spanning-photos.ts", { "./model": model });
const htmlLayer = loadModule("lib/template-editor/html-layer.ts", { "./model": model });
const agent = loadModule("lib/template-editor/agent-decks.ts", { "./model": model, "./agent-video-layers": loadModule("lib/template-editor/agent-video-layers.ts", { "./model": model }), "./spanning-photos": spans, "./video-slides": loadModule("lib/template-editor/video-slides.ts", { "./model": model, "./spanning-photos": spans }), "./html-layer": htmlLayer, "./frames": frames });
const { createAgentDeck, updateAgentDeck, agentDeckView, frameCutSource, isFrameOperation, AgentDeckValidationError } = agent;

const ORIGINAL = `/api/template-editor/assets/${"a".repeat(64)}`;
const CUT = `/api/template-editor/assets/${"b".repeat(64)}`;
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const boxNear = (actual, expected, tolerance = 1e-6) => { for (const key of ["x", "y", "width", "height"]) near(actual[key], expected[key], tolerance); };

/** A w×h RGBA picture of one colour, with a square of another colour. */
function picture(width, height, background, square, ink = [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = square && x >= square.x && x < square.x + square.width && y >= square.y && y < square.y + square.height;
    data.set([...(inside ? ink : background), 255], (y * width + x) * 4);
  }
  return data;
}
const NIGHT = [11, 16, 20];

test("a frame keeps its own shape on the slide unless it is the slide's shape", () => {
  assert.deepEqual(frames.frameLayout({ width: 1080, height: 1440 }, { width: 360, height: 480 }), { x: 0, y: 0, width: 360, height: 480 });
  // Within 2% counts as the same shape and fills the slide.
  assert.deepEqual(frames.frameLayout({ width: 1080, height: 1420 }, { width: 360, height: 480 }), { x: 0, y: 0, width: 360, height: 480 });
  const wide = frames.frameLayout({ width: 1920, height: 1080 }, { width: 360, height: 480 });
  near(wide.width, 360); near(wide.height, 202.5); near(wide.x, 0); near(wide.y, (480 - 202.5) / 2);
  const tall = frames.frameLayout({ width: 1000, height: 2000 }, { width: 360, height: 480 });
  near(tall.height, 480); near(tall.width, 240); near(tall.x, 60);
});

test("slide boxes and image pixels map both ways, including a cover crop", () => {
  const frame = { original: ORIGINAL, width: 1080, height: 1440, name: "Slide", source: "editor", createdAt: "2026-11-10T00:00:00.000Z" };
  const layer = frames.frameBackgroundLayer(frame, { width: 360, height: 480 });
  assert.equal(layer.locked, true); assert.equal(layer.frameRole, "background"); assert.equal(layer.src, ORIGINAL);
  assert.deepEqual(frames.sceneToImage(layer, frame, { x: 30, y: 60, width: 120, height: 90 }), { x: 90, y: 180, width: 360, height: 270 });
  boxNear(frames.imageToScene(layer, frame, { x: 90, y: 180, width: 360, height: 270 }), { x: 30, y: 60, width: 120, height: 90 });
  // Boxes are clamped to the image.
  assert.deepEqual(frames.sceneToImage(layer, frame, { x: -10, y: 470, width: 50, height: 50 }), { x: 0, y: 1410, width: 120, height: 30 });
  // A 1080×1420 image filling a 360×480 slide (cover, centred) loses 10 px... of width at each side, in image pixels.
  const cover = { ...layer, width: 360, height: 480 }, image = { width: 1080, height: 1420 };
  const scale = 480 / 1420, drawnWidth = 1080 * scale, offset = (360 - drawnWidth) / 2;
  const mapped = frames.sceneToImage(cover, image, { x: offset + 100 * scale, y: 50 * scale, width: 200 * scale, height: 100 * scale });
  assert.deepEqual(mapped, { x: 100, y: 50, width: 200, height: 100 });
  boxNear(frames.imageToScene(cover, image, { x: 100, y: 50, width: 200, height: 100 }), { x: offset + 100 * scale, y: 50 * scale, width: 200 * scale, height: 100 * scale });
});

test("the flat background colour clears, a logo stays, and the cut trims to it", () => {
  const square = { x: 7, y: 6, width: 6, height: 5 };
  const pixels = picture(20, 18, NIGHT, square);
  assert.deepEqual(frames.borderColor(pixels, 20, 18), NIGHT);
  assert.equal(frames.hasFlatBorder(pixels, 20, 18), true);
  const keyed = frames.keyFlatBackground(pixels, 20, 18);
  assert.equal(keyed[3], 0, "the background is transparent");
  assert.equal(keyed[((8 * 20) + 9) * 4 + 3], 255, "the logo stays opaque");
  assert.deepEqual(frames.alphaBounds(keyed, 20, 18), square);
  const cropped = frames.cropPixels(keyed, 20, square);
  assert.equal(cropped.length, square.width * square.height * 4);
  assert.ok([...cropped].every((value, index) => index % 4 !== 3 || value === 255));
  // A colour between the background and the ink fades in, without the background's tint.
  const soft = picture(4, 4, NIGHT, { x: 1, y: 1, width: 1, height: 1 }, [80, 85, 90]);
  const softened = frames.keyFlatBackground(soft, 4, 4);
  const alpha = softened[(1 * 4 + 1) * 4 + 3];
  assert.ok(alpha === 255 || (alpha > 0 && alpha < 255));
  // Nothing but background leaves nothing.
  assert.equal(frames.alphaBounds(frames.keyFlatBackground(picture(8, 8, NIGHT), 8, 8), 8, 8), null);
});

test("a busy edge is not a flat background", () => {
  const noisy = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < noisy.length; i += 4) noisy.set([(i * 37) % 255, (i * 91) % 255, (i * 13) % 255, 255], i);
  assert.equal(frames.hasFlatBorder(noisy, 16, 16), false);
  near(frames.colorDistance([0, 0, 0], [0, 0, 0]), 0);
  assert.ok(frames.colorDistance([11, 16, 20], [255, 255, 255]) > 90);
  assert.equal(frames.toHex([11, 16, 20]), "#0B1014");
});

test("a page keeps its frame and layers keep their Frames role through a save", () => {
  const design = model.createBlankDesign ? model.createBlankDesign("Frames", "portrait") : null;
  assert.ok(design, "createBlankDesign exists");
  const frame = { original: ORIGINAL, width: 1080, height: 1440, name: "Proof cover", source: "agent", createdAt: "2026-11-10T00:00:00.000Z" };
  const background = frames.frameBackgroundLayer(frame, { width: 360, height: 480 });
  const page = { ...design.pages[0], frame, canvas: { background: "#0B1014", elements: [background] } };
  const library = { ...model.EMPTY_LIBRARY, designs: [{ ...design, pages: [page] }] };
  const parsed = model.parseLibrary(structuredClone(library));
  assert.ok(parsed);
  assert.deepEqual(parsed.designs[0].pages[0].frame, frame);
  assert.equal(parsed.designs[0].pages[0].canvas.elements[0].frameRole, "background");
  // Only Engine's stored images can be a frame, and only the three roles exist.
  const elsewhere = structuredClone(library); elsewhere.designs[0].pages[0].frame.original = "https://example.com/a.png";
  assert.equal(model.parseLibrary(elsewhere), null);
  const role = structuredClone(library); role.designs[0].pages[0].canvas.elements[0].frameRole = "sticker";
  assert.equal(model.parseLibrary(role), null);
});

test("a copy of the frame's background is an ordinary picture", () => {
  const frame = { original: ORIGINAL, width: 1080, height: 1440, name: "Slide", source: "editor", createdAt: "2026-11-10T00:00:00.000Z" };
  const background = { ...frames.frameBackgroundLayer(frame, { width: 360, height: 480 }), locked: false };
  const result = commands.duplicateSelection({ background: "#000", elements: [background] }, [background.id]);
  const copy = result.scene.elements.find(element => element.id !== background.id);
  assert.ok(copy);
  assert.equal(copy.frameRole, undefined);
  assert.equal(result.scene.elements.find(element => element.id === background.id).frameRole, "background");
});

const deck = () => createAgentDeck({ id: "frames-deck", name: "Frames", format: "custom", size: { width: 1080, height: 1440 }, slides: [{ id: "intro", layout: "blank" }] });
const slide = { original: ORIGINAL, width: 1080, height: 1440, name: "Proof cover", edge: "#0B1014" };

test("frame_slide adds a slide made from the image, locked at the bottom, with the original kept", () => {
  const before = deck();
  assert.equal(isFrameOperation({ op: "frame_slide" }), true);
  assert.equal(isFrameOperation({ op: "add_slide" }), false);
  assert.throws(() => updateAgentDeck(before, { operations: [{ op: "frame_slide", src: ORIGINAL }] }), error => error instanceof AgentDeckValidationError && /Engine's server/.test(error.message));
  const after = updateAgentDeck(before, { operations: [{ op: "frame_slide", src: ORIGINAL, id: "cover", index: 0 }] }, { slide });
  assert.equal(after.pages.length, before.pages.length + 1);
  const page = after.pages[0];
  assert.equal(page.id, "cover");
  assert.equal(page.label, "Proof cover");
  assert.equal(page.frame.original, ORIGINAL); assert.equal(page.frame.source, "agent");
  assert.equal(page.canvas.background, "#0B1014");
  assert.equal(page.canvas.elements.length, 1);
  const [background] = page.canvas.elements;
  assert.equal(background.type, "image"); assert.equal(background.locked, true); assert.equal(background.frameRole, "background");
  boxNear(background, { x: 0, y: 0, width: 360, height: 480 });
  assert.ok(model.parseLibrary({ ...model.EMPTY_LIBRARY, designs: [after] }), "the deck still saves");
  // The background can't be edited or removed by an agent.
  assert.throws(() => updateAgentDeck(after, { operations: [{ op: "remove_element", pageId: "cover", elementId: background.id }] }), AgentDeckValidationError);
  // The slide id can't be one already used.
  assert.throws(() => updateAgentDeck(after, { operations: [{ op: "frame_slide", src: ORIGINAL, id: "cover" }] }, { slide }), AgentDeckValidationError);
});

test("frame_cut places the cut over the part it came from, above the image", () => {
  const framed = updateAgentDeck(deck(), { operations: [{ op: "frame_slide", src: ORIGINAL, id: "cover" }] }, { slide });
  const box = { x: 72, y: 90, width: 936, height: 310 };
  const source = frameCutSource(framed, "cover", box);
  assert.deepEqual(source, { original: ORIGINAL, box: { x: 72, y: 90, width: 936, height: 310 } });
  assert.equal(frameCutSource(framed, framed.pages.find(page => page.id !== "cover").id, box), null, "only Frames slides can be cut");
  assert.throws(() => updateAgentDeck(framed, { operations: [{ op: "frame_cut", pageId: "cover", box }] }), AgentDeckValidationError);
  const trimmed = { x: 80, y: 96, width: 900, height: 300 };
  const after = updateAgentDeck(framed, { operations: [{ op: "frame_cut", pageId: "cover", id: "card", name: "Reddit card", box, removeBackground: "flat" }] }, { cut: { src: CUT, box: trimmed } });
  const elements = after.pages.find(page => page.id === "cover").canvas.elements;
  assert.equal(elements.length, 2);
  const cut = elements[1];
  assert.equal(cut.id, "card"); assert.equal(cut.name, "Reddit card"); assert.equal(cut.src, CUT); assert.equal(cut.frameRole, "cutout"); assert.equal(cut.locked, false);
  const view = agentDeckView(after).slides.find(item => item.id === "cover").elements[1];
  boxNear(view, trimmed, 1e-6);
  const plain = after.pages.find(page => page.id !== "cover");
  assert.throws(() => updateAgentDeck(after, { operations: [{ op: "frame_cut", pageId: plain.id, box }] }, { cut: { src: CUT, box: trimmed } }), error => error instanceof AgentDeckValidationError && /not a Frames slide/.test(error.message));
});

test("a wide frame sits centred on a tall slide and cuts map through its offset", () => {
  const wide = { ...slide, width: 1920, height: 1080 };
  const framed = updateAgentDeck(deck(), { operations: [{ op: "frame_slide", src: ORIGINAL, id: "wide" }] }, { slide: wide });
  const background = framed.pages.find(page => page.id === "wide").canvas.elements[0];
  near(background.width, 360); near(background.height, 202.5); near(background.y, (480 - 202.5) / 2);
  // The image's top-left quarter, in slide pixels: x 0–540, y from the image's top.
  const top = (1440 - 607.5) / 2;
  const source = frameCutSource(framed, "wide", { x: 0, y: top, width: 540, height: 303.75 });
  assert.deepEqual(source.box, { x: 0, y: 0, width: 960, height: 540 });
});

// ---------- The MCP bridge's Frames tools ----------
const script = path.join(root, "scripts/engine-agent-mcp.mjs");
const token = "test-only-engine-agent-secret";
async function server(t, handler) {
  const calls = [];
  const instance = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const json = request.headers["content-type"] === "application/json";
    const entry = { method: request.method, path: request.url, headers: request.headers, body: json && raw.length ? JSON.parse(raw.toString("utf8")) : null, bytes: raw };
    calls.push(entry);
    await handler(entry, response);
  });
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return { calls, url: `http://127.0.0.1:${instance.address().port}` };
}
const reply = (response, body, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
function client(t, url) {
  const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env, ENGINE_URL: url, ENGINE_AGENT_TOKEN: token }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let buffer = "", id = 1;
  const waiting = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) { const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); waiting.get(value.id)?.(value); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const mine = id++, timer = setTimeout(() => reject(new Error("MCP timed out")), 5000);
    waiting.set(mine, value => { clearTimeout(timer); resolve(value); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: mine, method, params })}\n`);
  });
  return {
    init: () => request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Frames tests", version: "1" } }),
    call: (name, args) => request("tools/call", { name, arguments: args }),
    close: async () => { child.stdin.end(); if (child.exitCode === null) await once(child, "exit"); },
  };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

test("engine_frame_upload reads only a real picture the agent names, uploads it, and adds the slide", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frames-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const good = path.join(directory, "cover.png"), fake = path.join(directory, "notes.png"), text = path.join(directory, "secret.txt");
  fs.writeFileSync(good, PNG); fs.writeFileSync(fake, "not a picture at all"); fs.writeFileSync(text, "secret");
  const view = { slides: [{ id: "intro", background: "#fff", elements: [] }, { id: "frame-1a2b3c4d", background: "#0B1014", elements: [{ id: "bg", name: "Original image", x: 0, y: 0, width: 1080, height: 1440, locked: true }] }] };
  const api = await server(t, (entry, response) => {
    if (entry.path === "/api/agent/assets") return reply(response, { src: ORIGINAL, width: 1080, height: 1440 }, 201);
    if (entry.body?.action === "capabilities") return reply(response, {});
    if (entry.body?.action === "get_deck") return reply(response, { hash: "h1", view });
    return reply(response, { hash: "h2", editorUrl: "/admin/engine?design=deck-1", view });
  });
  const mcp = client(t, api.url);
  await mcp.init();
  for (const [args, message] of [
    [{ deckId: "deck-1", path: "cover.png" }, /absolute path/],
    [{ deckId: "deck-1", path: text }, /absolute path/],
    [{ deckId: "deck-1" }, /either path or dataUrl/],
  ]) {
    const refused = await mcp.call("engine_frame_upload", args);
    assert.match(refused.error?.message ?? "", message);
  }
  const fakeResult = await mcp.call("engine_frame_upload", { deckId: "deck-1", path: fake });
  assert.equal(fakeResult.result.isError, true);
  assert.match(fakeResult.result.structuredContent.error, /not the picture/);
  assert.equal(api.calls.filter(call => call.path === "/api/agent/assets").length, 0, "nothing was uploaded for refused files");
  const operationId = "1a2b3c4d-1234-1234-1234-123456789abc";
  const done = await mcp.call("engine_frame_upload", { deckId: "deck-1", path: good, operationId });
  assert.equal(done.result.isError, false, JSON.stringify(done.result));
  const uploads = api.calls.filter(call => call.path === "/api/agent/assets");
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].bytes, PNG);
  assert.equal(uploads[0].headers.authorization, `Bearer ${token}`);
  const update = api.calls.find(call => call.body?.action === "update_deck");
  assert.equal(update.body.expectedHash, "h1", "without expectedHash the bridge reads the current hash");
  assert.equal(update.body.operationId, operationId);
  assert.deepEqual(update.body.changes.operations, [{ op: "frame_slide", src: ORIGINAL, id: "frame-1a2b3c4d", name: "cover" }]);
  assert.equal(done.result.structuredContent.slideId, "frame-1a2b3c4d");
  assert.equal(done.result.structuredContent.hash, "h2");
  await mcp.close();
});

test("engine_frame_view returns the picture itself, and engine_frame_cut sends one frame_cut", async (t) => {
  const view = { slides: [{ id: "cover", elements: [{ id: "bg" }, { id: "card", name: "Card", x: 72, y: 90, width: 936, height: 310 }] }] };
  const api = await server(t, (entry, response) => {
    if (entry.body?.action === "frame_view") return reply(response, { image: { base64: PNG.toString("base64"), mimeType: "image/png" }, shown: { width: 1, height: 1 }, imageOnSlide: { x: 0, y: 0, width: 1080, height: 1440 } });
    return reply(response, { hash: "h3", editorUrl: "/e", view });
  });
  const mcp = client(t, api.url);
  await mcp.init();
  const looked = await mcp.call("engine_frame_view", { deckId: "deck-1", slideId: "cover", box: { x: 0, y: 0, width: 540, height: 720 } });
  assert.equal(looked.result.content[0].type, "image");
  assert.equal(looked.result.content[0].mimeType, "image/png");
  assert.equal(looked.result.content[0].data, PNG.toString("base64"));
  assert.deepEqual(looked.result.structuredContent.imageOnSlide, { x: 0, y: 0, width: 1080, height: 1440 });
  assert.deepEqual(api.calls.at(-1).body, { action: "frame_view", deckId: "deck-1", pageId: "cover", box: { x: 0, y: 0, width: 540, height: 720 } });
  const badBox = await mcp.call("engine_frame_cut", { deckId: "deck-1", expectedHash: "h2", slideId: "cover", box: { x: 0, y: 0, width: 0, height: 10 } });
  assert.match(badBox.error.message, /box/);
  const cut = await mcp.call("engine_frame_cut", { deckId: "deck-1", expectedHash: "h2", slideId: "cover", box: { x: 72, y: 90, width: 936, height: 310 }, name: "Card", removeBackground: "flat" });
  assert.equal(cut.result.isError, false);
  const sent = api.calls.at(-1).body;
  assert.equal(sent.action, "update_deck"); assert.equal(sent.expectedHash, "h2");
  assert.match(sent.operationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(sent.changes.operations, [{ op: "frame_cut", pageId: "cover", box: { x: 72, y: 90, width: 936, height: 310 }, name: "Card", removeBackground: "flat" }]);
  assert.deepEqual(cut.result.structuredContent.layer, { id: "card", name: "Card", x: 72, y: 90, width: 936, height: 310 });
  await mcp.close();
});
