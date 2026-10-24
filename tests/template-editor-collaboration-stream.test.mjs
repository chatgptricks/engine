import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";

test("collaboration streams defer unread updates and keep presence and document updates working after draining", {timeout: 5000}, async () => {
  const native = createRequire(import.meta.url), timers = new Map();
  const scope = "a".repeat(64), documentId = "project", sessionId = crypto.randomUUID();
  let revision = "first", participants = [], reads = 0, revisionReads = 0;
  const actor = {id: "editor", name: "Editor", color: "#2563eb"};
  const transport = {exports: {}};
  const transportSource = ts.transpileModule(fs.readFileSync(new URL("../lib/template-editor/json-stream.ts", import.meta.url), "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${transportSource}\n})`)(native, transport, transport.exports);
  const dependencies = {
    "@/lib/template-editor/json-stream": transport.exports,
    "@/lib/engine/member": {resolveEngineAccess: async () => ({ownerKey: "team"})},
    "@/lib/template-editor/persistence": {
      editorOwnerScope: () => scope,
      getCollaborationRevision: async () => {revisionReads++;return revision;},
      getCollaborationDocument: async () => {
        reads++;
        return {scope, revision, state: revision, version: reads, epoch: "epoch", storage: "cloud", document: {id: documentId, name: revision}};
      },
    },
    "@/lib/template-editor/collaboration-document": {},
    "@/lib/template-editor/collaboration-server": {
      collaborationActor: async () => actor,
      heartbeatCollaboration: async () => [],
      readCollaborationParticipants: async () => participants,
    },
  };
  const filename = new URL("../app/api/template-editor/collaboration/route.ts", import.meta.url);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const unit = {exports: {}};
  vm.runInThisContext(`(function(require,module,exports,setTimeout,clearTimeout){${source}\n})`)(
    name => dependencies[name] ?? native(name), unit, unit.exports,
    (callback, delay) => {const id = {}; timers.set(id, {callback, delay}); return id;},
    id => timers.delete(id),
  );
  const controller = new AbortController();
  const response = await unit.exports.GET(new Request(`http://localhost/api/template-editor/collaboration?documentId=${documentId}&sessionId=${sessionId}&expectedScope=${scope}`, {signal: controller.signal}));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffered = "";
  const nextEvent = async () => {
    while (!buffered.includes("\n\n")) buffered += decoder.decode((await reader.read()).value, {stream: true});
    const end = buffered.indexOf("\n\n") + 2, event = buffered.slice(0, end);
    buffered = buffered.slice(end);
    return event;
  };
  const poll = () => {
    const [id, task] = [...timers].find(([, task]) => task.delay === 1000);
    timers.delete(id); task.callback();
  };
  try {
    assert.equal(response.status, 200);
    revision = "waiting-for-reader";
    poll();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(revisionReads,0,"An unread event must block further revision and snapshot loading");
    assert.equal(reads,1);
    revision = "latest-while-unread";
    poll();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(revisionReads,0,"Repeated polls must not stack updates behind a slow reader");
    assert.match(await nextEvent(), /event: snapshot/);
    poll();
    assert.match(await nextEvent(), /"revision":"latest-while-unread"/);
    assert.equal(reads,2,"Draining resumes with the latest revision without replaying skipped snapshots");
    participants = [{id: "peer", name: "Peer", seenAt: 1}];
    poll();
    const presence = await nextEvent();
    assert.match(presence, /event: presence/);
    assert.match(presence, new RegExp(`"scope":"${scope}"`));
    assert.equal(reads, 2, "Presence polling must not load the artwork again");
    revision = "second";
    poll();
    const update = await nextEvent();
    assert.match(update, /event: update/);
    assert.match(update, /"revision":"second"/);
    assert.equal(reads, 3);
  } finally {
    controller.abort();
    await reader.cancel();
  }
  assert.equal(timers.size, 0);
});
