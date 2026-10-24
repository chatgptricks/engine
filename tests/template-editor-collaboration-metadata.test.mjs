import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";

const native = createRequire(import.meta.url);
function load(file, dependencies = {}, timers = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const unit = {exports: {}};
  vm.runInThisContext(`(function(require,module,exports,setTimeout,clearTimeout){${source}\n})`, {filename: file})(name => dependencies[name] ?? native(name), unit, unit.exports, timers.setTimeout ?? setTimeout, timers.clearTimeout ?? clearTimeout);
  return unit.exports;
}
const metadata = load("lib/template-editor/collaboration-metadata.ts");
const validation = load("lib/template-editor/collaboration-server.ts", {
  "@/lib/supabase/admin": {}, "@/lib/supabase/auth-server": {},
  "./development-storage": {}, "./collaboration-types": {},
});
function stored(id = crypto.randomUUID()) {
  return {
    scope: "a".repeat(64), revision: crypto.randomUUID(), epoch: crypto.randomUUID(), version: 3,
    state: "PRIVATE_CRDT", storage: "cloud", assetKeys: [],
    document: {id, name: "PRIVATE_NAME", pages: [{id: "page", canvas: {background: "PRIVATE_BACKGROUND", elements: [{id: "title", text: "PRIVATE_TEXT", src: "PRIVATE_IMAGE"}]}}], masterScene: {elements: [{id: "master", src: "PRIVATE_MASTER"}]}, continuousCanvas: {elements: [{id: "continuous", src: "PRIVATE_CONTINUOUS"}]}},
  };
}
function harness() {
  const owner = crypto.randomUUID(), sessionId = crypto.randomUUID(), timers = new Map();
  const stats = {reads: 0, revisions: 0, saves: 0, actors: 0, heartbeats: []};
  const saved = stored();
  let access = {kind: "owner", ownerKey: owner}, deleted = false;
  const actor = {id: "actor", name: "Editor", color: "#2563eb"};
  const route = load("app/api/template-editor/collaboration/route.ts", {
    "@/lib/engine/member": {resolveEngineAccess: async () => access},
    "@/lib/template-editor/persistence": {
      editorOwnerScope: () => saved.scope,
      getCollaborationRevision: async () => {stats.revisions++; return saved.revision;},
      getCollaborationDocument: async () => {stats.reads++; if (deleted) throw Error("This document is not available in the signed-in workspace."); return structuredClone(saved);},
      saveCollaborationDocument: async () => {stats.saves++; saved.version++; saved.revision = crypto.randomUUID(); return structuredClone(saved);},
    },
    "@/lib/template-editor/collaboration-metadata": metadata,
    "@/lib/template-editor/json-stream": load("lib/template-editor/json-stream.ts"),
    "@/lib/template-editor/collaboration-server": {
      validateCollaborationAwareness: validation.validateCollaborationAwareness,
      collaborationActor: async () => {stats.actors++; return actor;},
      heartbeatCollaboration: async (_owner, _document, _session, _actor, awareness) => {stats.heartbeats.push(awareness); return [];},
      readCollaborationParticipants: async () => [],
    },
  }, {
    setTimeout(callback, delay) {const id = {}; timers.set(id, {callback, delay}); return id;},
    clearTimeout(id) {timers.delete(id);},
  });
  const input = {documentId: saved.document.id, sessionId, expectedScope: saved.scope, sequence: 1, epoch: saved.epoch};
  return {
    owner, saved, input, stats, timers,
    seed: () => metadata.rememberCollaborationMetadata(owner, saved),
    setAccess: value => {access = value;}, deleteDocument: () => {deleted = true; saved.revision = crypto.randomUUID();},
    post: (value = {}, headers = {}) => route.POST(new Request("http://localhost/api/template-editor/collaboration", {method: "POST", headers: {"Content-Type": "application/json", ...headers}, body: JSON.stringify({...input, ...value})})),
    get: (query = {}) => route.GET(new Request(`http://localhost/api/template-editor/collaboration?${new URLSearchParams({...input, ...query})}`)),
  };
}
async function firstEvent(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder(); let text = "";
  while (!text.includes("\n\n")) text += decoder.decode((await reader.read()).value, {stream: true});
  return {text, cancel: () => reader.cancel()};
}

test("metadata copies only IDs and protocol fields without retaining artwork references", () => {
  const owner = crypto.randomUUID(), value = stored(), result = metadata.rememberCollaborationMetadata(owner, value);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|state|assetKeys|storage/);
  assert.deepEqual(result.document.pages, [{id: "page", canvas: {elements: [{id: "title"}]}}]);
  value.document.pages[0].canvas.elements[0].id = "changed";
  assert.equal(result.document.pages[0].canvas.elements[0].id, "title");
  assert.equal(metadata.readCollaborationMetadata("other", value.document.id, value.revision), null);
});

test("metadata cache has sliding expiry only after revision validation and at most 32 LRU entries", t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const owner = crypto.randomUUID(), value = stored(); metadata.rememberCollaborationMetadata(owner, value);
  now += 59_000; assert.ok(metadata.readCollaborationMetadata(owner, value.document.id, value.revision));
  now += 59_000; assert.ok(metadata.readCollaborationMetadata(owner, value.document.id, value.revision));
  now += 61_000; assert.equal(metadata.readCollaborationMetadata(owner, value.document.id, value.revision), null);
  const entries = Array.from({length: 33}, () => stored());
  for (const entry of entries) metadata.rememberCollaborationMetadata(owner, entry);
  assert.equal(metadata.readCollaborationMetadata(owner, entries[0].document.id, entries[0].revision), null);
  assert.ok(metadata.readCollaborationMetadata(owner, entries.at(-1).document.id, entries.at(-1).revision));
  assert.equal(metadata.readCollaborationMetadata(owner, entries.at(-1).document.id, "changed"), null);
  assert.equal(metadata.readCollaborationMetadata(owner, entries.at(-1).document.id, entries.at(-1).revision), null);
});

test("opt-in presence validates scalar revision and layer membership without reading or returning artwork", async () => {
  const h = harness(); h.seed();
  const response = await h.post({presenceOnly: true, awareness: {pageId: "page", selected: ["title", "foreign"], cursor: {x: 2, y: 3}}});
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.presenceOnly, true);
  assert.equal(h.stats.reads, 0); assert.equal(h.stats.revisions, 1); assert.equal(h.stats.actors, 1); assert.equal(h.stats.saves, 0);
  assert.deepEqual(h.stats.heartbeats[0].selected, ["title"]);
  assert.deepEqual({scope: body.scope, epoch: body.epoch, version: body.version, revision: body.revision}, {scope: h.saved.scope, epoch: h.saved.epoch, version: h.saved.version, revision: h.saved.revision});
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|"state"|"document"/); assert.ok(JSON.stringify(body).length < 1000);
  const invalid = await h.post({presenceOnly: true, awareness: {selected: [], cursor: {x: "bad", y: 0}}});
  assert.equal(invalid.status, 400); assert.equal(h.stats.heartbeats.length, 1);
});

test("presence keeps access, owner and origin guards ahead of metadata and rejects stale generations cheaply", async () => {
  const h = harness(); h.seed();
  assert.equal((await h.post({presenceOnly: true, expectedScope: "b".repeat(64)})).status, 403);
  assert.equal((await h.post({presenceOnly: true}, {Origin: "https://foreign.test"})).status, 403);
  h.setAccess(null); assert.equal((await h.post({presenceOnly: true})).status, 401);
  assert.equal(h.stats.revisions, 0); assert.equal(h.stats.reads, 0);
  h.setAccess({kind: "owner", ownerKey: h.owner});
  const response = await h.post({presenceOnly: true, epoch: crypto.randomUUID()});
  const body = await response.json(); assert.equal(response.status, 409); assert.equal(body.code, "generation_changed");
  assert.equal(body.snapshot, undefined); assert.equal(h.stats.reads, 0); assert.equal(h.stats.heartbeats.length, 0);
});

test("cache misses and changed revisions load once while deletion cannot reuse stale metadata", async () => {
  const h = harness();
  assert.equal((await h.post({presenceOnly: true})).status, 200); assert.equal(h.stats.reads, 1);
  h.saved.revision = crypto.randomUUID(); h.saved.document.pages[0].canvas.elements = [{id: "new-title"}];
  const changed = await h.post({presenceOnly: true, awareness: {pageId: "page", selected: ["title", "new-title"], cursor: null}});
  assert.equal(changed.status, 200); assert.equal(h.stats.reads, 2); assert.deepEqual(h.stats.heartbeats.at(-1).selected, ["new-title"]);
  h.deleteDocument(); assert.equal((await h.post({presenceOnly: true})).status, 404); assert.equal(h.stats.heartbeats.length, 2);
});

test("legacy presence still returns full snapshots and an update cannot take the presence shortcut", async () => {
  const h = harness();
  const legacy = await h.post(); assert.equal((await legacy.json()).state, h.saved.state); assert.equal(h.stats.reads, 1);
  await h.post({presenceOnly: true}); assert.equal(h.stats.reads, 1, "The full legacy read primes only minimal metadata");
  const update = await h.post({presenceOnly: true, update: "encoded-update"});
  assert.equal((await update.json()).state, h.saved.state); assert.equal(h.stats.saves, 1); assert.equal(h.stats.reads, 1, "An update uses only its queued save read, without a full preflight");
  await h.post({presenceOnly: true}); assert.equal(h.stats.reads, 1, "The saved room refreshes minimal metadata");
});

test("matching SSE resume verifies scalar revision then sends only small presence metadata", async () => {
  const h = harness(); h.seed();
  const response = await h.get({knownEpoch: h.saved.epoch, knownVersion: String(h.saved.version), knownRevision: h.saved.revision});
  const event = await firstEvent(response);
  try {
    assert.match(event.text, /event: presence/); assert.match(event.text, new RegExp(h.saved.epoch));
    assert.doesNotMatch(event.text, /PRIVATE_|"state"|"document"/);
    assert.equal(h.stats.revisions, 1); assert.equal(h.stats.reads, 0); assert.equal(h.stats.actors, 1); assert.equal(h.stats.heartbeats.length, 1);
  } finally {await event.cancel();}
  assert.equal(h.timers.size, 0);
});

test("SSE reconnect falls back to a full snapshot for absent cache or mismatched confirmed metadata", async () => {
  for (const mode of ["cold", "revision", "epoch", "version", "legacy"]) {
    const h = harness(); if (mode !== "cold") h.seed();
    const query = {knownEpoch: h.saved.epoch, knownVersion: String(h.saved.version), knownRevision: h.saved.revision};
    if (mode === "revision") h.saved.revision = crypto.randomUUID();
    if (mode === "epoch") query.knownEpoch = crypto.randomUUID();
    if (mode === "version") query.knownVersion = "999";
    const event = await firstEvent(await h.get(mode === "legacy" ? {} : query));
    try {assert.match(event.text, /event: snapshot/); assert.match(event.text, /PRIVATE_CRDT/); assert.equal(h.stats.reads, 1);} finally {await event.cancel();}
  }
});
