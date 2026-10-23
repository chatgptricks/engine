import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const Y = require("yjs");
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const filename = path.join(root, relative), unit = { exports: {} };
  cache.set(relative, unit.exports);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`, { filename })(name => name === "yjs" ? Y : load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))), unit, unit.exports);
  return unit.exports;
}
const model = load("lib/template-editor/model.ts");
const collaboration = load("lib/template-editor/collaboration-document.ts");
function fixture() {
  const document = model.createBlankDesign("Shared post", "portrait");
  document.pages[0].canvas.elements = [model.createCanvasElement("text", { text: "Original" }), model.createCanvasElement("shape")];
  return document;
}
function replica(state, id) {
  const doc = collaboration.createCollaborationDocument();
  Y.applyUpdate(doc, state, collaboration.COLLABORATION_REMOTE_ORIGIN);
  doc.clientID = id;
  return doc;
}
function edit(doc, mutate) {
  const before = collaboration.readCollaborationDocument(doc), next = structuredClone(before), vector = Y.encodeStateVector(doc);
  mutate(next);
  collaboration.writeCollaborationDocument(doc, before, next);
  return Y.encodeStateAsUpdate(doc, vector);
}

test("client undo after concurrent saves retains required timestamps and the other editor's shape", () => {
  // Both client-id orders matter to Y.Map conflict ordering. Multiple rounds
  // reproduce the race found by the real three-browser UI acceptance.
  for (const [anaId, brunoId] of [[101, 202], [202, 101]]) {
    for (let round = 0; round < 8; round++) {
      const original = fixture(), seeded = collaboration.createCollaborationDocument(original), state = Y.encodeStateAsUpdate(seeded);
      const ana = replica(state, anaId), bruno = replica(state, brunoId);
      const undo = new Y.UndoManager(ana.getMap("document"), { trackedOrigins: new Set([collaboration.COLLABORATION_LOCAL_ORIGIN]), captureTimeout: 0 });
      try {
        const first = edit(ana, doc => { doc.pages[0].canvas.elements[0].text = "Ana before"; doc.updatedAt = "2026-10-13T14:00:01.000Z"; });
        Y.applyUpdate(bruno, first, collaboration.COLLABORATION_REMOTE_ORIGIN);
        const initialShape = edit(bruno, doc => { doc.pages[0].canvas.elements[1].fill = "#ee3377"; doc.updatedAt = "2026-10-13T14:00:02.000Z"; });
        Y.applyUpdate(ana, initialShape, collaboration.COLLABORATION_REMOTE_ORIGIN);
        undo.stopCapturing();
        const local = edit(ana, doc => { doc.pages[0].canvas.elements[0].text = "Ana after"; doc.updatedAt = "2026-10-13T14:00:03.000Z"; });
        const remote = edit(bruno, doc => { doc.pages[0].canvas.elements[1].fill = "#11aa77"; doc.updatedAt = "2026-10-13T14:00:04.000Z"; });
        Y.applyUpdate(ana, remote, collaboration.COLLABORATION_REMOTE_ORIGIN);
        Y.applyUpdate(bruno, local, collaboration.COLLABORATION_REMOTE_ORIGIN);
        undo.undo();
        const restored = collaboration.readCollaborationDocument(ana);
        assert.equal(restored.pages[0].canvas.elements[0].text, "Ana before");
        assert.equal(restored.pages[0].canvas.elements[1].fill, "#11aa77");
        assert.ok(typeof restored.updatedAt === "string" && Number.isFinite(Date.parse(restored.updatedAt)), "Undo must retain a valid document.updatedAt after concurrent saves");
        assert.ok(model.parseLibrary({ ...structuredClone(model.EMPTY_LIBRARY), designs: [restored] }), "The collaborative undo document must remain saveable");
      } finally {
        undo.destroy(); [seeded, ana, bruno].forEach(doc => doc.destroy());
      }
    }
  }
});


test("collaboration materializes copied embedded images without a false expanded-size rejection",()=>{
  const document=fixture(),src="data:image/webp;base64,"+"A".repeat(1_700_000);
  document.pages[0].canvas.elements=Array.from({length:20},()=>model.createCanvasElement("image",{src}));
  const doc=collaboration.createCollaborationDocument(document);
  try {assert.deepEqual(collaboration.readCollaborationDocument(doc),document);}finally{doc.destroy();}
});
