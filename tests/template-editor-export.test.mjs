import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(fs.readFileSync(new URL("../lib/template-editor/export.ts", import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helperSource=ts.transpileModule(fs.readFileSync(new URL("../lib/template-editor/property-utils.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helper={exports:{}};vm.runInThisContext(`(function(module,exports){${helperSource}\n})`)(helper,helper.exports);
const unit = {exports:{}};
vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(()=>helper.exports,unit,unit.exports);
const {validateExportOptions, encodeImagePdf, fileName, preflightFrames} = unit.exports;
test("export settings reject invalid resolutions and quality and normalize alpha for opaque formats", () => {
  assert.equal(validateExportOptions({format:"png",transparent:true}).transparent,true);
  assert.equal(validateExportOptions({format:"jpeg",transparent:true}).transparent,false);
  assert.equal(validateExportOptions({format:"pdf",transparent:true}).transparent,false);
  for (const options of [{scale:0},{scale:25},{quality:0},{quality:2},{format:"unknown"}]) assert.throws(()=>validateExportOptions(options));
  assert.equal(fileName("Diseño café / 2026"),"diseno-cafe-2026");
});
test("multipage PDFs have correct page geometry, binary stream lengths and byte-accurate cross references", async () => {
  const image = new Uint8Array([255,216,128,129,255,217]);
  const pdf = encodeImagePdf([{data:image,width:1080,height:1350},{data:image,width:1080,height:1920}]);
  assert.equal(pdf.type,"application/pdf");
  const bytes = new Uint8Array(await pdf.arrayBuffer()), text = new TextDecoder("latin1").decode(bytes);
  assert.match(text,/\/Count 2/); assert.match(text,/\/MediaBox \[0 0 1080 1920\]/); assert.match(text,/\/Length 6/);
  const start = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(start,start+4)),"xref");
  const rows = text.slice(start).split("\n").slice(3,11);
  rows.forEach((row,index)=>{const offset=Number(row.slice(0,10)); assert.equal(new TextDecoder().decode(bytes.slice(offset,offset+`${index+1} 0 obj`.length)),`${index+1} 0 obj`);});
});
test("preflight cancellation stops before reading artwork or starting a download", async () => {
  const controller=new AbortController(); controller.abort();
  const original=globalThis.document; globalThis.document={fonts:{ready:Promise.resolve()}};
  try {await assert.rejects(preflightFrames([{offsetWidth:360,offsetHeight:450}],{signal:controller.signal}), error=>error.name==="AbortError");} finally {globalThis.document=original;}
});

test("preflight measures the painted contain area instead of its empty frame",async()=>{
 const oldDocument=globalThis.document,oldStyle=globalThis.getComputedStyle;
 const img={naturalWidth:300,naturalHeight:30,offsetWidth:300,offsetHeight:300,parentElement:null,decode:()=>Promise.resolve()};
 const frame={offsetWidth:360,offsetHeight:450,querySelectorAll:()=>[img]};img.parentElement=frame;
 globalThis.document={fonts:{ready:Promise.resolve()}};let fit="contain";
 globalThis.getComputedStyle=()=>({width:"300px",height:"300px",objectFit:fit,transform:"none"});
 try {assert.deepEqual(await preflightFrames([frame],{scale:1}),[]);fit="cover";assert.equal((await preflightFrames([frame],{scale:1})).length,1);} finally {globalThis.document=oldDocument;globalThis.getComputedStyle=oldStyle;}
});

test("texture preload images decode before export and measure their visible text range",async()=>{
 const oldDocument=globalThis.document,oldStyle=globalThis.getComputedStyle;
 const frame={offsetWidth:360,offsetHeight:450,querySelectorAll:()=>[img]},target={offsetWidth:20,offsetHeight:10,parentElement:frame,dataset:{textureId:"word-1"}};
 const layer={querySelector:()=>target,querySelectorAll:()=>[target]};let decoded=0;
 const img={naturalWidth:30,naturalHeight:30,offsetWidth:0,offsetHeight:0,parentElement:frame,dataset:{engineTexturePreload:"true",engineTextureId:"word-1",engineImageFit:"cover",engineImageCropScale:"1"},closest:()=>layer,decode:async()=>{decoded++;}};
 globalThis.document={fonts:{ready:Promise.resolve()}};globalThis.getComputedStyle=node=>({width:`${node.offsetWidth}px`,height:`${node.offsetHeight}px`,transform:"none"});
 try{
  assert.deepEqual(await preflightFrames([frame],{scale:1}),[]);assert.equal(decoded,1);
  img.dataset.engineImageCropScale="4";assert.equal((await preflightFrames([frame],{scale:1})).length,1);assert.equal(decoded,2);
  img.decode=async()=>{throw new Error("Missing texture");};await assert.rejects(preflightFrames([frame],{scale:1}),/image that could not load/);
 }finally{globalThis.document=oldDocument;globalThis.getComputedStyle=oldStyle;}
});

test('sequential batch exports release each rendered page and download bounded archives',async()=>{
 const previous={document:globalThis.document,URL:globalThis.URL,setTimeout:globalThis.setTimeout},steps=[],downloads=[];let frameIndex=0;
 class Zip{files=[];file(name,blob){this.files.push([name,blob]);return this;}async generateAsync(options){assert.equal(options.streamFiles,true);assert.equal(this.files.length,1);return new Blob(['ZIP'],{type:'application/zip'});}}
 const mock={exports:{}};vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name=>name==='./property-utils'?helper.exports:name==='modern-screenshot'?{domToBlob:async()=>{steps.push('capture'+frameIndex);return {size:40*1024*1024,type:'image/png'};}}:{default:Zip},mock,mock.exports);
 globalThis.document={fonts:{ready:Promise.resolve()},body:{appendChild(){}},createElement:()=>({click(){downloads.push(this.download);},remove(){}})};globalThis.URL={createObjectURL:()=>'',revokeObjectURL(){}};globalThis.setTimeout=(callback,delay,...args)=>{const timer=previous.setTimeout(callback,delay,...args);if(delay===30000)timer.unref?.();return timer;};
 try{await mock.exports.exportFrames([], 'Batch', '',()=>{}, {totalFrames:2,delivery:'batches',batchSize:1,getFrame:async index=>{frameIndex=index;steps.push('load'+index);return{offsetWidth:360,offsetHeight:450,style:{width:'360px',height:'450px'},querySelectorAll:()=>[]};}});assert.deepEqual(steps,['load0','capture0','load1','capture1']);assert.deepEqual(downloads,['batch-part-1.zip','batch-part-2.zip']);}
 finally{Object.assign(globalThis,previous);}
});

test('aggregate archive limit rejects before issuing any download',async()=>{
 const previous={document:globalThis.document,URL:globalThis.URL,setTimeout:globalThis.setTimeout};let downloads=0;
 const mock={exports:{}};vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name=>name==='./property-utils'?helper.exports:{domToBlob:async()=>({size:40*1024*1024,type:'image/png'})},mock,mock.exports);
 globalThis.document={fonts:{ready:Promise.resolve()},body:{appendChild(){}},createElement:()=>({click(){downloads++;},remove(){}})};globalThis.URL={createObjectURL:()=>'',revokeObjectURL(){}};globalThis.setTimeout=(callback,delay,...args)=>{const timer=previous.setTimeout(callback,delay,...args);if(delay===30000)timer.unref?.();return timer;};
 try{await assert.rejects(mock.exports.exportFrames([], 'Too big', '',()=>{}, {totalFrames:2,getFrame:async()=>({offsetWidth:360,offsetHeight:450,style:{width:'360px',height:'450px'},querySelectorAll:()=>[]})}),/64 MB/);assert.equal(downloads,0);}finally{Object.assign(globalThis,previous);}
});
