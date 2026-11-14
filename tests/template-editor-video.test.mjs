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

/** Supabase as production has it on Render: records in gf_client_state, clips in Storage. */
function supabase() {
  const rows = new Map(), objects = new Map(), buckets = new Map(), signedUploads = [];
  const db = {
    from() {
      const query = {};
      const chain = {
        select: () => chain, eq: (_, value) => { query.eq = value; return chain; }, like: (_, pattern) => { query.like = pattern; return chain; },
        maybeSingle: async () => ({data: rows.has(query.eq) ? {data: rows.get(query.eq)} : null, error: null}),
        upsert: async row => { rows.set(row.owner, row.data); return {error: null}; },
        then: (resolve, reject) => Promise.resolve({data: [...rows].filter(([key]) => key.startsWith(query.like.replace(/%$/, ""))).map(([, data]) => ({data})), error: null}).then(resolve, reject),
      };
      return chain;
    },
    storage: {
      getBucket: async id => buckets.has(id) ? {data: {id}, error: null} : {data: null, error: {message: "Bucket not found"}},
      createBucket: async (id, options) => { buckets.set(id, options); return {data: {name: id}, error: null}; },
      from: bucket => ({
        createSignedUploadUrl: async (name, options) => { signedUploads.push({bucket, name, options}); return {data: {signedUrl: `https://project.supabase.co/storage/v1/object/upload/sign/${bucket}/${name}?token=up`, token: "up", path: name}, error: null}; },
        createSignedUrl: async name => objects.has(name) ? {data: {signedUrl: `https://project.supabase.co/storage/v1/object/sign/${bucket}/${name}?token=read`}, error: null} : {data: null, error: {message: "Object not found"}},
        upload: async (name, body) => { objects.set(name, Buffer.from(body)); return {data: {path: name}, error: null}; },
        remove: async names => { for (const name of names) objects.delete(name); return {data: [], error: null}; },
      }),
    },
  };
  return {db, rows, objects, buckets, signedUploads};
}

test("without Blob (production on Render), the browser and agents send clips to a signed Supabase Storage URL, and playback redirects to a signed link", async t => {
  const store = supabase();
  const original = globalThis.fetch;
  // Range reads of a stored object, as Storage serves a signed link.
  globalThis.fetch = async (url, init = {}) => {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\/storage\/v1\/object\/sign\/engine-videos\//, ""));
    const bytes = store.objects.get(name);
    if (!bytes) return new Response("not found", {status: 400});
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get("range"));
    const end = Math.min(Number(to), bytes.length - 1);
    return new Response(bytes.subarray(Number(from), end + 1), {status: 206, headers: {"content-range": `bytes ${from}-${end}/${bytes.length}`}});
  };
  t.after(() => { globalThis.fetch = original; });
  const f = fixture(t, {env: {NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable"}, overrides: {"@/lib/supabase/admin": {getAdminSupabase: () => store.db}, "./review-assets": serving(mp4({seconds: 20}))}});
  const storage = f.load("lib/template-editor/video-storage.ts"), uploads = f.load("app/api/template-editor/videos/route.ts"), file = f.load("app/api/template-editor/videos/[id]/route.ts"), agent = f.load("app/api/agent/videos/route.ts");
  const meta = {id: ID, bytes: CLIP.length, mimeType: "video/mp4", duration: 12, width: 1080, height: 1440, name: "clip.mp4"};
  const post = body => uploads.POST(new Request("https://engine.example/api/template-editor/videos", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}));
  const name = `te-video/${storage.ownerTag(OWNER)}/${ID}.mp4`;

  const start = await (await post({action: "start", meta})).json();
  assert.deepEqual(start, {mode: "signed", url: `https://project.supabase.co/storage/v1/object/upload/sign/engine-videos/${name}?token=up`, apiKey: "publishable", contentType: "video/mp4"});
  assert.deepEqual(store.buckets.get("engine-videos"), {public: false, allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"]}, "the bucket is private and made once");
  assert.equal((await post({action: "finish", meta})).status, 409, "nothing arrived yet");
  store.objects.set(name, CLIP.subarray(0, 100));
  assert.equal((await post({action: "finish", meta})).status, 409, "part of the file isn't recorded");
  store.objects.set(name, CLIP);
  const finished = await post({action: "finish", meta});
  assert.equal(finished.status, 200, await finished.clone().text());
  const record = (await finished.json()).record;
  assert.deepEqual({storagePath: record.storagePath, duration: record.duration, blobUrl: record.blobUrl}, {storagePath: name, duration: 12, blobUrl: undefined});
  assert.equal((await (await uploads.GET()).json()).mode, "signed");
  const played = await file.GET(new Request(`https://engine.example/api/template-editor/videos/${ID}`), {params: Promise.resolve({id: ID})});
  assert.equal(played.status, 302);
  assert.equal(played.headers.get("location"), `https://project.supabase.co/storage/v1/object/sign/engine-videos/${name}?token=read`);
  assert.equal(played.headers.get("cache-control"), "private, max-age=1800", "the redirect expires before its signed link does");

  // An agent (the MCP bridge) stores a file from its computer the same way.
  const clip = mp4({seconds: 75, width: 1080, height: 1920}), clipId = sha(clip);
  const call = body => agent.POST(new Request("https://engine.example/api/agent/videos", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}));
  const facts = {id: clipId, bytes: clip.length, mimeType: "video/mp4", name: "01-cover-video.mp4"};
  assert.equal((await call({action: "start", ...facts, mimeType: "video/x-matroska"})).status, 415);
  assert.equal((await call({action: "start", ...facts, mimeType: "video/webm"})).status, 400, "a WebM needs its length and size");
  assert.equal((await call({action: "start", ...facts, id: "not-a-hash"})).status, 400);
  const agentStart = await (await call({action: "start", ...facts})).json();
  assert.equal(agentStart.mode, "signed");
  store.objects.set(`te-video/${storage.ownerTag(OWNER)}/${clipId}.mp4`, clip);
  const stored = await call({action: "finish", ...facts});
  assert.equal(stored.status, 201, await stored.clone().text());
  assert.deepEqual(await stored.json(), {src: `/api/template-editor/videos/${clipId}`, mimeType: "video/mp4", duration: 75, width: 1080, height: 1920, bytes: clip.length});
  assert.deepEqual(await (await call({action: "start", ...facts})).json(), {existing: true, src: `/api/template-editor/videos/${clipId}`, mimeType: "video/mp4", duration: 75, width: 1080, height: 1920, bytes: clip.length});
  // A PNG sent as a video is thrown away.
  const png = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(64)]), pngName = `te-video/${storage.ownerTag(OWNER)}/${sha(png)}.mp4`;
  store.objects.set(pngName, png);
  assert.equal((await call({action: "finish", id: sha(png), bytes: png.length, mimeType: "video/mp4"})).status, 415);
  assert.equal(store.objects.has(pngName), false);
  // A link an agent gives is copied into Storage too.
  const linked = await storage.storeVideoFromUrl(OWNER, "https://cdn.example/clip.mp4");
  assert.match(linked.storagePath, /^te-video\/[a-f0-9]{24}\/[a-f0-9]{64}\.mp4$/);
  assert.equal(store.objects.get(linked.storagePath).length, mp4({seconds: 20}).length);
  // Over HTTP, a local path is the bridge's job.
  const agentVideos = f.load("lib/template-editor/agent-videos.ts");
  await assert.rejects(agentVideos.resolveAgentVideos(OWNER, {slides: [{image: {src: COVER, video: {path: "/Users/me/clip.mp4"}}}]}), /MCP bridge/);
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

test("agents add video as its own layer: create, add_video in place of a still, view, update, and a missing poster is flagged", async t => {
  const f = fixture(t, {overrides: {"./review-assets": serving(CLIP, "video/mp4")}});
  const route = f.load("app/api/agent/slides/route.ts"), guides = f.load("lib/template-editor/brand-guide.ts"), seed = f.load("lib/template-editor/brand-guide-seed.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const capabilities = await (await post({action: "capabilities"})).json();
  assert.ok(capabilities.editable.includes("video"));
  assert.ok(JSON.stringify(capabilities.updateSchema).includes("add_video"));
  assert.ok(JSON.stringify(capabilities.deckSchema).includes("\"const\":\"video\""));
  const poster = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64")}`;
  const response = await post({action: "create_deck", operationId: randomUUID(), spec: {name: "Video layers", format: "portrait", slides: [
    {id: "s1", layout: "blank", elements: [
      {id: "still", type: "image", src: COVER, x: 0, y: 0, width: 1080, height: 1000, cropY: 20, radius: 24},
      {id: "headline", type: "text", text: "A clip under the headline", x: 60, y: 1050, width: 960, height: 120},
    ]},
    {id: "s2", layout: "blank", elements: [
      {id: "clip", type: "video", src: "https://cdn.example/clip.mp4", x: 100, y: 600, width: 880, height: 500, start: 1, end: 9, loop: false},
      {id: "caption", type: "text", text: "Over the clip", x: 100, y: 1000, width: 880, height: 80},
    ]},
  ]}});
  assert.equal(response.status, 201, await response.clone().text());
  let value = await response.json();
  let hash = value.hash;
  const stored = value.document.pages[1].canvas.elements[0];
  assert.equal(stored.type, "image", "stored as a photo with a clip, so decks without video load as before");
  assert.deepEqual(stored.video, clipOf({start: 1, end: 9, loop: false, noPoster: true}));
  const viewed = value.view.slides[1].elements[0];
  assert.deepEqual([viewed.type, viewed.src, viewed.poster, viewed.posterMissing, viewed.start, viewed.end, viewed.loop], ["video", clipOf().src, undefined, true, 1, 9, false]);
  assert.deepEqual(value.view.slides[1].elements.map(element => element.id), ["clip", "caption"], "text sits above the video");

  // engine_check_deck: a video layer gets no color complaints, and its missing poster is flagged.
  const guide = seed.builtInBrandGuide("chatgptricks");
  const issues = guides.runGuideChecks(value.document, guide, {scope: "deck", language: "en"});
  const flagged = issues.filter(issue => issue.check === "video-poster");
  assert.deepEqual(flagged.map(issue => [issue.slide, issue.severity]), [[2, "must_fix"]]);
  assert.ok(!issues.some(issue => issue.check === "palette" && /clip|still/i.test(issue.problem)), JSON.stringify(issues));

  const update = async operations => { const result = await post({action: "update_deck", deckId: value.document.id, expectedHash: hash, operationId: randomUUID(), changes: {operations}}); const body = await result.json(); assert.equal(result.status, 200, JSON.stringify(body)); hash = body.hash; return body; };
  // A poster clears the flag; trim fields at the top level change the clip.
  value = await update([{op: "update_element", pageId: "s2", elementId: "clip", properties: {poster, start: 2, muted: false}}]);
  const updated = value.document.pages[1].canvas.elements[0];
  assert.deepEqual(updated.video, clipOf({start: 2, end: 9, loop: false, muted: false}));
  assert.notEqual(updated.src, stored.src);
  assert.equal(guides.runGuideChecks(value.document, guide, {scope: "deck", language: "en"}).filter(issue => issue.check === "video-poster").length, 0);

  // add_video in place of a still: its box, crop and place in the stack; the still is hidden.
  value = await update([{op: "add_video", pageId: "s1", replaces: "still", src: clipOf().src, poster}]);
  const [still, video, headline] = value.document.pages[0].canvas.elements;
  assert.deepEqual([still.id, still.hidden, headline.id], ["still", true, "headline"]);
  assert.deepEqual([video.type, video.x, video.y, video.width, video.height, video.cropY, video.radius], ["image", still.x, still.y, still.width, still.height, 20, still.radius]);
  assert.deepEqual(video.video, clipOf());
  assert.equal(value.view.slides[0].elements[1].type, "video");
  const missing = await post({action: "update_deck", deckId: value.document.id, expectedHash: hash, operationId: randomUUID(), changes: {operations: [{op: "add_video", pageId: "s1"}]}});
  assert.equal(missing.status, 400);
  assert.match(JSON.stringify(await missing.json()), /needs src/);
});

test("the @chatgptricks cover's photo and a later slide's photo or chart can each be a video", async t => {
  const f = fixture(t, {overrides: {"./review-assets": serving(CLIP, "video/mp4")}});
  const route = f.load("app/api/agent/slides/route.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const cover = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64")}`;
  const spec = {name: "Video carousel", templateId: "chatgptricks-3x4", slides: [
    {templatePage: 0, title: "A cover that moves", image: {src: cover, alt: "Clip", video: {url: "https://cdn.example/clip.mp4"}}},
    {templatePage: 1, title: "A point with a clip", body: "Under the title", image: {src: cover, alt: "Clip", video: {url: "https://cdn.example/clip.mp4", start: 1, end: 9}}},
    {templatePage: 1, title: "A still slide"}, {templatePage: 3},
  ]};
  const response = await post({action: "create_deck", spec, operationId: randomUUID()});
  assert.equal(response.status, 201, await response.clone().text());
  const {document} = await response.json();
  const slot = page => page.canvas.elements.find(element => element.type === "image" && element.templateRole === "media" && element.video);
  assert.equal(slot(document.pages[0])?.slot === "photo", true, "the cover's photo slot holds the clip");
  assert.deepEqual(slot(document.pages[0]).video, clipOf());
  assert.equal(slot(document.pages[1])?.slot === "media", true, "the Text + Media slot holds the clip");
  assert.deepEqual(slot(document.pages[1]).video, clipOf({start: 1, end: 9}));
  assert.deepEqual([slot(document.pages[1]).intrinsicWidth, slot(document.pages[1]).intrinsicHeight], [1080, 1440], "the frame takes the clip's shape");
  assert.equal(document.pages.slice(2).some(slot), false);
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
  assert.ok(capabilities.notes.some(note => /type: \\?"video\\?"/.test(note) && /add_video/.test(note) && /poster/.test(note)));
  const image = decks.AGENT_DECK_SPEC_SCHEMA.properties.slides.items.properties.elements.items.oneOf.find(variant => variant.properties.type.const === "image");
  assert.ok(image.properties.video.properties.url);
  const mcp = fs.readFileSync(path.join(root, "scripts/engine-agent-mcp.mjs"), "utf8");
  assert.match(mcp, /add_video/);
  assert.match(mcp, /\.webm/);
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

test("export places the clip where the canvas shows it: fit, crop point, zoom, flip and rotation", t => {
  const f = fixture(t);
  const {videoMatrix, applyMatrix} = f.load("lib/template-editor/export-video.ts");
  const near = (point, x, y) => { assert.ok(Math.abs(point.x - x) < 1e-6 && Math.abs(point.y - y) < 1e-6, `${JSON.stringify(point)} should be ${x}, ${y}`); };
  const box = {x: 10, y: 20, width: 200, height: 100, rotation: 0};
  // A 400 × 400 clip covering a 200 × 100 box, centred: scale 0.5, 50 cut from top and bottom. Output ×3.
  let m = videoMatrix(box, {fit: "cover", cropX: 50, cropY: 50}, {width: 400, height: 400}, 3);
  near(applyMatrix(m, 0, 0), 30, 60 - 150); near(applyMatrix(m, 400, 400), 630, 60 + 150 + 300);
  // Crop point at the top: the clip's top edge meets the box's top.
  m = videoMatrix(box, {fit: "cover", cropX: 50, cropY: 0}, {width: 400, height: 400}, 1);
  near(applyMatrix(m, 0, 0), 10, 20);
  // Contain fits the whole clip inside: 100 × 100, centred across the 200 width.
  m = videoMatrix(box, {fit: "contain", cropX: 50, cropY: 50}, {width: 400, height: 400}, 1);
  near(applyMatrix(m, 0, 0), 60, 20); near(applyMatrix(m, 400, 400), 160, 120);
  // Zoom 2 about the crop point (the centre) doubles around the box centre; a flip mirrors about it.
  m = videoMatrix(box, {fit: "contain", cropX: 50, cropY: 50, cropScale: 2, flipX: true}, {width: 400, height: 400}, 1);
  near(applyMatrix(m, 0, 0), 210, -30); near(applyMatrix(m, 400, 400), 10, 170);
  // A quarter turn about the box centre (110, 70): the clip's top left goes to the top right.
  m = videoMatrix({...box, rotation: 90}, {fit: "contain", cropX: 50, cropY: 50}, {width: 400, height: 400}, 1);
  near(applyMatrix(m, 0, 0), 160, 20);
});

test("a page exports its lowest visible clip, at Instagram's width, with its warnings", t => {
  const f = fixture(t);
  const ex = f.load("lib/template-editor/export-video.ts"), {preflightDesign} = f.load("lib/template-editor/preflight.ts"), model = f.load("lib/template-editor/model.ts");
  const design = model.createBlankDesign("Clips", "portrait");
  const page = design.pages[0];
  page.canvas = scene([
    imageLayer({id: "hidden", hidden: true, video: clipOf()}),
    imageLayer({id: "first", video: clipOf({start: 1, end: 2.5})}),
    imageLayer({id: "second", video: clipOf()}),
  ]);
  const video = ex.pageVideo(page);
  assert.equal(video.element.id, "first");
  assert.equal(video.others, 1);
  assert.deepEqual(ex.videoWindow(video.clip), {start: 1, duration: 1.5, speed: 1, length: 1.5});
  assert.deepEqual(ex.videoWindow(clipOf({duration: 200})), {start: 0, duration: 60, speed: 1, length: 60}, "a slide plays at most a minute");
  assert.deepEqual(ex.videoWindow(clipOf({duration: 200, speed: 2})), {start: 0, duration: 120, speed: 2, length: 60}, "at 2× a minute of slide is two of the clip");
  assert.equal(ex.pageVideo({canvas: scene([imageLayer()])}), undefined);
  assert.deepEqual(ex.videoOutputSize(360, 480, 3), {width: 1080, height: 1440, scale: 3});
  assert.deepEqual(ex.videoOutputSize(360, 480, 6), {width: 1080, height: 1440, scale: 3}, "never wider than 1080");
  assert.deepEqual(ex.videoOutputSize(360, 450, 1.5), {width: 540, height: 676, scale: 1.5}, "sides stay even");
  const warnings = ex.videoExportWarnings(2, video, {bytes: 120 * 1024 ** 2, ext: "webm"});
  assert.equal(warnings.length, 4);
  assert.match(warnings.join(" "), /at least 3.*other video.*120 MB.*WEBM/s);
  const codes = preflightDesign(design).filter(issue => issue.code.startsWith("video")).map(issue => `${issue.elementId}:${issue.code}`).sort();
  assert.deepEqual(codes, ["first:video-short", "second:video-extra"]);
});

// Clip edits after OpenFilm's clip attributes: speed, volume, fades, and splitting a slide.
test("a clip keeps its speed, volume and fades, within their ranges, and the 60 seconds count played time", t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts");
  const clip = clipOf({duration: 150, speed: 2, volume: 0.5, fadeIn: 1, fadeOut: 2.5});
  assert.deepEqual(model.parseVideoClip(clip), {...clip, end: 120}, "at 2× a slide holds two minutes of the file");
  assert.deepEqual(model.parseVideoClip(clipOf({speed: 1, volume: 1, fadeIn: 0})), clipOf(), "defaults aren't stored");
  for (const bad of [{speed: 0.1}, {speed: 5}, {volume: -1}, {volume: 3}, {fadeIn: 11}, {fadeOut: -1}, {speed: "2"}]) assert.equal(model.parseVideoClip(clipOf(bad)), null, JSON.stringify(bad));
  assert.equal(model.parseVideoClip(clipOf({speed: 1.234})).speed, 1.23);
  const library = {...model.EMPTY_LIBRARY, designs: [{...model.createBlankDesign("Edits", "portrait")}]};
  library.designs[0].pages[0].canvas = scene([imageLayer({video: clipOf({speed: 0.5, volume: 1.5, fadeOut: 1})})]);
  assert.deepEqual(model.parseLibrary(library).designs[0].pages[0].canvas.elements[0].video, clipOf({speed: 0.5, volume: 1.5, fadeOut: 1}), "round-trips through the library");
});

test("clip timing: the file's seconds behind each moment of the slide, and the fades' levels", t => {
  const f = fixture(t), timing = f.load("lib/template-editor/clip-timing.ts");
  const clip = clipOf({start: 2, end: 10, speed: 2, volume: 0.8, fadeIn: 1, fadeOut: 2});
  assert.deepEqual(timing.playWindow(clip), {start: 2, end: 10, speed: 2, length: 4});
  assert.equal(timing.sourceTimeAt(clip, 1.5), 5);
  assert.equal(timing.sourceTimeAt(clip, 99), 10, "never past the end");
  assert.equal(timing.slideTimeAt(clip, 6), 2);
  assert.equal(timing.fadeAt(clip, 0), 0);
  assert.equal(timing.fadeAt(clip, 0.5), 0.5);
  assert.equal(timing.fadeAt(clip, 2), 1);
  assert.equal(timing.fadeAt(clip, 3), 0.5);
  assert.equal(timing.fadeAt(clip, 4), 0);
  assert.ok(Math.abs(timing.gainAt(clip, 0.5) - 0.4) < 1e-9);
  // Fades longer than the slide shrink together, in proportion.
  assert.deepEqual(timing.fadeLengths(clipOf({start: 0, end: 3, fadeIn: 3, fadeOut: 3})), {fadeIn: 1.5, fadeOut: 1.5});
  assert.equal(timing.changesSound(clipOf()), false);
  assert.equal(timing.changesSound(clipOf({volume: 0})), true);
  assert.equal(timing.fadesPicture(clipOf({fadeOut: 1})), true);
});

test("a long clip at 2× splits every two minutes of the file; fades stay on its outer ends", t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts"), slides = f.load("lib/template-editor/video-slides.ts");
  assert.deepEqual(slides.videoParts({duration: 170, speed: 2}), [{start: 0, end: 120}, {start: 120, end: 170}]);
  assert.equal(slides.needsVideoSlides(clipOf({duration: 110, speed: 2})), false);
  const design = model.createBlankDesign("Long", "portrait");
  design.pages[0].canvas = scene([imageLayer({video: clipOf({duration: 170, speed: 2, fadeIn: 1, fadeOut: 2})})]);
  const result = slides.splitVideoAcrossSlides(design, design.pages[0].id, "video-1");
  const clips = result.design.pages.map(page => page.canvas.elements[0].video);
  assert.deepEqual(clips.map(clip => [clip.start, clip.end, clip.fadeIn, clip.fadeOut, clip.speed]), [[undefined, 120, 1, undefined, 2], [120, undefined, undefined, 2, 2]]);
});

test("split a video slide at a moment: the slide keeps the part before it, a copy right after plays the rest", t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts"), slides = f.load("lib/template-editor/video-slides.ts");
  const design = model.createBlankDesign("Split", "portrait");
  const title = {...model.createCanvasElement("text"), id: "title", text: "Watch"};
  const after = {...design.pages[0], id: "after", image: {...design.pages[0].image, id: "after-image"}, canvas: scene([])};
  design.pages = [{...design.pages[0], canvas: scene([title, imageLayer({video: clipOf({start: 1, end: 11, fadeIn: 0.5, fadeOut: 1, volume: 0.7})})])}, after];
  const cover = {src: COVER.replace(/c+$/, "d".repeat(64))};
  const result = slides.splitVideoAt(design, design.pages[0].id, "video-1", 4.25, cover);
  assert.equal(result.pageIds.length, 1);
  const pages = result.design.pages;
  assert.deepEqual(pages.map(page => page.id), [design.pages[0].id, result.pageIds[0], "after"]);
  const [a, b] = pages.slice(0, 2).map(page => page.canvas.elements[1]);
  assert.deepEqual([a.video.start, a.video.end, a.video.fadeIn, a.video.fadeOut, a.video.volume], [1, 4.25, 0.5, undefined, 0.7]);
  assert.deepEqual([b.video.start, b.video.end, b.video.fadeIn, b.video.fadeOut, b.video.volume], [4.25, 11, undefined, 1, 0.7]);
  assert.equal(a.src, COVER); assert.equal(b.src, cover.src); assert.equal(b.video.coverTime, 4.25);
  assert.notEqual(a.id, b.id, "the copy's layers have ids of their own");
  assert.equal(pages[1].canvas.elements[0].text, "Watch");
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY, designs: [result.design]}), "the result is a valid deck");
  assert.throws(() => slides.splitVideoAt(design, design.pages[0].id, "video-1", 1.2), /at least 0.5 seconds inside/);
  assert.throws(() => slides.splitVideoAt(design, design.pages[0].id, "video-1", 10.8), /at least 0.5 seconds inside/);
  assert.throws(() => slides.splitVideoAt(design, design.pages[0].id, "title", 3), /no video/);
  const full = {...design, pages: Array.from({length: 20}, (_, i) => ({...design.pages[0], id: `p${i}`}))};
  assert.throws(() => slides.splitVideoAt(full, "p0", "video-1", 5), /holds 20/);
});

test("agents set speed, volume and fades on video layers and split a video slide", async t => {
  const f = fixture(t, {overrides: {"./review-assets": serving(CLIP)}});
  const route = f.load("app/api/agent/slides/route.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const created = await post({action: "create_deck", operationId: randomUUID(), spec: {name: "Edits", format: "portrait", slides: [
    {id: "s1", layout: "blank", elements: [{id: "clip", type: "video", src: "https://cdn.example/clip.mp4", poster: COVER, x: 0, y: 0, width: 1080, height: 1440, speed: 0.5, volume: 1.4, fadeIn: 1, start: 0, end: 4}]},
  ]}});
  assert.equal(created.status, 201, await created.clone().text());
  const deck = await created.json();
  const stored = deck.document.pages[0].canvas.elements[0].video;
  assert.deepEqual([stored.speed, stored.volume, stored.fadeIn, stored.end], [0.5, 1.4, 1, 4]);
  const update = changes => post({action: "update_deck", deckId: deck.document.id, expectedHash: deck.hash, operationId: randomUUID(), changes});
  const changed = await update({operations: [{op: "update_element", pageId: "s1", elementId: "clip", properties: {speed: 2, fadeOut: 0.5, end: 12}}]});
  assert.equal(changed.status, 200, await changed.clone().text());
  const after = await changed.json();
  const clip = after.document.pages[0].canvas.elements[0].video;
  assert.deepEqual([clip.speed, clip.volume, clip.fadeIn, clip.fadeOut, clip.end], [2, 1.4, 1, 0.5, undefined]);
  const view = after.view.slides[0].elements[0];
  assert.equal(view.type, "video");
  const split = await post({action: "update_deck", deckId: deck.document.id, expectedHash: after.hash, operationId: randomUUID(), changes: {operations: [{op: "split_video", pageId: "s1", elementId: "clip", at: 5}]}});
  assert.equal(split.status, 200, await split.clone().text());
  const splitDeck = await split.json(), pages = splitDeck.document.pages;
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map(page => [page.canvas.elements[0].video.start, page.canvas.elements[0].video.end]), [[undefined, 5], [5, undefined]]);
  const bad = await post({action: "update_deck", deckId: deck.document.id, expectedHash: splitDeck.hash, operationId: randomUUID(), changes: {operations: [{op: "split_video", pageId: "s1", elementId: "clip", at: 0.2}]}});
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /inside the part that plays/);
  const tooFast = await post({action: "update_deck", deckId: deck.document.id, expectedHash: splitDeck.hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: "s1", elementId: "clip", properties: {speed: 8}}]}});
  assert.equal(tooFast.status, 400);
});

test("engine_capabilities lists the clip edits and split_video", async t => {
  const f = fixture(t), {agentCapabilities} = f.load("lib/template-editor/agent-decks.ts");
  const text = JSON.stringify(agentCapabilities());
  for (const word of ["\"speed\"", "\"volume\"", "\"fadeIn\"", "\"fadeOut\"", "split_video"]) assert.ok(text.includes(word), word);
});

// Timed captions after OpenFilm's caption tracks: cues on the clip, in its own seconds, shown by a caption layer.
const SRT = `1
00:00:00,500 --> 00:00:02,000
<i>This changes</i>   everything

2
00:00:02,000 --> 00:00:04,250
Watch the
left side
`;
const VTT = `WEBVTT

NOTE made by hand

intro
00:01.000 --> 00:02.500 align:center line:90%
<v Ivan>Hello &amp; welcome</v>

00:00:03.000 --> 00:00:05.000
<c.yellow>Second</c>
`;

test("captions read from SRT and WebVTT files, and write back as SRT", t => {
  const f = fixture(t), captions = f.load("lib/template-editor/captions.ts");
  assert.deepEqual(captions.parseCaptionFile(SRT), [{start: 0.5, end: 2, text: "This changes everything"}, {start: 2, end: 4.25, text: "Watch the\nleft side"}]);
  assert.deepEqual(captions.parseCaptionFile(VTT), [{start: 1, end: 2.5, text: "Hello & welcome"}, {start: 3, end: 5, text: "Second"}], "cue ids, settings, NOTE blocks and tags are dropped");
  assert.deepEqual(captions.parseCaptionFile("﻿" + SRT.replace(/\n/g, "\r\n")), captions.parseCaptionFile(SRT), "a BOM and Windows line ends read the same");
  const srt = captions.formatSrt(captions.parseCaptionFile(SRT));
  assert.match(srt, /^1\n00:00:00,500 --> 00:00:02,000\nThis changes everything\n/);
  assert.deepEqual(captions.parseCaptionFile(srt), captions.parseCaptionFile(SRT), "round trip");
  assert.throws(() => captions.parseCaptionFile("hello"), /no captions/);
  assert.throws(() => captions.parseCaptionFile("1\nsoon --> later\nHi\n"), /can't read/);
  assert.throws(() => captions.parseCaptionFile(Array.from({length: 301}, (_, i) => `${i}\n00:00:${String(i % 60).padStart(2, "0")},000 --> 00:00:${String(i % 60).padStart(2, "0")},500\nx\n`).join("\n")), /holds 300/);
});

test("a clip keeps checked captions in its own seconds; a text layer can be its caption layer", t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts");
  const cues = [{start: 3, end: 4, text: "  second  "}, {start: 0.5, end: 2, text: "first"}, {start: 20, end: 21, text: "after the clip"}, {start: 5, end: 6, text: "   "}];
  assert.deepEqual(model.parseVideoClip(clipOf({captions: cues})).captions, [{start: 0.5, end: 2, text: "first"}, {start: 3, end: 4, text: "second"}], "sorted, trimmed; past the end and empty ones left out");
  assert.equal(model.parseVideoClip(clipOf({captions: []})).captions, undefined);
  for (const bad of [[{start: 2, end: 2.05, text: "short"}], [{start: -1, end: 1, text: "x"}], [{start: 0, end: 1, text: "x".repeat(201)}], [{start: 0, end: 1, text: "x", extra: 1}], [{start: "0", end: 1, text: "x"}], "1\n00:00:00,000 --> 00:00:01,000\nx"]) assert.equal(model.parseVideoClip(clipOf({captions: bad})), null, JSON.stringify(bad));
  const library = {...model.EMPTY_LIBRARY, designs: [{...model.createBlankDesign("Captions", "portrait")}]};
  const layer = {...model.createCanvasElement("text"), id: "caps", captions: true};
  library.designs[0].pages[0].canvas = scene([imageLayer({video: clipOf({captions: [{start: 1, end: 2, text: "Hi"}]})}), layer]);
  const parsed = model.parseLibrary(library).designs[0].pages[0].canvas.elements;
  assert.deepEqual(parsed[0].video.captions, [{start: 1, end: 2, text: "Hi"}]);
  assert.equal(parsed[1].captions, true, "round-trips through the library");
});

test("the cue showing at each moment follows the trim and speed, and a split keeps each cue on its moment", t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts"), captions = f.load("lib/template-editor/captions.ts"), slides = f.load("lib/template-editor/video-slides.ts");
  const cues = [{start: 1, end: 3, text: "one"}, {start: 3, end: 5, text: "two"}, {start: 7, end: 9, text: "three"}];
  assert.equal(captions.cueAt(cues, 0.9), undefined);
  assert.equal(captions.cueAt(cues, 3)?.text, "two", "the next cue takes over at its start");
  assert.equal(captions.cueAt(cues, 6), undefined);
  // Trimmed to 2–8 s of the file at 2×: the slide plays 3 seconds.
  const clip = clipOf({start: 2, end: 8, speed: 2, captions: cues});
  assert.deepEqual(captions.captionSegments(clip), [{from: 0, to: 0.5, text: "one"}, {from: 0.5, to: 1.5, text: "two"}, {from: 1.5, to: 2.5, text: null}, {from: 2.5, to: 3, text: "three"}]);
  assert.deepEqual(captions.captionSegments(clipOf()), [{from: 0, to: 12, text: null}]);
  assert.equal(captions.coverCue(clipOf({coverTime: 4, captions: cues})).text, "two");
  const design = model.createBlankDesign("Split", "portrait");
  design.pages[0].canvas = scene([imageLayer({video: clipOf({captions: cues})}), {...model.createCanvasElement("text"), id: "caps", captions: true}]);
  const pages = slides.splitVideoAt(design, design.pages[0].id, "video-1", 4).design.pages;
  assert.deepEqual(pages.map(page => captions.captionSegments(page.canvas.elements[0].video).filter(item => item.text).map(item => [item.from, item.to, item.text])), [[[1, 3, "one"], [3, 4, "two"]], [[0, 1, "two"], [3, 5, "three"]]]);
  assert.ok(pages[1].canvas.elements.some(captions.isCaptionLayer), "the copy keeps its caption layer");
  assert.equal(captions.captionClip(pages[1].canvas, pages[1].canvas.elements[1]).id, pages[1].canvas.elements[0].id);
});

test("a slide whose clip has captions gets a caption layer near its foot, in the slide's font, once", t => {
  const f = fixture(t), model = f.load("lib/template-editor/model.ts"), captions = f.load("lib/template-editor/captions.ts");
  const title = {...model.createCanvasElement("text"), id: "title", font: "inter"};
  const bare = scene([imageLayer({video: clipOf()}), title]);
  assert.equal(captions.withCaptionLayer(bare, {x: 0, y: 0, width: 360, height: 480}, () => "caps"), bare, "no cues, no layer");
  const withCues = scene([imageLayer({video: clipOf({captions: [{start: 0, end: 1, text: "Hi"}]})}), title]);
  const added = captions.withCaptionLayer(withCues, {x: 0, y: 0, width: 360, height: 480}, () => "caps");
  const layer = added.elements.at(-1);
  assert.deepEqual([layer.id, layer.type, layer.captions, layer.font, layer.align, layer.color, layer.fontWeight], ["caps", "text", true, "inter", "center", "#ffffff", 700]);
  assert.ok(layer.y > 480 * 0.7 && layer.y + layer.height <= 480 && Math.abs(layer.x + layer.width / 2 - 180) < 1e-9, "centred near the foot");
  assert.equal(captions.withCaptionLayer(added, {x: 0, y: 0, width: 360, height: 480}, () => "again"), added, "a second call adds nothing");
  assert.ok(model.parseCanvas(added), "the layer is a valid text layer");
});

test("agents give a video layer captions as cues or an SRT/VTT file's text, and Engine adds the caption layer", async t => {
  const f = fixture(t, {overrides: {"./review-assets": serving(CLIP)}});
  const route = f.load("app/api/agent/slides/route.ts");
  const post = body => route.POST(new Request("https://engine.example/api/agent/slides", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
  const created = await post({action: "create_deck", operationId: randomUUID(), spec: {name: "Captions", format: "portrait", slides: [
    {id: "s1", layout: "blank", elements: [{id: "title", type: "text", text: "Watch", font: "inter", x: 60, y: 60, width: 960, height: 120}, {id: "clip", type: "video", src: "https://cdn.example/clip.mp4", poster: COVER, x: 0, y: 0, width: 1080, height: 1440, captions: [{start: 0.5, end: 2, text: "This changes everything"}]}]},
  ]}});
  assert.equal(created.status, 201, await created.clone().text());
  const deck = await created.json();
  const elements = deck.document.pages[0].canvas.elements;
  assert.deepEqual(elements.find(item => item.id === "clip").video.captions, [{start: 0.5, end: 2, text: "This changes everything"}]);
  const layer = elements.find(item => item.captions === true);
  assert.ok(layer, "a caption layer was added");
  assert.equal(layer.font, "inter");
  assert.equal(layer.id, "clip-captions");
  // An SRT file's text replaces the cues; the caption layer stays the one there.
  const changed = await post({action: "update_deck", deckId: deck.document.id, expectedHash: deck.hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: "s1", elementId: "clip", properties: {captions: SRT}}, {op: "update_element", pageId: "s1", elementId: layer.id, properties: {color: "#ffd400", fontSize: 64}}]}});
  assert.equal(changed.status, 200, await changed.clone().text());
  const after = await changed.json();
  const now = after.document.pages[0].canvas.elements;
  assert.deepEqual(now.find(item => item.id === "clip").video.captions.map(cue => cue.text), ["This changes everything", "Watch the\nleft side"]);
  assert.equal(now.filter(item => item.captions === true).length, 1);
  assert.equal(now.find(item => item.captions === true).color, "#ffd400");
  assert.deepEqual(after.view.slides[0].elements.find(item => item.id === "clip").captions?.length ?? after.view.slides[0].elements.find(item => item.id === "clip").video.captions.length, 2);
  for (const [captionsValue, pattern] of [["not a caption file", /\.captions.*no captions/], [[{start: 1, end: 0.5, text: "x"}], /\.captions.*list of at most 300 cues/]]) {
    const bad = await post({action: "update_deck", deckId: deck.document.id, expectedHash: after.hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: "s1", elementId: "clip", properties: {captions: captionsValue}}]}});
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), pattern);
  }
  const file = await post({action: "update_deck", deckId: deck.document.id, expectedHash: after.hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: "s1", elementId: "clip", properties: {captionsFile: "/tmp/captions.srt"}}]}});
  assert.equal(file.status, 400);
  assert.match(await file.text(), /captionsFile.*Engine MCP bridge/);
  const cleared = await post({action: "update_deck", deckId: deck.document.id, expectedHash: after.hash, operationId: randomUUID(), changes: {operations: [{op: "update_element", pageId: "s1", elementId: "clip", properties: {captions: []}}]}});
  assert.equal(cleared.status, 200, await cleared.clone().text());
  assert.equal((await cleared.json()).document.pages[0].canvas.elements.find(item => item.id === "clip").video.captions, undefined);
});

test("a caption layer with nothing to show is flagged before export", t => {
  const f = fixture(t), {preflightDesign} = f.load("lib/template-editor/preflight.ts"), model = f.load("lib/template-editor/model.ts");
  const design = model.createBlankDesign("Captions", "portrait");
  const caps = {...model.createCanvasElement("text"), id: "caps", captions: true, text: "Captions show here"};
  design.pages[0].canvas = scene([imageLayer({video: clipOf()}), caps]);
  assert.deepEqual(preflightDesign(design).filter(issue => issue.code === "captions-empty").map(issue => issue.elementId), ["caps"]);
  design.pages[0].canvas = scene([imageLayer({video: clipOf({captions: [{start: 0, end: 1, text: "Hi"}]})}), caps]);
  assert.deepEqual(preflightDesign(design).filter(issue => issue.code === "captions-empty"), []);
});

test("engine_capabilities explains captions and caption layers", async t => {
  const f = fixture(t), {agentCapabilities} = f.load("lib/template-editor/agent-decks.ts");
  const text = JSON.stringify(agentCapabilities());
  for (const word of ["\"captions\"", "captionsFile", "caption layer", ".srt"]) assert.ok(text.includes(word), word);
});

test("export burns captions in: the layers over the clip are captured once per caption, and each second picks its own", async t => {
  const f = fixture(t), ex = f.load("lib/template-editor/export-video.ts");
  const text = {innerHTML: "<div class=\"te-canvas-text-line\"><span>Captions show here</span></div>"};
  const caption = {dataset: {elementId: "caps", captionLayer: "hidden"}, style: {visibility: "hidden"}, querySelector: () => text};
  const video = {dataset: {elementId: "video-1"}, style: {}, querySelector: () => null};
  const clip = clipOf({start: 2, end: 8, speed: 2, captions: [{start: 1, end: 3, text: "one"}, {start: 3, end: 5, text: "two & <three>"}, {start: 7, end: 9, text: "four"}]});
  let unders = 0;
  const shots = [];
  const {under, over} = await ex.captureCaptioned([video, caption], clip, new Set(), new Set(["caps"]), async () => ({under: ++unders}), async () => { const shot = {visibility: caption.style.visibility, html: text.innerHTML}; shots.push(shot); return shot; });
  assert.equal(unders, 1, "nothing under the clip changes, so it's captured once");
  assert.equal(typeof under, "object");
  assert.equal(shots.length, 4, "one capture per caption, and one for none");
  assert.deepEqual([0.2, 1, 2, 2.9].map(time => over(time).visibility === "hidden" ? null : over(time).html.replace(/<[^>]+>/g, "")), ["one", "two &amp; &lt;three&gt;", null, "four"]);
  assert.deepEqual([caption.style.visibility, text.innerHTML], ["hidden", "<div class=\"te-canvas-text-line\"><span>Captions show here</span></div>"], "the frame is put back");
  // Without caption layers or cues: one capture each, as before.
  let plain = 0;
  const flat = await ex.captureCaptioned([video], clip, new Set(), new Set(), async () => ++plain, async () => ++plain);
  assert.deepEqual([plain, typeof flat.over], [2, "number"]);
});

// Sound at any speed: the export plays a slide's sound at its speed with the pitch kept.
test("time-stretched sound lasts length / speed and keeps its pitch", t => {
  const f = fixture(t), {stretchAudio} = f.load("lib/engine/time-stretch.ts");
  const rate = 8000, tone = 440, seconds = 2;
  const wave = Float32Array.from({length: rate * seconds}, (_, i) => Math.sin(2 * Math.PI * tone * i / rate) * 0.5);
  const pitch = samples => { // zero crossings per second, halved
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++;
    return crossings / 2 / (samples.length / rate);
  };
  for (const speed of [0.5, 2, 1.5]) {
    const [out] = stretchAudio([wave], speed, rate);
    assert.equal(out.length, Math.round(wave.length / speed), `${speed}×: ${seconds / speed} seconds`);
    const middle = out.subarray(Math.round(out.length * 0.1), Math.round(out.length * 0.9));
    assert.ok(Math.abs(pitch(middle) - tone) < tone * 0.03, `${speed}×: still ${tone} Hz, got ${pitch(middle)}`);
    const peak = middle.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    assert.ok(peak > 0.4 && peak <= 0.55, `${speed}×: as loud as before, got ${peak}`);
  }
  const stereo = stretchAudio([wave, wave.map(value => -value)], 2, rate);
  assert.equal(stereo.length, 2, "every channel");
  assert.ok(Math.abs(stereo[0][4000] + stereo[1][4000]) < 1e-6, "channels stay in step");
  assert.deepEqual([...stretchAudio([wave], 1, rate)[0].subarray(0, 5)], [...wave.subarray(0, 5)], "1× is the sound as it is");
});

test("a download says why a slide came out silent", t => {
  const f = fixture(t), ex = f.load("lib/template-editor/export-video.ts");
  const page = {canvas: {background: "#000", elements: [{...imageLayer(), id: "v", video: clipOf({duration: 8, speed: 2})}]}};
  const video = ex.pageVideo(page);
  const say = note => ex.videoExportWarnings(1, video, {bytes: 1, ext: "mp4", sound: true, audioNote: note}).join(" ");
  assert.doesNotMatch(say("sound included"), /silent|sound/, "no notice when the sound is in");
  assert.match(say("source has no audio track"), /file has no sound/);
  assert.match(say("sound left out: this browser can't change its speed"), /can't play the sound at 2×.*Chrome/);
  assert.match(say("audio is opus, can't copy"), /couldn't read the video's sound/);
  assert.doesNotMatch(ex.videoExportWarnings(1, video, {bytes: 1, ext: "mp4", sound: false, audioNote: "sound left out"}).join(" "), /silent/, "unticked: no notice");
});
