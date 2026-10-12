"use client";
import {useEffect,useRef} from "react";
import type { CanvasScene, CanvasLayout } from "@/lib/template-editor/model";
import { Modal } from "./controls";

export const DEFAULT_LAYOUT: CanvasLayout = {
  rulers: false, showGuides: true, guides: [],
  margins: { enabled: false, top: 24, right: 24, bottom: 24, left: 24 },
  safeArea: { enabled: false, top: 40, right: 20, bottom: 60, left: 20 },
  grid: { enabled: false, size: 8, columns: 3, rows: 3, gutter: 8 },
  snapping: { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 },
};
export function LayoutPanel({scene, width, height, slideWidth=width, outputScale=3, disabled, onChange, onClose}: {scene:CanvasScene;width:number;height:number;slideWidth?:number;outputScale?:number;disabled:boolean;onChange:(scene:CanvasScene)=>void;onClose:()=>void}) {
  const layout = {...DEFAULT_LAYOUT,...scene.layout};
  function patch(value:Partial<CanvasLayout>) { if(!disabled) onChange({...scene, layout:{...layout,...value}}); }
  return <Modal title="Layout, rulers & guides" onClose={onClose}>
    <fieldset disabled={disabled} className="te-pro-panel">
      <label><input type="checkbox" checked={layout.rulers} onChange={e=>patch({rulers:e.target.checked})}/> Show rulers</label>
      <label><input type="checkbox" checked={layout.showGuides!==false} onChange={e=>patch({showGuides:e.target.checked})}/> Show guides</label>
      {(["margins","safeArea"] as const).map(key=>{const inset={...DEFAULT_LAYOUT[key]!,...layout[key]};return <section key={key}>
        <label><input type="checkbox" checked={inset.enabled} onChange={e=>patch({[key]:{...inset,enabled:e.target.checked}})}/> {key==='margins'?'Page margins':'Safe area'}</label>
        <div className="te-pro-grid">{(["top","right","bottom","left"] as const).map(side=><label key={side}>{side} px<input aria-label={`${key} ${side}`} type="number" min="0" max={(side==='left'||side==='right'?slideWidth:height)*outputScale/2} value={Math.round(inset[side]*outputScale)} onChange={e=>patch({[key]:{...inset,[side]:Math.min((side==='left'||side==='right'?slideWidth:height)/2,Math.max(0,Number(e.target.value)/outputScale))}})}/></label>)}</div>
        {key==='safeArea'&&<button className="te-text-button" onClick={()=>patch({safeArea:{enabled:true,top:height*.12,bottom:height*.18,left:20,right:20}})}>Story safe area preset</button>}
      </section>})}
      <section><label><input type="checkbox" checked={layout.grid?.enabled} onChange={e=>patch({grid:{...DEFAULT_LAYOUT.grid!,...layout.grid,enabled:e.target.checked}})}/> Layout grid</label>
      <div className="te-pro-grid">{(["size","columns","rows","gutter"] as const).map(key=><label key={key}>{key}{key==='size'||key==='gutter'?' px':''}<input aria-label={`Grid ${key}`} type="number" min={key==='gutter'?0:1} max={key==='columns'||key==='rows'?24:600} value={(layout.grid?.[key]??DEFAULT_LAYOUT.grid![key])*(key==='size'||key==='gutter'?outputScale:1)} onChange={e=>patch({grid:{...DEFAULT_LAYOUT.grid!,...layout.grid,[key]:Math.max(key==='gutter'?0:1,Number(e.target.value)/(key==='size'||key==='gutter'?outputScale:1))}})}/></label>)}</div></section>
      <section><strong>Snapping</strong>{(["enabled","objects","page","guides","grid","spacing"] as const).map(key=><label key={key}><input type="checkbox" checked={layout.snapping?.[key]??DEFAULT_LAYOUT.snapping![key]} onChange={e=>patch({snapping:{...DEFAULT_LAYOUT.snapping!,...layout.snapping,[key]:e.target.checked}})}/>{key==='enabled'?'Enable snapping':key==='page'?'Page, slides & margins':key==='spacing'?'Equal spacing':key}</label>)}<label>Tolerance in screen px<input aria-label="Snap tolerance" type="number" min="1" max="20" value={layout.snapping?.tolerance??6} onChange={e=>patch({snapping:{...DEFAULT_LAYOUT.snapping!,...layout.snapping,tolerance:Number(e.target.value)}})}/></label><p>Hold Alt to bypass snapping. Hold Shift to move along one axis.</p></section>
      <section><strong>Guides</strong><div className="te-pro-actions">{(['x','y'] as const).map(axis=><button className="te-button" key={axis} onClick={()=>patch({guides:[...(layout.guides??[]),{id:crypto.randomUUID(),axis,position:(axis==='x'?width:height)/2,locked:false}]})}>+ {axis==='x'?'Vertical':'Horizontal'}</button>)}<button className="te-text-button" onClick={()=>patch({guides:[]})}>Clear guides</button></div>
      {(layout.guides??[]).map(guide=><div className="te-pro-guide-row" key={guide.id}><span>{guide.axis==='x'?'Vertical':'Horizontal'}</span><input aria-label={`Guide ${guide.id} position`} type="number" min="0" max={(guide.axis==='x'?width:height)*outputScale} value={Math.round(guide.position*outputScale)} onChange={e=>patch({guides:layout.guides!.map(g=>g.id===guide.id?{...g,position:Number(e.target.value)/outputScale}:g)})}/><label><input aria-label="Lock guide" type="checkbox" checked={guide.locked} onChange={e=>patch({guides:layout.guides!.map(g=>g.id===guide.id?{...g,locked:e.target.checked}:g)})}/>Lock</label><button className="te-text-button" aria-label="Remove guide" onClick={()=>patch({guides:layout.guides!.filter(g=>g.id!==guide.id)})}>×</button></div>)}</section>
    </fieldset>
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
