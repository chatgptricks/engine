"use client";
import {useState} from "react";
import {Modal} from "./controls";
import {formatDimensions,type DesignDocument} from "@/lib/template-editor/model";
import {validateExportOptions,type ExportOptions} from "@/lib/template-editor/export";
import {preflightDesign,type PreflightIssue} from "@/lib/template-editor/preflight";
import "./dialog-tools.css";

export function ExportDialog({design,pageId,disabled,onClose,onExport,issues}:{design:DesignDocument;pageId:string;disabled:boolean;onClose:()=>void;onExport:(options:ExportOptions,pageIds:string[])=>void;issues?:PreflightIssue[]}) {
  const size=formatDimensions(design),nativeScale=size.width/360;
  const recommendedScale=Math.min(nativeScale,Math.floor(360*Math.sqrt(40_000_000/(360*Math.ceil(360*size.height/size.width))))/360);
  const [format,setFormat]=useState<NonNullable<ExportOptions["format"]>>("png");
  const [scale,setScale]=useState(recommendedScale),[quality,setQuality]=useState(.92),[transparent,setTransparent]=useState(false);
  const [pages,setPages]=useState("all"),[range,setRange]=useState(String(Math.max(1,design.pages.findIndex(page=>page.id===pageId)+1))),[error,setError]=useState("");
  function selectedPages() {
    if(pages==="current")return [pageId];
    if(pages!=="range")return design.pages.map(page=>page.id);
    const indexes=new Set<number>();
    for(const part of range.split(",")) {
      const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if(!match)throw new Error("Enter page numbers such as 1, 3-5.");
      const from=Number(match[1]),through=Number(match[2]??match[1]);
      if(from<1||through<from||through>design.pages.length)throw new Error(`Choose pages between 1 and ${design.pages.length}.`);
      for(let index=from;index<=through;index++)indexes.add(index-1);
    }
    return design.pages.filter((_,index)=>indexes.has(index)).map(page=>page.id);
  }
  let selectedIds:string[]=[];
  try{selectedIds=selectedPages();}catch{/* Keep the range editable until submitted. */}
  const findings=(issues??preflightDesign(design)).filter(issue=>selectedIds.includes(issue.pageId));
  const width=Math.round(360*scale),height=Math.round(360*size.height/size.width*scale);
  function start() {
    if(disabled)return;
    try {
      const ids=selectedPages();if(!ids.length)throw new Error("Choose at least one page.");
      const options={format,scale,quality,transparent:transparent&&format!=="jpeg"&&format!=="pdf"};
      validateExportOptions(options);
      if(Math.max(width,height)>16384||(format!=="svg"&&width*height>40_000_000))throw new Error("This size is too large to download. Open advanced settings and choose a smaller size.");
      onExport(options,ids);
    }catch(reason){setError(reason instanceof Error?reason.message:"Choose valid download settings.");}
  }
  return <Modal title="Download design" onClose={onClose}>
    <form onSubmit={event=>{event.preventDefault();start();}}>
      <fieldset className="te-pro-panel te-tool-dialog" disabled={disabled}>
        <label>File type<select aria-label="Export file type" value={format} onChange={event=>{setFormat(event.target.value as typeof format);setError("");}}>
          <option value="png">PNG · recommended for posts</option><option value="jpeg">JPG · smaller images</option><option value="pdf">PDF · one document</option><option value="webp">WebP</option><option value="svg">SVG · web viewers</option>
        </select></label>
        {design.pages.length>1&&<label>Pages<select aria-label="Export pages" value={pages} onChange={event=>{setPages(event.target.value);setError("");}}><option value="all">All {design.pages.length} pages</option><option value="current">Current page</option><option value="range">Choose page numbers</option></select></label>}
        {pages==="range"&&<label>Page numbers<input aria-label="Export page range" value={range} onChange={event=>{setRange(event.target.value);setError("");}} placeholder="1, 3-5" aria-invalid={Boolean(error)}/></label>}
        <div className="te-dialog-summary"><strong>{width.toLocaleString("en-US")} × {height.toLocaleString("en-US")} px</strong><span>{selectedIds.length} page{selectedIds.length===1?"":"s"}{selectedIds.length>1&&format!=="pdf"?" · ZIP":""}</span></div>
        <details><summary>Advanced settings</summary><div className="te-dialog-details-body">
          <label>Image size<select aria-label="Export resolution" value={scale} onChange={event=>{setScale(Number(event.target.value));setError("");}}>{Array.from(new Set([recommendedScale,nativeScale,1,2,3,4,6])).sort((a,b)=>a-b).map(value=><option key={value} value={value}>{Math.round(360*value)} × {Math.round(360*size.height/size.width*value)} px{value===nativeScale?" · original size":value===recommendedScale?" · recommended":""}</option>)}</select></label>
          {(format==="jpeg"||format==="webp")&&<label>Quality · {Math.round(quality*100)}%<input aria-label="Export image quality" type="range" min=".1" max="1" step=".01" value={quality} onChange={event=>setQuality(Number(event.target.value))}/></label>}
          {format!=="jpeg"&&format!=="pdf"&&<label className="te-dialog-check"><input type="checkbox" checked={transparent} onChange={event=>setTransparent(event.target.checked)}/>Transparent background</label>}
          <p>{format==="svg"?"SVG keeps the design in compatible web viewers. Use an Engine file from your library to continue editing.":format==="pdf"?"All selected pages are included in one PDF.":"Several image pages download together in a ZIP."}</p>
        </div></details>
        {findings.length>0&&<details open={findings.some(issue=>issue.severity==="error")}><summary>{findings.length} item{findings.length===1?"":"s"} to check before downloading</summary><div className="te-dialog-details-body"><ul className="te-dialog-warning-list">{findings.slice(0,20).map(issue=><li key={issue.id}>{issue.message}</li>)}</ul>{findings.length>20&&<p>{findings.length-20} more items to check.</p>}</div></details>}
        {error&&<p role="alert" className="te-dialog-error">{error}</p>}
      </fieldset>
      <div className="te-dialog-footer"><button type="button" className="te-button" onClick={onClose}>Cancel</button><button type="submit" className="te-button te-primary" disabled={disabled}>Download</button></div>
    </form>
  </Modal>;
}
