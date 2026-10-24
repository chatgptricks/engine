import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";

function server(database) {
  const native = createRequire(import.meta.url), unit = {exports: {}};
  const source = ts.transpileModule(fs.readFileSync("lib/template-editor/collaboration-server.ts", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const dependencies = {
    "@/lib/supabase/admin": {getAdminSupabase: () => database},
    "@/lib/supabase/auth-server": {},
    "./development-storage": {developmentDirectory: () => "/unused"},
    "./collaboration-types": {COLLABORATION_PRESENCE_TTL: 30_000},
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => dependencies[name] ?? native(name), unit, unit.exports);
  return unit.exports;
}

test("presence reads, first heartbeat and CAS heartbeat updates all have complete-query deadlines", async t => {
  const timeout = AbortSignal.timeout.bind(AbortSignal), budgets = [], operations = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => {budgets.push(milliseconds); return timeout(milliseconds);});
  let record = null;
  const database = {from() {
    let operation = "read", value, signal;
    const query = {
      select() {return query;}, eq() {return query;},
      abortSignal(value) {signal = value; return query;},
      insert(input) {operation = "insert"; value = input; return query;},
      update(input) {operation = "update"; value = input; return query;},
      async maybeSingle() {
        assert.ok(signal instanceof AbortSignal);
        assert.equal(signal.aborted, false);
        operations.push(operation);
        if (value) record = value;
        return {data: operation === "read" ? record : {owner: record.owner}, error: null};
      },
      then(resolve, reject) {return query.maybeSingle().then(resolve, reject);},
    };
    return query;
  }};
  const presence = server(database), actor = {id: "actor", name: "Editor", color: "#2563eb"};
  const awareness = {selected: [], cursor: null};
  assert.deepEqual(await presence.readCollaborationParticipants("owner", "document"), []);
  await presence.heartbeatCollaboration("owner", "document", "session", actor, awareness, 1);
  await presence.heartbeatCollaboration("owner", "document", "session", actor, awareness, 2);
  assert.equal((await presence.readCollaborationParticipants("owner", "document")).length, 1);
  assert.deepEqual(operations, ["read", "read", "insert", "read", "update", "read"]);
  assert.deepEqual(budgets, Array(6).fill(12_000));
});

test("a stalled presence read cancels and later heartbeat attempts remain available", async t => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", () => timeout(15));
  let stalled = true, aborted = false;
  const database = {from() {
    let signal;
    const query = {
      select() {return query;}, eq() {return query;},
      abortSignal(value) {signal = value; return query;},
      async maybeSingle() {
        if (!stalled) return {data: null, error: null};
        return new Promise(resolve => signal.addEventListener("abort", () => {
          aborted = true; resolve({data: null, error: {message: "deadline"}});
        }, {once: true}));
      },
    };
    return query;
  }};
  // AbortSignal.timeout does not keep Node's event loop alive on its own.
  const keepAlive = setInterval(() => {}, 50);
  t.after(() => clearInterval(keepAlive));
  const presence = server(database);
  await assert.rejects(presence.readCollaborationParticipants("owner", "document"), /unavailable/);
  assert.equal(aborted, true);
  stalled = false;
  assert.deepEqual(await presence.readCollaborationParticipants("owner", "document"), []);
});
