"use client";

import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import { CopyIcon, SearchIcon, TrashIcon } from "@/components/engine/icons";
import type { CanvasElement, CanvasScene } from "@/lib/template-editor/model";
import { elementIntersectsCanvas } from "@/lib/template-editor/canvas-geometry";
import { reorderSelection, setGroupHidden, setGroupLocked, isElementLocked, isElementHidden, expandGroupSelection } from "@/lib/template-editor/commands";
import { buildLayerRows } from "@/lib/template-editor/layer-tree";
import { proxied } from "@/lib/engine/util";
import "./layers-panel.css";

export type LayersPanelProps = {
  scene: CanvasScene;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onChange: (scene: CanvasScene, group?: string) => boolean | void;
  width: number;
  height: number;
  disabled?: boolean;
  onContextMenu: (event: MouseEvent, element: CanvasElement) => void;
  onMenuClick?: (event: MouseEvent, element: CanvasElement) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onLocate?: (element: CanvasElement) => void;
  onEnterGroup?: (groupId: string) => void;
  onExitGroup?: () => void;
  isolatedGroupId?: string;
  onGroupContextMenu?: (event: MouseEvent, groupId: string) => void;
};

function typeName(element: CanvasElement) {
  return element.type === "text" ? "Text" : element.type === "image" ? "Image" : element.shape.charAt(0).toUpperCase() + element.shape.slice(1);
}
function layerName(element: CanvasElement) {
  return element.name.trim() || (element.type === "text" ? element.text.trim().slice(0, 40) : "") || typeName(element);
}
function Eye({ hidden }: { hidden: boolean }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{hidden && <path d="m3 3 18 18" />}
  </svg>;
}
function Lock({ locked }: { locked: boolean }) {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <rect x="5" y="10" width="14" height="11" rx="2" /><path d={locked ? "M8 10V6a4 4 0 0 1 8 0v4" : "M8 10V6a4 4 0 0 1 8 0"} />
  </svg>;
}
function Arrow({ down = false }: { down?: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={down ? "M12 4v16m-5-5 5 5 5-5" : "M12 20V4m-5 5 5-5 5 5"} /></svg>;
}
function Locate() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="6" /><path d="M12 2v5m0 10v5M2 12h5m10 0h5" /></svg>;
}
function Thumbnail({ element }: { element: CanvasElement }) {
  return <span className={`te-layer-thumb te-layer-thumb-${element.type}`} aria-hidden>
    {element.type === "image" ? (
      // Reuse the same proxy as the canvas; never inline remote SVG markup.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={proxied(element.src)} alt="" draggable={false} style={{ objectPosition: `${element.cropX}% ${element.cropY}%` }} />
    ) : element.type === "text" ? <span className={`gf-font-${element.font}`} style={{ color: element.color, fontWeight: element.fontWeight, fontStyle: element.italic ? "italic" : "normal" }}>{element.text.trim().slice(0, 2) || "T"}</span> : <span className="te-layer-shape-preview" style={{ background: element.fill, border: element.strokeWidth ? `1px solid ${element.stroke}` : undefined, borderRadius: element.shape === "ellipse" ? "50%" : Math.min(7, element.radius), aspectRatio: `${element.width}/${element.height}` }} />}
  </span>;
}

/** Toggle the same selection unit the canvas uses, including nested groups and isolation. */
export function layerSelectionAfterClick(scene: CanvasScene, selectedIds: readonly string[], targetIds: readonly string[], extend: boolean, isolatedGroupId?: string): string[] {
  const targets = expandGroupSelection(scene, targetIds, isolatedGroupId);
  if (!extend) return targets;
  const current = expandGroupSelection(scene, selectedIds, isolatedGroupId);
  const targetSet = new Set(targets);
  return targets.every(id => current.includes(id))
    ? current.filter(id => !targetSet.has(id))
    : [...new Set([...current, ...targets])];
}

/** Dragging an already-selected group child still moves its complete selection unit. */
export function layerDragSelection(scene:CanvasScene,selectedIds:readonly string[],targetId:string,isolatedGroupId?:string):string[]{
  const ids=expandGroupSelection(scene,selectedIds.includes(targetId)?selectedIds:[targetId],isolatedGroupId);
  return ids.filter(id=>{const item=scene.elements.find(element=>element.id===id);return item&&!isElementLocked(scene,item);});
}

export function LayersPanel({ scene, selectedIds, onSelect, onChange, width, height, disabled = false, onContextMenu, onMenuClick, onDuplicate, onDelete, onLocate, onEnterGroup, onExitGroup, isolatedGroupId, onGroupContextMenu }: LayersPanelProps) {
  const [query, setQuery] = useState("");
  const [multiSelect, setMultiSelect] = useState(false);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState("");
  const cancelledRename = useRef(false);
  const [dragging, setDragging] = useState<string[]>([]);
  const dragIds = useRef<string[]>([]);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupRename, setGroupRename] = useState<{ id: string; value: string } | null>(null);
  const selectedSet = new Set(selectedIds);
  const selected = scene.elements.filter((element) => selectedSet.has(element.id));
  const unlocked = selected.filter((element) => !isElementLocked(scene, element));
  const order = [...scene.elements].reverse();
  const tree = buildLayerRows(scene, collapsedGroups, isolatedGroupId, query);
  const resultIds = [...new Set(tree.flatMap(row => row.kind === "element" ? [row.element.id] : row.memberIds))];
  const moveUp = reorderSelection(scene, selectedIds, "forward");
  const moveDown = reorderSelection(scene, selectedIds, "backward");

  function toggle(id: string, key: "locked" | "hidden") {
    if (disabled) return;
    const source = scene.elements.find((element) => element.id === id);
    if (!source) return;
    const value = !source[key];
    const accepted = onChange({ ...scene, elements: scene.elements.map((element) => element.id === id ? { ...element, [key]: value } : element) });
    if (accepted !== false) setAnnouncement(`${layerName(source)} ${key === "locked" ? value ? "locked" : "unlocked" : value ? "hidden" : "shown"}.`);
  }
  function beginRename(element: CanvasElement) {
    if (disabled || isElementLocked(scene, element)) return;
    cancelledRename.current = false;
    setRenameError("");
    setRename({ id: element.id, value: element.name });
  }
  function finishRename() {
    if (!rename) return;
    if (cancelledRename.current) { setRename(null); return; }
    const source = scene.elements.find((element) => element.id === rename.id);
    if (disabled || !source || isElementLocked(scene, source)) { setRenameError("Unlock the layer before renaming it."); return; }
    const name = rename.value.trim() || typeName(source);
    if (name === source.name) { setRename(null); return; }
    const accepted = onChange({ ...scene, elements: scene.elements.map((element) => element.id === rename.id ? { ...element, name } : element) }, `rename-layer:${rename.id}`);
    if (accepted === false) { setRenameError("Name not saved. Check the workspace save message."); return; }
    setRename(null); setRenameError(""); setAnnouncement(`Layer renamed to ${name}.`);
  }
  function choose(element: CanvasElement, extend: boolean) {
    if (disabled) return;
    onSelect(layerSelectionAfterClick(scene, selectedIds, [element.id], multiSelect || extend, isolatedGroupId));
  }
  function shift(direction: "up" | "down") {
    if (disabled) return;
    const result = direction === "up" ? moveUp : moveDown;
    if (result.scene !== scene && onChange(result.scene) !== false) setAnnouncement(`${unlocked.length === 1 ? "Layer" : "Layers"} moved ${direction}.`);
  }
  function startDrag(event: DragEvent, element: CanvasElement) {
    if (disabled || multiSelect || isElementLocked(scene, element) || rename) { event.preventDefault(); return; }
    const ids = layerDragSelection(scene,selectedIds,element.id,isolatedGroupId);
    if (!selectedSet.has(element.id)) onSelect(ids);
    dragIds.current = ids; setDragging(ids);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-engine-layers", "move");
    event.dataTransfer.setData("text/plain", `${ids.length} layer${ids.length === 1 ? "" : "s"}`);
  }
  function endDrag() { dragIds.current = []; setDragging([]); setDropTarget(null); }
  function dragOver(event: DragEvent<HTMLElement>, element: CanvasElement) {
    if (disabled || !dragIds.current.length || dragIds.current.includes(element.id)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id: element.id, after: event.clientY > bounds.top + bounds.height / 2 });
  }
  function drop(event: DragEvent<HTMLElement>, element: CanvasElement) {
    event.preventDefault(); event.stopPropagation();
    const ids = new Set(dragIds.current);
    const moving = order.filter((item) => ids.has(item.id) && !isElementLocked(scene, item));
    if (disabled || !moving.length || ids.has(element.id)) { endDrag(); return; }
    const remaining = order.filter((item) => !moving.some((layer) => layer.id === item.id));
    const index = remaining.findIndex((item) => item.id === element.id);
    if (index < 0) { endDrag(); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > bounds.top + bounds.height / 2;
    const next = [...remaining.slice(0, index + Number(after)), ...moving, ...remaining.slice(index + Number(after))].reverse();
    if (next.some((item, i) => item.id !== scene.elements[i].id) && onChange({ ...scene, elements: next }) !== false) {
      onSelect(moving.map((item) => item.id));
      setAnnouncement(`${moving.length === 1 ? "Layer" : `${moving.length} layers`} reordered.`);
    }
    endDrag();
  }

  return <section className={`te-layer-manager${multiSelect ? " is-selecting-multiple" : ""}`} aria-label="Manage layers">
    <header className="te-panel-heading"><h2>Layers</h2><span>{scene.elements.length}/100</span></header>
    {isolatedGroupId && <div className="te-layer-isolation"><span>Inside {scene.groups?.find(group => group.id === isolatedGroupId)?.name || "group"}</span><button type="button" onClick={onExitGroup}>Exit group</button></div>}
    <label className="te-layer-search"><SearchIcon size={14} /><input aria-label="Search layers" placeholder="Find a layer…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear layer search" onClick={() => setQuery("")}>×</button>}</label>
    <div className="te-layer-selection-summary">
      <span>{selected.length ? `${selected.length} selected` : `${resultIds.length} ${resultIds.length === 1 ? "layer" : "layers"}`}</span>
      <button type="button" disabled={disabled || !resultIds.length} onClick={() => onSelect(resultIds)}>Select {query ? "results" : "all"}</button>
      {selected.length > 0 && <button type="button" disabled={disabled} onClick={() => onSelect([])}>Clear</button>}
    </div>
    <button type="button" className="te-layer-multi-select" disabled={disabled || !resultIds.length} aria-pressed={multiSelect} onClick={() => setMultiSelect(value => !value)}>
      <span aria-hidden="true">{multiSelect ? "✓" : "☐"}</span>{multiSelect ? "Done selecting" : "Select multiple"}
    </button>
    {multiSelect && <p className="te-layer-multi-help">Tap layers to add or remove them. Groups stay together.</p>}
    <div className="te-layer-toolbar" role="group" aria-label="Selected layer actions">
      <button type="button" disabled={disabled || moveUp.scene === scene} aria-label="Move selected layers up" title="Move up · toward front" onClick={() => shift("up")}><Arrow /></button>
      <button type="button" disabled={disabled || moveDown.scene === scene} aria-label="Move selected layers down" title="Move down · toward back" onClick={() => shift("down")}><Arrow down /></button>
      <span className="te-layer-toolbar-divider" />
      <button type="button" disabled={disabled || selected.length !== 1 || selected[0]?.locked} aria-label="Rename selected layer" title="Rename layer · F2" onClick={() => selected[0] && beginRename(selected[0])}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" /></svg></button>
      {onDuplicate && <button type="button" disabled={disabled || !unlocked.length || scene.elements.length >= 100} aria-label="Duplicate selected layers" title="Duplicate selected layers" onClick={onDuplicate}><CopyIcon /></button>}
      {onDelete && <button type="button" className="te-layer-delete" disabled={disabled || !unlocked.length} aria-label="Delete selected layers" title="Delete selected layers" onClick={onDelete}><TrashIcon /></button>}
    </div>
    {renameError && <p className="te-layer-rename-error" role="alert">{renameError}</p>}
    <div className="te-layer-order-caption"><span>FRONT</span><span>Drag to reorder</span></div>
    <ul className="te-layer-list" aria-label="Layers from front to back">
      {tree.map((row) => {
        if (row.kind === "group") {
          const { group, memberIds } = row;
          const members = scene.elements.filter(item => memberIds.includes(item.id));
          const hidden = Boolean(group.hidden);
          const locked = Boolean(group.locked);
          return <li key={`group:${group.id}`} className={`te-layer-group ${memberIds.length && memberIds.every(id => selectedSet.has(id)) ? "is-selected" : ""}`} style={{ marginLeft: row.depth * 12 }} onContextMenu={event => onGroupContextMenu?.(event, group.id)}>
            <div className="te-layer-row-main"><button type="button" className="te-layer-collapse" aria-label={`${collapsedGroups.has(group.id) ? "Expand" : "Collapse"} group ${group.name}`} aria-expanded={!collapsedGroups.has(group.id)} onClick={() => setCollapsedGroups(previous => { const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{collapsedGroups.has(group.id) ? "›" : "⌄"}</button>
              <button type="button" className="te-layer-select" disabled={disabled} aria-label={`Select group ${group.name}`} aria-pressed={members.length > 0 && memberIds.every(id => selectedSet.has(id))} onClick={event => onSelect(layerSelectionAfterClick(scene, selectedIds, memberIds, multiSelect || event.shiftKey || event.metaKey || event.ctrlKey, isolatedGroupId))} onDoubleClick={() => { if (!multiSelect) onEnterGroup?.(group.id); }}>{multiSelect && <span className="te-layer-selection-check" aria-hidden="true">{memberIds.length > 0 && memberIds.every(id => selectedSet.has(id)) ? "✓" : memberIds.some(id => selectedSet.has(id)) ? "−" : ""}</span>}<span className="te-layer-thumb" aria-hidden>▤</span><span className="te-layer-description"><strong>{group.name}</strong><span>{memberIds.length} layers</span></span></button>
              <div className="te-layer-row-tools"><button type="button" disabled={disabled} aria-label={`${hidden ? "Show" : "Hide"} group ${group.name}`} onClick={() => { const result = setGroupHidden(scene, group.id, !hidden); onChange(result.scene); }}><Eye hidden={hidden} /></button><button type="button" disabled={disabled} aria-label={`${locked ? "Unlock" : "Lock"} group ${group.name}`} onClick={() => { const result = setGroupLocked(scene, group.id, !locked); onChange(result.scene); }}><Lock locked={locked} /></button><button type="button" disabled={disabled} aria-label={`Rename group ${group.name}`} onClick={() => setGroupRename({ id: group.id, value: group.name })}>✎</button>{onEnterGroup && <button type="button" title="Edit inside group" aria-label={`Enter group ${group.name}`} onClick={() => onEnterGroup(group.id)}>↳</button>}</div>
            </div>
            <details className="te-layer-group-appearance"><summary>Group opacity</summary><label>Opacity <input aria-label={`Opacity of group ${group.name}`} type="range" min={0} max={100} value={Math.round((group.opacity??1)*100)} disabled={disabled||locked||members.some(element=>isElementLocked(scene,element)||element.protected?.includes("style"))} onChange={event=>onChange({...scene,groups:scene.groups?.map(item=>item.id===group.id?{...item,opacity:Number(event.target.value)/100}:item)},`group-opacity:${group.id}`)}/><output>{Math.round((group.opacity??1)*100)}%</output></label></details>
            {groupRename?.id === group.id && <input className="te-layer-rename" autoFocus aria-label={`Group name ${group.name}`} value={groupRename.value} maxLength={100} onChange={event => setGroupRename({ ...groupRename, value: event.target.value })} onBlur={() => { const name = groupRename.value.trim(); if (name && name !== group.name && !disabled) onChange({ ...scene, groups: scene.groups?.map(item => item.id === group.id ? { ...item, name } : item) }); setGroupRename(null); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setGroupRename(null); }} />}
          </li>;
        }
        const element = row.element;
        const name = layerName(element), hidden = isElementHidden(scene, element), effectiveLocked = isElementLocked(scene, element), offCanvas = !elementIntersectsCanvas(element, width, height);
        return <li key={element.id} style={{ marginLeft: row.depth * 12 }} data-layer-row-id={element.id} draggable={!disabled && !multiSelect && !effectiveLocked && !rename}
          className={`${selectedSet.has(element.id) ? "is-selected " : ""}${hidden ? "is-hidden " : ""}${dragging.includes(element.id) ? "is-dragging " : ""}${dropTarget?.id === element.id ? dropTarget.after ? "drop-after" : "drop-before" : ""}`}
          onDragStart={(event) => startDrag(event, element)} onDragEnd={endDrag} onDragOver={(event) => dragOver(event, element)} onDrop={(event) => drop(event, element)}
          onContextMenu={(event) => onContextMenu(event, element)}
          onKeyDown={(event) => {
            if ((event.target as HTMLElement).closest("input,textarea,select")) return;
            if (event.key === "F2") { event.preventDefault(); event.stopPropagation(); beginRename(element); }
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation();
              const ids = selectedSet.has(element.id) ? selectedIds : [element.id];
              const next = reorderSelection(scene, ids, event.key === "ArrowUp" ? "forward" : "backward");
              if (!disabled && next.scene !== scene && onChange(next.scene) !== false) { onSelect(ids); setAnnouncement(`${name} moved ${event.key === "ArrowUp" ? "up" : "down"}.`); }
            }
          }}>
          <div className="te-layer-row-main">
            <button type="button" className="te-layer-select" disabled={disabled} aria-pressed={selectedSet.has(element.id)} aria-label={`Select layer ${name}${hidden ? ", hidden" : ""}${effectiveLocked ? ", locked" : ""}`} onClick={(event) => choose(element, event.shiftKey || event.metaKey || event.ctrlKey)} onDoubleClick={() => { if (!multiSelect) beginRename(element); }}>
              {multiSelect && <span className="te-layer-selection-check" aria-hidden="true">{selectedSet.has(element.id) ? "✓" : ""}</span>}
              <Thumbnail element={element} />
              <span className="te-layer-description"><strong>{name}</strong><span>{typeName(element)}{effectiveLocked ? " · Locked" : ""}{hidden ? " · Hidden" : ""}</span></span>
            </button>
            <div className="te-layer-row-tools">
              <button type="button" disabled={disabled || (hidden && !element.hidden)} className={hidden ? "is-on" : ""} aria-label={`${hidden ? "Show" : "Hide"} layer ${name}`} title={hidden ? "Show layer" : "Hide layer"} aria-pressed={!hidden} onClick={() => toggle(element.id, "hidden")}><Eye hidden={hidden} /></button>
              <button type="button" disabled={disabled || (effectiveLocked && !element.locked)} className={effectiveLocked ? "is-on" : ""} aria-label={`${element.locked ? "Unlock" : "Lock"} layer ${name}`} title={element.locked ? "Unlock layer" : "Lock layer"} aria-pressed={effectiveLocked} onClick={() => toggle(element.id, "locked")}><Lock locked={effectiveLocked} /></button>
              <button type="button" aria-label={`Actions for layer ${name}`} title="Layer actions" aria-haspopup="menu" onClick={(event) => (onMenuClick ?? onContextMenu)(event, element)}>⋯</button>
            </div>
          </div>
          {rename?.id === element.id && <input className="te-layer-rename" autoFocus aria-label={`Rename layer ${name}`} value={rename.value} maxLength={200} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setRename({ ...rename, value: event.target.value }); setRenameError(""); }} onBlur={(event) => { if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="menu"]')) return; finishRename(); }} onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === "Escape") { event.preventDefault(); cancelledRename.current = true; setRename(null); setRenameError(""); }
          }} />}
          {offCanvas && <button type="button" className="te-layer-off-canvas" disabled={disabled} title="Find on workspace" onClick={() => { onSelect([element.id]); onLocate?.(element); }}><Locate />Outside page<span>Locate ↗</span></button>}
        </li>;
      })}
    </ul>
    {!tree.length && <div className="te-layer-empty"><span aria-hidden>▤</span><strong>{scene.elements.length ? "No matching layers" : "Your canvas is ready"}</strong><p>{scene.elements.length ? "Search for a name, text, or layer type." : "Add text, shapes, or images and manage them here."}</p></div>}
    {tree.length > 0 && <div className="te-layer-order-caption te-layer-back-caption"><span>BACK</span></div>}
    <p className="te-layer-help">Choose Select multiple or Shift-click to select several layers. Double-click a name to rename. Alt + ↑ / ↓ changes the order.</p>
    <span className="te-sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
