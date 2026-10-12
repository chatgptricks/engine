import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(file,deps={}){const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const unit={exports:{}};vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name=>deps[name],unit,unit.exports);return unit.exports;}
const geometry=load('lib/template-editor/canvas-geometry.ts');
const commands=load('lib/template-editor/commands.ts',{'./model':{},'./canvas-geometry':geometry});
const {snapMove,snapPoint,translateElements}=load('lib/template-editor/snapping.ts',{'./canvas-geometry':geometry,'./commands':commands});
const element=(id,x,y=0,width=20,height=20)=>({id,x,y,width,height,rotation:0,locked:false,hidden:false});
const config=(overrides={})=>({enabled:true,objects:false,page:false,guides:false,grid:false,spacing:false,tolerance:6,...overrides});
const options={width:360,height:450,scale:1};
test('moving edges and centers snap to other artwork while hidden and selected layers are excluded',()=>{
 const scene={background:'#fff',elements:[element('moving',50),element('fixed',100),{...element('hidden',97),hidden:true}],layout:{snapping:config({objects:true})}};
 const result=snapMove(scene,['moving'],geometry.elementVisualBounds(scene.elements[0]),{x:28,y:0},options);
 assert.equal(result.delta.x,30);assert.equal(result.guides.find(g=>g.axis==='x').position,100);
});
test('snap tolerance stays constant in screen pixels and bypass leaves requested motion untouched',()=>{
 const scene={elements:[],layout:{guides:[{id:'g',axis:'x',position:100}],snapping:config({guides:true})}};
 const bounds={x:96,y:50,width:0,height:0};
 assert.equal(snapMove(scene,[],bounds,{x:0,y:0},options).delta.x,4);
 assert.equal(snapMove(scene,[],bounds,{x:0,y:0},{...options,scale:2}).delta.x,0);
 assert.deepEqual(snapMove(scene,[],bounds,{x:1,y:2},{...options,disabled:true}),{delta:{x:1,y:2},guides:[]});
});
test('continuous carousels snap to each slide center and margins rather than only the global center',()=>{
 const scene={elements:[],layout:{snapping:config({page:true}),margins:{enabled:true,left:24,right:24,top:30,bottom:30}}};
 const center=snapPoint(scene,[],{x:539,y:122},{...options,width:1080,slideWidth:360});
 assert.equal(center.delta.x,1);assert.equal(center.guides.find(g=>g.axis==='x').position,540);
 const margin=snapPoint(scene,[],{x:383,y:122},{...options,width:1080,slideWidth:360});
 assert.equal(margin.delta.x,1);assert.equal(margin.guides.find(g=>g.axis==='x').position,384);
});
test('equal-gap guides center artwork between neighbors and expose the actual export-pixel gap',()=>{
 const scene={elements:[element('left',0),element('right',100),element('moving',49)],layout:{snapping:config({spacing:true})}};
 const result=snapMove(scene,['moving'],geometry.elementVisualBounds(scene.elements[2]),{x:0,y:0},options);
 assert.equal(result.delta.x,1);assert.match(result.guides.find(g=>g.axis==='x').label,/90 px equal gap/);
});
test('axis constraints never introduce translation along the perpendicular axis',()=>{
 const scene={elements:[],layout:{guides:[{id:'x',axis:'x',position:100},{id:'y',axis:'y',position:100}],snapping:config({guides:true})}};
 const result=snapMove(scene,[],{x:99,y:99,width:0,height:0},{x:0,y:0},{...options,axis:'x'});
 assert.deepEqual(result.delta,{x:1,y:0});assert.equal(result.guides.length,1);
});
test('grid snapping aligns to canonical grid steps without dependence on zoom',()=>{
 const scene={elements:[],layout:{grid:{enabled:true,size:8,columns:1,rows:1,gutter:0},snapping:config({grid:true})}};
 const result=snapPoint(scene,[],{x:63,y:79},options);assert.deepEqual(result.delta,{x:1,y:1});
});
test('moving a selection at persistence limits preserves its relative distances',()=>{
 const source=[element('a',9990,20),element('b',10000,40)];const result=translateElements(source,{x:50,y:-10030});
 assert.equal(result[1].x-result[0].x,10);assert.equal(result[1].y-result[0].y,20);assert.equal(result[1].x,10000);assert.equal(result[0].y,-10000);assert.equal(source[0].x,9990);
});

test('inherited-hidden groups and fully clipped artwork do not attract snaps',()=>{
 const scene={elements:[element('moving',80,50),{...element('hidden-group',101,50),groupId:'g'},{...element('clipped',103,50),clipBounds:{x:300,y:300,width:30,height:30}}],groups:[{id:'g',name:'Hidden',hidden:true}],layout:{snapping:config({objects:true})}};
 const requested={x:0,y:0};
 const result=snapMove(scene,['moving'],geometry.elementVisualBounds(scene.elements[0]),requested,options);
 assert.deepEqual(result.delta,requested);assert.equal(result.guides.length,0);
});
