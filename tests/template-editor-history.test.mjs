import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {installRichDom} from "./helpers-rich-dom.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const requireModule=createRequire(import.meta.url);
function load(relative,dependencies={}) {
  const filename=path.join(root,relative),unit={exports:{}};
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>Object.hasOwn(dependencies,name)?dependencies[name]:requireModule(name),unit,unit.exports);
  return unit.exports;
}
const registry=load("lib/template-editor/editor-commands.ts");
const history=load("lib/template-editor/history.ts",{"./editor-commands":registry}),model=load("lib/template-editor/model.ts");
const commands=load("lib/template-editor/commands.ts",{"./model":model});
const colors=load("lib/template-editor/color-utils.ts");
const rich=load("lib/template-editor/rich-text-editing.ts",{"./model":model,"./color-utils":colors});
const {createDocumentHistory,commitHistory,travelHistory,closeHistoryGroup,sameDocumentContent,historyShortcut}=history;
const context=(patch={})=>({pageId:"page-a",selectedIds:["text-a"],editingMaster:false,isolatedGroupId:null,...patch});
const doc=(patch={})=>({id:"doc",name:"Untitled",updatedAt:"2026-10-12T00:00:00Z",text:"Start",...patch});
const accepted=()=>true;
const edit=(journal,previous,next,options={},view=context())=>assert.equal(commitHistory(journal,previous,next,view,accepted,options),true);

test("equivalent immutable scenes and timestamp refreshes preserve Redo without autosaving",()=>{
  const journal=createDocumentHistory(),before=doc(),after=doc({text:"Changed"});
  edit(journal,before,after);
  const restored=travelHistory(journal,after,context(),"undo",accepted).document;
  let writes=0;
  const equivalent={text:restored.text,name:restored.name,id:restored.id,updatedAt:"later",optional:undefined};
  assert.equal(commitHistory(journal,restored,equivalent,context(),()=>{writes++;}),true);
  assert.equal(writes,0);assert.equal(journal.past.length,0);assert.equal(journal.future.length,1);
  assert.equal(travelHistory(journal,restored,context(),"redo",accepted).document.text,"Changed");
});

test("automatic text fitting belongs to Add Text and needs only one Undo",()=>{
  const journal=createDocumentHistory(),text={...model.createCanvasElement("text"),id:"text-a",height:80,textMode:"auto-height"};
  const before=doc({pages:[{id:"page-a",canvas:{background:"#fff",elements:[]}}]}),added={...before,pages:[{id:"page-a",canvas:{background:"#fff",elements:[text]}}]};
  edit(journal,before,added);
  const fitted={...added,pages:[{id:"page-a",canvas:{background:"#fff",elements:[{...text,height:32}]}}]};
  edit(journal,added,fitted,{automatic:true});
  assert.equal(journal.past.length,1);
  const undo=travelHistory(journal,fitted,context(),"undo",accepted);
  assert.equal(undo.document.pages[0].canvas.elements.length,0);
  assert.equal(travelHistory(journal,undo.document,context(),"redo",accepted).document.pages[0].canvas.elements[0].height,32);
});

test("automatic fitting after Undo does not remove the forward branch",()=>{
  const journal=createDocumentHistory(),before=doc({height:100}),after=doc({height:100,text:"Long text"});
  edit(journal,before,after);
  const undo=travelHistory(journal,after,context(),"undo",accepted).document;
  const fitted={...undo,height:32};edit(journal,undo,fitted,{automatic:true});
  assert.equal(journal.past.length,0);assert.equal(journal.future.length,1);
  assert.equal(travelHistory(journal,fitted,context(),"redo",accepted).document.text,"Long text");
});

test("normal typing coalesces across a brief pause and separates after a longer pause",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"S"}),c=doc({text:"St"}),d=doc({text:"Sta"});
  edit(journal,a,b,{group:"text:text-a",now:1000});
  edit(journal,b,c,{group:"text:text-a",now:1900});
  assert.equal(journal.past.length,1);
  edit(journal,c,d,{group:"text:text-a",now:3201});
  assert.equal(journal.past.length,2);
  const first=travelHistory(journal,d,context(),"undo",accepted).document;
  assert.equal(first.text,"St");
  assert.equal(travelHistory(journal,first,context(),"undo",accepted).document.text,"Start");
});

test("blur and re-enter create separate sessions even within the typing interval",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"First session"}),c=doc({text:"Second session"});
  edit(journal,a,b,{group:"text:text-a",now:1000});closeHistoryGroup(journal);
  edit(journal,b,c,{group:"text:text-a",now:1100});
  assert.equal(journal.past.length,2);
  assert.equal(travelHistory(journal,c,context(),"undo",accepted).document.text,"First session");
});

test("the same property group cannot coalesce across pages, layers, masters or isolation",()=>{
  for(const other of [context({pageId:"page-b"}),context({selectedIds:["text-b"]}),context({editingMaster:true}),context({isolatedGroupId:"group-a"})]){
    const journal=createDocumentHistory(),a=doc(),b=doc({text:"B"}),c=doc({text:"C"});
    edit(journal,a,b,{group:"color",now:1000});edit(journal,b,c,{group:"color",now:1100},other);
    assert.equal(journal.past.length,2);
  }
});

test("selection order does not split an otherwise continuous multi-layer action",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"B"}),c=doc({text:"C"});
  edit(journal,a,b,{group:"move",now:1000},context({selectedIds:["a","b"]}));
  edit(journal,b,c,{group:"move",now:1100},context({selectedIds:["b","a"]}));
  assert.equal(journal.past.length,1);
});

test("a rejected edit cannot consume Redo or alter the current coalescing group",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"B"});edit(journal,a,b,{group:"text",now:1000});
  travelHistory(journal,b,context(),"undo",accepted);
  const snapshot=structuredClone(journal);
  assert.equal(commitHistory(journal,a,doc({text:"Rejected"}),context(),()=>false,{group:"text",now:1100}),false);
  assert.deepEqual(journal,snapshot);
});

test("a rejected Undo or Redo leaves both stacks and view contexts intact",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"B"});edit(journal,a,b);
  let snapshot=structuredClone(journal);
  assert.equal(travelHistory(journal,b,context(),"undo",()=>false),undefined);assert.deepEqual(journal,snapshot);
  const undo=travelHistory(journal,b,context(),"undo",accepted).document;snapshot=structuredClone(journal);
  assert.equal(travelHistory(journal,undo,context(),"redo",()=>false),undefined);assert.deepEqual(journal,snapshot);
});

test("typing a value and reverting it leaves no invisible step or unrelated coalescing",()=>{
  const journal=createDocumentHistory(),original=doc(),base=doc({name:"Renamed"}),typed={...base,text:"Draft"};
  edit(journal,original,base,{group:"name",now:1000});
  edit(journal,base,typed,{group:"text",now:1100});edit(journal,typed,base,{group:"text",now:1200});
  assert.equal(journal.past.length,1);assert.equal(journal.group,"");
  const again={...base,text:"Final"};edit(journal,base,again,{group:"text",now:1300});
  assert.equal(journal.past.length,2);
  assert.equal(travelHistory(journal,again,context(),"undo",accepted).document.text,"Start");
});

test("a new accepted action replaces the forward branch",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"B"}),c=doc({text:"C"});edit(journal,a,b);
  const undo=travelHistory(journal,b,context(),"undo",accepted).document;edit(journal,undo,c);
  assert.equal(journal.future.length,0);assert.equal(travelHistory(journal,c,context(),"redo",accepted),undefined);
  assert.equal(travelHistory(journal,c,context(),"undo",accepted).document.text,"Start");
});

test("Undo and Redo follow the affected page after browsing another page",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"Edited on A"});
  const origin=context({selectedIds:["text-a"],isolatedGroupId:"group-a"});edit(journal,a,b,{},origin);
  const elsewhere=context({pageId:"page-b",selectedIds:["text-b"]});
  const undo=travelHistory(journal,b,elsewhere,"undo",accepted);
  assert.deepEqual(undo.context,origin);
  const redo=travelHistory(journal,undo.document,undo.context,"redo",accepted);
  assert.deepEqual(redo.context,origin);assert.equal(redo.document.text,"Edited on A");
});

test("view snapshots are detached and include the master and group isolation",()=>{
  const journal=createDocumentHistory(),a=doc(),b=doc({text:"Master edited"}),view=context({editingMaster:true,isolatedGroupId:"master-group"});
  edit(journal,a,b,{},view);view.selectedIds.push("later");view.isolatedGroupId=null;
  const undo=travelHistory(journal,b,context(),"undo",accepted);
  assert.deepEqual(undo.context,{pageId:"page-a",selectedIds:["text-a"],editingMaster:true,isolatedGroupId:"master-group"});
  undo.context.selectedIds.push("mutated-output");
  assert.deepEqual(journal.future[0].context.selectedIds,["text-a"]);
});

test("rich text formatting and nested photo textures round-trip without altering content",()=>{
  const journal=createDocumentHistory(),fill={src:"https://example.com/photo.jpg",objectFit:"cover",cropX:25,cropY:75,cropScale:1.5,rightsNote:"Licensed"};
  const text={...model.createCanvasElement("text"),id:"text-a",text:"Gold sky",richText:"Gold sky"};
  const a=doc({pages:[{id:"page-a",canvas:{background:"#fff",elements:[text]}}]});
  const formatted={...text,richText:'<b><span data-texture-id="gold">Gold</span></b> sky',wordTextures:[{...fill,id:"gold"}]};
  const b={...a,pages:[{id:"page-a",canvas:{background:"#fff",elements:[formatted]}}]};edit(journal,a,b,{group:"text-format:text-a:1"});
  const undo=travelHistory(journal,b,context(),"undo",accepted);
  assert.deepEqual(undo.document.pages[0].canvas.elements[0],text);
  const redo=travelHistory(journal,undo.document,undo.context,"redo",accepted);
  assert.deepEqual(redo.document.pages[0].canvas.elements[0],formatted);
});

test("protected and locked no-op commands do not create steps or delete Redo",()=>{
  const journal=createDocumentHistory(),locked={...model.createCanvasElement("shape"),id:"locked",locked:true},protectedLayer={...model.createCanvasElement("shape"),id:"protected",protected:["delete"]};
  const a=doc({pages:[{id:"page-a",canvas:{background:"#fff",elements:[locked,protectedLayer]}}]}),b={...a,name:"Changed"};edit(journal,a,b);
  const undo=travelHistory(journal,b,context(),"undo",accepted).document;
  const command=commands.removeSelection(undo.pages[0].canvas,["locked","protected"]);
  assert.equal(command.scene.elements.length,2);
  edit(journal,undo,{...undo,pages:[{...undo.pages[0],canvas:command.scene}]});
  assert.equal(journal.past.length,0);assert.equal(journal.future.length,1);
});

test("page removal is restored atomically with the viewed page and selected layers",()=>{
  const journal=createDocumentHistory(),a=doc({pages:[{id:"page-a"},{id:"page-b"}]}),b={...a,pages:[{id:"page-a"}]};
  const view=context({pageId:"page-b",selectedIds:["on-b"]});edit(journal,a,b,{},view);
  const undo=travelHistory(journal,b,context(),"undo",accepted);
  assert.deepEqual(undo.document.pages.map(page=>page.id),["page-a","page-b"]);assert.equal(undo.context.pageId,"page-b");
  assert.deepEqual(undo.context.selectedIds,["on-b"]);
});

test("Add Page replays its newly selected page rather than the previous view",()=>{
  const journal=createDocumentHistory(),a=doc({pages:[{id:"page-a"}]}),b={...a,pages:[{id:"page-a"},{id:"page-new"}]};
  edit(journal,a,b,{},context({selectedIds:[]}));
  const undo=travelHistory(journal,b,context({pageId:"page-new",selectedIds:[]}),"undo",accepted);
  assert.equal(undo.context.pageId,"page-a");
  assert.equal(travelHistory(journal,undo.document,undo.context,"redo",accepted).context.pageId,"page-new");
});

test("promoting objects to an existing master restores the master editing view on Redo",()=>{
  const journal=createDocumentHistory(),a=doc({pages:[{id:"page-a"}],masterScene:{elements:[{id:"old"}]}}),b={...a,masterScene:{elements:[{id:"old"},{id:"promoted"}]}};
  edit(journal,a,b);
  const undo=travelHistory(journal,b,context({editingMaster:true,selectedIds:[]}),"undo",accepted);
  assert.equal(undo.context.editingMaster,false);
  assert.equal(travelHistory(journal,undo.document,undo.context,"redo",accepted).context.editingMaster,true);
});

test("switching to continuous mode preserves the action's destination page on Redo",()=>{
  const journal=createDocumentHistory(),a=doc({pages:[{id:"page-a"},{id:"page-b"}]}),b={...a,continuousCanvas:{elements:[]}};
  edit(journal,a,b,{},context({pageId:"page-b"}));
  const undo=travelHistory(journal,b,context({pageId:"page-a"}),"undo",accepted);
  assert.equal(undo.context.pageId,"page-b");
  assert.equal(travelHistory(journal,undo.document,undo.context,"redo",accepted).context.pageId,"page-a");
});

test("a duplicate drag restores original selection on Undo and copied selection on Redo",()=>{
  const journal=createDocumentHistory(),original={...model.createCanvasElement("shape"),id:"original"};
  const source={background:"#fff",elements:[original]},duplicate=commands.duplicateSelection(source,[original.id]);
  const a=doc({pages:[{id:"page-a",canvas:source}]}),b={...a,pages:[{id:"page-a",canvas:duplicate.scene}]};
  edit(journal,a,b,{},context({selectedIds:[original.id]}));
  const undo=travelHistory(journal,b,context({selectedIds:duplicate.selectedIds}),"undo",accepted);
  assert.deepEqual(undo.context.selectedIds,[original.id]);assert.equal(undo.document.pages[0].canvas.elements.length,1);
  const redo=travelHistory(journal,undo.document,undo.context,"redo",accepted);
  assert.deepEqual(redo.context.selectedIds,duplicate.selectedIds);assert.equal(redo.document.pages[0].canvas.elements.length,2);
});

test("underline and strike changes invalidate editable DOM even when rich HTML stays unchanged",()=>{
  const base={text:"word",richText:"word",underline:false,strikethrough:false};
  assert.notEqual(rich.textEditingFingerprint(base),rich.textEditingFingerprint({...base,underline:true}));
  assert.notEqual(rich.textEditingFingerprint(base),rich.textEditingFingerprint({...base,strikethrough:true}));
  assert.equal(rich.textEditingFingerprint(base),rich.textEditingFingerprint({...base,unrelated:"metadata"}));
  const dom=installRichDom();
  try{
    const node=dom.node(`<div>${rich.resolveRichDecorations(base.richText)}</div>`),range=dom.range(node),text=dom.textNodes(node)[0];
    range.setStart(text,2);range.setEnd(text,2);
    const bookmark=rich.captureTextSelection(node,range);
    node.innerHTML=`<div>${rich.resolveRichDecorations(base.richText,true)}</div>`;
    rich.restoreTextSelection(node,range,bookmark);
    assert.equal(range.collapsed,true);assert.equal(range.startOffset,2);
    assert.equal(range.startContainer.textContent,"word");
    assert.match(rich.editorRichHtml(node),/text-decoration:underline/);
  }finally{dom.restore();}
});

test("DOM synchronization preserves a rich selection across multiline paragraphs",()=>{
  const dom=installRichDom();
  try{
    const node=dom.node("<div>Alpha</div><div>Beta</div>"),range=dom.range(node),texts=dom.textNodes(node);
    range.setStart(texts[0],2);range.setEnd(texts[1],3);
    const bookmark=rich.captureTextSelection(node,range);
    assert.deepEqual(bookmark,{start:2,end:9});
    node.innerHTML='<div><b>Alpha</b></div><div><i>Beta</i></div>';
    rich.restoreTextSelection(node,range,bookmark);
    assert.equal(range.startContainer.textContent,"Alpha");assert.equal(range.startOffset,2);
    assert.equal(range.endContainer.textContent,"Beta");assert.equal(range.endOffset,3);
  }finally{dom.restore();}
});

test("restoring a caret clamps offsets after text is shortened or removed",()=>{
  const dom=installRichDom();
  try{
    const node=dom.node("<div>Short</div>"),range=dom.range(node);
    rich.restoreTextSelection(node,range,{start:40,end:40});
    assert.equal(range.startOffset,5);assert.equal(range.endOffset,5);
    node.innerHTML="<div><br></div>";rich.restoreTextSelection(node,range,{start:40,end:40});
    assert.equal(range.startContainer,node);assert.equal(range.collapsed,true);
  }finally{dom.restore();}
});

test("history is bounded to 60 accepted actions",()=>{
  const journal=createDocumentHistory();let current=doc({text:"0"});
  for(let index=1;index<=70;index++){const next=doc({text:String(index)});edit(journal,current,next);current=next;}
  assert.equal(journal.past.length,60);
  for(let index=69;index>=10;index--){const entry=travelHistory(journal,current,context(),"undo",accepted);assert.equal(entry.document.text,String(index));current=entry.document;}
  assert.equal(travelHistory(journal,current,context(),"undo",accepted),undefined);assert.equal(journal.future.length,60);
});

test("Mac and Windows shortcuts share journal history and ignore IME or handled events",()=>{
  const key=(patch)=>({key:"z",ctrlKey:false,metaKey:false,shiftKey:false,...patch});
  assert.equal(historyShortcut(key({metaKey:true})),"undo");assert.equal(historyShortcut(key({ctrlKey:true})),"undo");
  assert.equal(historyShortcut(key({metaKey:true,shiftKey:true})),"redo");assert.equal(historyShortcut(key({ctrlKey:true,shiftKey:true})),"redo");
  assert.equal(historyShortcut(key({key:"Y",ctrlKey:true})),"redo");
  for(const event of [key({}),key({key:" ",ctrlKey:true}),key({ctrlKey:true,altKey:true}),key({ctrlKey:true,isComposing:true}),key({ctrlKey:true,defaultPrevented:true})])assert.equal(historyShortcut(event),null);
});

test("content comparisons detect nested changes but ignore absent optional fields",()=>{
  assert.equal(sameDocumentContent(doc({pages:[{id:"p",canvas:{elements:[],groups:undefined}}]}),doc({pages:[{id:"p",canvas:{elements:[]}}],updatedAt:"later"})),true);
  assert.equal(sameDocumentContent(doc({pages:[{id:"p",canvas:{elements:[{x:1}]}}]}),doc({pages:[{id:"p",canvas:{elements:[{x:2}]}}]})),false);
});

// DOM KeyboardEvent fields are getters on the prototype, not enumerable data.
test("native keyboard event prototype fields retain undo and redo shortcuts",()=>{
  for(const [shiftKey,expected] of [[false,"undo"],[true,"redo"]]){
    const values={key:"z",metaKey:true,ctrlKey:false,shiftKey,altKey:false,isComposing:false,defaultPrevented:false};
    const prototype=Object.create(null);
    for(const [key,value] of Object.entries(values))Object.defineProperty(prototype,key,{get:()=>value});
    const event=Object.create(prototype);
    assert.deepEqual(Object.keys(event),[]);
    assert.equal(historyShortcut(event),expected);
  }
});
