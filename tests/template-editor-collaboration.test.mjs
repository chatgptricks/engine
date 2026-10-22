import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), native = createRequire(import.meta.url);
const Y = native("yjs");
function loader(dependencies = {}, environment = process) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(root, relative), unit = {exports: {}};
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`, {filename})((name) => Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : native(name), unit, unit.exports, environment);
    cache.set(relative, unit.exports); return unit.exports;
  }
  return load;
}
const load = loader(), model = load("lib/template-editor/model.ts"), collaboration = load("lib/template-editor/collaboration-document.ts");
function fixture(rich = false) {
  const document = model.createBlankDesign("Together", "portrait"), element = model.createCanvasElement("text");
  element.text = "Hello"; if (rich) element.richText = "Hello";
  document.pages[0].canvas.elements.push(element); return document;
}
function replica(state) {const doc = collaboration.createCollaborationDocument(); Y.applyUpdate(doc, state); return doc;}
function edit(doc, mutation) {
  const before = collaboration.readCollaborationDocument(doc), next = structuredClone(before); mutation(next);
  const vector = Y.encodeStateVector(doc); collaboration.writeCollaborationDocument(doc, before, next);
  return Y.encodeStateAsUpdate(doc, vector);
}

test("three editors merge same-text insertions and independent layer changes without copies", () => {
  const original = fixture(), baseline = collaboration.createCollaborationDocument(original), state = Y.encodeStateAsUpdate(baseline);
  const docs = [replica(state), replica(state), replica(state)];
  const updates = [edit(docs[0], value => {value.pages[0].canvas.elements[0].text += " Alice";}), edit(docs[1], value => {value.pages[0].canvas.elements[0].text += " Bob";}), edit(docs[2], value => {value.pages[0].canvas.elements[0].x = 75; value.caption = "Third editor";})];
  for (const doc of docs) for (const update of updates.toReversed()) Y.applyUpdate(doc, update);
  const results = docs.map(collaboration.readCollaborationDocument); assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
  assert.match(results[0].pages[0].canvas.elements[0].text, /Alice/); assert.match(results[0].pages[0].canvas.elements[0].text, /Bob/); assert.equal(results[0].pages[0].canvas.elements[0].x, 75); assert.equal(results[0].id, original.id);
  baseline.destroy(); docs.forEach(doc => doc.destroy());
});
test("ordinary unformatted rich text merges characters and always regenerates balanced safe HTML", () => {
  const baseline = collaboration.createCollaborationDocument(fixture(true)), state = Y.encodeStateAsUpdate(baseline), one = replica(state), two = replica(state);
  const first = edit(one, value => {value.pages[0].canvas.elements[0].text += " & Alice"; value.pages[0].canvas.elements[0].richText += " &amp; Alice";});
  const second = edit(two, value => {value.pages[0].canvas.elements[0].text += " Bob"; value.pages[0].canvas.elements[0].richText += " Bob";});
  Y.applyUpdate(one, second); Y.applyUpdate(two, first);
  const result = collaboration.readCollaborationDocument(one).pages[0].canvas.elements[0];
  assert.match(result.text, /Alice/); assert.match(result.text, /Bob/); assert.equal(model.richTextToPlain(result.richText), result.text); assert.equal(model.sanitizeRichText(result.richText), result.richText);
  [baseline, one, two].forEach(doc => doc.destroy());
});
test("concurrent layer additions, reordering and deletion preserve independent new rows", () => {
  const original = fixture(); const second = model.createCanvasElement("shape"); original.pages[0].canvas.elements.push(second);
  const baseline = collaboration.createCollaborationDocument(original), state = Y.encodeStateAsUpdate(baseline), one = replica(state), two = replica(state), three = replica(state);
  const added = model.createCanvasElement("shape"), updates = [edit(one, value => {value.pages[0].canvas.elements.reverse();}), edit(two, value => {value.pages[0].canvas.elements.push(added);}), edit(three, value => {value.pages[0].canvas.elements = value.pages[0].canvas.elements.filter(element => element.id !== second.id);})];
  for (const doc of [one, two, three]) for (const update of updates) Y.applyUpdate(doc, update);
  const result = collaboration.readCollaborationDocument(one).pages[0].canvas.elements;
  assert.equal(result.length, 2); assert.ok(result.some(element => element.id === added.id)); assert.ok(!result.some(element => element.id === second.id));
  assert.deepEqual(collaboration.readCollaborationDocument(one), collaboration.readCollaborationDocument(two));
  [baseline, one, two, three].forEach(doc => doc.destroy());
});
test("per-user undo preserves another editor's changes", () => {
  const baseline = collaboration.createCollaborationDocument(fixture()), state = Y.encodeStateAsUpdate(baseline), one = replica(state), two = replica(state);
  const undo = new Y.UndoManager(one.getMap("document"), {trackedOrigins: new Set([collaboration.COLLABORATION_LOCAL_ORIGIN])});
  edit(one, value => {value.caption = "Alice";}); const remote = edit(two, value => {value.pages[0].canvas.elements[0].x = 92;}); Y.applyUpdate(one, remote, collaboration.COLLABORATION_REMOTE_ORIGIN);
  undo.undo(); const result = collaboration.readCollaborationDocument(one); assert.equal(result.caption, ""); assert.equal(result.pages[0].canvas.elements[0].x, 92);
  undo.destroy(); [baseline, one, two].forEach(doc => doc.destroy());
});
test("a focused input with an earlier baseline preserves remote prefixes and avoids stale text indices", () => {
  const original = fixture(), baseline = collaboration.createCollaborationDocument(original), state = Y.encodeStateAsUpdate(baseline), one = replica(state), two = replica(state);
  const before = collaboration.readCollaborationDocument(one), remote = edit(two, value => {value.pages[0].canvas.elements[0].text = "Remote Hello";});
  Y.applyUpdate(one, remote); const next = structuredClone(before); next.pages[0].canvas.elements[0].text += " local";
  collaboration.writeCollaborationDocument(one, before, next);
  assert.equal(collaboration.readCollaborationDocument(one).pages[0].canvas.elements[0].text, "Remote Hello local");
  [baseline, one, two].forEach(doc => doc.destroy());
});
test("concurrent timestamps stay outside individual undo and immutable root metadata survives", () => {
  const original = fixture(), baseline = collaboration.createCollaborationDocument(original), state = Y.encodeStateAsUpdate(baseline), one = replica(state), two = replica(state);
  const undo = new Y.UndoManager(one.getMap("document"), {trackedOrigins: new Set([collaboration.COLLABORATION_LOCAL_ORIGIN])});
  edit(one, value => {value.pages[0].canvas.elements[0].text = "Alice"; value.updatedAt = "2026-10-13T14:00:01.000Z"; value.createdAt = "2026-10-13T14:00:01.000Z";});
  const remote = edit(two, value => {value.pages[0].canvas.elements[0].x = 87; value.updatedAt = "2026-10-13T14:00:02.000Z";});
  Y.applyUpdate(one, remote, collaboration.COLLABORATION_REMOTE_ORIGIN);
  const beforeMetadata = collaboration.readCollaborationDocument(one), afterMetadata = {...beforeMetadata, updatedAt: "2026-10-13T14:00:03.000Z"};
  collaboration.writeCollaborationDocument(one, beforeMetadata, afterMetadata, collaboration.COLLABORATION_REMOTE_ORIGIN);
  undo.undo(); const result = collaboration.readCollaborationDocument(one);
  assert.equal(result.pages[0].canvas.elements[0].text, "Hello"); assert.equal(result.pages[0].canvas.elements[0].x, 87); assert.equal(result.createdAt, original.createdAt); assert.equal(result.updatedAt, afterMetadata.updatedAt); assert.equal(result.id, original.id); assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY, designs: [result]}));
  undo.destroy(); [baseline, one, two].forEach(doc => doc.destroy());
});

function fakeDatabase() {
  const rows = new Map();
  return {rows, from() {
    const conditions = new Map(); let updated, projection = "data";
    const query = {select(columns = "data") {projection = columns; return query;}, eq(key, value) {conditions.set(key, value); return query;}, update(value) {updated = structuredClone(value); return query;}, async insert(value) {if (rows.has(value.owner)) return {error: {code: "23505"}}; rows.set(value.owner, structuredClone(value)); return {error: null};}, async maybeSingle() {
      const row = rows.get(conditions.get("owner"));
      if (updated) {if (!row || row.data.revision !== conditions.get("data->>revision")) return {data: null, error: null}; rows.set(conditions.get("owner"), {...row, ...updated}); return {data: {owner: conditions.get("owner")}, error: null};}
      const value = row && projection.includes(":data->") ? Object.fromEntries(projection.split(",").map(column=>{const [alias,field] = column.split(":data->");return [alias,row.data[field.replace(/^>/,"")]];})) : row;
      return {data: value ? structuredClone(value) : null, error: null};
    }};
    return query;
  }};
}
function store(t, db) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "engine-collaboration-")); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return loader({"@/lib/supabase/admin": {getAdminSupabase: () => db ?? null}}, {cwd: () => directory, env: {NODE_ENV: "test"}})("lib/template-editor/persistence.ts");
}
test("concurrent server instances seed one baseline, CAS commits three edits atomically, and retries are idempotent", async t => {
  const db = fakeDatabase(), one = store(t, db), two = store(t, db), original = fixture();
  await one.saveEditorLibrary("team", {...structuredClone(model.EMPTY_LIBRARY), designs: [original]}, null);
  const seeded = await Promise.all([one.getCollaborationDocument("team", original.id), two.getCollaborationDocument("team", original.id)]);
  assert.equal(seeded[0].state, seeded[1].state); assert.equal(seeded[0].epoch, seeded[1].epoch);
  const docs = [replica(collaboration.decodeCollaborationUpdate(seeded[0].state)), replica(collaboration.decodeCollaborationUpdate(seeded[0].state)), replica(collaboration.decodeCollaborationUpdate(seeded[0].state))];
  const updates = [edit(docs[0], value => {value.caption += "Alice";}), edit(docs[1], value => {value.caption += "Bob";}), edit(docs[2], value => {value.pages[0].canvas.elements[0].x = 61;})].map(collaboration.encodeCollaborationUpdate);
  await Promise.all(updates.map((update, index) => (index % 2 ? two : one).saveCollaborationDocument("team", original.id, update, seeded[0].epoch)));
  const saved = await one.getCollaborationDocument("team", original.id), durable = await two.getEditorLibrary("team");
  assert.match(saved.document.caption, /Alice/); assert.match(saved.document.caption, /Bob/); assert.equal(saved.document.pages[0].canvas.elements[0].x, 61); assert.deepEqual(JSON.parse(JSON.stringify(saved.document)), JSON.parse(JSON.stringify(durable.library.designs[0])));
  const retried = await two.saveCollaborationDocument("team", original.id, updates[0], saved.epoch); assert.equal(retried.revision, saved.revision); assert.equal(retried.version, saved.version);
  const row = db.rows.get("template-editor:team").data; assert.equal(row.collaborationStates[original.id].state, saved.state); assert.equal(row.library.designs.length, 1);
  docs.forEach(doc => doc.destroy());
});
test("invalid cross-owner document updates and unsafe artwork fail before the durable write", async t => {
  const persistence = store(t), original = fixture(); await persistence.saveEditorLibrary("one", {...structuredClone(model.EMPTY_LIBRARY), designs: [original]}, null);
  await assert.rejects(persistence.getCollaborationDocument("other", original.id), /signed-in workspace/);
  const saved = await persistence.getCollaborationDocument("one", original.id), doc = replica(collaboration.decodeCollaborationUpdate(saved.state));
  const update = edit(doc, value => {value.pages[0].canvas.elements.push({...model.createCanvasElement("image"), src: "javascript:alert(1)"});});
  await assert.rejects(persistence.saveCollaborationDocument("one", original.id, collaboration.encodeCollaborationUpdate(update), saved.epoch), /Invalid collaboration/);
  assert.equal((await persistence.getCollaborationDocument("one", original.id)).revision, saved.revision);
  const rogue = new Y.Doc(); rogue.getMap("other-workspace").set("injected", true); await assert.rejects(persistence.saveCollaborationDocument("one", original.id, collaboration.encodeCollaborationUpdate(Y.encodeStateAsUpdate(rogue)), saved.epoch), /Invalid collaboration document root/);
  doc.destroy(); rogue.destroy();
});
test("ordinary saves rotate changed document epoch and stale updates cannot resurrect it", async t => {
  const persistence = store(t), original = fixture(); await persistence.saveEditorLibrary("team", {...structuredClone(model.EMPTY_LIBRARY), designs: [original]}, null);
  const before = await persistence.getCollaborationDocument("team", original.id), library = await persistence.getEditorLibrary("team");
  const changed = structuredClone(library.library); changed.designs[0].name = "Changed outside live room"; await persistence.saveEditorLibrary("team", changed, library.revision);
  const after = await persistence.getCollaborationDocument("team", original.id); assert.notEqual(after.epoch, before.epoch); assert.equal(after.document.name, "Changed outside live room");
  const doc = replica(collaboration.decodeCollaborationUpdate(before.state)), update = edit(doc, value => {value.caption = "stale";});
  await assert.rejects(persistence.saveCollaborationDocument("team", original.id, collaboration.encodeCollaborationUpdate(update), before.epoch), /generation changed/); assert.equal((await persistence.getEditorLibrary("team")).library.designs[0].caption, ""); doc.destroy();
});
test("awareness clears deleted page/layer selections and rejects malformed geometry and oversized previews", () => {
  const server = loader({"@/lib/supabase/admin": {getAdminSupabase: () => null}, "@/lib/supabase/auth-server": {getCurrentAdminUser: async () => null}})("lib/template-editor/collaboration-server.ts"), document = fixture();
  assert.deepEqual(server.validateCollaborationAwareness({pageId: "deleted-page", selected: [], cursor: {x: 2, y: 2}}, document), {selected: [], cursor: null, preview: null});
  assert.throws(() => server.validateCollaborationAwareness({pageId: "<foreign>", selected: [], cursor: null}, document), /Invalid collaboration page/);
  assert.deepEqual(server.validateCollaborationAwareness({pageId: document.pages[0].id, selected: ["foreign"], cursor: null}, document).selected, []);
  assert.throws(() => server.validateCollaborationAwareness({selected: [], cursor: {x: Infinity, y: 2}}, document), /Invalid collaboration cursor/);
  assert.throws(() => server.validateCollaborationAwareness({selected: [], cursor: null, preview: {elements: Array(101).fill({})}}, document), /Invalid collaboration preview/);
});
test("collaboration API rejects foreign workspaces and origins before room access, and returns canonical generation conflicts", async t => {
  const persistence = store(t), document = fixture(); await persistence.saveEditorLibrary("team", {...structuredClone(model.EMPTY_LIBRARY), designs: [document]}, null);
  const saved = await persistence.getCollaborationDocument("team", document.id), sessionId = crypto.randomUUID(), actor = {id: "actor", name: "Alice", color: "#2563eb"};
  let reads = 0;
  const route = loader({
    "@/lib/engine/member": {resolveEngineAccess: async () => ({kind: "owner", ownerKey: "team"})},
    "@/lib/template-editor/persistence": {...persistence, getCollaborationDocument: async (...args) => {reads++; return persistence.getCollaborationDocument(...args);}},
    "@/lib/template-editor/collaboration-document": collaboration,
    "@/lib/template-editor/json-stream": load("lib/template-editor/json-stream.ts"),
    "@/lib/template-editor/collaboration-server": {collaborationActor: async () => actor, readCollaborationParticipants: async () => [], heartbeatCollaboration: async () => [], validateCollaborationAwareness: () => ({selected: [], cursor: null})},
  })("app/api/template-editor/collaboration/route.ts");
  const request = (input, headers = {}) => new Request("http://localhost/api/template-editor/collaboration", {method: "POST", headers: {"Content-Type": "application/json", ...headers}, body: JSON.stringify(input)});
  const input = {documentId: document.id, sessionId, sequence: 1, expectedScope: saved.scope};
  assert.equal((await route.POST(request({...input, expectedScope: "f".repeat(64)}))).status, 403); assert.equal(reads, 0);
  assert.equal((await route.GET(new Request(`http://localhost/api/template-editor/collaboration?documentId=${document.id}&sessionId=${sessionId}&expectedScope=${"f".repeat(64)}`))).status, 403); assert.equal(reads, 0);
  assert.equal((await route.POST(request(input, {Origin: "https://foreign.invalid"}))).status, 403); assert.equal(reads, 0);
  assert.equal((await route.POST(request(input, {"Content-Length": String(30 * 1024 * 1024)}))).status, 413); assert.equal(reads, 0);
  const doc = replica(collaboration.decodeCollaborationUpdate(saved.state)), update = collaboration.encodeCollaborationUpdate(edit(doc, value => {value.caption = "Edit";}));
  const conflict = await route.POST(request({...input, epoch: crypto.randomUUID(), update})); assert.equal(conflict.status, 409);
  const data = await conflict.json(); assert.equal(data.code, "generation_changed"); assert.equal(data.snapshot.epoch, saved.epoch); assert.equal(data.snapshot.document.id, document.id); assert.equal((await persistence.getEditorLibrary("team")).library.designs[0].caption, ""); doc.destroy();
});

test("collaboration POST validates presence before writing and keeps new-layer selection without an unqueued Yjs replay", async t => {
  const persistence = store(t), document = fixture();
  await persistence.saveEditorLibrary("team", {...structuredClone(model.EMPTY_LIBRARY), designs:[document]}, null);
  const initial = await persistence.getCollaborationDocument("team",document.id), replicaDoc = replica(collaboration.decodeCollaborationUpdate(initial.state));
  t.after(()=>replicaDoc.destroy());
  const added = model.createCanvasElement("shape"), update = collaboration.encodeCollaborationUpdate(edit(replicaDoc,value=>{value.pages[0].canvas.elements.push(added);}));
  const {validateCollaborationAwareness} = loader({"@/lib/supabase/admin":{getAdminSupabase:()=>null},"@/lib/supabase/auth-server":{getCurrentAdminUser:async()=>null}})("lib/template-editor/collaboration-server.ts");
  let saves = 0;const heartbeats = [];
  const route = loader({
    "@/lib/engine/member":{resolveEngineAccess:async()=>({kind:"owner",ownerKey:"team"})},
    "@/lib/template-editor/persistence":{...persistence,saveCollaborationDocument:async(...args)=>{saves++;return persistence.saveCollaborationDocument(...args);}},
    "@/lib/template-editor/collaboration-document":{...collaboration,createCollaborationDocument(){throw Error("Unexpected unqueued Yjs replay");}},
    "@/lib/template-editor/json-stream":load("lib/template-editor/json-stream.ts"),
    "@/lib/template-editor/collaboration-server":{validateCollaborationAwareness,collaborationActor:async()=>({id:"actor",name:"Alice",color:"#2563eb"}),readCollaborationParticipants:async()=>[],heartbeatCollaboration:async(_owner,_document,_session,_actor,awareness)=>{heartbeats.push(awareness);return [];}},
  })("app/api/template-editor/collaboration/route.ts");
  const input = {documentId:document.id,sessionId:crypto.randomUUID(),sequence:1,expectedScope:initial.scope,epoch:initial.epoch,update};
  const post = awareness=>route.POST(new Request("http://localhost/api/template-editor/collaboration",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,awareness})}));
  const invalid = await post({selected:[],cursor:{x:"invalid",y:0}});
  assert.equal(invalid.status,400);assert.equal(saves,0);assert.equal(heartbeats.length,0);
  assert.equal((await persistence.getEditorLibrary("team")).revision,initial.revision);
  const preview={id:added.id,x:added.x,y:added.y,width:added.width,height:added.height,rotation:added.rotation};
  const valid = await post({pageId:document.pages[0].id,selected:[added.id],cursor:{x:1,y:2},preview:{elements:[preview]}});
  assert.equal(valid.status,200);assert.equal(saves,1);
  assert.deepEqual(heartbeats[0].selected,[added.id]);assert.deepEqual(heartbeats[0].preview.elements,[preview]);
  assert.ok((await valid.json()).document.pages[0].canvas.elements.some(element=>element.id===added.id));
});
