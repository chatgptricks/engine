/* Native IndexedDB tests on a blank loopback origin, with fresh browser contexts.
 * No application UI, user profile, mock IndexedDB, or external requests are used.
 * The strict acceptance command requires both the runner and a real browser. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { /* Optional browser runner. */ }
const explicitBrowser = process.env.ENGINE_BROWSER_PATH;
const installedBrowsers = process.platform === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
  : process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory, "Google/Chrome/Application/chrome.exe"))
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const browserExecutable = explicitBrowser || [chromium?.executablePath(), ...installedBrowsers].find(filename => filename && fs.existsSync(filename));
const available = Boolean(chromium && browserExecutable && fs.existsSync(browserExecutable));
if ((process.env.ENGINE_REQUIRE_BROWSER === "1" || explicitBrowser) && !available) {
  throw Error("Native IndexedDB acceptance requires Playwright and Chrome/Chromium. Run npm ci and set ENGINE_BROWSER_PATH to an installed browser, or install Playwright Chromium. This acceptance check cannot be skipped.");
}
const browserTest = (name, run) => test(name, { skip: !available, timeout: 20_000 }, async (t) => {
  const context = await browser.newContext();
  const stop = () => void context.close().catch(() => undefined);
  t.signal.addEventListener("abort", stop, {once: true});
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.addScriptTag({ content: browserSource });
    await run(page);
  } finally { t.signal.removeEventListener("abort", stop); await context.close(); }
});

const compile = (filename) => ts.transpileModule(fs.readFileSync(path.join(root, filename), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const browserSource = `(() => {
  const model = { exports: {} };
  (function(module, exports) { ${compile("lib/template-editor/model.ts")} })(model, model.exports);
  const merge={exports:{}};
  (function(module,exports){ ${compile("lib/template-editor/three-way-merge.ts")} })(merge,merge.exports);
  const catalog={exports:{}};
  (function(module,exports,require){ ${compile("lib/template-editor/template-catalog.ts")} })(catalog,catalog.exports,()=>model.exports);
  const sync={exports:{}};
  (function(module,exports,require){ ${compile("lib/template-editor/library-sync.ts")} })(sync,sync.exports,name=>name==='./model'?model.exports:name==='./template-catalog'?catalog.exports:merge.exports);
  const recovery = { exports: {} };
  (function(module, exports, require) { ${compile("lib/template-editor/recovery-storage.ts")} })(recovery, recovery.exports, name=>name==='./model'?model.exports:name==='./asset-processing'?{packAssetsOffThread:sync.exports.packAssets}:sync.exports);
  window.editorModel = model.exports;
  window.editorRecovery = recovery.exports;
  window.makeDraft = (stamp, updatedAt, scope = 'workspace-owner', key = scope + ':tab-1') => ({
    key, scope, stamp, updatedAt, revision: 'server-revision-before-edit',
    library: model.exports.withBrandKits(structuredClone(model.exports.EMPTY_LIBRARY), [{ ...model.exports.activeBrandKit(model.exports.EMPTY_LIBRARY), name: stamp }]),
  });
  window.openTestDatabase = (name, version = 1) => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' }).createIndex('scope', 'scope');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  window.storeTestDrafts = async (name, drafts, keepOpen = false) => {
    const db = await window.openTestDatabase(name);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      for (const draft of drafts) tx.objectStore('drafts').put(draft);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    if (!keepOpen) db.close();
    return db;
  };
  window.readTestDrafts = async (name, version = 1) => {
    const db = await window.openTestDatabase(name, version);
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readonly');
      const request = tx.objectStore('drafts').getAll();
      tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  };
})();`;

let server, browser, origin;
before(async () => {
  if (!available) return;
  server = http.createServer((_request, response) => response.end("<!doctype html><title>Engine recovery checks</title>"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  console.info(`Recovery acceptance: Chrome/Chromium ${browser.version()}, native IndexedDB, isolated contexts.`);
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

browserTest("recovery rename preserves pending content, revision, stamp, and owner scopes", async (page) => {
  const result = await page.evaluate(async () => {
    const own = makeDraft("pending-owner-edit", 10);
    const other = makeDraft("pending-member-edit", 20, "workspace-member");
    await storeTestDrafts("previous-template-editor", [own, other]);
    const recovered = await editorRecovery.getRecoveryDrafts(own.scope);
    const member = await editorRecovery.getRecoveryDrafts(other.scope);
    return { own, other, recovered, member, names: (await indexedDB.databases()).map((db) => db.name) };
  });
  assert.deepEqual(result.recovered, [result.own]);
  assert.deepEqual(result.member, [result.other]);
  assert.deepEqual(result.names, ["engine-template-editor"]);
});

browserTest("a newer Engine draft wins while the earlier divergent snapshot stays recoverable", async (page) => {
  const result = await page.evaluate(async () => {
    await storeTestDrafts("previous-template-editor", [makeDraft("older-pending", 10)]);
    await storeTestDrafts("engine-template-editor", [makeDraft("newer-pending", 20)]);
    return editorRecovery.getRecoveryDrafts("workspace-owner");
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].stamp, "newer-pending");
  assert.equal(result[0].key, "workspace-owner:tab-1");
  assert.equal(result[1].stamp, "older-pending");
  assert.notEqual(result[1].key, result[0].key);
});

browserTest("a newer incoming draft keeps the prior Engine snapshot without clobbering either", async (page) => {
  const result = await page.evaluate(async () => {
    await storeTestDrafts("previous-template-editor", [makeDraft("newer-incoming", 20)]);
    await storeTestDrafts("engine-template-editor", [makeDraft("older-engine", 10)]);
    const drafts = await editorRecovery.getRecoveryDrafts("workspace-owner");
    await editorRecovery.removeExactDraft({ key: drafts[0].key, stamp: "wrong-stamp" });
    const protectedDrafts = await editorRecovery.getRecoveryDrafts("workspace-owner");
    await editorRecovery.removeExactDraft(drafts[0]);
    return { protectedDrafts, remaining: await editorRecovery.getRecoveryDrafts("workspace-owner") };
  });
  assert.deepEqual(result.protectedDrafts.map((draft) => draft.stamp), ["newer-incoming", "older-engine"]);
  assert.deepEqual(result.remaining.map((draft) => draft.stamp), ["older-engine"]);
});

browserTest("a failed target write preserves the source draft and blocks a misleading empty load", async (page) => {
  const result = await page.evaluate(async () => {
    await storeTestDrafts("previous-template-editor", [makeDraft("unsaved-work", 10)]);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === "engine-template-editor") throw new DOMException("Full browser storage", "QuotaExceededError");
      return put.apply(this, args);
    };
    let error;
    try { await editorRecovery.getRecoveryDrafts("workspace-owner"); } catch (cause) { error = { name: cause.name, message: cause.message }; }
    finally { IDBObjectStore.prototype.put = put; }
    return { error, source: await readTestDrafts("previous-template-editor"), recovered: await editorRecovery.getRecoveryDrafts("workspace-owner") };
  });
  assert.equal(result.error.name, "RecoveryMigrationError");
  assert.match(result.error.message, /kept/);
  assert.equal(result.source[0].stamp, "unsaved-work");
  assert.equal(result.recovered[0].stamp, "unsaved-work");
});

browserTest("an old tab editing during migration retains its newer snapshot", async (page) => {
  const result = await page.evaluate(async () => {
    const source = await storeTestDrafts("previous-template-editor", [makeDraft("original-edit", 10)], true);
    source.onversionchange = () => source.close();
    const put = IDBObjectStore.prototype.put;
    let changed = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (!changed && this.transaction.db.name === "engine-template-editor") {
        changed = true;
        put.call(source.transaction("drafts", "readwrite").objectStore("drafts"), makeDraft("concurrent-edit", 20));
      }
      return put.apply(this, args);
    };
    try { return await editorRecovery.getRecoveryDrafts("workspace-owner"); }
    finally { IDBObjectStore.prototype.put = put; source.close(); }
  });
  assert.deepEqual(result.map((draft) => draft.stamp), ["concurrent-edit", "original-edit"]);
});

browserTest("blocked cleanup never schedules deletion of future writes from an old tab", async (page) => {
  const result = await page.evaluate(async () => {
    const source = await storeTestDrafts("previous-template-editor", [makeDraft("first-edit", 10)], true);
    const recovered = await editorRecovery.getRecoveryDrafts("workspace-owner");
    await new Promise((resolve, reject) => {
      const tx = source.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(makeDraft("later-old-tab-edit", 20));
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    source.close();
    return { recovered, sourceDrafts: await readTestDrafts("previous-template-editor") };
  });
  assert.equal(result.recovered[0].stamp, "first-edit");
  assert.equal(result.sourceDrafts[0].stamp, "later-old-tab-edit");
});

browserTest("an opener arriving during cleanup cannot write into the retired recovery store", async (page) => {
  const result = await page.evaluate(async () => {
    await storeTestDrafts("previous-template-editor", [makeDraft("protected-edit", 10)]);
    const remove = IDBFactory.prototype.deleteDatabase;
    let lateOpen;
    IDBFactory.prototype.deleteDatabase = function (name) {
      // Simulate an opener queued immediately before the deletion request.
      lateOpen = new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const db = request.result;
          const stores = Array.from(db.objectStoreNames);
          db.onversionchange = () => db.close();
          db.close();
          resolve(stores);
        };
        request.onerror = () => reject(request.error);
      });
      return remove.call(this, name);
    };
    try {
      const recovered = await editorRecovery.getRecoveryDrafts("workspace-owner");
      return { recovered, lateStores: await lateOpen, names: (await indexedDB.databases()).map((db) => db.name) };
    } finally { IDBFactory.prototype.deleteDatabase = remove; }
  });
  assert.equal(result.recovered[0].stamp, "protected-edit");
  assert.deepEqual(result.lateStores, []);
  assert.deepEqual(result.names, ["engine-template-editor"]);
});

browserTest("recovery migration never deletes unrelated object stores", async (page) => {
  const result = await page.evaluate(async () => {
    const source = await new Promise((resolve, reject) => {
      const request = indexedDB.open("previous-template-editor", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("drafts", { keyPath: "key" }).createIndex("scope", "scope");
        request.result.createObjectStore("other-data");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve) => {
      const tx = source.transaction(["drafts", "other-data"], "readwrite");
      tx.objectStore("drafts").put(makeDraft("pending-edit", 10));
      tx.objectStore("other-data").put("preserved-value", "record");
      tx.oncomplete = resolve;
    });
    source.close();
    const recovered = await editorRecovery.getRecoveryDrafts("workspace-owner");
    const retained = await openTestDatabase("previous-template-editor");
    const value = await new Promise((resolve) => {
      const request = retained.transaction("other-data", "readonly").objectStore("other-data").get("record");
      request.onsuccess = () => resolve(request.result);
    });
    retained.close();
    return { recovered, value };
  });
  assert.equal(result.recovered[0].stamp, "pending-edit");
  assert.equal(result.value, "preserved-value");
});

browserTest("unreadable records remain available in their original database", async (page) => {
  const result = await page.evaluate(async () => {
    const unknown = { key: "unreadable", scope: "workspace-owner", library: { unsupported: true } };
    await storeTestDrafts("previous-template-editor", [makeDraft("valid-edit", 10), unknown]);
    return { recovered: await editorRecovery.getRecoveryDrafts("workspace-owner"), source: await readTestDrafts("previous-template-editor") };
  });
  assert.equal(result.recovered[0].stamp, "valid-edit");
  assert.equal(result.source[0].key, "unreadable");
  assert.equal(result.source.length, 1);
});

browserTest("unsupported browser enumeration reports recovery migration failure and keeps old work", async (page) => {
  const result = await page.evaluate(async () => {
    await storeTestDrafts("previous-template-editor", [makeDraft("protected-edit", 10)]);
    Object.defineProperty(indexedDB, "databases", { value: undefined, configurable: true });
    let error;
    try { await editorRecovery.getRecoveryDrafts("workspace-owner"); } catch (cause) { error = { name: cause.name, message: cause.message }; }
    return { error, source: await readTestDrafts("previous-template-editor") };
  });
  assert.equal(result.error.name, "RecoveryMigrationError");
  assert.match(result.error.message, /Update the browser/);
  assert.equal(result.source[0].stamp, "protected-edit");
});

browserTest("saved recovery baseline survives a reload with one deduplicated image in native IndexedDB", async page => {
  await page.evaluate(async () => {
    const image = {...editorModel.createCanvasElement("image"), src:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xV4AAAAASUVORK5CYII="};
    const text = {...editorModel.createCanvasElement("text"), text:"Before edit"};
    const document = editorModel.createBlankDesign("Recoverable design", "portrait");
    document.pages[0].canvas.elements = [image,text];
    const baseline = {...structuredClone(editorModel.EMPTY_LIBRARY), designs:[document]}, library = structuredClone(baseline);
    library.designs[0].pages[0].canvas.elements[1].text = "After edit";
    const draft = {...makeDraft("pending-edit",20), library, baseline};
    await editorRecovery.saveRecoveryDraft(draft);
  });
  await page.reload();
  await page.addScriptTag({content:browserSource});
  const result=await page.evaluate(async()=>({recovered:(await editorRecovery.getRecoveryDrafts("workspace-owner"))[0],stored:(await readTestDrafts("engine-template-editor",2))[0]}));
  assert.equal(result.recovered.library.designs[0].pages[0].canvas.elements[1].text,"After edit");
  assert.equal(result.recovered.baseline.designs[0].pages[0].canvas.elements[1].text,"Before edit");
  assert.equal(Object.keys(result.stored.recoveryAssets).length,1);
  assert.match(result.stored.library.designs[0].pages[0].canvas.elements[0].src,/^engine-asset:[a-f0-9]{64}$/);
  assert.equal(result.stored.library.designs[0].pages[0].canvas.elements[0].src,result.stored.baseline.designs[0].pages[0].canvas.elements[0].src);
});

browserTest("a corrupt baseline cannot masquerade as confirmed state while pending artwork remains recoverable",async page => {
  const result = await page.evaluate(async()=>{
    const draft = {...makeDraft("Valid pending artwork",20),baseline:{version:99,designs:[],templates:[]}};
    await storeTestDrafts("engine-template-editor",[draft]);
    return {recovered:(await editorRecovery.getRecoveryDrafts(draft.scope))[0],stored:(await readTestDrafts("engine-template-editor",2))[0]};
  });
  assert.equal(result.recovered.library.brand.name,"Valid pending artwork");
  assert.equal(result.recovered.baseline,undefined);
  assert.equal(result.stored.baseline.version,99);
});
