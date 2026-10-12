import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file){const source=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const unit={exports:{}};vm.runInThisContext(`(function(module,exports){${source}\n})`)(unit,unit.exports);return unit.exports;}
const sync=load("lib/template-editor/library-sync.ts"),model=load("lib/template-editor/model.ts");
test("three-way merges preserve disjoint edits and copy divergent documents without sharing mutable data",()=>{
 const base={...structuredClone(model.EMPTY_LIBRARY),designs:[model.createBlankDesign("Original","portrait")]},mine=structuredClone(base),remote=structuredClone(base);
 mine.designs[0].name="Local";remote.designs[0].name="Remote";
 const result=sync.reconcileLibraries(base,mine,remote);
 assert.equal(result.copies,1);assert.equal(result.library.designs.length,2);assert.equal(result.library.designs[0].name,"Remote");
 const copy=result.library.designs[1];assert.notEqual(copy.id,mine.designs[0].id);copy.pages[0].style.heading="Independent";assert.notEqual(mine.designs[0].pages[0].style.heading,"Independent");
 assert.ok(model.parseLibrary(result.library));
});
test("packing deduplicates URL assets while ordinary text containing the asset prefix stays literal",async()=>{
 const src="data:image/png;base64,iVBORw0KGgo=",value={images:[{src},{src}],text:"engine-asset:literal"};
 const packed=await sync.packAssets(value);assert.equal(Object.keys(packed.assets).length,1);assert.deepEqual(sync.unpackAssets(packed.value,packed.assets),value);
 assert.throws(()=>sync.unpackAssets(packed.value,{}),/missing/);
});

test("nested shape photo fills share assets with image layers while crop edits change the entity hash",async()=>{
 const src="data:image/webp;base64,UklGRg==",value={id:"shape-doc",elements:[{type:"image",src},{type:"shape",imageFill:{src,objectFit:"cover",cropX:50,cropY:50,cropScale:1}}]};
 const packed=await sync.packAssets(value);assert.equal(Object.keys(packed.assets).length,1);
 assert.equal(packed.value.elements[0].src,packed.value.elements[1].imageFill.src);
 assert.deepEqual(sync.unpackAssets(packed.value,packed.assets),value);
 const existing=await sync.packAssets(value,new Set(Object.keys(packed.assets)));assert.deepEqual(existing.assets,{});
 const changed=structuredClone(value);changed.elements[1].imageFill.cropScale=1.25;
 assert.notEqual(await sync.contentHash(changed),await sync.contentHash(value));
 assert.throws(()=>sync.unpackAssets(packed.value,{}),/missing/);
});

test("entity revisions remain stable when schema parsing changes object key order",async()=>{
 const first={id:"item",name:"Name",metadata:{favorite:true,tags:["one"]}},second={metadata:{tags:["one"],favorite:true},name:"Name",id:"item"};
 assert.equal(await sync.contentHash(first),await sync.contentHash(second));
 assert.equal(sync.sameContent(first,second),true);
});

test("conflict copies cannot inherit public review tokens owned by the original design",()=>{
 const doc=model.createBlankDesign("Original","portrait");doc.reviewLinks=[{id:"review-link",url:"/engine/review/"+"a".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}];
 const base={...structuredClone(model.EMPTY_LIBRARY),designs:[doc]},mine=structuredClone(base),remote=structuredClone(base);mine.designs[0].name="Local";remote.designs[0].name="Remote";
 const merged=sync.reconcileLibraries(base,mine,remote).library;
 assert.equal(merged.designs[0].reviewLinks.length,1);assert.equal(merged.designs[1].reviewLinks,undefined);
});
