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
import { installRichDom } from "./helpers-rich-dom.mjs";

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
const photoFrames=load("lib/template-editor/photo-frames.ts"), textures=load("lib/template-editor/text-textures.ts");
const geometry=load("lib/template-editor/canvas-geometry.ts");
const model=load("lib/template-editor/model.ts"), canvas=load("components/template-editor/canvas.tsx"), rich=load("lib/template-editor/rich-text-editing.ts"), appearance=load("lib/template-editor/appearance.ts");
const shape=(patch={})=>({...model.createCanvasElement("shape",{x:10,y:20,width:100,height:80,...patch}),...patch});
const text=(patch={})=>({...model.createCanvasElement("text",{x:10,y:20,width:100,height:80,...patch}),...patch});
const render=(elements,extra={})=>renderToStaticMarkup(React.createElement(canvas.SceneRenderer,{scene:{background:"#fff",elements,...extra}}));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.01,`${actual} ≠ ${expected}`);

test("every shape uses real numeric SVG strokes and honors path fill rule",()=>{
  const html=render([shape({shape:"rectangle",strokeWidth:2,strokeDash:[4,1,2],radius:8}),shape({shape:"ellipse",strokeWidth:3,strokeDash:[1,3]}),shape({shape:"path",path:"M0 0H100V100H0Z",fillRule:"evenodd",strokeWidth:1})]);
  assert.match(html,/<rect[^>]+rx="8"/);
  assert.match(html,/stroke-dasharray="4 1 2"/);
  assert.match(html,/<ellipse/);
  assert.match(html,/stroke-dasharray="1 3"/);
  assert.match(html,/fill-rule="evenodd"/);
  assert.equal((html.match(/vector-effect="non-scaling-stroke"/g)||[]).length,3);
});
test("linear and radial gradients have unique definitions across repeated artwork",()=>{
  const gradient={type:"linear",angle:45,stops:[{color:"#fff",position:0},{color:"#000",position:100}]};
  const item=shape({gradient});
  const html=render([item,{...item,id:"second",gradient:{...gradient,type:"radial"}}]);
  assert.match(html,/<linearGradient/);
  assert.match(html,/<radialGradient/);
  const ids=[...html.matchAll(/(?:linearGradient|radialGradient) id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,2);
  ids.forEach(id=>assert.ok(html.includes(`url(#${id})`)));
});
test("SVG angle matches page-pixel CSS angle on non-square objects",()=>{
  const endpoints=appearance.gradientEndpoints(45,200,100);
  near(endpoints.x1,12.5);near(endpoints.y1,125);near(endpoints.x2,87.5);near(endpoints.y2,-25);
  const horizontal=appearance.gradientEndpoints(90,200,100);
  near(horizontal.x1,0);near(horizontal.x2,100);near(horizontal.y1,50);
});
test("shadow spread uses alpha morphology and preserves transparent colors",()=>{
  const common={color:"#00000080",offsetX:2,offsetY:4,blur:8,spread:5};
  const html=render([shape({shadow:common}),shape({shadow:{...common,spread:-3}})]);
  assert.match(html,/<feMorphology[^>]+operator="dilate" radius="5"/);
  assert.match(html,/<feMorphology[^>]+operator="erode" radius="3"/);
  assert.match(html,/flood-opacity="0.5019607843137255"/);
  assert.match(html,/<feGaussianBlur[^>]+stdDeviation="4"/);
});
test("rich numbered lists retain formatting and paragraph spacing after editing",()=>{
  const html=render([text({text:"First\nSecond",richText:'<span style="color:#ff000080; font-weight:700">First<br>Second</span>',listStyle:"number",paragraphSpacing:6,verticalAlign:"bottom"})]);
  assert.equal((html.match(/te-canvas-text-line/g)||[]).length,2);
  assert.match(html,/1\. /);assert.match(html,/2\. /);
  assert.equal((html.match(/color:#ff000080/g)||[]).length,2);
  assert.match(html,/--te-paragraph-spacing:6px/);
  assert.match(html,/justify-content:flex-end/);
  assert.match(html,/te-canvas-text-frame is-fixed/);
});
test("rich line splitting balances nested styles and preserves empty/trailing paragraphs",()=>{
  const lines=rich.splitRichLines('<b>First<span style="color:#abc8">line<br>Second</span></b>');
  assert.equal(lines.length,2);
  assert.equal(model.sanitizeRichText(lines[0]),lines[0]);
  assert.equal(model.sanitizeRichText(lines[1]),lines[1]);
  assert.deepEqual(rich.splitRichLines(undefined,"a\n\nb\n"),["a","","b",""]);
  assert.deepEqual(rich.splitRichLines('<img src="evil">',"<safe>"),["&lt;safe&gt;"]);
});
test("run-level decoration clearing can remove underline without removing strike",()=>{
  const html=rich.resolveRichDecorations('<u>Before<span style="text-decoration:line-through; color:#abc8">Selected</span>After</u>');
  assert.ok(!html.includes("<u>"));
  assert.match(html,/text-decoration:underline/);
  assert.match(html,/text-decoration:line-through">Selected/);
  assert.match(html,/color:#abc8/);
  const inherited=rich.resolveRichDecorations('<span>Base</span><span style="text-decoration:none">Clear</span>',true,true);
  assert.match(inherited,/text-decoration:underline line-through">Base/);
  assert.match(inherited,/text-decoration:none">Clear/);
});
test("rich color normalization retains alpha from browser rgba styles",()=>{
  assert.equal(rich.normalizedCssColor("rgba(255, 0, 128, 0.5)"),"#ff008080");
  assert.equal(rich.normalizedCssColor("rgb(255 0 128 / 25%)"),"#ff008040");
  assert.equal(rich.scaleRichTextFonts('<span style="font-size:20px; color:#abc8">Rich</span>',2),'<span style="font-size:40px; color:#abc8">Rich</span>');
});
test("crop zoom and flip use separate origins so edge focal points remain visible",()=>{
  const html=render([model.createCanvasElement("image",{cropX:0,cropY:100,cropScale:2,flipX:true,flipY:true})]);
  assert.match(html,/transform:scale\(2\);transform-origin:0% 100%/);
  assert.match(html,/transform:scale\(-1, -1\);transform-origin:center/);
});
test("isolation removes outside hit targets while keeping context artwork",()=>{
  const inside=shape({id:"inside",groupId:"g"}),outside=shape({id:"outside"});
  const scene={background:"#fff",elements:[inside,outside],groups:[{id:"g",name:"Group"}]};
  const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene,width:360,height:450,selectedIds:["outside"],isolatedGroupId:"g",onSelect(){},onChange(){}}));
  assert.match(html,/data-layer-id="inside"/);
  assert.ok(!html.includes('data-layer-id="outside"'));
  assert.match(html,/data-element-id="outside"/);
  assert.match(html,/is-outside-isolation/);
});
test("inherited lock and protected position both remove transform handles",()=>{
  const item=shape({id:"locked",groupId:"g"});
  const base={width:360,height:450,onSelect(){},onChange(){}};
  const locked=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{...base,selectedIds:[item.id],scene:{background:"#fff",elements:[item],groups:[{id:"g",name:"Group",locked:true}]}}));
  assert.ok(!locked.includes('aria-label="Resize'));
  assert.match(locked,/Locked/);
  const protectedHtml=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{...base,selectedIds:[item.id],scene:{background:"#fff",elements:[{...item,groupId:undefined,protected:["position"]}]}}));
  assert.ok(!protectedHtml.includes('aria-label="Resize'));
});
test("master artwork shares page backdrop for blending and clips at each carousel seam",()=>{
  const master=shape({id:"master-red",x:350,width:40,fill:"#ff0000",blendMode:"multiply"});
  const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:{background:"#00ff00",elements:[]},masterScene:{background:"transparent",elements:[master]},masterPageVisibility:[true,true,false],width:1080,height:450,slideWidth:360,selectedIds:[],onSelect(){},onChange(){}}));
  assert.equal((html.match(/class="te-canvas-master-page"/g)||[]).length,2);
  assert.match(html,/data-master-slide="0" style="left:0;width:360px;height:450px"/);
  assert.match(html,/data-master-slide="1" style="left:360px;width:360px;height:450px"/);
  assert.equal((html.match(/isolation:auto/g)||[]).length,2);
  assert.equal((html.match(/mix-blend-mode:multiply/g)||[]).length,2);
  assert.equal((html.match(/left:350px/g)||[]).length,2);
});
test("side resizing a line preserves thin height and text corners scale rich typography",()=>{
  const line=shape({width:160,height:3});
  assert.equal(canvas.resizeSingle(line,"e",{x:20,y:0},false).height,3);
  const source=text({width:100,height:50,fontSize:20,richText:'<span style="font-size:10px">Small</span>'});
  const resized=canvas.resizeSingle(source,"se",{x:50,y:25},false);
  near(resized.fontSize,30);near(resized.width,150);near(resized.height,75);
  assert.match(resized.richText,/font-size:15px/);
});
test("thin artwork exposes only axis handles so constant hit areas cannot capture a corner",()=>{
  assert.deepEqual(canvas.resizeHandlePolicy({width:160,height:3},3,true),["w","e"]);
  assert.deepEqual(canvas.resizeHandlePolicy({width:3,height:160},3,true),["n","s"]);
  assert.deepEqual(canvas.resizeHandlePolicy({width:80,height:30},.4),["w","e"]);
  assert.deepEqual(canvas.resizeHandlePolicy({width:10,height:10},1),["se"]);
  const line=shape({id:"line",width:160,height:3});
  const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:{background:"#fff",elements:[line]},width:360,height:450,viewScale:3,selectedIds:["line"],onSelect(){},onChange(){}}));
  assert.match(html,/aria-label="Resize right"/);assert.match(html,/aria-label="Resize left"/);
  assert.ok(!html.includes('aria-label="Resize top right"'));assert.ok(!html.includes('aria-label="Resize bottom right"'));
});
test("subpixel artwork has a six-screen-pixel selection target without changing its geometry",()=>{
  const line=shape({id:"line",width:160,height:3});
  const padding=canvas.minimumHitPadding(line,.15);
  near((line.height+padding.y*2)*.15,6);near(padding.x,0);
  const tiny=canvas.minimumHitPadding({width:2,height:2},1);
  near(tiny.x,2);near(tiny.y,2);
  const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:{background:"#fff",elements:[line]},width:360,height:450,viewScale:.15,selectedIds:[],onSelect(){},onChange(){}}));
  assert.match(html,/height:3px/);assert.match(html,/--te-hit-pad-y:18.5px/);
});
test("a thin group resizes from its side without moving the perpendicular center",()=>{
  const first=shape({x:0,y:0,width:40,height:3}),second=shape({x:60,y:0,width:40,height:3});
  const resized=canvas.resizeGroup([first,second],{x:0,y:0,width:100,height:3,rotation:0},"e",{x:50,y:0});
  near(resized[0].width,60);near(resized[0].y+resized[0].height/2,1.5);near(resized[1].y+resized[1].height/2,1.5);
});
test("center resizing preserves the single and group pivots and relative spacing",()=>{
  const source=shape({x:20,y:30,width:100,height:50,rotation:30});
  const resized=canvas.resizeSingle(source,"e",{x:20*Math.cos(Math.PI/6),y:20*Math.sin(Math.PI/6)},false,true);
  near(resized.x+resized.width/2,70);near(resized.y+resized.height/2,55);near(resized.width,140);
  const first=shape({x:0,y:0,width:20,height:20}),second=shape({x:80,y:0,width:20,height:20});
  const group=canvas.resizeGroup([first,second],{x:0,y:0,width:100,height:20,rotation:0},"se",{x:50,y:10},true);
  near(group[0].x,-50);near(group[1].x,110);near(group[0].width,40);
});
test("duplicate drag is one commit and cancellation retains source and concurrent uploads",()=>{
  const original=shape({id:"source"}),copy={...original,id:"copy",name:"Copy"};
  const source={background:"#fff",elements:[original]},duplicated={...source,elements:[original,copy]};
  const latest={...duplicated,elements:[original,{...copy,x:80}]};
  const current={...source,elements:[original,shape({id:"uploaded"})]};
  const active={kind:"move",source:duplicated,latest,originalScene:source,ids:["copy"],moved:true};
  assert.equal(canvas.commitCanvasGesture(current,active,true),current);
  const committed=canvas.commitCanvasGesture(current,active);
  assert.deepEqual(committed.elements.map(item=>item.id),["source","uploaded","copy"]);
  assert.equal(committed.elements[2].x,80);
  assert.equal(source.elements.length,1);
});


test("rich formatting preserves exact 700 inside 600 and restores the selected range without native normalization",()=>{
  const dom=installRichDom();
  try {
    const node=dom.node('<div><span style="text-decoration:none">Engine</span></div><div><span style="text-decoration:none">Design with precision</span></div>',{fontWeight:"600"});
    const range=dom.range(node),[first,last]=dom.textNodes(node);
    range.setStart(first,0);range.setEnd(last,last.textContent.length);
    const base=text({fontWeight:600});
    assert.deepEqual(rich.textRangeTogglePatch(node,range,"fontWeight",base),{fontWeight:700});
    assert.equal(rich.formatTextRange(node,range,{fontWeight:700}),true);
    assert.equal(dom.nativeCalls,0);
    const html=rich.editorRichHtml(node);
    assert.equal(model.richTextToPlain(html),"Engine\nDesign with precision");
    assert.equal((html.match(/font-weight:700/g)||[]).length,2);
    assert.deepEqual(node.childNodes.map(child=>child.tagName),["DIV","DIV"]);
    assert.equal(range.startContainer.textContent,"Engine");assert.equal(range.startOffset,0);
    assert.equal(range.endContainer.textContent,"Design with precision");assert.equal(range.endOffset,21);
    assert.deepEqual(rich.textRangeTogglePatch(node,range,"fontWeight",base),{fontWeight:400});
    rich.formatTextRange(node,range,{fontWeight:400});
    assert.ok(!rich.editorRichHtml(node).includes("700"));
  } finally {dom.restore();}
});
test("range toggles consider mixed and inherited styles and keep untouched alpha/font properties",()=>{
  const dom=installRichDom();
  try {
    const node=dom.node('<b><span style="color:#abc8; font-size:22px; text-decoration:underline line-through">One</span></b><span style="font-weight:400; font-style:normal; text-decoration:none">Two</span>');
    const range=dom.range(node),base=text({fontWeight:600,italic:true,underline:true});
    assert.deepEqual(rich.textRangeTogglePatch(node,range,"fontWeight",base),{fontWeight:700});
    assert.deepEqual(rich.textRangeTogglePatch(node,range,"italic",base),{italic:true});
    assert.deepEqual(rich.textRangeTogglePatch(node,range,"underline",base),{underline:true});
    const first=dom.textNodes(node)[0];range.setStart(first,0);range.setEnd(first,3);
    assert.deepEqual(rich.textRangeTogglePatch(node,range,"underline",base),{underline:false});
    rich.formatTextRange(node,range,{underline:false});
    const html=rich.editorRichHtml(node);
    assert.match(html,/font-weight:700; text-decoration:line-through; color:#abc8; font-size:22px">One/);
    assert.match(html,/font-weight:400; font-style:normal; text-decoration:none">Two/);
  } finally {dom.restore();}
});


test("baked masters clip artwork and interaction in world space without changing object coordinates",()=>{
  const item=shape({id:"baked",x:350,y:10,width:40,height:30,clipBounds:{x:360,y:0,width:360,height:450},blendMode:"multiply"});
  const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:{background:"#fff",elements:[item]},width:720,height:450,selectedIds:[],onSelect(){},onChange(){}}));
  assert.equal((html.match(/class="te-canvas-source-clip"/g)||[]).length,2);
  assert.match(html,/class="te-canvas-source-clip" style="left:360px;top:0;width:360px;height:450px"/);
  assert.match(html,/style="left:-360px;top:0"/);
  assert.match(html,/data-element-id="baked"/);
  assert.match(html,/left:350px;top:10px;width:40px;height:30px/);
  assert.equal(geometry.elementIntersectsCanvas(item,360,450),false);
  assert.equal(geometry.elementIntersectsCanvas({...item,x:item.x-360,clipBounds:{...item.clipBounds,x:0}},360,450),true);
  assert.deepEqual(geometry.elementVisualBounds(item),{x:360,y:10,width:30,height:30});
  assert.equal(geometry.elementIntersectsRect(item,{x:345,y:0,width:10,height:40}),false);
  assert.equal(geometry.elementIntersectsRect(item,{x:365,y:0,width:10,height:40}),true);
});
test("clip-aware geometry rejects diagonal AABB overlap and ignores completely cropped artwork",()=>{
  const item=shape({x:50,y:50,width:100,height:2,rotation:45,clipBounds:{x:30,y:30,width:20,height:20}});
  assert.equal(geometry.elementIntersectsCanvas(item,100,100),false);
  const cropped=shape({x:0,y:0,width:20,height:20,clipBounds:{x:100,y:100,width:20,height:20}});
  assert.equal(geometry.sceneVisualBounds({elements:[cropped]}),null);
});


const photo={src:"https://example.test/photo.png",objectFit:"cover",cropX:20,cropY:80,cropScale:2,flipX:true,intrinsicWidth:800,intrinsicHeight:600};
test("all shape geometries render photos through exact SVG clips in physical pixel viewports",()=>{
  const names=["rectangle","ellipse","triangle","diamond","polygon","star","arrow","path"];
  const html=render(names.map((name,index)=>shape({id:`frame-${index}`,shape:name,width:200,height:90,imageFill:photo,strokeWidth:3,path:"M10 20H110V120H10Z",viewBox:"10 20 100 100"})));
  assert.equal((html.match(/<foreignObject x="0" y="0" width="200" height="90" clip-path="url/g)||[]).length,8);
  assert.equal((html.match(/data-shape-photo-id=/g)||[]).length,8);
  assert.equal((html.match(/viewBox="0 0 200 90"/g)||[]).length,8);
  assert.match(html,/transform="scale\(2 0.9\) translate\(-10 -20\)"/);
  assert.match(html,/object-fit:cover;object-position:20% 80%;transform:scale\(-1, 1\)/);
  assert.match(html,/transform:scale\(2\);transform-origin:20% 80%/);
});
test("outline inside and outside use doubled strokes clipped or masked against the filled geometry",()=>{
  const html=render([shape({id:"inside",strokeWidth:4,strokeAlign:"inside"}),shape({id:"center",strokeWidth:4,strokeAlign:"center"}),shape({id:"outside",strokeWidth:4,strokeAlign:"outside"})]);
  assert.match(html,/<g clip-path="url[^>]+><rect[^>]+stroke-width="8"/);
  assert.match(html,/stroke-width="4"/);
  assert.match(html,/<g mask="url[^>]+><rect[^>]+stroke-width="8"/);
  assert.match(html,/<mask[^>]+maskUnits="userSpaceOnUse" x="-8" y="-8" width="116" height="96"/);
});
test("photo target detection honors rotated geometry, rounded corners, holes, hierarchy and frontmost order",()=>{
  const circle=shape({id:"circle",shape:"ellipse",x:0,y:0,width:100,height:100});
  assert.equal(photoFrames.shapeContainsPoint(circle,{x:2,y:2}),false);
  assert.equal(photoFrames.shapeContainsPoint(circle,{x:50,y:50}),true);
  const hole=shape({id:"hole",shape:"path",x:0,y:0,width:100,height:100,path:"M0 0H100V100H0Z M25 25H75V75H25Z",fillRule:"evenodd"});
  assert.equal(photoFrames.shapeContainsPoint(hole,{x:50,y:50}),false);
  assert.equal(photoFrames.shapeContainsPoint(hole,{x:10,y:50}),true);
  const back=shape({id:"back",x:0,y:0,width:100,height:100}),front=shape({id:"front",x:0,y:0,width:100,height:100,groupId:"g"});
  const scene={background:"#fff",elements:[back,front],groups:[{id:"g",name:"Group",hidden:true}]};
  assert.equal(photoFrames.findPhotoFrameAtPoint(scene,{x:50,y:50}).id,"back");
  scene.groups[0].hidden=false;assert.equal(photoFrames.findPhotoFrameAtPoint(scene,{x:50,y:50}).id,"front");
  assert.equal(photoFrames.findPhotoFrameAtPoint(scene,{x:50,y:50},{excludedIds:["front"],isolationGroupId:"g"}),null);
  front.protected=["content"];assert.equal(photoFrames.findPhotoFrameAtPoint(scene,{x:50,y:50}).id,"back");
  const rounded=shape({x:0,y:0,width:100,height:60,radius:20});assert.equal(photoFrames.shapeContainsPoint(rounded,{x:1,y:1}),false);
  const rotated=shape({x:0,y:0,width:100,height:20,rotation:90});assert.equal(photoFrames.shapeContainsPoint(rotated,{x:50,y:-30}),true);
});
test("internal image drop consumes the source and fills stable frame ID in one commit; Escape and Alt bypass it",()=>{
  const image=model.createCanvasElement("image",{src:photo.src,id:"source-photo",x:0,y:0});
  const frame=shape({id:"target-frame",strokeWidth:2,strokeAlign:"outside"}),scene={background:"#fff",elements:[image,frame]};
  const active={kind:"move",source:scene,latest:{...scene,elements:[{...image,x:200},frame]},ids:[image.id],moved:true,dropTargetId:frame.id};
  const filled=canvas.commitCanvasGesture(scene,active);
  assert.equal(filled.elements.length,1);assert.equal(filled.elements[0].id,frame.id);
  assert.equal(filled.elements[0].imageFill.src,photo.src);assert.equal(filled.elements[0].strokeAlign,"outside");
  assert.equal(canvas.commitCanvasGesture(scene,active,true),scene);
  const bypass=canvas.commitCanvasGesture(scene,{...active,bypassFrame:true});assert.equal(bypass.elements[0].x,200);assert.equal(bypass.elements[1].imageFill,undefined);
});
test("photo crop patches share semantics between standalone photos and shapes without leaking image-only fields",()=>{
  const frame=shape({imageFill:photo});const updated=photoFrames.updatePhotoContent(frame,{cropX:60,cropScale:3,fit:"contain",mask:"ellipse"});
  assert.equal(updated.imageFill.objectFit,"contain");assert.equal(updated.imageFill.cropX,60);assert.equal(updated.imageFill.cropScale,3);
  assert.equal(updated.imageFill.mask,undefined);assert.equal(updated.radius,frame.radius);
});
test("whole text and selected words paint image backgrounds while only active original textures preload",()=>{
  const item=text({id:"textured",text:"Gold word",richText:'Gold <span data-texture-id="word-1" style="font-weight:700; color:#abc8">word</span>',textureFill:photo,wordTextures:[{...photo,id:"word-1"},{...photo,id:"unused"}]});
  const html=render([item]);
  assert.match(html,/data-engine-texture-id="whole"/);assert.match(html,/data-engine-texture-id="word-1"/);
  assert.ok(!html.includes('data-engine-texture-id="unused"'));
  assert.match(html,/--te-texture-word-1:/);assert.match(html,/background-clip:text/);assert.match(html,/-webkit-text-fill-color:transparent/);
  assert.match(html,/data-texture-id="word-1" style="font-weight:700; color:#abc8"/);
  const style=textures.textureBackgroundStyle({...photo,cropScale:2},100,50);assert.equal(style.backgroundSize,"200px 150px");
});
test("range texture assignment and removal preserve typography and keep photo URLs out of rich markup",()=>{
  const dom=installRichDom();
  try{
    const node=dom.node('<span style="font-weight:700; color:#abc8">Gold word</span>');const range=dom.range(node),first=dom.textNodes(node)[0];range.setStart(first,5);range.setEnd(first,9);
    assert.equal(rich.formatTextRange(node,range,{textureFill:photo},"word-1"),true);
    let html=rich.editorRichHtml(node);assert.match(html,/data-texture-id="word-1"[^>]+font-weight:700; color:#abc8">word/);assert.ok(!html.includes(photo.src));
    rich.formatTextRange(node,range,{italic:true});html=rich.editorRichHtml(node);assert.match(html,/data-texture-id="word-1"[^>]+font-style:italic/);
    rich.formatTextRange(node,range,{textureFill:null},null);html=rich.editorRichHtml(node);assert.ok(!html.includes("data-texture-id"));assert.match(html,/font-style:italic/);assert.equal(model.richTextToPlain(html),"Gold word");
  }finally{dom.restore();}
});


test("async word formatting captures stable offsets and rejects changed words, range or layer",()=>{
  const dom=installRichDom();
  try{
    const node=dom.node('<span style="font-weight:700">Gold word</span>');const range=dom.range(node),first=dom.textNodes(node)[0];range.setStart(first,5);range.setEnd(first,9);
    const before=rich.captureTextFormattingTarget(node,range,"title");assert.equal(before.start,5);assert.equal(before.end,9);
    assert.equal(rich.sameTextFormattingTarget(rich.captureTextFormattingTarget(node,range,"title"),structuredClone(before)),true);
    range.setStart(first,0);assert.equal(rich.sameTextFormattingTarget(rich.captureTextFormattingTarget(node,range,"title"),before),false);
    range.setStart(first,5);first.data="Gold changed";assert.equal(rich.sameTextFormattingTarget(rich.captureTextFormattingTarget(node,range,"title"),before),false);
    first.data="Gold word";assert.equal(rich.sameTextFormattingTarget(rich.captureTextFormattingTarget(node,range,"other"),before),false);
  }finally{dom.restore();}
});
test("visible outline alignment expands bounds, selection and snapping geometry by physical stroke extent",()=>{
  const base=shape({x:20,y:30,width:40,height:20,stroke:"#000",strokeWidth:4});
  assert.deepEqual(geometry.elementVisualBounds({...base,strokeAlign:"inside"}),{x:20,y:30,width:40,height:20});
  assert.deepEqual(geometry.elementVisualBounds({...base,strokeAlign:"center"}),{x:18,y:28,width:44,height:24});
  assert.deepEqual(geometry.elementVisualBounds({...base,strokeAlign:"outside"}),{x:16,y:26,width:48,height:28});
  assert.deepEqual(geometry.elementVisualBounds({...base,strokeAlign:"outside",rotation:90}),{x:26,y:16,width:28,height:48});
  assert.equal(geometry.shapeStrokeOutset({...base,stroke:"#0000",strokeAlign:"outside"}),0);
  assert.equal(geometry.shapeStrokeOutset({...base,stroke:"transparent",strokeAlign:"outside"}),0);
  const parked={...base,x:101,strokeAlign:"outside"};assert.equal(geometry.elementIntersectsCanvas(parked,100,100),true);
  assert.equal(geometry.elementIntersectsCanvas({...parked,strokeAlign:"inside"},100,100),false);
  const html=renderToStaticMarkup(React.createElement(canvas.CanvasEditor,{scene:{background:"#fff",elements:[{...base,id:"outlined",strokeAlign:"outside"}]},width:360,height:450,selectedIds:["outlined"],onSelect(){},onChange(){}}));
  assert.match(html,/class="te-canvas-outline"[^>]+style="left:16px;top:26px;width:48px;height:28px/);
  assert.match(html,/stroke-linejoin="round"/);
});


test("non-square paths apply stroke masks and inside clips in the untransformed physical SVG space",()=>{
  const path="M50 0L60 35L100 35L68 55L80 100L50 72L20 100L32 55L0 35L40 35Z";
  const html=render([shape({shape:"path",width:240,height:100,viewBox:"0 0 100 100",path,strokeWidth:4,strokeAlign:"outside",imageFill:photo}),shape({shape:"path",width:240,height:100,viewBox:"0 0 100 100",path,strokeWidth:4,strokeAlign:"inside",imageFill:photo})]);
  assert.match(html,/<g mask="url\(#[^)]+\)"><path[^>]+transform="scale\(2.4 1\) translate\(0 0\)"[^>]+stroke-width="8"/);
  assert.match(html,/<g clip-path="url\(#[^)]+\)"><path[^>]+transform="scale\(2.4 1\) translate\(0 0\)"[^>]+stroke-width="8"/);
  const strokes=[...html.matchAll(/<path[^>]+stroke-width="8"[^>]*>/g)].map(match=>match[0]);
  assert.equal(strokes.length,2);strokes.forEach(stroke=>assert.ok(!/\s(?:mask|clip-path)=/.test(stroke)));
  assert.match(html,/<mask[^>]+width="256" height="116"/);
});
