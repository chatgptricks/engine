/* Run: node --test tests/template-editor-video.test.mjs
 * Videos in the template editor: a clip rides on a photo (`video` next to the
 * photo's `src`, which stays its cover), is stored apart from the deck
 * (video-storage.ts) and reaches decks through the editor's upload routes and
 * the agent API. Storage is the real one on disk; sign-in, Supabase and the
 * network fetch of a link are faked. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {Readable} from "node:stream";
import {createHash, randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
// The same Yjs the code under test requires (one copy, so its types match).
const Y = nativeRequire("yjs");
const OWNER = "owner-a";

function fixture(t, {overrides = {}, env = {NODE_ENV: "test"}} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "engine-video-test-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
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
  const videos = path.join(directory, ".engine-dev", "template-editor-video");
  return {directory, load, videoFiles: () => fs.existsSync(videos) ? fs.readdirSync(videos).sort() : []};
}

/* A small MP4 as cameras write it: ftyp, a stand-in mdat, then moov (mvhd and one
 * video track with tkhd, mdia and hdlr), optionally turned 90° the way phones store
 * an upright clip, and optionally with moov first (fast start). */
function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length + 8); head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}
const u32 = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value >>> 0); return buffer; };
function mp4({seconds = 12, width = 1080, height = 1440, turned = false, brand = "isom", faststart = false, payload = 4096} = {}) {
  const timescale = 600;
  const mvhd = box("mvhd", u32(0), u32(0), u32(0), u32(timescale), u32(seconds * timescale), Buffer.alloc(80));
  const matrix = turned ? [0, 65536, 0, -65536, 0, 0, 0, 0, 0x40000000] : [65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000];
  const stored = turned ? [height, width] : [width, height];
  const tkhd = box("tkhd", u32(7), u32(0), u32(0), u32(1), u32(0), u32(seconds * timescale), Buffer.alloc(16), ...matrix.map(u32), u32(stored[0] * 65536), u32(stored[1] * 65536));
  const hdlr = box("hdlr", u32(0), u32(0), Buffer.from("vide"), Buffer.alloc(12), Buffer.from("VideoHandler\0"));
  const sound = box("trak", box("tkhd", u32(7), Buffer.alloc(76)), box("mdia", box("hdlr", u32(0), u32(0), Buffer.from("soun"), Buffer.alloc(12))));
  const moov = box("moov", mvhd, sound, box("trak", tkhd, box("mdia", box("mdhd", Buffer.alloc(24)), hdlr)));
  const ftyp = box("ftyp", Buffer.from(brand.padEnd(4)), u32(512), Buffer.from("isomiso2avc1mp41"));
  const mdat = box("mdat", Buffer.alloc(payload, 7));
  return faststart ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov]);
}
const reader = bytes => async (offset, length) => bytes.subarray(offset, offset + length);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const CLIP = mp4();
const ID = sha(CLIP);
const clipOf = (overrides = {}) => ({src: `/api/template-editor/videos/${ID}`, mimeType: "video/mp4", duration: 12, width: 1080, height: 1440, bytes: CLIP.length, ...overrides});
const COVER = "/api/template-editor/assets/" + "c".repeat(64);
const scene = elements => ({background: "#000000", elements});
const imageLayer = (extra = {}) => ({id: "video-1", type: "image", name: "Clip", x: 0, y: 0, width: 360, height: 480, rotation: 0, opacity: 1, locked: false, src: COVER, fit: "cover", cropX: 50, cropY: 50, radius: 0, ...extra});

test("the MP4 header gives a clip's length and upright size, with moov first or last", async t => {
  const f = fixture(t), info = f.load("lib/template-editor/mp4-info.ts");
  assert.deepEqual(await info.readMp4Info(reader(CLIP), CLIP.length), {duration: 12, width: 1080, height: 1440, brand: "isom"});
  const fast = mp4({faststart: true, seconds: 3});
  assert.equal((await info.readMp4Info(reader(fast), fast.length)).duration, 3);
  // A phone's upright clip is stored 1440 × 1080 and turned: it reads as 1080 × 1440.
  const phone = mp4({turned: true});
  assert.deepEqual(await info.readMp4Info(reader(phone), phone.length), {duration: 12, width: 1080, height: 1440, brand: "isom"});
  assert.equal(info.sniffVideo(mp4({brand: "qt  "})), "video/quicktime");
  assert.equal(info.sniffVideo(CLIP), "video/mp4");
  assert.equal(info.sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), "video/webm");
  assert.equal(info.sniffVideo(Buffer.from("\x89PNG\r\n\x1a\n0000", "latin1")), null);
  // Cut short before moov, or with a box that claims more than the file: no answer rather than a wrong one.
  assert.equal(await info.readMp4Info(reader(CLIP.subarray(0, CLIP.length - 40)), CLIP.length - 40), null);
  const broken = Buffer.from(CLIP); broken.writeUInt32BE(0xffffff, 0);
  assert.equal(await info.readMp4Info(reader(broken), broken.length), null);
});

test("a real encoder's MP4 reads the same as ffprobe says", {skip: (() => { try { execFileSync("ffmpeg", ["-version"], {stdio: "ignore"}); return false; } catch { return "ffmpeg is not installed"; } })()}, async t => {
  const f = fixture(t), info = f.load("lib/template-editor/mp4-info.ts");
  const file = path.join(f.directory, "real.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1440:rate=30:duration=2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file]);
  const bytes = fs.readFileSync(file);
  const read = await info.readMp4Info(reader(bytes), bytes.length);
  assert.equal(read.width, 1080); assert.equal(read.height, 1440);
  assert.ok(Math.abs(read.duration - 2.5) < 0.1, `duration ${read.duration}`);
});

test("a clip is kept only as a stored path, sizes in range, and its trim inside the clip", async t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts");
  assert.deepEqual(model.parseVideoClip(clipOf({start: 2, end: 9, loop: false, muted: false, coverTime: 1})), clipOf({start: 2, end: 9, loop: false, muted: false, coverTime: 1}));
  for (const src of [`data:video/mp4;base64,${CLIP.toString("base64")}`, "https://cdn.example/clip.mp4", "javascript:alert(1)", "/api/template-editor/videos/abc", `/api/template-editor/assets/${ID}`])
    assert.equal(model.parseVideoClip(clipOf({src})), null, src.slice(0, 40));
  assert.equal(model.parseVideoClip(clipOf({mimeType: "video/x-msvideo"})), null);
  assert.equal(model.parseVideoClip(clipOf({bytes: 201 * 1024 * 1024})), null, "over 200 MB");
  assert.equal(model.parseVideoClip(clipOf({duration: 600})), null, "over 3 minutes");
  // A trim past the end stops at the end; a trim with nothing left is refused.
  assert.deepEqual(model.parseVideoClip(clipOf({start: 4, end: 30})), clipOf({start: 4}));
  assert.equal(model.parseVideoClip(clipOf({start: 12, end: 12})), null);
  assert.deepEqual(model.parseVideoClip(clipOf({start: 0, end: 12})), clipOf(), "a trim of the whole clip isn't stored");
  // On an image layer and in a frame's photo alike; a bad clip fails the layer rather than being dropped quietly.
  const parsed = model.parseCanvasScene(scene([imageLayer({video: clipOf({end: 6})}), {id: "frame", type: "shape", name: "Frame", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, shape: "ellipse", fill: "#fff", stroke: "transparent", strokeWidth: 0, radius: 0, imageFill: {src: COVER, objectFit: "cover", cropX: 50, cropY: 50, video: clipOf()}}]));
  assert.deepEqual(parsed.elements[0].video, clipOf({end: 6}));
  assert.deepEqual(parsed.elements[1].imageFill.video, clipOf());
  assert.equal(model.parseCanvasScene(scene([imageLayer({video: clipOf({src: "https://cdn.example/x.mp4"})})])), null);
  // The deck carries a few hundred bytes for a clip, never the clip.
  assert.ok(JSON.stringify(clipOf({start: 2, end: 9})).length < 300);
});

test("a clip goes wherever its photo goes: into a frame, through template sync, and away when the photo changes", async t => {
  const f = fixture(t), commands = f.load("lib/template-editor/commands.ts"), frames = f.load("lib/template-editor/photo-frames.ts"), advanced = f.load("lib/template-editor/advanced.ts");
  const layer = imageLayer({video: clipOf({start: 1})});
  const frame = {id: "frame", type: "shape", name: "Frame", x: 0, y: 0, width: 200, height: 200, rotation: 0, opacity: 1, locked: false, shape: "rectangle", fill: "#ffffff", stroke: "transparent", strokeWidth: 0, radius: 0};
  const filled = commands.fillShapeWithImage(scene([frame, layer]), "frame", layer, {sourceImageId: "video-1"}).scene;
  assert.deepEqual(filled.elements.map(element => element.id), ["frame"], "the dragged layer moves into the frame");
  assert.deepEqual(filled.elements[0].imageFill.video, clipOf({start: 1}));
  assert.deepEqual(frames.photoContent(filled.elements[0]).video, clipOf({start: 1}));
  assert.deepEqual(frames.photoContent(layer).video, clipOf({start: 1}));
  // A template field pointing at another photo takes nothing of the old one, its clip included.
  assert.equal(advanced.replacePhotoSource(layer, "/api/template-editor/assets/" + "d".repeat(64)).video, undefined);
  assert.equal(advanced.replacePhotoSource(layer, COVER).video.start, 1);
});

test("a video can't be split across two slides", async t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts"), spans = f.load("lib/template-editor/spanning-photos.ts");
  const design = model.createBlankDesign("Video", "portrait");
  design.pages = [{...design.pages[0], canvas: scene([imageLayer({video: clipOf()})])}];
  assert.match(spans.spanBlocker(design, design.pages[0].id, "video-1"), /video stays on one slide/);
  design.pages[0].canvas.elements[0] = imageLayer();
  assert.equal(spans.spanBlocker(design, design.pages[0].id, "video-1"), undefined, "the same photo without its clip can span");
});

test("a trim edit merges with a teammate's move, and undo brings the old trim back", async t => {
  const f = fixture(t), merge = f.load("lib/template-editor/three-way-merge.ts"), model = f.load("lib/template-editor/model.ts"), history = f.load("lib/template-editor/history.ts");
  const base = imageLayer({video: clipOf({start: 1, end: 10})});
  const mine = {...base, video: {...base.video, start: 3}}, theirs = {...base, x: 40};
  const merged = merge.mergeEntity(base, mine, theirs);
  assert.equal(merged.value?.x ?? merged.x, 40);
  const video = (merged.value ?? merged).video;
  assert.equal(video.start, 3); assert.equal(video.end, 10);
  // The library keeps the clip through a full parse, as a save and a teammate's load do.
  const design = model.createBlankDesign("Clip", "portrait");
  design.pages = [{...design.pages[0], canvas: scene([mine])}];
  const library = model.parseLibrary({...model.EMPTY_LIBRARY, designs: [design]});
  assert.deepEqual(library.designs[0].pages[0].canvas.elements[0].video, mine.video);
  // Undo: the previous document, trim included.
  const log = history.createDocumentHistory(), context = {pageId: design.pages[0].id, selectedIds: ["video-1"], editingMaster: false, isolatedGroupId: null};
  const trimmed = {...design, pages: [{...design.pages[0], canvas: scene([{...mine, video: {...mine.video, start: 5}}])}]};
  let current = design;
  assert.equal(history.commitHistory(log, design, trimmed, context, next => { current = next; }, {group: "inspector:video-1:video-trim"}), true);
  assert.equal(current.pages[0].canvas.elements[0].video.start, 5);
  history.travelHistory(log, current, context, "undo", next => { current = next; });
  assert.equal(current.pages[0].canvas.elements[0].video.start, 3);
});

test("a clip survives the live collaboration document", async t => {
  const f = fixture(t), collaboration = f.load("lib/template-editor/collaboration-document.ts"), model = f.load("lib/template-editor/model.ts");
  const design = model.createBlankDesign("Clip", "portrait");
  design.pages = [{...design.pages[0], canvas: scene([imageLayer({video: clipOf({start: 2, loop: false})})])}];
  const doc = collaboration.createCollaborationDocument(design);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(collaboration.readCollaborationDocument(copy).pages[0].canvas.elements[0].video, clipOf({start: 2, loop: false}));
  // A teammate's trim arrives as an update.
  const trimmed = {...design, pages: [{...design.pages[0], canvas: scene([imageLayer({video: clipOf({start: 4, loop: false})})])}]};
  collaboration.writeCollaborationDocument(doc, design, trimmed);
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  assert.equal(collaboration.readCollaborationDocument(copy).pages[0].canvas.elements[0].video.start, 4);
});

test("development uploads arrive in parts, must hash to their id, and play back with Range", async t => {
  const f = fixture(t);
  const uploads = f.load("app/api/template-editor/videos/route.ts"), file = f.load("app/api/template-editor/videos/[id]/route.ts");
  const meta = {id: ID, bytes: CLIP.length, mimeType: "video/mp4", duration: 12, width: 1080, height: 1440, name: "clip.mp4"};
  const post = body => uploads.POST(new Request("https://engine.example/api/template-editor/videos", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}));
  const put = (offset, bytes, id = ID) => file.PUT(new Request(`https://engine.example/api/template-editor/videos/${id}?offset=${offset}&total=${CLIP.length}`, {method: "PUT", body: bytes}), {params: Promise.resolve({id})});
  const get = (headers = {}) => file.GET(new Request(`https://engine.example/api/template-editor/videos/${ID}`, {headers}), {params: Promise.resolve({id: ID})});

  const start = await (await post({action: "start", meta})).json();
  assert.deepEqual(start, {mode: "chunks", chunkBytes: 4 * 1024 * 1024, received: 0});
  assert.equal((await get()).status, 404, "nothing plays before it is finished");
  const half = Math.floor(CLIP.length / 2);
  assert.equal((await (await put(0, CLIP.subarray(0, half))).json()).received, half);
  assert.equal((await put(0, CLIP.subarray(0, half))).status, 409, "a part at the wrong place is refused");
  assert.equal((await (await post({action: "start", meta})).json()).received, half, "an interrupted upload resumes where it stopped");
  assert.equal((await post({action: "finish", meta})).status, 409, "an unfinished upload isn't recorded");
  await put(half, CLIP.subarray(half));
  const finished = await post({action: "finish", meta});
  assert.equal(finished.status, 200, await finished.clone().text());
  const done = await finished.json();
  assert.equal(done.src, `/api/template-editor/videos/${ID}`);
  assert.deepEqual({duration: done.record.duration, width: done.record.width, height: done.record.height}, {duration: 12, width: 1080, height: 1440}, "the header's facts win over the browser's");
  // Uploading it again reuses the stored clip.
  const again = await (await post({action: "start", meta})).json();
  assert.deepEqual([again.existing, again.src], [true, done.src], JSON.stringify(again) + f.videoFiles().join(","));

  const whole = await get();
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("content-type"), "video/mp4");
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), CLIP);
  const part = await get({range: "bytes=10-19"});
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 10-19/${CLIP.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), CLIP.subarray(10, 20));
  assert.equal((await get({range: `bytes=${CLIP.length + 5}-`})).status, 416);
  const quota = await (await uploads.GET()).json();
  assert.deepEqual(quota, {mode: "chunks", used: CLIP.length, quota: 10 * 1024 ** 3});
});

test("uploads refuse other files, oversize clips, a wrong hash, another site and other workspaces", async t => {
  let owner = OWNER;
  const f = fixture(t, {overrides: {"@/lib/engine/member": {resolveEngineAccess: async () => owner ? {kind: "owner", ownerKey: owner} : null}}});
  const uploads = f.load("app/api/template-editor/videos/route.ts"), file = f.load("app/api/template-editor/videos/[id]/route.ts");
  const post = (body, headers = {}) => uploads.POST(new Request("https://engine.example/api/template-editor/videos", {method: "POST", headers: {"content-type": "application/json", ...headers}, body: JSON.stringify(body)}));
  const meta = {id: ID, bytes: CLIP.length, mimeType: "video/mp4", duration: 12, width: 1080, height: 1440};
  assert.equal((await post({action: "start", meta: {...meta, mimeType: "image/gif"}})).status, 415);
  assert.equal((await post({action: "start", meta: {...meta, bytes: 300 * 1024 * 1024}})).status, 413);
  assert.equal((await post({action: "start", meta: {...meta, duration: 400}})).status, 413);
  assert.equal((await post({action: "start", meta}, {origin: "https://elsewhere.example"})).status, 403);
  // A file that isn't what its id says is thrown away.
  const other = mp4({seconds: 5});
  await file.PUT(new Request(`https://engine.example/api/template-editor/videos/${ID}?offset=0&total=${other.length}`, {method: "PUT", body: other}), {params: Promise.resolve({id: ID})});
  assert.equal((await post({action: "finish", meta: {...meta, bytes: other.length}})).status, 409);
  assert.deepEqual(f.videoFiles(), [], "the mismatched upload is removed");
  // A PNG renamed .mp4 is not a video.
  const png = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(64)]), pngId = sha(png);
  await file.PUT(new Request(`https://engine.example/api/template-editor/videos/${pngId}?offset=0&total=${png.length}`, {method: "PUT", body: png}), {params: Promise.resolve({id: pngId})});
  assert.equal((await post({action: "finish", meta: {...meta, id: pngId, bytes: png.length}})).status, 415);
  // Workspace A's clip doesn't play for workspace B or signed-out viewers.
  await file.PUT(new Request(`https://engine.example/api/template-editor/videos/${ID}?offset=0&total=${CLIP.length}`, {method: "PUT", body: CLIP}), {params: Promise.resolve({id: ID})});
  assert.equal((await post({action: "finish", meta})).status, 200);
  const play = () => file.GET(new Request(`https://engine.example/api/template-editor/videos/${ID}`), {params: Promise.resolve({id: ID})});
  owner = "owner-b"; assert.equal((await play()).status, 404);
  owner = null; assert.equal((await play()).status, 401);
});

test("with Vercel Blob, the browser uploads straight to Blob under this workspace's path and the record points there", async t => {
  const heads = [];
  const f = fixture(t, {env: {NODE_ENV: "test", BLOB_READ_WRITE_TOKEN: "test-token"}, overrides: {"@vercel/blob": {
    head: async url => { heads.push(url); return {size: CLIP.length, url, pathname: new URL(url).pathname.slice(1)}; },
    put: async () => assert.fail("the browser uploads, not the server"),
  }}});
  const storage = f.load("lib/template-editor/video-storage.ts"), uploads = f.load("app/api/template-editor/videos/route.ts"), file = f.load("app/api/template-editor/videos/[id]/route.ts");
  const meta = {id: ID, bytes: CLIP.length, mimeType: "video/mp4", duration: 12, width: 1080, height: 1440};
  const post = body => uploads.POST(new Request("https://engine.example/api/template-editor/videos", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}));
  const start = await (await post({action: "start", meta})).json();
  assert.equal(start.mode, "blob");
  assert.equal(start.pathname, `te-video/${storage.ownerTag(OWNER)}/${ID}.mp4`);
  const blobUrl = `https://abc.public.blob.vercel-storage.com/te-video/${storage.ownerTag(OWNER)}/${ID}-x1y2.mp4`;
  assert.equal((await post({action: "finish", meta, url: `https://abc.public.blob.vercel-storage.com/te-video/${storage.ownerTag("owner-b")}/${ID}-x.mp4`})).status, 403, "another workspace's file");
  assert.equal((await post({action: "finish", meta, url: "https://evil.example/clip.mp4"})).status, 400);
  assert.equal((await post({action: "finish", meta, url: blobUrl})).status, 200);
  assert.deepEqual(heads, [blobUrl]);
  const played = await file.GET(new Request(`https://engine.example/api/template-editor/videos/${ID}`), {params: Promise.resolve({id: ID})});
  assert.equal(played.status, 302);
  assert.equal(played.headers.get("location"), blobUrl);
});

/** A guarded fetch that serves `bytes` for every link, with the given type. */
function serving(bytes, type = "video/mp4", seen = []) {
  return {guardedGet: async url => {
    seen.push(url);
    const response = Readable.from([bytes.subarray(0, 100), bytes.subarray(100)]);
    return Object.assign(response, {statusCode: 200, headers: {"content-type": type, "content-length": String(bytes.length)}});
  }};
}

test("agents add a video by link: it's copied once, the deck keeps its path and trim, and update_element trims or removes it", async t => {
  const seen = [];
  const f = fixture(t, {overrides: {"./review-assets": serving(CLIP, "video/mp4", seen)}});
  const route = f.load("app/api/agent/slides/route.ts"), persistence = f.load("lib/template-editor/persistence.ts"), budget = f.load("lib/template-editor/library-budget.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const cover = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64")}`;
  const before = budget.checkLibrarySaveBudget((await persistence.getEditorLibrary(OWNER)).library);
  const spec = {name: "Video post", format: "portrait", slides: [
    {id: "s1", layout: "blank", elements: [{id: "clip", type: "image", src: cover, x: 0, y: 0, width: 1080, height: 1350, video: {url: "https://cdn.example/clip.mp4", start: 2, end: 8}}]},
    {id: "s2", layout: "blank", elements: [{id: "again", type: "image", src: cover, x: 0, y: 0, width: 540, height: 540, video: {url: "https://cdn.example/clip.mp4"}}]},
  ]};
  const response = await post({action: "create_deck", spec, operationId: randomUUID()});
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  const layers = created.document.pages.map(page => page.canvas.elements[0]);
  assert.deepEqual(layers[0].video, clipOf({start: 2, end: 8}));
  assert.deepEqual(layers[1].video, clipOf());
  assert.deepEqual(seen, ["https://cdn.example/clip.mp4"], "the same link is fetched once");
  assert.equal(f.videoFiles().filter(name => name.endsWith(".bin")).length, 1);
  const after = budget.checkLibrarySaveBudget((await persistence.getEditorLibrary(OWNER)).library);
  assert.ok(after.bytes - before.bytes < 20_000, `the post adds ${after.bytes - before.bytes} bytes`);

  // Trim only, then remove: the clip already there is changed, then dropped; the cover stays.
  let hash = created.hash ?? (await (await post({action: "get_deck", deckId: created.document.id})).json()).hash;
  const update = async operations => { const result = await post({action: "update_deck", deckId: created.document.id, expectedHash: hash, operationId: randomUUID(), changes: {operations}}); const value = await result.json(); assert.equal(result.status, 200, JSON.stringify(value)); hash = value.hash; return value.document; };
  const pageId = created.document.pages[0].id;
  let document = await update([{op: "update_element", pageId, elementId: "clip", properties: {video: {start: 3, end: 6, loop: false}}}]);
  assert.deepEqual(document.pages[0].canvas.elements[0].video, clipOf({start: 3, end: 6, loop: false}));
  document = await update([{op: "update_element", pageId, elementId: "clip", properties: {video: {remove: true}}}]);
  assert.equal(document.pages[0].canvas.elements[0].video, undefined);
  assert.equal(document.pages[0].canvas.elements[0].src, layers[0].src, "the cover stays as the photo");
  // Reuse by path; a trim on an image without a clip says what's missing.
  document = await update([{op: "update_element", pageId, elementId: "clip", properties: {video: {src: clipOf().src, end: 4}}}]);
  assert.deepEqual(document.pages[0].canvas.elements[0].video, clipOf({end: 4}));
  const failed = await post({action: "update_deck", deckId: created.document.id, expectedHash: hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: created.document.pages[1].id, elementId: "again", properties: {video: {remove: true}}}, {op: "update_element", pageId, elementId: "clip", properties: {video: {remove: true}}}, {op: "update_element", pageId, elementId: "clip", properties: {video: {start: 1}}}]}});
  assert.equal(failed.status, 400);
  assert.match(JSON.stringify(await failed.json()), /no video to change/);
});

test("agents' video links must be public MP4 or MOV files within the limits", async t => {
  const cases = [
    [serving(Buffer.from("<html>not a video</html>"), "text/html"), /isn't an MP4 or MOV/],
    [serving(Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(64)]), "video/mp4"), /isn't a video Engine can play/],
    [serving(mp4({seconds: 400}), "video/mp4"), /up to 3 minutes/],
    [{guardedGet: async () => { throw new Error("This URL uses a private or unavailable host."); }}, /private or unavailable host/],
  ];
  for (const [fetcher, message] of cases) {
    const f = fixture(t, {overrides: {"./review-assets": fetcher}});
    const route = f.load("app/api/agent/slides/route.ts");
    const response = await route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "create_deck", operationId: randomUUID(), spec: {name: "Bad video", format: "portrait", slides: [{id: "s1", layout: "blank", elements: [{type: "image", src: COVER, x: 0, y: 0, width: 100, height: 100, video: {url: "https://cdn.example/x.mp4"}}]}]}})}));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(JSON.stringify(body), message);
    assert.match(JSON.stringify(body), /\$\.slides\[0\]\.elements\[0\]\.video/, "the error names where the video is");
    assert.deepEqual(f.videoFiles(), []);
  }
});

test("the real guarded fetch refuses loopback and private links", async t => {
  const f = fixture(t), review = f.load("lib/template-editor/review-assets.ts");
  for (const url of ["http://127.0.0.1/clip.mp4", "http://localhost/clip.mp4", "http://169.254.169.254/latest/meta-data", "http://10.0.0.8/x.mp4", "file:///etc/passwd", "https://user:pass@cdn.example/x.mp4"])
    await assert.rejects(review.guardedGet(url, "video/mp4"), /private|not supported/, url);
});

test("agents learn about videos from capabilities and the schema", async t => {
  const f = fixture(t), decks = f.load("lib/template-editor/agent-decks.ts");
  const capabilities = decks.agentCapabilities();
  assert.ok(capabilities.notes.some(note => /video: \{url/.test(note)));
  const image = decks.AGENT_DECK_SPEC_SCHEMA.properties.slides.items.properties.elements.items.oneOf.find(variant => variant.properties.type.const === "image");
  assert.ok(image.properties.video.properties.url);
  const mcp = fs.readFileSync(path.join(root, "scripts/engine-agent-mcp.mjs"), "utf8");
  assert.match(mcp, /video: \{url\}/);
});

test("a slide plays at most 60 seconds of its clip", async t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts");
  assert.equal(model.MAX_SLIDE_VIDEO_SECONDS, 60);
  assert.deepEqual(model.parseVideoClip(clipOf({duration: 150})), clipOf({duration: 150, end: 60}));
  assert.deepEqual(model.parseVideoClip(clipOf({duration: 150, start: 30})), clipOf({duration: 150, start: 30, end: 90}));
  assert.deepEqual(model.parseVideoClip(clipOf({duration: 150, start: 120})), clipOf({duration: 150, start: 120}));
});

test("a clip longer than 60 seconds continues on copies of its slide right after it, a minute each", async t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts"), slides = f.load("lib/template-editor/video-slides.ts");
  assert.deepEqual(slides.videoParts({duration: 150}), [{start: 0, end: 60}, {start: 60, end: 120}, {start: 120, end: 150}]);
  assert.deepEqual(slides.videoParts({duration: 60}), [{start: 0, end: 60}]);
  assert.deepEqual(slides.videoParts({duration: 60.3}), [{start: 0, end: 60}], "a few tenths over isn't worth a slide");
  assert.deepEqual(slides.videoParts({duration: 180}), [{start: 0, end: 60}, {start: 60, end: 120}, {start: 120, end: 180}]);
  const design = model.createBlankDesign("Long", "portrait");
  const title = {...model.createCanvasElement("text"), id: "title", text: "Watch"};
  const after = {...design.pages[0], id: "after", image: {...design.pages[0].image, id: "after-image"}, canvas: scene([])};
  design.pages = [{...design.pages[0], canvas: scene([title, imageLayer({video: clipOf({duration: 150})})])}, after];
  const covers = [{src: COVER.replace(/c+$/, "1".repeat(64)), previewSrc: `data:image/webp;base64,${Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1").toString("base64")}`}, {src: COVER.replace(/c+$/, "2".repeat(64))}];
  const result = slides.splitVideoAcrossSlides(design, design.pages[0].id, "video-1", covers);
  assert.equal(result.pageIds.length, 2);
  const pages = result.design.pages;
  assert.deepEqual(pages.map(page => page.id), [design.pages[0].id, ...result.pageIds, "after"], "the new slides come right after the first, before the rest");
  const clips = pages.slice(0, 3).map(page => page.canvas.elements[1].video);
  assert.deepEqual(clips.map(clip => [clip.start, clip.end]), [[undefined, 60], [60, 120], [120, undefined]]);
  assert.deepEqual(pages.slice(0, 3).map(page => page.canvas.elements[1].src), [COVER, covers[0].src, covers[1].src], "each part has its own cover");
  assert.equal(pages[1].canvas.elements[0].text, "Watch", "a copy keeps the slide's other layers");
  assert.equal(new Set(pages.flatMap(page => page.canvas.elements.map(element => element.id))).size, 6, "with ids of their own");
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY, designs: [design]}), "the deck before");
  for (const [i, page] of result.design.pages.entries()) assert.ok(model.parseCanvasScene(page.canvas), `page ${i}`);
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY, designs: [result.design]}), "the result is a valid deck");
  // Short clips, and decks that can't take the slides, are left alone or refused whole.
  assert.equal(slides.splitVideoAcrossSlides(design, design.pages[0].id, "title").pageIds.length, 0);
  const full = {...design, pages: Array.from({length: 19}, (_, i) => ({...design.pages[0], id: `p${i}`}))};
  assert.throws(() => slides.splitVideoAcrossSlides(full, "p0", "video-1"), /needs 3 slides.*holds 20/);
});

test("agents' untrimmed long videos split across slides; trimmed ones stay on one", async t => {
  const long = mp4({seconds: 130});
  const f = fixture(t, {overrides: {"./review-assets": serving(long)}});
  const route = f.load("app/api/agent/slides/route.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const deck = video => ({action: "create_deck", operationId: randomUUID(), spec: {name: "Long", format: "portrait", slides: [
    {id: "s1", layout: "blank", elements: [{id: "clip", type: "image", src: COVER, x: 0, y: 0, width: 1080, height: 1440, video}]},
    {id: "s2", layout: "blank", elements: [{id: "outro", type: "text", text: "Follow", x: 0, y: 0, width: 600, height: 100}]},
  ]}});
  const split = await post(deck({url: "https://cdn.example/long.mp4"}));
  assert.equal(split.status, 201, await split.clone().text());
  const pages = (await split.json()).document.pages;
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.slice(0, 3).map(page => [page.canvas.elements[0].video.start, page.canvas.elements[0].video.end]), [[undefined, 60], [60, 120], [120, undefined]]);
  assert.equal(pages[3].canvas.elements[0].text, "Follow");
  const trimmed = await post(deck({url: "https://cdn.example/long.mp4", start: 30}));
  const one = (await trimmed.json()).document.pages;
  assert.equal(one.length, 2);
  assert.deepEqual([one[0].canvas.elements[0].video.start, one[0].canvas.elements[0].video.end], [30, 90]);
});
