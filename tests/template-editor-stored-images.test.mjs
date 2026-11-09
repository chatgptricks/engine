/* Run: node --test tests/template-editor-stored-images.test.mjs
 * Images agents put into posts are stored as media files, and posts point to
 * them (lib/template-editor/stored-images.ts): the conversion, dedupe, SVG
 * logos, what stays embedded, each write path (agent API, Recreate's save,
 * the chat's edits), every reader that runs in node, and the migration
 * script for existing posts. Media storage is the real one on disk; only
 * sign-in and Supabase are faked. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createHash, randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import sharp from "sharp";
import JSZip from "jszip";
import {PDFDocument, PDFDict, PDFName, PDFRawStream} from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const run = promisify(execFile);
const OWNER = "owner-a";

/** The chat's tools reach Recreate, Apify and Claude; those parts are stubbed (as in the chat's own tests). */
const CHAT_STUBS = {
  "@/lib/engine/agents/orchestrator": {startRecreate: async () => assert.fail("unused"), approveRecreate: async () => assert.fail("unused"), rerunRecreateStage: async () => assert.fail("unused"), addRecreatePosts: async () => assert.fail("unused"), isRunning: () => false},
  "@/lib/engine/agents/research": {photoSize: async () => ({width: 1200, height: 800})},
  "@/lib/engine/apify": {searchXImages: async () => []},
  "@/lib/engine/brand-actions": {checkAgainstGuide: async () => assert.fail("unused"), htmlTokensForDeck: async () => ({})},
  "@/lib/engine/headline-model": {isHeadlineModelConfigured: () => false, requestHeadlines: async () => assert.fail("unused")},
  "@/lib/engine/image-curator": {curateImages: async images => images},
  "@/lib/engine/page-profiles": {listPageProfiles: async () => []},
  "@/lib/engine/recreate-jobs": {postView: () => assert.fail("unused")},
  "@/lib/engine/slide-render": {renderSlides: async () => null},
};

function fixture(t, {overrides = {}, env = {NODE_ENV: "test"}} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "engine-stored-images-test-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  // PDF fonts and built-in artwork are read from the working folder.
  for (const folder of ["assets", "public"]) if (fs.existsSync(path.join(root, folder))) fs.symlinkSync(path.join(root, folder), path.join(directory, folder));
  const environment = {cwd: () => directory, env};
  const all = {
    "@/lib/engine/member": {resolveEngineAccess: async () => ({kind: "owner", ownerKey: OWNER})},
    "@/lib/supabase/admin": {getAdminSupabase: () => null},
    "server-only": {},
    ...overrides,
  };
  const cache = new Map();
  function load(relative) {
    const filename = path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const unit = {exports: {}};
    cache.set(filename, unit);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX}, fileName: filename,
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`, {filename})(name => {
      if (Object.hasOwn(all, name)) return all[name];
      const local = name.startsWith("@/") ? path.join(root, name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(filename), name) : null;
      if (local) {
        const target = [`${local}.ts`, `${local}.tsx`, local, path.join(local, "index.ts")].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (!target) throw Error(`Unresolved local dependency ${name} from ${relative}`);
        return load(path.relative(root, target));
      }
      return nativeRequire(name);
    }, unit, unit.exports, environment);
    return unit.exports;
  }
  const media = path.join(directory, ".engine-dev", "template-editor-media");
  return {directory, load, mediaFiles: () => fs.existsSync(media) ? fs.readdirSync(media).filter(name => name.endsWith(".json")).sort() : []};
}

// A photo cut and a chart as Recreate makes them (noise keeps them photo-sized), and two logos.
const photo = await sharp({create: {width: 1080, height: 1350, channels: 3, noise: {type: "gaussian", mean: 128, sigma: 50}}}).jpeg({quality: 82}).toBuffer();
const chart = await sharp({create: {width: 540, height: 360, channels: 3, noise: {type: "gaussian", mean: 90, sigma: 25}}}).png().toBuffer();
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><path d="M0 0H120V40H0Z" fill="#76B900"/><path d="M10 10H50V30H10Z" fill="#FFFFFF"/></svg>';
const SECOND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M0 0H64V64H0Z" fill="#D97757"/></svg>';
const dataUrl = (type, bytes) => `data:${type};base64,${bytes.toString("base64")}`;
const svgUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const PHOTO = dataUrl("image/jpeg", photo), CHART = dataUrl("image/png", chart), LOGO = svgUrl(LOGO_SVG), SECOND_LOGO = svgUrl(SECOND_SVG);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stored = bytes => `/api/template-editor/assets/${sha(typeof bytes === "string" ? Buffer.from(bytes) : bytes)}`;
const imagesOf = document => document.pages.flatMap(page => page.canvas.elements.filter(element => element.type === "image").map(element => element.src));
const blank = elements => ({id: "s1", layout: "blank", elements});
const image = (id, src, x, y, width, height) => ({id, type: "image", src, x, y, width, height});

test("data: images wherever a post keeps them become stored media paths, each stored once", async t => {
  const f = fixture(t), images = f.load("lib/template-editor/stored-images.ts"), media = f.load("lib/template-editor/media-storage.ts");
  const untouched = {type: "text", text: "No images here"};
  const value = {
    pages: [{canvas: {elements: [
      {type: "image", src: PHOTO, previewSrc: CHART},
      {type: "shape", imageFill: {src: PHOTO}},
      {type: "text", wordTextures: [{id: "t1", src: CHART}]},
      {type: "html", html: `<img src="${PHOTO}" alt="">`, css: `.chart{background:url(${CHART}) center/cover}`},
      untouched,
    ]}}],
    brand: {url: LOGO},
    operations: [{op: "update_slide", slots: {"cover-photo": PHOTO}}],
  };
  const result = await images.storeEmbeddedImages(OWNER, value);
  assert.deepEqual({stored: result.stored, reused: result.reused, kept: result.kept, failed: result.failed}, {stored: 3, reused: 0, kept: 0, failed: 0});
  assert.equal(result.bytes, PHOTO.length + CHART.length + LOGO.length);
  const [picture, shape, text, html] = result.value.pages[0].canvas.elements;
  assert.deepEqual([picture.src, picture.previewSrc, shape.imageFill.src, text.wordTextures[0].src], [stored(photo), stored(chart), stored(photo), stored(chart)]);
  assert.equal(html.html, `<img src="${stored(photo)}" alt="">`);
  assert.equal(html.css, `.chart{background:url(${stored(chart)}) center/cover}`);
  assert.equal(result.value.brand.url, stored(LOGO_SVG));
  assert.equal(result.value.operations[0].slots["cover-photo"], stored(photo), "photo slots in an agent's edits");
  assert.equal(JSON.stringify(result.value).includes("data:image/"), false);
  assert.equal(result.value.pages[0].canvas.elements[4], untouched, "parts without images stay the same objects");
  assert.equal(value.pages[0].canvas.elements[0].src, PHOTO, "the value passed in is not changed");
  // The originals are the exact bytes, in Engine's media storage, once each.
  const original = await media.readOriginalAsset(OWNER, sha(photo));
  assert.ok(original.data.equals(photo));
  assert.deepEqual([original.mimeType, original.width, original.height], ["image/jpeg", 1080, 1350]);
  assert.equal(f.mediaFiles().length, 3);
  const again = await images.storeEmbeddedImages(OWNER, {src: PHOTO});
  assert.deepEqual([again.stored, again.reused, again.value.src], [0, 1, stored(photo)], "the same image in another post is not written again");
  assert.equal(f.mediaFiles().length, 3);
  assert.equal(await media.readOriginalAsset("owner-b", sha(photo)), null, "each workspace keeps its own media");
});

test("a save's retries reuse what it learned, and at most four images are stored at a time", async t => {
  const f = fixture(t), images = f.load("lib/template-editor/stored-images.ts");
  t.mock.method(console, "warn", () => {});
  let active = 0, peak = 0;
  const calls = {has: 0, store: 0};
  const store = {
    has: async () => { calls.has++; return false; },
    store: async (_owner, data) => { calls.store++; active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return {id: sha(data)}; },
  };
  const pictures = await Promise.all(Array.from({length: 10}, (_, index) => sharp({create: {width: 8, height: 8, channels: 3, background: {r: index * 20, g: 40, b: 60}}}).png().toBuffer()));
  const value = pictures.map(bytes => ({src: dataUrl("image/png", bytes)})), cache = new Map();
  const first = await images.storeEmbeddedImages(OWNER, [...value, ...value], {cache, store});
  assert.deepEqual([first.stored, calls.has, calls.store], [10, 10, 10], "an image used twice is stored once");
  assert.ok(peak > 1 && peak <= 4, `four at a time, not ${peak}`);
  const retry = await images.storeEmbeddedImages(OWNER, value, {cache, store});
  assert.deepEqual([retry.stored, retry.reused, calls.has, calls.store], [0, 10, 10, 10], "a retry of the same save asks the store nothing");
  assert.deepEqual(retry.value.map(item => item.src), pictures.map(stored));
  const wrong = await images.storeEmbeddedImages(OWNER, {src: PHOTO}, {store: {has: async () => false, store: async () => ({id: "f".repeat(64)})}});
  assert.deepEqual([wrong.value.src, wrong.failed], [PHOTO, 1], "a store that answers with another image's id leaves the image embedded");
});

test("template artwork, photo-slot placeholders and images the library already holds stay embedded", async t => {
  const f = fixture(t), images = f.load("lib/template-editor/stored-images.ts"), model = f.load("lib/template-editor/model.ts"), decks = f.load("lib/template-editor/agent-decks.ts");
  const refuse = {has: async () => false, store: async () => assert.fail("template artwork must not be stored")};
  for (const template of model.BUILT_IN_TEMPLATES) {
    const deck = decks.createAgentDeck({name: template.name, templateId: template.id});
    const result = await images.storeNewImages(OWNER, deck, model.EMPTY_LIBRARY, undefined, refuse);
    assert.equal(result.value, deck, `${template.name} keeps its artwork inline`);
    assert.equal(result.kept, images.embeddedImages(deck).size);
  }
  // A placeholder an older version of a template drew is still a placeholder: code finds empty slots by their data: SVG.
  const placeholder = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="920" height="917" viewBox="0 0 920 917"><path d="M0 0H920V917H0Z" fill="#1A242B"/></svg>');
  assert.equal(images.templateArtwork().has(placeholder), false);
  const slot = {type: "image", templateRole: "media", slot: "media", src: placeholder};
  assert.equal((await images.storeNewImages(OWNER, {elements: [slot]}, model.EMPTY_LIBRARY, undefined, refuse)).value.elements[0].src, placeholder);
  const layer = await images.storeNewImages(OWNER, {elements: [{type: "image", src: placeholder}]}, model.EMPTY_LIBRARY);
  assert.equal(layer.value.elements[0].src, stored(decodeURIComponent(placeholder.slice(placeholder.indexOf(",") + 1))), "the same picture as a plain layer moves");
  // Images the library already holds stay as they are; only the migration script moves existing posts.
  const library = {...model.EMPTY_LIBRARY, designs: [{pages: [{canvas: {elements: [{type: "image", src: PHOTO}]}}]}]};
  const edit = await images.storeNewImages(OWNER, {src: PHOTO, logo: {src: LOGO}}, library);
  assert.deepEqual([edit.value.src, edit.value.logo.src, edit.kept, edit.stored], [PHOTO, stored(LOGO_SVG), 1, 1]);
});

test("SVG logos are stored as SVG, read back intact, served sandboxed and never rasterized", async t => {
  const f = fixture(t), media = f.load("lib/template-editor/media-storage.ts"), route = f.load("app/api/template-editor/assets/[id]/route.ts");
  const logo = await media.storeOriginalAsset(OWNER, Buffer.from(LOGO_SVG), "Logo");
  assert.deepEqual([logo.id, logo.mimeType, logo.width, logo.height], [sha(Buffer.from(LOGO_SVG)), "image/svg+xml", 120, 40]);
  assert.deepEqual(await Promise.all([logo.id, "0".repeat(64), "../escape"].map(id => media.hasOriginalAsset(OWNER, id))), [true, false, false]);
  const read = await media.readOriginalAsset(OWNER, logo.id);
  assert.equal(read.data.toString("utf8"), LOGO_SVG);
  const rendition = await media.originalRendition(read, 1080);
  assert.equal(rendition.mimeType, "image/svg+xml");
  assert.ok(rendition.data.equals(read.data), "a vector's export rendition is the vector");
  const get = (id, query = "") => route.GET(new Request(`https://engine.example/api/template-editor/assets/${id}${query}`), {params: Promise.resolve({id})});
  for (const query of ["", "?maxDimension=1080"]) {
    const response = await get(logo.id, query);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy"), /^default-src 'none';.*sandbox$/, "opened on its own, it can't run or load anything");
    assert.equal(await response.text(), LOGO_SVG);
  }
  const raster = await media.storeOriginalAsset(OWNER, chart, "Chart"), photoResponse = await get(raster.id, "?maxDimension=200");
  assert.equal(photoResponse.headers.get("content-type"), "image/webp");
  assert.equal(photoResponse.headers.get("content-security-policy"), null);
  for (const markup of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><path d="M0 0H10V10Z"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.com/a.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>path{fill:red}</style><path d="M0 0H10V10Z"/></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    "<html><body>Not an image</body></html>",
  ]) await assert.rejects(media.storeOriginalAsset(OWNER, Buffer.from(markup), "Markup"), TypeError, markup);
  // A record changed on disk to active markup doesn't read back.
  const unsafe = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
  const file = path.join(f.directory, ".engine-dev", "template-editor-media", f.mediaFiles().find(name => JSON.parse(fs.readFileSync(path.join(f.directory, ".engine-dev", "template-editor-media", name), "utf8")).id === logo.id));
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({...record, id: sha(Buffer.from(unsafe)), bytes: Buffer.byteLength(unsafe), base64: Buffer.from(unsafe).toString("base64")}));
  await assert.rejects(media.readOriginalAsset(OWNER, logo.id), /damaged|could not be read/);
});

test("images the store doesn't take stay embedded and the save goes on", async t => {
  const f = fixture(t), images = f.load("lib/template-editor/stored-images.ts");
  const warn = t.mock.method(console, "warn", () => {});
  const kept = {
    gif: dataUrl("image/gif", Buffer.from("GIF89a-not-stored")),
    avif: dataUrl("image/avif", Buffer.from("avif-not-stored")),
    fake: dataUrl("image/png", Buffer.from("not really a png")),
    base64Svg: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`,
    textSvg: svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>1</text></svg>'),
  };
  const result = await images.storeEmbeddedImages(OWNER, {...Object.fromEntries(Object.entries(kept).map(([key, src]) => [key, {src}])), photo: {src: PHOTO}});
  for (const [key, src] of Object.entries(kept)) assert.equal(result.value[key].src, src, key);
  assert.equal(result.value.photo.src, stored(photo));
  assert.deepEqual([result.stored, result.failed], [1, 5]);
  assert.equal(warn.mock.callCount(), 1, "one line for the save, not one per image");
  assert.match(warn.mock.calls[0].arguments[0], /^\[stored-images\] \d image\(s\) stay embedded: /);
  assert.equal(f.mediaFiles().length, 1, "only the photo was written");
});

test("an agent's new post with a photo cut, a chart and logos adds a few hundred bytes of images to the library budget", async t => {
  const f = fixture(t), route = f.load("app/api/agent/slides/route.ts"), persistence = f.load("lib/template-editor/persistence.ts"), budget = f.load("lib/template-editor/library-budget.ts"), model = f.load("lib/template-editor/model.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const spec = {name: "Recreated X post", format: "portrait", slides: [blank([
    image("cut", PHOTO, 0, 0, 1080, 1350), image("chart", CHART, 60, 700, 960, 640),
    image("logo-1", LOGO, 60, 60, 240, 80), image("logo-2", SECOND_LOGO, 320, 60, 80, 80),
  ])]};
  const before = budget.checkLibrarySaveBudget((await persistence.getEditorLibrary(OWNER)).library);
  const operationId = randomUUID(), response = await post({action: "create_deck", spec, operationId});
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  assert.deepEqual(imagesOf(created.document), [stored(photo), stored(chart), stored(LOGO_SVG), stored(SECOND_SVG)]);
  const {library} = await persistence.getEditorLibrary(OWNER), after = budget.checkLibrarySaveBudget(library);
  // The same post with its images embedded, as agents' posts were saved before.
  const sources = new Map([[stored(photo), PHOTO], [stored(chart), CHART], [stored(LOGO_SVG), LOGO], [stored(SECOND_SVG), SECOND_LOGO]]);
  const embeddedDeck = {...created.document, pages: created.document.pages.map(page => ({...page, canvas: {...page.canvas, elements: page.canvas.elements.map(element => element.type === "image" ? {...element, src: sources.get(element.src)} : element)}}))};
  const embedded = budget.checkLibrarySaveBudget({...library, designs: [embeddedDeck]});
  const paths = imagesOf(created.document).reduce((sum, src) => sum + JSON.stringify(src).length, 0);
  t.diagnostic(`library budget: +${after.bytes - before.bytes} bytes for the post (${paths} of them image paths); embedded it was +${embedded.bytes - before.bytes}`);
  assert.ok(paths < 500, `${paths} bytes of image paths`);
  assert.ok(after.bytes - before.bytes < 20_000, `the post adds ${after.bytes - before.bytes} bytes`);
  assert.ok(embedded.bytes - after.bytes > PHOTO.length + CHART.length, "embedded, the same images cost their full size");
  assert.equal(f.mediaFiles().length, 4);
  // A retry replays, and a second post with the same cut stores nothing new.
  const replay = await post({action: "create_deck", spec, operationId});
  assert.equal((await replay.json()).replayed, true);
  const second = await post({action: "create_deck", spec: {name: "Same cut", format: "portrait", slides: [blank([image("cut", PHOTO, 0, 0, 1080, 1350)])]}, operationId: randomUUID()});
  assert.equal(second.status, 201);
  assert.deepEqual(imagesOf((await second.json()).document), [stored(photo)]);
  assert.equal(f.mediaFiles().length, 4, "each image is stored once");
  // Reading, editing and exporting the post keep the paths.
  const read = await (await post({action: "get_deck", deckId: created.document.id})).json();
  assert.deepEqual(imagesOf(read.document), imagesOf(created.document));
  const updated = await post({action: "update_deck", deckId: created.document.id, expectedHash: read.hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: "s1", elementId: "logo-2", properties: {src: CHART}}]}});
  assert.equal(updated.status, 200, await updated.clone().text());
  assert.equal(imagesOf((await updated.json()).document)[3], stored(chart), "an update's new image is stored too");
  const exported = await (await post({action: "export_deck", deckId: created.document.id})).json();
  assert.deepEqual(imagesOf(model.parseLibrary(exported.package).designs[0]), [stored(photo), stored(chart), stored(LOGO_SVG), stored(chart)]);
});

test("Recreate's save stores a deck's images, and the live post, copies and templates keep the paths", async t => {
  const f = fixture(t), deck = f.load("lib/engine/agents/deck.ts"), decks = f.load("lib/template-editor/agent-decks.ts"), persistence = f.load("lib/template-editor/persistence.ts");
  const collaboration = f.load("lib/template-editor/collaboration-document.ts"), model = f.load("lib/template-editor/model.ts"), advanced = f.load("lib/template-editor/advanced.ts"), budget = f.load("lib/template-editor/library-budget.ts");
  const built = decks.createAgentDeck({name: "Exact copy", format: "portrait", slides: [blank([image("cut", PHOTO, 0, 0, 1080, 1350), image("logo", LOGO, 60, 60, 240, 80)])]});
  const result = await deck.saveDeck(OWNER, built);
  assert.ok(result.saved, JSON.stringify(result.held));
  const paths = [stored(photo), stored(LOGO_SVG)];
  assert.deepEqual(imagesOf(result.saved), paths);
  const {library} = await persistence.getEditorLibrary(OWNER);
  assert.deepEqual(imagesOf(library.designs[0]), paths);
  assert.ok(budget.checkLibrarySaveBudget(library).bytes < 20_000);
  // The live collaboration room seeds from and saves back the paths.
  const live = await persistence.getCollaborationDocument(OWNER, result.saved.id);
  assert.deepEqual(imagesOf(live.document), paths);
  const room = collaboration.createCollaborationDocument(live.document);
  try { assert.deepEqual(imagesOf(collaboration.readCollaborationDocument(room)), paths); } finally { room.destroy(); }
  // Duplicating the post, saving it as a template and starting a post from that template.
  assert.deepEqual(imagesOf(model.cloneDesign(result.saved)), paths);
  const template = model.designAsTemplate(result.saved, "From a recreated post");
  assert.deepEqual(template.pages.flatMap(page => page.canvas.elements.filter(element => element.type === "image").map(element => element.src)), paths);
  assert.deepEqual(imagesOf(advanced.instantiateTemplate(template, {})), paths);
  const parsed = model.parseLibrary({...library, templates: [template]});
  assert.ok(parsed, "a library with stored images in posts and templates parses");
  assert.deepEqual(imagesOf(parsed.designs[0]), paths);
});

test("a photo the chat adds is stored before the edit reaches the editor or the live post", async t => {
  const f = fixture(t, {overrides: CHAT_STUBS}), tools = f.load("lib/engine/assistant/tools.ts"), persistence = f.load("lib/template-editor/persistence.ts");
  const decks = f.load("lib/template-editor/agent-decks.ts"), model = f.load("lib/template-editor/model.ts");
  const document = decks.createAgentDeck({id: "deck-1", name: "AI vs Jobs", format: "portrait", slides: [{title: "AI is taking jobs fast", body: "Here is why"}]});
  await persistence.saveEditorLibrary(OWNER, {...model.EMPTY_LIBRARY, designs: [document]}, null);
  const editPost = tools.CHAT_TOOLS.find(tool => tool.name === "edit_post"), pageId = document.pages[0].id, cards = [];
  const context = applyInEditor => ({ownerKey: OWNER, deckId: "deck-1", uploads: new Map([["p1", {dataUrl: PHOTO}]]), card: card => cards.push(card), ...(applyInEditor ? {applyInEditor} : {})});
  const sent = [];
  await editPost.run({changes: ["Photo added"], operations: [{op: "add_element", pageId, element: {id: "photo", type: "image", src: "upload:p1", x: 0, y: 600, width: 1080, height: 700}}]}, context(async operations => { sent.push(operations); return {applied: true}; }));
  assert.equal(sent[0][0].element.src, stored(photo), "the editor gets the stored path, not the photo's bytes");
  await editPost.run({changes: ["Chart added"], operations: [{op: "add_element", pageId, element: {id: "chart", type: "image", src: CHART, x: 60, y: 700, width: 960, height: 640}}]}, context());
  const live = await persistence.getCollaborationDocument(OWNER, "deck-1");
  assert.equal(live.document.pages[0].canvas.elements.find(element => element.id === "chart").src, stored(chart));
  assert.deepEqual(cards.map(card => card.applied), ["editor", "server"]);
  assert.equal(f.mediaFiles().length, 2);
});

test("PDF export draws stored photos and logos the way it drew them embedded", async t => {
  const f = fixture(t), media = f.load("lib/template-editor/media-storage.ts"), model = f.load("lib/template-editor/model.ts"), pdf = f.load("lib/template-editor/pdf-document.ts");
  await media.storeOriginalAsset(OWNER, photo, "Photo");
  await media.storeOriginalAsset(OWNER, Buffer.from(LOGO_SVG), "Logo");
  const design = (photoSrc, logoSrc) => {
    const value = model.createBlankDesign("Stored images", "portrait");
    value.pages[0].canvas = {background: "#ffffff", elements: [
      {...model.createCanvasElement("image"), id: "photo", src: photoSrc, x: 0, y: 0, width: 360, height: 450, fit: "cover", intrinsicWidth: 1080, intrinsicHeight: 1350},
      {...model.createCanvasElement("image"), id: "logo", src: logoSrc, x: 20, y: 20, width: 120, height: 40, fit: "contain", intrinsicWidth: 120, intrinsicHeight: 40},
    ]};
    return value;
  };
  const pictures = async bytes => {
    const document = await PDFDocument.load(bytes), found = [];
    for (const page of document.getPages()) {
      const objects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
      for (const key of objects?.keys() ?? []) {
        const object = document.context.lookup(objects.get(key));
        if (object instanceof PDFRawStream) found.push([object.dict.get(PDFName.of("Subtype"))?.toString(), object.dict.get(PDFName.of("Width"))?.toString(), object.dict.get(PDFName.of("Height"))?.toString()]);
      }
    }
    return found.sort();
  };
  const embedded = design(PHOTO, LOGO), saved = design(stored(photo), stored(LOGO_SVG));
  const [before, after] = await Promise.all([embedded, saved].map(value => pdf.renderDocumentPdf(value, value.pages[0].id, {widthMm: 100, dpi: 150}, OWNER)));
  const expected = await pictures(before);
  assert.ok(expected.length >= 1, "the embedded version has its pictures");
  assert.deepEqual(await pictures(after), expected);
});

test("PNG export confirms stored images' sizes and asks for photos at export size and logos as vectors", async t => {
  const f = fixture(t), media = f.load("lib/template-editor/media-storage.ts"), model = f.load("lib/template-editor/model.ts"), advanced = f.load("lib/template-editor/advanced.ts");
  const sizes = f.load("lib/template-editor/export-dimensions.ts"), renditions = f.load("lib/template-editor/export-renditions.ts");
  const metadata = f.load("app/api/template-editor/assets/metadata/route.ts"), assets = f.load("app/api/template-editor/assets/[id]/route.ts");
  await media.storeOriginalAsset(OWNER, photo, "Photo");
  await media.storeOriginalAsset(OWNER, Buffer.from(LOGO_SVG), "Logo");
  const placeholder = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path d="M0 0H100V100H0Z" fill="#1A242B"/></svg>');
  const design = model.createBlankDesign("Export", "portrait");
  design.pages[0].canvas = {background: "#ffffff", elements: [
    {...model.createCanvasElement("image"), id: "photo", src: stored(photo), x: 0, y: 0, width: 360, height: 450, fit: "cover"},
    {...model.createCanvasElement("image"), id: "logo", src: stored(LOGO_SVG), x: 20, y: 20, width: 120, height: 40, fit: "contain"},
    {...model.createCanvasElement("image"), id: "placeholder", src: placeholder, x: 200, y: 300, width: 100, height: 100, fit: "cover", intrinsicWidth: 100, intrinsicHeight: 100},
  ]};
  // The editor asks the metadata route for sizes it doesn't have, as the export does.
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { asked.push(JSON.parse(init.body).src); return metadata.POST(new Request(`https://engine.example${url}`, init)); });
  const sized = await sizes.prepareExportDimensions(design, [design.pages[0].id]);
  assert.deepEqual(asked.sort(), [stored(LOGO_SVG), stored(photo)].sort());
  const elements = sized.pages[0].canvas.elements;
  assert.deepEqual(elements.map(element => [element.intrinsicWidth, element.intrinsicHeight]), [[1080, 1350], [120, 40], [100, 100]]);
  const prepared = renditions.prepareExportScene(advanced.composeScene(sized, sized.pages[0]), 3);
  assert.match(prepared.sources.get(stored(photo)), /^\/api\/template-editor\/assets\/[a-f0-9]{64}\?maxDimension=\d+$/);
  assert.match(prepared.sources.get(stored(LOGO_SVG)), /\?maxDimension=\d+$/);
  assert.equal(prepared.sources.has(placeholder), false, "inline SVGs need no rendition");
  const fetchRendition = async source => { const url = new URL(source, "https://engine.example"), id = url.pathname.split("/").pop(); return assets.GET(new Request(url), {params: Promise.resolve({id})}); };
  const logo = await fetchRendition(prepared.sources.get(stored(LOGO_SVG)));
  assert.equal(logo.headers.get("content-type"), "image/svg+xml");
  assert.equal(await logo.text(), LOGO_SVG, "the logo reaches the export as a vector");
  const cut = await fetchRendition(prepared.sources.get(stored(photo)));
  assert.equal(cut.headers.get("content-type"), "image/webp");
  const {width, height} = await sharp(Buffer.from(await cut.arrayBuffer())).metadata();
  assert.ok(width <= 1080 && height <= 1350 && width > 0);
});

test("HTML layers, review links and backups read stored images", async t => {
  const f = fixture(t), media = f.load("lib/template-editor/media-storage.ts"), html = f.load("lib/template-editor/html-layer.ts"), images = f.load("lib/template-editor/stored-images.ts");
  const review = f.load("lib/template-editor/review-assets.ts"), archive = f.load("lib/template-editor/media-archive.ts");
  // An HTML layer's data: images are stored, and the cleaner keeps the paths.
  const layer = (await images.storeEmbeddedImages(OWNER, {html: `<img src="${PHOTO}" alt="Cut">`, css: `.bg{background-image:url(${CHART})}`})).value;
  assert.equal(html.isHtmlLayerImageSource(stored(photo)), true);
  assert.equal(html.isHtmlLayerImageSource(`${stored(photo)}?maxDimension=1080`), true);
  const cleaned = html.cleanHtmlLayer(layer);
  assert.ok(cleaned.html.includes(`src="${stored(photo)}"`), cleaned.html);
  assert.ok(cleaned.css.includes(stored(chart)), cleaned.css);
  // A review link freezes stored photos as WebP and stored logos as the inline SVG they were.
  await media.storeOriginalAsset(OWNER, Buffer.from(LOGO_SVG), "Logo");
  const frozen = await review.embedReviewImages({elements: [{src: stored(photo)}, {src: stored(LOGO_SVG)}]}, OWNER);
  assert.match(frozen.elements[0].src, /^data:image\/webp;base64,/);
  assert.equal(frozen.elements[1].src, LOGO);
  // A portable backup made while the logo was stored restores it in another workspace's checkout.
  const restore = fixture(t), restored = restore.load("lib/template-editor/media-storage.ts"), restoreArchive = restore.load("lib/template-editor/media-archive.ts"), restoreUpload = restore.load("app/api/template-editor/assets/route.ts");
  const id = sha(Buffer.from(LOGO_SVG)), library = {schemaVersion: 2, designs: [{id: "post", pages: [{canvas: {elements: [{type: "image", src: stored(LOGO_SVG)}]}}]}], templates: []};
  const zip = new JSZip();
  zip.file("library.json", await archive.packPortableLibrary(library));
  zip.file(`assets/${id}`, LOGO_SVG);
  zip.file("manifest.json", JSON.stringify({version: 1, assets: [{id, path: `assets/${id}`, mimeType: "image/svg+xml", bytes: Buffer.byteLength(LOGO_SVG)}]}));
  const file = new File([await zip.generateAsync({type: "uint8array", compression: "STORE"})], "backup.engine.zip");
  t.mock.method(globalThis, "fetch", async (url, init) => restoreUpload.POST(new Request(`https://engine.example${url}`, init)));
  const opened = await restoreArchive.readLibraryArchive(file);
  await opened.restoreMedia(library);
  const back = await restored.readOriginalAsset(OWNER, id);
  assert.deepEqual([back?.mimeType, back?.data.toString("utf8")], ["image/svg+xml", LOGO_SVG]);
});

test("the migration script reports what it would move, writes nothing on a dry run, and moves posts' images with --apply", async t => {
  const env = {NODE_ENV: "development", ENGINE_DEV_STORAGE_DIR: ""};
  const f = fixture(t, {env});
  env.ENGINE_DEV_STORAGE_DIR = path.join(f.directory, "storage");
  const persistence = f.load("lib/template-editor/persistence.ts"), model = f.load("lib/template-editor/model.ts"), decks = f.load("lib/template-editor/agent-decks.ts"), budget = f.load("lib/template-editor/library-budget.ts");
  const storage = f.load("lib/template-editor/development-storage.ts"), media = f.load("lib/template-editor/media-storage.ts"), images = f.load("lib/template-editor/stored-images.ts");
  const templatePhoto = dataUrl("image/jpeg", await sharp({create: {width: 400, height: 300, channels: 3, background: "#204060"}}).jpeg().toBuffer());
  const first = decks.createAgentDeck({id: "post-1", name: "Earbud in gravel", format: "portrait", slides: [blank([image("cut", PHOTO, 0, 0, 1080, 1350), image("logo", LOGO, 60, 60, 240, 80)])]});
  const second = decks.createAgentDeck({id: "post-2", name: "Same cut, with a chart", format: "portrait", slides: [blank([image("cut", PHOTO, 0, 0, 1080, 1350), image("chart", CHART, 60, 700, 960, 640)])]});
  const trashed = {...decks.createAgentDeck({id: "post-3", name: "Old chart", format: "portrait", slides: [blank([image("chart", CHART, 0, 0, 960, 640)])]}), deletedAt: "2026-11-01T00:00:00.000Z"};
  const artwork = model.BUILT_IN_TEMPLATES.find(template => images.embeddedImages(template).size);
  const fromTemplate = decks.createAgentDeck({id: "post-4", name: "From a template", templateId: artwork.id});
  assert.ok(images.embeddedImages(fromTemplate).size, "a post with a template's inline artwork");
  const template = model.designAsTemplate(decks.createAgentDeck({name: "Brand", format: "portrait", slides: [blank([image("hero", templatePhoto, 0, 0, 1080, 800)])]}), "Brand template");
  const saved = await persistence.saveEditorLibrary("owner", {...model.EMPTY_LIBRARY, designs: [first, second, trashed, fromTemplate], templates: [template]}, null);
  const libraryFile = path.join(storage.developmentDirectory("template-editor"), `${persistence.editorOwnerScope("owner")}.json`);
  const original = fs.readFileSync(libraryFile), budgetBefore = budget.checkLibrarySaveBudget(saved.library).bytes;
  const script = (...args) => run(process.execPath, [path.join(root, "scripts/store-embedded-images.mjs"), "--project", f.directory, ...args], {cwd: root, env: {...process.env, NODE_ENV: "development", ENGINE_DEV_STORAGE_DIR: env.ENGINE_DEV_STORAGE_DIR}, maxBuffer: 1 << 20});
  const dry = (await script()).stdout;
  t.diagnostic(dry);
  assert.match(dry, /Would move 3 images \(1 JPEG, 1 PNG, 1 SVG\) from 3 posts/);
  assert.match(dry, /Old chart \(in Trash\)/);
  assert.match(dry, new RegExp(`Staying embedded: ${images.embeddedImages(fromTemplate).size} images? from templates and photo-slot placeholders\\.`));
  assert.match(dry, /Dry run: nothing was written\./);
  assert.ok(fs.readFileSync(libraryFile).equals(original), "the dry run leaves the library as it was");
  assert.equal(fs.existsSync(storage.developmentDirectory("template-editor-media")), false, "and stores nothing");
  const applied = (await script("--apply")).stdout;
  assert.match(applied, /Moving 3 images/);
  assert.match(applied, /Stored 3 images \(0 were already stored\) and saved the library/);
  const backup = applied.match(/Backup of the library: (.+)/)[1];
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, "utf8")).library.designs.map(design => design.id), ["post-1", "post-2", "post-3", "post-4"]);
  const after = await persistence.getEditorLibrary("owner"), byId = id => after.library.designs.find(design => design.id === id);
  assert.deepEqual(imagesOf(byId("post-1")), [stored(photo), stored(LOGO_SVG)]);
  assert.deepEqual(imagesOf(byId("post-2")), [stored(photo), stored(chart)]);
  assert.deepEqual(imagesOf(byId("post-3")), [stored(chart)]);
  assert.deepEqual(imagesOf(byId("post-4")), imagesOf(fromTemplate), "a template's placeholders stay inline");
  assert.equal(after.library.templates[0].pages[0].canvas.elements.find(element => element.type === "image").src, templatePhoto, "templates keep their artwork");
  assert.ok(budget.checkLibrarySaveBudget(after.library).bytes < budgetBefore - PHOTO.length, "the library budget drops by the images");
  assert.ok((await media.readOriginalAsset("owner", sha(photo))).data.equals(photo));
  const history = await persistence.getDocumentHistory("owner", "post-1");
  assert.deepEqual(imagesOf(history[0].document), [PHOTO, LOGO], "the post's version history keeps the version before the move");
  assert.match((await script()).stdout, /Would move 0 images \(none\) from 0 posts/);
});
