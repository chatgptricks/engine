export type HistoryDirection = "undo" | "redo";
export interface HistoryContext {pageId:string;selectedIds:string[];editingMaster:boolean;isolatedGroupId:string|null}
export interface HistoryEntry<T> {document:T;context:HistoryContext}
export interface DocumentHistory<T> {past:HistoryEntry<T>[];future:HistoryEntry<T>[];group:string;scope:string;time:number}
export function createDocumentHistory<T>():DocumentHistory<T> {return {past:[],future:[],group:"",scope:"",time:0};}
function equal(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(!left||!right||typeof left!=="object"||typeof right!=="object")return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>equal(value,right[index]));
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>;
  const keys=Object.keys(a).filter(key=>a[key]!==undefined),other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
}
/** A timestamp refresh or an equivalent immutable scene is not an edit. */
export function sameDocumentContent<T>(left:T,right:T):boolean {
  if(left===right)return true;
  if(!left||!right||typeof left!=="object"||typeof right!=="object")return equal(left,right);
  const a={...left},b={...right};delete (a as Record<string,unknown>).updatedAt;delete (b as Record<string,unknown>).updatedAt;
  return equal(a,b);
}
const copyContext=(context:HistoryContext):HistoryContext=>({...context,selectedIds:[...context.selectedIds]});
const contextScope=(context:HistoryContext)=>JSON.stringify([context.pageId,context.editingMaster,context.isolatedGroupId,[...context.selectedIds].sort()]);
export function closeHistoryGroup<T>(history:DocumentHistory<T>):void {history.group="";history.scope="";history.time=0;}
/** Only accepted changes enter history. Automatic text fitting belongs to its
 * originating edit and must not destroy redo after a journal travel. */
export function commitHistory<T>(history:DocumentHistory<T>,previous:T,next:T,context:HistoryContext,accept:(next:T)=>boolean|void,options:{group?:string;automatic?:boolean;now?:number;windowMs?:number;limit?:number}={}):boolean {
  if(sameDocumentContent(previous,next))return true;
  if(accept(next)===false)return false;
  if(options.automatic)return true;
  const now=options.now??Date.now(),scope=contextScope(context),group=options.group??"",elapsed=now-history.time;
  const coalescing=Boolean(group&&history.group===group&&history.scope===scope&&elapsed>=0&&elapsed<=(options.windowMs??1200));
  let reverted=false;
  if(!coalescing){history.past.push({document:previous,context:copyContext(context)});if(history.past.length>(options.limit??60))history.past.shift();}
  // Returning to a group's starting value leaves no invisible undo step.
  else if(sameDocumentContent(history.past.at(-1)?.document,next)){history.past.pop();reverted=true;}
  history.future=[];history.group=group;history.scope=scope;history.time=now;
  if(reverted||!history.past.length)closeHistoryGroup(history);
  return true;
}
export function travelHistory<T>(history:DocumentHistory<T>,current:T,context:HistoryContext,direction:HistoryDirection,accept:(next:T)=>boolean|void,prepare:(next:T)=>T=value=>value):HistoryEntry<T>|undefined {
  const source=direction==="undo"?history.past:history.future,snapshot=source.at(-1);
  if(!snapshot)return undefined;
  const document=prepare(snapshot.document);
  if(accept(document)===false)return undefined;
  // Browsing another page does not change which scene this action belongs to.
  const sameScene=context.pageId===snapshot.context.pageId&&context.editingMaster===snapshot.context.editingMaster&&context.isolatedGroupId===snapshot.context.isolatedGroupId;
  const topology=(value:T)=>{const data=value as {pages?:{id:string}[];masterScene?:{elements:{id:string}[]};continuousCanvas?:unknown};return JSON.stringify([data.pages?.map(page=>page.id),data.masterScene?.elements.map(element=>element.id),Boolean(data.continuousCanvas)]);};
  // Add/remove page and master creation can themselves move the active view.
  const inverseContext=sameScene||topology(snapshot.document)!==topology(current)?context:snapshot.context;
  source.pop();(direction==="undo"?history.future:history.past).push({document:current,context:copyContext(inverseContext)});closeHistoryGroup(history);
  return {document,context:copyContext(snapshot.context)};
}
/** Native controls keep Space/letter activation; command history remains global. */
export function historyShortcut(event:{key:string;ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;altKey?:boolean;isComposing?:boolean;defaultPrevented?:boolean}):HistoryDirection|null {
  if(event.defaultPrevented||event.isComposing||event.altKey||(!event.ctrlKey&&!event.metaKey))return null;
  const key=event.key.toLowerCase();return key==="y"||key==="z"&&event.shiftKey?"redo":key==="z"?"undo":null;
}
