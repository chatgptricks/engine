import {parseCanvas} from "./model";
import type {ElementSnapshot} from "./commands";
export const ENGINE_CLIPBOARD_TYPE="application/x-engine-elements";
const PREFIX="ENGINE_ELEMENTS_V1\n";
const MAX_CLIPBOARD=30*1024*1024;
export function encodeElementClipboard(elements:ElementSnapshot,documentId:string):string {
  const text=PREFIX+JSON.stringify({version:1,documentId,elements:[...elements],groups:elements.groups,origin:elements.origin});
  if(text.length>MAX_CLIPBOARD)throw new Error("This selection is too large to copy. Copy fewer objects at a time.");
  return text;
}
export function decodeElementClipboard(text:string,documentId:string):ElementSnapshot|null {
  if(!text.startsWith(PREFIX))return null;
  if(text.length>MAX_CLIPBOARD)throw new Error("The copied selection exceeds the clipboard limit.");
  let payload;try{payload=JSON.parse(text.slice(PREFIX.length));}catch{throw new Error("The copied Engine objects are damaged. Copy them again.");}
  if(payload?.version!==1||typeof payload.documentId!=="string")throw new Error("This clipboard format is not supported. Copy the objects again.");
  const scene=parseCanvas({background:"transparent",elements:payload.elements,groups:payload.groups});
  if(!scene||!scene.elements.length)throw new Error("The clipboard does not contain valid Engine objects.");
  const elements:ElementSnapshot=scene.elements;
  if(payload.documentId!==documentId)for(const element of elements) {
    // Appearance travels with the selection. Document-local references must not
    // accidentally bind to an unrelated component/style in the destination.
    delete element.componentId;delete element.componentInstanceId;delete element.componentSourceId;delete element.colorRoleId;
    if(element.type==="text")delete element.textStyleId;
  }
  if(scene.groups)elements.groups=scene.groups;
  if(payload.origin!==undefined) {
    if(!payload.origin||![payload.origin.x,payload.origin.y].every(value=>typeof value==="number"&&Number.isFinite(value)&&Math.abs(value)<=10_000))throw new Error("The copied object's position is invalid.");
    elements.origin={x:payload.origin.x,y:payload.origin.y};
  }
  return elements;
}
export function plainClipboardText(text:string):string {
  if(text.length>20_000)throw new Error("Paste up to 20,000 characters at a time.");
  return text.replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
}
