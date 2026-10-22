import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if(cache.has(filename))return cache.get(filename);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText;
  const unit={exports:{}};cache.set(filename,unit.exports);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>{
    if(name.endsWith(".css"))return {};
    if(name.startsWith("@/")||name.startsWith("./")||name.startsWith("../")){
      const base=name.startsWith("@/")?path.join(root,name.slice(2)):path.resolve(path.dirname(filename),name);
      const found=[base,`${base}.ts`,`${base}.tsx`].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
      if(found)return load(path.relative(root,found));
    }
    return name === "react" ? hooks.react : requireModule(name);
  },unit,unit.exports);
  return unit.exports;
}

// Drive the actual CanvasEditor handlers and layout effects without a browser.
// Hooks keep state across renders; fake surfaces track real capture ownership.
function hookHarness(){
 const slots=[];let cursor=0,pending=[];
 const ref=initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});};
 const state=initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==="function"?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==="function"?next(slots[index].value):next;}];};
 const effect=(work,deps)=>{const index=cursor++,previous=slots[index],changed=!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]));if(changed){slots[index]={deps};pending.push(()=>{previous?.cleanup?.();slots[index].cleanup=work();});}};
 return {react:{...React,useRef:ref,useState:state,useEffect:effect,useLayoutEffect:effect,useMemo:work=>{cursor++;return work();},useCallback:work=>{cursor++;return work;}},begin(){cursor=0;pending=[];},flush(){const effects=pending;pending=[];effects.forEach(work=>work());},reset(){slots.length=0;cursor=0;pending=[];}};
}
const hooks=hookHarness(),model=load("lib/template-editor/model.ts"),{CanvasEditor}=load("components/template-editor/canvas.tsx");
function find(tree,predicate){if(!tree||typeof tree!=="object")return undefined;if(predicate(tree))return tree;for(const child of React.Children.toArray(tree.props?.children??tree.children)){const matched=find(child,predicate);if(matched)return matched;}}
const surface=()=>{const captures=new Set();return {captures,focus(){},setPointerCapture(id){captures.add(id);},hasPointerCapture(id){return captures.has(id);},releasePointerCapture(id){captures.delete(id);},getBoundingClientRect(){return {left:0,top:0,width:360,height:480};},querySelectorAll(){return [];},closest(){return null;},addEventListener(){},removeEventListener(){}};};
const pointer=(capture,x,y)=>({pointerId:1,button:0,clientX:x,clientY:y,currentTarget:capture,preventDefault(){},stopPropagation(){}});

test("changing to Pen, Hand or Nodes cancels an in-flight resize and releases its pointer capture",()=>{
 const originalDocument=globalThis.document,originalWindow=globalThis.window;
 globalThis.document={addEventListener(){},removeEventListener(){},fonts:{addEventListener(){},removeEventListener(){}}};globalThis.window={getSelection(){return null;}};
 try{
  const stage=surface(),handle=surface(),element={...model.createCanvasElement("shape"),id:"box",x:10,y:20,width:100,height:80},source={background:"#fff",elements:[element]},changes=[];
  const props={scene:source,width:360,height:480,selectedIds:[element.id],onSelect(){},onChange(next){changes.push(next);return true;}};
  const render=extra=>{hooks.begin();const tree=CanvasEditor({...props,...extra});tree.props.ref.current=stage;hooks.flush();return tree;};
  for(const mode of [{drawingMode:"pen"},{navigationMode:"hand"},{navigationMode:"nodes"}]){
   const selected=render({navigationMode:"select"}),resize=find(selected,node=>node.props?.["aria-label"]==="Resize right");
   resize.props.onPointerDown(pointer(handle,110,60));selected.props.onPointerMove(pointer(stage,140,60));assert.equal(handle.hasPointerCapture(1),true);
   render(mode);const active=render(mode);assert.equal(handle.hasPointerCapture(1),false);active.props.onPointerUp(pointer(stage,140,60));assert.equal(changes.length,0);assert.equal(source.elements[0].width,100);
   assert.equal(find(active,node=>node.props?.["aria-label"]==="Resize right"),undefined);
   if(mode.navigationMode==="nodes")assert.ok(find(active,node=>node.type?.name==="VectorNodeEditor"),"Nodes retains its anchor editor after canceling the previous resize");
  }
  const selected=render({navigationMode:"select"}),resize=find(selected,node=>node.props?.["aria-label"]==="Resize right");resize.props.onPointerDown(pointer(handle,110,60));selected.props.onPointerMove(pointer(stage,140,60));selected.props.onPointerUp(pointer(stage,140,60));assert.equal(changes.length,1);assert.equal(changes[0].elements[0].width,130);assert.equal(handle.hasPointerCapture(1),false);
 }finally{globalThis.document=originalDocument;globalThis.window=originalWindow;}
});

test("text editing grows and shrinks naturally, docks its controls, and preserves accepted commit/cancel boundaries",()=>{
 const previous={document:globalThis.document,window:globalThis.window,HTMLElement:globalThis.HTMLElement,Element:globalThis.Element};
 class EditableSurface {
  nodeType=1;tagName="DIV";classList=[];naturalHeight=28;childNodes=[];
  style={fontSize:"20px",textDecoration:"",height:"",minHeight:"",maxHeight:""};
  get ownerDocument(){return globalThis.document;}
  get scrollHeight(){return this.naturalHeight;}
  get innerText(){return this.childNodes.map(node=>node.textContent).join("");}
  set innerHTML(value){const text=value.replace(/<\/div><div>/g,"\n").replace(/<br\s*\/?\s*>/g,"\n").replace(/<[^>]+>/g,"");this.childNodes=[{nodeType:3,textContent:text,parentElement:this}];}
  get innerHTML(){return this.innerText;}
  querySelectorAll(){return [];}
  getAttribute(){return null;}
  contains(node){return node===this||this.childNodes.includes(node);}
  focus(){globalThis.document.activeElement=this;}
 }
 globalThis.HTMLElement=EditableSurface;globalThis.Element=EditableSurface;
 globalThis.document={activeElement:null,defaultView:{getComputedStyle:node=>({height:`${node.naturalHeight}px`})},addEventListener(){},removeEventListener(){},fonts:{addEventListener(){},removeEventListener(){}},createRange(){return {selectNodeContents(){},collapse(){},cloneRange(){return this;}};}};
 globalThis.window={getSelection(){return {rangeCount:0,removeAllRanges(){},addRange(){}};}};
 hooks.reset();
 try{
  const stage=surface(),editable=new EditableSurface(),host={nodeType:1},original={...model.createTextBox({text:"Start",fontSize:20,width:180,height:28,rotation:30}),id:"copy"};
  let source={background:"#fff",elements:[original]},accept=true;
  const render=()=>{hooks.begin();const tree=CanvasEditor({scene:source,width:360,height:480,selectedIds:["copy"],textToolbarHost:host,onSelect(){},onChange(next){if(!accept)return false;source=next;return true;}});tree.props.ref.current=stage;const input=find(tree,node=>node.props?.["aria-label"]==="Edit text");if(input)input.props.ref.current=editable;hooks.flush();return tree;};
  const key=key=>({key,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,nativeEvent:{key,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,isComposing:false},preventDefault(){},stopPropagation(){}});
  const enter=()=>{find(render(),node=>node.props?.["data-layer-id"]==="copy").props.onKeyDown(key("Enter"));return render();};
  let tree=enter();
  const portal=find(tree,node=>node.containerInfo===host);assert.ok(portal,"Rich formatting is portaled outside the canvas");
  assert.equal(find(tree,node=>node.props?.className==="te-canvas-layer-label"),undefined,"No element name floats over active typing");
  editable.innerHTML="First\nSecond\nThird";editable.naturalHeight=76;
  find(tree,node=>node.props?.["aria-label"]==="Edit text").props.onInput();
  assert.equal(source.elements[0].height,76);assert.equal(source.elements[0].text,"First\nSecond\nThird");
  tree=render();editable.innerHTML="Short";editable.naturalHeight=28;find(tree,node=>node.props?.["aria-label"]==="Edit text").props.onInput();
  assert.equal(source.elements[0].height,28);assert.ok(Math.abs(source.elements[0].x-original.x)<1e-8);assert.ok(Math.abs(source.elements[0].y-original.y)<1e-8);
  tree=render();find(tree,node=>node.type==="button"&&node.props?.children==="Done").props.onClick();
  assert.equal(find(render(),node=>node.props?.["aria-label"]==="Edit text"),undefined);const committed=structuredClone(source);
  tree=enter();editable.innerHTML="Discard this";editable.naturalHeight=52;find(tree,node=>node.props?.["aria-label"]==="Edit text").props.onInput();tree=render();
  accept=false;find(tree,node=>node.props?.["aria-label"]==="Edit text").props.onKeyDown(key("Escape"));
  tree=render();assert.ok(find(tree,node=>node.props?.["aria-label"]==="Edit text"),"Rejected cancellation keeps the editor open");assert.equal(source.elements[0].text,"Discard this");
  accept=true;find(tree,node=>node.props?.["aria-label"]==="Edit text").props.onKeyDown(key("Escape"));
  assert.deepEqual(source,committed);assert.equal(find(render(),node=>node.props?.["aria-label"]==="Edit text"),undefined);
 }finally{Object.assign(globalThis,previous);hooks.reset();}
});
