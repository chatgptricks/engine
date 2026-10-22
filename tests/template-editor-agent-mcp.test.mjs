import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/engine-agent-mcp.mjs");
const token = "test-only-engine-agent-secret";
const updateOperationId = "1a2b3c4d-1234-1234-1234-123456789abc";
const initialize = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Engine tests", version: "1" } };

async function server(t, handler) {
  const calls = [];
  const instance = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const entry = { path: request.url, headers: request.headers, body: raw ? JSON.parse(raw) : null };
    calls.push(entry);
    await handler(entry, response, calls);
  });
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  t.after(() => {
    instance.closeAllConnections();
    instance.close();
  });
  return { calls, url: `http://127.0.0.1:${instance.address().port}` };
}

function json(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function client(t, url, env = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ENGINE_URL: url, ENGINE_AGENT_TOKEN: token, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const received = [];
  const waiting = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    let end;
    while ((end = stdout.indexOf("\n")) !== -1) {
      const line = stdout.slice(0, end);
      stdout = stdout.slice(end + 1);
      let value;
      try { value = JSON.parse(line); } catch { value = { invalidOutput: line }; }
      const pending = waiting.shift();
      if (pending) pending(value);
      else received.push(value);
    }
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  function next() {
    if (received.length) return Promise.resolve(received.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP response timed out. stderr: ${stderr}`)), 5000);
      waiting.push((value) => { clearTimeout(timer); resolve(value); });
    });
  }
  function raw(line) {
    child.stdin.write(`${line}\n`);
    return next();
  }
  async function request(method, params, id = nextId++) {
    const value = await raw(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
    assert.equal(value.jsonrpc, "2.0");
    assert.equal(value.id, id);
    return value;
  }
  return {
    child, request, raw,
    notify(method) { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`); },
    async init(version = "2025-11-25") { return request("initialize", { ...initialize, protocolVersion: version }); },
    async call(name, args = {}) { return request("tools/call", { name, arguments: args }); },
    stderr: () => stderr,
    async close() {
      child.stdin.end();
      if (child.exitCode === null) await once(child, "exit");
      return { code: child.exitCode, stderr, stdout: stdout + received.map((value) => JSON.stringify(value)).join("\n") };
    },
  };
}

test("MCP process negotiates, discovers live schemas, and calls all seven authenticated tools", async (t) => {
  const schemas = {
    deckSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    updateSchema: { type: "object", properties: { name: { type: "string" } } },
    coordinates: { width: 360 },
  };
  const document = { id: "deck-1", pages: [{ id: "page-1", canvas: { elements: [{ id: "title", type: "text", text: "Editable" }] } }] };
  const api = await server(t, (entry, response) => {
    if (entry.body.action === "capabilities") return json(response, schemas);
    if (entry.body.action === "export_deck") return json(response, { filename: "editable.engine.json", package: { document }, editorUrl: "/admin/engine?design=deck-1" });
    if (entry.body.action.startsWith("list_")) return json(response, { items: [], total: 0 });
    return json(response, { document, hash: "current-hash", editorUrl: "/admin/engine?design=deck-1" });
  });
  const mcp = client(t, api.url);
  const init = await mcp.init();
  assert.equal(init.result.protocolVersion, "2025-11-25");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  mcp.notify("notifications/initialized");
  const listed = await mcp.request("tools/list");
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["engine_capabilities", "engine_list_templates", "engine_list_decks", "engine_get_deck", "engine_create_deck", "engine_update_deck", "engine_export_deck"]);
  assert.deepEqual(listed.result.tools[4].inputSchema.properties.spec, schemas.deckSchema);
  assert.deepEqual(listed.result.tools[5].inputSchema.properties.changes, schemas.updateSchema);
  await mcp.call("engine_capabilities");
  await mcp.call("engine_list_templates");
  await mcp.call("engine_list_decks", { offset: 20, limit: 5 });
  const got = await mcp.call("engine_get_deck", { deckId: "deck-1" });
  assert.deepEqual(got.result.structuredContent.document, document);
  assert.deepEqual(JSON.parse(got.result.content[0].text), got.result.structuredContent);
  const created = await mcp.call("engine_create_deck", { spec: { name: "Editable slides" } });
  assert.match(created.result.structuredContent.operationId, /^[0-9a-f-]{36}$/);
  const updated = await mcp.call("engine_update_deck", { deckId: "deck-1", expectedHash: "current-hash", changes: { name: "New title" }, operationId: updateOperationId });
  assert.equal(updated.result.structuredContent.operationId, updateOperationId);
  const exported = await mcp.call("engine_export_deck", { deckId: "deck-1" });
  assert.deepEqual(exported.result.structuredContent.package.document, document);
  assert.equal(api.calls.every((call) => call.path === "/api/agent/slides" && call.headers.authorization === `Bearer ${token}`), true);
  assert.deepEqual(api.calls.map((call) => call.body.action), ["capabilities", "capabilities", "list_templates", "list_decks", "get_deck", "create_deck", "update_deck", "export_deck"]);
  assert.deepEqual(api.calls[2].body, { action: "list_templates", offset: 0, limit: 20 });
  assert.deepEqual(api.calls[3].body, { action: "list_decks", offset: 20, limit: 5 });
  assert.equal(api.calls[5].body.operationId, created.result.structuredContent.operationId);
  assert.deepEqual(await mcp.close(), { code: 0, stderr: "", stdout: "" });
});

test("MCP protocol validates requests without leaking notifications or accepting injected actions", async (t) => {
  const api = await server(t, (_entry, response) => json(response, {}));
  const mcp = client(t, api.url);
  assert.deepEqual((await mcp.request("ping")).result, {});
  assert.equal((await mcp.request("tools/list")).error.code, -32000);
  assert.equal((await mcp.request("initialize", {})).error.code, -32602);
  assert.equal((await mcp.init("2025-06-18")).result.protocolVersion, "2025-06-18");
  assert.equal((await mcp.init()).error.code, -32600);
  mcp.notify("notifications/initialized");
  mcp.notify("notifications/cancelled");
  assert.deepEqual((await mcp.request("ping")).result, {});
  assert.equal((await mcp.raw("{bad json")).error.code, -32700);
  assert.equal((await mcp.raw("[]")).error.code, -32600);
  assert.equal((await mcp.raw(JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }))).error.code, -32600);
  assert.equal((await mcp.request("unknown")).error.code, -32601);
  assert.equal((await mcp.call("no_such_tool")).error.code, -32602);
  assert.equal((await mcp.call("engine_get_deck")).error.code, -32602);
  assert.equal((await mcp.call("engine_create_deck", { spec: [], action: "get_deck" })).error.code, -32602);
  assert.equal((await mcp.call("engine_update_deck", { deckId: "d", expectedHash: "h", changes: [] })).error.code, -32602);
  assert.equal((await mcp.call("engine_list_decks", { limit: 101 })).error.code, -32602);
  assert.equal((await mcp.call("engine_list_decks", { offset: -1 })).error.code, -32602);
  assert.equal((await mcp.call("engine_list_decks", { offset: 10001 })).error.code, -32602);
  assert.equal((await mcp.call("engine_create_deck", { spec: {}, operationId: "not-a-uuid" })).error.code, -32602);
  assert.equal((await mcp.request("tools/list", { cursor: "unsupported" })).error.code, -32602);
  assert.equal(api.calls.length, 0);
  const closed = await mcp.close();
  assert.equal(closed.stdout, "");
  assert.equal(closed.stderr, "");
});

test("mutation failures never retry automatically and expose an operation ID for a safe retry", async (t) => {
  let initial = true;
  const api = await server(t, (entry, response) => {
    if (entry.body.action === "create_deck" && initial) {
      initial = false;
      response.destroy();
    } else if (entry.body.action === "update_deck") {
      json(response, { error: `Deck changed. Fetch it again. ${token}` }, 409);
    } else json(response, { document: { id: "deck-1" }, hash: "h", editorUrl: "/admin/engine?design=deck-1" });
  });
  const mcp = client(t, api.url);
  await mcp.init();
  const failed = await mcp.call("engine_create_deck", { spec: { name: "Persisted despite lost response" } });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.structuredContent.error, /reuse operationId/);
  const operationId = failed.result.structuredContent.operationId;
  assert.match(operationId, /^[0-9a-f-]{36}$/);
  assert.equal(api.calls.length, 1);
  const retried = await mcp.call("engine_create_deck", { spec: { name: "Persisted despite lost response" }, operationId });
  assert.equal(retried.result.isError, false);
  assert.deepEqual(api.calls[0].body, api.calls[1].body);
  const conflict = await mcp.call("engine_update_deck", { deckId: "deck-1", expectedHash: "old", changes: { name: "Changed" }, operationId: updateOperationId });
  assert.equal(conflict.result.isError, true);
  assert.equal(conflict.result.structuredContent.status, 409);
  assert.equal(conflict.result.structuredContent.operationId, updateOperationId);
  assert.match(conflict.result.content[0].text, /Fetch it again/);
  assert.equal(JSON.stringify(conflict).includes(token), false);
  assert.equal(api.calls.length, 3);
  assert.equal((await mcp.close()).stderr, "");
});

test("discovery falls back while unavailable and refreshes live schemas after recovery", async (t) => {
  let available = false;
  const api = await server(t, (_entry, response) => available ? json(response, { deckSchema: { type: "object", required: ["pages"] }, updateSchema: { type: "object" } }) : json(response, { error: "Unavailable" }, 503));
  const mcp = client(t, api.url);
  assert.equal((await mcp.init("future-version")).result.protocolVersion, "2025-11-25");
  const tools = await mcp.request("tools/list");
  assert.equal(tools.result.tools.length, 7);
  assert.match(tools.result.tools[4].inputSchema.properties.spec.description, /engine_capabilities/);
  const failure = await mcp.call("engine_capabilities");
  assert.equal(failure.result.isError, true);
  assert.equal(failure.result.structuredContent.status, 503);
  available = true;
  const recovered = await mcp.request("tools/list");
  assert.deepEqual(recovered.result.tools[4].inputSchema.properties.spec.required, ["pages"]);
  assert.equal((await mcp.close()).code, 0);
});

test("HTTP bridge refuses redirects and bounds response bodies", async (t) => {
  const other = await server(t, (_entry, response) => json(response, { exposed: true }));
  let mode = "redirect";
  const api = await server(t, (_entry, response) => {
    if (mode === "redirect") {
      response.writeHead(307, { location: `${other.url}/capture` });
      response.end();
    } else if (mode === "large") {
      response.writeHead(200, { "content-type": "application/json", "content-length": 33 * 1024 * 1024 });
      response.end("{}");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not-json");
    }
  });
  const mcp = client(t, api.url);
  await mcp.init();
  const redirected = await mcp.call("engine_capabilities");
  assert.equal(redirected.result.isError, true);
  assert.match(redirected.result.structuredContent.error, /Redirects are refused/);
  assert.equal(other.calls.length, 0);
  mode = "large";
  assert.match((await mcp.call("engine_get_deck", { deckId: "d" })).result.structuredContent.error, /32 MiB limit/);
  mode = "invalid";
  assert.match((await mcp.call("engine_get_deck", { deckId: "d" })).result.structuredContent.error, /invalid JSON/);
  assert.equal((await mcp.close()).stderr, "");
});

test("stdio rejects an oversized message and resumes at the next newline", async (t) => {
  const mcp = client(t, "http://localhost:3000");
  const oversized = await mcp.raw(" ".repeat(16 * 1024 * 1024 + 1));
  assert.equal(oversized.error.code, -32600);
  assert.match(oversized.error.message, /16 MiB/);
  assert.deepEqual((await mcp.request("ping")).result, {});
  assert.equal((await mcp.close()).code, 0);
});

test("startup rejects insecure or credential-bearing URLs and missing tokens without protocol noise", async (t) => {
  for (const url of ["http://example.com", "http://127.0.0.1.example.com", "ftp://localhost", "https://user:secret@example.com", "https://example.com?token=secret", "not a url"]) {
    const mcp = client(t, url);
    const closed = await mcp.close();
    assert.equal(closed.code, 1);
    assert.match(closed.stderr, /ENGINE_URL/);
    assert.equal(closed.stderr.includes("user:secret"), false);
    assert.equal(closed.stdout, "");
  }
  const missing = client(t, "http://localhost:3000", { ENGINE_AGENT_TOKEN: "" });
  const closed = await missing.close();
  assert.equal(closed.code, 1);
  assert.match(closed.stderr, /ENGINE_AGENT_TOKEN/);
  assert.equal(closed.stdout, "");
  for (const url of ["http://127.0.0.2:3000", "http://[::1]:3000", "https://example.com"]) {
    const accepted = client(t, url);
    assert.equal((await accepted.init()).result.protocolVersion, "2025-11-25");
    assert.equal((await accepted.close()).code, 0);
  }
});
