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
        : name.startsWith('./') ? loadModule(path.relative(root,path.resolve(path.dirname(filename),name+'.ts')),dependencies,environment) : requireModule(name),
    unit,
    unit.exports,
    environment,
  );
  return unit.exports;
}

const model = loadModule("lib/template-editor/model.ts");
const templateCatalog = loadModule("lib/template-editor/template-catalog.ts", {"./model":model});
const librarySync = loadModule("lib/template-editor/library-sync.ts", {"./model":model,"./template-catalog":templateCatalog});
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
      "./library-sync": librarySync,
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
  const stats = {reads: 0, projections: []};
  return {
    rows,
    stats,
    from(table) {
      assert.equal(table, "gf_client_state");
      const conditions = new Map();
      let update = null;
      let projection;
      const query = {
        select(columns) {
          projection = columns;
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
          stats.reads++;
          stats.projections.push(projection);
          if (projection === "library:data->library,revision:data->>revision,assets:data->assets") return {data: row ? structuredClone({library: row.data.library, revision: row.data.revision, assets: row.data.assets}) : null, error: null};
          return { data: row ? structuredClone(row) : null, error: null };
        },
      };
      return query;
    },
  };
}

test('server review inventory enforces quota across concurrent instances and retries',async()=>{
 const db=fakeDatabase(),deps={'@/lib/supabase/admin':{getAdminSupabase:()=>db}},one=loadModule('lib/template-editor/review-inventory.ts',deps),two=loadModule('lib/template-editor/review-inventory.ts',deps),expires=new Date(Date.now()+86400000).toISOString();
 for(let index=0;index<19;index++){const link=await one.reserveReview('owner','design',index.toString(16).padStart(64,'0'),expires,'op-'+index);await one.activateReview('owner',link.id);}
 const results=await Promise.allSettled([one.reserveReview('owner','design','a'.repeat(64),expires,'concurrent-A'),two.reserveReview('owner','design','b'.repeat(64),expires,'concurrent-B')]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.match(results.find(result=>result.status==='rejected').reason.message,/20-review/);
 const winner=results.find(result=>result.status==='fulfilled').value;await two.activateReview('owner',winner.id);const retry=await one.reserveReview('owner','design','c'.repeat(64),expires,winner.operationId);assert.equal(retry.id,winner.id);assert.equal((await one.listReviewLinks('owner','design')).length,20);assert.equal((await one.listReviewLinks('different-owner')).length,0);
 await one.markReviewRevoked('owner',winner.token);assert.equal(await two.reviewIsActive('owner',winner.id),false);const replacement=await one.reserveReview('owner','design','d'.repeat(64),expires,'replacement');assert.notEqual(replacement.id,winner.id);
});

test('review inventory corruption fails closed instead of resetting server quota',async()=>{
 const db=fakeDatabase(),owner='owner',hash=requireModule('node:crypto').createHash('sha256').update(owner).digest('hex');db.rows.set('template-review-index:'+hash,{owner:'template-review-index:'+hash,data:{revision:'bad',links:'damaged'}});
 const inventory=loadModule('lib/template-editor/review-inventory.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>db}});await assert.rejects(inventory.listReviewLinks(owner),/damaged/);assert.equal(db.rows.get('template-review-index:'+hash).data.links,'damaged');
});

test('same review creation operation is atomic across independent server instances',async t=>{
 const db=fakeDatabase(),store=persistence(t,{db}),design=model.createBlankDesign('Atomic review','portrait');await store.saveEditorLibrary('owner',{...structuredClone(model.EMPTY_LIBRARY),designs:[design]},null);
 const deps={'@/lib/supabase/admin':{getAdminSupabase:()=>db},'./persistence':store,'./review-assets':{embedReviewImages:async value=>value}},one=loadModule('lib/template-editor/reviews.ts',deps),two=loadModule('lib/template-editor/reviews.ts',deps);
 const [a,b]=await Promise.all([one.createReview('owner',design.id,7,undefined,'same-operation'),two.createReview('owner',design.id,7,undefined,'same-operation')]);assert.equal(a.token,b.token);assert.ok(await one.getPublicReview(a.token));assert.equal((await one.listReviewLinks('owner',design.id)).length,1);
});

test('restoring old artwork cannot erase review inventory or reintroduce revoked tokens',async t=>{
 const db=fakeDatabase(),store=persistence(t,{db}),design=model.createBlankDesign('Inventory retained','portrait'),old={...structuredClone(model.EMPTY_LIBRARY),designs:[design]};let saved=await store.saveEditorLibrary('owner',old,null);
 const reviews=loadModule('lib/template-editor/reviews.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>db},'./persistence':store,'./review-assets':{embedReviewImages:async value=>value}}),created=await reviews.createReview('owner',design.id);
 assert.equal((await store.getEditorLibrary('owner')).library.designs[0].reviewLinks.length,1);saved=await store.saveEditorLibrary('owner',old,saved.revision);assert.equal((await store.getEditorLibrary('owner')).library.designs[0].reviewLinks.length,1);
 await reviews.revokeReview('owner',created.token);await store.saveEditorLibrary('owner',old,saved.revision);assert.deepEqual((await store.getEditorLibrary('owner')).library.designs[0].reviewLinks,[]);assert.equal(await reviews.getPublicReview(created.token),null);
});

test('thread resolution affects replies together and incremental feedback uses revisions',async t=>{
 const db=fakeDatabase(),store=persistence(t,{db}),design=model.createBlankDesign('Threaded review','portrait');await store.saveEditorLibrary('owner',{...structuredClone(model.EMPTY_LIBRARY),designs:[design]},null);
 const reviews=loadModule('lib/template-editor/reviews.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>db},'./persistence':store,'./review-assets':{embedReviewImages:async value=>value}}),link=await reviews.createReview('owner',design.id),first=await reviews.addReviewComment(link.token,{name:'A',text:'Move the title',pageId:design.pages[0].id,anchor:{x:.25,y:.75}});
 const row=[...db.rows.values()].find(row=>row.owner.startsWith('template-review:'));row.data.lastCommentAt=0;const reply=await reviews.addReviewComment(link.token,{name:'B',text:'Agreed',parentId:first.id,pageId:design.pages[0].id});const before=await reviews.getReviewFeedback(link.token);assert.equal((await reviews.getReviewFeedback(link.token,before.revision)).notModified,true);
 await assert.rejects(reviews.resolveReviewComment('other',link.token,first.id,true),/not found/);await reviews.resolveReviewComment('owner',link.token,reply.id,true);const after=await reviews.getReviewFeedback(link.token,before.revision);assert.ok(after.comments.every(comment=>comment.resolved));assert.equal(after.notModified,undefined);await reviews.resolveReviewComment('owner',link.token,first.id,false);assert.ok((await reviews.getPublicReview(link.token)).comments.every(comment=>!comment.resolved));
});

test('public reviews retain group compositing and intentional alt text while stripping preview and private metadata',()=>{
 const design=model.createBlankDesign('Accessible public','portrait'),image={...model.createCanvasElement('image'),src:'/template-editor/folds.svg',publicAlt:'Blue folded paper',previewSrc:'PRIVATE_PREVIEW',directive:'PRIVATE_PROMPT',groupId:'group'};design.pages[0].publicDescription='Cover description';design.pages[0].readingOrder=[image.id];design.pages[0].canvas={background:'#fff',groups:[{id:'group',name:'PRIVATE_GROUP',opacity:.4}],elements:[image]};
 const snapshot=loadModule('lib/template-editor/review-snapshot.ts').prepareReviewSnapshot(design),publicPage=snapshot.pages[0];assert.equal(publicPage.canvas.groups[0].opacity,.4);assert.equal(publicPage.canvas.elements[0].opacity,image.opacity);assert.equal(publicPage.canvas.elements[0].publicAlt,'Blue folded paper');assert.equal(publicPage.publicDescription,'Cover description');assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_'));
});

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

test("opening a cloud library projects artwork and assets without downloading CRDT state or history", async t => {
  const db = fakeDatabase(), store = persistence(t, {db});
  const document = model.createBlankDesign("Together", "portrait");
  const initial = await store.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs: [document]}, null);
  const room = await store.getCollaborationDocument("owner", document.id);
  db.stats.projections.length = 0;
  const opened = await store.getPackedEditorLibrary("owner");
  assert.equal(db.stats.projections[0], "library:data->library,revision:data->>revision,assets:data->assets");
  assert.equal(opened.revision, room.revision);
  assert.ok(librarySync.sameContent(librarySync.unpackAssets(opened.library, opened.assets), initial.library));
  assert.equal(db.rows.get("template-editor:owner").data.collaborationStates[document.id].state, room.state);
  db.stats.projections.length = 0;
  await store.getDocumentHistory("owner", document.id);
  assert.equal(db.stats.projections[0], "data", "History and write paths retain the complete stored envelope");
});

function route(access, store, env = {}) {
  return loadModule(
    "app/api/template-editor/route.ts",
    {
      "@/lib/engine/member": { resolveEngineAccess: async () => access },
      "@/lib/template-editor/model": model,
      "@/lib/template-editor/json-stream": loadModule("lib/template-editor/json-stream.ts"),
      "@/lib/template-editor/library-sync": librarySync,
      "@/lib/template-editor/persistence": store,
    },
    { env },
  );
}

test("API rejects unauthenticated reads and writes before touching storage", async () => {
  const api = route(null, {});
  assert.equal((await api.GET(new Request("https://engine.example/api/template-editor"))).status, 401);
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

test("packed GET is opt-in and round-trips 32 distinct image assets without changing workspace metadata", async t => {
  const sharp = requireModule("sharp");
  const images = await Promise.all(Array.from({length:32},async (_,index)=>`data:image/png;base64,${(await sharp({create:{width:2,height:2,channels:4,background:{r:index*7,g:255-index*5,b:index*3,alpha:1}}}).png().toBuffer()).toString("base64")}`));
  const design = model.createBlankDesign("Native images", "portrait");
  design.pages[0].image.url = images[0];
  design.pages[0].canvas.elements = images.map((src,index)=>model.createCanvasElement("image",{src,previewSrc:src,name:`Image ${index+1}`}));
  const store = persistence(t,{db:fakeDatabase()});
  await store.saveEditorLibrary("owner",{...structuredClone(model.EMPTY_LIBRARY),designs:[design]},null);
  const api = route({kind:"owner",ownerKey:"owner"},store);
  const plainResponse = await api.GET(new Request("https://engine.example/api/template-editor"));
  const packedResponse = await api.GET(new Request("https://engine.example/api/template-editor?packed=1"));
  assert.equal(plainResponse.status,200);assert.equal(packedResponse.status,200);
  assert.equal(packedResponse.headers.get("cache-control"),"private, no-store");
  const plain = await plainResponse.json(),packed = await packedResponse.json();
  assert.equal(Object.hasOwn(plain,"assets"),false);
  assert.deepEqual(plain.library.designs[0].pages[0].canvas.elements.map(element=>element.src),images);
  assert.equal(Object.keys(packed.assets).length,32);
  assert.equal(JSON.stringify(packed.library).includes("data:image/"),false);
  assert.deepEqual(librarySync.unpackAssets(packed.library,packed.assets),plain.library);
  for (const field of ["revision","storage","scope","assetKeys"]) assert.deepEqual(packed[field],plain[field],field);
  const history = await api.GET(new Request(`https://engine.example/api/template-editor?packed=1&history=1&documentId=${design.id}`));
  assert.deepEqual(await history.json(),{versions:[]});
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
        clientSchema:3,
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
  assert.equal((await api.PUT(request('{"library":{},"clientSchema":3}'))).status, 400);
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
    body: JSON.stringify({ clientSchema:3, library: newLibrary("Behind the proxy"), revision }),
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
  const sync = librarySync, store = persistence(t);
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

test("cloud patches read once per attempt while CAS preserves concurrent edits and operation retries", async t => {
  const db = fakeDatabase(), store = persistence(t, {db});
  const initial = await store.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs: [model.createBlankDesign("One", "portrait"), model.createBlankDesign("Two", "square")]}, null);
  const left = structuredClone(initial.library), right = structuredClone(initial.library);
  left.designs[0].name = "Left"; right.designs[1].name = "Right";
  const a = await librarySync.packAssets(await librarySync.createLibraryPatch(initial.library, left));
  const b = await librarySync.packAssets(await librarySync.createLibraryPatch(initial.library, right));
  db.stats.reads = 0;
  const operation = crypto.randomUUID();
  await store.saveEditorPatch("owner", a.value, a.assets, initial.revision, operation);
  assert.equal(db.stats.reads, 1);
  const saved = await store.saveEditorPatch("owner", b.value, b.assets, initial.revision, crypto.randomUUID());
  assert.deepEqual(saved.library.designs.map(document => document.name), ["Left", "Right"]);
  const retried = await store.saveEditorPatch("owner", a.value, a.assets, initial.revision, operation);
  assert.equal(retried.revision, saved.revision);
  const nextLeft = structuredClone(saved.library), nextRight = structuredClone(saved.library);
  nextLeft.designs[0].caption = "First writer"; nextRight.designs[1].caption = "Second writer";
  const c = await librarySync.packAssets(await librarySync.createLibraryPatch(saved.library, nextLeft));
  const d = await librarySync.packAssets(await librarySync.createLibraryPatch(saved.library, nextRight));
  await Promise.all([store.saveEditorPatch("owner", c.value, c.assets, saved.revision, crypto.randomUUID()), store.saveEditorPatch("owner", d.value, d.assets, saved.revision, crypto.randomUUID())]);
  assert.deepEqual((await store.getEditorLibrary("owner")).library.designs.map(document => document.caption), ["First writer", "Second writer"]);
});

test("heavy persistence work is serialized across separately loaded route modules", async t => {
  const db = fakeDatabase(), one = persistence(t, {db}), two = persistence(t, {db}), three = persistence(t, {db});
  const document = model.createBlankDesign("Together", "portrait"), other = model.createBlankDesign("Other", "square");
  await one.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs: [document, other]}, null);
  const room = await one.getCollaborationDocument("owner", document.id), initial = await one.getEditorLibrary("owner");
  const changed = structuredClone(initial.library); changed.designs[1].caption = "Queued edit";
  const patch = await librarySync.packAssets(await librarySync.createLibraryPatch(initial.library, changed));
  let active = 0, peak = 0;
  const from = db.from.bind(db);
  db.from = table => {
    const query = from(table), execute = query.maybeSingle.bind(query);
    query.maybeSingle = async () => {
      active++; peak = Math.max(peak, active);
      try { await new Promise(resolve => setImmediate(resolve)); return await execute(); }
      finally { active--; }
    };
    return query;
  };
  const results = await Promise.all([
    one.getEditorLibrary("owner"),
    two.getDocumentHistory("owner", document.id),
    three.getPackedEditorLibrary("owner"),
    one.saveEditorLibrary("owner", initial.library, initial.revision),
    two.saveEditorPatch("owner", patch.value, patch.assets, initial.revision, crypto.randomUUID()),
    three.getCollaborationDocument("owner", document.id),
    one.saveCollaborationDocument("owner", document.id, room.state, room.epoch),
  ]);
  assert.equal(peak, 1);
  assert.equal(results[2].scope, initial.scope);
  assert.ok(librarySync.sameContent(librarySync.unpackAssets(results[2].library, results[2].assets), initial.library));
  assert.equal((await two.getEditorLibrary("owner")).library.designs[1].caption, "Queued edit");
});

test("the shared persistence queue rejects excess work and releases slots after failures", async t => {
  const db = fakeDatabase(), one = persistence(t, {db}), two = persistence(t, {db});
  let release, entered, blocked = true, calls = 0;
  const held = new Promise(resolve => {release = resolve;}), started = new Promise(resolve => {entered = resolve;});
  const from = db.from.bind(db);
  db.from = table => {
    const query = from(table), execute = query.maybeSingle.bind(query);
    query.maybeSingle = async () => {calls++; if (blocked) {blocked = false; entered(); await held;} return execute();};
    return query;
  };
  const first = one.getDocumentHistory("owner", "missing");
  await started;
  const waiting = Array.from({length: 7}, (_, index) => (index % 2 ? one : two).getDocumentHistory("owner", "missing"));
  await assert.rejects(two.getDocumentHistory("owner", "missing"), error => error.name === "PersistenceBusyError" && /Cloud storage is busy/.test(error.message));
  assert.equal(calls, 1, "Rejected and queued jobs must not start another workspace read");
  release();
  await Promise.all([first, ...waiting]);
  const [failed, recovered] = await Promise.allSettled([one.getCollaborationDocument("owner", "missing"), two.getDocumentHistory("owner", "missing")]);
  assert.equal(failed.status, "rejected");
  assert.equal(recovered.status, "fulfilled");
  assert.deepEqual(recovered.value, []);
  assert.equal(await globalThis[Symbol.for("engine.template-editor.persistence.queue")].tail, undefined, "The global tail must not retain a workspace result");
});

test("queued cloud writes still rebase when another process wins the database CAS", async t => {
  const db = fakeDatabase(), store = persistence(t, {db});
  const initial = await store.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs: [model.createBlankDesign("Local", "portrait"), model.createBlankDesign("External", "square")]}, null);
  const changed = structuredClone(initial.library); changed.designs[0].caption = "Local edit";
  const patch = await librarySync.packAssets(await librarySync.createLibraryPatch(initial.library, changed));
  const from = db.from.bind(db); let raced = false;
  db.from = table => {
    const query = from(table), update = query.update.bind(query);
    query.update = value => {
      if (!raced) {
        raced = true;
        const external = structuredClone(db.rows.get("template-editor:owner"));
        external.data.revision = crypto.randomUUID();
        external.data.library.designs[1].caption = "External edit";
        db.rows.set("template-editor:owner", external);
      }
      return update(value);
    };
    return query;
  };
  const saved = await store.saveEditorPatch("owner", patch.value, patch.assets, initial.revision, crypto.randomUUID());
  assert.equal(raced, true);
  assert.deepEqual(saved.library.designs.map(document => document.caption), ["Local edit", "External edit"]);
});

test("collaboration snapshots retain only the requested document and workspace metadata", async t => {
  const db = fakeDatabase(), store = persistence(t, {db});
  const document = model.createBlankDesign("Together", "portrait"), unrelated = model.createBlankDesign("Elsewhere", "square");
  await store.saveEditorLibrary("owner", {...structuredClone(model.EMPTY_LIBRARY), designs: [document, unrelated]}, null);
  const snapshot = await store.getCollaborationDocument("owner", document.id);
  assert.equal(Object.hasOwn(snapshot, "library"), false);
  assert.equal(Object.hasOwn(snapshot, "assets"), false);
  assert.equal(Object.hasOwn(snapshot, "history"), false);
  assert.equal(snapshot.document.id, document.id);
  assert.equal(snapshot.scope, store.editorOwnerScope("owner"));
  assert.equal(snapshot.storage, "cloud");
  assert.ok(snapshot.state && snapshot.epoch && snapshot.revision);
});

test("patch operation retries are idempotent, same-document conflicts preserve server state, and checkpoints remain durable", async t => {
  const sync = librarySync, store = persistence(t);
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
  const sync = librarySync, db = fakeDatabase(), store = persistence(t, {db});
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
  const db=fakeDatabase(),store=persistence(t,{db}),sync=librarySync;
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
  const db = fakeDatabase(), store = persistence(t, {db}), sync = librarySync;
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
 const store=persistence(t),sync=librarySync;
 const ownerA=await store.saveEditorLibrary("owner-a",structuredClone(model.EMPTY_LIBRARY),null);
 const local=structuredClone(ownerA.library);local.designs.push(model.createBlankDesign("Private to A","portrait"));
 const packed=await sync.packAssets(await sync.createLibraryPatch(ownerA.library,local));
 const api=route({kind:"member",ownerKey:"owner-b"},store);
 const response=await api.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({patch:packed.value,assets:packed.assets,revision:ownerA.revision,expectedScope:ownerA.scope,clientSchema:3,operationId:crypto.randomUUID()})}));
 assert.equal(response.status,403);assert.equal((await response.json()).code,"workspace_owner_changed");
 assert.equal((await store.getEditorLibrary("owner-b")).library.designs.length,0);
 const ownApi=route({kind:"member",ownerKey:"owner-a"},store);
 const accepted=await ownApi.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({patch:packed.value,assets:packed.assets,revision:ownerA.revision,expectedScope:ownerA.scope,clientSchema:3,operationId:crypto.randomUUID()})}));
 assert.equal(accepted.status,200);assert.equal((await store.getEditorLibrary("owner-a")).library.designs[0].name,"Private to A");
});

test("legacy clients cannot overwrite a schema-two workspace but first legacy imports migrate safely", async t => {
 const store=persistence(t),library={...structuredClone(model.EMPTY_LIBRARY),designs:[model.createBlankDesign("Keep modern fields","portrait")]};
 library.designs[0].tags=["modern"];const first=await store.saveEditorLibrary("owner",library,null);
 const api=route({kind:"owner",ownerKey:"owner"},store);
 const response=await api.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({clientSchema:3,library:{...first.library,version:1,designs:[]},revision:first.revision})}));
 assert.equal(response.status,426);assert.deepEqual((await store.getEditorLibrary("owner")).library.designs[0].tags,["modern"]);
 const other=route({kind:"owner",ownerKey:"new-owner"},store);
 const migrated=await other.PUT(new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify({clientSchema:3,library:{...library,version:1},revision:null})}));
 assert.equal(migrated.status,200);assert.equal((await store.getEditorLibrary("new-owner")).library.version,2);
});

test("built-in template deletion survives older document patches, cloud reloads and operation retries",async t=>{
  const db=fakeDatabase(),store=persistence(t,{db}),sync=librarySync;
  const template=model.BUILT_IN_TEMPLATES[0],design=model.createDesign(template);
  const initial=await store.saveEditorLibrary("owner",{...structuredClone(model.EMPTY_LIBRARY),designs:[design]},null);
  const removed=structuredClone(initial.library),deletedAt="2026-10-12T10:00:00.000Z";
  removed.builtInTemplateStates=[{id:template.id,updatedAt:deletedAt,deletedAt}];
  const deletion=await sync.packAssets(await sync.createLibraryPatch(initial.library,removed)),deleteId=crypto.randomUUID();
  await store.saveEditorPatch("owner",deletion.value,deletion.assets,initial.revision,deleteId);
  // An older schema-2 editor knows the document but not catalog decisions.
  const older=structuredClone(initial.library);older.designs[0].name="Updated in the older tab";
  const documentPatch=await sync.packAssets(await sync.createLibraryPatch(initial.library,older)),documentId=crypto.randomUUID();
  assert.equal(documentPatch.value.collections.builtInTemplateStates,undefined);
  const merged=await store.saveEditorPatch("owner",documentPatch.value,documentPatch.assets,initial.revision,documentId);
  assert.equal(merged.reconciled,true);assert.deepEqual(merged.library.builtInTemplateStates,removed.builtInTemplateStates);
  assert.equal(merged.library.designs[0].name,"Updated in the older tab");assert.equal(merged.library.designs[0].id,design.id);assert.equal(merged.library.templates.length,0);
  const retried=await store.saveEditorPatch("owner",deletion.value,deletion.assets,initial.revision,deleteId);
  assert.equal(retried.revision,merged.revision);assert.equal(retried.library.designs[0].name,"Updated in the older tab");
  const purged=structuredClone(merged.library);purged.builtInTemplateStates=[{...purged.builtInTemplateStates[0],updatedAt:"2026-10-12T10:01:00.000Z",permanentlyDeleted:true}];
  const purge=await sync.packAssets(await sync.createLibraryPatch(merged.library,purged));
  const saved=await store.saveEditorPatch("owner",purge.value,purge.assets,merged.revision,crypto.randomUUID());
  const oldRetry=await store.saveEditorPatch("owner",documentPatch.value,documentPatch.assets,initial.revision,documentId);
  assert.equal(oldRetry.revision,saved.revision);assert.equal(oldRetry.library.builtInTemplateStates[0].permanentlyDeleted,true);
  assert.deepEqual((await store.getEditorLibrary("owner")).library.builtInTemplateStates,purged.builtInTemplateStates);
  assert.deepEqual(db.rows.get("template-editor:owner").data.library.builtInTemplateStates,purged.builtInTemplateStates);
});

test("older schema-two whole-library saves preserve catalog decisions and current clients can restore explicitly",async t=>{
  const db=fakeDatabase(),store=persistence(t,{db}),template=model.BUILT_IN_TEMPLATES[0],date="2026-10-12T11:00:00.000Z";
  const initial={...structuredClone(model.EMPTY_LIBRARY),designs:[model.createDesign(template)],builtInTemplateStates:[{id:template.id,updatedAt:date,deletedAt:date,permanentlyDeleted:true}]};
  assert.equal(model.EMPTY_LIBRARY.builtInTemplateStates,undefined);
  assert.equal(model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY)}).builtInTemplateStates,undefined);
  const first=await store.saveEditorLibrary("owner",initial,null),api=route({kind:"owner",ownerKey:"owner"},store);
  const oldLibrary=structuredClone(first.library);delete oldLibrary.builtInTemplateStates;oldLibrary.designs[0].name="Legacy full save";
  const operationId=crypto.randomUUID(),body={clientSchema:3,library:oldLibrary,revision:first.revision,operationId};
  const request=()=>new Request("http://localhost/api/template-editor",{method:"PUT",body:JSON.stringify(body)});
  const response=await api.PUT(request());assert.equal(response.status,200);
  const saved=await store.getEditorLibrary("owner");assert.deepEqual(saved.library.builtInTemplateStates,initial.builtInTemplateStates);assert.equal(saved.library.designs[0].name,"Legacy full save");
  assert.equal(oldLibrary.builtInTemplateStates,undefined);assert.equal((await api.PUT(request())).status,200);
  assert.equal((await store.getEditorLibrary("owner")).revision,saved.revision);
  const restored=structuredClone(saved.library);restored.builtInTemplateStates=[{id:template.id,updatedAt:"2026-10-12T11:01:00.000Z"}];
  const explicit=await store.saveEditorLibrary("owner",restored,saved.revision);assert.deepEqual(explicit.library.builtInTemplateStates,restored.builtInTemplateStates);assert.equal(explicit.library.designs[0].id,initial.designs[0].id);
});

test('large metadata patch without a merge baseline saves even when virtual review links changed',async t=>{
 const db=fakeDatabase(),store=persistence(t,{db}),design=model.createBlankDesign('Virtual inventory','portrait'),base={...structuredClone(model.EMPTY_LIBRARY),designs:[design]};const saved=await store.saveEditorLibrary('owner',base,null);
 const reviews=loadModule('lib/template-editor/reviews.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>db},'./persistence':store,'./review-assets':{embedReviewImages:async value=>value}});await reviews.createReview('owner',design.id);
 const visible=(await store.getEditorLibrary('owner')).library,next=structuredClone(visible);next.designs[0].name='Edited';const patch=await librarySync.createLibraryPatch(visible,next);delete patch.collections.designs[0].beforeValue;const result=await store.saveEditorPatch('owner',patch,{},saved.revision,crypto.randomUUID());assert.equal(result.library.designs[0].name,'Edited');
});
