import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const filename = path.join(root, file), unit = { exports: {} };
  loaded.set(file, unit.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(name => load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))), unit, unit.exports);
  return unit.exports;
}
const model = load("lib/template-editor/model.ts"), catalog = load("lib/template-editor/template-catalog.ts"), sync = load("lib/template-editor/library-sync.ts");
const blank = () => structuredClone(model.EMPTY_LIBRARY);
const first = model.BUILT_IN_TEMPLATES[0].id, second = model.BUILT_IN_TEMPLATES[1].id;
const before = "2030-01-01T00:00:00.000Z", later = "2030-01-02T00:00:00.000Z", latest = "2030-01-03T00:00:00.000Z";
const customTemplate = () => model.designAsTemplate(model.createBlankDesign("Custom", "portrait"), "Custom");

test("every bundled template can be trashed, backed up and restored without changing existing posts", () => {
  const pristine = structuredClone(model.BUILT_IN_TEMPLATES);
  let library = blank(); library.designs = model.BUILT_IN_TEMPLATES.map(model.createDesign);
  const posts = structuredClone(library.designs);
  assert.equal(catalog.libraryTemplates(library).length, 8);
  for (const template of model.BUILT_IN_TEMPLATES) library = catalog.deleteLibraryTemplate(library, template.id, before);
  assert.equal(catalog.libraryTemplates(library).length, 0); assert.equal(catalog.trashedTemplates(library).length, 8);
  assert.deepEqual(library.designs, posts); assert.deepEqual(model.BUILT_IN_TEMPLATES, pristine);
  library = model.parseLibrary(JSON.stringify(library));
  assert.equal(catalog.libraryTemplates(library).length, 0); assert.equal(catalog.trashedTemplates(library).length, 8);
  for (const template of model.BUILT_IN_TEMPLATES) library = catalog.restoreLibraryTemplate(library, template.id, later);
  assert.equal(catalog.libraryTemplates(library).length, 8); assert.equal(catalog.trashedTemplates(library).length, 0);
  assert.ok(library.builtInTemplateStates.every(state => state.updatedAt === later && state.deletedAt === undefined && state.permanentlyDeleted === undefined));
  assert.deepEqual(model.parseLibrary(JSON.stringify(library)), library);
});

test("purging bundled templates keeps minimal durable tombstones and consumes no custom-template slots", () => {
  let library = blank(); library.templates = Array.from({ length: 80 }, customTemplate);
  for (const template of model.BUILT_IN_TEMPLATES) library = catalog.purgeLibraryTemplate(catalog.deleteLibraryTemplate(library, template.id, before), template.id, later);
  assert.equal(library.templates.length, 80); assert.equal(catalog.libraryTemplates(library).length, 80); assert.equal(catalog.trashedTemplates(library).length, 0);
  assert.ok(library.builtInTemplateStates.every(state => Object.keys(state).sort().join(",") === "id,permanentlyDeleted,updatedAt"));
  const reloaded = model.parseLibrary(JSON.stringify(library)); assert.ok(reloaded); assert.equal(catalog.libraryTemplates(reloaded).length, 80);
  assert.equal(catalog.restoreLibraryTemplate(reloaded, first), reloaded);
  assert.equal(catalog.deleteLibraryTemplate(reloaded, first), reloaded);
  assert.deepEqual(catalog.withImportedTemplateStates(reloaded, blank()).builtInTemplateStates, reloaded.builtInTemplateStates);
});

test("state parsing keeps older-library omissions and rejects invalid IDs, duplicates, dates and overflow", () => {
  assert.equal(model.EMPTY_LIBRARY.builtInTemplateStates, undefined); assert.equal(model.parseLibrary(blank()).builtInTemplateStates, undefined);
  for (const states of [[{ id: "custom-only", updatedAt: before }], [{ id: first, updatedAt: "invalid" }], [{ id: first, updatedAt: before, deletedAt: "invalid" }], [{ id: first, updatedAt: before, permanentlyDeleted: "yes" }], [{ id: first, updatedAt: before }, { id: first, updatedAt: later }], Array.from({ length: 9 }, () => ({ id: first, updatedAt: before }))]) {
    assert.equal(model.parseLibrary({ ...blank(), builtInTemplateStates: states }), null);
  }
  assert.deepEqual(model.parseLibrary({ ...blank(), builtInTemplateStates: [] }).builtInTemplateStates, []);
});

test("patches merge distinct bundled IDs and old patches cannot remove saved decisions", async () => {
  const base = blank(), mine = catalog.deleteLibraryTemplate(base, first, before), remote = catalog.deleteLibraryTemplate(base, second, later);
  const patch = await sync.createLibraryPatch(base, mine); assert.equal(patch.collections.builtInTemplateStates.length, 1);
  const result = await sync.applyLibraryPatch(remote, patch);
  assert.equal(result.builtInTemplateStates.length, 2); assert.equal(catalog.libraryTemplates(result).length, 6); assert.ok(model.parseLibrary(result));
  const oldPatch = await sync.createLibraryPatch(base, { ...base, designs: [model.createBlankDesign("Old client", "portrait")] });
  assert.deepEqual((await sync.applyLibraryPatch(result, oldPatch)).builtInTemplateStates, result.builtInTemplateStates);
  const omitted = structuredClone(result); delete omitted.builtInTemplateStates;
  assert.equal((await sync.createLibraryPatch(result, omitted)).collections.builtInTemplateStates, undefined);
  const nullPatch = { version: 1, collections: { builtInTemplateStates: [{ id: first, beforeHash: await sync.contentHash(result.builtInTemplateStates.find(state => state.id === first)), value: null }] }, settings: [] };
  await assert.rejects(() => sync.applyLibraryPatch(result, nullPatch), /Restore it explicitly/);
});

test("same-ID conflicts converge by timestamp and ties prefer purge then deletion without invalid conflict IDs", async () => {
  const base = blank(), deleted = catalog.deleteLibraryTemplate(base, first, before), restored = catalog.restoreLibraryTemplate(deleted, first, later);
  const restoredPatch = await sync.createLibraryPatch(deleted, restored), newerDelete = catalog.deleteLibraryTemplate(deleted, first, latest);
  assert.equal((await sync.applyLibraryPatch(newerDelete, restoredPatch)).builtInTemplateStates[0].deletedAt, latest);
  assert.equal((await sync.applyLibraryPatch(deleted, restoredPatch)).builtInTemplateStates[0].deletedAt, undefined);
  const tiedRestore = catalog.restoreLibraryTemplate(deleted, first, before), tiedPurge = catalog.purgeLibraryTemplate(deleted, first, before);
  for (const [local, remote, expected] of [[deleted, tiedRestore, "deleted"], [tiedRestore, deleted, "deleted"], [deleted, tiedPurge, "purged"], [tiedPurge, deleted, "purged"]]) {
    const merged = sync.reconcileLibraries(base, local, remote);
    assert.equal(merged.copies, 0); assert.equal(merged.library.templates.length, 0); assert.equal(merged.library.builtInTemplateStates.length, 1);
    assert.equal(merged.library.builtInTemplateStates[0].id, first);
    assert.equal(Boolean(merged.library.builtInTemplateStates[0].permanentlyDeleted), expected === "purged");
    assert.equal(catalog.libraryTemplates(merged.library).some(template => template.id === first), false); assert.ok(model.parseLibrary(merged.library));
  }
  const old = blank(); assert.deepEqual(sync.reconcileLibraries(deleted, old, old).library.builtInTemplateStates, deleted.builtInTemplateStates);
});

test("imports preserve current choices, add absent IDs, and custom shadows do not reseed after purge", () => {
  const current = catalog.purgeLibraryTemplate(blank(), first, later), imported = catalog.deleteLibraryTemplate(catalog.restoreLibraryTemplate(blank(), first, latest), second, before);
  const merged = catalog.withImportedTemplateStates(current, imported);
  assert.equal(merged.builtInTemplateStates.length, 2); assert.equal(merged.builtInTemplateStates.find(state => state.id === first).permanentlyDeleted, true);
  const shadow = { ...structuredClone(model.BUILT_IN_TEMPLATES[0]), custom: true, name: "My edited preset" }, library = { ...blank(), templates: [shadow] };
  assert.equal(catalog.libraryTemplates(library).filter(template => template.id === first).length, 1);
  const deleted = catalog.deleteLibraryTemplate(library, first, before); assert.equal(catalog.libraryTemplates(deleted).some(template => template.id === first), false);
  assert.equal(catalog.trashedTemplates(deleted).filter(template => template.id === first).length, 1);
  const restored = catalog.restoreLibraryTemplate(deleted, first, later); assert.equal(catalog.libraryTemplates(restored).find(template => template.id === first).name, "My edited preset");
  const purged = model.parseLibrary(JSON.stringify(catalog.purgeLibraryTemplate(deleted, first, later)));
  assert.equal(purged.templates.length, 0); assert.equal(catalog.libraryTemplates(purged).some(template => template.id === first), false);
  const concurrent = { ...deleted, templates: [{ ...shadow, name: "Edited concurrently" }] };
  assert.equal(catalog.libraryTemplates(concurrent).some(template => template.id === first), false);
  assert.equal(catalog.trashedTemplates(concurrent).find(template => template.id === first).name, "Edited concurrently");
  const restoredWithStaleRow = { ...restored, templates: deleted.templates };
  assert.equal(catalog.libraryTemplates(restoredWithStaleRow).find(template => template.id === first).deletedAt, undefined);
  assert.equal(catalog.trashedTemplates(restoredWithStaleRow).length, 0);
});

test("simultaneous custom deletes coalesce and stale edits after purge remain recoverable only in Trash", () => {
  const template = customTemplate(), base = { ...blank(), templates: [template] };
  const left = catalog.deleteLibraryTemplate(base, template.id, before), right = catalog.deleteLibraryTemplate(base, template.id, later);
  const merged = sync.reconcileLibraries(base, left, right);
  assert.equal(merged.copies, 0); assert.equal(merged.library.templates.length, 1); assert.equal(merged.library.templates[0].deletedAt, later);
  const local = structuredClone(base); local.templates[0].name = "Edited in stale tab";
  const purged = catalog.purgeLibraryTemplate(base, template.id, latest), afterPurge = sync.reconcileLibraries(base, local, purged);
  assert.equal(afterPurge.copies, 1); assert.notEqual(afterPurge.library.templates[0].id, template.id);
  assert.ok(afterPurge.library.templates[0].deletedAt); assert.equal(catalog.libraryTemplates(afterPurge.library).some(item => item.custom), false);
  assert.equal(catalog.trashedTemplates(afterPurge.library).length, 1); assert.ok(model.parseLibrary(afterPurge.library));
  const afterDelete = sync.reconcileLibraries(base, local, right);
  assert.ok(afterDelete.library.templates.every(item => item.deletedAt));
});
