/* Run: node --test tests/template-editor-word-colors.test.mjs
 * Coloring words in template text whose style is fixed, such as the
 * @chatgptricks cover headline: the deck's highlight colors and No color, the
 * editor's own range formatting on a small DOM, and the same result as the
 * chat's style_words. Bold and the other styles stay fixed. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {installRichDom} from "./helpers-rich-dom.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url),cache=new Map();
function load(relative) {
  const filename=path.join(root,relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const unit={exports:{}};cache.set(filename,unit);
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:filename}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>{
    const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
    if(local)return load(path.relative(root,[`${local}.ts`,`${local}.tsx`,local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
    return nativeRequire(name);
  },unit,unit.exports);
  return unit.exports;
}
const model=load("lib/template-editor/model.ts"),rich=load("lib/template-editor/rich-text-editing.ts"),words=load("lib/template-editor/word-colors.ts");
const paint=load("lib/template-editor/paint.ts"),edits=load("lib/engine/assistant/chat-edits.ts"),{WordColorControls}=load("components/template-editor/word-color-controls.tsx");

const GREEN="#00d98a";
const template=()=>model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
/** A new @chatgptricks deck, as the editor makes it, with the cover headline set to `text` (plain, or rich). */
function deck(text,richText) {
  const document=model.createDesign(template()),scene=document.pages[0].canvas;
  const headline=scene.elements.find(element=>element.slot==="cover-headline");
  headline.text=text;
  if(richText===undefined)delete headline.richText;else headline.richText=richText;
  return {document,scene,headline,pageId:document.pages[0].id};
}
const headlineOf=document=>document.pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
/** The text as the canvas sets it up for typing: one block per line, rich runs with their decorations resolved. */
const editable=(dom,element)=>dom.node(rich.splitRichLines(element.richText?rich.resolveRichDecorations(element.richText,element.underline,element.strikethrough):undefined,element.text).map(line=>`<div>${line||"<br>"}</div>`).join(""),{textDecoration:"none"});
function select(dom,node,phrase) {
  for(const text of dom.textNodes(node)){
    const at=text.textContent.indexOf(phrase);
    if(at<0)continue;
    const range=dom.range(node);range.setStart(text,at);range.setEnd(text,at+phrase.length);return range;
  }
  throw new Error(`"${phrase}" isn't in one run of the text`);
}
/** What the canvas's formatRange does with a patch for the selected words: the rule, then the range formatting. */
function format(dom,scene,element,node,range,patch) {
  if(!words.canFormatWords(scene,element,patch))return false;
  return rich.formatTextRange(node,range,patch);
}
/** Rich text as the editor reads it back once the text is opened for typing. */
function asEditorReads(element) {
  const dom=installRichDom();
  try {return rich.editorRichHtml(editable(dom,element));}
  finally {dom.restore();}
}
/** The editor colors `phrase` in the headline: the rich text the canvas commits. */
function colorInEditor(scene,headline,phrase,color) {
  const dom=installRichDom();
  try {
    const node=editable(dom,headline),range=select(dom,node,phrase);
    assert.equal(format(dom,scene,headline,node,range,{color}),true,"the color goes on");
    return rich.editorRichHtml(node);
  } finally {dom.restore();}
}
const sameStyleSpacing=html=>html.replace(/style="([^"]*)"/g,(_,css)=>`style="${css.replace(/\s*:\s*/g,":")}"`);

test("the deck's highlight colors are its accent color roles, Accent green on @chatgptricks",()=>{
  assert.deepEqual(words.wordHighlightColors(template().colorRoles),[{name:"Accent green",color:GREEN}]);
  assert.deepEqual(words.wordHighlightColors(model.createDesign(template()).colorRoles),[{name:"Accent green",color:GREEN}],"a deck keeps its template's colors");
  assert.deepEqual(words.wordHighlightColors(undefined),[]);
  assert.deepEqual(words.wordHighlightColors([
    {id:"text",name:"Text",color:"#FFFFFF"},
    {id:"brand-highlight",name:"Highlight",color:"#FF0"},
    {id:"accent-2",name:"Accent yellow",color:"#ffff00"},
    {id:"accent-3",name:"Hidden accent",color:"transparent"},
    {id:"accent-4",name:"Accent purple",color:"#A855F7"},
  ]),[{name:"Highlight",color:"#ff0"},{name:"Accent purple",color:"#a855f7"}],"each visible color once, other roles left out");
});

test("template text with a fixed style takes word colors, while bold and the other styles stay fixed",()=>{
  const {scene,headline}=deck("SMALL DECISIONS BUILD BIG CAREERS");
  assert.equal(words.takesWordColorsOnly(scene,headline),true);
  for(const patch of [{color:GREEN},{color:"#00D98A"},{color:"white"},{color:null}])assert.equal(words.canFormatWords(scene,headline,patch),true,JSON.stringify(patch));
  for(const patch of [{fontWeight:700},{italic:true},{underline:true},{strikethrough:true},{fontSize:20},{font:"inter"},{textureFill:null},{color:GREEN,fontWeight:700},{color:"transparent"},{color:"red; x"},{},
    paint.paintTextFormattingPatch({type:"solid",color:GREEN}),
    {fontWeight:400,italic:false,underline:false,strikethrough:false,color:headline.color,font:headline.font,fontSize:headline.fontSize}])
    assert.equal(words.canFormatWords(scene,headline,patch),false,JSON.stringify(patch));
  const dom=installRichDom();
  try {
    const node=editable(dom,headline),range=select(dom,node,"SMALL DECISIONS"),before=rich.editorRichHtml(node);
    for(const key of ["fontWeight","italic","underline","strikethrough"])assert.equal(format(dom,scene,headline,node,range,rich.textRangeTogglePatch(node,range,key,headline)),false,`${key} stays blocked`);
    assert.equal(rich.editorRichHtml(node),before,"the words are untouched");
  } finally {dom.restore();}
  // Text the person styles freely takes every change; locked, protected and brand text takes none.
  const free={...model.createCanvasElement("text",{x:10,y:10,width:200,height:40}),text:"Free text"};
  const freeScene={...scene,elements:[...scene.elements,free]};
  assert.equal(words.takesWordColorsOnly(freeScene,free),false);
  assert.equal(words.canFormatWords(freeScene,free,{fontWeight:700}),true);
  for(const lock of [{locked:true},{protected:["content","style"]},{templateRole:"brand"}]){
    const closed={...headline,...lock},closedScene={...scene,elements:scene.elements.map(element=>element.id===headline.id?closed:element)};
    assert.equal(words.takesWordColorsOnly(closedScene,closed),false,JSON.stringify(lock));
    assert.equal(words.canFormatWords(closedScene,closed,{color:GREEN}),false,JSON.stringify(lock));
  }
});

test("coloring SMALL DECISIONS green in the cover headline gives the chat's style_words rich text",()=>{
  const {document,scene,headline,pageId}=deck("SMALL DECISIONS BUILD BIG CAREERS");
  const [{color}]=words.wordHighlightColors(document.colorRoles);
  const editor=colorInEditor(scene,headline,"SMALL DECISIONS",color);
  const chat=headlineOf(edits.applyChatEdits(document,[{op:"style_words",pageId,elementId:headline.id,words:["SMALL DECISIONS"],color:"#00D98A"}])).richText;
  assert.equal(editor,'<span style="color:#00d98a">SMALL DECISIONS</span> BUILD BIG CAREERS');
  // The same span on the same words in the same green. The editor writes every rich text without a space after "color:".
  assert.equal(chat,'<span style="color: #00d98a">SMALL DECISIONS</span> BUILD BIG CAREERS');
  assert.equal(editor,sameStyleSpacing(chat));
  assert.equal(asEditorReads({...headline,richText:editor}),asEditorReads({...headline,richText:chat}),"opened in the editor, the two are the same text");
  assert.equal(model.richTextToPlain(editor),headline.text);
  assert.equal(model.sanitizeRichText(editor),editor,"Engine's rich text grammar keeps it as it is");
});

test("a headline that already has highlighted words gets the same result from the editor and the chat",()=>{
  // The template's own sample headline, with FELL ALMOST 30% in green.
  const sample=template().pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
  const {document,scene,headline,pageId}=deck(sample.text,sample.richText);
  const editor=colorInEditor(scene,headline,"STOCKS NEARLY DOUBLED",GREEN);
  const chat=headlineOf(edits.applyChatEdits(document,[{op:"style_words",pageId,elementId:headline.id,words:["STOCKS NEARLY DOUBLED"],color:"#00D98A"}])).richText;
  assert.equal(asEditorReads({...headline,richText:editor}),asEditorReads({...headline,richText:chat}));
  assert.match(editor,/color:#00d98a">STOCKS NEARLY DOUBLED<\/span>/);
  assert.match(editor,/color:#00D98A">FELL ALMOST 30%<\/span>/,"the page's own highlight stays");
  assert.equal(model.richTextToPlain(editor),sample.text);
});

test("No color takes the color off the selected words again",()=>{
  const {scene,headline}=deck("SMALL DECISIONS BUILD BIG CAREERS");
  const colored={...headline,richText:colorInEditor(scene,headline,"SMALL DECISIONS",GREEN)};
  const dom=installRichDom();
  try {
    // Right after the color goes on, the canvas keeps the words selected and their markup as formatTextRange left it.
    const node=editable(dom,headline),range=select(dom,node,"SMALL DECISIONS");
    assert.equal(format(dom,scene,headline,node,range,{color:GREEN}),true);
    assert.equal(format(dom,scene,headline,node,range,{color:null}),true);
    assert.equal(rich.editorRichHtml(node),"SMALL DECISIONS BUILD BIG CAREERS","back to the plain words");
  } finally {dom.restore();}
  // Opened again later, or colored by the chat: the words lose their color and keep their text.
  for(const element of [colored,{...headline,richText:'<span style="color: #00d98a">SMALL DECISIONS</span> BUILD BIG CAREERS'}]){
    const again=installRichDom();
    try {
      const node=editable(again,element),range=select(again,node,"SMALL DECISIONS");
      assert.equal(format(again,scene,element,node,range,{color:null}),true);
      const html=rich.editorRichHtml(node);
      assert.doesNotMatch(html,/color:/);
      assert.equal(model.richTextToPlain(html),headline.text);
    } finally {again.restore();}
  }
  // The template's own highlight comes off the same way.
  const sample=template().pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
  const highlighted=installRichDom();
  try {
    const node=editable(highlighted,sample),range=select(highlighted,node,"FELL ALMOST 30%");
    assert.equal(format(highlighted,scene,sample,node,range,{color:null}),true);
    assert.doesNotMatch(rich.editorRichHtml(node),/color:/);
  } finally {highlighted.restore();}
});

test("the text toolbar offers each highlight color and No color for the selected words",()=>{
  const colors=[{name:"Accent green",color:GREEN},{name:"Accent purple",color:"#a855f7"}],picked=[];
  const html=renderToStaticMarkup(React.createElement(WordColorControls,{colors,onColor:color=>picked.push(color)}));
  assert.match(html,/^<span class="te-word-colors" role="group" aria-label="Word colors">/);
  assert.match(html,/<button type="button" class="te-word-color" aria-label="Color selected text Accent green" title="Accent green"><span class="te-word-color-chip" style="background:#00d98a" aria-hidden="true"><\/span><\/button>/);
  assert.match(html,/aria-label="Color selected text Accent purple" title="Accent purple"/);
  assert.match(html,/aria-label="Remove color from selected text" title="No color"><span class="te-word-color-chip is-none"/);
  assert.equal((html.match(/<button/g)||[]).length,3);
  const buttons=[WordColorControls({colors,onColor:color=>picked.push(color)}).props.children].flat(Infinity);
  for(const button of buttons)button.props.onClick();
  assert.deepEqual(picked,[GREEN,"#a855f7",null]);
  assert.equal((renderToStaticMarkup(React.createElement(WordColorControls,{colors,onColor(){},disabled:true})).match(/disabled=""/g)||[]).length,3);
});
