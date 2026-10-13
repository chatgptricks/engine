import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
    return requireModule(name);
  },unit,unit.exports);
  return unit.exports;
}
const model=load("lib/template-editor/model.ts"), actions=load("lib/template-editor/editing-actions.ts"),advanced=load("lib/template-editor/advanced.ts"), vector=load("lib/template-editor/vector.ts"), nodes=load("lib/template-editor/vector-nodes.ts"),hit=load("lib/template-editor/canvas-hit-testing.ts"), crop=load("lib/template-editor/photo-crop-geometry.ts"),fit=load("lib/template-editor/text-fit.ts"),camera=load("lib/template-editor/view-gestures.ts"),registry=load("lib/template-editor/editor-commands.ts"),history=load("lib/template-editor/history.ts"),layers=load("components/template-editor/layers-panel.tsx"),canvas=load("components/template-editor/canvas.tsx"), opacity=load("lib/template-editor/group-opacity.ts");
const shape=(id,patch={})=>({...model.createCanvasElement("shape"),id,name:id,x:0,y:0,width:100,height:100,fill:"#000",stroke:"transparent",strokeWidth:0,...patch});
const text=(id,patch={})=>({...model.createCanvasElement("text"),id,name:id,...patch});
const scene=elements=>({background:"#fff",elements});
const near=(a,b,epsilon=.002)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const event=(key,patch={})=>({key,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,...patch});
function designOf(elements){const design=model.createBlankDesign("Regression","portrait");design.pages[0].canvas=scene(elements);return design;}
function world(shape,point){const [vx,vy,vw,vh]=(shape.viewBox??`0 0 ${shape.width} ${shape.height}`).split(/\s+/).map(Number),x=(point.x-vx)/vw*shape.width-shape.width/2,y=(point.y-vy)/vh*shape.height-shape.height/2,a=shape.rotation*Math.PI/180;return {x:shape.x+shape.width/2+x*Math.cos(a)-y*Math.sin(a),y:shape.y+shape.height/2+x*Math.sin(a)+y*Math.cos(a)};}

test("saving a named style propagates to linked pages and master before linking selection, atomically",()=>{
 const linked=text("linked",{textStyleId:"style",fontSize:12}),selected=text("selected",{fontSize:24}),blocked=text("blocked",{textStyleId:"style",fontSize:12,protected:["style"]});
 const design=designOf([selected,blocked]);design.pages.push({...design.pages[0],id:"second",canvas:scene([linked])});design.masterScene=scene([text("master",{textStyleId:"style",fontSize:10})]);
 const style={...advanced.textStyleFromElement(selected),id:"style",name:"Title",fontSize:36};
 const next=actions.saveSelectionTextStyle(design,style,[selected.id],{pageId:design.pages[0].id});
 assert.equal(next.pages[0].canvas.elements[0].fontSize,36);assert.equal(next.pages[0].canvas.elements[0].textStyleId,"style");assert.equal(next.pages[0].canvas.elements[1].fontSize,12);
 assert.equal(next.pages[1].canvas.elements[0].fontSize,36);assert.equal(next.masterScene.elements[0].fontSize,36);assert.equal(design.pages[1].canvas.elements[0].fontSize,12);
 const continuous={...design,continuousCanvas:scene([selected,linked])};assert.ok(actions.saveSelectionTextStyle(continuous,style,[selected.id],{pageId:design.pages[0].id}).continuousCanvas.elements.every(e=>e.fontSize===36));
 const master=actions.saveSelectionTextStyle(design,style,["master"],{pageId:design.pages[0].id,master:true});assert.equal(master.masterScene.elements[0].textStyleId,"style");
});
test("mixed-gradient stop editing preserves unrelated stops, each gradient type and differing counts",()=>{
 const a=shape("a",{gradient:{type:"linear",angle:10,stops:[{color:"#000",position:0},{color:"#f00",position:40},{color:"#fff",position:100}]}}),b=shape("b",{gradient:{type:"radial",angle:60,stops:[{color:"#123",position:0},{color:"#456",position:100}]}});
 const x=actions.editGradientStop(a,1,{color:"#abc"}),y=actions.editGradientStop(b,1,{color:"#abc"});assert.equal(x.gradient.stops[2].color,"#fff");assert.equal(y.gradient.stops[0].color,"#123");assert.equal(y.gradient.type,"radial");assert.equal(x.gradient.angle,10);assert.equal(a.gradient.stops[1].color,"#f00");
 assert.equal(actions.editGradientStop(b,2,{position:70}),b);assert.equal(actions.editGradientStop(b,0,"remove"),b);assert.equal(actions.editGradientStop(a,1,"remove").gradient.stops.length,2);
});
test("SVG skew and reflection preserve open paths rather than adding a closing stroke",()=>{
 for(const transform of ["skewX(25)","translate(100 0) scale(-1 1)"]){const imported=vector.importSVG(`<svg viewBox="0 0 100 100"><path d="M0 0L100 0L100 100" transform="${transform}" fill="none" stroke="#000"/></svg>`);assert.doesNotMatch(imported.elements[0].path,/Z/i);assert.ok(model.parseCanvasScene(imported));}
});
test("inherited SVG fill/stroke opacity and root/group compositing survive parsing and render once",()=>{
 const imported=vector.importSVG('<svg viewBox="0 0 100 100" opacity=".5"><g opacity=".4" fill="#f00" fill-opacity=".25" stroke="#00f" stroke-opacity=".5"><rect width="80" height="80"/><rect x="20" y="20" width="80" height="80"/></g></svg>');
 assert.equal(imported.elements[0].opacity,1);assert.equal(imported.elements[0].fill,"#ff000040");assert.equal(imported.elements[0].stroke,"#0000ff80");near(opacity.elementEffectiveOpacity(imported,imported.elements[0]),.2);
 assert.deepEqual(imported.groups.map(g=>g.opacity),[.5,.4]);assert.ok(model.parseCanvasScene(imported));
 const gradient=vector.importSVG('<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><g fill-opacity=".5"><rect width="100" height="100" fill="url(#g)"/></g></svg>');assert.equal(gradient.elements[0].gradient.stops[0].color,"#ff000080");
 const markup=renderToStaticMarkup(React.createElement(canvas.SceneRenderer,{scene:imported}));assert.equal((markup.match(/data-composite-group=/g)||[]).length,2);assert.match(markup,/opacity:0.5/);assert.match(markup,/opacity:0.4/);
});
test("crop translation uses cover/contain painted overflow and zero-overflow leaves the axis stable",()=>{
 const photo={...model.createCanvasElement("image"),width:100,height:100,intrinsicWidth:400,intrinsicHeight:200,fit:"cover",cropX:50,cropY:50};
 assert.deepEqual(crop.cropAfterDrag(photo,{x:20,y:30}),{cropX:30,cropY:50});
 assert.deepEqual(crop.cropAfterDrag({...photo,fit:"contain"},{x:20,y:10}),{cropX:50,cropY:70});
 assert.deepEqual(crop.cropAfterDrag(photo,{x:-1000,y:0}),{cropX:100,cropY:50});
});
test("rotated, flipped, zoomed crop math matches the actual nested CSS paint translation",()=>{
 const photo={...model.createCanvasElement("image"),width:120,height:80,intrinsicWidth:360,intrinsicHeight:120,fit:"cover",cropX:40,cropY:40,cropScale:2,flipX:true,rotation:90};
 const after=crop.cropAfterDrag(photo,{x:0,y:12});
 const painted=240,origin=p=>2*((120-painted)*(1-p/100))+120*(1-2)*p/100;
 near(origin(after.cropX)-origin(photo.cropX),12);near(after.cropY,40);
 const frame=shape("frame",{width:120,height:80,rotation:90,imageFill:{src:"https://example.test/photo.png",objectFit:"cover",cropX:40,cropY:40,cropScale:2,flipX:true,intrinsicWidth:360,intrinsicHeight:120}});assert.deepEqual(crop.cropAfterDrag(frame,{x:0,y:12}),after);
});
test("case conversion decodes entities before Unicode case while keeping styles, textures and mirror consistent",()=>{
 const source=text("entity",{text:"café & Straße\nmañana",richText:'<b>caf&#233; &amp; Straße</b><br><span style="color:#f00" data-texture-id="texture">ma&#241;ana</span>',wordTextures:[{id:"texture",src:"https://example.test/photo.png",objectFit:"cover",cropX:50,cropY:50}]});
 const upper=actions.changeStyledTextCase(source,true);assert.equal(upper.text,"CAFÉ & STRASSE\nMAÑANA");assert.match(upper.richText,/<b>CAFÉ &amp; STRASSE<\/b>/);assert.match(upper.richText,/data-texture-id="texture"/);assert.equal(model.richTextToPlain(upper.richText),upper.text);assert.equal(actions.changeStyledTextCase(upper,false).text,"café & strasse\nmañana");
});
test("Layers keyboard selection and dragging an unselected or partially selected nested group remain group operations",()=>{
 const current={...scene([shape("a",{groupId:"inner"}),shape("b",{groupId:"outer"}),shape("c")]),groups:[{id:"outer",name:"Outer"},{id:"inner",name:"Inner",parentId:"outer"}]};
 assert.deepEqual(layers.layerSelectionAfterClick(current,[],["a"],false),["a","b"]);assert.deepEqual(layers.layerSelectionAfterClick(current,["a","b","c"],["a"],true),["c"]);
 assert.deepEqual(layers.layerDragSelection(current,[],"a"),["a","b"]);assert.deepEqual(layers.layerDragSelection(current,["a"],"a"),["a","b"]);assert.deepEqual(layers.layerDragSelection(current,[],"a","outer"),["a"]);
 const locked={...current,groups:current.groups.map(g=>({...g,locked:true}))};assert.deepEqual(layers.layerDragSelection(locked,[],"a"),[]);
});
test("keyboard resize keeps the opposite edge anchored and preserves protected appearance",()=>{
 const box=shape("box",{x:10,y:20,width:100,height:40,radius:8,protected:["style"]}),source=scene([box]);
 const east=canvas.keyboardCanvasTransform(source,["box"],"ArrowRight",10,"e").elements[0];near(east.x,10);near(east.width,110);near(east.height,40);assert.equal(east.radius,8);
 const west=canvas.keyboardCanvasTransform(source,["box"],"ArrowRight",10,"w").elements[0];near(west.x,20);near(west.x+west.width,110);
 const rotated=shape("turn",{rotation:90}),resized=canvas.keyboardCanvasTransform(scene([rotated]),["turn"],"ArrowDown",10,"e").elements[0];near(resized.width,110);
 const hidden=shape("hidden",{hidden:true}),locked=shape("locked",{groupId:"lock"});const mixed={...scene([hidden,locked,box]),groups:[{id:"lock",name:"Lock",locked:true}]};const transformed=canvas.keyboardCanvasTransform(mixed,["hidden","locked","box"],"ArrowRight",15);assert.equal(transformed.elements[0],hidden);assert.equal(transformed.elements[1],locked);near(transformed.elements[2].rotation,15);
 const markup=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:source,width:360,height:480,selectedIds:["box"],onSelect(){},onChange(){}}));assert.match(markup,/aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/);
});
test("geometry selects the painted interior, ignores transparent corners/holes and cycles depth in group units",()=>{
 const lower=shape("lower"),circle=shape("circle",{shape:"ellipse"}),hole=shape("hole",{shape:"path",path:"M0 0H100V100H0ZM20 20H80V80H20Z",viewBox:"0 0 100 100",fillRule:"evenodd"});
 assert.equal(hit.elementContainsPoint(circle,{x:1,y:1}),false);assert.equal(hit.layersAtPoint(scene([lower,circle]),{x:1,y:1})[0].id,"lower");assert.equal(hit.elementContainsPoint(hole,{x:50,y:50}),false);assert.equal(hit.elementContainsPoint(hole,{x:10,y:10}),true);
 const stack=hit.layersAtPoint(scene([lower,circle,hole]),{x:10,y:10});assert.equal(hit.cycleLayerAtPoint(stack,["hole"]).id,"lower");assert.equal(hit.cycleLayerAtPoint(stack,["hole","lower"]).id,"hole");
 const masked={...model.createCanvasElement("image"),x:0,y:0,width:100,height:100,mask:"ellipse"};assert.equal(hit.elementContainsPoint(masked,{x:1,y:1}),false);
});
test("stroke hit geometry distinguishes inside/outside borders, open paths, clips, hidden groups and opacity0",()=>{
 const outline=shape("outline",{fill:"transparent",stroke:"#000",strokeWidth:10,strokeAlign:"outside"});assert.equal(hit.elementContainsPoint(outline,{x:-5,y:50}),true);assert.equal(hit.elementContainsPoint(outline,{x:5,y:50}),false);
 const open=shape("open",{shape:"path",path:"M0 0L100 0L100 100",viewBox:"0 0 100 100",fill:"transparent",stroke:"#000",strokeWidth:2});assert.equal(hit.elementContainsPoint(open,{x:50,y:50}),false);
 const clipped={...outline,clipBounds:{x:0,y:0,width:100,height:100}};assert.equal(hit.elementContainsPoint(clipped,{x:-5,y:50}),false);
 const transparentGroup={...scene([shape("visible"),shape("zero",{groupId:"group"})]),groups:[{id:"group",name:"Transparent",opacity:0}]};assert.deepEqual(hit.layersAtPoint(transparentGroup,{x:50,y:50}).map(e=>e.id),["visible"]);
 assert.deepEqual(hit.layersAtPoint(transparentGroup,{x:50,y:50},{isolationGroupId:"group"}),[]);
});
test("one-finger Hand and two-finger pan/pinch compute client deltas without pointer-count jumps",()=>{
 assert.deepEqual(camera.viewGestureDelta([{x:10,y:20}],[{x:30,y:10}]),{pan:{x:20,y:-10},factor:1,anchor:{x:30,y:10}});
 const pinch=camera.viewGestureDelta([{x:0,y:0},{x:100,y:0}],[{x:10,y:20},{x:210,y:20}]);assert.deepEqual(pinch,{pan:{x:60,y:20},factor:2,anchor:{x:110,y:20}});
 assert.deepEqual(camera.viewGestureDelta([{x:0,y:0}],[{x:0,y:0},{x:100,y:0}]),{pan:{x:0,y:0},factor:1,anchor:{x:0,y:0}});
});
test("autofit recovers nominal size when content shrinks and honors configured minimum and maximum",()=>{
 const source=text("fit",{fontSize:36,textMode:"auto-fit",autoFitFontSize:12,autoFitMinFontSize:8,autoFitMaxFontSize:48});
 near(fit.fitTextFontSize(source,size=>size<=18),18);assert.equal(fit.fitTextFontSize(source,()=>true),48);assert.equal(fit.fitTextFontSize(source,()=>false),8);assert.equal(source.fontSize,36);
 const design=designOf([source]);const style=advanced.textStyleFromElement(source);design.styles=[style];const parsed=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),designs:[design]});assert.ok(parsed);assert.equal(parsed.designs[0].pages[0].canvas.elements[0].autoFitFontSize,12);assert.equal(parsed.designs[0].styles[0].autoFitMaxFontSize,48);assert.equal(parsed.designs[0].styles[0].autoFitFontSize,undefined);
 assert.equal(model.parseCanvasScene(scene([{...source,autoFitMinFontSize:50,autoFitMaxFontSize:20}])),null);
});
test("autofit measures rich sizes relatively and restores exact DOM styles after measurement",()=>{
 const source=text("fit",{fontSize:40,textMode:"auto-fit",autoFitFontSize:20,width:100,height:60}),span={style:{fontSize:"30px"}},node={style:{fontSize:"20px"},querySelectorAll:()=>[span],get scrollHeight(){return parseFloat(this.style.fontSize)*3;},get scrollWidth(){return parseFloat(span.style.fontSize)*2;}};
 near(fit.measureFittedText(node,source),20.16,.01);assert.equal(node.style.fontSize,"20px");assert.equal(span.style.fontSize,"30px");fit.scaleEditableText(node,20,30);assert.equal(span.style.fontSize,"45px");assert.equal(node.style.fontSize,"30px");
 const markup=renderToStaticMarkup(React.createElement(canvas.SceneRenderer,{scene:scene([{...source,richText:'<span style="font-size:60px">Large</span>',text:"Large"}])}));assert.match(markup,/font-size:20px/);assert.match(markup,/font-size:30px/);
});
test("node parser preserves cubic, smooth, quadratic, arc and open/closed subpath semantics",()=>{
 const graph=nodes.parseVectorNodes("M0 0 C10 0 20 20 30 20 S50 0 60 0 Q70 20 80 0 T100 0 M0 50A50 50 0 0 1 100 50Z");assert.equal(graph.subpaths.length,2);assert.equal(graph.subpaths[0].closed,false);assert.equal(graph.subpaths[1].closed,true);assert.deepEqual(graph.subpaths[0].nodes[1].outgoing,{x:40,y:20});
 const path=nodes.serializeVectorNodes(graph);assert.ok(model.isSafeVectorPath(path));assert.equal((path.match(/Z/g)||[]).length,1);assert.doesNotMatch(path,/[QSTA]/);assert.ok(nodes.parseVectorNodes(path).subpaths[1].nodes.length>4);
 const relative=nodes.parseVectorNodes("m10 20 l10 0 h10 v20 z");assert.deepEqual(relative.subpaths[0].nodes.map(n=>n.point),[{x:10,y:20},{x:20,y:20},{x:30,y:20},{x:30,y:40}]);
});
test("adding a cubic anchor preserves the actual curve and moving an anchor moves both handles",()=>{
 const graph=nodes.parseVectorNodes("M0 0 C0 100 100 100 100 0"),original=graph.subpaths[0].nodes,split=nodes.insertVectorNode(graph,original[0].id),middle=split.subpaths[0].nodes[1];assert.deepEqual(middle.point,{x:50,y:75});assert.deepEqual(split.subpaths[0].nodes[0].outgoing,{x:0,y:50});assert.deepEqual(middle.incoming,{x:25,y:75});assert.deepEqual(middle.outgoing,{x:75,y:75});assert.equal(graph.subpaths[0].nodes.length,2);
 const moved=nodes.moveVectorNode(split,middle.id,{x:60,y:85});assert.deepEqual(moved.subpaths[0].nodes[1].incoming,{x:35,y:85});assert.deepEqual(moved.subpaths[0].nodes[1].outgoing,{x:85,y:85});
 const smooth=nodes.moveVectorNode(split,middle.id,{x:25,y:60},"incoming",true);assert.deepEqual(smooth.subpaths[0].nodes[1].outgoing,{x:75,y:90});
 assert.equal(nodes.moveVectorNode(graph,original[0].id,{x:NaN,y:0}),graph);
});
test("node reframing preserves world geometry for rotated paths and degenerate open lines",()=>{
 for(const path of ["M10 20L90 20","M10 20L10 90","M10 20C30 0 50 80 90 40"]){const original=shape("path",{shape:"path",path,viewBox:"0 0 100 100",x:15,y:20,width:200,height:80,rotation:35,imageFill:{src:"https://example.test/photo.png",objectFit:"cover",cropX:50,cropY:50}}),graph=nodes.vectorGraphForShape(original),updated=nodes.shapeWithVectorGraph(original,graph);for(const anchor of graph.subpaths[0].nodes){const before=world(original,anchor.point),after=world(updated,anchor.point);near(before.x,after.x);near(before.y,after.y);}assert.equal(updated.imageFill,original.imageFill);assert.ok(model.parseCanvasScene(scene([updated])),JSON.stringify(updated));}
 const rounded=shape("rounded",{radius:20});assert.ok(nodes.vectorGraphForShape(rounded).subpaths[0].nodes.some(n=>n.incoming));
});
test("node actions expose curve/corner, insertion/deletion and open/closed paths without throwing on bounds",()=>{
 const graph=nodes.parseVectorNodes("M0 0L100 0L100 100Z"),id=graph.subpaths[0].nodes[1].id,curve=nodes.setVectorNodeCurve(graph,id,true);assert.ok(curve.subpaths[0].nodes[1].incoming);assert.ok(curve.subpaths[0].nodes[1].outgoing);const corner=nodes.setVectorNodeCurve(curve,id,false);assert.equal(corner.subpaths[0].nodes[1].outgoing,undefined);assert.equal(nodes.removeVectorNode(graph,id).subpaths[0].nodes.length,2);
 const open={...graph,subpaths:graph.subpaths.map(s=>({...s,closed:false}))};assert.doesNotMatch(nodes.serializeVectorNodes(open),/Z/);assert.equal(nodes.insertVectorNode(open,open.subpaths[0].nodes[2].id).subpaths[0].nodes.length,4);
});
test("command execution and shortcut help share one registry, including redo, groups, depth and touch",()=>{
 for(const [key,patch,id] of [["z",{metaKey:true},"undo"],["z",{ctrlKey:true,shiftKey:true},"redo"],["y",{ctrlKey:true},"redo"],["g",{metaKey:true},"group"],["g",{ctrlKey:true,shiftKey:true},"ungroup"],["}",{metaKey:true,shiftKey:true},"front"],["h",{},"hand"],["a",{},"nodes"],["a",{metaKey:true},"select-all"],["p",{},"pen"],["+",{ctrlKey:true,shiftKey:true},"zoom-in"]])assert.equal(registry.resolveEditorCommand(event(key,patch)),id);
 assert.equal(registry.resolveEditorCommand(event("a",{isComposing:true})),null);assert.equal(registry.resolveEditorCommand(event("h",{altKey:true})),null);assert.equal(history.historyShortcut(event("y",{ctrlKey:true})),"redo");
 const help=registry.editorCommandHelp();assert.ok(help.some(item=>/Ctrl Y/.test(item.shortcut)));assert.ok(help.some(item=>item.shortcut==="⌘/Ctrl Shift G"));assert.ok(help.some(item=>/Alt \+ drag/.test(item.shortcut)));assert.ok(help.some(item=>/Two fingers/.test(item.shortcut)));assert.ok(help.some(item=>/underneath/.test(item.label)));
});

test("pen canvas renders only the draft geometry while drawing controls stay outside the stage",()=>{
 const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:scene([]),width:360,height:480,selectedIds:[],drawingMode:"pen",onSelect(){},onChange(){}}));
 assert.match(html,/class="te-path-preview"/);assert.doesNotMatch(html,/Draw path controls|Finish path|Remove last point|Click to add points/);
});
