import {composeScene} from './advanced';
import {formatDimensions,type DesignDocument} from './model';
import {needsPdfRaster,pdfGeometry} from './pdf-options';
import {packAssetsOffThread} from './asset-processing';
import {preflightFrames,bounded,saveBlob,fileName,type ExportOptions} from './export';
/** One rendered page in memory at a time. PDFKit produces a complete tagged
 * multipage document per batch; copying page fragments would lose its tags. */
export async function exportDocumentPdf(frames:HTMLElement[],name:string,progress:(value:number)=>void,options:ExportOptions){
 const source=pdfExportSource(options.document!),size=formatDimensions(source),geometry=pdfGeometry(size.width,size.height,options),total=options.totalFrames??frames.length;
 const{domToBlob}=await import('modern-screenshot'),packed=await packAssetsOffThread(source),baseBytes=new TextEncoder().encode(JSON.stringify(packed)).length;
 const batchSize=options.delivery==='batches'?options.batchSize??4:total,warnings:string[]=[];let ids:string[]=[],rasters:Record<string,string>={},requestBytes=baseBytes,batch=1;
 async function finish(){options.signal?.throwIfAborted();const response=await fetch('/api/template-editor/export/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:packed.value,assets:packed.assets,pageIds:ids,options:{pdfMode:options.pdfMode??'document',dpi:geometry.dpi,widthMm:geometry.widthMm,bleedMm:options.bleedMm,cropMarks:options.cropMarks},raster:rasters}),signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(120000)])});if(!response.ok){const data=await response.json();throw Error(data.error??'PDF export failed.');}const blob=await response.blob();if(blob.size>64*1024*1024)throw Error('PDF exceeds 64 MB. Choose smaller batches.');options.signal?.throwIfAborted();saveBlob(blob,`${fileName(name)}${options.delivery==='batches'?`-part-${batch++}`:''}.pdf`);ids=[];rasters={};requestBytes=baseBytes;}
 for(let index=0;index<total;index++){
  options.signal?.throwIfAborted();const frame=options.getFrame?await bounded(options.getFrame(index,options.signal),options.signal):frames[index],pageId=frame.dataset.pageId??source.pages[index]?.id;if(!pageId)throw Error('Choose a document page.');
  const scene=composeScene(source,source.pages.findIndex(page=>page.id===pageId)),fallback=options.pdfMode==='raster'||!source.continuousCanvas&&!source.pages.find(page=>page.id===pageId)?.canvas||needsPdfRaster(scene.elements,scene.groups);
  warnings.push(...(await preflightFrames([frame],{...options,scale:geometry.rasterScale,resourceOnly:!fallback})).map(warning=>warning.replace('Page 1',`Page ${index+1}`)));if(fallback)warnings.push(`Page ${index+1}: complex effects use a picture; text remains selectable and described.`);options.onWarnings?.([...new Set(warnings)]);
  let raster:string|undefined;
  if(fallback){const blob=await bounded(domToBlob(frame,{type:'image/png',scale:geometry.rasterScale,width:frame.offsetWidth,height:frame.offsetHeight,backgroundColor:'#fff',fetch:{placeholderImage:'',requestInit:{signal:options.signal}},timeout:15000}),options.signal,60000);if(blob.size>16*1024*1024)throw Error('This rendered page exceeds 16 MB. Choose a smaller PDF DPI.');raster=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Page snapshot could not be read.'));reader.readAsDataURL(blob);});}
  const extra=(raster?.length??0)+100;
  if(requestBytes+extra>23*1024*1024){if(options.delivery!=='batches'||!ids.length)throw Error('This PDF request exceeds 23 MB. Choose batch downloads or smaller DPI.');await finish();if(baseBytes+extra>23*1024*1024)throw Error('This page exceeds the PDF request budget. Choose smaller DPI.');}
  ids.push(pageId);if(raster)rasters[pageId]=raster;requestBytes+=extra;progress(Math.round((index+1)/total*95));if(options.delivery==='batches'&&ids.length>=batchSize)await finish();
 }
 if(ids.length)await finish();progress(100);
}

/** Version snapshots, unused resources and private provenance do not belong
 * in a rendering request. Geometry and legacy visible-credit copy stay intact. */
export function pdfExportSource(source:DesignDocument):DesignDocument{
 const {id,name,templateId,format,customSize,pages,masterScene,continuousCanvas,caption,createdAt,updatedAt}=source;
 const strip=(value:unknown):unknown=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['previewSrc','provenance','sourceUrl'].includes(key)).map(([key,child])=>[key,strip(child)])):value;
 return strip({id,name,templateId,format,customSize,pages,masterScene,continuousCanvas,caption,createdAt,updatedAt}) as DesignDocument;
}
