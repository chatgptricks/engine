"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LayoutIcon,
  PlusIcon,
  StarIcon,
  TextIcon,
  TrashIcon,
} from "@/components/engine/icons";
import {
  FORMATS,
  designAsTemplate,
  duplicatePage,
  createCanvasElement,
  sceneForPage,
  type CanvasElement,
  type CanvasScene,
  type BrandKit,
  type SavedBrandKit,
  type BrandAsset,
  type DesignDocument,
  type DesignFormat,
  type DesignTemplate,
  type DesignPage,
  type ShapeElement,
  type ShapeImageFill,
  duplicateCanvasScene,
  formatDimensions,
} from "@/lib/template-editor/model";
import { exportFrames, fileName, saveBlob, type ExportOptions } from "@/lib/template-editor/export";
import { updateTextStyle, applyTextStyle, updateColorRole, removeColorRole, resizeDesignDocument } from "@/lib/template-editor/advanced";
import { LayoutPanel } from "./layout-panel";
import { WorkflowPanel } from "./workflow-panel";
import { ExportDialog } from "./export-dialog";
import { TemplateApplyDialog } from "./template-apply-dialog";
import { importSVG, combineShapes } from "@/lib/template-editor/vector";
import {applyDesignPatch} from "@/lib/template-editor/document-patch";
import { preflightDesign, type PreflightIssue } from "@/lib/template-editor/preflight";
import { ColorField, Modal } from "./controls";
import { CanvasEditor } from "./canvas";
import type { TextFormattingPatch, TextFormatter } from "@/lib/template-editor/rich-text-editing";
import { prepareBrandAsset } from "./brand-workspace";
import { findPhotoFrameAtPoint } from "@/lib/template-editor/photo-frames";
import { PHOTO_DRAG_TYPE, decodePhotoDrag, writePhotoDrag } from "@/lib/template-editor/photo-drag";
import { proxied } from "@/lib/engine/util";
import { LayersPanel } from "./layers-panel";
import { enableContinuousCarousel, splitContinuousCarousel } from "@/lib/template-editor/continuous-carousel";
import { elementIntersectsCanvas, elementVisualBounds, sceneVisualBounds } from "@/lib/template-editor/canvas-geometry";
import { BrandPanel } from "./brand-panel";
import { QuickToolbar } from "./quick-toolbar";
import { useContextMenu, type ContextMenuItem } from "./context-menu";
import { copySelection, duplicateSelection, pasteSelection, removeSelection, setSelectionLocked, reorderSelection, alignSelection, groupSelection, ungroupSelection, setGroupHidden, setGroupLocked, expandGroupSelection, scopeSelection, constrainSceneToIsolation, canEditElement, isElementHidden, isElementLocked, fillShapeWithImage, applyTextTexture, type SceneCommandResult } from "@/lib/template-editor/commands";
import {groupMemberIds} from "@/lib/template-editor/layer-tree";
import { translateElements } from "@/lib/template-editor/snapping";
import { ElementInspector } from "./element-inspector";
import "./wysiwyg.css";
import "./pro-tools.css";
import { DesignFrame, DesignPreview, FRAME_WIDTH } from "./preview";

type Tab =
  | "templates"
  | "brand"
  | "text"
  | "elements"
  | "media"
  | "layers"
  | "caption"
  | "style";
type Props = {
  design: DesignDocument;
  templates: DesignTemplate[];
  brand: BrandKit;
  brandKits: SavedBrandKit[];
  activeBrandKitId: string;
  onSelectBrandKit: (id: string) => void;
  onSaveBrandAsset: (asset: BrandAsset, kitId: string) => boolean | void;
  onManageBrand: () => void;
  saveStatus: string;
  canEdit: boolean;
  onChange: (design: DesignDocument) => boolean | void;
  onExit: () => void;
  onSaveTemplate: (template: DesignTemplate) => void;
  onAddDesigns?: (designs: DesignDocument[]) => boolean | void;
};

export function DesignEditor({
  design: initial,
  templates,
  brand,
  brandKits,
  activeBrandKitId,
  onSelectBrandKit,
  onSaveBrandAsset,
  onManageBrand,
  saveStatus,
  canEdit,
  onChange,
  onExit,
  onSaveTemplate,
  onAddDesigns,
}: Props) {
  const { openMenu } = useContextMenu();
  const [editingRequest, setEditingRequest] = useState<{id: string; serial: number}>();
  const [renameLayer, setRenameLayer] = useState<{id: string; name: string} | null>(null);
  const [design, setDesign] = useState<DesignDocument>(initial);
  const current = useRef<DesignDocument>(design);
  const history = useRef<{
    past: DesignDocument[];
    future: DesignDocument[];
    group: string;
    time: number;
  }>({ past: [], future: [], group: "", time: 0 });
  const [historyState, setHistoryState] = useState({
    undo: false,
    redo: false,
  });
  const [pageId, setPageId] = useState(initial.pages[0].id);
  const activePage = useRef(pageId);
  useEffect(() => {
    activePage.current = pageId;
  }, [pageId]);
  const [tab, setTab] = useState<Tab>("text");
  const [selection, setSelected] = useState<string[]>([]);
  const copied = useRef<CanvasElement[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [notice, setNotice] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [exportDialog,setExportDialog]=useState(false);
  const [preflightIssues,setPreflightIssues]=useState<PreflightIssue[]>([]);
  const [layoutOpen,setLayoutOpen]=useState(false);
  const [workflowOpen,setWorkflowOpen]=useState(false);
  const [editingMaster,setEditingMaster]=useState(false);
  const [requestedIsolationGroupId,setIsolatedGroupId]=useState<string|null>(null);
  const [cropImageId,setCropImageId]=useState<string|null>(null);
  const [pathTool,setPathTool]=useState(false);
  const [imageDropTargetId,setImageDropTargetId]=useState<string|null>(null);
  const paletteDrag=useRef<(()=>void)|null>(null);
  const suppressPaletteClick=useRef(false);
  const [photoGhost,setPhotoGhost]=useState<{src:string;x:number;y:number}|null>(null);
  const [applyingTemplateId,setApplyingTemplateId]=useState<string|null>(null);
  const applyingTemplate=templates.find(template=>template.id===applyingTemplateId&&!template.deletedAt)??null;
  const currentTemplates=useRef(templates);
  useLayoutEffect(()=>{currentTemplates.current=templates;},[templates]);
  const [spacePanning,setSpacePanning]=useState(false);
  const panGesture=useRef<{x:number;y:number;left:number;top:number;pointer:number}|null>(null);
  const textFormatter=useRef<TextFormatter|null>(null);
  const registerFormatter=useCallback((formatter:TextFormatter|null)=>{textFormatter.current=formatter;},[]);
  const formatText=useCallback((patch:TextFormattingPatch)=>textFormatter.current?.(patch)??false,[]);
  const exportAbort=useRef<AbortController|null>(null);
  const [job, setJob] = useState<{
    design: DesignDocument;
    pageId?: string;
    pageIds?: string[];
    options?: ExportOptions;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [removePageId, setRemovePageId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const [workspaceSize, setWorkspaceSize] = useState({width: 0, height: 0});
  const [clipToCanvas, setClipToCanvas] = useState(true);
  const [onionSkin, setOnionSkin] = useState(false);
  const [onionOpacity, setOnionOpacity] = useState(.2);
  const [spanFrom, setSpanFrom] = useState(1);
  const [spanThrough, setSpanThrough] = useState(4);
  const [centerRequest, setCenterRequest] = useState(0);
  const previousWorkspace = useRef<{pageId: string; scale: number; left: number; top: number; height: number; centerRequest: number; viewportWidth: number; viewportHeight: number} | null>(null);
  const zoomAnchor=useRef<{x:number;y:number;screenX:number;screenY:number}|null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0];
  const activePageId = page.id;
  const index = design.pages.indexOf(page);
  const format = formatDimensions(design);
  const canvasHeight = (FRAME_WIDTH * format.height) / format.width;
  const continuous = Boolean(design.continuousCanvas)&&!editingMaster;
  const canvasWidth = FRAME_WIDTH * (continuous ? design.pages.length : 1);
  const scene = editingMaster ? design.masterScene??{background:'transparent',elements:[]} : design.continuousCanvas ?? page.canvas ?? sceneForPage(page, design.format);
  const isolatedGroupId = scene.groups?.some(group => group.id === requestedIsolationGroupId) ? requestedIsolationGroupId : null;
  const selected = scopeSelection(scene, selection, isolatedGroupId ?? undefined);
  const previousPage = !continuous && index > 0 ? design.pages[index - 1] : undefined;
  const onionScene = onionSkin && page.canvas && previousPage ? previousPage.canvas ?? sceneForPage(previousPage, design.format) : undefined;
  const selectedImage = selected.length === 1 ? scene.elements.find((element) => element.id === selected[0] && element.type === "image") : undefined;
  const scale = Math.max(0.005, fit) * zoom;
  // Only committed geometry changes the scrollable area; dragging never moves
  // the coordinate origin underneath the pointer. Include hidden layers so
  // showing/hiding one cannot unexpectedly shrink or recenter the workspace.
  const sceneBounds = sceneVisualBounds(scene);
  const workspaceLeft = Math.max(540, (workspaceSize.width / scale - canvasWidth) / 2 + 40, 80 - (sceneBounds?.x ?? 0));
  const workspaceTop = Math.max(canvasHeight * .75, (workspaceSize.height / scale - canvasHeight) / 2 + 40, 80 - (sceneBounds?.y ?? 0));
  const workspaceRight = Math.max(540, (workspaceSize.width / scale - canvasWidth) / 2 + 40, (sceneBounds ? sceneBounds.x + sceneBounds.width : canvasWidth) - canvasWidth + 80);
  const workspaceBottom = Math.max(canvasHeight * .75, (workspaceSize.height / scale - canvasHeight) / 2 + 40, (sceneBounds ? sceneBounds.y + sceneBounds.height : canvasHeight) - canvasHeight + 80);
  const pasteboardBounds = {x: -workspaceLeft, y: -workspaceTop, width: workspaceLeft + canvasWidth + workspaceRight, height: workspaceTop + canvasHeight + workspaceBottom};
  const isolatedIds=isolatedGroupId?new Set(groupMemberIds(scene,isolatedGroupId)):null;
  const editorTarget=useRef('');
  useEffect(()=>{editorTarget.current=`${pageId}:${editingMaster}:${isolatedGroupId??''}`;},[pageId,editingMaster,isolatedGroupId]);
  const selectable=scene.elements.filter(e=>(!isolatedIds||isolatedIds.has(e.id))&&!isElementLocked(scene,e)&&!isElementHidden(scene,e));
  const outsideCount = scene.elements.filter((element) => !element.hidden && !elementIntersectsCanvas(element, canvasWidth, canvasHeight)).length;

  function fitPage() {
    zoomAnchor.current=null;
    setZoom(1);
    setCenterRequest((value) => value + 1);
  }
  function locateLayer(element: CanvasElement) {
    const node = workspaceRef.current;
    if (!node) return;
    const box = elementVisualBounds(element);
    const left = (workspaceLeft + box.x) * scale;
    const top = (workspaceTop + box.y) * scale;
    const right = left + box.width * scale;
    const bottom = top + box.height * scale;
    if (left < node.scrollLeft + 24 || right > node.scrollLeft + node.clientWidth - 24 || top < node.scrollTop + 24 || bottom > node.scrollTop + node.clientHeight - 24) {
      node.scrollTo({left: (left + right - node.clientWidth) / 2, top: (top + bottom - node.clientHeight) / 2});
    }
  }
  function selectLayers(ids: string[]) {
    setSelected(expandGroupSelection(scene,ids,isolatedGroupId??undefined));
    const element = scene.elements.find((item) => item.id === ids.at(-1));
    if (element && !element.hidden) locateLayer(element);
  }
  function enterGroup(id: string) {
    if (!scene.groups?.some(group => group.id === id)) return;
    setIsolatedGroupId(id);
    setSelected(scopeSelection(scene, selected, id));
    setCropImageId(null);
    setEditingRequest(undefined);
  }
  useLayoutEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const previous = previousWorkspace.current;
    const anchor=zoomAnchor.current;
    if(anchor){node.scrollLeft=(anchor.x+workspaceLeft)*scale-anchor.screenX;node.scrollTop=(anchor.y+workspaceTop)*scale-anchor.screenY;zoomAnchor.current=null;}
    else if (!previous || previous.pageId !== page.id || previous.height !== canvasHeight || previous.centerRequest !== centerRequest || previous.viewportWidth !== node.clientWidth || previous.viewportHeight !== node.clientHeight) {
      node.scrollLeft = (workspaceLeft + (continuous && previous && previous.pageId !== page.id ? index * FRAME_WIDTH + FRAME_WIDTH / 2 : canvasWidth / 2)) * scale - node.clientWidth / 2;
      node.scrollTop = (workspaceTop + canvasHeight / 2) * scale - node.clientHeight / 2;
    } else {
      // Preserve the same world point at the center when zoom or padding changes.
      const centerX = (node.scrollLeft + previous.viewportWidth / 2) / previous.scale - previous.left;
      const centerY = (node.scrollTop + previous.viewportHeight / 2) / previous.scale - previous.top;
      node.scrollLeft = (centerX + workspaceLeft) * scale - node.clientWidth / 2;
      node.scrollTop = (centerY + workspaceTop) * scale - node.clientHeight / 2;
    }
    previousWorkspace.current = {pageId: page.id, scale, left: workspaceLeft, top: workspaceTop, height: canvasHeight, centerRequest, viewportWidth: node.clientWidth, viewportHeight: node.clientHeight};
  }, [page.id, canvasHeight, canvasWidth, continuous, index, scale, workspaceLeft, workspaceTop, centerRequest]);
  const isTemplateDraft = design.purpose === "template";
  const saveTemplateLabel = isTemplateDraft
    ? design.editingTemplateId
      ? "Update template"
      : "Save template"
    : "Save as template";
  const disabled = !canEdit || Boolean(job);
  const blocked = useRef(disabled);
  useEffect(() => { blocked.current = disabled; }, [disabled]);

  const commit = useCallback(
    (change: (d: DesignDocument) => DesignDocument, group = "") => {
      if (blocked.current) return false;
      const previous = current.current;
      let changed:DesignDocument;
      try{changed=change(previous);}catch(error){setNotice(error instanceof Error?error.message:'Could not apply this change.');return false;}
      if(changed===previous)return true;
      const next = { ...changed, updatedAt: new Date().toISOString() };
      if (onChangeRef.current(next) === false) return false;
      const h = history.current;
      if (!group || group !== h.group || Date.now() - h.time > 650) {
        h.past.push(previous);
        if (h.past.length > 60) h.past.shift();
      }
      h.group = group;
      h.time = Date.now();
      h.future = [];
      setHistoryState({ undo: h.past.length > 0, redo: false });
      current.current = next;
      setDesign(next);
      return true;
    },
    [setNotice],
  );
  const travel = useCallback(
    (direction: "undo" | "redo") => {
      if (blocked.current) return;
      const h = history.current;
      const source = direction === "undo" ? h.past : h.future;
      const next = source.at(-1);
      if (!next) return;
      const updated = { ...next, updatedAt: new Date().toISOString() };
      if (onChangeRef.current(updated) === false) return;
      source.pop();
      (direction === "undo" ? h.future : h.past).push(current.current);
      h.group = "";
      setHistoryState({ undo: h.past.length > 0, redo: h.future.length > 0 });
      current.current = updated;
      setDesign(updated);
    },
    [],
  );
  function changeScene(next: CanvasScene, group = "") {
      return commit(
        (d) => {
          const target = d.pages.find(item => item.id === activePageId);
          if (!target) return d;
          const live = editingMaster ? d.masterScene ?? scene : d.continuousCanvas ?? target.canvas ?? sceneForPage(target, d.format);
          next = constrainSceneToIsolation(live, next, isolatedGroupId ?? undefined);
          if(editingMaster)return {...d,masterScene:next};
          const promoted=next.elements.filter(e=>e.master);
          if(promoted.length){const snapshot=copySelection(next,promoted.map(e=>e.id));const copy=duplicateCanvasScene({background:'transparent',elements:snapshot,groups:snapshot.groups});const master={background:'transparent',...d.masterScene,groups:[...(d.masterScene?.groups??[]),...(copy.groups??[])],elements:[...(d.masterScene?.elements??[]),...copy.elements.map(e=>({...e,x:e.x-(d.continuousCanvas?d.pages.findIndex(p=>p.id===activePageId)*FRAME_WIDTH:0)}))]};if(master.elements.length>100)throw new Error('The master supports up to 100 elements.');const remainder={...next,elements:next.elements.filter(e=>!e.master)};return d.continuousCanvas?{...d,masterScene:master,continuousCanvas:remainder}:{...d,masterScene:master,pages:d.pages.map(p=>p.id===activePageId?{...p,canvas:remainder}:p)};}
          return d.continuousCanvas ? {...d, continuousCanvas: next} : ({
          ...d,
          pages: d.pages.map((p) =>
            p.id === activePageId ? { ...p, canvas: next } : p,
          ),
        });},
        group ? `${activePageId}:${group}` : "",
      );
  }
  function applyCommandChecked(command: (live: CanvasScene) => SceneCommandResult) {
    if (blocked.current) return false;
    const target = current.current.pages.find((item) => item.id === page.id);
    if (!target) return false;
    const live = editingMaster?current.current.masterScene??scene:current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target, current.current.format);
    let result:SceneCommandResult;
    try{result=command(live);}catch(error){setNotice(error instanceof Error?error.message:'Could not apply this action.');return false;}
    if (result.scene !== live && !changeScene(result.scene)) return false;
    const committed = editingMaster ? current.current.masterScene ?? scene : current.current.continuousCanvas ?? current.current.pages.find(item => item.id === page.id)?.canvas ?? scene;
    setSelected(scopeSelection(committed, result.selectedIds, isolatedGroupId ?? undefined));
    if (result.limited) setNotice("This page has reached its 100-element limit.");
    return result.scene!==live&&!result.limited;
  }
  function applyCommand(command: (live:CanvasScene)=>SceneCommandResult):void { applyCommandChecked(command); }
  function copyElements(ids: string[], cut = false) {
    if (cut && blocked.current) return;
    const target = current.current.pages.find((item) => item.id === page.id);
    if (!target) return;
    const live = editingMaster?current.current.masterScene??scene:current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target, current.current.format);
    const scoped = scopeSelection(live, ids, isolatedGroupId ?? undefined);
    const copyIds = cut ? scoped.filter(id => { const element = live.elements.find(item => item.id === id); return element && canEditElement(live, element, "delete"); }) : scoped;
    copied.current = copySelection(live, copyIds, isolatedGroupId ?? undefined, { x: !editingMaster && current.current.continuousCanvas ? current.current.pages.indexOf(target) * FRAME_WIDTH : 0, y: 0 });
    if (cut) applyCommand((live) => removeSelection(live, copyIds));
    setNotice(`${copied.current.length} element${copied.current.length === 1 ? "" : "s"} ${cut ? "cut" : "copied"}. Paste on any page in this design.`);
  }
  function pasteElements(live: CanvasScene, position?: { x: number; y: number }) {
    const index = current.current.pages.findIndex(item => item.id === page.id);
    return pasteSelection(live, copied.current, position, { x: !editingMaster && current.current.continuousCanvas ? Math.max(0,index) * FRAME_WIDTH : 0, y: 0 });
  }
  function elementMenu(ids: string[]): ContextMenuItem[] {
    ids = scopeSelection(scene, ids, isolatedGroupId ?? undefined);
    const elements = scene.elements.filter((e) => ids.includes(e.id));
    const editable = elements.filter((e) => canEditElement(scene, e, "position"));
    const deletable = elements.filter((e) => canEditElement(scene, e, "delete"));
    const single = elements.length === 1 ? elements[0] : undefined;
    return [
      ...(single?.type === "text" ? [{id: "edit-text", label: "Edit text", disabled: disabled || !canEditElement(scene, single, "content") || isElementHidden(scene,single), onSelect: () => setEditingRequest({id: single.id, serial: Date.now()})}] : []),
      {id: "copy", label: "Copy", shortcut: "⌘/Ctrl C", onSelect: () => copyElements(ids)},
      {id: "cut", label: "Cut", shortcut: "⌘/Ctrl X", disabled: disabled || !deletable.length, onSelect: () => copyElements(ids, true)},
      {id: "duplicate", label: "Duplicate", shortcut: "⌘/Ctrl D", disabled: disabled || !editable.length || scene.elements.length >= 100, onSelect: () => applyCommand((live) => duplicateSelection(live, ids,undefined,isolatedGroupId??undefined))},
      {id: "paste", label: "Paste", shortcut: "⌘/Ctrl V", disabled: disabled || !copied.current.length || scene.elements.length >= 100, onSelect: () => applyCommand((live) => pasteElements(live))},
      {id:'group',label:'Group selection',shortcut:'⌘/Ctrl G',disabled:disabled||editable.length<2,onSelect:()=>applyCommand(live=>groupSelection(live,ids,"Group",isolatedGroupId??undefined))},
      {id:'ungroup',label:'Ungroup',shortcut:'⌘/Ctrl ⇧ G',disabled:disabled||!editable.some(e=>e.groupId&&e.groupId!==isolatedGroupId),onSelect:()=>applyCommand(live=>ungroupSelection(live,ids,isolatedGroupId??undefined))},
      ...((single?.type==='image'||(single?.type==='shape'&&single.imageFill))?[{id:'crop-image',label:cropImageId===single.id?'Finish crop':'Crop image',disabled:disabled||!canEditElement(scene,single,'style'),onSelect:()=>setCropImageId(cropImageId===single.id?null:single.id)}]:[]),
      {id: "front", label: "Bring to front", separator: true, disabled: disabled || !editable.length, onSelect: () => applyCommand((live) => reorderSelection(live, ids, "front"))},
      {id: "forward", label: "Bring forward", shortcut: "⌘/Ctrl ]", disabled: disabled || !editable.length, onSelect: () => applyCommand((live) => reorderSelection(live, ids, "forward"))},
      {id: "backward", label: "Send backward", shortcut: "⌘/Ctrl [", disabled: disabled || !editable.length, onSelect: () => applyCommand((live) => reorderSelection(live, ids, "backward"))},
      {id: "back", label: "Send to back", disabled: disabled || !editable.length, onSelect: () => applyCommand((live) => reorderSelection(live, ids, "back"))},
      {id: "center", label: "Center horizontally on page", separator: true, disabled: disabled || !editable.length, onSelect: () => applyCommand((live) => alignSelection(live, ids, "center", {width: canvasWidth, height: canvasHeight}, "group"))},
      {id: "middle", label: "Center vertically on page", disabled: disabled || !editable.length, onSelect: () => applyCommand((live) => alignSelection(live, ids, "middle", {width: canvasWidth, height: canvasHeight}, "group"))},
      {id: "lock", label: editable.length ? "Lock" : "Unlock", separator: true, disabled, onSelect: () => applyCommand((live) => setSelectionLocked(live, ids, editable.length > 0))},
      {id: "visibility", label: elements.some((element) => !element.hidden) ? "Hide layers" : "Show layers", disabled:disabled||!elements.some(e=>!isElementLocked(scene,e)), onSelect: () => applyCommand((live) => ({scene: {...live, elements: live.elements.map((element) => ids.includes(element.id)&&!isElementLocked(live,element) ? {...element, hidden: elements.some((item) => !item.hidden)} : element)}, selectedIds: ids, limited: false}))},
      ...(single ? [{id: "locate", label: "Find on workspace", onSelect: () => locateLayer(single)}] : []),
      ...(single ? [{id: "rename", label: "Rename layer", disabled: disabled || !canEditElement(scene,single,"content"), onSelect: () => setRenameLayer({id: single.id, name: single.name})}] : []),
      ...(single?.type === "image" ? [{id:"save-brand", label:"Save image to brand kit", disabled:disabled || (brandKits.find((kit) => kit.id === activeBrandKitId)?.assets.length ?? 0) >= 40, onSelect:() => {
        if (blocked.current) return;
        if (onSaveBrandAsset({id:crypto.randomUUID(),name:single.name,src:single.src,width:single.width,height:single.height,kind:"image"}, activeBrandKitId) === false) return;
        setNotice("Image saved to your brand kit. Reuse it from the Brand tab.");
      }}] : []),
      {id: "properties", label: "Show properties", onSelect: () => setTab("style")},
      {id: "delete", label: "Delete", shortcut: "⌫", separator: true, danger: true, disabled: disabled || !deletable.length, onSelect: () => applyCommand((live) => removeSelection(live, ids))},
    ];
  }
  function canvasMenu(event: React.MouseEvent, targetId: string | null) {
    const ids = scopeSelection(scene,targetId ? (selected.includes(targetId) ? selected : [targetId]) : [],isolatedGroupId??undefined);
    setSelected(ids);
    const rect = event.currentTarget.closest(".te-free-stage")?.getBoundingClientRect();
    const position = rect ? {x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale} : undefined;
    openMenu(event, {
      label: ids.length > 1 ? `${ids.length} selected elements` : ids.length ? scene.elements.find((e) => e.id === ids[0])?.name ?? "Element" : "Canvas",
      items: ids.length ? elementMenu(ids) : [
        {id: "paste", label: "Paste here", shortcut: "⌘/Ctrl V", disabled: disabled || !copied.current.length || scene.elements.length >= 100, onSelect: () => applyCommand((live) => pasteElements(live, position))},
        {id: "text", label: "Add text", shortcut: "T", disabled, onSelect: () => addText()},
        {id: "shape", label: "Add rectangle", shortcut: "R", disabled, onSelect: () => addShape("rectangle")},
        {id: "image", label: "Upload image", disabled: disabled || uploading, onSelect: () => fileRef.current?.click()},
        {id: "select", label: "Select all unlocked elements", shortcut: "⌘/Ctrl A", separator: true, disabled: !scene.elements.some((e) => !e.locked && !e.hidden), onSelect: () => setSelected(selectable.map(e=>e.id))},
        {id: "background", label: "Page background & properties", onSelect: () => setTab("style")},
        {id: "undo", label: "Undo", shortcut: "⌘/Ctrl Z", separator: true, disabled: disabled || !historyState.undo, onSelect: () => travel("undo")},
        {id: "redo", label: "Redo", shortcut: "⌘/Ctrl ⇧ Z", disabled: disabled || !historyState.redo, onSelect: () => travel("redo")},
      ],
    });
  }
  function pageMenu(event: React.MouseEvent, target: DesignPage) {
    const targetIndex = design.pages.findIndex((p) => p.id === target.id);
    openMenu(event, {label: `Page ${targetIndex + 1}`, items: [
      {id: "open-page", label: "Go to page", onSelect: () => {setPageId(target.id); setSelected([]);}},
      {id: "duplicate-page", label: "Duplicate page", disabled: disabled || continuous || design.pages.length >= 20, onSelect: () => addPage(true, target)},
      {id: "add-page", label: continuous ? "Add slide at end" : "Add blank page after", disabled: disabled || design.pages.length >= 20, onSelect: () => addPage(false, target)},
      {id: "left", label: "Move page left", separator: true, disabled: disabled || continuous || targetIndex === 0, onSelect: () => movePage(targetIndex, targetIndex - 1)},
      {id: "right", label: "Move page right", disabled: disabled || continuous || targetIndex === design.pages.length - 1, onSelect: () => movePage(targetIndex, targetIndex + 1)},
      {id: "export-page", label: "Download page as PNG", separator: true, disabled: Boolean(job) || uploading, onSelect: () => setJob({design: structuredClone(design), pageId: target.id})},
      {id: "delete-page", label: "Delete page", danger: true, separator: true, disabled: disabled || (continuous ? design.pages.length <= 2 || targetIndex !== design.pages.length - 1 : design.pages.length <= 1), onSelect: () => setRemovePageId(target.id)},
    ]});
  }
  function workspaceMenu(event: React.MouseEvent) {
    openMenu(event, {label: design.name || "Design workspace", items: [
      {id: "undo", label: "Undo", shortcut: "⌘/Ctrl Z", disabled: disabled || !historyState.undo, onSelect: () => travel("undo")},
      {id: "redo", label: "Redo", shortcut: "⌘/Ctrl ⇧ Z", disabled: disabled || !historyState.redo, onSelect: () => travel("redo")},
      {id: "paste", label: "Paste elements", shortcut: "⌘/Ctrl V", disabled: disabled || !copied.current.length, onSelect: () => applyCommand((live) => pasteElements(live))},
      {id: "add", label: "Add blank page", separator: true, disabled: disabled || design.pages.length >= 20, onSelect: () => addPage()},
      {id: "template", label: saveTemplateLabel, disabled, onSelect: () => setTemplateName(design.name)},
      {id: "fit", label: "Fit page", separator: true, onSelect: fitPage},
      {id: "clip", label: clipToCanvas ? "Turn off clipping" : "Clip to canvas", onSelect: () => setClipToCanvas((value) => !value)},
      {id: "layers", label: "Show layers", onSelect: () => setTab("layers")},
      {id: "help", label: "Keyboard shortcuts", onSelect: () => setShowShortcuts(true)},
    ]});
  }
  function addElement(element: CanvasElement) {
    const target = current.current.pages.find((item) => item.id === page.id);
    if (!target) return;
    const live = editingMaster?current.current.masterScene??scene:current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target, current.current.format);
    if (live.elements.length >= 100) {
      setNotice("Each page supports up to 100 elements.");
      return;
    }
    if (!changeScene({ ...live, elements: [...live.elements, element] })) return;
    setSelected([element.id]);
  }
  const addText = (size = 28, text = "Add your text") =>
    addElement(
      createCanvasElement("text", {
        text,
        name: text,
        x: (continuous ? index * FRAME_WIDTH : 0) + 32,
        y: canvasHeight / 2 - 40,
        width: 296,
        height: Math.max(60, size * 2.6),
        font: brand.font,
        fontSize: size,
        fontWeight: size >= 24 ? 700 : 400,
        color: brand.text,
        textMode:'auto-height',
      }),
    );
  const addShape = (shape: ShapeElement['shape'], line = false) =>
    addElement(
      createCanvasElement("shape", {
        shape,
        name: line ? "Line" : shape === "ellipse" ? "Circle" : `${shape[0].toUpperCase()}${shape.slice(1)}`,
        x: (continuous ? index * FRAME_WIDTH : 0) + 100,
        y: canvasHeight / 2 - (line ? 1 : 70),
        width: 160,
        height: line ? 3 : shape==='ellipse'?160:140,
        fill: brand.text,
        radius: 0,
      }),
    );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, [contenteditable=true], dialog, [role=menu]",
        ) ||
        disabled
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        travel(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        setSelected(selectable.map(e=>e.id));
        return;
      }
      if (mod && (key === "c" || key === "x") && selected.length) {
        event.preventDefault();
        copyElements(selected, key === "x");
        return;
      }
      if (mod && key === "d" && selected.length) {
        event.preventDefault();
        applyCommand((live) => duplicateSelection(live, selected,undefined,isolatedGroupId??undefined));
        return;
      }
      if(mod&&key==='g'){event.preventDefault();applyCommand(live=>event.shiftKey?ungroupSelection(live,selected,isolatedGroupId??undefined):groupSelection(live,selected,"Group",isolatedGroupId??undefined));return;}
      if(!mod&&key===' '){event.preventDefault();setSpacePanning(true);return;}
      if (mod && key === "v" && copied.current.length) {
        event.preventDefault();
        applyCommand((live) => pasteElements(live));
        return;
      }
      if ((key === "delete" || key === "backspace") && selected.length) {
        event.preventDefault();
        applyCommand((live) => removeSelection(live, selected));
        return;
      }
      if (mod && (key === "]" || key === "[")) {
        event.preventDefault();
        applyCommand((live) => reorderSelection(live, selected, key === "]" ? (event.shiftKey ? "front" : "forward") : (event.shiftKey ? "back" : "backward")));
        return;
      }
      if (key.startsWith("arrow") && selected.length) {
        event.preventDefault();
        const distance = (event.shiftKey ? 10 : 1)/(format.width/FRAME_WIDTH);
        const dx =
          key === "arrowleft" ? -distance : key === "arrowright" ? distance : 0;
        const dy =
          key === "arrowup" ? -distance : key === "arrowdown" ? distance : 0;
        const moved=translateElements(scene.elements.filter(e=>selected.includes(e.id)&&(!isolatedIds||isolatedIds.has(e.id))&&canEditElement(scene,e,'position')),{x:dx,y:dy});const replacements=new Map(moved.map(e=>[e.id,e]));
        changeScene({...scene,elements:scene.elements.map(e=>replacements.get(e.id)??e)},
          "nudge",
        );
        return;
      }
      if (key === "escape") {
        setSelected([]);
        setExportMenu(false);
        setCropImageId(null);setIsolatedGroupId(null);setPathTool(false);setImageDropTargetId(null);paletteDrag.current?.();
        return;
      }
      if (!mod && !event.altKey && key === "t") {
        event.preventDefault();
        addText();
      }
      if (!mod && !event.altKey && key === "r") {
        event.preventDefault();
        addShape("rectangle");
      }
      if (!mod && !event.altKey && key === "o") {
        event.preventDefault();
        addShape("ellipse");
      }
    };
    window.addEventListener("keydown", handler);
    const release=(e:KeyboardEvent)=>{if(e.key===' ')setSpacePanning(false);};const blur=()=>setSpacePanning(false);window.addEventListener('keyup',release);window.addEventListener('blur',blur);
    return () => {window.removeEventListener("keydown", handler);window.removeEventListener('keyup',release);window.removeEventListener('blur',blur);};
  });
  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWorkspaceSize({width: entry.contentRect.width, height: entry.contentRect.height});
      setFit(
        Math.min(
          Math.max(80, entry.contentRect.width - 100) / canvasWidth,
          Math.max(80, entry.contentRect.height - 100) /
            ((FRAME_WIDTH * format.height) / format.width),
          1.55,
        ),
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [format.height, format.width, canvasWidth]);
  useEffect(()=>{const node=workspaceRef.current;if(!node)return;const wheel=(e:WheelEvent)=>{if((!e.ctrlKey&&!e.metaKey)||cropImageId)return;e.preventDefault();const rect=node.getBoundingClientRect();const screenX=e.clientX-rect.left,screenY=e.clientY-rect.top;zoomAnchor.current={x:(node.scrollLeft+screenX)/scale-workspaceLeft,y:(node.scrollTop+screenY)/scale-workspaceTop,screenX,screenY};setZoom(z=>Math.max(.05,Math.min(32,z*Math.exp(-e.deltaY*.005))));};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[cropImageId,scale,workspaceLeft,workspaceTop]);
  useEffect(() => {
    if (!job) return;
    let ignore = false;
    const abort=new AbortController();exportAbort.current=abort;
    const frames = Array.from(
      exportRef.current?.querySelectorAll<HTMLElement>(".te-frame") ?? [],
    );
    exportFrames(frames, job.design.name, job.design.caption, (p) => {
      if (!ignore) setProgress(p);
    },{scale:formatDimensions(job.design).width/FRAME_WIDTH,...job.options,signal:abort.signal})
      .then(() => {
        if (!ignore)
          setNotice(
            `${(job.options?.format??'png').toUpperCase()} downloaded · ${frames.length} page${frames.length===1?'':'s'}.`,
          );
      })
      .catch((reason) => {
        if (!ignore)
          setNotice(
            reason instanceof Error
              ? reason.message
              : "Export failed. Please try again.",
          );
      })
      .finally(() => {
        if (!ignore) {
          setJob(null);
          setProgress(0);
        }
      });
    return () => {
      ignore = true;
      abort.abort();exportAbort.current=null;
    };
  }, [job]);

  function addPage(duplicate = false, source: DesignPage = page) {
    if (disabled || current.current.pages.length >= 20 || (continuous && duplicate)) return;
    if (current.current.continuousCanvas) {
      const next = duplicatePage(current.current.pages.at(-1)!);
      next.canvas = {background: scene.background, elements: []};
      if (commit((d) => ({...d, pages: [...d.pages, next]}))) { setSelected([]); fitPage(); }
      return;
    }
    const liveSource = current.current.pages.find((p) => p.id === source.id);
    if (!liveSource) return;
    const sourceIndex = current.current.pages.indexOf(liveSource);
    const next = duplicatePage(liveSource);
    if (!duplicate)
      next.canvas = { background: source.canvas?.background ?? scene.background, elements: [] };
    const accepted = commit((d) => ({
      ...d,
      pages: [
        ...d.pages.slice(0, sourceIndex + 1),
        next,
        ...d.pages.slice(sourceIndex + 1),
      ],
    }));
    if (!accepted) return;
    setPageId(next.id);
    setSelected([]);
  }
  function movePage(from: number, to: number) {
    if (continuous || from === to || from < 0 || to < 0 || to >= design.pages.length) return;
    commit((d) => {
      const pages = [...d.pages];
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      return { ...d, pages };
    });
  }
  function beginPaletteDrag(event:import('react').PointerEvent<HTMLButtonElement>,photo:ShapeImageFill) {
    if(disabled||event.button!==0)return;
    event.preventDefault();
    const node=event.currentTarget, pointer=event.pointerId, start={x:event.clientX,y:event.clientY};
    let moved=false;
    node.setPointerCapture(pointer);
    const clean=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',clean);if(node.hasPointerCapture(pointer))node.releasePointerCapture(pointer);setPhotoGhost(null);setImageDropTargetId(null);paletteDrag.current=null;};
    const move=(e:PointerEvent)=>{if(Math.hypot(e.clientX-start.x,e.clientY-start.y)<6&&!moved)return;moved=true;e.preventDefault();setPhotoGhost({src:photo.src,x:e.clientX,y:e.clientY});setImageDropTargetId(frameUnderPointer(e.clientX,e.clientY)?.id??null);};
    const end=(e:PointerEvent)=>{if(moved){e.preventDefault();suppressPaletteClick.current=true;setTimeout(()=>{suppressPaletteClick.current=false;},0);const box=workspaceRef.current?.getBoundingClientRect();if(box&&e.clientX>=box.left&&e.clientX<=box.right&&e.clientY>=box.top&&e.clientY<=box.bottom)dropPhoto(photo,frameUnderPointer(e.clientX,e.clientY)?.id);}clean();};
    paletteDrag.current=clean;
    node.addEventListener('pointermove',move,{passive:false});node.addEventListener('pointerup',end);node.addEventListener('pointercancel',clean);
  }
  function frameUnderPointer(clientX:number,clientY:number) {
    const paper=workspaceRef.current?.querySelector<HTMLElement>('.te-canvas-editor');
    const bounds=paper?.getBoundingClientRect();
    if(!bounds)return null;
    return findPhotoFrameAtPoint(scene,{x:(clientX-bounds.left)/scale,y:(clientY-bounds.top)/scale},{isolationGroupId:isolatedGroupId});
  }
  function dropPhoto(photo:ShapeImageFill,shapeId?:string) {
    if(disabled)return;
    if(shapeId){if(applyCommandChecked(live=>fillShapeWithImage(live,shapeId,photo)))setNotice('Photo filled the frame. Double-click to adjust its crop.');return;}
    const ratio=photo.intrinsicWidth&&photo.intrinsicHeight?photo.intrinsicHeight/photo.intrinsicWidth:1;
    const width=280,height=Math.min(canvasHeight*.7,width*ratio);
    addElement(createCanvasElement('image',{...photo,fit:photo.objectFit,name:photo.alt||'Photo',x:(continuous?index*FRAME_WIDTH:0)+(FRAME_WIDTH-width)/2,y:(canvasHeight-height)/2,width,height}));
  }
  async function uploadTextTexture(file:File) {
    if(disabled||uploading)return;
    const ids=selected.filter(id=>{const e=scene.elements.find(item=>item.id===id);return e?.type==='text'&&canEditElement(scene,e,'content')&&canEditElement(scene,e,'style')&&!isElementHidden(scene,e);});
    if(!ids.length){setNotice('Select editable text before adding a texture.');return;}
    const context=editorTarget.current, original=current.current;
    const rangeTarget=textFormatter.current?.capture()??null;
    const wasEditing=Boolean(textFormatter.current);
    setUploading(true);
    try {
      const asset=await prepareBrandAsset(file,'image');
      if(!mounted.current)return;
      if(editorTarget.current!==context||current.current!==original||Boolean(textFormatter.current)!==wasEditing)throw new Error('The editing target changed. Select the text and upload again.');
      const texture:ShapeImageFill={src:asset.src,alt:asset.name,objectFit:'cover',cropX:50,cropY:50,cropScale:1,intrinsicWidth:asset.width,intrinsicHeight:asset.height};
      const ranged=rangeTarget?textFormatter.current?.({textureFill:texture},rangeTarget)??false:false;
      if(rangeTarget&&!ranged)throw new Error('The word selection changed. Select the words and upload again.');
      if(ranged)setNotice('Texture applied to the selected words.');
      else if(applyCommandChecked(live=>applyTextTexture(live,ids,texture)))setNotice('Texture applied to the selected text.');
    } catch(error){setNotice(error instanceof Error?error.message:'Could not add this texture.');}
    finally{if(mounted.current)setUploading(false);}
  }
  async function upload(file: File, replaceId?: string) {
    if (disabled || uploading) return;
    if(!replaceId&&(file.type==='image/svg+xml'||file.name.toLowerCase().endsWith('.svg'))){
      const targetId=page.id,targetMaster=editingMaster,targetContinuous=Boolean(current.current.continuousCanvas),targetIsolation=isolatedGroupId??undefined;
      setUploading(true);
      try{
        if(file.size>1_000_000)throw new Error('Use an SVG smaller than 1 MB.');
        const imported=importSVG(await file.text(),file.name.replace(/\.svg$/i,''));
        if(!mounted.current)return;
        let inserted:string[]=[];
        const accepted=commit(d=>{
          const target=d.pages.find(p=>p.id===targetId);
          if(!target)throw new Error('The target page was removed. Upload the SVG again.');
          if(Boolean(d.continuousCanvas)!==targetContinuous)throw new Error('The canvas layout changed. Upload the SVG again.');
          const live=targetMaster?d.masterScene??{background:'transparent',elements:[]}:d.continuousCanvas??target.canvas??sceneForPage(target,d.format);
          if(targetIsolation&&!live.groups?.some(group=>group.id===targetIsolation))throw new Error('The target group was removed. Upload the SVG again.');
          if(live.elements.length+imported.elements.length>100)throw new Error('This SVG exceeds the page layer limit.');
          const offset=targetContinuous&&!targetMaster?d.pages.indexOf(target)*FRAME_WIDTH:0;
          const elements=imported.elements.map(e=>({...e,x:e.x+offset+24,y:e.y+24}));inserted=elements.map(e=>e.id);
          const next=constrainSceneToIsolation(live,{...live,groups:[...(live.groups??[]),...(imported.groups??[])],elements:[...live.elements,...elements]},targetIsolation);
          return targetMaster?{...d,masterScene:next}:targetContinuous?{...d,continuousCanvas:next}:{...d,pages:d.pages.map(p=>p.id===targetId?{...p,canvas:next}:p)};
        });
        if(accepted&&activePage.current===targetId)setSelected(inserted);
      }catch(error){setNotice(error instanceof Error?error.message:'Could not import this SVG.');}
      finally{if(mounted.current)setUploading(false);}
      return;
    }
    const targetId = page.id;
    const targetMaster=editingMaster;
    const targetIsolation=isolatedGroupId??undefined;
    const targetContinuous = Boolean(current.current.continuousCanvas);
    setUploading(true);
    let pendingBitmap:ImageBitmap|null=null;
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("Choose a JPG, PNG, or WebP image.");
      if (file.size > 15 * 1024 * 1024)
        throw new Error("Choose an image smaller than 15 MB.");
      const bitmap = await createImageBitmap(file);
      pendingBitmap=bitmap;
      if (!mounted.current) {
        bitmap.close();
        pendingBitmap=null;
        return;
      }
      const ratio = Math.min(1, (targetContinuous ? Math.min(8192, 1080 * current.current.pages.length) : 1800) / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        pendingBitmap=null;
        throw new Error("Image processing is unavailable.");
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      pendingBitmap=null;
      const src = canvas.toDataURL("image/webp", 0.88);
      if (src.length > 2_000_000)
        throw new Error(
          "This image is too large after processing. Use a smaller image.",
        );
      const targetPage = current.current.pages.find((p) => p.id === targetId);
      if (!targetPage)
        throw new Error(
          "The page was removed. Choose a page and upload again.",
        );
      if (targetContinuous !== Boolean(current.current.continuousCanvas)) throw new Error("The canvas layout changed. Please upload the image again.");
      const targetScene =
        targetMaster?current.current.masterScene??{background:'transparent',elements:[]}:current.current.continuousCanvas ?? targetPage.canvas ?? sceneForPage(targetPage, current.current.format);
      if (
        replaceId &&
        !targetScene.elements.some(
          (e) => e.id === replaceId && (e.type === "image"||e.type === "shape") && canEditElement(targetScene,e,'content') && scopeSelection(targetScene,[e.id],targetIsolation).length>0,
        )
      )
        throw new Error(
          "The image or frame was removed or locked. Select it and try again.",
        );
      if (!replaceId && targetScene.elements.length >= 100)
        throw new Error("Each page supports up to 100 elements.");
      const w = Math.max(1, Math.min(280, canvas.width / 3)),
        h = Math.max(
          1,
          Math.min(canvasHeight * 0.7, (w * canvas.height) / canvas.width),
        );
      const image = createCanvasElement("image", {
        src,
        name: file.name.slice(0, 100),
        x: (targetContinuous ? current.current.pages.indexOf(targetPage) * FRAME_WIDTH : 0) + (FRAME_WIDTH - w) / 2,
        y: (canvasHeight - h) / 2,
        width: w,
        height: h,
        intrinsicWidth:canvas.width,
        intrinsicHeight:canvas.height,
      });
      const accepted = commit((d) => {
        const update = (live: CanvasScene): CanvasScene => {
          if(targetIsolation&&!live.groups?.some(group=>group.id===targetIsolation))throw new Error('The target group was removed. Upload the image again.');
          const frame=replaceId?live.elements.find(element=>element.id===replaceId&&element.type==='shape'):undefined;
          if(frame)return fillShapeWithImage(live,frame.id,{src,alt:file.name.slice(0,200),objectFit:'cover',cropX:50,cropY:50,cropScale:1,intrinsicWidth:canvas.width,intrinsicHeight:canvas.height}).scene;
          return constrainSceneToIsolation(live,{...live, elements: replaceId
          ? live.elements.map((element) => element.id === replaceId && element.type === "image" ? {...element, src, intrinsicWidth:canvas.width,intrinsicHeight:canvas.height,name: file.name.slice(0, 100)} : element)
          : [...live.elements, image]},targetIsolation);
        };
        return targetMaster?{...d,masterScene:update(d.masterScene??{background:'transparent',elements:[]})}:d.continuousCanvas ? {...d, continuousCanvas: update(d.continuousCanvas)} : {
          ...d, pages: d.pages.map((p) => p.id === targetId ? {...p, canvas: update(p.canvas ?? sceneForPage(p, d.format))} : p),
        };
      });
      if (!accepted) return;
      if (activePage.current === targetId) setSelected([replaceId ?? image.id]);
      setNotice(
        replaceId
          ? "Image replaced."
          : "Image added. Drag its handles to resize it.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Could not open this image.",
      );
    } finally {
      pendingBitmap?.close();
      if (mounted.current) setUploading(false);
    }
  }
  function applyBrand(all = true) {
    const update = (content: CanvasScene): CanvasScene => ({...content,background: brand.background, elements: content.elements.map((element) => element.type === "text" && canEditElement(content,element,'style') ? {...element, font: brand.font, color: brand.text,textStyleId:undefined,colorRoleId:undefined} : element)});
    if (isolatedGroupId) {
      if (changeScene(update(scene))) setNotice(`Applied ${brand.name || "your brand"} inside this group.`);
      return;
    }
    const accepted = commit((d) => editingMaster?{...d,masterScene:{...update(d.masterScene??scene),background:'transparent'}}:d.continuousCanvas ? {...d, continuousCanvas: update(d.continuousCanvas),...(all&&d.masterScene?{masterScene:{...update(d.masterScene),background:'transparent'}}:{})} : ({
      ...d, pages: d.pages.map((p) => !all && p.id !== page.id ? p : {...p, canvas: update(p.canvas ?? sceneForPage(p, d.format))}),
      ...(all&&d.masterScene?{masterScene:{...update(d.masterScene),background:'transparent'}}:{}),
    }));
    if (accepted) setNotice(`Applied ${brand.name || "your brand"} to ${continuous ? "the carousel" : all ? "all pages" : "this page"}.`);
  }
  function changeLayout(next: string) {
    try {
      const converted = next === "continuous" ? enableContinuousCarousel(current.current) : splitContinuousCarousel(current.current);
      if (!commit(() => converted)) return;
      setSelected([]);
      setPageId(converted.pages[0].id);
      fitPage();
      setNotice(next === "continuous" ? "One continuous canvas. Images and text can span slides; exports remain separate PNGs." : "Separate slides restored. Each slide can now be edited independently.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not change layout."); }
  }
  function fillImageAcrossSlides() {
    if (!selectedImage || !canEditElement(scene,selectedImage,'position') || disabled || !continuous) return;
    const first = Math.min(spanFrom, design.pages.length);
    const last = Math.max(first, Math.min(spanThrough, design.pages.length));
    changeScene({...scene, elements: scene.elements.map((element) => element.id === selectedImage.id && element.type === "image" ? {...element, x: (first - 1) * FRAME_WIDTH, y: 0, width: (last - first + 1) * FRAME_WIDTH, height: canvasHeight, rotation: 0, fit: "cover", radius: 0} : element)});
  }
  function openExportSettings(){
    setPreflightIssues(preflightDesign(design,{measureText:(element,id)=>{if(id!==page.id)return undefined;const node=workspaceRef.current?.querySelector<HTMLElement>(`[data-element-id="${element.id}"] .te-canvas-text`);return node?{width:node.scrollWidth,height:node.scrollHeight}:undefined;},imageAvailable:(src,element)=>{const node=Array.from(workspaceRef.current?.querySelectorAll<HTMLImageElement>(`[data-element-id="${element.id}"] img`)??[]).find(image=>image.getAttribute('src')===proxied(src));return node?.complete?node.naturalWidth>0:undefined;},measureTexture:(element,id,pageId)=>{if(pageId!==page.id)return undefined;const parent=workspaceRef.current?.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`);const node=id==='whole'?parent?.querySelector<HTMLElement>('.te-canvas-text'):parent?.querySelector<HTMLElement>(`[data-texture-id="${id}"]`);const box=node?.getBoundingClientRect();return box?{width:box.width/scale,height:box.height/scale}:undefined;}}));
    setExportDialog(true);
  }
  const inspector = (
    <ElementInspector
      scene={scene}
      selectedIds={selected}
      onSelect={setSelected}
      onChange={changeScene}
      width={canvasWidth}
      height={canvasHeight}
      disabled={disabled}
      slideBounds={{x:continuous?index*FRAME_WIDTH:0,y:0,width:FRAME_WIDTH,height:canvasHeight}}
      textStyles={design.styles}
      outputScale={format.width/FRAME_WIDTH}
      onSaveTextStyle={style=>commit(d=>{const next=updateTextStyle(d,style);const content=editingMaster?next.masterScene??scene:next.continuousCanvas??next.pages.find(p=>p.id===page.id)?.canvas??scene;const applied=applyTextStyle(content,selected,style).scene;return editingMaster?{...next,masterScene:applied}:next.continuousCanvas?{...next,continuousCanvas:applied}:{...next,pages:next.pages.map(p=>p.id===page.id?{...p,canvas:applied}:p)};})}
      onDeleteTextStyle={id=>commit(d=>({...d,styles:d.styles?.filter(s=>s.id!==id)}))}
      colorRoles={design.colorRoles}
      onSaveColorRole={role=>commit(d=>updateColorRole(d,role))}
      onDeleteColorRole={id=>commit(d=>removeColorRole(d,id))}
      onFormatText={formatText}
      onUploadTextTexture={uploadTextTexture}
      onUploadFramePhoto={(file:File,id:string)=>upload(file,id)}
    />
  );

  return (
    <div className="te-editor te-wysiwyg" onContextMenu={workspaceMenu} onDragEnd={()=>setImageDropTargetId(null)}>
                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml,.svg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(file);
                  }}
                />
      {photoGhost&&<div className="te-photo-drag-ghost" style={{left:photoGhost.x+12,top:photoGhost.y+12}} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proxied(photoGhost.src)} alt=""/>
      </div>}
      <header className="te-editor-header">
        <button
          className="te-icon"
          onClick={onExit}
          aria-label={
            isTemplateDraft ? "Back to my templates" : "Back to your designs"
          }
          title={
            isTemplateDraft ? "Back to my templates" : "Back to your designs"
          }
          disabled={Boolean(job)}
        >
          <ArrowLeftIcon size={20} />
        </button>
        <span className="te-editor-divider" />
        <div className="te-document-title">
          <input
            aria-label={isTemplateDraft ? "Template name" : "Design name"}
            value={design.name}
            maxLength={100}
            disabled={disabled}
            onChange={(e) =>
              commit((d) => ({ ...d, name: e.target.value }), "name")
            }
            onBlur={() => {
              if (!design.name.trim())
                commit((d) => ({
                  ...d,
                  name: isTemplateDraft
                    ? "Untitled template"
                    : "Untitled design",
                }));
            }}
          />
          <span role="status">
            {isTemplateDraft ? "Template draft · " : ""}
            {saveStatus}
          </span>
        </div>
        <div className="te-history">
          <button
            className="te-icon"
            disabled={disabled || !historyState.undo}
            onClick={() => travel("undo")}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            className="te-icon"
            disabled={disabled || !historyState.redo}
            onClick={() => travel("redo")}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
          >
            ↷
          </button>
        </div>
        <div className="te-editor-header-actions">
          <button className="te-button" disabled={disabled} onClick={()=>setWorkflowOpen(true)}>Design tools</button>
          <button
            className={`te-button te-save-template ${isTemplateDraft ? "te-primary te-draft-save" : ""}`}
            disabled={disabled}
            onClick={() => setTemplateName(design.name)}
          >
            <LayoutIcon />
            {saveTemplateLabel}
          </button>
          <div className="te-export-anchor">
            <button
              className={`te-button ${isTemplateDraft ? "" : "te-primary"}`}
              disabled={Boolean(job) || uploading}
              onClick={() => setExportMenu((v) => !v)}
            >
              <DownloadIcon />
              {job ? `Exporting ${progress}%` : "Export"}
            </button>
            {exportMenu && (
              <>
                <button
                  className="te-menu-dismiss"
                  aria-label="Close export menu"
                  onClick={() => setExportMenu(false)}
                />
                <div className="te-export-menu">
                  <span className="te-eyebrow">
                    {format.width} × {format.height} PX
                  </span>
                  <button onClick={()=>{setExportMenu(false);openExportSettings();}}>Export settings <span>PNG · JPG · PDF</span></button>
                  <button
                    onClick={() => {
                      setExportMenu(false);
                      setJob({
                        design: structuredClone(design),
                        pageId: page.id,
                      });
                    }}
                  >
                    Current page <span>PNG</span>
                  </button>
                  <button
                    onClick={() => {
                      setExportMenu(false);
                      setJob({ design: structuredClone(design) });
                    }}
                  >
                    All {design.pages.length} pages{" "}
                    <span>{design.pages.length > 1 ? "ZIP" : "PNG"}</span>
                  </button>
                  <button
                    onClick={() => {
                      saveBlob(
                        new Blob([design.caption], { type: "text/plain" }),
                        `${fileName(design.name)}-caption.txt`,
                      );
                      setExportMenu(false);
                    }}
                    disabled={!design.caption.trim()}
                  >
                    Caption <span>TXT</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      {notice && (
        <div className="te-notice te-editor-notice" role="status">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      <div className="te-editor-body">
        <aside className="te-editor-sidebar">
          <nav className="te-tool-tabs" aria-label="Editor tools">
            {(
              [
                ["templates", LayoutIcon, "Design"],
                ["text", TextIcon, "Text"],
                ["elements", PlusIcon, "Elements"],
                ["media", ImageIcon, "Uploads"],
                ["brand", StarIcon, "Brand"],
                ["layers", CopyIcon, "Layers"],
                ["caption", TextIcon, "Caption"],
                ["style", StarIcon, "Properties"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                className={tab === id ? "is-active" : ""}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <fieldset disabled={disabled} className="te-panel-scroll">
            {tab === "text" && (
              <>
                <div className="te-panel-heading">
                  <h2>Add text</h2>
                  <span>T</span>
                </div>
                <button
                  className="te-add-text te-add-heading"
                  onClick={() => addText(30, "Add a heading")}
                >
                  Add a heading
                </button>
                <button
                  className="te-add-text te-add-subheading"
                  onClick={() => addText(20, "Add a subheading")}
                >
                  Add a subheading
                </button>
                <button
                  className="te-add-text"
                  onClick={() => addText(13, "Add your body text")}
                >
                  Add body text
                </button>
                <p className="te-help">
                  Double-click any text on the canvas to type. Select it to
                  change its font, alignment, case, color, and spacing.
                </p>
                <div className="te-panel-heading">
                  <h2>Your brand</h2>
                </div>
                <button className="te-button te-full" onClick={() => applyBrand()}>
                  <StarIcon /> {continuous ? "Apply brand to carousel" : "Apply brand to all pages"}
                </button>
              </>
            )}
            {tab === "elements" && (
              <>
                <div className="te-panel-heading">
                  <h2>Shapes & lines</h2>
                </div>
                <div className="te-shape-picker">
                  <button onClick={() => addShape("rectangle")}>
                    <span className="te-shape-rect" />
                    Rectangle
                  </button>
                  <button onClick={() => addShape("ellipse")}>
                    <span className="te-shape-circle" />
                    Circle
                  </button>
                  <button onClick={() => addShape("rectangle", true)}>
                    <span className="te-shape-line" />
                    Line
                  </button>
                </div>
                <p className="te-help">
                  Drag, resize, and rotate shapes on the canvas. Use Properties
                  for fill, borders, and rounded corners.
                </p>
                <div className="te-shape-picker">{(['triangle','diamond','polygon','star','arrow'] as const).map(shape=><button key={shape} onClick={()=>addShape(shape)}>{shape[0].toUpperCase()+shape.slice(1)}</button>)}<button aria-pressed={pathTool} onClick={()=>setPathTool(p=>!p)}>Pen / path</button></div>
                <div className="te-pro-actions">{(['union','intersect','subtract','xor'] as const).map(operation=><button key={operation} className="te-text-button" disabled={selected.length<2||scene.elements.filter(e=>selected.includes(e.id)).some(e=>e.type!=='shape')} onClick={()=>applyCommand(live=>combineShapes(live,selected,operation))}>{operation==='xor'?'Exclude overlap':operation[0].toUpperCase()+operation.slice(1)}</button>)}</div>
                <button className="te-button te-full" onClick={()=>fileRef.current?.click()}>Import editable SVG</button>
                <div className="te-panel-heading">
                  <h2>Page background</h2>
                </div>
                <ColorField
                  label="Background color"
                  value={scene.background}
                  onChange={(background) =>
                    changeScene({ ...scene, background }, "background")
                  }
                />
                <div className="te-swatches">
                  {[
                    "#ffffff",
                    "#f3efe6",
                    "#dce5d8",
                    "#263e35",
                    "#0c0c0c",
                    "#a78bfa",
                    "#ff7547",
                    "#2767ff",
                  ].map((color) => (
                    <button
                      key={color}
                      aria-label={`Background ${color}`}
                      style={{ background: color }}
                      onClick={() =>
                        changeScene({ ...scene, background: color })
                      }
                    />
                  ))}
                </div>
              </>
            )}
            {tab === "templates" && (
              <>
                <div className="te-panel-heading">
                  <h2>Page templates</h2>
                </div>
                <p className="te-help">
                  {continuous ? "Add a template's first slide to the selected part of your panorama. Undo restores it." : "Apply a template to this page, then edit every element. Undo restores the previous page."}
                </p>
                <div className="te-canvas-templates">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setApplyingTemplateId(t.id)}
                    >
                      <DesignPreview
                        design={{ ...design, format: t.format, customSize:t.customSize,masterScene:t.masterScene,pages: t.pages, continuousCanvas: t.continuousCanvas }}
                        page={t.pages[0]}
                      />
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === "media" && (
              <>
                <div className="te-panel-heading">
                  <h2>Images</h2>
                </div>
                <button
                  className="te-upload"
                  disabled={uploading || scene.elements.length >= 100}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon size={26} />
                  <strong>
                    {uploading ? "Preparing image…" : "Upload an image"}
                  </strong>
                  <span>JPG, PNG or WebP · up to 15 MB</span>
                </button>
                {selected.length === 1 &&
                  scene.elements.some(e=>e.id===selected[0]&&(e.type==='image'||e.type==='shape')) && (
                    <label className="te-button te-full te-replace-image">
                      Upload into selected image or frame
                      <input
                        type="file"
                        hidden
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void upload(file, selected[0]);
                        }}
                      />
                    </label>
                  )}
                <p className="te-help">
                  Drag a photo onto any shape to fill it. Drop on empty workspace to add an image. Double-click a filled frame to adjust its crop.
                </p>
                <div className="te-panel-heading">
                  <h2>Studio artwork</h2>
                </div>
                <div className="te-artwork-grid">
                  {[
                    "forest",
                    "dunes",
                    "coral",
                    "folds",
                    "orbits",
                    "sculpture",
                  ].map((name) => (
                    <button
                      key={name}
                      aria-label={`Add ${name} artwork`}
                      draggable={!disabled}
                      onPointerDown={event=>beginPaletteDrag(event,{src:`/template-editor/${name}.svg`,alt:`${name} artwork`,objectFit:'cover',cropX:50,cropY:50})}
                      onDragStart={event=>{if(paletteDrag.current)event.preventDefault();else writePhotoDrag(event.dataTransfer,{src:`/template-editor/${name}.svg`,alt:`${name} artwork`,objectFit:'cover',cropX:50,cropY:50});}}
                      onDragEnd={()=>setImageDropTargetId(null)}
                      onClick={() => {
                        if(suppressPaletteClick.current)return;
                        addElement(
                          createCanvasElement("image", {
                            name: `${name} artwork`,
                            src: `/template-editor/${name}.svg`,
                            x: (continuous ? index * FRAME_WIDTH : 0) + 40,
                            y: canvasHeight / 2 - 140,
                            width: 280,
                            height: 280,
                          }),
                        );
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/template-editor/${name}.svg`} alt={name} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === "brand" && <BrandPanel continuous={continuous} kits={brandKits} activeId={activeBrandKitId} scene={scene} selectedIds={selected} disabled={disabled}
              onSelectKit={onSelectBrandKit} onSaveAsset={onSaveBrandAsset} onChange={(recipe) => {
                const target = current.current.pages.find((item) => item.id === page.id);
                if (target) {
                  const live = editingMaster ? current.current.masterScene ?? scene : current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target, current.current.format);
                  const next = recipe(live);
                  if (next !== live) changeScene(next);
                }
              }} onApply={applyBrand} onManage={onManageBrand}
              onPhotoPointerDown={beginPaletteDrag}
              onInsert={(asset) => {
                if(suppressPaletteClick.current)return;
                const ratio = Math.min(280 / asset.width, (canvasHeight * .65) / asset.height);
                const width = Math.max(1, asset.width * ratio);
                const height = Math.max(1, asset.height * ratio);
                addElement(createCanvasElement("image", {name:asset.name, src:asset.src, fit:"contain", x:(continuous ? index * FRAME_WIDTH : 0)+(FRAME_WIDTH-width)/2, y:(canvasHeight-height)/2, width,height}));
              }} />}
            {tab === "layers" && <LayersPanel scene={scene} selectedIds={selected} width={canvasWidth} height={canvasHeight} disabled={disabled}
              isolatedGroupId={isolatedGroupId??undefined} onEnterGroup={enterGroup} onExitGroup={()=>setIsolatedGroupId(null)}
              onGroupContextMenu={(event,id)=>openMenu(event,{label:scene.groups?.find(g=>g.id===id)?.name??'Group',items:[{id:'isolate',label:'Edit group',onSelect:()=>enterGroup(id)},{id:'group-lock',label:'Toggle lock',disabled:Boolean(isolatedGroupId)&&!groupMemberIds(scene,id).some(member=>isolatedIds?.has(member)),onSelect:()=>applyCommand(live=>setGroupLocked(live,id,!live.groups?.find(g=>g.id===id)?.locked))},{id:'group-hidden',label:'Toggle visibility',disabled:Boolean(isolatedGroupId)&&!groupMemberIds(scene,id).some(member=>isolatedIds?.has(member)),onSelect:()=>applyCommand(live=>setGroupHidden(live,id,!live.groups?.find(g=>g.id===id)?.hidden))}]})}
              onSelect={selectLayers} onChange={changeScene} onLocate={locateLayer}
              onContextMenu={(event, element) => canvasMenu(event, element.id)}
              onDuplicate={() => applyCommand((live) => duplicateSelection(live, selected,undefined,isolatedGroupId??undefined))}
              onDelete={() => applyCommand((live) => removeSelection(live, selected))} />}
            {tab === "caption" && (
              <>
                <div className="te-panel-heading">
                  <h2>Post caption</h2>
                </div>
                <label className="te-field">
                  Caption
                  <textarea
                    rows={10}
                    maxLength={2200}
                    placeholder="Write a caption for your post…"
                    value={design.caption}
                    onChange={(e) =>
                      commit(
                        (d) => ({ ...d, caption: e.target.value }),
                        "caption",
                      )
                    }
                  />
                  <span className="te-field-note">
                    {design.caption.length}/2,200 · Included with carousel
                    export
                  </span>
                </label>
              </>
            )}
            {tab === "style" && inspector}
            <button
              className="te-shortcuts-link"
              onClick={() => setShowShortcuts(true)}
            >
              Keyboard shortcuts <span>⌘</span>
            </button>
          </fieldset>
        </aside>
        <main className="te-canvas-column">
          <QuickToolbar scene={scene} selectedIds={selected} disabled={disabled} onChange={changeScene}
            outputScale={format.width/FRAME_WIDTH}
            onFormatText={formatText}
            onDuplicate={() => applyCommand((live) => duplicateSelection(live, selected,undefined,isolatedGroupId??undefined))}
            onDelete={() => applyCommand((live) => removeSelection(live, selected))}
            onMore={(event) => selected.length ? openMenu(event, {label: "Selected elements", items: elementMenu(selected)}) : canvasMenu(event, null)}
            onAddText={() => addText()} onUpload={() => fileRef.current?.click()} />
          <div className="te-canvas-toolbar">
            <button className="te-clip-toggle" disabled={disabled} onClick={()=>setLayoutOpen(true)}>Rulers & guides</button>
            {selected.length>1&&<button className="te-text-button" disabled={disabled} onClick={()=>applyCommand(live=>groupSelection(live,selected,"Group",isolatedGroupId??undefined))}>Group</button>}
            {selectedImage&&<button className="te-clip-toggle" aria-pressed={cropImageId===selectedImage.id} onClick={()=>setCropImageId(cropImageId===selectedImage.id?null:selectedImage.id)}>{cropImageId===selectedImage.id?'Done crop':'Crop image'}</button>}
            <label>
              Layout
              <select aria-label="Canvas layout" value={continuous ? "continuous" : "separate"} disabled={disabled || uploading} onChange={(event) => changeLayout(event.target.value)}>
                <option value="separate">Separate slides</option>
                <option value="continuous">Continuous carousel</option>
              </select>
            </label>
            <label>
              Resize
              <select
                aria-label="Design format"
                disabled={disabled}
                value={design.format}
                onChange={(e) => {
                  const nextFormat = e.target.value as DesignFormat;
                  commit(d=>({...resizeDesignDocument(d,FORMATS[nextFormat],'contain'),format:nextFormat,customSize:undefined}));
                  setZoom(1);
                }}
              >
                {Object.entries(FORMATS).map(([id, f]) => (
                  <option key={id} value={id}>
                    {f.label} · {f.width} × {f.height}
                  </option>
                ))}
              </select>
            </label>
            <button className="te-clip-toggle" aria-pressed={clipToCanvas} disabled={!page.canvas && !continuous}
              title="Clip overlapping elements to the page. Fully outside elements stay visible in the workspace. Exports always use the page edges."
              onClick={() => setClipToCanvas((value) => !value)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5" /><path d="M9 9h6v6H9z" /></svg>
              Clip to canvas <span>{clipToCanvas ? "On" : "Off"}</span>
            </button>
            {!continuous && <button className="te-clip-toggle te-onion-toggle" aria-pressed={Boolean(onionScene)} disabled={!previousPage || !page.canvas}
              title={!page.canvas ? "Choose Edit individual elements to use onion skin on this older layout" : previousPage ? "Show the previous slide behind this one as a transparent alignment guide. Never included in exports." : "Onion skin is available from slide 2"}
              onClick={() => setOnionSkin((value) => !value)}>
              <CopyIcon size={14} /> Onion skin
            </button>}
            {onionScene && <label className="te-onion-opacity">Guide {Math.round(onionOpacity * 100)}%<input aria-label="Onion skin opacity" type="range" min="5" max="50" step="5" value={onionOpacity * 100} onChange={(event) => setOnionOpacity(Number(event.target.value) / 100)} /></label>}
            <span className="te-selection-hint">
              {selected.length
                ? `${selected.length} selected · Shift-click for more`
                : "Drag to select · Double-click text to edit"}
            </span>
            <button
              className="te-text-button te-properties-trigger"
              onClick={() => setTab("style")}
            >
              Properties
            </button>
          </div>
          {(editingMaster||isolatedGroupId||cropImageId)&&<div className="te-isolation-bar"><span>{editingMaster?'Editing shared master':isolatedGroupId?`Inside ${scene.groups?.find(g=>g.id===isolatedGroupId)?.name??'group'}`:'Drag image to crop · Scroll to zoom image'}</span><button className="te-text-button" onClick={()=>{setEditingMaster(false);setIsolatedGroupId(null);setCropImageId(null);setSelected([]);}}>Done</button></div>}
          {continuous && <div className="te-continuous-tools">
            <span><strong>{design.pages.length} connected slides</strong> · Exported as separate PNGs</span>
            {selectedImage && <div className="te-span-tools">
              <label>From <select aria-label="Image start slide" value={Math.min(spanFrom, design.pages.length)} onChange={(event) => setSpanFrom(Number(event.target.value))}>{design.pages.map((item, i) => <option key={item.id} value={i + 1}>{i + 1}</option>)}</select></label>
              <label>Through <select aria-label="Image end slide" value={Math.max(Math.min(spanFrom, design.pages.length), Math.min(spanThrough, design.pages.length))} onChange={(event) => setSpanThrough(Number(event.target.value))}>{design.pages.map((item, i) => <option key={item.id} value={i + 1} disabled={i + 1 < Math.min(spanFrom, design.pages.length)}>{i + 1}</option>)}</select></label>
              <button className="te-text-button" disabled={disabled || selectedImage.locked} onClick={fillImageAcrossSlides}>Fill slides</button>
            </div>}
          </div>}
          <div
            className={`te-canvas-space${spacePanning?' is-panning':''}`}
            ref={workspaceRef}
            onPointerDownCapture={e=>{if(!spacePanning||e.button!==0)return;e.preventDefault();e.stopPropagation();const node=e.currentTarget;node.setPointerCapture(e.pointerId);panGesture.current={x:e.clientX,y:e.clientY,left:node.scrollLeft,top:node.scrollTop,pointer:e.pointerId};}}
            onPointerMove={e=>{const p=panGesture.current;if(p&&p.pointer===e.pointerId){e.currentTarget.scrollLeft=p.left+p.x-e.clientX;e.currentTarget.scrollTop=p.top+p.y-e.clientY;}}}
            onPointerUp={e=>{if(panGesture.current?.pointer===e.pointerId){panGesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}}
            onPointerCancel={()=>{panGesture.current=null;}}
            onDragOver={e=>{
              if(disabled||!e.dataTransfer.types.some(type=>type==='Files'||type===PHOTO_DRAG_TYPE))return;
              e.preventDefault();e.dataTransfer.dropEffect='copy';
              setImageDropTargetId(frameUnderPointer(e.clientX,e.clientY)?.id??null);
            }}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setImageDropTargetId(null);}}
            onDrop={e=>{
              const shape=frameUnderPointer(e.clientX,e.clientY);
              setImageDropTargetId(null);
              const file=e.dataTransfer.files[0];
              if(file){e.preventDefault();void upload(file,shape?.id);return;}
              const photo=decodePhotoDrag(e.dataTransfer.getData(PHOTO_DRAG_TYPE));
              if(photo){e.preventDefault();dropPhoto(photo,shape?.id);}
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) =>
                f.type.startsWith("image/"),
              );
              if (
                file &&
                !(e.target as HTMLElement).closest("[contenteditable=true]")
              ) {
                e.preventDefault();
                void upload(file);
              }
            }}
          >
            <div className="te-pasteboard" style={{width: pasteboardBounds.width * scale, height: pasteboardBounds.height * scale}}>
            <div
              className="te-canvas-stage te-free-stage"
              style={{
                width: canvasWidth * scale,
                height: canvasHeight * scale,
                left: workspaceLeft * scale,
                top: workspaceTop * scale,
              }}
            >
              <div
                style={{
                  width: canvasWidth,
                  height: canvasHeight,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              >
                {page.canvas || continuous || editingMaster ? (
                  <CanvasEditor
                    key={continuous ? "continuous" : page.id}
                    scene={scene}
                    width={canvasWidth}
                    height={canvasHeight}
                    selectedIds={selected}
                    onSelect={setSelected}
                    onChange={changeScene}
                    onHistory={travel}
                    disabled={disabled}
                    onContextMenu={canvasMenu}
                    editingRequest={editingRequest}
                    clipToCanvas={clipToCanvas}
                    pasteboardBounds={pasteboardBounds}
                    slideWidth={continuous ? FRAME_WIDTH : undefined}
                    onionScene={onionScene}
                    onionOpacity={onionOpacity}
                    viewScale={scale}
                    outputScale={format.width/FRAME_WIDTH}
                    isolatedGroupId={isolatedGroupId}
                    onEnterGroup={enterGroup}
                    onRegisterTextFormatter={registerFormatter}
                    cropImageId={cropImageId}
                    imageDropTargetId={imageDropTargetId??undefined}
                    masterScene={!editingMaster?design.masterScene:undefined}
                    masterPageVisibility={continuous?design.pages.map(p=>p.useMaster!==false):[page.useMaster!==false]}
                    drawingMode={pathTool?'pen':undefined}
                    onDrawPath={element=>{addElement(element);setPathTool(false);}}
                  />
                ) : (
                  <div className="te-legacy-canvas">
                    <DesignFrame design={design} page={page} />
                    <button
                      className="te-button te-primary"
                      disabled={disabled}
                      onClick={() => changeScene(scene)}
                    >
                      Edit individual elements
                    </button>
                    <span>
                      Convert this older layout to editable layers. Undo
                      restores it.
                    </span>
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
          <div className="te-canvas-bottom">
            <span>
              {continuous ? `${design.pages.length}-slide panorama` : `Page ${index + 1}`} · {scene.elements.length} layers
              {outsideCount > 0 && <button className="te-text-button te-parked-count" onClick={() => setTab("layers")}>{outsideCount} off canvas</button>}
            </span>
            <div>
              <button
                className="te-icon"
                aria-label="Zoom out"
                disabled={zoom <= 0.05}
                onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}
              >
                −
              </button>
              <button
                className="te-text-button"
                onClick={fitPage}
                title="Fit page and return to canvas"
                aria-label="Fit page and return to canvas"
              >
                Fit
              </button>
              <label><input className="te-zoom-input" aria-label="Zoom percentage" type="number" min="1" max="3200" defaultValue={Math.round(fit*zoom*100)} key={`${fit}-${zoom}`} onBlur={e=>{const value=Number(e.target.value);if(Number.isFinite(value)&&value>0)setZoom(Math.max(.05,Math.min(32,value/100/fit)));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>%</label>
              <button className="te-text-button" disabled={!selected.length} onClick={()=>{const bounds=sceneVisualBounds({background:'transparent',elements:scene.elements.filter(e=>selected.includes(e.id))});const node=workspaceRef.current;if(bounds&&node){setZoom(Math.max(.05,Math.min(32,Math.min(node.clientWidth/(bounds.width+80),node.clientHeight/(bounds.height+80))/fit)));zoomAnchor.current={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,screenX:node.clientWidth/2,screenY:node.clientHeight/2};}}}>Selection</button>
              <button
                className="te-icon"
                aria-label="Zoom in"
                disabled={zoom >= 32}
                onClick={() => setZoom((z) => Math.min(32, z * 1.25))}
              >
                +
              </button>
            </div>
          </div>
          <section className="te-pages" aria-label="Carousel pages">
            <div className="te-pages-heading">
              <span>
                PAGES <small>{design.pages.length}/20</small>
              </span>
              <div>
                <button
                  className="te-icon"
                  title="Move page left"
                  aria-label="Move page left"
                  disabled={disabled || continuous || index === 0}
                  onClick={() => movePage(index, index - 1)}
                >
                  <ArrowLeftIcon />
                </button>
                <button
                  className="te-icon"
                  title="Move page right"
                  aria-label="Move page right"
                  disabled={disabled || continuous || index === design.pages.length - 1}
                  onClick={() => movePage(index, index + 1)}
                >
                  <ArrowRightIcon />
                </button>
                <button
                  className="te-icon"
                  title="Duplicate page"
                  aria-label="Duplicate page"
                  disabled={disabled || continuous || design.pages.length >= 20}
                  onClick={() => addPage(true)}
                >
                  <CopyIcon />
                </button>
                <button
                  className="te-icon"
                  title={continuous ? "Remove last slide (minimum 2)" : "Delete page"}
                  aria-label={continuous ? "Remove last slide" : "Delete page"}
                  disabled={disabled || design.pages.length <= (continuous ? 2 : 1)}
                  onClick={() => setRemovePageId(continuous ? design.pages.at(-1)!.id : page.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
            <div className="te-page-strip">
              {design.pages.map((p, i) => (
                <div key={p.id} className="te-page-card" onContextMenu={(event) => pageMenu(event, p)}>
                <button
                  draggable={!disabled && !continuous}
                  onDragStart={() => setDragged(p.id)}
                  onDragEnd={() => setDragged(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragged)
                      movePage(
                        design.pages.findIndex((item) => item.id === dragged),
                        i,
                      );
                    setDragged(null);
                  }}
                  key={p.id}
                  className={`te-page-thumb ${p.id === page.id ? "is-active" : ""}`}
                  onClick={() => {
                    setPageId(p.id);
                    setSelected([]);
                  }}
                  aria-label={`Page ${i + 1}`}
                  aria-pressed={p.id === page.id}
                >
                  <DesignPreview design={design} page={p} />
                  <span>{i + 1}</span>
                </button>
                <button className="te-page-more" aria-label={`Page ${i + 1} actions`} aria-haspopup="menu" onClick={(event) => pageMenu(event, p)}>•••</button>
                </div>
              ))}
              <button
                className="te-add-page"
                disabled={disabled || design.pages.length >= 20}
                onClick={() => addPage()}
              >
                <PlusIcon size={22} />
                <span>{continuous ? "Add slide" : "Add page"}</span>
              </button>
            </div>
          </section>
        </main>
        <aside className="te-inspector">
          <fieldset disabled={disabled}>{inspector}</fieldset>
        </aside>
      </div>
      {layoutOpen&&<LayoutPanel scene={scene} width={canvasWidth} slideWidth={FRAME_WIDTH} height={canvasHeight} outputScale={format.width/FRAME_WIDTH} disabled={disabled} onChange={changeScene} onClose={()=>setLayoutOpen(false)}/>}
      {applyingTemplate&&<TemplateApplyDialog template={applyingTemplate} design={design} scene={scene} pageId={page.id} disabled={disabled} onChangeDesign={next=>{
        if(!currentTemplates.current.some(template=>template.id===applyingTemplate.id&&!template.deletedAt))throw new Error("This template was deleted. Restore it from Trash before applying it.");
        return commit(live=>applyDesignPatch(design,next,live));
      }} onChangeScene={changeScene} onClose={()=>setApplyingTemplateId(null)}/>}
      {workflowOpen&&<WorkflowPanel design={design} scene={scene} selected={selected} pageId={page.id} disabled={disabled} onChange={next=>commit(live=>applyDesignPatch(design,next,live))} onSceneChange={changeScene} onSelect={setSelected} onAddDesigns={onAddDesigns} canShare={saveStatus.startsWith("Saved")} onMakeMaster={()=>{const promotable=selected.filter(id=>{const element=scene.elements.find(e=>e.id===id);return element&&canEditElement(scene,element,'position')&&canEditElement(scene,element,'delete');});if(!promotable.length)return;if(changeScene({...scene,elements:scene.elements.map(e=>promotable.includes(e.id)?{...e,master:true}:e)})){setSelected([]);setIsolatedGroupId(null);setWorkflowOpen(false);setEditingMaster(true);}}} onEditMaster={()=>{setEditingMaster(true);setIsolatedGroupId(null);setSelected([]);setWorkflowOpen(false);}} onClose={()=>setWorkflowOpen(false)}/>}
      {exportDialog&&<ExportDialog design={design} pageId={page.id} disabled={disabled} issues={preflightIssues} onClose={()=>setExportDialog(false)} onExport={(options,pageIds)=>{setExportDialog(false);setJob({design:structuredClone(design),options,pageIds});}}/>}
      {job&&<button className="te-button te-export-cancel" onClick={()=>exportAbort.current?.abort()}>Cancel export · {progress}%</button>}
      {renameLayer && <Modal title="Rename layer" onClose={() => setRenameLayer(null)}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const source = scene.elements.find((element) => element.id === renameLayer.id);
          if (!source || !selected.includes(source.id) || !canEditElement(scene,source,'content')) return;
          if (changeScene({...scene, elements: scene.elements.map((element) => element.id === renameLayer.id ? {...element, name: renameLayer.name.trim() || element.name} : element)})) setRenameLayer(null);
        }}>
          <label className="te-field">Layer name<input autoFocus required maxLength={100} value={renameLayer.name} onChange={(event) => setRenameLayer({...renameLayer, name: event.target.value})} /></label>
          <div className="te-modal-actions"><button type="button" className="te-button" onClick={() => setRenameLayer(null)}>Cancel</button><button className="te-button te-primary" disabled={disabled}>Save name</button></div>
        </form>
      </Modal>}
      {showShortcuts && (
        <Modal
          title="Keyboard shortcuts"
          onClose={() => setShowShortcuts(false)}
        >
          <div className="te-shortcuts-list">
            {[
              ["T", "Add text"],
              ["R / O", "Rectangle / circle"],
              ["⌘/Ctrl Z", "Undo"],
              ["⌘/Ctrl Shift Z", "Redo"],
              ["⌘/Ctrl D", "Duplicate selected"],
              ["⌘/Ctrl C / X / V", "Copy / cut / paste elements"],
              ["⌘/Ctrl [ / ]", "Send backward / bring forward"],
              ["Shift F10", "Open actions menu"],
              ["Drag empty canvas", "Select multiple elements"],
              ["⌘/Ctrl A", "Select all unlocked elements"],
              ["Arrow keys", "Move selected elements"],
              ["Shift + arrows", "Move in larger steps"],
              ["Delete", "Remove selected elements"],
              ["Shift + click", "Select multiple elements"],
              ["Escape", "Deselect / cancel gesture"],
            ].map(([key, action]) => (
              <div key={key}>
                <span>{action}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {templateName !== null && (
        <Modal
          title={
            design.editingTemplateId
              ? "Update your template"
              : "Save as a reusable template"
          }
          onClose={() => setTemplateName(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (blocked.current) return;
                onSaveTemplate(
                  designAsTemplate(design, templateName.trim() || design.name),
                );
                setTemplateName(null);
                setNotice("Template saved. Find it under My templates.");
              } catch (reason) {
                setNotice(
                  reason instanceof Error
                    ? reason.message
                    : "Could not save template.",
                );
                setTemplateName(null);
              }
            }}
          >
            <p>
              Save this layout, styling, and all {design.pages.length} pages as
              a starting point for future posts.
            </p>
            <label className="te-field">
              Template name
              <input
                autoFocus
                value={templateName}
                maxLength={100}
                required
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </label>
            <div className="te-modal-actions">
              <button
                type="button"
                className="te-button"
                onClick={() => setTemplateName(null)}
              >
                Cancel
              </button>
              <button className="te-button te-primary">
                <CheckIcon />
                {design.editingTemplateId ? "Update template" : "Save template"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removePageId && (
        <Modal
          title={`Delete page ${design.pages.findIndex((p) => p.id === removePageId) + 1}?`}
          onClose={() => setRemovePageId(null)}
        >
          <p>{continuous ? "Remove the final slide boundary. Artwork stays on the workspace, so you can reuse it or add the slide back. A continuous carousel needs at least two slides." : "You can restore this page with Undo."}</p>
          <div className="te-modal-actions">
            <button className="te-button" onClick={() => setRemovePageId(null)}>
              Cancel
            </button>
            <button
              className="te-button te-primary"
              onClick={() => {
                if (continuous && (design.pages.length <= 2 || design.pages.at(-1)?.id !== removePageId)) return;
                if (!commit((d) => ({...d, pages: d.pages.filter((p) => p.id !== removePageId)}))) return;
                if (page.id === removePageId) setPageId(design.pages.find((p) => p.id !== removePageId)!.id);
                setSelected([]);
                setRemovePageId(null);
              }}
            >
              Delete page
            </button>
          </div>
        </Modal>
      )}
      {job && (
        <div
          ref={exportRef}
          className="gf-export-layer te-export-layer"
          aria-hidden
        >
          {job.design.pages
            .filter((p) => (!job.pageId || p.id === job.pageId)&&(!job.pageIds||job.pageIds.includes(p.id)))
            .map((p) => (
              <DesignFrame key={p.id} design={job.design} page={p} />
            ))}
        </div>
      )}
    </div>
  );
}
