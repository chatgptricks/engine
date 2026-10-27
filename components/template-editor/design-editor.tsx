"use client";
import { constrainSmartTemplate } from "@/lib/template-editor/smart-template";
import { supportsSmartTemplate, updateSmartTemplateText } from "@/lib/template-editor/smart-template-editing";
import { SmartLayoutPanel } from "./smart-layout-panel";
import { layoutSmartScene, prepareSmartTextExport } from "@/lib/template-editor/smart-text";
import { resolveEditorCommand, editorCommandHelp } from "@/lib/template-editor/editor-commands";
import { saveSelectionTextStyle } from "@/lib/template-editor/editing-actions";

import {ENGINE_CLIPBOARD_TYPE,encodeElementClipboard,decodeElementClipboard,plainClipboardText} from "@/lib/template-editor/clipboard";
import type {ElementSnapshot} from "@/lib/template-editor/commands";
import {resolveDesignPageId, type NavigationHistoryMode} from "@/lib/template-editor/use-studio-navigation";
import {useDocumentPresence} from "@/lib/template-editor/use-presence";
import {CollaborationBar, type EditorCollaboration} from "./collaboration-bar";
import {sameContent} from "@/lib/template-editor/library-sync";
import {PageAccessibilitySection} from "./page-accessibility";
import {prepareRasterAsset} from "@/lib/template-editor/client-media";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LayoutIcon,
  PlusIcon,
  StarIcon,
  TextIcon,
} from "@/components/engine/icons";
import {
  FORMATS,
  designAsTemplate,
  duplicatePage,
  createCanvasElement,
  createTextBox,
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
  type TextElement,
  type ShapeImageFill,
  duplicateCanvasScene,
  formatDimensions,
} from "@/lib/template-editor/model";
import {pdfGeometry} from "@/lib/template-editor/pdf-options";
import { exportFrames, fileName, saveBlob, type ExportOptions } from "@/lib/template-editor/export";
import { updateColorRole, removeColorRole, resizeDesignDocument } from "@/lib/template-editor/advanced";
import { LayoutPanel } from "./layout-panel";
import { WorkflowPanel } from "./workflow-panel";
import {WorkspaceResourcesPanel} from "./workspace-resources-panel";
import {captureBrandImage,brandAssetPhoto} from "@/lib/template-editor/brand-assets";
import {insertWorkspaceStyle,insertWorkspaceComponent,brandScene} from "@/lib/template-editor/library-workflows";
import type {EditorLibrary,TextStyle,ReusableComponent} from "@/lib/template-editor/model";
import {assertDesignExportBudget} from '@/lib/template-editor/export-renditions';
import {prepareExportDimensions} from '@/lib/template-editor/export-dimensions';

import { ExportDialog } from "./export-dialog";
import { TemplateApplyDialog } from "./template-apply-dialog";
import { TextTextureDialog } from "./text-texture-dialog";
import { getTextWords, applyTextWordTexture } from "@/lib/template-editor/text-word-textures";
import { activeTextTextures } from "@/lib/template-editor/text-textures";
import { importSVG, combineShapes } from "@/lib/template-editor/vector";
import {applyDesignPatch} from "@/lib/template-editor/document-patch";
import {createDocumentHistory,commitHistory,travelHistory,closeHistoryGroup,sameDocumentContent,historyShortcut,type HistoryContext} from "@/lib/template-editor/history";
import { preflightDesign, type PreflightIssue } from "@/lib/template-editor/preflight";
import { ColorField, Modal } from "./controls";
import { CanvasEditor, type CanvasHistoryBridge, type CanvasDrawingControls } from "./canvas";
import type { TextFormattingPatch, TextFormatter } from "@/lib/template-editor/rich-text-editing";
import { findPhotoFrameAtPoint } from "@/lib/template-editor/photo-frames";
import { PHOTO_DRAG_TYPE, decodePhotoDrag, writePhotoDrag } from "@/lib/template-editor/photo-drag";
import { proxied } from "@/lib/engine/util";
import { LayersPanel } from "./layers-panel";
import { enableContinuousCarousel, splitContinuousCarousel } from "@/lib/template-editor/continuous-carousel";
import { elementIntersectsCanvas, elementVisualBounds, sceneVisualBounds } from "@/lib/template-editor/canvas-geometry";
import { BrandPanel } from "./brand-panel";
import { QuickToolbar } from "./quick-toolbar";
import { useContextMenu, type ContextMenuItem } from "./context-menu";
import { copySelection, duplicateSelection, pasteSelection, removeSelection, setSelectionLocked, reorderSelection, alignSelection, groupSelection, ungroupSelection, setGroupHidden, setGroupLocked, expandGroupSelection, scopeSelection, constrainSceneToIsolation, canEditElement, isElementHidden, isElementLocked, fillShapeWithImage, type SceneCommandResult } from "@/lib/template-editor/commands";
import {groupMemberIds} from "@/lib/template-editor/layer-tree";
import { translateElements } from "@/lib/template-editor/snapping";
import { ElementInspector, type InspectorSection } from "./element-inspector";
import { EditorIcon } from "./editor-icons";
import "./wysiwyg.css";
import "./pro-tools.css";
import "./editor-shell.css";
import "./interaction-system.css";
import "./editor-workflow.css";
import { DesignFrame, DesignPreview, FRAME_WIDTH } from "./preview";

type Tab =
  | "smart"
  | "templates"
  | "brand"
  | "text"
  | "elements"
  | "media"
  | "layers"
  | "caption"
  | "style"
  | "page"
  | "view";
type Props = {
  workspaceScope?: string;
  collaboration?: EditorCollaboration;
  design: DesignDocument;
  currentPageId?: string;
  onCurrentPageChange?: (id:string,mode:NavigationHistoryMode)=>void;
  workspaceLibrary?: EditorLibrary;
  onWorkspaceChange?: (recipe:(library:EditorLibrary)=>EditorLibrary)=>boolean|void;
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

const SHAPE_OPERATIONS = [
  ['union', 'Merge shapes (Union)'],
  ['intersect', 'Intersect shapes'],
  ['subtract', 'Subtract front shapes'],
  ['xor', 'Exclude overlap'],
] as const;

function compactEditorSnapshot() { return window.matchMedia("(max-width: 760px)").matches; }
function subscribeCompactEditor(notify: () => void) {
  const media=window.matchMedia("(max-width: 760px)");
  media.addEventListener("change",notify);
  return ()=>media.removeEventListener("change",notify);
}
function desktopEditorSnapshot() { return false; }

function canCombineShapeSelection(scene: CanvasScene, ids: string[]) {
  const elements = scene.elements.filter(element => ids.includes(element.id));
  return ids.length >= 2 && elements.length === ids.length && elements.every(element => element.type === "shape" && !isElementHidden(scene, element) && canEditElement(scene, element, "position") && canEditElement(scene, element, "delete"));
}

export function DesignEditor({
  workspaceScope,
  collaboration,
  design: initial,
  currentPageId,
  onCurrentPageChange,
  workspaceLibrary,
  onWorkspaceChange,
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
  const compactEditor=useSyncExternalStore(subscribeCompactEditor,compactEditorSnapshot,desktopEditorSnapshot);
  const otherEditors=useDocumentPresence(initial.id,workspaceScope,canEdit&&!collaboration);
  const [editingRequest, setEditingRequest] = useState<{id: string; serial: number}>();
  const [renameLayer, setRenameLayer] = useState<{id: string; name: string} | null>(null);
  const [design, setDesign] = useState<DesignDocument>(initial);
  const current = useRef<DesignDocument>(design);
  const history = useRef(createDocumentHistory<DesignDocument>());
  const historyContext=useRef<HistoryContext>({pageId:resolveDesignPageId(initial,currentPageId),selectedIds:[],editingMaster:false,isolatedGroupId:null});
  const historyBridge=useRef<CanvasHistoryBridge|null>(null);
  const registerHistoryBridge=useCallback((bridge:CanvasHistoryBridge|null)=>{historyBridge.current=bridge;},[]);
  const closeEditingHistory=useCallback(()=>closeHistoryGroup(history.current),[]);
  const [historyRevision,setHistoryRevision]=useState(0);
  const [historyState, setHistoryState] = useState({
    undo: false,
    redo: false,
  });
  const [localPageId, setPageId] = useState(()=>resolveDesignPageId(initial,currentPageId));
  const pageId=resolveDesignPageId(design,currentPageId??localPageId);
  const previousNavigationPage=useRef(pageId);
  const restoredNavigationPage=useRef<string|null>(null);
  const activePage = useRef(pageId);

  const [tab, setTab] = useState<Tab | null>(() => supportsSmartTemplate(initial, templates) ? "smart" : null);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>("edit");
  const [templateSearch, setTemplateSearch] = useState("");
  const [pagesOpen, setPagesOpen] = useState(initial.pages.length > 1);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const drawerScrollRef = useRef<HTMLFieldSetElement>(null);
  useLayoutEffect(()=>{if(drawerScrollRef.current)drawerScrollRef.current.scrollTop=0;},[tab,inspectorSection]);
  const drawerTitles: Record<Tab, string> = {smart:"Smart layout", templates:"Templates", text:"Text", elements:"Elements", media:"Uploads", brand:"Brand", layers:"Layers", caption:"Caption", style:"Properties", page:"Page settings", view:"View"};
  function openPanel(next: Tab, toggle = false) {
    if (toggle && tab === next) { closePanel(); return; }
    if (document.activeElement instanceof HTMLElement) drawerTrigger.current = document.activeElement;
    setTab(next);
  }
  function closePanel() {
    setTab(null);
    drawerTrigger.current?.focus({preventScroll:true});
  }
  function openInspector(section: InspectorSection = "edit") {
    setInspectorSection(section);
    openPanel("style");
  }
  const [selection, setSelection] = useState<string[]>([]);
  const smartContextEnabled = supportsSmartTemplate(initial, templates);
  const selectedIdsRef = useRef<string[]>([]);
  const setSelected = useCallback((ids: string[]) => {
    const changed = ids.length !== selectedIdsRef.current.length || ids.some((id,index)=>id!==selectedIdsRef.current[index]);
    selectedIdsRef.current = ids;
    setSelection(ids);
    if (changed && ids.length) {
      setInspectorSection("edit");
      if (smartContextEnabled) setTab(previous => previous === "layers" || previous === "media" ? previous : "smart");
    }
  }, [smartContextEnabled]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [notice, setNotice] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [exportDialog,setExportDialog]=useState(false);
  const [textureTarget,setTextureTarget]=useState<{element:TextElement;context:string;words?:number[];photos:ShapeImageFill[];background:string}|null>(null);
  const [preflightIssues,setPreflightIssues]=useState<PreflightIssue[]>([]);
  const [layoutOpen,setLayoutOpen]=useState(false);
  const [workflowOpen,setWorkflowOpen]=useState(false);
  const [workflowTab,setWorkflowTab]=useState("resources");
  const [editingMaster,setEditingMaster]=useState(false);
  const [requestedIsolationGroupId,setIsolatedGroupId]=useState<string|null>(null);
  const [cropImageId,setCropImageId]=useState<string|null>(null);
  const [pathTool,setPathTool]=useState(false);
  const [navigationMode,setNavigationMode]=useState<"select"|"hand"|"nodes">("select");
  const [penClosed,setPenClosed]=useState(false);
  const [penPointCount,setPenPointCount]=useState(0);
  const [nodeToolbarHost,setNodeToolbarHost]=useState<HTMLDivElement|null>(null);
  const [textToolbarHost,setTextToolbarHost]=useState<HTMLDivElement|null>(null);
  const drawingControls=useRef<CanvasDrawingControls|null>(null);
  const registerDrawingControls=useCallback((controls:CanvasDrawingControls|null)=>{drawingControls.current=controls;},[]);
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
  const exportPreparation=useRef<AbortController|null>(null);
  const [preparingExport,setPreparingExport]=useState(false);
  const [job, setJob] = useState<{
    design: DesignDocument;
    pageId?: string;
    pageIds?: string[];
    options?: ExportOptions;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [exportPageIndex,setExportPageIndex]=useState(0);
  const pendingExportFrame=useRef<{resolve:(frame:HTMLElement)=>void;reject:(error:unknown)=>void;cleanup:()=>void}|null>(null);
  useLayoutEffect(()=>{if(!pendingExportFrame.current)return;const frame=exportRef.current?.querySelector<HTMLElement>('.te-frame');if(frame){const pending=pendingExportFrame.current;pendingExportFrame.current=null;pending.cleanup();pending.resolve(frame);}},[exportPageIndex,job]);
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exportPreparation.current?.abort();
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
  const previousWorkspace = useRef<{pageId: string; scale: number; fit: number; left: number; top: number; height: number; centerRequest: number; viewportWidth: number; viewportHeight: number} | null>(null);
  const zoomAnchor=useRef<{x:number;y:number;screenX:number;screenY:number}|null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const receivedDocument = useRef(initial);
  useLayoutEffect(() => {
    if (receivedDocument.current === initial) return;
    receivedDocument.current = initial;
    if (!collaboration || initial.id !== current.current.id || sameContent(initial,current.current)) return;
    // Keep this editor instance, its navigation, and its local transient tools
    // while adopting the shared document. Receiving never emits another edit.
    current.current = initial;
    setDesign(initial);
  }, [initial,collaboration]);
  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0];
  const activePageId = page.id;
  const index = design.pages.indexOf(page);
  const format = formatDimensions(design);
  const canvasHeight = (FRAME_WIDTH * format.height) / format.width;
  const continuous = Boolean(design.continuousCanvas)&&!editingMaster;
  const canvasWidth = FRAME_WIDTH * (continuous ? design.pages.length : 1);
  const scene = editingMaster ? design.masterScene??{background:'transparent',elements:[]} : design.continuousCanvas ?? page.canvas ?? sceneForPage(page, design.format);
  const smartLayoutAvailable = supportsSmartTemplate(design, templates);
  const collaborationPageId = editingMaster ? "@master" : continuous ? "@continuous" : page.id;
  const publishAwareness = collaboration?.setAwareness;
  const awarenessScene = useRef(scene);
  useLayoutEffect(() => { awarenessScene.current = scene; });
  useEffect(() => { publishAwareness?.({pageId:collaborationPageId,cursor:null,preview:null}); }, [publishAwareness,collaborationPageId]);
  const publishCursor = useCallback((cursor:{x:number;y:number}|null) => { publishAwareness?.({cursor}); }, [publishAwareness]);
  const publishScenePreview = useCallback((preview:CanvasScene|null) => {
    if (!publishAwareness) return;
    const elements = preview?.elements.filter(element => {
      const original = awarenessScene.current.elements.find(item => item.id === element.id);
      return original && (element.x !== original.x || element.y !== original.y || element.width !== original.width || element.height !== original.height || element.rotation !== original.rotation || element.type === "text" && original.type === "text" && element.fontSize !== original.fontSize);
    }).map(element => ({id:element.id,x:element.x,y:element.y,width:element.width,height:element.height,rotation:element.rotation,...(element.type === "text" ? {fontSize:element.fontSize} : {})})) ?? [];
    publishAwareness({preview:elements.length ? {elements} : null});
  }, [publishAwareness]);
  const isolatedGroupId = scene.groups?.some(group => group.id === requestedIsolationGroupId) ? requestedIsolationGroupId : null;
  const selected = scopeSelection(scene, selection, isolatedGroupId ?? undefined);
  const collaborationSelection = JSON.stringify(selected);
  useEffect(() => { publishAwareness?.({selected:JSON.parse(collaborationSelection) as string[]}); }, [publishAwareness,collaborationSelection]);
  useLayoutEffect(()=>{historyContext.current={pageId:page.id,selectedIds:[...selected],editingMaster,isolatedGroupId};},[page.id,selected,editingMaster,isolatedGroupId]);
  const previousPage = !continuous && index > 0 ? design.pages[index - 1] : undefined;
  const onionScene = onionSkin && page.canvas && previousPage ? previousPage.canvas ?? sceneForPage(previousPage, design.format) : undefined;
  const selectedPhoto = selected.length === 1 ? scene.elements.find(element => element.id === selected[0] && (element.type === "image" || (element.type === "shape" && element.imageFill))) : undefined;
  const selectedImage = selected.length === 1 ? scene.elements.find((element) => element.id === selected[0] && element.type === "image") : undefined;
  const selectedElements = scene.elements.filter(element=>selected.includes(element.id));
  const textSelection = selectedElements.length>0&&selectedElements.every(element=>element.type==="text");
  const contextTitle = !selected.length ? "Canvas" : textSelection ? "Text" : selected.length>1 ? `${selected.length} selected` : selectedPhoto ? selectedPhoto.type==="shape"?"Photo frame":"Photo" : selectedElements[0]?.type==="shape"?"Shape":"Properties";
  const compactPanelOpen=compactEditor&&tab!==null&&(tab!=="style"||selected.length>0);
  const pagesVisible=pagesOpen&&!compactPanelOpen;
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

  useLayoutEffect(()=>{
    activePage.current=pageId;
    if(previousNavigationPage.current!==pageId){
      previousNavigationPage.current=pageId;
      const restored=restoredNavigationPage.current===pageId;
      restoredNavigationPage.current=null;
      if(!restored)queueMicrotask(()=>{if(activePage.current!==pageId)return;setEditingRequest(undefined);setCropImageId(null);setSelected([]);setIsolatedGroupId(null);});
    }
    onCurrentPageChange?.(pageId,"replace");
  },[pageId,onCurrentPageChange,setSelected,setIsolatedGroupId]);
  function selectPage(id: string) {
    const target=resolveDesignPageId(current.current,id);
    restoredNavigationPage.current=null;
    activePage.current=target;
    setEditingRequest(undefined);
    setCropImageId(null);
    setSelected([]);
    setIsolatedGroupId(null);
    setPageId(target);
    onCurrentPageChange?.(target,"push");
  }
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
    // Keep the layer list open for Shift-selection and repeated layer actions.
    const next=expandGroupSelection(scene,ids,isolatedGroupId??undefined);
    selectedIdsRef.current=next;
    setSelection(next);
    setInspectorSection("edit");
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
    else if (!previous || previous.fit !== fit || previous.pageId !== page.id || previous.height !== canvasHeight || previous.centerRequest !== centerRequest || previous.viewportWidth !== node.clientWidth || previous.viewportHeight !== node.clientHeight) {
      node.scrollLeft = (workspaceLeft + (continuous && previous && previous.pageId !== page.id ? index * FRAME_WIDTH + FRAME_WIDTH / 2 : canvasWidth / 2)) * scale - node.clientWidth / 2;
      node.scrollTop = (workspaceTop + canvasHeight / 2) * scale - node.clientHeight / 2;
    } else {
      // Preserve the same world point at the center when zoom or padding changes.
      const centerX = (node.scrollLeft + previous.viewportWidth / 2) / previous.scale - previous.left;
      const centerY = (node.scrollTop + previous.viewportHeight / 2) / previous.scale - previous.top;
      node.scrollLeft = (centerX + workspaceLeft) * scale - node.clientWidth / 2;
      node.scrollTop = (centerY + workspaceTop) * scale - node.clientHeight / 2;
    }
    previousWorkspace.current = {pageId: page.id, scale, fit, left: workspaceLeft, top: workspaceTop, height: canvasHeight, centerRequest, viewportWidth: node.clientWidth, viewportHeight: node.clientHeight};
  }, [page.id, canvasHeight, canvasWidth, continuous, index, scale, fit, workspaceLeft, workspaceTop, centerRequest]);
  const isTemplateDraft = design.purpose === "template";
  const saveTemplateLabel = isTemplateDraft
    ? design.editingTemplateId
      ? "Update template"
      : "Save template"
    : "Save as template";
  const disabled = !canEdit || Boolean(job) || preparingExport;
  async function startExport(options:ExportOptions,pageIds:string[]) {
    if(job||exportPreparation.current)return;
    const controller=new AbortController();exportPreparation.current=controller;setPreparingExport(true);setExportDialog(false);
    try {
      const prepared=await prepareExportDimensions(await prepareSmartTextExport(structuredClone(design),controller.signal,pageIds),pageIds,options,controller.signal);
      controller.signal.throwIfAborted();assertDesignExportBudget(prepared,options,pageIds);
      if(mounted.current)setJob({design:prepared,options,pageIds});
    }catch(error){if(!controller.signal.aborted&&mounted.current)setNotice(error instanceof Error?error.message:'Export could not start.');}
    finally{if(exportPreparation.current===controller)exportPreparation.current=null;if(mounted.current)setPreparingExport(false);}
  }
  const blocked = useRef(disabled);
  useEffect(() => { blocked.current = disabled; }, [disabled]);

  const commit = useCallback(
    (change: (d: DesignDocument) => DesignDocument, group = "") => {
      if (blocked.current) return false;
      const previous = current.current;
      let changed:DesignDocument;
      try{changed=change(previous);
        changed={...changed,pages:changed.pages.map(page=>{
          const source=previous.pages.find(original=>original.id===page.id)?.canvas;
          if(!source||!page.canvas||source===page.canvas||!source.elements.some(element=>element.templateRole||element.type==="text"&&element.smartText)||!page.canvas.elements.some(element=>source.elements.some(original=>original.id===element.id)))return page;
          return {...page,canvas:layoutSmartScene(constrainSmartTemplate(source,page.canvas)).scene};
        })};
      }catch(error){setNotice(error instanceof Error?error.message:'Could not apply this change.');return false;}
      if(sameDocumentContent(changed,previous))return true;
      const next = { ...changed, updatedAt: new Date().toISOString() };
      const h = history.current;
      if(!commitHistory(h,previous,next,historyContext.current,value=>onChangeRef.current(value),{group,automatic:group==="text-fit"}))return false;
      setHistoryState({ undo: h.past.length > 0, redo: h.future.length>0 });
      current.current = next;
      setDesign(next);
      return true;
    },
    [setNotice],
  );
  const sharedHistory = collaboration?.history;
  const travel = useCallback(
    (direction: "undo" | "redo") => {
      if (blocked.current || historyBridge.current?.flush()===false) return false;
      if (sharedHistory) {
        sharedHistory[direction]();
        return true;
      }
      const h = history.current;
      const entry=travelHistory(h,current.current,historyContext.current,direction,value=>onChangeRef.current(value),value=>({...value,updatedAt:new Date().toISOString()}));
      if(!entry)return false;
      const updated=entry.document;
      setHistoryState({ undo: h.past.length > 0, redo: h.future.length > 0 });
      current.current = updated;
      setDesign(updated);
      const targetPage=resolveDesignPageId(updated,entry.context.pageId);
      if(targetPage!==activePage.current)restoredNavigationPage.current=targetPage;
      activePage.current=targetPage;
      setPageId(targetPage);
      onCurrentPageChange?.(targetPage,"replace");
      setSelected(entry.context.selectedIds);
      setEditingMaster(entry.context.editingMaster&&Boolean(updated.masterScene));
      setIsolatedGroupId(entry.context.isolatedGroupId);
      setCropImageId(null);setEditingRequest(undefined);
      setNotice("");
      setHistoryRevision(revision=>revision+1);
      return true;
    },
    [setSelected,setEditingMaster,setIsolatedGroupId,setNotice,onCurrentPageChange,sharedHistory],
  );
  function changeScene(next: CanvasScene, group = "") {
      return commit(
        (d) => {
          const target = d.pages.find(item => item.id === activePageId);
          if (!target) return d;
          const live = editingMaster ? d.masterScene ?? scene : d.continuousCanvas ?? target.canvas ?? sceneForPage(target, d.format);
          next = constrainSceneToIsolation(live, next, isolatedGroupId ?? undefined);
          next = layoutSmartScene(constrainSmartTemplate(live, next)).scene;
          if(editingMaster)return {...d,masterScene:next};
          const promoted=next.elements.filter(e=>e.master);
          if(promoted.length){const snapshot=copySelection(next,promoted.map(e=>e.id));const copy=duplicateCanvasScene({background:'transparent',elements:snapshot,groups:snapshot.groups});const master={background:'transparent',...d.masterScene,groups:[...(d.masterScene?.groups??[]),...(copy.groups??[])],elements:[...(d.masterScene?.elements??[]),...copy.elements.map(e=>({...e,x:e.x-(d.continuousCanvas?d.pages.findIndex(p=>p.id===activePageId)*FRAME_WIDTH:0)}))]};if(master.elements.length>100)throw new Error('The master supports up to 100 elements.');const remainder={...next,elements:next.elements.filter(e=>!e.master)};return d.continuousCanvas?{...d,masterScene:master,continuousCanvas:remainder}:{...d,masterScene:master,pages:d.pages.map(p=>p.id===activePageId?{...p,canvas:remainder}:p)};}
          return d.continuousCanvas ? {...d, continuousCanvas: next} : ({
          ...d,
          pages: d.pages.map((p) =>
            p.id === activePageId ? { ...p, canvas: next } : p,
          ),
        });},
        group === "text-fit" ? group : group ? `${activePageId}:${group}` : "",
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
    try {
      const {src,previewSrc,width:originalWidth,height:originalHeight} = await prepareRasterAsset(file);
      if (!mounted.current) return;
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
      const w = Math.max(1, Math.min(280, originalWidth / 3)),
        h = Math.max(
          1,
          Math.min(canvasHeight * 0.7, (w * originalHeight) / originalWidth),
        );
      const image = createCanvasElement("image", {
        src,
        previewSrc,
        name: file.name.slice(0, 100),
        x: (targetContinuous ? current.current.pages.indexOf(targetPage) * FRAME_WIDTH : 0) + (FRAME_WIDTH - w) / 2,
        y: (canvasHeight - h) / 2,
        width: w,
        height: h,
        intrinsicWidth:originalWidth,
        intrinsicHeight:originalHeight,
      });
      const accepted = commit((d) => {
        const update = (live: CanvasScene): CanvasScene => {
          if(targetIsolation&&!live.groups?.some(group=>group.id===targetIsolation))throw new Error('The target group was removed. Upload the image again.');
          const frame=replaceId?live.elements.find(element=>element.id===replaceId&&element.type==='shape'):undefined;
          if(frame)return fillShapeWithImage(live,frame.id,{src,previewSrc,alt:file.name.slice(0,200),objectFit:'cover',cropX:50,cropY:50,cropScale:1,intrinsicWidth:originalWidth,intrinsicHeight:originalHeight}).scene;
          return constrainSceneToIsolation(live,{...live, elements: replaceId
          ? live.elements.map((element) => element.id === replaceId && element.type === "image" ? {...element, src, previewSrc, intrinsicWidth:originalWidth,intrinsicHeight:originalHeight,name: file.name.slice(0, 100)} : element)
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
      if (mounted.current) setUploading(false);
    }
  }
  async function copyElements(ids: string[], cut = false, transfer?: DataTransfer) {
    if (cut && blocked.current) return;
    const target = current.current.pages.find((item) => item.id === page.id);
    if (!target) return;
    const live = editingMaster?current.current.masterScene??scene:current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target, current.current.format);
    const scoped = scopeSelection(live, ids, isolatedGroupId ?? undefined);
    const copyIds = cut ? scoped.filter(id => { const element = live.elements.find(item => item.id === id); return element && canEditElement(live, element, "delete"); }) : scoped;
    const snapshot = copySelection(live, copyIds, isolatedGroupId ?? undefined, { x: !editingMaster && current.current.continuousCanvas ? current.current.pages.indexOf(target) * FRAME_WIDTH : 0, y: 0 });
    if (!snapshot.length) return;
    try {
      const documentId = current.current.id, pageId = activePage.current;
      const encoded = encodeElementClipboard(snapshot,documentId);
      if(transfer) {transfer.setData(ENGINE_CLIPBOARD_TYPE,encoded);transfer.setData("text/plain",encoded);}
      else await navigator.clipboard.writeText(encoded);
      if (cut && current.current.id===documentId && activePage.current===pageId) {
        const latest = editingMaster?current.current.masterScene:current.current.continuousCanvas??current.current.pages.find(p=>p.id===pageId)?.canvas;
        if(latest===live) applyCommand((latest) => removeSelection(latest, copyIds));
        else {setNotice("Copied. The page changed while copying, so its objects were kept.");return;}
      }
      setNotice(`${snapshot.length} object${snapshot.length === 1 ? "" : "s"} ${cut ? "cut" : "copied"}. Paste into any Engine project.`);
    } catch {setNotice("Clipboard access was blocked. Focus the canvas and use ⌘/Ctrl C or X. Your objects were kept.");}
  }
  function pasteElements(live: CanvasScene, snapshot:ElementSnapshot, position?: { x: number; y: number }) {
    const index = current.current.pages.findIndex(item => item.id === page.id);
    return pasteSelection(live, snapshot, position, { x: !editingMaster && current.current.continuousCanvas ? Math.max(0,index) * FRAME_WIDTH : 0, y: 0 });
  }
  function pasteClipboardText(text:string,position?:{x:number;y:number}) {
    try {
      const snapshot=decodeElementClipboard(text,current.current.id);
      if(snapshot) {applyCommand(live=>pasteElements(live,snapshot,position));return;}
      const value=plainClipboardText(text);
      if(value.trim()) {
        const offset=!editingMaster&&current.current.continuousCanvas?Math.max(0,current.current.pages.findIndex(item=>item.id===page.id))*FRAME_WIDTH:0;
        const element=createTextBox({text:value,name:value.slice(0,100),font:brand.font,color:brand.text,x:position?.x??offset+40,y:position?.y??40,width:280});
        applyCommand(live=>live.elements.length>=100?{scene:live,selectedIds:[],limited:true}:{scene:{...live,elements:[...live.elements,element]},selectedIds:[element.id],limited:false});
      }
    }catch(error){setNotice(error instanceof Error?error.message:"Could not paste the clipboard.");}
  }
  async function pasteFromSystemClipboard(position?:{x:number;y:number}) {
    if(disabled)return;
    const documentId=current.current.id,pageId=activePage.current;
    try {
      if(navigator.clipboard.read) {
        const items=await navigator.clipboard.read();
        if(current.current.id!==documentId||activePage.current!==pageId)return;
        const image=items.find(item=>item.types.some(type=>["image/png","image/jpeg","image/webp"].includes(type)));
        if(image){const type=image.types.find(type=>["image/png","image/jpeg","image/webp"].includes(type))!;const blob=await image.getType(type);if(current.current.id!==documentId||activePage.current!==pageId)return;await upload(new File([blob],"Pasted image",{type}));return;}
        const item=items.find(item=>item.types.includes("text/plain"));
        if(item){const text=await(await item.getType("text/plain")).text();if(current.current.id===documentId&&activePage.current===pageId)pasteClipboardText(text,position);}
        else setNotice("Copy an image, text, or Engine objects before pasting.");
      }else {
        const text=await navigator.clipboard.readText();
        if(current.current.id===documentId&&activePage.current===pageId)pasteClipboardText(text,position);
      }
    }catch {setNotice("Focus the canvas and press ⌘/Ctrl V to paste from your clipboard.");}
  }
  function shapeOperationItems(ids: string[]): ContextMenuItem[] {
    return SHAPE_OPERATIONS.map(([operation, label]) => ({
      id: `shape-${operation}`, label, disabled: disabled || !canCombineShapeSelection(scene, ids),
      onSelect: () => applyCommand(live => combineShapes(live, ids, operation)),
    }));
  }
  function elementMenu(ids: string[]): ContextMenuItem[] {
    ids = scopeSelection(scene, ids, isolatedGroupId ?? undefined);
    const elements = scene.elements.filter((e) => ids.includes(e.id));
    const editable = elements.filter((e) => canEditElement(scene, e, "position"));
    const deletable = elements.filter((e) => canEditElement(scene, e, "delete"));
    const single = elements.length === 1 ? elements[0] : undefined;
    const shapeOperations = elements.length > 1 && elements.every(element => element.type === "shape") ? shapeOperationItems(ids) : [];
    return [
      ...shapeOperations,
      ...(single?.type === "text" ? [{id: "edit-text", label: "Edit text", disabled: disabled || !canEditElement(scene, single, "content") || isElementHidden(scene,single), onSelect: () => setEditingRequest({id: single.id, serial: Date.now()})}] : []),
      {id: "copy", label: "Copy", shortcut: "⌘/Ctrl C", separator: shapeOperations.length > 0, onSelect: () => copyElements(ids)},
      {id: "cut", label: "Cut", shortcut: "⌘/Ctrl X", disabled: disabled || !deletable.length, onSelect: () => copyElements(ids, true)},
      {id: "duplicate", label: "Duplicate", shortcut: "⌘/Ctrl D", disabled: disabled || !editable.length || scene.elements.length >= 100, onSelect: () => applyCommand((live) => duplicateSelection(live, ids,undefined,isolatedGroupId??undefined))},
      {id: "paste", label: "Paste", shortcut: "⌘/Ctrl V", disabled: disabled || scene.elements.length >= 100, onSelect: () => {void pasteFromSystemClipboard();}},
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
      ...(single?.type === "image" ? [{id:"save-brand", label:"Save image to brand kit", disabled:disabled || (brandKits.find((kit) => kit.id === activeBrandKitId)?.assets.length ?? 0) >= 40, onSelect:async() => {
        if (blocked.current) return;
        try {const asset=await captureBrandImage(single);if(blocked.current)return;if(onSaveBrandAsset(asset,activeBrandKitId)===false)return;setNotice("Original image saved to your brand kit.");}catch(reason){setNotice(reason instanceof Error?reason.message:"This image could not be saved.");}
      }}] : []),
      {id: "properties", label: "Show properties", onSelect: () => openInspector()},
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
        {id: "paste", label: "Paste here", shortcut: "⌘/Ctrl V", disabled: disabled || scene.elements.length >= 100, onSelect: () => {void pasteFromSystemClipboard(position);}},
        {id: "text", label: "Add text", shortcut: "T", disabled, onSelect: () => addText()},
        {id: "shape", label: "Add rectangle", shortcut: "R", disabled, onSelect: () => addShape("rectangle")},
        {id: "image", label: "Upload image", disabled: disabled || uploading, onSelect: () => fileRef.current?.click()},
        {id: "select", label: "Select all unlocked elements", shortcut: "⌘/Ctrl A", separator: true, disabled: !scene.elements.some((e) => !e.locked && !e.hidden), onSelect: () => setSelected(selectable.map(e=>e.id))},
        {id: "background", label: "Page background", onSelect: () => openPanel("page")},
        {id: "undo", label: "Undo", shortcut: "⌘/Ctrl Z", separator: true, disabled: disabled || !(sharedHistory?.canUndo ?? historyState.undo), onSelect: () => travel("undo")},
        {id: "redo", label: "Redo", shortcut: "⌘/Ctrl ⇧ Z", disabled: disabled || !(sharedHistory?.canRedo ?? historyState.redo), onSelect: () => travel("redo")},
      ],
    });
  }
  function pageMenu(event: React.MouseEvent, target: DesignPage) {
    const targetIndex = design.pages.findIndex((p) => p.id === target.id);
    openMenu(event, {label: `Page ${targetIndex + 1}`, items: [
      {id: "open-page", label: "Go to page", onSelect: () => {selectPage(target.id); setSelected([]);}},
      {id: "duplicate-page", label: "Duplicate page", disabled: disabled || continuous || design.pages.length >= 20, onSelect: () => addPage(true, target)},
      {id: "add-page", label: continuous ? "Add slide at end" : "Add blank page after", disabled: disabled || design.pages.length >= 20, onSelect: () => addPage(false, target)},
      {id: "left", label: "Move page left", separator: true, disabled: disabled || continuous || targetIndex === 0, onSelect: () => movePage(targetIndex, targetIndex - 1)},
      {id: "right", label: "Move page right", disabled: disabled || continuous || targetIndex === design.pages.length - 1, onSelect: () => movePage(targetIndex, targetIndex + 1)},
      {id: "export-page", label: "Download page as PNG", separator: true, disabled: Boolean(job) || uploading, onSelect: () => {void startExport({},[target.id]);}},
      {id: "delete-page", label: "Delete page", danger: true, separator: true, disabled: disabled || (continuous ? design.pages.length <= 2 || targetIndex !== design.pages.length - 1 : design.pages.length <= 1), onSelect: () => setRemovePageId(target.id)},
    ]});
  }
  function workspaceMenu(event: React.MouseEvent) {
    openMenu(event, {label: design.name || "Design workspace", items: [
      {id: "undo", label: "Undo", shortcut: "⌘/Ctrl Z", disabled: disabled || !(sharedHistory?.canUndo ?? historyState.undo), onSelect: () => travel("undo")},
      {id: "redo", label: "Redo", shortcut: "⌘/Ctrl ⇧ Z", disabled: disabled || !(sharedHistory?.canRedo ?? historyState.redo), onSelect: () => travel("redo")},
      {id: "paste", label: "Paste elements", shortcut: "⌘/Ctrl V", disabled: disabled, onSelect: () => {void pasteFromSystemClipboard();}},
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
    if (window.matchMedia("(max-width: 760px)").matches) setTab(null);
    if (element.type === "text") setEditingRequest(previous=>({id:element.id,serial:(previous?.serial??0)+1}));
  }
  const addText = (size = 28, text = "Add your text") =>
    addElement(
      createTextBox({
        text,
        name: text,
        x: (continuous ? index * FRAME_WIDTH : 0) + 32,
        y: canvasHeight / 2 - 40,
        width: 296,
        font: scene.elements.find((element):element is TextElement=>element.type==="text"&&Boolean(element.smartText))?.font ?? brand.font,
        fontSize: size,
        fontWeight: size >= 24 ? 700 : 400,
        color: scene.elements.find((element):element is TextElement=>element.type==="text"&&Boolean(element.smartText))?.color ?? brand.text,
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
      if(event.defaultPrevented||event.isComposing)return;
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
      const command=resolveEditorCommand(event);
      const historyDirection=historyShortcut(event);
      if (historyDirection) {
        event.preventDefault();
        travel(historyDirection);
        return;
      }
      if(!mod&&target.closest('button,a[href],summary,[role="button"]')&&!target.closest('.te-canvas-hit'))return;
      if (command === "select-all") {
        event.preventDefault();
        setSelected(selectable.map(e=>e.id));
        return;
      }
      if (command === "duplicate" && selected.length) {
        event.preventDefault();
        applyCommand((live) => duplicateSelection(live, selected,undefined,isolatedGroupId??undefined));
        return;
      }
      if(command==='group'||command==='ungroup'){event.preventDefault();applyCommand(live=>event.shiftKey?ungroupSelection(live,selected,isolatedGroupId??undefined):groupSelection(live,selected,"Group",isolatedGroupId??undefined));return;}
      if(command==='pan'){event.preventDefault();setSpacePanning(true);return;}
      if (command === "delete" && selected.length) {
        event.preventDefault();
        applyCommand((live) => removeSelection(live, selected));
        return;
      }
      if (["forward","backward","front","back"].includes(command??"")) {
        event.preventDefault();
        applyCommand((live) => reorderSelection(live, selected, command as "front"|"forward"|"back"|"backward"));
        return;
      }
      if(command==="nudge"&&navigationMode==="hand"){event.preventDefault();const amount=event.shiftKey?100:30;workspaceRef.current?.scrollBy({left:key==="arrowright"?amount:key==="arrowleft"?-amount:0,top:key==="arrowdown"?amount:key==="arrowup"?-amount:0});return;}
      if (command === "nudge" && selected.length) {
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
      if (command === "escape") {
        setSelected([]);
        setCropImageId(null);setIsolatedGroupId(null);setPathTool(false);setImageDropTargetId(null);paletteDrag.current?.();
        return;
      }
      if(command==="nodes"&&(selected.length!==1||!scene.elements.some(element=>element.id===selected[0]&&element.type==="shape"&&canEditElement(scene,element,"style")&&canEditElement(scene,element,"position")))){event.preventDefault();setNotice("Select an unlocked shape to edit its path nodes.");return;}
      if(command==="hand"||command==="select"||command==="nodes"){event.preventDefault();setNavigationMode(command==="select"?"select":command);setPathTool(false);setCropImageId(null);return;}
      if(command==="pen"){event.preventDefault();setPathTool(value=>!value);setNavigationMode("select");setCropImageId(null);return;}
      if(command==="zoom-in"||command==="zoom-out"){event.preventDefault();setZoom(value=>Math.max(.05,Math.min(32,value*(command==="zoom-in"?1.25:.8))));return;}
      if(command==="fit"){event.preventDefault();fitPage();return;}
      if (command === "text") {
        event.preventDefault();
        addText();
      }
      if (command === "rectangle") {
        event.preventDefault();
        addShape("rectangle");
      }
      if (command === "ellipse") {
        event.preventDefault();
        addShape("ellipse");
      }
    };
    window.addEventListener("keydown", handler);
    const release=(e:KeyboardEvent)=>{if(e.key===' ')setSpacePanning(false);};const blur=()=>setSpacePanning(false);window.addEventListener('keyup',release);window.addEventListener('blur',blur);
    return () => {window.removeEventListener("keydown", handler);window.removeEventListener('keyup',release);window.removeEventListener('blur',blur);};
  });
  useEffect(() => {
    const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&Boolean(target.closest("input,textarea,select,[contenteditable=true],dialog,[role=menu]"));
    const copy=(event:ClipboardEvent)=>{if(event.defaultPrevented||editable(event.target)||Boolean(window.getSelection()?.toString())||!selected.length||!event.clipboardData)return;event.preventDefault();void copyElements(selected,event.type==="cut",event.clipboardData);};
    const paste=(event:ClipboardEvent)=>{
      if(event.defaultPrevented||editable(event.target)||disabled||!event.clipboardData)return;
      const file=Array.from(event.clipboardData.files).find(file=>file.type.startsWith("image/"));
      if(file){event.preventDefault();void upload(file);return;}
      const text=event.clipboardData.getData(ENGINE_CLIPBOARD_TYPE)||event.clipboardData.getData("text/plain");
      if(text){event.preventDefault();pasteClipboardText(text);}
    };
    window.addEventListener("copy",copy);window.addEventListener("cut",copy);window.addEventListener("paste",paste);
    return()=>{window.removeEventListener("copy",copy);window.removeEventListener("cut",copy);window.removeEventListener("paste",paste);};
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
    let exportWarnings:string[]=[];
    const pageIds=job.design.pages.filter(page=>(!job.pageId||page.id===job.pageId)&&(!job.pageIds||job.pageIds.includes(page.id))).map(page=>page.id);
    const getFrame=(index:number,signal?:AbortSignal):Promise<HTMLElement>=>{if(index===0){const frame=exportRef.current?.querySelector<HTMLElement>('.te-frame');if(frame)return Promise.resolve(frame);}return new Promise((resolve,reject)=>{const cancel=()=>{pendingExportFrame.current=null;reject(signal?.reason??new DOMException('Export cancelled','AbortError'));};signal?.addEventListener('abort',cancel,{once:true});pendingExportFrame.current={resolve,reject,cleanup:()=>signal?.removeEventListener('abort',cancel)};setExportPageIndex(index);});};
    const frames = Array.from(
      exportRef.current?.querySelectorAll<HTMLElement>(".te-frame") ?? [],
    );
    exportFrames(frames, job.design.name, job.design.caption, (p) => {
      if (!ignore) setProgress(p);
    },{scale:formatDimensions(job.design).width/FRAME_WIDTH,...job.options,document:job.design,totalFrames:pageIds.length,getFrame,signal:abort.signal,onWarnings:warnings=>{exportWarnings=warnings;}})
      .then(() => {
        if (!ignore)
          setNotice(
            `${(job.options?.format??'png').toUpperCase()} downloaded · ${pageIds.length} page${pageIds.length===1?'':'s'}.${exportWarnings.length?' '+exportWarnings.join(' '):''}`,
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
          setProgress(0);setExportPageIndex(0);
        }
      });
    return () => {
      ignore = true;
      abort.abort();exportAbort.current=null;pendingExportFrame.current?.reject(new DOMException('Export cancelled','AbortError'));pendingExportFrame.current?.cleanup();pendingExportFrame.current=null;
    };
  }, [job]);

  function addPage(duplicate = false, source: DesignPage = page) {
    if (disabled || current.current.pages.length >= 20 || (continuous && duplicate)) return;
    setPagesOpen(true);
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
    selectPage(next.id);
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
  function openTextTexture() {
    if (disabled) return;
    if (historyBridge.current?.flush() === false) return;
    const target = current.current.pages.find(item => item.id === page.id);
    if (!target) return;
    const live = editingMaster ? current.current.masterScene ?? scene : current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target,current.current.format);
    const candidates = live.elements.filter(item=>selected.includes(item.id)&&item.type==="text"&&!isElementHidden(live,item)&&canEditElement(live,item,"content")&&canEditElement(live,item,"style"));
    const element = candidates.length===1?candidates[0]:undefined;
    if (!element || element.type !== "text" || !canEditElement(live,element,"content") || !canEditElement(live,element,"style") || isElementHidden(live,element)) return;
    const range = textFormatter.current?.capture();
    const words = range?.elementId === element.id ? getTextWords(element).filter(word => word.end > range.start && word.start < range.end).map(word => word.index) : undefined;
    const scenes = [...current.current.pages.map(item => item.canvas ?? sceneForPage(item,current.current.format)),current.current.continuousCanvas,current.current.masterScene].filter((item):item is CanvasScene => Boolean(item));
    const photos:ShapeImageFill[] = scenes.flatMap(item => item.elements.flatMap(layer => layer.type === "image" ? [{src:layer.src,previewSrc:layer.previewSrc,alt:layer.name,objectFit:"cover" as const,cropX:50,cropY:50,intrinsicWidth:layer.intrinsicWidth,intrinsicHeight:layer.intrinsicHeight,directive:layer.directive,rightsNote:layer.rightsNote,sourceUrl:layer.sourceUrl,provenance:layer.provenance}] : layer.type === "shape" && layer.imageFill ? [layer.imageFill] : layer.type === "text" ? activeTextTextures(layer) : []));
    photos.push(...brandKits.flatMap(kit => kit.assets.map(asset => ({...brandAssetPhoto(asset),objectFit:"cover" as const}))));
    photos.push(...["forest","dunes","coral","folds","orbits","sculpture"].map(name => ({src:`/template-editor/${name}.svg`,alt:`${name} artwork`,objectFit:"cover" as const,cropX:50,cropY:50})));
    setTextureTarget({element:structuredClone(element),context:editorTarget.current,words,photos,background:live.background});
    setEditingRequest(undefined);
  }
  function applyWordTexture(words:"all"|number[],texture:ShapeImageFill|null) {
    if (!textureTarget || disabled || textureTarget.context !== editorTarget.current) throw new Error("This text is no longer active. Close this dialog and select the text again.");
    const target = current.current.pages.find(item => item.id === page.id);
    if (!target) throw new Error("This page is no longer available.");
    const live = editingMaster ? current.current.masterScene ?? scene : current.current.continuousCanvas ?? target.canvas ?? sceneForPage(target,current.current.format);
    const element = live.elements.find(item => item.id === textureTarget.element.id);
    if (!element || element.type !== "text" || !canEditElement(live,element,"content") || !canEditElement(live,element,"style") || isElementHidden(live,element)) throw new Error("This text is locked or no longer available.");
    const appearance = (item:TextElement) => JSON.stringify([item.text,item.richText,item.textureFill,item.wordTextures]);
    if (appearance(element) !== appearance(textureTarget.element)) throw new Error("The text changed. Close this dialog and select your words again.");
    const result = applyTextWordTexture(live,element.id,words,texture);
    if (result.scene !== live && !changeScene(result.scene)) throw new Error("Could not save this texture. Please try again.");
    setNotice(texture ? words === "all" ? "Texture applied to all words." : `Texture applied to ${words.length} selected word${words.length === 1 ? "" : "s"}.` : "Texture removed. You can restore it with Undo.");
  }
  function updateWorkspace(recipe:(library:EditorLibrary)=>EditorLibrary):boolean {
    if(disabled||!onWorkspaceChange)return false;
    let updated:DesignDocument|undefined;
    const accepted=onWorkspaceChange(library=>{const next=recipe(library);updated=next.designs.find(item=>item.id===design.id);return next;});
    if(accepted===false)return false;
    if(updated&&JSON.stringify(updated)!==JSON.stringify(design))return commit(live=>applyDesignPatch(design,updated!,live));
    return true;
  }
  function insertSavedWorkspaceStyle(style:TextStyle,linked:boolean):boolean {
    if(disabled)return false;
    return commit(live=>{const content=editingMaster?live.masterScene??scene:live.continuousCanvas??live.pages.find(item=>item.id===page.id)?.canvas??scene;return insertWorkspaceStyle(live,content,selected,page.id,style,linked,editingMaster);});
  }
  function insertSavedWorkspaceComponent(component:ReusableComponent,linked:boolean):boolean {
    if(disabled)return false;
    let inserted:string[]=[];
    const accepted=commit(live=>{const content=editingMaster?live.masterScene??scene:live.continuousCanvas??live.pages.find(item=>item.id===page.id)?.canvas??scene;const result=insertWorkspaceComponent(live,content,page.id,component,linked,editingMaster,isolatedGroupId??undefined);inserted=result.selectedIds;
      return result.design;});
    if(accepted)setSelected(inserted);return accepted;
  }
  function applyBrand(all = true) {
    const update = (content: CanvasScene): CanvasScene => brandScene(content,brand);
    if (isolatedGroupId) {
      if (changeScene({...update(scene),background:scene.background})) setNotice(`Applied ${brand.name || "your brand"} inside this group.`);
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
      selectPage(converted.pages[0].id);
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
  const inspectorFor = (section = inspectorSection, contextual = false) => (
    <ElementInspector
      key={contextual ? `smart:${selected.join(":")}` : "properties"}
      scene={scene}
      selectedIds={selected}
      onSelect={setSelected}
      onChange={changeScene}
      width={canvasWidth}
      height={canvasHeight}
      disabled={disabled}
      slideBounds={continuous?{x:index*FRAME_WIDTH,y:0,width:FRAME_WIDTH,height:canvasHeight}:undefined}
      textStyles={design.styles}
      outputScale={format.width/FRAME_WIDTH}
      onSaveTextStyle={style=>commit(d=>saveSelectionTextStyle(d,style,selected,{pageId:page.id,master:editingMaster}))}
      onDeleteTextStyle={id=>commit(d=>({...d,styles:d.styles?.filter(s=>s.id!==id)}))}
      colorRoles={design.colorRoles}
      onSaveColorRole={role=>commit(d=>updateColorRole(d,role))}
      onDeleteColorRole={id=>commit(d=>removeColorRole(d,id))}
      onFormatText={formatText}
      initialSection={section}
      onSectionChange={contextual ? undefined : setInspectorSection}
      onTextTexture={openTextTexture}
      onUploadFramePhoto={(file:File,id:string)=>upload(file,id)}
      templateDraft={isTemplateDraft&&!editingMaster&&!continuous}
    />
  );
  const inspector = inspectorFor();

  return (
    <div className={`te-editor te-wysiwyg te-simple-editor te-guided-editor${tab ? " has-panel" : ""}`} onContextMenu={workspaceMenu} onDragEnd={()=>setImageDropTargetId(null)}>
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
      <input ref={replaceFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={event=>{
        const file=event.target.files?.[0],id=replaceTargetRef.current;
        event.target.value="";replaceTargetRef.current=null;
        if(file&&id)void upload(file,id);
      }}/>
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
            onFocus={closeEditingHistory}
            onChange={(e) =>
              commit((d) => ({ ...d, name: e.target.value }), "name")
            }
            onBlur={() => {
              closeEditingHistory();
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
            {saveStatus}{!collaboration&&otherEditors>0&&<span className="te-presence-label" title={`This project is also active in ${otherEditors} other tab${otherEditors===1?"":"s"} or device${otherEditors===1?"":"s"}.`}> · Also open elsewhere{otherEditors>1?` (${otherEditors})`:""}</span>}
          </span>
        </div>
        <div className="te-history">
          <button
            className="te-icon"
            disabled={disabled || !(collaboration?.history?.canUndo ?? historyState.undo)}
            onClick={() => travel("undo")}
            onPointerDown={event=>{if(event.button===0)event.preventDefault();}}
            title="Undo (⌘Z / Ctrl+Z)"
            aria-label="Undo"
            aria-keyshortcuts="Meta+z Control+z"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12"/></svg>
          </button>
          <button
            className="te-icon"
            disabled={disabled || !(collaboration?.history?.canRedo ?? historyState.redo)}
            onClick={() => travel("redo")}
            onPointerDown={event=>{if(event.button===0)event.preventDefault();}}
            title="Redo (⌘⇧Z / Ctrl+Y)"
            aria-label="Redo"
            aria-keyshortcuts="Meta+Shift+z Control+Shift+z Control+y"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12"/></svg>
          </button>
        </div>
        <div className="te-editor-header-actions">
          {collaboration&&<CollaborationBar collaboration={collaboration} />}
          {smartLayoutAvailable && <button className="te-button te-smart-layout-entry" aria-pressed={tab === "smart"} aria-controls="te-editor-panel" onClick={() => {setEditingMaster(false); openPanel("smart");}}>Smart layout</button>}
          <button className="te-button te-header-menu" aria-haspopup="menu" onClick={event=>openMenu(event,{label:"File",items:[
            {id:"save-template",label:saveTemplateLabel,disabled,onSelect:()=>setTemplateName(design.name)},
            {id:"caption",label:"Post caption",onSelect:()=>openPanel("caption")},
            {id:"caption-download",label:"Download caption",disabled:!design.caption.trim(),onSelect:()=>saveBlob(new Blob([design.caption],{type:"text/plain"}),`${fileName(design.name)}-caption.txt`)},
            {id:"review",label:"Review & version history",separator:true,onSelect:()=>{setWorkflowTab("review");setWorkflowOpen(true);}},
            {id:"advanced",label:"Advanced design tools",onSelect:()=>{setWorkflowTab("resources");setWorkflowOpen(true);}},
            {id:"shortcuts",label:"Keyboard shortcuts",separator:true,onSelect:()=>setShowShortcuts(true)},
          ]})}>File <span aria-hidden="true">⌄</span></button>
          <button className="te-button te-header-menu" disabled={design.pages.some(page=>page.canvas?.elements.some(element=>element.type==="text"&&element.smartText))} title={design.pages.some(page=>page.canvas?.elements.some(element=>element.type==="text"&&element.smartText))?"ChatGPTricks uses a fixed canvas size":undefined} aria-pressed={tab==="page"} aria-controls="te-editor-panel" onClick={()=>openPanel("page",true)}>Resize</button>
          <button className="te-button te-header-menu" aria-pressed={tab==="view"} aria-controls="te-editor-panel" onClick={()=>openPanel("view",true)}>View</button>
          {isTemplateDraft&&<button className="te-button te-draft-save" disabled={disabled} onClick={()=>setTemplateName(design.name)}>{saveTemplateLabel}</button>}
          <button className="te-button te-primary" disabled={Boolean(job)||uploading} onClick={openExportSettings}>
            <DownloadIcon /> {job ? `Exporting ${progress}%` : "Download"}
          </button>
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
            {smartLayoutAvailable && <button className={tab === "smart" ? "is-active" : ""} aria-label="Smart layout" aria-controls="te-editor-panel" aria-expanded={tab === "smart"} aria-pressed={tab === "smart"} onClick={() => {setEditingMaster(false); openPanel("smart", true);}}><StarIcon size={20}/><span>Smart layout</span></button>}
            {(
              [
                ["templates", LayoutIcon, "Design"],
                ["text", TextIcon, "Text"],
                ["elements", PlusIcon, "Elements"],
                ["media", ImageIcon, "Uploads"],
                ["brand", StarIcon, "Brand"],
                ["layers", CopyIcon, "Layers"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                className={tab === id ? "is-active" : ""}
                onClick={() => openPanel(id,true)}
                aria-controls="te-editor-panel"
                aria-expanded={tab === id}
                aria-pressed={tab === id}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {tab&&<section id="te-editor-panel" className="te-editor-drawer" aria-label={tab==="style"?contextTitle:drawerTitles[tab]} onKeyDown={event=>{
            if(event.key==="Escape"&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();closePanel();}
          }}>
          <div className="te-drawer-heading"><h2>{tab==="style"?contextTitle:drawerTitles[tab]}</h2><button className="te-icon" aria-label="Close tool panel" onClick={closePanel}>×</button></div>
          <fieldset ref={drawerScrollRef} disabled={disabled && tab !== "view"} className="te-panel-scroll">
            {tab === "smart" && <>
            {selectedPhoto && <div className="te-element-actions te-element-grid"><button type="button" className="te-button" disabled={disabled || !canEditElement(scene, selectedPhoto, "style") || !canEditElement(scene, selectedPhoto, "content")} onClick={() => setCropImageId(cropImageId === selectedPhoto.id ? null : selectedPhoto.id)}>{cropImageId === selectedPhoto.id ? "Finish crop" : "Crop photo"}</button><button type="button" className="te-button" disabled={disabled || !canEditElement(scene, selectedPhoto, "content")} onClick={() => {replaceTargetRef.current = selectedPhoto.id; replaceFileRef.current?.click();}}>Replace photo</button></div>}
            <SmartLayoutPanel design={design} pageId={page.id} selectedIds={selected} templates={templates} disabled={disabled} outputScale={format.width / FRAME_WIDTH} onUpdate={(id, patch) => {
              if (commit(d => {
                const updated = updateSmartTemplateText(d, page.id, id, patch, templates);
                return {...updated, pages: updated.pages.map(item => item.id === page.id && item.canvas ? {...item, canvas: layoutSmartScene(item.canvas).scene} : item)};
              }, `${page.id}:smart-${patch.lines === undefined ? "copy" : "lines"}:${id}`)) {setIsolatedGroupId(null); setSelected([id]);}
            }}>{inspectorFor(selectedPhoto ? "photo" : "position", true)}</SmartLayoutPanel></>}
            {tab === "text" && (
              <>
                <button type="button" className="te-button te-primary te-full te-insert-text" onClick={()=>addText()}><PlusIcon size={18}/>Add a text box<span className="te-shortcut-hint">T</span></button>
                <div className="te-panel-heading"><h2>Text presets</h2></div>
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
              </>
            )}
            {tab === "elements" && (
              <>
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
                  Select a shape to see its fill, photo, and outline here. Select two or more shapes to use Merge shapes in the toolbar.
                </p>
                <div className="te-shape-picker">{([
                  ['triangle','M12 3 22 21H2Z'],['diamond','M12 2 22 12 12 22 2 12Z'],
                  ['polygon','M7 3H17L23 12 17 21H7L1 12Z'],['star','M12 2 15 9 23 10 17 15 19 23 12 18 5 23 7 15 1 10 9 9Z'],
                  ['arrow','M2 8H14V3L23 12 14 21V16H2Z'],
                ] as const).map(([shape,path])=><button key={shape} onClick={()=>addShape(shape)}><svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill="currentColor"/></svg>{shape[0].toUpperCase()+shape.slice(1)}</button>)}</div>
                <details className="te-drawer-details"><summary>Drawing & shape tools</summary><button className="te-button te-full" aria-pressed={pathTool} onClick={()=>{setPathTool(p=>!p);setNavigationMode("select");}}>Pen / path</button>
                <div className="te-pro-actions">{SHAPE_OPERATIONS.map(([operation,label])=><button key={operation} className="te-text-button" disabled={disabled||!canCombineShapeSelection(scene,selected)} onClick={()=>applyCommand(live=>combineShapes(live,selected,operation))}>{label}</button>)}</div>
                <button className="te-button te-full" onClick={()=>fileRef.current?.click()}>Import editable SVG</button></details>

              </>
            )}
            {tab === "templates" && (
              <>
                <p className="te-help">
                  {continuous ? "Add a template's first slide to the selected part of your panorama. Undo restores it." : "Apply a template to this page, then edit every element. Undo restores the previous page."}
                </p>
                <input className="te-drawer-search" aria-label="Search page templates" placeholder="Search templates" value={templateSearch} onChange={event=>setTemplateSearch(event.target.value)}/>
                {!templates.some(t=>t.name.toLowerCase().includes(templateSearch.toLowerCase()))&&<p className="te-help">{templates.length?"No matching templates. Try another name.":"Your templates will appear here. Save this design as a template from File."}</p>}
                <div className="te-canvas-templates">
                  {templates.filter(t=>t.name.toLowerCase().includes(templateSearch.toLowerCase())).map((t) => (
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
                addElement({...createCanvasElement("image", {name:asset.name, src:asset.src, fit:"contain", x:(continuous ? index * FRAME_WIDTH : 0)+(FRAME_WIDTH-width)/2, y:(canvasHeight-height)/2, width,height}),...brandAssetPhoto(asset),fit:"contain"});
              }} />}
            {tab === "layers" && <>
              {selected.length>0&&<button type="button" className="te-button te-full" onClick={()=>openInspector()}><EditorIcon name="position"/>Edit selected elements</button>}
              <LayersPanel scene={scene} selectedIds={selected} width={canvasWidth} height={canvasHeight} disabled={disabled}
              isolatedGroupId={isolatedGroupId??undefined} onEnterGroup={enterGroup} onExitGroup={()=>setIsolatedGroupId(null)}
              onGroupContextMenu={(event,id)=>openMenu(event,{label:scene.groups?.find(g=>g.id===id)?.name??'Group',items:[{id:'isolate',label:'Edit group',onSelect:()=>enterGroup(id)},{id:'group-lock',label:'Toggle lock',disabled:Boolean(isolatedGroupId)&&!groupMemberIds(scene,id).some(member=>isolatedIds?.has(member)),onSelect:()=>applyCommand(live=>setGroupLocked(live,id,!live.groups?.find(g=>g.id===id)?.locked))},{id:'group-hidden',label:'Toggle visibility',disabled:Boolean(isolatedGroupId)&&!groupMemberIds(scene,id).some(member=>isolatedIds?.has(member)),onSelect:()=>applyCommand(live=>setGroupHidden(live,id,!live.groups?.find(g=>g.id===id)?.hidden))}]})}
              onSelect={selectLayers} onChange={changeScene} onLocate={locateLayer}
              onContextMenu={(event, element) => canvasMenu(event, element.id)}
              onDuplicate={() => applyCommand((live) => duplicateSelection(live, selected,undefined,isolatedGroupId??undefined))}
              onDelete={() => applyCommand((live) => removeSelection(live, selected))} /></>}
            {tab === "caption" && (
              <>
                <label className="te-field">
                  Caption
                  <textarea
                    rows={10}
                    maxLength={2200}
                    placeholder="Write a caption for your post…"
                    value={design.caption}
                    onFocus={closeEditingHistory}
                    onBlur={closeEditingHistory}
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
            {tab === "page" && <div className="te-drawer-settings">
              <p className="te-help">{format.width} × {format.height} px · {design.pages.length} {design.pages.length===1?"page":"pages"}</p>
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
                value={design.customSize ? "custom" : design.format}
                onChange={(e) => {
                  const nextFormat = e.target.value as DesignFormat;
                  commit(d=>({...resizeDesignDocument(d,FORMATS[nextFormat],'contain'),format:nextFormat,customSize:undefined}));
                  setZoom(1);
                }}
              >
                {design.customSize&&<option value="custom">Custom · {format.width} × {format.height}</option>}
                {Object.entries(FORMATS).map(([id, f]) => (
                  <option key={id} value={id}>
                    {f.label} · {f.width} × {f.height}
                  </option>
                ))}
              </select>
            </label>
              <button className="te-button te-full" onClick={()=>{setWorkflowTab("resize");setWorkflowOpen(true);}}>Custom size & resize options</button>
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
                </div>          {continuous && <div className="te-continuous-tools">
            <span><strong>{design.pages.length} connected slides</strong> · Exported as separate PNGs</span>
            {selectedImage && <div className="te-span-tools">
              <label>From <select aria-label="Image start slide" value={Math.min(spanFrom, design.pages.length)} onChange={(event) => setSpanFrom(Number(event.target.value))}>{design.pages.map((item, i) => <option key={item.id} value={i + 1}>{i + 1}</option>)}</select></label>
              <label>Through <select aria-label="Image end slide" value={Math.max(Math.min(spanFrom, design.pages.length), Math.min(spanThrough, design.pages.length))} onChange={(event) => setSpanThrough(Number(event.target.value))}>{design.pages.map((item, i) => <option key={item.id} value={i + 1} disabled={i + 1 < Math.min(spanFrom, design.pages.length)}>{i + 1}</option>)}</select></label>
              <button className="te-text-button" disabled={disabled || selectedImage.locked} onClick={fillImageAcrossSlides}>Fill slides</button>
            </div>}
          </div>}
              {!editingMaster&&<PageAccessibilitySection design={design} page={page} disabled={disabled} onChange={patch=>commit(d=>({...d,pages:d.pages.map(item=>item.id===page.id?{...item,...patch}:item)}),`page-accessibility:${page.id}`)} onEditImage={(id,master)=>{setEditingMaster(master);setIsolatedGroupId(null);setSelected([id]);openPanel("style");}}/>}
            </div>}
            {tab === "view" && <div className="te-drawer-settings">
              <p className="te-help">Set up your workspace. Guides stay out of downloads.</p>
              <button className="te-button te-full" onClick={()=>setLayoutOpen(true)}>Rulers, guides & margins</button>
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
              <button className="te-button te-full" onClick={fitPage}>Fit design to screen</button>
              <button className="te-text-button" disabled={!selected.length} onClick={()=>{const bounds=sceneVisualBounds({background:'transparent',elements:scene.elements.filter(e=>selected.includes(e.id))});const node=workspaceRef.current;if(bounds&&node){setZoom(Math.max(.05,Math.min(32,Math.min(node.clientWidth/(bounds.width+80),node.clientHeight/(bounds.height+80))/fit)));zoomAnchor.current={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,screenX:node.clientWidth/2,screenY:node.clientHeight/2};}}}>Fit selected elements</button>
              <button className="te-text-button" onClick={()=>setShowShortcuts(true)}>Keyboard shortcuts</button>
            </div>}
            {tab === "style" && <>
              {(selectedPhoto||canCombineShapeSelection(scene,selected))&&<div className="te-element-actions te-element-grid">
                {selectedPhoto&&<button type="button" className="te-button te-context-action" aria-label="Crop selected photo" aria-pressed={cropImageId===selectedPhoto.id} disabled={disabled||!canEditElement(scene,selectedPhoto,"style")||!canEditElement(scene,selectedPhoto,"content")} onClick={()=>setCropImageId(cropImageId===selectedPhoto.id?null:selectedPhoto.id)}><EditorIcon name="crop"/>{cropImageId===selectedPhoto.id?"Done crop":"Crop photo"}</button>}
                {canCombineShapeSelection(scene,selected)&&<button type="button" className="te-button te-context-action" aria-label="Merge selected shapes" disabled={disabled} onClick={()=>applyCommand(live=>combineShapes(live,selected,"union"))}><EditorIcon name="merge"/>Merge shapes</button>}
              </div>}
              {inspector}
              {!selected.length&&<div className="te-context-empty-actions"><button type="button" className="te-button te-full" onClick={()=>addText()}><TextIcon/>Add text</button><button type="button" className="te-button te-full" onClick={()=>openPanel("elements")}><PlusIcon/>Add a shape</button><button type="button" className="te-button te-full" onClick={()=>fileRef.current?.click()}><ImageIcon/>Upload photo</button></div>}
            </>}
          </fieldset>
          </section>}
        </aside>
        <main className="te-canvas-column">
          <div className="te-editor-toolbar">
          <div className="te-canvas-tools" role="toolbar" aria-label="Canvas tools">
            <button type="button" aria-pressed={navigationMode==="select"&&!pathTool} aria-label="Select" title="Select · V" onClick={()=>{setNavigationMode("select");setPathTool(false);}}><EditorIcon name="select"/><span>Select</span></button>
            <button type="button" aria-pressed={navigationMode==="hand"} aria-label="Hand" title="Pan canvas · H" onClick={()=>{setNavigationMode("hand");setPathTool(false);setCropImageId(null);}}><EditorIcon name="hand"/><span>Hand</span></button>
            <button type="button" disabled={disabled} aria-pressed={pathTool||navigationMode==="nodes"} aria-label="Drawing tools" aria-haspopup="menu" title="Drawing tools" onClick={event=>openMenu(event,{label:"Drawing tools",items:[
              {id:"pen",label:pathTool?"Stop drawing":"Draw a path",shortcut:"P",onSelect:()=>{setPathTool(value=>!value);setNavigationMode("select");setCropImageId(null);}},
              {id:"nodes",label:navigationMode==="nodes"?"Finish editing points":"Edit shape points",shortcut:"A",disabled:selected.length!==1||!scene.elements.some(element=>element.id===selected[0]&&element.type==="shape"&&canEditElement(scene,element,"style")&&canEditElement(scene,element,"position")),onSelect:()=>{setNavigationMode(value=>value==="nodes"?"select":"nodes");setPathTool(false);}},
            ]})}><EditorIcon name={navigationMode==="nodes"?"nodes":"pen"}/><span>{navigationMode==="nodes"?"Points":"Draw"}</span><span aria-hidden>⌄</span></button>
            {pathTool&&<>
              <label><input type="checkbox" checked={penClosed} onChange={event=>setPenClosed(event.target.checked)}/>Close path</label>
              <span className="te-pen-point-status" role="status">{penPointCount} points · Tap canvas to add</span>
              <button type="button" disabled={disabled||penPointCount<2} onClick={()=>drawingControls.current?.finish()}>Finish path</button>
              <button type="button" disabled={disabled||!penPointCount} onClick={()=>drawingControls.current?.removeLast()}>Remove last point</button>
              <button type="button" onClick={()=>drawingControls.current?.cancel()}>Cancel path</button>
            </>}
          </div>
          {navigationMode==="nodes"&&!pathTool&&<div className="te-node-toolbar-host" ref={setNodeToolbarHost}/>}
          {!pathTool&&navigationMode==="select"&&<QuickToolbar scene={scene} selectedIds={selected} disabled={disabled} onChange={changeScene} templateDraftHeight={isTemplateDraft&&!editingMaster&&!continuous?canvasHeight:undefined}
            outputScale={format.width/FRAME_WIDTH}
            onFormatText={formatText}
            onTextTexture={openTextTexture}
            onBackground={()=>openPanel("page")}
            onEdit={()=>openInspector()}
            onPosition={()=>openInspector("position")}
            onInspect={openInspector}
            activeSection={tab==="style"?inspectorSection:null}
            onReplacePhoto={()=>{if(selected.length===1){replaceTargetRef.current=selected[0];replaceFileRef.current?.click();}}}
            onUnlock={()=>applyCommand(live=>setSelectionLocked(live,selected,false))}
            onCrop={selectedPhoto&&!disabled&&canEditElement(scene,selectedPhoto,"style")?()=>setCropImageId(cropImageId===selectedPhoto.id?null:selectedPhoto.id):undefined}
            cropping={Boolean(cropImageId)}
            onGroup={selected.length>1?()=>applyCommand(live=>groupSelection(live,selected,"Group",isolatedGroupId??undefined)):undefined}
            onMergeShapes={()=>applyCommand(live=>combineShapes(live,selected,"union"))}
            onDuplicate={() => applyCommand((live) => duplicateSelection(live, selected,undefined,isolatedGroupId??undefined))}
            onDelete={() => applyCommand((live) => removeSelection(live, selected))}
            onMore={(event) => selected.length ? openMenu(event, {label: "Selected elements", items: elementMenu(selected)}) : canvasMenu(event, null)}
            onAddText={() => addText()} onUpload={() => fileRef.current?.click()} />}
          <div className="te-text-toolbar-host" ref={setTextToolbarHost}/>
          </div>
          {(editingMaster||isolatedGroupId||cropImageId)&&<div className="te-isolation-bar"><span>{editingMaster?'Editing shared master':isolatedGroupId?`Inside ${scene.groups?.find(g=>g.id===isolatedGroupId)?.name??'group'}`:'Drag image to crop · Scroll to zoom image'}</span><button className="te-text-button" onClick={()=>{setEditingMaster(false);setIsolatedGroupId(null);setCropImageId(null);setSelected([]);}}>Done</button></div>}
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
                    peers={collaboration?.peers}
                    collaborationPageId={collaboration ? collaborationPageId : undefined}
                    onCursorChange={collaboration ? publishCursor : undefined}
                    onScenePreview={collaboration ? publishScenePreview : undefined}
                    onHistory={travel}
                    onRegisterHistoryBridge={registerHistoryBridge}
                    onHistoryBoundary={closeEditingHistory}
                    historyRevision={historyRevision}
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
                    navigationMode={navigationMode}
                    onExitNodeEditing={()=>setNavigationMode("select")}
                    nodeToolbarHost={nodeToolbarHost}
                    textToolbarHost={textToolbarHost}
                    onRequestCrop={id=>{setSelected([id]);setCropImageId(id);}}
                    penClosed={penClosed} penColor={brand.text}
                    onCancelDrawing={()=>setPathTool(false)}
                    onDrawingPointCount={setPenPointCount}
                    onRegisterDrawingControls={registerDrawingControls}
                    onPan={delta=>{const node=workspaceRef.current;if(node){node.scrollLeft-=delta.x;node.scrollTop-=delta.y;}}}
                    onZoom={gesture=>{const node=workspaceRef.current;if(!node)return;const bounds=node.getBoundingClientRect(),screenX=gesture.clientX-bounds.left,screenY=gesture.clientY-bounds.top;zoomAnchor.current={x:(node.scrollLeft+screenX)/scale-workspaceLeft,y:(node.scrollTop+screenY)/scale-workspaceTop,screenX,screenY};setZoom(value=>Math.max(.05,Math.min(32,value*gesture.factor)));}}
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
            <div className="te-page-navigation">
              <button className="te-text-button" aria-label="Show pages" aria-expanded={pagesVisible} aria-controls="te-editor-pages" onClick={()=>{if(compactPanelOpen){closePanel();setPagesOpen(true);}else setPagesOpen(open=>!open);}}><LayoutIcon size={16}/> Page {index+1} of {design.pages.length} <span aria-hidden="true">{pagesVisible?"⌄":"⌃"}</span></button>
              <button className="te-icon" aria-label="Add page" title="Add page" disabled={disabled||design.pages.length>=20} onClick={()=>addPage()}><PlusIcon size={17}/></button>
              <button className="te-text-button te-caption-trigger" onClick={()=>openPanel("caption",true)}>Caption</button>
              {outsideCount>0&&<button className="te-text-button te-parked-count" onClick={()=>openPanel("layers")}>{outsideCount} off canvas</button>}
            </div>
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
          {pagesVisible&&<section id="te-editor-pages" className="te-pages" aria-label="Carousel pages">
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
                    selectPage(p.id);
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
          </section>}
        </main>
      </div>
      {textureTarget&&<TextTextureDialog element={textureTarget.element} background={textureTarget.background} photos={textureTarget.photos} initialWords={textureTarget.words} disabled={disabled} onApply={applyWordTexture} onClose={()=>setTextureTarget(null)}/>}
      {layoutOpen&&<LayoutPanel scene={scene} width={canvasWidth} slideWidth={FRAME_WIDTH} height={canvasHeight} outputScale={format.width/FRAME_WIDTH} disabled={disabled} onChange={changeScene} onClose={()=>setLayoutOpen(false)}/>}
      {applyingTemplate&&<TemplateApplyDialog template={applyingTemplate} design={design} scene={scene} pageId={page.id} disabled={disabled} onChangeDesign={next=>{
        if(!currentTemplates.current.some(template=>template.id===applyingTemplate.id&&!template.deletedAt))throw new Error("This template was deleted. Restore it from Trash before applying it.");
        return commit(live=>applyDesignPatch(design,next,live));
      }} onChangeScene={changeScene} onClose={()=>setApplyingTemplateId(null)}/>}
      {workflowOpen&&<WorkflowPanel workspaceResources={workspaceLibrary&&onWorkspaceChange?<WorkspaceResourcesPanel library={workspaceLibrary} disabled={disabled} design={design} scene={scene} selected={selected} onChange={updateWorkspace} onUseStyle={(style,linked)=>insertSavedWorkspaceStyle(style,linked)} onUseComponent={(component,linked)=>insertSavedWorkspaceComponent(component,linked)}/>:undefined} initialTab={workflowTab} design={design} scene={scene} selected={selected} pageId={page.id} disabled={disabled} onChange={next=>commit(live=>applyDesignPatch(design,next,live))} onSceneChange={changeScene} onSelect={setSelected} onAddDesigns={onAddDesigns} canShare={saveStatus.startsWith("Saved")} onMakeMaster={()=>{const promotable=selected.filter(id=>{const element=scene.elements.find(e=>e.id===id);return element&&canEditElement(scene,element,'position')&&canEditElement(scene,element,'delete');});if(!promotable.length)return;if(changeScene({...scene,elements:scene.elements.map(e=>promotable.includes(e.id)?{...e,master:true}:e)})){setSelected([]);setIsolatedGroupId(null);setWorkflowOpen(false);setEditingMaster(true);}}} onEditMaster={()=>{setEditingMaster(true);setIsolatedGroupId(null);setSelected([]);setWorkflowOpen(false);}} onClose={()=>setWorkflowOpen(false)}/>}
      {exportDialog&&<ExportDialog design={design} pageId={page.id} disabled={disabled} issues={preflightIssues} onClose={()=>setExportDialog(false)} onExport={(options,pageIds)=>{void startExport(options,pageIds);}}/>}
      {preparingExport&&<button className="te-button te-export-cancel" onClick={()=>exportPreparation.current?.abort()}>Preparing images · Cancel</button>}
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
            {editorCommandHelp().map(({label,shortcut}) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
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
                if (page.id === removePageId) selectPage(design.pages.find((p) => p.id !== removePageId)!.id);
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
            .filter((p) => (!job.pageId || p.id === job.pageId)&&(!job.pageIds||job.pageIds.includes(p.id))).slice(exportPageIndex,exportPageIndex+1)
            .map((p) => (
              <DesignFrame key={p.id} design={job.design} page={p} outputScale={job.options?.format==='pdf'?pdfGeometry(formatDimensions(job.design).width,formatDimensions(job.design).height,job.options).rasterScale:job.options?.scale??formatDimensions(job.design).width/FRAME_WIDTH} bleed={job.options?.format==='pdf'?pdfGeometry(formatDimensions(job.design).width,formatDimensions(job.design).height,job.options).bleed/pdfGeometry(formatDimensions(job.design).width,formatDimensions(job.design).height,job.options).scale:0} />
            ))}
        </div>
      )}
    </div>
  );
}
