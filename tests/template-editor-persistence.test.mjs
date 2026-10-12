/* Run: node --test tests/template-editor-persistence.test.mjs
 * The real TypeScript modules are compiled in memory. Only environment,
 * authentication, and the external database boundary are replaced. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url);
function loadModule(relative, dependencies = {}, environment = process) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const compiled = vm.runInThisContext(
    `(function(require,module,exports,process){${source}\n})`,
    { filename },
  );
  const unit = { exports: {} };
  compiled(
    (name) =>
      Object.hasOwn(dependencies, name)
        ? dependencies[name]
        : requireModule(name),
    unit,
    unit.exports,
    environment,
  );
  return unit.exports;
}

const model = loadModule("lib/template-editor/model.ts");
const newLibrary = (name) => {
  const library = structuredClone(model.EMPTY_LIBRARY);
  return model.withBrandKits(library, [{ ...model.activeBrandKit(library), name }]);
};

function persistence(t, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "engine-editor-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return loadModule(
    "lib/template-editor/persistence.ts",
    {
      "@/lib/supabase/admin": { getAdminSupabase: () => options.db ?? null },
      "./model": model,
      "./library-sync": loadModule("lib/template-editor/library-sync.ts"),
      "./library-budget": loadModule("lib/template-editor/library-budget.ts"),
      "./development-storage": loadModule("lib/template-editor/development-storage.ts", {}, {cwd:()=>directory,env:{NODE_ENV:options.production?"production":"test"}}),
    },
    {
      cwd: () => directory,
      env: { NODE_ENV: options.production ? "production" : "test" },
    },
  );
}

function fakeDatabase() {
  const rows = new Map();
  return {
    rows,
    from(table) {
      assert.equal(table, "gf_client_state");
      const conditions = new Map();
      let update = null;
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          conditions.set(column, value);
          return query;
        },
        update(value) {
          update = structuredClone(value);
          return query;
        },
        async insert(value) {
          if (rows.has(value.owner)) return { error: { code: "23505" } };
          rows.set(value.owner, structuredClone(value));
          return { error: null };
        },
        async maybeSingle() {
          const owner = conditions.get("owner");
          const row = rows.get(owner);
          if (update) {
            if (!row || row.data.revision !== conditions.get("data->>revision"))
              return { data: null, error: null };
            rows.set(owner, { ...row, ...update });
            return { data: { owner }, error: null };
          }
          return { data: row ? structuredClone(row) : null, error: null };
        },
      };
      return query;
    },
  };
}

test("development saves persist atomically and are isolated from other owners", async (t) => {
  const store = persistence(t);
  const initial = await store.getEditorLibrary("owner");
  assert.equal(initial.revision, null);
  assert.equal(initial.storage, "local");
  const saved = await store.saveEditorLibrary(
    "owner",
    newLibrary("My studio"),
    null,
  );
  assert.equal(
    (await store.getEditorLibrary("owner")).library.brand.name,
    "My studio",
  );
  assert.equal((await store.getEditorLibrary("member-other")).revision, null);
  assert.notEqual(
    saved.scope,
    (await store.getEditorLibrary("member-other")).scope,
  );
  const updated = await store.saveEditorLibrary(
    "owner",
    newLibrary("Updated studio"),
    saved.revision,
  );
  assert.notEqual(updated.revision, saved.revision);
});

test("development data migrates outside the checkout without deleting legacy recovery files", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "engine-migration-test-"));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const storage = loadModule("lib/template-editor/development-storage.ts", {}, {
    cwd: () => path.join(directory,"checkout"),
    env: {NODE_ENV:"development", ENGINE_DEV_STORAGE_DIR:path.join(directory,"private-storage")},
  });
  const legacyDirectory = path.join(directory,"checkout",".engine-dev","template-editor");
  fs.mkdirSync(legacyDirectory,{recursive:true});
  const name = `${"a".repeat(64)}.json`, legacyPath = path.join(legacyDirectory,name);
  const saved = {revision:"preserved",data:{designs:["original"]}};
  fs.writeFileSync(legacyPath,JSON.stringify(saved));
  const decode = value => {assert.equal(value.revision,"preserved");return value;};
  const results = await Promise.all([
    storage.readDevelopmentRecord("template-editor",name,decode),
    storage.readDevelopmentRecord("template-editor",name,decode),
  ]);
  results.forEach(value => assert.deepEqual(value,saved));
  const targetDirectory = storage.developmentDirectory("template-editor");
  assert.ok(targetDirectory.startsWith(path.join(directory,"private-storage")));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(targetDirectory,name),"utf8")),saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(legacyPath,"utf8")),saved);
  assert.deepEqual(fs.readdirSync(targetDirectory),[name]);
  const invalidName = `${"b".repeat(64)}.json`;
  fs.writeFileSync(path.join(legacyDirectory,invalidName),JSON.stringify({revision:"invalid"}));
  await assert.rejects(storage.readDevelopmentRecord("template-editor",invalidName,decode));
  assert.equal(fs.existsSync(path.join(targetDirectory,invalidName)),false);
  await assert.rejects(storage.readDevelopmentRecord("template-editor","../private.json",decode),/Invalid development/);
});

test("concurrent development saves allow exactly one writer", async (t) => {
  const store = persistence(t);
  const outcomes = await Promise.allSettled([
    store.saveEditorLibrary("owner", newLibrary("Tab one"), null),
    store.saveEditorLibrary("owner", newLibrary("Tab two"), null),
  ]);
  assert.equal(
    outcomes.filter((value) => value.status === "fulfilled").length,
    1,
  );
  const failure = outcomes.find((value) => value.status === "rejected");
  assert.ok(failure.reason instanceof store.LibraryConflictError);
  assert.equal(
    (await store.getEditorLibrary("owner")).library.brand.name,
    "Tab one",
  );
});

test("production without cloud storage fails instead of acknowledging a temporary file save", async (t) => {
  const store = persistence(t, { production: true });
  await assert.rejects(store.getEditorLibrary("owner"), /not configured/);
  await assert.rejects(
    store.saveEditorLibrary("owner", newLibrary("Never saved"), null),
    /not configured/,
  );
});

test("cloud writes use a separate namespace and reject stale revisions atomically", async (t) => {
  const db = fakeDatabase();
  db.rows.set("owner", { owner: "owner", data: { legacyResearch: true } });
  const store = persistence(t, { db, production: true });
  const first = await store.saveEditorLibrary(
    "owner",
    newLibrary("First"),
    null,
  );
  assert.equal(first.storage, "cloud");
  const results = await Promise.allSettled([
    store.saveEditorLibrary("owner", newLibrary("Second"), first.revision),
    store.saveEditorLibrary("owner", newLibrary("Stale"), first.revision),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.ok(
    results.find((result) => result.status === "rejected").reason instanceof
      store.LibraryConflictError,
  );
  assert.deepEqual(db.rows.get("owner").data, { legacyResearch: true });
  assert.equal(
    (await store.getEditorLibrary("owner")).library.brand.name,
    "Second",
  );
  await assert.rejects(
    store.saveEditorLibrary("owner", newLibrary("Overwrite"), null),
    store.LibraryConflictError,
  );
});

test("unreadable saved cloud data does not silently become an empty library", async (t) => {
  const db = fakeDatabase();
  db.rows.set("template-editor:owner", {
    owner: "template-editor:owner",
    data: { unexpected: true },
  });
  const store = persistence(t, { db });
  await assert.rejects(store.getEditorLibrary("owner"), /not been overwritten/);
  assert.deepEqual(db.rows.get("template-editor:owner").data, {
    unexpected: true,
  });
});

function route(access, store, env = {}) {
  return loadModule(
    "app/api/template-editor/route.ts",
    {
      "@/lib/engine/member": { resolveEngineAccess: async () => access },
      "@/lib/template-editor/model": model,
      "@/lib/template-editor/persistence": store,
    },
    { env },
  );
}

test("API rejects unauthenticated reads and writes before touching storage", async () => {
  const api = route(null, {});
  assert.equal((await api.GET()).status, 401);
  assert.equal(
    (
      await api.PUT(
        new Request("http://localhost/api/template-editor", {
          method: "PUT",
          body: "{}",
        }),
      )
    ).status,
    401,
  );
});

test("API scopes writes to authenticated identity and returns conflicts", async (t) => {
  const store = persistence(t);
  const api = route({ kind: "member", ownerKey: "actual-member" }, store);
  const request = (revision) =>
    new Request("http://localhost/api/template-editor", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        owner: "forged-member",
        library: newLibrary("Private"),
        revision,
      }),
    });
  const first = await api.PUT(request(null));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal((await api.PUT(request(null))).status, 409);
  assert.equal(
    (await store.getEditorLibrary("actual-member")).library.brand.name,
    "Private",
  );
  assert.equal((await store.getEditorLibrary("forged-member")).revision, null);
});

test("API validates actual streamed body size, schemas, and cross-origin writes", async (t) => {
  const api = route({ kind: "owner", ownerKey: "owner" }, persistence(t));
  const request = (body, headers = {}) =>
    new Request("http://localhost/api/template-editor", {
      method: "PUT",
      body,
      headers,
    });
  assert.equal((await api.PUT(request('{"library":{}}'))).status, 400);
  assert.equal((await api.PUT(request("{broken"))).status, 400);
  assert.equal(
    (await api.PUT(request("{}", { Origin: "https://another-site.test" })))
      .status,
    403,
  );
  assert.equal(
    (await api.PUT(request(" ".repeat(12 * 1024 * 1024 + 1)))).status,
    413,
  );
});

test("API accepts configured public origins behind a reverse proxy and rejects untrusted origins", async (t) => {
  const store = persistence(t);
  const api = route({ kind: "owner", ownerKey: "owner" }, store, {
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://Studio.Example:443/",
    RENDER_EXTERNAL_URL: "https://your-service.onrender.com/",
  });
  let revision = null;
  const request = (origin, headers = {}) => new Request("http://localhost:10000/api/template-editor", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify({ library: newLibrary("Behind the proxy"), revision }),
  });
  for (const origin of ["https://studio.example", "https://your-service.onrender.com", "http://localhost:10000"]) {
    const result = await api.PUT(request(origin));
    assert.equal(result.status, 200, origin);
    revision = (await result.json()).revision;
  }
  for (const origin of ["https://studio.example.attacker.test", "http://studio.example", "https://studio.example/path", "https://studio.example#fragment", "null", ""]) {
    assert.equal((await api.PUT(request(origin))).status, 403, origin);
  }
  assert.equal((await api.PUT(request("https://attacker.test", {
    "x-forwarded-host": "attacker.test", "x-forwarded-proto": "https",
  }))).status, 403);
  assert.equal((await store.getEditorLibrary("owner")).revision, revision);
});

test("API ignores malformed or credential-bearing configured origins", async (t) => {
  const api = route({ kind: "owner", ownerKey: "owner" }, persistence(t), {
    NEXT_PUBLIC_SITE_URL: "https://user:password@another-site.test",
    RENDER_EXTERNAL_URL: "not a URL",
  });
  const result = await api.PUT(new Request("http://localhost:10000/api/template-editor", {
    method: "PUT", headers: { Origin: "https://another-site.test" }, body: "{}",
  }));
  assert.equal(result.status, 403);
});

test("document patches merge concurrent changes to different designs without overwriting either", async t => {
  const sync = loadModule("lib/template-editor/library-sync.ts"), store = persistence(t);
  const library = {...structuredClone(model.EMPTY_LIBRARY), designs: [model.createBlankDesign("One", "portrait"), model.createBlankDesign("Two", "square")]};
  const first = await store.saveEditorLibrary("owner", library, null);
  const tabOne = structuredClone(first.library), tabTwo = structuredClone(first.library);
  tabOne.designs[0].name = "Changed one"; tabTwo.designs[1].name = "Changed two";
  const a = await sync.packAssets(await sync.createLibraryPatch(first.library, tabOne));
  const b = await sync.packAssets(await sync.createLibraryPatch(first.library, tabTwo));
  const results = await Promise.all([store.saveEditorPatch("owner", a.value, a.assets, first.revision, crypto.randomUUID()), store.saveEditorPatch("owner", b.value, b.assets, first.revision, crypto.randomUUID())]);
  assert.equal(results.length, 2);
  const saved = await store.getEditorLibrary("owner");
  assert.deepEqual(saved.library.designs.map(doc => doc.name), ["Changed one", "Changed two"]);
});

test("patch operation retries are idempotent, same-document conflicts preserve server state, and checkpoints remain durable", async t => {
  const sync = loadModule("lib/template-editor/library-sync.ts"), store = persistence(t);
  const first = await store.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs: [model.createBlankDesign("Original", "portrait")]}, null);
  const local = structuredClone(first.library); local.designs[0].name = "Saved";
  const patch = await sync.packAssets(await sync.createLibraryPatch(first.library, local));
  const operation = crypto.randomUUID();
  const saved = await store.saveEditorPatch("owner", patch.value, patch.assets, first.revision, operation);
  const retry = await store.saveEditorPatch("owner", patch.value, patch.assets, first.revision, operation);
  assert.equal(retry.revision, saved.revision);
  const different = structuredClone(first.library); different.designs[0].name = "Divergent";
  const conflict = await sync.packAssets(await sync.createLibraryPatch(first.library, different));
  await assert.rejects(store.saveEditorPatch("owner", conflict.value, conflict.assets, first.revision, crypto.randomUUID()), store.LibraryConflictError);
  assert.equal((await store.getEditorLibrary("owner")).library.designs[0].name, "Saved");
  const history = await store.getDocumentHistory("owner", first.library.designs[0].id);
  assert.equal(history.length, 1); assert.equal(history[0].document.name, "Original");
  assert.deepEqual(await store.getDocumentHistory("other-owner", first.library.designs[0].id), []);
});

test("embedded assets are stored once, restored losslessly, and never accepted with a forged content hash", async t => {
  const sync = loadModule("lib/template-editor/library-sync.ts"), db = fakeDatabase(), store = persistence(t, {db});
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const library = structuredClone(model.EMPTY_LIBRARY);
  library.brandKits[0].assets = [0,1].map(index => ({id: `asset-${index}`, name: "Logo", src: image, width: 1, height: 1, kind: "logo"}));
  const saved = await store.saveEditorLibrary("owner", library, null);
  const row = db.rows.get("template-editor:owner").data;
  assert.equal(Object.keys(row.assets).length, 1);
  assert.equal((JSON.stringify(row).match(/iVBORw0KGgo=/g) ?? []).length, 1);
  assert.equal(saved.library.brandKits[0].assets[1].src, image);
  const changed = structuredClone(saved.library); changed.brandKits[0].assets[0].name = "Renamed";
  const packed = await sync.packAssets(await sync.createLibraryPatch(saved.library, changed), new Set(saved.assetKeys));
  assert.deepEqual(packed.assets, {});
  const result = await store.saveEditorPatch("owner", packed.value, packed.assets, saved.revision, crypto.randomUUID());
  assert.equal(result.library.brandKits[0].assets[0].src, image);
  await assert.rejects(store.saveEditorPatch("owner", packed.value, {['0'.repeat(64)]: image}, result.revision, crypto.randomUUID()), /Invalid embedded asset/);
});

test("shape photos and text textures retain crop, bindings and private provenance through patches and history",async t=>{
  const db=fakeDatabase(),store=persistence(t,{db}),sync=loadModule("lib/template-editor/library-sync.ts");
  const src="data:image/png;base64,iVBORw0KGgo=",design=model.createBlankDesign("Photo frame","portrait"),photo=model.createCanvasElement("shape"),image=model.createCanvasElement("image");
  image.src=src;photo.strokeAlign="outside";photo.imageFill={src,objectFit:"cover",cropX:20,cropY:70,cropScale:1.5,flipY:true,intrinsicWidth:1800,intrinsicHeight:1200,directive:"PRIVATE_PROMPT",rightsNote:"Private usage note",sourceUrl:"https://source.example/photo",provenance:{source:"research",imageId:"image-photo",description:"Private source detail",cosmosManual:true}};
  const title=model.createCanvasElement("text",{text:"Photo title",richText:'<span data-texture-id="title-word">Photo</span> title'});title.textureFill=structuredClone(photo.imageFill);title.wordTextures=[{...structuredClone(photo.imageFill),id:"title-word"}];
  design.pages[0].canvas.elements=[photo,image,title];
  design.versions=[{id:crypto.randomUUID(),name:"Photo baseline",createdAt:new Date().toISOString(),format:design.format,pages:structuredClone(design.pages),caption:""}];
  const initial={...structuredClone(model.EMPTY_LIBRARY),designs:[design]};assert.ok(model.parseLibrary(initial));
  const saved=await store.saveEditorLibrary("owner",initial,null);assert.deepEqual(saved.library.designs[0].pages[0].canvas.elements[0].imageFill,photo.imageFill);
  assert.equal(Object.keys(db.rows.get("template-editor:owner").data.assets).length,1);
  const changed=structuredClone(saved.library);changed.designs[0].pages[0].canvas.elements[0].imageFill.cropX=65;changed.designs[0].pages[0].canvas.elements[0].strokeAlign="inside";changed.designs[0].pages[0].canvas.elements[2].wordTextures[0].cropX=75;
  const packed=await sync.packAssets(await sync.createLibraryPatch(saved.library,changed),new Set(saved.assetKeys));assert.deepEqual(packed.assets,{});
  const result=await store.saveEditorPatch("owner",packed.value,packed.assets,saved.revision,crypto.randomUUID());
  assert.equal(result.library.designs[0].pages[0].canvas.elements[0].imageFill.cropX,65);assert.equal(result.library.designs[0].pages[0].canvas.elements[0].strokeAlign,"inside");
  assert.equal(result.library.designs[0].versions[0].pages[0].canvas.elements[0].imageFill.cropX,20);
  assert.equal(result.library.designs[0].pages[0].canvas.elements[2].wordTextures[0].cropX,75);
  assert.equal(result.library.designs[0].versions[0].pages[0].canvas.elements[2].wordTextures[0].cropX,20);
  const baseline=(await store.getDocumentHistory("owner",design.id))[0].document.pages[0].canvas.elements[0];
  assert.equal(baseline.imageFill.cropX,20);assert.equal(baseline.strokeAlign,"outside");assert.equal(baseline.imageFill.provenance.description,"Private source detail");
  const restored=await store.getEditorLibrary("owner");assert.equal(restored.library.designs[0].pages[0].canvas.elements[0].imageFill.src,src);
  const restoredTitle=restored.library.designs[0].pages[0].canvas.elements[2];assert.equal(restoredTitle.textureFill.src,src);assert.equal(restoredTitle.wordTextures[0].src,src);assert.equal(restoredTitle.richText,title.richText);assert.equal(restoredTitle.wordTextures[0].provenance.description,"Private source detail");
  assert.equal(Object.keys(db.rows.get("template-editor:owner").data.assets).length,1);
});

test("review links freeze artwork, exclude internal metadata, isolate owners and revoke token access", async t => {
  const db = fakeDatabase(), store = persistence(t, {db}), sync = loadModule("lib/template-editor/library-sync.ts");
  const design = model.createBlankDesign("Review snapshot", "portrait");
  design.tags = ["internal"]; design.favorite = true;
  Object.assign(design.pages[0].image,{directive:"PRIVATE_PROMPT",rightsNote:"PRIVATE_NOTE",description:"PRIVATE_DESCRIPTION",sourceUrl:"https://private.example/?token=demo",url:"https://private.example/unpainted-photo.png"});
  const visible=model.createCanvasElement("text");Object.assign(visible,{text:"Visible artwork",name:"PRIVATE_LAYER_NAME",slot:"private-slot",protected:["content"]});
  const hidden=model.createCanvasElement("text");Object.assign(hidden,{text:"HIDDEN_SECRET",hidden:true});
  const parked=model.createCanvasElement("text");Object.assign(parked,{text:"PARKED_SECRET",x:1000});
  const child=model.createCanvasElement("text");Object.assign(child,{text:"INHERITED_HIDDEN_SECRET",groupId:"child-group"});
  design.pages[0].canvas.elements=[visible,hidden,parked,child];
  design.pages[0].canvas.groups=[{id:"parent-group",name:"Private group",hidden:true},{id:"child-group",name:"Child group",parentId:"parent-group"}]; design.comments = [{id:crypto.randomUUID(),text:"Private note",createdAt:new Date().toISOString()}];
  await store.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs:[design]}, null);
  const reviews = loadModule("lib/template-editor/reviews.ts", {"@/lib/supabase/admin":{getAdminSupabase:()=>db},"./persistence":store,"./model":model,"./library-sync":sync,"./development-storage":loadModule("lib/template-editor/development-storage.ts"),"./review-assets":{embedReviewImages:async value=>value},"./review-snapshot":loadModule("lib/template-editor/review-snapshot.ts",{"./model":model,"./canvas-geometry":loadModule("lib/template-editor/canvas-geometry.ts")})});
  const created = await reviews.createReview("owner", design.id, 7);
  assert.match(created.token,/^[a-f0-9]{64}$/);
  const publicReview = await reviews.getPublicReview(created.token);
  assert.equal(publicReview.document.name,"Review snapshot");
  const publicJson=JSON.stringify(publicReview);
  for(const secret of ["PRIVATE_PROMPT","PRIVATE_NOTE","PRIVATE_DESCRIPTION","token=demo","unpainted-photo","PRIVATE_LAYER_NAME","private-slot","HIDDEN_SECRET","PARKED_SECRET","INHERITED_HIDDEN_SECRET"]) assert.ok(!publicJson.includes(secret),secret);
  assert.ok(publicJson.includes("Visible artwork"));assert.equal(publicReview.document.pages[0].canvas.elements.length,1);
  assert.equal(publicReview.document.pages[0].image.directive,"");assert.equal(publicReview.document.pages[0].image.sourceUrl,undefined);
  assert.equal(publicReview.document.comments,undefined);assert.equal(publicReview.document.tags,undefined);assert.equal(publicReview.document.favorite,undefined);assert.equal(publicReview.owner,undefined);
  const library = await store.getEditorLibrary("owner");library.library.designs[0].name="Changed after sharing";
  await store.saveEditorLibrary("owner",library.library,library.revision);
  assert.equal((await reviews.getPublicReview(created.token)).document.name,"Review snapshot");
  assert.equal(await reviews.readOwnerReview("another-owner",created.token),null);
  await assert.rejects(reviews.revokeReview("another-owner",created.token),/not found/);
  const comment = await reviews.addReviewComment(created.token,{name:"Reviewer",text:"Move the title",pageId:design.pages[0].id});
  assert.equal(comment.text,"Move the title");
  await assert.rejects(reviews.addReviewComment(created.token,{name:"Reviewer",text:"Flood"}),/Wait a moment/);
  await reviews.revokeReview("owner",created.token);
  assert.equal(await reviews.getPublicReview(created.token),null);
  await assert.rejects(reviews.addReviewComment(created.token,{name:"Reviewer",text:"After revoke"}),/revoked/);
  assert.equal(await reviews.getPublicReview("bad-token"),null);
});

test("public artwork retains painted clip bounds and excludes entirely clipped layers", () => {
  const snapshot = loadModule("lib/template-editor/review-snapshot.ts",{"./model":model,"./canvas-geometry":loadModule("lib/template-editor/canvas-geometry.ts")});
  const design = model.createBlankDesign("Clipped review","portrait");
  const visible = model.createCanvasElement("text");
  Object.assign(visible,{x:20,y:20,width:100,height:100,text:"Visible",clipBounds:{x:0,y:0,width:100,height:100}});
  const clipped = structuredClone(visible);Object.assign(clipped,{id:crypto.randomUUID(),text:"CLIPPED_SECRET",clipBounds:{x:400,y:0,width:100,height:100}});
  const outside = structuredClone(visible);Object.assign(outside,{id:crypto.randomUUID(),text:"DISJOINT_SECRET",clipBounds:{x:200,y:200,width:100,height:100}});
  design.pages[0].canvas.elements = [visible,clipped,outside];
  const result = snapshot.prepareReviewSnapshot(design);
  assert.equal(result.pages[0].canvas.elements.length,1);
  assert.deepEqual(result.pages[0].canvas.elements[0].clipBounds,visible.clipBounds);
  assert.equal(JSON.stringify(result).includes("CLIPPED_SECRET"),false);
  assert.equal(JSON.stringify(result).includes("DISJOINT_SECRET"),false);
});

test("public snapshots preserve per-page master visibility and omit entirely inactive master artwork",()=>{
  const snapshot=loadModule("lib/template-editor/review-snapshot.ts",{"./model":model,"./canvas-geometry":loadModule("lib/template-editor/canvas-geometry.ts")});
  const design=model.createBlankDesign("Master privacy","portrait");design.pages[0].useMaster=false;
  design.masterScene={background:"transparent",elements:[model.createCanvasElement("text",{text:"INACTIVE_MASTER_SECRET"})]};
  const inactive=snapshot.prepareReviewSnapshot(design);assert.equal(inactive.masterScene,undefined);assert.equal(inactive.pages[0].useMaster,false);assert.equal(JSON.stringify(inactive).includes("INACTIVE_MASTER_SECRET"),false);
  design.pages.push({...structuredClone(design.pages[0]),id:crypto.randomUUID(),useMaster:true});
  const active=snapshot.prepareReviewSnapshot(design);assert.equal(active.pages[0].useMaster,false);assert.equal(active.pages[1].useMaster,undefined);assert.equal(active.masterScene.elements[0].text,"INACTIVE_MASTER_SECRET");
});

test("public shape photos freeze nested sources once and omit private photo metadata",async()=>{
  const snapshot=loadModule("lib/template-editor/review-snapshot.ts",{"./model":model,"./canvas-geometry":loadModule("lib/template-editor/canvas-geometry.ts")});
  const {Readable}=requireModule("node:stream"),{EventEmitter}=requireModule("node:events");let fetched=0;
  const request=(_url,_options,onResponse)=>{
    const emitter=new EventEmitter();emitter.destroy=()=>emitter;emitter.end=()=>queueMicrotask(()=>{
      fetched++;const response=Readable.from([Buffer.from("encoded-image")]);response.statusCode=200;response.headers={"content-type":"image/png"};response.once("end",()=>emitter.emit("close"));onResponse(response);
    });return emitter;
  };
  const image=()=>({rotate(){return this;},resize(){return this;},webp(){return this;},async toBuffer(){return Buffer.from("frozen-webp");}});
  const assets=loadModule("lib/template-editor/review-assets.ts",{"node:dns/promises":{lookup:async()=>[{address:"8.8.8.8",family:4}]},"node:https":{request},sharp:image});
  const design=model.createBlankDesign("Photo review","portrait"),shape=model.createCanvasElement("shape");
  shape.strokeAlign="inside";shape.imageFill={src:"https://public.example/photo.png?token=original-private-token",objectFit:"cover",cropX:25,cropY:75,cropScale:1.5,flipX:true,intrinsicWidth:1800,intrinsicHeight:900,alt:"PRIVATE_ALT",directive:"PRIVATE_PROMPT",rightsNote:"PRIVATE_RIGHTS",sourceUrl:"https://source.example/?token=private",provenance:{description:"PRIVATE_PROVENANCE"}};
  const copy=structuredClone(shape);copy.id=crypto.randomUUID();
  const title=model.createCanvasElement("text",{text:"Painted title",richText:'<span data-texture-id="word-texture">Painted</span> title'});title.textureFill=structuredClone(shape.imageFill);title.wordTextures=[{...structuredClone(shape.imageFill),id:"word-texture"},{...structuredClone(shape.imageFill),id:"unused-word-texture",src:"https://unpainted.example/PRIVATE_UNUSED_TEXTURE.png"}];
  design.pages[0].canvas.elements=[shape,copy,title];
  const result=await assets.embedReviewImages(snapshot.prepareReviewSnapshot(design));
  assert.equal(fetched,1);const published=result.pages[0].canvas.elements[0];
  assert.equal(published.strokeAlign,"inside");assert.equal(published.imageFill.cropX,25);assert.equal(published.imageFill.cropScale,1.5);assert.equal(published.imageFill.flipX,true);
  assert.match(published.imageFill.src,/^data:image\/webp;base64,/);
  const paintedTitle=result.pages[0].canvas.elements[2];assert.match(paintedTitle.textureFill.src,/^data:image\/webp;base64,/);assert.equal(paintedTitle.wordTextures.length,1);assert.equal(paintedTitle.wordTextures[0].id,"word-texture");assert.equal(paintedTitle.richText,title.richText);
  for(const secret of ["PRIVATE_ALT","PRIVATE_PROMPT","PRIVATE_RIGHTS","PRIVATE_PROVENANCE","original-private-token","source.example","PRIVATE_UNUSED_TEXTURE","unused-word-texture"])assert.equal(JSON.stringify(result).includes(secret),false,secret);
});

test("review snapshot fetches reject private destinations and credential-bearing URLs before fetching", async () => {
  const assets = loadModule("lib/template-editor/review-assets.ts", {"node:dns/promises":{lookup:async()=>[{address:"127.0.0.1",family:4}]}});
  await assert.rejects(assets.fetchReviewImage("https://public.example/photo.png"),/private/);
  await assert.rejects(assets.fetchReviewImage("https://user:password@public.example/photo.png"),/not supported/);
  await assert.rejects(assets.fetchReviewImage("http://public.example:8080/photo.png"),/not supported/);
  await assert.rejects(assets.embedReviewImages({text:{wordTextures:[{id:"word",src:"/api/engine/img?u="}]}}),/proxy source is unavailable/);
  await assert.rejects(assets.embedReviewImages({shape:{imageFill:{src:"HTTPS://public.example/photo.png"}}}),/private/);
});

test("document save scope prevents a stale owner tab from rebasing its work into another account", async t => {
 const store=persistence(t),sync=loadModule("lib/template-editor/library-sync.ts");
 const ownerA=await store.saveEditorLibrary("owner-a",structuredClone(model.EMPTY_LIBRARY),null);
 const local=structuredClone(ownerA.library);local.designs.push(model.createBlankDesign("Private to A","portrait"));
 const packed=await sync.packAssets(await sync.createLibraryPatch(ownerA.library,local));
 const api=route({kind:"member",ownerKey:"owner-b"},store);
 const response=await api.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({patch:packed.value,assets:packed.assets,revision:ownerA.revision,expectedScope:ownerA.scope,clientSchema:2,operationId:crypto.randomUUID()})}));
 assert.equal(response.status,403);assert.equal((await response.json()).code,"workspace_owner_changed");
 assert.equal((await store.getEditorLibrary("owner-b")).library.designs.length,0);
 const ownApi=route({kind:"member",ownerKey:"owner-a"},store);
 const accepted=await ownApi.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({patch:packed.value,assets:packed.assets,revision:ownerA.revision,expectedScope:ownerA.scope,clientSchema:2,operationId:crypto.randomUUID()})}));
 assert.equal(accepted.status,200);assert.equal((await store.getEditorLibrary("owner-a")).library.designs[0].name,"Private to A");
});

test("legacy clients cannot overwrite a schema-two workspace but first legacy imports migrate safely", async t => {
 const store=persistence(t),library={...structuredClone(model.EMPTY_LIBRARY),designs:[model.createBlankDesign("Keep modern fields","portrait")]};
 library.designs[0].tags=["modern"];const first=await store.saveEditorLibrary("owner",library,null);
 const api=route({kind:"owner",ownerKey:"owner"},store);
 const response=await api.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({library:{...first.library,version:1,designs:[]},revision:first.revision})}));
 assert.equal(response.status,426);assert.deepEqual((await store.getEditorLibrary("owner")).library.designs[0].tags,["modern"]);
 const other=route({kind:"owner",ownerKey:"new-owner"},store);
 const migrated=await other.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({library:{...library,version:1},revision:null})}));
 assert.equal(migrated.status,200);assert.equal((await store.getEditorLibrary("new-owner")).library.version,2);
});
