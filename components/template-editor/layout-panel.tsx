"use client";
import {useEffect,useRef} from "react";
import type { CanvasScene, CanvasLayout } from "@/lib/template-editor/model";
import { Modal } from "./controls";
import "./dialog-tools.css";

export const DEFAULT_LAYOUT: CanvasLayout = {
  rulers: false, showGuides: true, guides: [],
  margins: { enabled: false, top: 24, right: 24, bottom: 24, left: 24 },
  safeArea: { enabled: false, top: 40, right: 20, bottom: 60, left: 20 },
  grid: { enabled: false, size: 8, columns: 3, rows: 3, gutter: 8 },
  snapping: { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 },
};
export function LayoutPanel({scene,width,height,slideWidth=width,outputScale=3,disabled,onChange,onClose}:{scene:CanvasScene;width:number;height:number;slideWidth?:number;outputScale?:number;disabled:boolean;onChange:(scene:CanvasScene)=>void;onClose:()=>void}) {
  const layout={...DEFAULT_LAYOUT,...scene.layout},margins={...DEFAULT_LAYOUT.margins!,...layout.margins};
  function patch(value:Partial<CanvasLayout>){if(!disabled)onChange({...scene,layout:{...layout,...value}});}
  function insetFields(key:"margins"|"safeArea") {
    const inset={...DEFAULT_LAYOUT[key]!,...layout[key]};
    return <div className="te-dialog-grid">{(["top","right","bottom","left"] as const).map(side=>{
      const max=(side==="left"||side==="right"?slideWidth:height)/2;
      return <label key={side}>{side[0].toUpperCase()+side.slice(1)} (px)<input aria-label={`${key} ${side}`} disabled={!inset.enabled} type="number" min="0" max={max*outputScale} value={Math.round(inset[side]*outputScale)} onChange={event=>patch({[key]:{...inset,[side]:Math.min(max,Math.max(0,Number(event.target.value)/outputScale))}})}/></label>;
    })}</div>;
  }
  return <Modal title="Guides and alignment" onClose={onClose}>
    <fieldset disabled={disabled} className="te-pro-panel te-tool-dialog">
      <div className="te-dialog-toggles">
        <label className="te-dialog-check"><input type="checkbox" checked={layout.snapping?.enabled??true} onChange={event=>patch({snapping:{...DEFAULT_LAYOUT.snapping!,...layout.snapping,enabled:event.target.checked}})}/>Snap objects into place</label>
        <label className="te-dialog-check"><input type="checkbox" checked={layout.rulers??false} onChange={event=>patch({rulers:event.target.checked})}/>Show rulers</label>
        <label className="te-dialog-check"><input type="checkbox" checked={layout.showGuides!==false} onChange={event=>patch({showGuides:event.target.checked})}/>Show guides</label>
      </div>
      <section><label className="te-dialog-check"><input type="checkbox" checked={margins.enabled} onChange={event=>patch({margins:{...margins,enabled:event.target.checked}})}/>Show page margins</label>{margins.enabled&&insetFields("margins")}</section>
      <details><summary>Custom guides{layout.guides?.length?` · ${layout.guides.length}`:""}</summary><div className="te-dialog-details-body">
        <div className="te-pro-actions">{(["x","y"] as const).map(axis=><button type="button" className="te-button" key={axis} disabled={(layout.guides?.length??0)>=100} onClick={()=>patch({showGuides:true,guides:[...(layout.guides??[]),{id:crypto.randomUUID(),axis,position:(axis==="x"?width:height)/2,locked:false}]})}>Add {axis==="x"?"vertical":"horizontal"}</button>)}<button type="button" className="te-text-button" disabled={!layout.guides?.length} onClick={()=>patch({guides:[]})}>Clear all</button></div>
        {!layout.guides?.length&&<p>Add a guide here, or drag one from a ruler onto your page.</p>}
        {(layout.guides??[]).map((guide,index)=><div className="te-dialog-guide-row" key={guide.id}>
          <span>{guide.axis==="x"?"Vertical":"Horizontal"}</span><input aria-label={`Guide ${index+1} position in pixels`} type="number" min="0" max={(guide.axis==="x"?width:height)*outputScale} value={Math.round(guide.position*outputScale)} onChange={event=>patch({guides:layout.guides!.map(item=>item.id===guide.id?{...item,position:Math.min(guide.axis==="x"?width:height,Math.max(0,Number(event.target.value)/outputScale))}:item)})}/>
          <label className="te-dialog-check"><input aria-label={`Lock guide ${index+1}`} type="checkbox" checked={guide.locked??false} onChange={event=>patch({guides:layout.guides!.map(item=>item.id===guide.id?{...item,locked:event.target.checked}:item)})}/>Lock</label><button type="button" className="te-text-button" aria-label={`Remove guide ${index+1}`} onClick={()=>patch({guides:layout.guides!.filter(item=>item.id!==guide.id)})}>×</button>
        </div>)}
      </div></details>
      <details><summary>Grid</summary><div className="te-dialog-details-body">
        <label className="te-dialog-check"><input type="checkbox" checked={layout.grid?.enabled??false} onChange={event=>patch({grid:{...DEFAULT_LAYOUT.grid!,...layout.grid,enabled:event.target.checked}})}/>Show layout grid</label>
        <div className="te-dialog-grid">{(["columns","rows","size","gutter"] as const).map(key=>{
          const pixel=key==="size"||key==="gutter",min=key==="gutter"?0:1,max=pixel?600/outputScale:24;
          return <label key={key}>{key==="size"?"Grid spacing":key==="gutter"?"Gap":key[0].toUpperCase()+key.slice(1)}{pixel?" (px)":""}<input aria-label={`Grid ${key}`} type="number" min={pixel?min*outputScale:min} max={pixel?max*outputScale:max} step={pixel?"any":"1"} disabled={!layout.grid?.enabled} value={(layout.grid?.[key]??DEFAULT_LAYOUT.grid![key])*(pixel?outputScale:1)} onChange={event=>{const requested=Number(event.target.value)/(pixel?outputScale:1);patch({grid:{...DEFAULT_LAYOUT.grid!,...layout.grid,[key]:Math.max(min,Math.min(max,pixel?requested:Math.round(requested)))}});}}/></label>;
        })}</div>
      </div></details>
      <details><summary>Safe area</summary><div className="te-dialog-details-body">
        <label className="te-dialog-check"><input type="checkbox" checked={layout.safeArea?.enabled??false} onChange={event=>patch({safeArea:{...DEFAULT_LAYOUT.safeArea!,...layout.safeArea,enabled:event.target.checked}})}/>Show safe area</label>
        <p>Keep important text inside this area.</p>{insetFields("safeArea")}
        <button type="button" className="te-button" onClick={()=>patch({safeArea:{enabled:true,top:height*.12,bottom:height*.18,left:20,right:20}})}>Use Story safe area</button>
      </div></details>
      <details><summary>More snapping options</summary><div className="te-dialog-details-body">
        {(["objects","page","guides","grid","spacing"] as const).map(key=><label className="te-dialog-check" key={key}><input type="checkbox" checked={layout.snapping?.[key]??DEFAULT_LAYOUT.snapping![key]} onChange={event=>patch({snapping:{...DEFAULT_LAYOUT.snapping!,...layout.snapping,[key]:event.target.checked}})}/>{{objects:"Other objects",page:"Page edges and margins",guides:"Guides",grid:"Grid",spacing:"Even spacing"}[key]}</label>)}
        <label>Snap distance (screen px)<input aria-label="Snap tolerance" type="number" min="1" max="20" value={layout.snapping?.tolerance??6} onChange={event=>patch({snapping:{...DEFAULT_LAYOUT.snapping!,...layout.snapping,tolerance:Math.min(20,Math.max(1,Number(event.target.value)))}})}/></label>
        <p>Hold Alt to move freely. Hold Shift to move along one axis.</p>
      </div></details>
      <p>Changes apply as you adjust. These guides stay out of your downloads.</p>
    </fieldset>
    <div className="te-dialog-footer"><button type="button" className="te-button te-primary" onClick={onClose}>Done</button></div>
  </Modal>;
}

/** Editor guides are rendered outside SceneRenderer and never enter exported artwork. */
export function LayoutOverlay({scene,width,height,slideWidth,scale,outputScale=3,onChange,disabled}:{scene:CanvasScene;width:number;height:number;slideWidth?:number;scale:number;outputScale?:number;onChange:(scene:CanvasScene)=>void;disabled:boolean}) {
  const latest=useRef(scene);useEffect(()=>{latest.current=scene;},[scene]);
  const layout=scene.layout;const slides=Math.min(20,Math.ceil(width/(slideWidth??width)));const slide=slideWidth??width;
  if(!layout)return null;
  const commitGuide=(id:string,position:number)=>{const current=latest.current;onChange({...current,layout:{...current.layout,guides:current.layout?.guides?.flatMap(g=>g.id!==id?[g]:position<0||position>(g.axis==='x'?width:height)?[]:[{...g,position}])}});};
  function handleRulerPointerDown(e:import("react").PointerEvent<HTMLDivElement>,axis:"x"|"y"){if(disabled)return;e.preventDefault();e.stopPropagation();const node=e.currentTarget;const bounds=node.parentElement!.getBoundingClientRect();const newAxis=axis==='x'?'y':'x';node.setPointerCapture(e.pointerId);const ghost=document.createElement('div');ghost.className=`te-layout-guide te-layout-guide-${newAxis}`;ghost.style.pointerEvents='none';ghost.style.width=newAxis==='x'?`${1/scale}px`:`${width}px`;ghost.style.height=newAxis==='y'?`${1/scale}px`:`${height}px`;node.parentElement!.append(ghost);
      const coordinate=(ev:PointerEvent)=>newAxis==='x'?(ev.clientX-bounds.left)/scale:(ev.clientY-bounds.top)/scale;
      const move=(ev:PointerEvent)=>{ghost.style[newAxis==='x'?'left':'top']=`${coordinate(ev)}px`;};
      const clean=()=>{ghost.remove();node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',clean);};
      const end=(ev:PointerEvent)=>{const position=coordinate(ev);clean();if(position<0||position>(newAxis==='x'?width:height))return;const current=latest.current;onChange({...current,layout:{...current.layout,showGuides:true,guides:[...(current.layout?.guides??[]),{id:crypto.randomUUID(),axis:newAxis,position,locked:false}]}});};node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',clean);
  }
  const desired=60/scale*outputScale,power=10**Math.floor(Math.log10(desired)),tick=[1,2,5,10].find(n=>n*power>=desired)!*power/outputScale;
  return <div className="te-layout-overlay" aria-hidden="true" style={{"--te-guide-hit":`${6/scale}px`} as import("react").CSSProperties}>
    {Array.from({length:slides},(_,i)=><div key={i}>
      {(['margins','safeArea'] as const).map(key=>{const m=layout[key];return m?.enabled&&<div key={key} className={`te-layout-inset te-layout-${key}`} style={{left:i*slide+m.left,top:m.top,width:Math.max(0,slide-m.left-m.right),height:Math.max(0,height-m.top-m.bottom),borderWidth:1/scale}}/>})}
      {layout.grid?.enabled&&<div className="te-layout-grid" style={{left:i*slide,width:slide,height,backgroundSize:`${layout.grid.size}px ${layout.grid.size}px`}}>{Array.from({length:layout.grid.columns},(_,col)=>{const m=layout.margins;const l=m?.enabled?m.left:0,r=m?.enabled?m.right:0;const w=(slide-l-r-(layout.grid!.columns-1)*layout.grid!.gutter)/layout.grid!.columns;return <div key={col} style={{left:l+col*(w+layout.grid!.gutter),width:Math.max(0,w),height}}/>})}{Array.from({length:layout.grid.rows},(_,row)=>{const m=layout.margins;const t=m?.enabled?m.top:0,b=m?.enabled?m.bottom:0;const h=(height-t-b-(layout.grid!.rows-1)*layout.grid!.gutter)/layout.grid!.rows;return <div className="te-layout-grid-row" key={`row-${row}`} style={{left:0,top:t+row*(h+layout.grid!.gutter),width:slide,height:Math.max(0,h)}}/>})}</div>}
    </div>)}
    {layout.showGuides!==false&&(layout.guides??[]).map(guide=><div key={guide.id} className={`te-layout-guide te-layout-guide-${guide.axis}${guide.locked?' is-locked':''}`} style={guide.axis==='x'?{left:guide.position,height,width:1/scale}:{top:guide.position,width,height:1/scale}} onPointerDown={e=>{
      if(disabled||guide.locked)return;e.preventDefault();e.stopPropagation();const node=e.currentTarget;const start=guide.position;const p=guide.axis==='x'?e.clientX:e.clientY;node.setPointerCapture(e.pointerId);
      const move=(ev:PointerEvent)=>{node.style[guide.axis==='x'?'left':'top']=`${start+((guide.axis==='x'?ev.clientX:ev.clientY)-p)/scale}px`;};
      const end=(ev:PointerEvent)=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',cancel);commitGuide(guide.id,start+((guide.axis==='x'?ev.clientX:ev.clientY)-p)/scale);};
      const cancel=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',cancel);node.style[guide.axis==='x'?'left':'top']=`${start}px`;};
      node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',cancel);
    }}><span style={{fontSize:10/scale,...(guide.axis==='x'?{top:-20/scale,left:0}:{left:-20/scale,top:0})}}>{Math.round(guide.position*outputScale)}</span></div>)}
    {/* Ref is read only from the native pointer handler, to retain concurrent scene edits. */}
    {/* eslint-disable-next-line react-hooks/refs */}
    {layout.rulers&&(['x','y'] as const).map(axis=><div className={`te-ruler te-ruler-${axis}`} key={axis} style={axis==='x'?{width,height:20/scale,top:-20/scale}:{height,width:20/scale,left:-20/scale}} onPointerDown={e=>handleRulerPointerDown(e,axis)}>

      {Array.from({length:Math.min(241,Math.ceil((axis==='x'?width:height)/tick)+1)},(_,n)=>{const pos=n*tick;return <span key={n} style={{[axis==='x'?'left':'top']:pos,fontSize:9/scale}}>{Math.round(pos*outputScale)}</span>})}
    </div>)}
  </div>;
}
