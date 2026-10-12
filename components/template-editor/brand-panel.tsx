"use client";

import { useState } from "react";
import type { BrandAsset, SavedBrandKit, CanvasScene, ShapeImageFill } from "@/lib/template-editor/model";
import { proxied } from "@/lib/engine/util";
import { useContextMenu } from "./context-menu";
import { writePhotoDrag } from "@/lib/template-editor/photo-drag";

export function BrandPanel({ kits, activeId, scene, selectedIds, disabled, continuous = false, onSelectKit, onInsert, onSaveAsset, onChange, onApply, onManage, onPhotoPointerDown }: {
  kits: SavedBrandKit[];
  activeId: string;
  scene: CanvasScene;
  selectedIds: string[];
  disabled: boolean;
  continuous?: boolean;
  onSelectKit: (id: string) => void;
  onInsert: (asset: BrandAsset) => void;
  onPhotoPointerDown?: (event:import("react").PointerEvent<HTMLButtonElement>,photo:ShapeImageFill)=>void;
  onSaveAsset: (asset: BrandAsset, kitId: string) => boolean | void;
  onChange: (recipe: (scene: CanvasScene) => CanvasScene) => void;
  onApply: (all: boolean) => void;
  onManage: () => void;
}) {
  const {openMenu} = useContextMenu();
  const [search, setSearch] = useState("");
  const kit = kits.find((item) => item.id === activeId) ?? kits[0];
  if (!kit) return null;
  const images = scene.elements.filter((element) => selectedIds.includes(element.id) && element.type === "image");
  const canColor = !selectedIds.length || scene.elements.some((element) => selectedIds.includes(element.id) && !element.locked && element.type !== "image");
  const applyColor = (color: string) => {
    onChange((live) => {
    const editable = live.elements.some((element) => selectedIds.includes(element.id) && !element.locked && element.type !== "image");
    return editable ? {...live, elements: live.elements.map((element) => selectedIds.includes(element.id) && !element.locked ? element.type === "text" ? {...element, color} : element.type === "shape" ? {...element, fill: color} : element : element)} : selectedIds.length ? live : {...live, background: color};
    });
  };
  return <div className="te-brand-panel">
    <div className="te-panel-heading"><h2>Brand kits</h2></div>
    <label className="te-field">Active brand
      <select value={kit.id} disabled={disabled} onChange={(event) => onSelectKit(event.target.value)}>
        {kits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <div className="te-brand-palette" aria-label="Brand colors">
      {Array.from(new Set([kit.background, kit.text, ...kit.palette])).map((color) => <button key={color} aria-label={`Apply brand color ${color}`} title={`${color} · Apply to selected text or shape, or ${continuous ? "carousel" : "page"} background`} disabled={disabled || !canColor} style={{background: color}} onClick={() => applyColor(color)} onContextMenu={(event) => openMenu(event, {label: color, items:[{id:"apply", label:"Apply to selection or background", disabled, onSelect:() => applyColor(color)}, {id:"background", label:continuous ? "Use as carousel background" : "Use as page background", disabled, onSelect:() => onChange((live) => ({...live, background:color}))}]})} />)}
    </div>
    <p className="te-help">Click a color to style your selected text or shape. With nothing selected, it colors {continuous ? "the whole carousel" : "the page"}.</p>
    <button className="te-button te-full" disabled={disabled} onClick={() => onApply(continuous)}>{continuous ? "Apply brand to carousel" : "Apply brand to this page"}</button>
    {!continuous && <button className="te-text-button te-full" disabled={disabled} onClick={() => onApply(true)}>Apply to all pages</button>}
    <div className="te-panel-heading te-brand-assets-heading"><h2>Logos & elements</h2><span>{kit.assets.length}/40</span></div>
    <input className="te-brand-search" aria-label="Search brand elements" placeholder="Search brand elements" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="te-brand-element-grid">
      {kit.assets.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase())).map((asset) => <button key={asset.id} disabled={disabled} draggable={!disabled} onPointerDown={event=>onPhotoPointerDown?.(event,{src:asset.src,alt:asset.name,objectFit:'cover',cropX:50,cropY:50})} onDragStart={event=>{if(onPhotoPointerDown)event.preventDefault();else writePhotoDrag(event.dataTransfer,{src:asset.src,alt:asset.name,objectFit:'cover',cropX:50,cropY:50});}} aria-label={`Add brand element ${asset.name}`} title={asset.name} onClick={() => onInsert(asset)} onContextMenu={(event) => openMenu(event,{label:asset.name,items:[{id:"insert",label:continuous ? "Add to carousel" : "Add to this page",disabled:disabled || scene.elements.length >= 100,onSelect:() => onInsert(asset)}]})}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proxied(asset.src)} alt="" /><span>{asset.name}</span>
      </button>)}
    </div>
    {!kit.assets.length && <p className="te-help">Keep logos, product photos, and graphic elements here, ready for every post.</p>}
    {images.length === 1 && images[0].type === "image" && <button className="te-button te-full" disabled={disabled || kit.assets.length >= 40} onClick={() => {
      const image = images[0];
      if (image.type === "image") onSaveAsset({id:crypto.randomUUID(),name:image.name,src:image.src,width:image.width,height:image.height,kind:"image"}, kit.id);
    }}>Save selected image to brand</button>}
    <button className="te-button te-full" disabled={disabled} onClick={onManage}>Manage kits & upload elements</button>
  </div>;
}
