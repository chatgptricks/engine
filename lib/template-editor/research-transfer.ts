import type {Story} from "@/lib/engine/types";
import {createBlankDesign,duplicatePage,sceneForPage,parseLibrary,EMPTY_LIBRARY,type DesignDocument,type EditorLibrary,type CanvasScene} from "./model";
import {createLibraryDesign,type CreationOptions} from "./library-workflows";
import {splitContinuousCarousel,enableContinuousCarousel} from "./continuous-carousel";
import {canEditElement,isElementHidden} from "./commands";
const KEY="engine:research-transfer";
export type ResearchTransferOptions=Pick<CreationOptions,'format'|'brandKitId'|'applyBrand'|'template'|'values'>&{imageIds:string[]};
export function researchImageIds(story:Story):string[]{const preferred=story.curation.order.length?story.curation.order:story.curation.selectedImageIds;return [...new Set((preferred.length?preferred:story.images.map(image=>image.id)).filter(id=>story.images.some(image=>image.id===id&&image.mediaType!=="video")))].slice(0,20);}
export function createResearchDesign(story:Story,options?:ResearchTransferOptions,library:EditorLibrary=EMPTY_LIBRARY):DesignDocument {
  const ids=options?.imageIds??researchImageIds(story);
  if(ids.length>20||new Set(ids).size!==ids.length)throw new Error('Select up to 20 different images.');
  const images=ids.map(id=>{const image=story.images.find(image=>image.id===id&&image.mediaType!=="video");if(!image)throw new Error('One selected image is no longer available.');return image;});
  let design=options?createLibraryDesign(library,{name:story.title.slice(0,200),format:options.format,pageCount:Math.max(1,images.length),layout:'separate',brandKitId:options.brandKitId,applyBrand:options.applyBrand,template:options.template,values:options.values}):createBlankDesign(story.title.slice(0,200),'portrait');
  const continuous=Boolean(options?.template?.continuousCanvas);
  if(design.continuousCanvas)design=splitContinuousCarousel(design);
  design.caption=story.curation.captionEdited??story.caption.draft;
  const patterns=design.pages,initial=patterns[0];
  if(!options?.template){design.pages=images.length?images.map((image,index)=>({...duplicatePage(initial),image:{...image,id:crypto.randomUUID()},style:{...initial.style,heading:index===0?story.caption.titleOverImage.text||story.title:'',body:'',...story.curation.slideStyles[image.id],template:story.curation.slideStyles[image.id]?.template??'overlay'},canvas:undefined})):[{...initial,style:{...initial.style,heading:story.title,body:story.description},canvas:undefined}];
    design.pages=design.pages.map(page=>({...page,canvas:sceneForPage(page,design.format)}));
    if(options?.applyBrand){const kit=library.brandKits.find(kit=>kit.id===options.brandKitId);if(kit)design.pages=design.pages.map(page=>({...page,canvas:{...page.canvas!,background:kit.background,elements:page.canvas!.elements.map(element=>element.type==='text'?{...element,color:kit.text,font:kit.font}:element)}}));}
  }else{
    design.pages=Array.from({length:Math.max(images.length,patterns.length)},(_,index)=>{const page=duplicatePage(patterns[index%patterns.length]),image=images[index];let content:CanvasScene=page.canvas??sceneForPage(page,design.format);let photoUsed=false,titleUsed=false;
      content={...content,elements:content.elements.map(element=>{if(!canEditElement(content,element,'content')||isElementHidden(content,element))return element;
        if(image&&!photoUsed&&(element.type==='image'||(element.type==='shape'&&(element.imageFill||element.slot)))){photoUsed=true;const photo={src:image.url,alt:image.description??image.directive,directive:image.directive,rightsNote:image.rightsNote,sourceUrl:image.sourceUrl,intrinsicWidth:image.width,intrinsicHeight:image.height,cropX:50,cropY:50,cropScale:1};return element.type==='image'?{...element,...photo}:{...element,imageFill:{...photo,objectFit:'cover' as const}};}
        if(element.type==='text'&&!titleUsed){titleUsed=true;return {...element,text:index===0?story.caption.titleOverImage.text||story.title:story.curation.slideStyles[image?.id??'']?.heading??'',richText:undefined,wordTextures:undefined};}return element;})};
      if(image&&!photoUsed)throw new Error(`Template page ${index%patterns.length+1} needs an editable photo or photo frame. Choose another template or use Research layouts.`);
      return {...page,...(image?{image:{...image,id:crypto.randomUUID()}}:{}),canvas:content};});
    if(continuous&&design.pages.length>1)design=enableContinuousCarousel(design);
  }
  const safe=parseLibrary({...EMPTY_LIBRARY,designs:[design]});if(!safe)throw new Error('Some artwork is not supported. Choose saved JPG, PNG, WebP or a sanitized logo.');return safe.designs[0];
}
export function transferResearchDocument(document:DesignDocument,scope?:string):void {const parsed=parseLibrary({...EMPTY_LIBRARY,designs:[document]});if(!parsed)throw new Error('This design is not valid.');const json=JSON.stringify(scope?{scope,document:parsed.designs[0]}:parsed.designs[0]);if(new TextEncoder().encode(json).byteLength>10*1024*1024)throw new Error('This research is too large to transfer. Choose fewer images.');sessionStorage.setItem(KEY,json);}
export function transferResearch(story:Story,options?:ResearchTransferOptions,library?:EditorLibrary):void {transferResearchDocument(createResearchDesign(story,options,library));}
export function peekResearchTransfer(scope?:string):DesignDocument|null {try{const json=sessionStorage.getItem(KEY);if(!json)return null;const value=JSON.parse(json);if(value?.document&&scope&&value.scope!==scope)return null;return parseLibrary({...EMPTY_LIBRARY,designs:[value?.document??value]})?.designs[0]??null;}catch{return null;}}
export function acknowledgeResearchTransfer(documentId:string):boolean {const pending=peekResearchTransfer();if(pending?.id!==documentId)return false;sessionStorage.removeItem(KEY);return true;}
/** Compatibility name now reads without acknowledging; the accepting workspace owns acknowledgement. */
export function consumeResearchTransfer():DesignDocument|null{return peekResearchTransfer();}
