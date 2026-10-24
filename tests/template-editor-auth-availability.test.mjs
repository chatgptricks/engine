import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function authOptions() {
  const unit = {exports: {}};
  const source = ts.transpileModule(fs.readFileSync("lib/supabase/auth-server.ts", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const dependencies = {
    "@supabase/ssr": {createServerClient: (_url, _key, options) => options},
    "next/headers": {cookies: async () => ({getAll: () => [], set() {}})},
    "@/lib/owners": {},
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => dependencies[name], unit, unit.exports);
  return unit.exports.getAuthServerClient();
}

test("server auth bounds stalled provider fetches and allows a later request to recover", async t => {
  const timeout = AbortSignal.timeout.bind(AbortSignal), budgets = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => {budgets.push(milliseconds); return timeout(15);});
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    calls++;
    if (calls > 1) return Response.json({verified: true});
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), {once: true}));
  });
  const keepAlive = setInterval(() => {}, 50);
  t.after(() => clearInterval(keepAlive));
  const {global: transport} = await authOptions();
  await assert.rejects(transport.fetch("https://auth.test/user"), {name: "TimeoutError"});
  assert.deepEqual(await (await transport.fetch("https://auth.test/user")).json(), {verified: true});
  assert.deepEqual(budgets, [10_000, 10_000]);
});

test("server auth retains explicit caller cancellation and exact request options", async t => {
  const controller = new AbortController(), body = "request-body", headers = new Headers({"Content-Type": "application/json"});
  let seen;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    seen = {input, init};
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), {once: true}));
  });
  const {global: transport} = await authOptions();
  const request = transport.fetch("https://auth.test/token", {method: "POST", body, headers, cache: "no-store", signal: controller.signal});
  const cancelled = new Error("Caller cancelled");
  controller.abort(cancelled);
  await assert.rejects(request, error => error === cancelled);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.body, body);
  assert.equal(seen.init.headers, headers);
  assert.equal(seen.init.cache, "no-store");
});

test("server auth preserves a Request object's own abort signal", async t => {
  const controller = new AbortController();
  const request = new Request("https://auth.test/user", {signal: controller.signal});
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), {once: true}));
  });
  const {global: transport} = await authOptions();
  const response = transport.fetch(request);
  controller.abort();
  await assert.rejects(response, {name: "AbortError"});
});
