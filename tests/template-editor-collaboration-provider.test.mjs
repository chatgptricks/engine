import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import React from "react";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), native = createRequire(import.meta.url), Y = native("yjs");
function loader(dependencies = {}) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(root, relative), unit = {exports: {}};
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
    cache.set(relative, unit.exports);
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {filename})(name => Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : native(name), unit, unit.exports);
    return unit.exports;
  }
  return load;
}
const load = loader(), model = load("lib/template-editor/model.ts"), protocol = load("lib/template-editor/collaboration-document.ts"), scope = "f".repeat(64);
function fixture() {
  const document = model.createBlankDesign("Together", "portrait"), element = model.createCanvasElement("text");
  element.text = "Hello"; document.pages[0].canvas.elements.push(element); return document;
}
function room(document, epoch = crypto.randomUUID()) {
  const doc = protocol.createCollaborationDocument(document);
  return {doc, epoch, snapshot(version = 1) {return {state: protocol.encodeCollaborationUpdate(Y.encodeStateAsUpdate(doc)), document: protocol.readCollaborationDocument(doc), revision: crypto.randomUUID(), scope, version, epoch, storage: "cloud", actor: {id: "ana", name: "Ana", color: "#2563eb"}, participants: []};}};
}
const settle = async () => {for (let count = 0; count < 12; count++) await Promise.resolve();};

/** Persist actual hook slots and run real effect cleanup on dependency changes. */
function hookRunner() {
  const slots = []; let cursor = 0, effects = [];
  const changed = (before, deps) => !before || !deps || deps.some((value, index) => !Object.is(value, before.deps?.[index]));
  const effect = (work, deps) => {
    const index = cursor++, before = slots[index];
    if (changed(before, deps)) {slots[index] = {deps}; effects.push(() => {before?.cleanup?.(); slots[index].cleanup = work();});}
  };
  return {
    react: {...React,
      useRef(initial) {const index = cursor++; return slots[index] ?? (slots[index] = {current: initial});},
      useState(initial) {const index = cursor++; slots[index] ??= {value: typeof initial === "function" ? initial() : initial}; return [slots[index].value, value => {slots[index].value = typeof value === "function" ? value(slots[index].value) : value;}];},
      useEffect: effect, useLayoutEffect: effect,
      useCallback(work, deps) {const index = cursor++, before = slots[index]; if (changed(before, deps)) slots[index] = {deps, work}; return slots[index].work;},
    },
    render(work) {cursor = 0; effects = []; const result = work(); const pending = effects; effects = []; pending.forEach(run => run()); return result;},
    dispose() {slots.forEach(slot => slot?.cleanup?.());},
  };
}

/** Fake wall-clock scheduling keeps request races deterministic, without sleeps. */
function fakeClock() {
  const timers = new Map(); let now = 0, serial = 0;
  function add(work, delay, interval = 0) {const id = ++serial; timers.set(id, {work, at: now + Math.max(0, Number(delay) || 0), interval}); return id;}
  return {
    setTimeout: (work, delay) => add(work, delay), clearTimeout: id => timers.delete(id),
    setInterval: (work, delay) => add(work, delay, Number(delay)), clearInterval: id => timers.delete(id),
    async advance(duration) {
      const target = now + duration;
      while (true) {
        const next = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        timer.work(); await settle();
      }
      now = target; await settle();
    },
  };
}

function harness(document) {
  const hooks = hookRunner(), clock = fakeClock(), requests = [], streams = [], deliveries = [], errors = [];
  const original = new Map();
  const replace = (key, value) => {original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});};
  class FakeEventSource {
    constructor(url) {this.url = url; this.listeners = new Map(); this.closed = false; this.onerror = null; streams.push(this);}
    addEventListener(type, work) {const listeners = this.listeners.get(type) ?? []; listeners.push(work); this.listeners.set(type, listeners);}
    close() {this.closed = true;}
    emit(type, value) {if (this.closed) return; const event = new MessageEvent(type, {data: JSON.stringify(value)}); (this.listeners.get(type) ?? []).forEach(work => work(event)); if (type === "error") this.onerror?.(event);}
  }
  const windowTarget = new EventTarget(), documentTarget = Object.assign(new EventTarget(), {visibilityState: "visible"}), navigatorState = {onLine: true}, preferences = new Map();
  replace("window", windowTarget); replace("document", documentTarget); replace("navigator", navigatorState); replace("EventSource", FakeEventSource);
  replace("sessionStorage", {getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value)});
  for (const key of ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]) replace(key, clock[key]);
  replace("fetch", (url, options = {}) => {
    let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
    const request = {url, options, body: options.body ? JSON.parse(options.body) : null,
      respond(value, status = 200) {resolve({ok: status >= 200 && status < 300, status, json: async () => structuredClone(value)});},
      reject(reason = new TypeError("Connection lost")) {reject(reason);},
    };
    requests.push(request); return promise;
  });
  const {useLiveCollaboration} = loader({react: hooks.react})("lib/template-editor/use-collaboration.ts");
  let visible = document, pendingCount = 0, controls;
  const options = {baselineDocument: document, onDocument(saved, next, snapshot) {visible = next; deliveries.push({saved, visible: next, snapshot});}, onPending() {pendingCount++;}, onError(message) {errors.push(message);}};
  const render = () => (controls = hooks.render(() => useLiveCollaboration(visible, scope, options)));
  render();
  return {requests, streams, deliveries, errors, clock, render, get controls() {return controls;}, get pendingCount() {return pendingCount;}, get visible() {return visible;},
    async start(snapshot) {await settle(); render(); streams.at(-1).emit("snapshot", snapshot); render();},
    event(type, properties = {}) {windowTarget.dispatchEvent(Object.assign(new Event(type), properties));},
    offline() {navigatorState.onLine = false; windowTarget.dispatchEvent(new Event("offline"));},
    online() {navigatorState.onLine = true; windowTarget.dispatchEvent(new Event("online"));},
    dispose() {hooks.dispose(); for (const [key, descriptor] of original) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];},
  };
}

for (const lateResult of ["success", "network failure"]) test(`a delayed epoch A POST ${lateResult} cannot restore A or mix its updates into epoch B`, async () => {
  const original = fixture(), first = room(original), replacement = structuredClone(original);
  replacement.name = "Restored by another editor"; replacement.pages[0].canvas.elements[0].x = 198;
  const second = room(replacement), client = harness(original);
  try {
    await client.start(first.snapshot());
    const local = structuredClone(original); local.caption = "Ana's unsaved caption";
    assert.equal(client.controls.submitDocument(original, local), true);
    await client.clock.advance(70);
    assert.equal(client.requests.length, 1);
    const inFlight = client.requests[0]; assert.equal(inFlight.body.epoch, first.epoch); assert.ok(inFlight.body.update);
    const oldClients = new Set(Y.decodeUpdate(protocol.decodeCollaborationUpdate(inFlight.body.update)).structs.map(struct => struct.id.client));
    Y.applyUpdate(first.doc, protocol.decodeCollaborationUpdate(inFlight.body.update));
    client.streams[0].emit("update", second.snapshot()); client.render();
    assert.equal(client.visible.caption, local.caption, "Unacknowledged local edits are rebased onto the fresh generation");
    assert.equal(client.visible.name, replacement.name);
    const deliveriesAfterReset = client.deliveries.length;
    client.streams[0].emit("update", first.snapshot(2)); client.render();
    assert.equal(client.deliveries.length, deliveriesAfterReset, "An already retired generation must also be ignored on the event stream");
    // Let the timer fire while A is still pending: sending must remain serial.
    await client.clock.advance(70); assert.equal(client.requests.length, 1);
    if (lateResult === "success") inFlight.respond(first.snapshot(2)); else inFlight.reject();
    await settle(); client.render();
    assert.equal(client.deliveries.at(-1).snapshot.epoch, second.epoch, "A late acknowledgment must not replace the new room");
    assert.equal(client.visible.name, replacement.name);
    await client.clock.advance(1500);
    const rebased = client.requests.find(request => request !== inFlight && request.body?.update);
    assert.ok(rebased, "The new generation's unsaved operations must be sent");
    assert.equal(rebased.body.epoch, second.epoch);
    const structs = Y.decodeUpdate(protocol.decodeCollaborationUpdate(rebased.body.update)).structs;
    assert.ok(structs.every(struct => !oldClients.has(struct.id.client)), "Old-generation structs must not enter the new room's update");
    Y.applyUpdate(second.doc, protocol.decodeCollaborationUpdate(rebased.body.update));
    const durable = protocol.readCollaborationDocument(second.doc);
    assert.equal(durable.caption, local.caption); assert.equal(durable.name, replacement.name); assert.equal(durable.pages[0].canvas.elements[0].x, 198);
    rebased.respond(second.snapshot(2)); await settle(); client.render();
    assert.equal(client.controls.status, "live"); assert.deepEqual(client.visible, durable);
    assert.equal(client.errors.length, 0);
  } finally {client.dispose(); first.doc.destroy(); second.doc.destroy();}
});

test("presence and remote document events never enter the local editing queue", async () => {
  const original = fixture(), shared = room(original), client = harness(original);
  try {
    await client.start(shared.snapshot()); await client.clock.advance(70);
    assert.equal(client.requests.length, 1); assert.equal(client.requests[0].body.update, undefined);
    client.requests[0].respond(shared.snapshot()); await settle(); client.render();
    const before = client.deliveries.length, participants = [{id: "bruno", sessionId: crypto.randomUUID(), name: "Bruno", color: "#7c3aed", selected: [original.pages[0].canvas.elements[0].id], pageId: original.pages[0].id, cursor: {x: 30, y: 80}, seenAt: Date.now()}];
    client.streams[0].emit("presence", {scope, actor: {id: "ana", name: "Ana", color: "#2563eb"}, participants}); client.render();
    assert.equal(client.controls.peers.length, 1); assert.equal(client.controls.peers[0].name, "Bruno");
    assert.equal(client.deliveries.length, before, "Presence only updates awareness state");
    const remoteBefore = protocol.readCollaborationDocument(shared.doc), remoteNext = structuredClone(remoteBefore); remoteNext.pages[0].canvas.elements[0].text = "Remote Hello";
    protocol.writeCollaborationDocument(shared.doc, remoteBefore, remoteNext);
    client.streams[0].emit("update", shared.snapshot(2)); client.render(); await client.clock.advance(1000);
    assert.equal(client.visible.pages[0].canvas.elements[0].text, "Remote Hello");
    assert.equal(client.pendingCount, 0); assert.equal(client.requests.length, 1, "Receiving peer edits must not echo them as POST mutations");
    assert.equal(client.controls.history.canUndo, false, "The local undo stack excludes remote transactions");
  } finally {client.dispose(); shared.doc.destroy();}
});

test("offline edits survive reconnection and merge with updates received while disconnected", async () => {
  const original = fixture(), shared = room(original), client = harness(original);
  try {
    await client.start(shared.snapshot()); await client.clock.advance(70);
    client.requests[0].respond(shared.snapshot()); await settle(); client.render();
    client.offline(); client.render(); assert.equal(client.controls.status, "offline");
    const local = structuredClone(original); local.caption = "Written offline";
    assert.equal(client.controls.submitDocument(original, local), true);
    await client.clock.advance(500); assert.equal(client.requests.length, 1, "Disconnected work stays queued locally");
    const beforeRemote = protocol.readCollaborationDocument(shared.doc), remote = structuredClone(beforeRemote);
    remote.pages[0].canvas.elements[0].text = "Updated by Bruno while Ana was offline";
    remote.pages[0].canvas.elements[0].x = 84;
    protocol.writeCollaborationDocument(shared.doc, beforeRemote, remote);
    client.online(); assert.equal(client.streams.length, 2);
    client.streams[1].emit("snapshot", shared.snapshot(2)); client.render(); await client.clock.advance(0);
    const request = client.requests[1]; assert.ok(request?.body.update); assert.equal(request.body.epoch, shared.epoch);
    Y.applyUpdate(shared.doc, protocol.decodeCollaborationUpdate(request.body.update));
    const durable = protocol.readCollaborationDocument(shared.doc);
    assert.equal(durable.caption, local.caption); assert.equal(durable.pages[0].canvas.elements[0].text, remote.pages[0].canvas.elements[0].text); assert.equal(durable.pages[0].canvas.elements[0].x, 84);
    request.respond(shared.snapshot(3)); await settle(); client.render();
    assert.equal(client.controls.ready, true); assert.equal(client.controls.status, "live"); assert.deepEqual(client.visible, durable);
  } finally {client.dispose(); shared.doc.destroy();}
});

test("pagehide sends a keepalive leave and bfcache restoration rejoins the same document without losing local work", async () => {
  const original = fixture(), shared = room(original), client = harness(original);
  try {
    await client.start(shared.snapshot()); await client.clock.advance(70);
    const initial = client.requests[0]; initial.respond(shared.snapshot()); await settle(); client.render();
    const sessionId = client.controls.self.id, local = structuredClone(original); local.caption = "Work just before navigating away";
    assert.equal(client.controls.submitDocument(original, local), true); client.render();
    assert.equal(client.controls.history.canUndo, true);
    client.event("pagehide");
    const leave = client.requests[1]; assert.ok(leave);
    assert.equal(leave.body.leave, true); assert.equal(leave.options.keepalive, true);
    assert.equal(leave.body.sessionId, sessionId); assert.equal(leave.body.epoch, shared.epoch);
    assert.ok(leave.body.sequence > initial.body.sequence); assert.ok(leave.body.update, "Pending edits travel with the final presence leave");
    assert.equal(client.streams[0].closed, true);
    Y.applyUpdate(shared.doc, protocol.decodeCollaborationUpdate(leave.body.update));
    assert.equal(protocol.readCollaborationDocument(shared.doc).caption, local.caption);
    const beforeRemote = protocol.readCollaborationDocument(shared.doc), remote = structuredClone(beforeRemote); remote.pages[0].canvas.elements[0].x = 147;
    protocol.writeCollaborationDocument(shared.doc, beforeRemote, remote); leave.respond(shared.snapshot(2)); await settle();
    // A normal pageshow must not create a duplicate session. bfcache uses the
    // existing hook instance and reopens its original session after its leave.
    client.event("pageshow", {persisted: false}); assert.equal(client.streams.length, 1);
    client.event("pageshow", {persisted: true}); assert.equal(client.streams.length, 2);
    assert.equal(new URL(client.streams[1].url, "http://localhost").searchParams.get("sessionId"), sessionId);
    client.streams[1].emit("snapshot", shared.snapshot(2)); client.render(); await client.clock.advance(70);
    const rejoin = client.requests[2]; assert.ok(rejoin);
    assert.notEqual(rejoin.body.leave, true); assert.equal(rejoin.body.sessionId, sessionId); assert.ok(rejoin.body.sequence > leave.body.sequence);
    assert.equal(rejoin.body.epoch, shared.epoch); assert.equal(rejoin.body.update, leave.body.update, "The existing Y.Doc retains its pending operations across bfcache");
    const beforeDuplicate = Y.encodeStateAsUpdate(shared.doc);
    Y.applyUpdate(shared.doc, protocol.decodeCollaborationUpdate(rejoin.body.update));
    assert.deepEqual(Y.encodeStateAsUpdate(shared.doc), beforeDuplicate, "An already delivered keepalive update is safe to retry on rejoin");
    rejoin.respond(shared.snapshot(2)); await settle(); client.render();
    assert.equal(client.controls.self.id, sessionId); assert.equal(client.controls.status, "live");
    assert.equal(client.visible.caption, local.caption); assert.equal(client.visible.pages[0].canvas.elements[0].x, 147);
    assert.equal(client.controls.history.canUndo, true, "The user's undo stack must survive bfcache restoration");
    client.controls.history.undo(); client.render();
    assert.equal(client.visible.caption, original.caption); assert.equal(client.visible.pages[0].canvas.elements[0].x, 147, "Undo still belongs to the same participant and preserves peer edits");
  } finally {client.dispose(); shared.doc.destroy();}
});

test("a fatal authorization response pauses mutations and reconnects while keeping browser work recoverable", async () => {
  const original = fixture(), shared = room(original), client = harness(original);
  try {
    await client.start(shared.snapshot());
    const local = structuredClone(original); local.caption = "Local work before access changed";
    assert.equal(client.controls.submitDocument(original, local), true); await client.clock.advance(70);
    client.requests[0].respond({error: "The signed-in workspace changed."}, 403); await settle(); client.render();
    assert.equal(client.controls.status, "error"); assert.equal(client.streams[0].closed, true); assert.equal(client.errors.length, 1);
    const more = structuredClone(local); more.caption += " more";
    assert.equal(client.controls.submitDocument(local, more), false);
    client.controls.setAwareness({cursor: {x: 25, y: 30}}); client.event("online");
    await client.clock.advance(20_000); client.render();
    assert.equal(client.requests.length, 1, "Paused access must not keep transmitting queued edits or heartbeats");
    assert.equal(client.streams.length, 1, "Going online must not reopen a revoked collaboration session");
    assert.equal(client.controls.status, "error");
    assert.ok(client.pendingCount > 0, "The caller was told to preserve the unsaved work before sending");
  } finally {client.dispose(); shared.doc.destroy();}
});
