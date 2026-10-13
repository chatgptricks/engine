import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {inflateSync} from 'node:zlib';
import sharp from 'sharp';
import {PDFDocument,PDFName,PDFDict,PDFArray} from 'pdf-lib';
const root=fileURLToPath(new URL('..',import.meta.url)),native=createRequire(import.meta.url);
function load(file,dependencies={},cache=new Map()){
 if(cache.has(file))return cache.get(file);const filename=path.join(root,file),source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,unit={exports:{}};cache.set(file,unit.exports);
 vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>Object.hasOwn(dependencies,name)?dependencies[name]:name.startsWith('./')?load(path.relative(root,path.resolve(path.dirname(filename),name+'.ts')),dependencies,cache):native(name),unit,unit.exports);return unit.exports;
}
const model=load('lib/template-editor/model.ts');
const basic=()=>{const design=model.createBlankDesign('Print proof','portrait');design.pages[0].canvas={background:'#fff',elements:[{...model.createCanvasElement('text'),id:'first',text:'First café — selectable',x:20,y:20,width:320,height:70,fontSize:18,letterSpacing:0},{...model.createCanvasElement('text'),id:'second',text:'Second',x:20,y:100,width:300,height:70,fontSize:18,letterSpacing:0},{...model.createCanvasElement('shape'),id:'box',x:20,y:200,width:100,height:80,fill:'#ef2233',opacity:1}]};return design;};
const renderer=dependencies=>load('lib/template-editor/pdf-document.ts',{'./review-assets':{fetchReviewImage:async()=>{throw Error('Unexpected external fetch');}},...dependencies});
test('tagged vector PDF embeds fonts, physical page size, trim and bleed boxes',async()=>{
 const design=basic(),bytes=await renderer().renderDocumentPdf(design,design.pages[0].id,{widthMm:100,bleedMm:3,cropMarks:true},'owner'),pdf=await PDFDocument.load(bytes),page=pdf.getPage(0);
 assert.equal(pdf.getPageCount(),1);assert.ok(Math.abs(page.getWidth()-(106*72/25.4+18))<.01);assert.ok(Math.abs(page.getTrimBox().width-100*72/25.4)<.01);assert.ok(Math.abs(page.getBleedBox().width-106*72/25.4)<.01);
 assert.ok(pdf.catalog.get(PDFName.of('StructTreeRoot')));const fonts=page.node.Resources().lookup(PDFName.of('Font'),PDFDict);assert.ok(fonts.keys().length>0);
 const font=fonts.lookup(fonts.keys()[0],PDFDict),descendant=font.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),descriptor=descendant.lookup(PDFName.of('FontDescriptor'),PDFDict);assert.ok(descriptor.get(PDFName.of('FontFile2'))||descriptor.get(PDFName.of('FontFile3')));assert.ok(font.get(PDFName.of('ToUnicode')));
});
test('multipage PDF keeps explicit public reading order and page descriptions',async()=>{
 const design=basic();design.pages[0].publicDescription='Cover for assistive reading';design.pages[0].readingOrder=['second','first'];design.pages.push({...structuredClone(design.pages[0]),id:crypto.randomUUID(),publicDescription:'Second page'});
 const bytes=await renderer().renderDocumentPdf(design,design.pages.map(page=>page.id),{widthMm:100},'owner'),pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),2);
 const tree=pdf.catalog.lookup(PDFName.of('StructTreeRoot'),PDFDict),document=tree.lookup(PDFName.of('K'),PDFArray).lookup(0,PDFDict),section=document.lookup(PDFName.of('K'),PDFArray).lookup(0,PDFDict),paragraphs=section.lookup(PDFName.of('K'),PDFArray);
 assert.equal(section.get(PDFName.of('Alt')).decodeText(),'Cover for assistive reading');assert.equal(paragraphs.lookup(0,PDFDict).get(PDFName.of('ActualText')).decodeText(),'Second');assert.equal(paragraphs.lookup(1,PDFDict).get(PDFName.of('ActualText')).decodeText(),'First café — selectable');
});
test('complex visual effects require a rendered snapshot; fallback retains semantic text',async()=>{
 const design=basic();design.pages[0].canvas.elements[0].shadow={color:'#000',blur:5,offsetX:0,offsetY:3,spread:0};const server=renderer();await assert.rejects(server.renderDocumentPdf(design,design.pages[0].id,{},'owner'),/snapshot/);
 const raster='data:image/png;base64,'+(await sharp({create:{width:360,height:450,channels:4,background:'#eeeeee'}}).png().toBuffer()).toString('base64'),bytes=await server.renderDocumentPdf(design,design.pages[0].id,{widthMm:100},'owner',raster),pdf=await PDFDocument.load(bytes);assert.ok(pdf.catalog.get(PDFName.of('StructTreeRoot')));assert.ok(pdf.getPage(0).node.Resources().get(PDFName.of('Font')));assert.ok(pdf.getPage(0).node.Resources().get(PDFName.of('XObject')));
});
test('valid 48MP original image is downsampled for PDF instead of rejected',async()=>{
 const design=basic(),data=await sharp({create:{width:8000,height:6000,channels:3,background:'#3377aa'}}).jpeg().toBuffer(),asset={id:'a'.repeat(64),data,mimeType:'image/jpeg',width:8000,height:6000,bytes:data.length,name:'Original'};let reads=0;
 design.pages[0].canvas.elements=[{...model.createCanvasElement('image'),src:'/api/template-editor/assets/'+asset.id,x:0,y:0,width:360,height:450,fit:'cover',cropX:30,cropY:70,cropScale:2,flipX:true}];
 const bytes=await renderer({'./media-storage':{readOriginalAsset:async(owner,id)=>{assert.equal(owner,'owner');assert.equal(id,asset.id);reads++;return asset;}}}).renderDocumentPdf(design,design.pages[0].id,{widthMm:100,dpi:72},'owner'),pdf=await PDFDocument.load(bytes),objects=pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'),PDFDict);assert.equal(reads,1);const image=objects.lookup(objects.keys()[0]);assert.ok(image.dict.get(PDFName.of('Width')).asNumber()<1000);assert.ok(bytes.length<30000);
});
test('document export observes pre-aborted cancellation and rejects duplicate page IDs',async()=>{
 const design=basic(),controller=new AbortController();controller.abort(Error('Cancelled by test'));await assert.rejects(renderer().renderDocumentPdf(design,design.pages[0].id,{},'owner',undefined,controller.signal),/Cancelled/);await assert.rejects(renderer().renderDocumentPdf(design,[design.pages[0].id,design.pages[0].id],{},'owner'),/distinct/);
});

test('PDF clipping never removes an entire semantic line from a short text box',async()=>{
 const design=basic();design.pages[0].canvas.elements=[{...model.createCanvasElement('text'),text:'History follows the edited page',x:10,y:10,width:200,height:22,fontSize:20,lineHeight:1,letterSpacing:0}];
 for(const raster of [false,true]){
  const snapshot=raster?'data:image/png;base64,'+(await sharp({create:{width:360,height:450,channels:4,background:'#fff'}}).png().toBuffer()).toString('base64'):undefined;
  const bytes=await renderer().renderDocumentPdf(design,design.pages[0].id,{pdfMode:raster?'raster':'document'},'owner',snapshot),pdf=await PDFDocument.load(bytes),fonts=pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'),PDFDict),font=fonts.lookup(fonts.keys()[0],PDFDict),unicode=font.lookup(PDFName.of('ToUnicode')),cmap=inflateSync(unicode.contents).toString();
  for(const char of ['d','p','a','g'])assert.ok(cmap.includes(char.charCodeAt(0).toString(16).padStart(4,'0')),`${char} was clipped from ${raster?'raster':'vector'} text`);
 }
});


test('all bundled font families embed composite glyphs in regular and bold PDF text',async()=>{
 const server=renderer();
 for(const font of ['sans','libre','playfair','dmserif','lora','cormorant','crimson','inter','space','montserrat','bebas','plexmono','caveat','walsheim','walsheimcond','kyoto','century'])for(const fontWeight of [400,700]){
  const design=basic();design.pages[0].canvas.elements=[{...design.pages[0].canvas.elements[0],font,fontWeight,text:'Café déjà vu — mañana',width:320,height:100}];
  const bytes=await server.renderDocumentPdf(design,design.pages[0].id,{widthMm:100},'owner'),pdf=await PDFDocument.load(bytes),fonts=pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'),PDFDict),embedded=fonts.lookup(fonts.keys()[0],PDFDict);
  assert.ok(embedded.get(PDFName.of('ToUnicode')),`${font} ${fontWeight} keeps selectable text`);
  if(!['sans','walsheim','walsheimcond','kyoto','century'].includes(font))assert.doesNotMatch(embedded.get(PDFName.of('BaseFont')).toString(),/Geist/,`${font} ${fontWeight} keeps its original font`);
 }
 for(const fontWeight of [400,700]){
  const design=basic();design.pages[0].canvas.elements=[{...design.pages[0].canvas.elements[0],font:'libre',fontWeight,italic:true,text:'Café déjà vu'}];
  const bytes=await server.renderDocumentPdf(design,design.pages[0].id,{widthMm:100},'owner');assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
 }
});
