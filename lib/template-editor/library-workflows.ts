import { createCanvasElement, createBlankDesign, createBlankTemplateDesign, createDesign, cloneDesign, designAsTemplate, duplicatePage, duplicateCanvasScene, libraryBrandKits, withBrandKits, parseLibrary, sceneForPage, type EditorLibrary, type DesignDocument, type DesignTemplate, type DesignFormat, type CanvasScene, type BrandAsset, type TextStyle, type ReusableComponent } from "./model";
import { instantiateTemplate, resizeDesignDocument, updateTextStyle, updateComponentInstances, applyTextStyle, insertComponent } from "./advanced";
import { enableContinuousCarousel, splitContinuousCarousel } from "./continuous-carousel";
import { canEditElement, isElementHidden, constrainSceneToIsolation } from "./commands";
import { libraryTemplates, withImportedTemplateStates } from "./template-catalog";
import { stableStringify } from "./library-sync";

export type CreationOptions = {name:string;format:DesignFormat;pageCount:number;layout:"separate"|"continuous";brandKitId:string;applyBrand:boolean;size?:{width:number;height:number};template?:DesignTemplate;values?:Record<string,string>;purpose?:"template"};
export function brandScene(scene:CanvasScene, brand:EditorLibrary["brand"]):CanvasScene {
  return {...scene,background:brand.background,elements:scene.elements.map(element=>canEditElement(scene,element,"style")&&!isElementHidden(scene,element)&&element.type==="text"?{...element,font:brand.font,color:brand.text,textStyleId:undefined,colorRoleId:undefined}:element)};
}
export function createLibraryDesign(library:EditorLibrary, options:CreationOptions):DesignDocument {
  if(library.designs.length>=150)throw new Error("This workspace has reached its 150-project limit.");
  if(!Number.isInteger(options.pageCount)||options.pageCount<1||options.pageCount>20)throw new Error("Choose 1–20 pages.");
  const template=options.template;
  if(template&&!libraryTemplates(library).some(item=>item.id===template.id))throw new Error("This template is no longer available.");
  let design=template?instantiateTemplate(template,options.values??{},options.name.trim()||template.name):options.purpose==="template"?createBlankTemplateDesign(options.name,options.format):createBlankDesign(options.name,options.format);
  if(template)design={...design,name:options.name.trim()||template.name};
  if(!template){design.pages=[design.pages[0],...Array.from({length:options.pageCount-1},()=>duplicatePage(design.pages[0]))];}
  const dimensions=options.size??{width:1080,height:options.format==="square"?1080:options.format==="story"?1920:1350};
  if(template||options.size)design={...resizeDesignDocument(design,dimensions,"contain"),format:options.format,...(!options.size?{customSize:undefined}:{})};
  if(options.layout==="continuous"&&design.pages.length<2)throw new Error("A continuous carousel needs at least two pages.");
  if(options.layout==="continuous"&&!design.continuousCanvas)design=enableContinuousCarousel(design);
  if(options.layout==="separate"&&design.continuousCanvas)design=splitContinuousCarousel(design);
  if(options.applyBrand){const kit=libraryBrandKits(library).find(item=>item.id===options.brandKitId);if(!kit)throw new Error("Choose an available brand kit.");design={...design,pages:design.pages.map(page=>({...page,canvas:brandScene(page.canvas??sceneForPage(page,design.format),kit)})),...(design.continuousCanvas?{continuousCanvas:brandScene(design.continuousCanvas,kit)}:{}),...(design.masterScene?{masterScene:brandScene(design.masterScene,kit)}:{})};}
  return design;
}

export type LibraryItemKey=`design:${string}`|`template:${string}`;
export type SearchFilters={folder:string;favorites:boolean;tag:string;format?:DesignFormat|"custom"|"";purpose?:"post"|"template"|"";review?:"draft"|"review"|"approved"|"";sort?:"updated"|"name"|"created"|"pages"};
export function librarySearchText(item:DesignDocument|DesignTemplate):string {
  const content=item.pages.flatMap(page=>[page.label,page.style.heading,page.style.body,...(page.canvas?.elements??[]).flatMap(element=>[element.name,element.type==="text"?element.text:""])]);
  return [item.name,...item.tags??[],"caption"in item?item.caption:item.description,"category"in item?item.category:undefined,...content,...([...(item.continuousCanvas?.elements??[]),...(item.masterScene?.elements??[])]).flatMap(element=>[element.name,element.type==="text"?element.text:""])].filter(Boolean).join(" ").toLocaleLowerCase();
}
export function matchesLibraryItem(item:DesignDocument|DesignTemplate,filters:SearchFilters,query=""):boolean {
  return !item.deletedAt&&(!filters.folder||item.folderId===filters.folder)&&(!filters.favorites||Boolean(item.favorite))&&(!filters.tag||(item.tags??[]).some(tag=>tag.toLowerCase().includes(filters.tag.trim().toLowerCase())))&&(!filters.format||(filters.format==="custom"?Boolean(item.customSize):!item.customSize&&item.format===filters.format))&&(!filters.purpose||(filters.purpose==="template"?("purpose"in item?item.purpose==="template":true):"caption"in item&&item.purpose!=="template"))&&(!filters.review||("caption"in item?(item.reviewStatus??"draft")===filters.review:false))&&librarySearchText(item).includes(query.trim().toLocaleLowerCase());
}
export function sortLibraryItems<T extends DesignDocument|DesignTemplate>(items:T[],sort:SearchFilters["sort"]):T[] {
  return [...items].sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):sort==="pages"?b.pages.length-a.pages.length:sort==="created"?("createdAt"in b?b.createdAt:"").localeCompare("createdAt"in a?a.createdAt:""):("updatedAt"in b?b.updatedAt:"").localeCompare("updatedAt"in a?a.updatedAt:""));
}
export function bulkLibraryMetadata(library:EditorLibrary,keys:readonly LibraryItemKey[],metadata:{folderId?:string;tags?:string[];favorite?:boolean},tagMode:"add"|"replace"="add"):EditorLibrary {
  if(metadata.folderId&&!library.folders?.some(folder=>folder.id===metadata.folderId))throw new Error("This folder is no longer available.");
  const selected=new Set(keys),tags=metadata.tags?.map(tag=>tag.trim().slice(0,40)).filter(Boolean);
  const update=<T extends DesignDocument|DesignTemplate>(item:T):T=>({...item,...("folderId"in metadata?{folderId:metadata.folderId}:{}),...(metadata.favorite!==undefined?{favorite:metadata.favorite}:{}),...(tags?{tags:[...new Set([...(tagMode==="add"?item.tags??[]:[]),...tags])].slice(0,20)}:{}),...("updatedAt"in item?{updatedAt:new Date().toISOString()}:{})});
  const templates=[...library.templates];
  for(const builtin of libraryTemplates(library).filter(template=>!template.custom&&selected.has(`template:${template.id}`))){if(templates.length>=80)throw new Error("Copying starter templates would exceed the 80-template limit.");templates.push(update(designAsTemplate(createDesign(builtin),builtin.name)));}
  return {...library,designs:library.designs.map(item=>selected.has(`design:${item.id}`)&&!item.deletedAt?update(item):item),templates:templates.map(item=>selected.has(`template:${item.id}`)&&!item.deletedAt?update(item):item)};
}
export function selectedLibrary(library:EditorLibrary,keys:readonly LibraryItemKey[]):EditorLibrary {
  const selected=new Set(keys),designs=library.designs.filter(item=>!item.deletedAt&&selected.has(`design:${item.id}`)),templates=libraryTemplates(library).filter(item=>selected.has(`template:${item.id}`)||designs.some(design=>item.custom&&(design.templateId===item.id||design.editingTemplateId===item.id)));
  const items=[...designs,...templates],styleIds=new Set(items.flatMap(item=>item.styles?.flatMap(style=>style.workspaceSourceId?[style.workspaceSourceId]:[])??[])),componentIds=new Set(items.flatMap(item=>item.components?.flatMap(component=>component.workspaceSourceId?[component.workspaceSourceId]:[])??[]));
  const workspaceStyles=library.workspaceStyles?.filter(style=>styleIds.has(style.id)),workspaceComponents=library.workspaceComponents?.filter(component=>componentIds.has(component.id));
  const sources=new Set<string>();const visit=(value:unknown,key="")=>{if(typeof value==="string"&&(key==="src"||key==="url"))sources.add(value);else if(Array.isArray(value))value.forEach(child=>visit(child,key));else if(value&&typeof value==="object")for(const [field,child]of Object.entries(value))visit(child,field);};visit([items,workspaceStyles,workspaceComponents]);
  const kits=libraryBrandKits(library).map(kit=>({...kit,assets:kit.assets.filter(asset=>sources.has(asset.src))})).filter(kit=>kit.id===library.activeBrandKitId||kit.assets.length>0);
  return withBrandKits({...library,designs,templates,builtInTemplateStates:undefined,workspaceStyles,workspaceComponents,folders:library.folders?.filter(folder=>items.some(item=>item.folderId===folder.id))},kits,library.activeBrandKitId);
}
export function organizeBrandAsset(library:EditorLibrary,sourceId:string,assetId:string,patch:Pick<BrandAsset,"tags"|"favorite"|"variant">,destinationId=sourceId,copy=false):EditorLibrary {
  const kits=libraryBrandKits(library),source=kits.find(kit=>kit.id===sourceId),destination=kits.find(kit=>kit.id===destinationId),asset=source?.assets.find(item=>item.id===assetId);
  if(!source||!destination||!asset)throw new Error("This asset or brand kit is no longer available.");
  if((copy||sourceId!==destinationId)&&destination.assets.length>=40)throw new Error("The destination kit has reached its 40-asset limit.");
  const updated={...structuredClone(asset),...patch,...(patch.tags?{tags:[...new Set(patch.tags.map(tag=>tag.trim().slice(0,40)).filter(Boolean))].slice(0,20)}:{}),...(copy?{id:crypto.randomUUID()}:{} )};
  const changed=kits.map(kit=>{if(sourceId===destinationId&&kit.id===sourceId)return {...kit,assets:copy?[...kit.assets,updated]:kit.assets.map(item=>item.id===assetId?updated:item)};if(kit.id===sourceId&&!copy)return {...kit,assets:kit.assets.filter(item=>item.id!==assetId)};if(kit.id===destinationId)return {...kit,assets:[...kit.assets,updated]};return kit;});
  return withBrandKits(library,changed,library.activeBrandKitId);
}

export type ImportCollection="designs"|"templates"|"brandKits"|"folders"|"workspaceStyles"|"workspaceComponents";
export type ImportSelection=Record<ImportCollection,string[]>;
export type ImportMode="copies"|"skip"|"merge";
export function allImportItems(library:EditorLibrary):ImportSelection{return Object.fromEntries((['designs','templates','brandKits','folders','workspaceStyles','workspaceComponents'] as const).map(key=>[key,(library[key]??[]).map(item=>item.id)])) as ImportSelection;}
function contentIdentity(value:unknown):string {
  value=structuredClone(value);
  const resource=(value&&typeof value==='object'?value:{}) as {components?:ReusableComponent[]};
  const componentSources=new Map((resource.components??[]).map((component,index)=>[component.id,new Map(component.scene.elements.map((element,elementIndex)=>[element.id,`component-source-${index}-${elementIndex}`]))]));
  const normalizeSources=(item:unknown)=>{if(Array.isArray(item)){item.forEach(normalizeSources);return;}if(!item||typeof item!=='object')return;const record=item as Record<string,unknown>;if(typeof record.componentId==='string'&&typeof record.componentSourceId==='string')record.componentSourceId=componentSources.get(record.componentId)?.get(record.componentSourceId)??record.componentSourceId;for(const [key,child]of Object.entries(record))if(key!=='versions')normalizeSources(child);};normalizeSources(value);
  const ids=new Map<string,string>();
  const collect=(item:unknown)=>{if(Array.isArray(item)){item.forEach(collect);return;}if(!item||typeof item!=="object")return;const record=item as Record<string,unknown>;for(const field of ["id","componentInstanceId"])if(typeof record[field]==="string"&&!ids.has(record[field] as string))ids.set(record[field] as string,`node-${ids.size}`);for(const key of Object.keys(record).sort())if(key!=="versions"&&key!=="scene")collect(record[key]);};collect(value);
  const references=new Set(["id","groupId","parentId","componentId","componentInstanceId","componentSourceId","textStyleId","workspaceSourceId","slot","readingOrder"]);
  const visit=(item:unknown,key=""):unknown=>key==="scene"&&item&&typeof item==="object"?JSON.parse(contentIdentity(item)):Array.isArray(item)?key==="versions"?item.map(child=>JSON.parse(contentIdentity(child))):item.map(child=>visit(child,key)):item&&typeof item==="object"?Object.fromEntries(Object.entries(item).filter(([field])=>!["createdAt","updatedAt","folderId","reviewLinks"].includes(field)).map(([field,child])=>[field,visit(child,field)])):typeof item==="string"&&references.has(key)?ids.get(item)??item:typeof item==="string"&&key==="richText"?item.replace(/data-texture-id="([a-zA-Z0-9_-]+)"/g,(_,id:string)=>`data-texture-id="${ids.get(id)??id}"`):item;
  return stableStringify(visit(value))??"";
}
export function importLibrarySelection(current:EditorLibrary,incoming:EditorLibrary,selection:ImportSelection,mode:ImportMode,activateImportedBrand=false):EditorLibrary {
  let result=structuredClone(current);const ids=new Map<string,string>(),identities=new WeakMap<object,string>();
  const identityFor=(record:object)=>{let identity=identities.get(record);if(identity===undefined){identity=contentIdentity(record);identities.set(record,identity);}return identity;};
  const include=(key:ImportCollection,id:string)=>selection[key].includes(id);
  for(const key of ["folders","workspaceStyles","workspaceComponents","templates","designs","brandKits"] as const){
    const existing=[...(result[key]??[])],imported=(incoming[key]??[]).filter(item=>include(key,item.id));
    for(const raw of imported){
      const original=structuredClone(raw) as typeof raw;
      if(key==="designs"||key==="templates"){
        const item=original as DesignDocument|DesignTemplate;
        if("templateId"in item)item.templateId=ids.get(item.templateId)??item.templateId;
        if("editingTemplateId"in item&&item.editingTemplateId)item.editingTemplateId=ids.get(item.editingTemplateId)??item.editingTemplateId;
        const remapWorkspaceLinks=(resources:Pick<DesignDocument,'styles'|'components'>)=>{
          for(const [field,collection] of [['styles','workspaceStyles'],['components','workspaceComponents']] as const)for(const resource of resources[field]??[])if(resource.workspaceSourceId){const source=resource.workspaceSourceId;resource.workspaceSourceId=ids.get(source)??(current[collection]?.some(existing=>existing.id===source)?source:undefined);}
        };
        remapWorkspaceLinks(item);
        if('versions'in item)for(const version of item.versions??[])remapWorkspaceLinks(version);
      }
      const same=existing.find(item=>item.id===original.id),identical=mode==="copies"?undefined:existing.find(item=>identityFor(item)===identityFor(original));
      if(mode!=="copies"&&identical){ids.set(original.id,identical.id);continue;}
      if(mode==="skip"&&same){ids.set(original.id,same.id);continue;}
      let copy=structuredClone(original) as Record<string,unknown>;
      if(key==="designs")copy={...cloneDesign(original as DesignDocument),name:original.name};
      if(key==="templates"){const template=original as DesignTemplate;copy={...designAsTemplate({...template,templateId:template.id,caption:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as DesignDocument,template.name),description:template.description,category:template.category};}
      copy.id=mode==="merge"&&same?original.id:crypto.randomUUID();ids.set(original.id,String(copy.id));
      if(key==="designs"||key==="templates"){
        const document=original as DesignDocument|DesignTemplate;
        copy.folderId=typeof document.folderId==="string"?ids.get(document.folderId)??(current.folders?.some(folder=>folder.id===document.folderId)?document.folderId:undefined):undefined;
        if(key==="designs"){const doc=original as DesignDocument;copy.templateId=doc.templateId;copy.deletedAt=undefined;if(doc.purpose==="template")copy.purpose="template";if(doc.editingTemplateId)copy.editingTemplateId=doc.editingTemplateId;}

      }
      if(key==="brandKits")copy.assets=(copy.assets as BrandAsset[]).map(asset=>({...asset,id:mode==="merge"&&same?((same as EditorLibrary["brandKits"][number]).assets.find(current=>current.id===asset.id||(current.src===asset.src&&current.kind===asset.kind&&(current.variant??"universal")===(asset.variant??"universal")))?.id??crypto.randomUUID()):crypto.randomUUID()}));
      if(same&&mode==="merge"){
        if(key==="designs"){copy={...copy,createdAt:(same as DesignDocument).createdAt,reviewLinks:(same as DesignDocument).reviewLinks?structuredClone((same as DesignDocument).reviewLinks):undefined};const preserved={...cloneDesign(same as DesignDocument),name:`${same.name.slice(0,170)} before import`};existing.push(preserved);}
        else if(key==="templates")existing.push({...structuredClone(same),id:crypto.randomUUID(),name:`${same.name.slice(0,170)} before import`,custom:true} as typeof original);
        else if(key==="brandKits"){const old=same as EditorLibrary["brandKits"][number],next=copy as EditorLibrary["brandKits"][number];const replacements=new Map(next.assets.map(asset=>[asset.id,asset]));copy={...next,assets:[...old.assets.map(asset=>replacements.get(asset.id)??asset),...next.assets.filter(asset=>!old.assets.some(item=>item.id===asset.id))]};}
        const at=existing.findIndex(item=>item.id===same.id);existing.splice(at,1,copy as typeof original);
      }else existing.push(copy as typeof original);
    }
    Object.assign(result,{[key]:existing});
  }
  for(const kind of ['style','component'] as const){const key=kind==='style'?'workspaceStyles':'workspaceComponents';for(const originalId of selection[key]){const id=ids.get(originalId),resource=result[key]?.find(item=>item.id===id);if(resource)result=saveWorkspaceResource(result,kind,resource);}}
  result=withImportedTemplateStates(result,incoming);
  result=withBrandKits(result,result.brandKits,activateImportedBrand?ids.get(incoming.activeBrandKitId)??current.activeBrandKitId:current.activeBrandKitId);
  const validated=parseLibrary(result);if(!validated)throw new Error("The selected import exceeds workspace limits or contains invalid artwork. Select fewer items.");return validated;
}

function withScene(design:DesignDocument,scene:CanvasScene,pageId:string,master=false):DesignDocument{return master?{...design,masterScene:scene}:design.continuousCanvas?{...design,continuousCanvas:scene}:{...design,pages:design.pages.map(page=>page.id===pageId?{...page,canvas:scene}:page)};}
export function insertWorkspaceStyle(design:DesignDocument,scene:CanvasScene,ids:string[],pageId:string,source:TextStyle,linked:boolean,master=false):DesignDocument {
  if(!scene.elements.some(element=>element.type==='text'&&ids.includes(element.id)&&canEditElement(scene,element,'style')&&!isElementHidden(scene,element)))throw new Error("Select editable text before applying a workspace style.");
  if((design.styles?.length??0)>=40)throw new Error("This design has reached its 40-style limit.");
  const style={...structuredClone(source),id:crypto.randomUUID(),workspaceSourceId:linked?source.id:undefined};
  return {...withScene(design,applyTextStyle(scene,ids,style).scene,pageId,master),styles:[...(design.styles??[]),style]};
}
export function insertWorkspaceComponent(design:DesignDocument,scene:CanvasScene,pageId:string,source:ReusableComponent,linked:boolean,master=false,parentGroupId?:string):{design:DesignDocument;selectedIds:string[]} {
  if(parentGroupId){const test=createCanvasElement("shape",{groupId:parentGroupId});if(!scene.groups?.some(group=>group.id===parentGroupId)||!canEditElement(scene,test,"position")||isElementHidden(scene,test))throw new Error("Unlock and show this group before inserting a workspace component.");}
  if((design.components?.length??0)>=40)throw new Error("This design has reached its 40-component limit.");
  const component={...structuredClone(source),id:crypto.randomUUID(),scene:linked?structuredClone(source.scene):duplicateCanvasScene(source.scene),workspaceSourceId:linked?source.id:undefined};
  const inserted=insertComponent(scene,component,{x:24+(!master&&design.continuousCanvas?Math.max(0,design.pages.findIndex(page=>page.id===pageId))*360:0),y:24});if(inserted.limited)throw new Error("This component exceeds the page layer limit.");
  return {design:{...withScene(design,constrainSceneToIsolation(scene,inserted.scene,parentGroupId),pageId,master),components:[...(design.components??[]),component]},selectedIds:inserted.selectedIds};
}
function updateLinkedDesign(design:DesignDocument,style?:TextStyle,component?:ReusableComponent):DesignDocument {
  let result=design;
  if(style)for(const local of result.styles??[])if(local.workspaceSourceId===style.id)result=updateTextStyle(result,{...style,id:local.id,workspaceSourceId:style.id});
  if(component)for(const local of result.components??[])if(local.workspaceSourceId===component.id)result=updateComponentInstances(result,{...component,id:local.id,workspaceSourceId:component.id});
  return result;
}
export function saveWorkspaceResource(library:EditorLibrary,kind:"style"|"component",resource:TextStyle|ReusableComponent):EditorLibrary {
  const key=kind==="style"?"workspaceStyles":"workspaceComponents",records=library[key]??[];
  if(records.length>=40&&!records.some(item=>item.id===resource.id))throw new Error("The workspace supports up to 40 resources of each type.");
  const value={...structuredClone(resource),workspaceSourceId:undefined};
  if(kind==='component'){const component=value as ReusableComponent;component.scene={...component.scene,elements:component.scene.elements.map(element=>{const detached={...element} as unknown as Record<string,unknown>;for(const field of ['componentId','componentInstanceId','componentSourceId','textStyleId','colorRoleId','slot'])delete detached[field];return detached as unknown as typeof element;})};}
  const update=(design:DesignDocument)=>updateLinkedDesign(design,kind==="style"?value as TextStyle:undefined,kind==="component"?value as ReusableComponent:undefined);
  return {...library,[key]:[...records.filter(item=>item.id!==value.id),value],designs:library.designs.map(update),templates:library.templates.map(template=>{const next=update({...template,templateId:template.id,caption:"",createdAt:"",updatedAt:""});return {...template,styles:next.styles,components:next.components,pages:next.pages,continuousCanvas:next.continuousCanvas,masterScene:next.masterScene};})};
}
export function removeWorkspaceResource(library:EditorLibrary,kind:"style"|"component",id:string):EditorLibrary {
  const key=kind==="style"?"workspaceStyles":"workspaceComponents",field=kind==="style"?"styles":"components";
  const detach=<T extends DesignDocument|DesignTemplate>(item:T):T=>({...item,[field]:item[field]?.map(resource=>resource.workspaceSourceId===id?{...resource,workspaceSourceId:undefined}:resource)});
  return {...library,[key]:library[key]?.filter(item=>item.id!==id),designs:library.designs.map(detach),templates:library.templates.map(detach)};
}
