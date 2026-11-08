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
    const entry = { method: request.method, path: request.url, headers: request.headers, body: raw ? JSON.parse(raw) : null };
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

test("MCP process negotiates, discovers live schemas, and calls all authenticated slide tools", async (t) => {
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
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["engine_capabilities", "engine_list_templates", "engine_list_decks", "engine_get_deck", "engine_create_deck", "engine_update_deck", "engine_export_deck", "engine_list_page_profiles", "engine_playbook", "engine_recreate_post", "engine_recreate_status", "engine_recreate_approve", "engine_recreate_rerun_stage", "engine_recreate_submit_stage", "engine_recreate_resume", "engine_list_brands", "engine_get_brand", "engine_save_brand", "engine_restore_brand", "engine_check_deck", "engine_design_template"]);
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
  assert.equal(tools.result.tools.length, 21);
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

test("Recreate tools reach their own endpoints with the agent token and validate input", async (t) => {
  const jobId = "0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f";
  const api = await server(t, (entry, response) => {
    if (entry.path === "/api/agent/slides") return json(response, {});
    if (entry.path === "/api/engine/page-profiles") return json(response, { profiles: [{ id: "chatgptricks", language: "en" }] });
    if (entry.path === "/api/engine/recreate") return json(response, { jobId }, 202);
    if (entry.path === `/api/engine/recreate?jobId=${jobId}`) return json(response, { jobId, status: "researching", message: "Researching" });
    return json(response, { error: "unexpected" }, 404);
  });
  const mcp = client(t, api.url);
  await mcp.init();
  const profiles = await mcp.call("engine_list_page_profiles");
  assert.equal(profiles.result.structuredContent.profiles[0].id, "chatgptricks");
  const started = await mcp.call("engine_recreate_post", { profileId: "chatgptricks", url: "https://www.instagram.com/p/DfUR7MxoA62/" });
  assert.equal(started.result.isError, false);
  assert.equal(started.result.structuredContent.jobId, jobId);
  const status = await mcp.call("engine_recreate_status", { jobId });
  assert.equal(status.result.structuredContent.status, "researching");
  const recreateCalls = api.calls.filter((call) => call.path !== "/api/agent/slides");
  assert.deepEqual(recreateCalls.map((call) => call.path), ["/api/engine/page-profiles", "/api/engine/recreate", `/api/engine/recreate?jobId=${jobId}`]);
  assert.deepEqual(recreateCalls[1].body, { profileId: "chatgptricks", url: "https://www.instagram.com/p/DfUR7MxoA62/" });
  assert.equal(recreateCalls[0].body, null);
  assert.ok(recreateCalls.every((call) => call.headers.authorization === `Bearer ${token}`));
  assert.equal((await mcp.call("engine_recreate_post", { profileId: "chatgptricks" })).error.code, -32602);
  assert.equal((await mcp.call("engine_recreate_post", { url: "https://www.instagram.com/p/x/" })).error.code, -32602);
  assert.equal((await mcp.call("engine_recreate_post", { profileId: "chatgptricks", uploads: [{ dataUrl: "https://example.com/a.png" }] })).error.code, -32602);
  assert.equal((await mcp.call("engine_recreate_status", { jobId: "../deck" })).error.code, -32602);
  assert.equal(api.calls.filter((call) => call.path !== "/api/agent/slides").length, 3, "invalid calls never reach Engine");
});

test("the Recreate team's tools approve, rerun, hand in and resume through one endpoint", async (t) => {
  const postId = "post-0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f";
  const api = await server(t, (entry, response) => {
    if (entry.path === "/api/agent/slides") return json(response, {});
    if (entry.path === "/api/engine/recreate?playbook=1") return json(response, { shape: ["Cover"], houseRules: [], stages: [{ stage: "copy" }] });
    if (entry.path === `/api/engine/recreate?postId=${postId}`) return json(response, { postId, status: "paused", checkpoint: { hooks: { options: [{ text: "A" }] } } });
    if (entry.path === "/api/engine/recreate") return json(response, { postId, status: "writing" }, 202);
    return json(response, { error: "unexpected" }, 404);
  });
  const mcp = client(t, api.url);
  await mcp.init();
  assert.equal((await mcp.call("engine_playbook")).result.structuredContent.stages[0].stage, "copy");
  assert.equal((await mcp.call("engine_recreate_status", { postId })).result.structuredContent.status, "paused");
  await mcp.call("engine_recreate_post", { profileId: "pagina-es", url: "https://www.instagram.com/p/x/", mode: "checkpoint" });
  await mcp.call("engine_recreate_approve", { postId, option: 0, notes: "Keep it short" });
  await mcp.call("engine_recreate_rerun_stage", { postId, stage: "copy", instructions: "Make the cover shorter" });
  await mcp.call("engine_recreate_submit_stage", { postId, stage: "facts", output: { claims: [] } });
  await mcp.call("engine_recreate_resume", { postId });
  const posted = api.calls.filter((call) => call.path === "/api/engine/recreate").map((call) => call.body);
  assert.deepEqual(posted, [
    { profileId: "pagina-es", url: "https://www.instagram.com/p/x/", mode: "checkpoint" },
    { action: "approve", postId, option: 0, notes: "Keep it short" },
    { action: "rerun_stage", postId, stage: "copy", instructions: "Make the cover shorter" },
    { action: "submit_stage", postId, stage: "facts", output: { claims: [] } },
    { action: "resume", postId },
  ]);
  const before = api.calls.length;
  for (const [tool, args] of [
    ["engine_recreate_approve", { postId }],
    ["engine_recreate_approve", { option: 0 }],
    ["engine_recreate_submit_stage", { postId, stage: "deck", output: {} }],
    ["engine_recreate_submit_stage", { postId, stage: "copy", output: "text" }],
    ["engine_recreate_rerun_stage", { postId, stage: "everything" }],
    ["engine_recreate_status", { postId: "post-../../x" }],
    ["engine_recreate_post", { profileId: "chatgptricks", url: "https://www.instagram.com/p/x/", mode: "fast" }],
  ]) assert.equal((await mcp.call(tool, args)).error?.code, -32602, `${tool} ${JSON.stringify(args)} is refused`);
  assert.equal(api.calls.length, before, "invalid calls never reach Engine");
});

test("brand tools read, save, restore, check and design through the brands endpoints", async (t) => {
  const api = await server(t, (entry, response) => {
    if (entry.path === "/api/agent/slides") return json(response, {});
    if (entry.path.startsWith("/api/engine/brands")) return json(response, { ok: true, path: entry.path });
    return json(response, { error: "unexpected" }, 404);
  });
  const mcp = client(t, api.url);
  await mcp.init();
  await mcp.call("engine_list_brands");
  await mcp.call("engine_get_brand", { brandId: "chatgptricks" });
  await mcp.call("engine_get_brand", { brandId: "chatgptricks", version: 2 });
  await mcp.call("engine_save_brand", { guide: { id: "chatgptricks", bannedWords: ["BREAKING:"] }, expectedVersion: 3, note: "Ban BREAKING:" });
  await mcp.call("engine_restore_brand", { brandId: "chatgptricks", version: 1 });
  await mcp.call("engine_check_deck", { deckId: "deck-1" });
  await mcp.call("engine_check_deck", { templateId: "chatgptricks-guide-es", brandId: "chatgptricks" });
  await mcp.call("engine_design_template", { brandId: "chatgptricks", language: "es" });
  const calls = api.calls.filter((call) => call.path !== "/api/agent/slides");
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/engine/brands"],
    ["GET", "/api/engine/brands?id=chatgptricks"],
    ["GET", "/api/engine/brands?id=chatgptricks&version=2"],
    ["PUT", "/api/engine/brands"],
    ["POST", "/api/engine/brands"],
    ["POST", "/api/engine/brands/check"],
    ["POST", "/api/engine/brands/check"],
    ["POST", "/api/engine/brands/templates"],
  ]);
  assert.deepEqual(calls[3].body, { guide: { id: "chatgptricks", bannedWords: ["BREAKING:"] }, expectedVersion: 3, note: "Ban BREAKING:" });
  assert.deepEqual(calls[4].body, { action: "restore", id: "chatgptricks", version: 1 });
  assert.deepEqual(calls[5].body, { deckId: "deck-1" });
  assert.deepEqual(calls[7].body, { brandId: "chatgptricks", language: "es" });
  assert.ok(calls.every((call) => call.headers.authorization === `Bearer ${token}`));
  const before = api.calls.length;
  for (const [tool, args] of [
    ["engine_get_brand", {}],
    ["engine_get_brand", { brandId: "../x" }],
    ["engine_get_brand", { brandId: "chatgptricks", version: 0 }],
    ["engine_save_brand", { guide: "text" }],
    ["engine_save_brand", { guide: { name: "No id" } }],
    ["engine_save_brand", { guide: { id: "x" }, note: "n".repeat(201) }],
    ["engine_restore_brand", { brandId: "chatgptricks" }],
    ["engine_check_deck", {}],
    ["engine_check_deck", { deckId: "deck-1", templateId: "t" }],
    ["engine_design_template", { brandId: "chatgptricks", language: "fr" }],
    ["engine_design_template", { language: "en" }],
  ]) assert.equal((await mcp.call(tool, args)).error?.code, -32602, `${tool} ${JSON.stringify(args)} is refused`);
  assert.equal(api.calls.length, before, "invalid calls never reach Engine");
});
