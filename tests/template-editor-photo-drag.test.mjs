import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file,dependencies={}) {
  const source=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const unit={exports:{}};vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error(`Unexpected dependency: ${name}`);},unit,unit.exports);return unit.exports;
}
const model=load("lib/template-editor/model.ts"),drag=load("lib/template-editor/photo-drag.ts",{"./model":model});
const photo=()=>({src:"https://images.example/photo.webp",alt:"Hero photo",objectFit:"cover",cropX:24,cropY:76,cropScale:1.75,flipX:true,flipY:false,intrinsicWidth:1800,intrinsicHeight:1200,directive:"Private framing instructions",rightsNote:"Licensed artwork",sourceUrl:"https://source.example/photo",provenance:{source:"research",imageId:"photo-image",description:"Original photo description",cosmosManual:true}});

test("photo drag preserves validated crop, dimensions and private provenance in an independent canonical copy",()=>{
  const original=photo(),encoded=drag.encodePhotoDrag(original),decoded=drag.decodePhotoDrag(encoded);
  assert.deepEqual(decoded,original);assert.notEqual(decoded,original);assert.notEqual(decoded.provenance,original.provenance);
  decoded.cropX=50;decoded.provenance.description="Changed after drop";
  assert.equal(original.cropX,24);assert.equal(original.provenance.description,"Original photo description");
  assert.equal(drag.decodePhotoDrag(drag.encodePhotoDrag({...original,objectFit:"contain"})).objectFit,"contain");
});

test("photo drag refuses unsafe URLs, incomplete fields and invalid crop data",()=>{
  for(const src of ["javascript:alert(1)","data:text/html;base64,PHNjcmlwdD4=","https://user:secret@images.example/photo.png","//images.example/photo.png","/api/engine/img?u=%2Fprivate"]) {
    assert.equal(drag.decodePhotoDrag(JSON.stringify({...photo(),src})),null,src);
    assert.throws(()=>drag.encodePhotoDrag({...photo(),src}),/valid photo/);
  }
  for(const field of ["src","objectFit","cropX","cropY"]) {
    const incomplete=photo();delete incomplete[field];assert.equal(drag.decodePhotoDrag(JSON.stringify(incomplete)),null,field);
  }
  for(const change of [{cropX:-1},{cropY:101},{cropScale:0},{cropScale:Infinity},{objectFit:"stretch"},{intrinsicWidth:0},{sourceUrl:"https://owner:secret@source.example"}]) assert.equal(drag.decodePhotoDrag(JSON.stringify({...photo(),...change})),null);
  for(const malformed of ["","not json","null","[]","{}",'"ordinary link"'])assert.equal(drag.decodePhotoDrag(malformed),null);
});

test("photo drag rejects prototype payloads without changing global object properties",()=>{
  for(const key of ["__proto__","constructor","prototype"]) {
    const value=photo();Object.defineProperty(value,key,{value:{enginePhotoPolluted:true},enumerable:true});
    assert.equal(drag.decodePhotoDrag(JSON.stringify(value)),null,key);assert.throws(()=>drag.encodePhotoDrag(value),/valid photo/);
    const nested=photo();Object.defineProperty(nested.provenance,key,{value:{enginePhotoPolluted:true},enumerable:true});assert.equal(drag.decodePhotoDrag(JSON.stringify(nested)),null,`nested ${key}`);
  }
  assert.throws(()=>drag.encodePhotoDrag(Object.create(photo())),/valid photo/);
  assert.equal(Object.prototype.enginePhotoPolluted,undefined);
});

test("photo drag rejects oversized payloads consistently when encoding and decoding",()=>{
  assert.equal(drag.decodePhotoDrag(" ".repeat(2_100_001)),null);
  const image="data:image/png;base64,"+Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n","latin1"),Buffer.alloc(1_600_000)]).toString("base64");
  assert.ok(model.parseShapeImageFill({...photo(),src:image}));
  assert.throws(()=>drag.encodePhotoDrag({...photo(),src:image}),/too large to drag/);
  assert.equal(drag.decodePhotoDrag(JSON.stringify({...photo(),src:image})),null);
});

test("DataTransfer uses the custom photo MIME with copy semantics and a full payload round trip",()=>{
  const items=new Map([["text/plain","ordinary clipboard text"]]);
  const transfer={effectAllowed:"uninitialized",setData(type,value){items.set(type,value);},getData(type){return items.get(type)??"";}};
  drag.writePhotoDrag(transfer,photo());
  assert.equal(transfer.effectAllowed,"copy");assert.equal(transfer.getData("text/plain"),"ordinary clipboard text");
  assert.deepEqual(drag.decodePhotoDrag(transfer.getData(drag.PHOTO_DRAG_TYPE)),photo());
  assert.equal(drag.decodePhotoDrag(transfer.getData("text/plain")),null);
});
