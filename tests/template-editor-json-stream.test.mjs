import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync(new URL("../lib/template-editor/json-stream.ts", import.meta.url), "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const unit = {exports: {}};
vm.runInThisContext(`(function(module,exports){${source}\n})`)(unit, unit.exports);
const {jsonTextChunks, jsonByteStream} = unit.exports;

test("streamed JSON matches native serialization across escaping and chunk boundaries", async () => {
  const shared = {text: "Repeated"};
  const strings = ["", 'quote"slash\\\b\f\n\r\t\u0000\u001f', "\ud800\udfff\ud800x\udfff", "a😀b\u2028é漢字"];
  const values = [null, true, 0, -0, Infinity, undefined, {omitted: undefined, fn() {}, symbol: Symbol()},
    [undefined, , Symbol(), () => {}], {shared, twice: shared}, new Date("2026-10-22T00:00:00Z"),
    {custom: {toJSON(key) {return {key};}}}, new Number(2), new String("boxed"), new Boolean(false),
    ...strings, Object.fromEntries(strings.map(value => [value, value])),
    {unicode: Array.from({length: 0x10000}, (_, code) => String.fromCharCode(code)).join("")}];
  for (const value of values) {
    for (const size of [2, 3, 7, 64, 65536]) {
      const chunks = [...jsonTextChunks(value, size)];
      assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= size));
      assert.equal(chunks.join(""), JSON.stringify(value) ?? "");
      assert.equal(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString(), JSON.stringify(value) ?? "");
    }
  }
  const response = new Response(jsonByteStream({strings}));
  assert.deepEqual(await response.json(), {strings});
});

test("large image and Unicode values stay bounded in UTF-8 output without changing bytes", async () => {
  const value = {src: "data:image/png;base64," + "A".repeat(3 * 1024 * 1024), text: "😀漢字".repeat(20_000)};
  const reader = jsonByteStream(value).getReader(), output = [];
  while (true) {
    const {value: bytes, done} = await reader.read();
    if (done) break;
    assert.ok(bytes.byteLength <= 64 * 1024);
    output.push(bytes);
  }
  assert.equal(Buffer.concat(output).toString(), JSON.stringify(value));
});

test("stream cancellation stops traversing remaining fields and invalid JSON values fail", async () => {
  let reached = false;
  const value = {first: "A".repeat(200_000), get later() {reached = true; return "later";}};
  const reader = jsonByteStream(value).getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(reached, false);
  const circular = {}; circular.self = circular;
  assert.throws(() => [...jsonTextChunks(circular)], /circular/);
  assert.throws(() => [...jsonTextChunks({value: BigInt(1)})], /BigInt/);
  assert.throws(() => [...jsonTextChunks(Object(BigInt(1)))], /BigInt/);
  await assert.rejects(new Response(jsonByteStream(circular)).text(), /circular/);
});
