"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  SearchIcon,
  PlusIcon,
  LayoutIcon,
  CopyIcon,
  ArrowRightIcon,
  StarIcon,
} from "@/components/engine/icons";
import {
  EMPTY_LIBRARY,
  FORMATS,
  editTemplateDesign,
  cloneDesign,
  designAsTemplate,
  libraryBrandKits,
  withBrandKits,
  parseLibrary,
  type DesignDocument,
  type DesignTemplate,
  type EditorLibrary,
} from "@/lib/template-editor/model";
import { useEditorLibrary } from "@/lib/template-editor/use-library";
import {RecoveryPanel} from "./recovery-panel";
import {reconcileLibraries} from "@/lib/template-editor/library-sync";
import {deleteLibraryTemplate, libraryTemplates, trashedTemplates} from "@/lib/template-editor/template-catalog";
import {LibraryTools, OrganizeDialog, LibraryTrash, DocumentVersions} from "./library-tools";
import {peekResearchTransfer, acknowledgeResearchTransfer} from "@/lib/template-editor/research-transfer";
import { ENGINE_FONT_VARS } from "@/app/admin/(tool)/engine/fonts";
import { DesignPreview } from "./preview";
import { DesignEditor } from "./design-editor";
import { Modal } from "./controls";
import { BrandWorkspace } from "./brand-workspace";
import { ContextMenuProvider, useContextMenu, type ContextMenuDefinition } from "./context-menu";
import {CreateDesignDialog} from "./create-design-dialog";
import {LibraryImportDialog} from "./library-import-dialog";
import {WorkspaceResourcesPanel} from "./workspace-resources-panel";
import {downloadPortableLibrary,readLibraryArchive} from "@/lib/template-editor/media-archive";
import {createLibraryDesign,selectedLibrary,bulkLibraryMetadata,bulkOrganizationMetadata,libraryFiltersForView,clearLibraryFiltersForView,matchesLibraryItem,sortLibraryItems,type CreationOptions,type SearchFilters,type LibraryItemKey} from "@/lib/template-editor/library-workflows";
import {useStudioNavigation} from "@/lib/template-editor/use-studio-navigation";
import {useLiveCollaboration} from "@/lib/template-editor/use-collaboration";
import {DESIGN_PRESETS,templateCreationOptions} from "@/lib/template-editor/creation-presets";
import {AgentAccessDialog} from "./agent-access-dialog";
import {sameDocumentContent} from "@/lib/template-editor/history";
import "./studio.css";
import "./library-workflows.css";
import "./workspace-flow.css";

function LibraryCard({ menu, children, selection }: { menu: ContextMenuDefinition; children: ReactNode; selection?: ReactNode }) {
  const { openMenu } = useContextMenu();
  return <article className="te-template-card" onContextMenu={(event) => openMenu(event, menu)}>
    {children}
    {selection}
    <button type="button" className="te-card-menu" aria-label={`Actions for ${menu.label}`} title={`Actions for ${menu.label}`} aria-haspopup="menu" onClick={(event) => openMenu(event, menu)}>⋯</button>
  </article>;
}

function WorkspaceMenu({ menu, label = "Library tools", primary = false }: { menu: ContextMenuDefinition; label?: string; primary?: boolean }) {
  const { openMenu } = useContextMenu();
  return <button type="button" className={`te-button ${primary ? "te-primary te-create-button" : "te-library-menu"}`} aria-label={label} aria-haspopup="menu" onClick={(event) => openMenu(event, menu)}>{primary && <PlusIcon size={17} />}{label === "Library tools" ? <><span className="te-menu-full-label">Library tools</span><span className="te-menu-short-label" aria-hidden>Library</span></> : label}<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="m3 4.5 3 3 3-3" /></svg></button>;
}

export function templatePreview(template: DesignTemplate): DesignDocument {
  return {
    ...template,
    id: template.id,
    name: template.name,
    templateId: template.id,
    format: template.format,
    pages: template.pages,
    ...(template.continuousCanvas ? { continuousCanvas: template.continuousCanvas } : {}),
    caption: "",
    createdAt: "",
    updatedAt: "",
  };
}

export default function TemplateStudio({workspaceScope}: {workspaceScope?: string}) {
  const {
    library,
    ready,
    status,
    error,
    setLibrary,
    retrySave,
    reloadServer,
    canEdit,
    scope: libraryScope,
    setLiveDocument,
    receiveLiveDocument,
    livePending,
    liveError,
    confirmedDocument,
  } = useEditorLibrary(workspaceScope);
  const navigation = useStudioNavigation(libraryScope,ready,library.designs,library.folders);
  const {view,setView,activeId,setActiveId}=navigation;
  const [creation,setCreation]=useState<{kind:"post"|"carousel"|"template";template?:DesignTemplate;preset?:string}|null>(null);
  const [importing,setImporting]=useState<{library:EditorLibrary;restoreMedia:(selected:EditorLibrary)=>Promise<void>}|null>(null);
  const [selectMode,setSelectMode]=useState(false),[selected,setSelected]=useState<LibraryItemKey[]>([]);
  const [bulkOpen,setBulkOpen]=useState(false),[bulkFolder,setBulkFolder]=useState<string|null>(null),[bulkTags,setBulkTags]=useState(''),[bulkReplace,setBulkReplace]=useState(false);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({folder: "", favorites: false, tag: ""});
  const [organize, setOrganize] = useState<{kind: "design" | "template"; id: string} | null>(null);
  const [recoveriesOpen, setRecoveriesOpen] = useState(false);
  const [agentAccessOpen, setAgentAccessOpen] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [category, setCategory] = useState("All templates");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<{
    kind: "design" | "template";
    id: string;
    name: string;
  } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [rename, setRename] = useState<{ kind: "design" | "template"; id: string; value: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const permission = useRef(canEdit);
  useEffect(() => { permission.current = canEdit; }, [canEdit]);
  const templates = libraryTemplates(library);
  const activeDesigns = library.designs.filter(design => !design.deletedAt);
  const categories = ["All templates", "My templates", ...new Set(templates.filter(template => !template.custom).map(template => template.category))];
  const selectedCategory = categories.includes(category) ? category : "All templates";
  const search = query.trim().toLowerCase();
  const effectiveFilters = libraryFiltersForView({ ...filters, folder:navigation.folder, tag: filters.tag.trim() }, view === "templates" ? "templates" : "designs");
  function changeFilters(next: SearchFilters) { navigation.setFolder(next.folder);setFilters({...next,folder:""}); }
  function clearGalleryFilters() { changeFilters(clearLibraryFiltersForView(filters, view === "templates" ? "templates" : "designs")); }
  const activeFilters = [
    effectiveFilters.folder ? {key: "folder", label: `Folder: ${library.folders?.find(folder => folder.id === effectiveFilters.folder)?.name ?? "Selected folder"}`} : null,
    effectiveFilters.favorites ? {key: "favorites", label: "Favorites"} : null,
    effectiveFilters.tag ? {key: "tag", label: `Tag: ${effectiveFilters.tag}`} : null,
    effectiveFilters.format ? {key: "format", label: effectiveFilters.format === "custom" ? "Custom sizes" : FORMATS[effectiveFilters.format].label} : null,
    effectiveFilters.purpose ? {key: "purpose", label: effectiveFilters.purpose === "post" ? "Posts" : "Templates / drafts"} : null,
    effectiveFilters.review ? {key: "review", label: {draft: "Draft", review: "In review", approved: "Approved"}[effectiveFilters.review]} : null,
  ].filter((filter): filter is {key: string; label: string} => filter !== null);
  const filterCount = activeFilters.length;
  function removeFilter(key: string) {
    if (key === "folder") navigation.setFolder("");
    else setFilters(current => ({...current, [key]: key === "favorites" ? false : ""}));
  }
  const gallerySort = view === "templates" && filters.sort === "created" ? "updated" : filters.sort ?? "updated";
  const filteredDesigns = sortLibraryItems(activeDesigns.filter(design=>matchesLibraryItem(design,effectiveFilters,search)),gallerySort);
  const filteredTemplates = sortLibraryItems(templates.filter(template=>matchesLibraryItem(template,effectiveFilters,search)&&(selectedCategory==="All templates"||(selectedCategory==="My templates"?template.custom:template.category===selectedCategory))),gallerySort);
  const filteredDrafts = selectedCategory === "My templates" ? filteredDesigns.filter(design => design.purpose === "template") : [];
  const trashCount = library.designs.filter(design => design.deletedAt).length + trashedTemplates(library).length;
  const active = library.designs.find((d) => d.id === activeId && !d.deletedAt);
  const lastVisibleDocument = useRef<DesignDocument | undefined>(undefined);
  const collaboration = useLiveCollaboration(active, libraryScope, {
    baselineDocument: confirmedDocument(active?.id),
    onDocument: (saved, visible, snapshot) => {
      lastVisibleDocument.current = visible;
      receiveLiveDocument(saved, visible, snapshot);
    },
    onPending: livePending,
    onError: liveError,
  });
  const collaborationReady = collaboration.ready;
  const submitCollaborationDocument = collaboration.submitDocument;
  useEffect(() => {
    setLiveDocument(collaboration.ready ? active?.id : undefined);
    return () => setLiveDocument(undefined);
  }, [active?.id, collaboration.ready, setLiveDocument]);
  useEffect(() => {
    const previous = lastVisibleDocument.current;
    lastVisibleDocument.current = active;
    if (collaborationReady && previous && active && previous.id === active.id && !sameDocumentContent(previous, active)) submitCollaborationDocument(previous, active);
  }, [active, collaborationReady, submitCollaborationDocument]);
  const organized = organize ? (organize.kind === "design" ? library.designs : library.templates).find(item => item.id === organize.id) : null;
  const statusText = {
    loading: "Opening workspace…",
    saving: "Saving…",
    saved: "Saved to cloud",
    local: "Saved on this computer",
    error: "Save needs attention",
    conflict: "Newer version available",
    offline: "Offline · edits kept in this browser",
  }[status];

  useEffect(() => {
    if (!ready || !canEdit) return;
    const timer = setTimeout(() => {
      const transfer = peekResearchTransfer(libraryScope);
      if (!transfer) return;
      const accepted = setLibrary(current => {
        if(current.designs.some(design=>design.id===transfer.id)) return current;
        if(current.designs.length>=150) throw new Error("The workspace is full. The Research transfer is kept; remove an older project, then retry.");
        return {...current,designs:[transfer,...current.designs]};
      });
      if(accepted){acknowledgeResearchTransfer(transfer.id);setView("designs");setActiveId(transfer.id);setMessage("Research content is ready to edit.");}
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, canEdit, library.designs.length, setLibrary, setActiveId, setView, libraryScope]);

  async function exportItem(item: DesignDocument | DesignTemplate, kind: "design" | "template") {
    try {await downloadPortableLibrary(selectedLibrary(library,[`${kind}:${item.id}`]),item.name);}catch(reason){setMessage(reason instanceof Error?reason.message:"Could not export this item.");}
  }
  function updateMetadata(kind: "design" | "template", id: string, metadata: Partial<DesignDocument>) {
    if (!permission.current) return false;
    const field = kind === "design" ? "designs" : "templates";
    return setLibrary(current => ({...current, [field]: current[field].map(item => item.id === id ? {...item, ...metadata, ...(kind === "design" ? {updatedAt: new Date().toISOString()} : {})} : item)}));
  }
  function addDocument(document: DesignDocument, sourceTemplateId?: string) {
    return setLibrary((current) => {
      if (sourceTemplateId && !libraryTemplates(current).some(template => template.id === sourceTemplateId)) throw new Error("This template was deleted. Restore it from Trash before using it.");
      if (current.designs.length >= 150) throw new Error("Your workspace has reached its 150-design limit.");
      return { ...current, designs: [document, ...current.designs] };
    });
  }

  function openTemplate(template:DesignTemplate){
    if(!permission.current)return;
    if(template.parameters?.length){setCreation({kind:"post",template});return;}
    try{createProject(templateCreationOptions(template,library));}catch(cause){setMessage(cause instanceof Error?cause.message:"Could not open this template.");}
  }
  function openBlankDesign(){if(permission.current)setCreation({kind:"post"});}
  function openCarousel(){if(permission.current)setCreation({kind:"carousel"});}
  function createProject(options:CreationOptions){
    const document=createLibraryDesign(library,options);
    const accepted=addDocument(document,options.template?.id);
    if(accepted){setView("designs");setQuery("");changeFilters({folder:"",favorites:false,tag:""});setActiveId(document.id);}return accepted;
  }
  function openTemplateEditor(template: DesignTemplate) {
    const draft = library.designs.find(
      (d) => d.purpose === "template" && d.editingTemplateId === template.id && !d.deletedAt,
    );
    if (draft) {
      setActiveId(draft.id);
      return;
    }
    if (!permission.current || library.designs.length >= 150) return;
    const document = editTemplateDesign(template);
    const accepted = addDocument(document, template.id);
    if (accepted !== false) setActiveId(document.id);
  }
  async function importLibrary(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value="";if(!file||!permission.current)return;try{const archive=await readLibraryArchive(file);const imported=parseLibrary(archive.library);if(!imported)throw new Error("This file is not a valid Engine workspace backup.");setMessage("");setImporting({library:imported,restoreMedia:archive.restoreMedia});}catch(reason){setMessage(reason instanceof Error?reason.message:"Could not read this backup.");}}
  async function backup(){try{await downloadPortableLibrary(library,"engine-workspace");}catch(reason){setMessage(reason instanceof Error?reason.message:"Could not export this workspace.");}}
  function toggleSelection(key:LibraryItemKey){setSelected(previous=>previous.includes(key)?previous.filter(item=>item!==key):[...previous,key]);}
  function selectionFor(key:LibraryItemKey){return selectMode?<label className="te-library-select"><input type="checkbox" aria-label={`Select ${key.split(':')[0]}`} checked={selected.includes(key)} onChange={()=>toggleSelection(key)}/>Select</label>:undefined;}
  const visibleKeys:LibraryItemKey[]=view==="designs"?filteredDesigns.map(item=>`design:${item.id}` as const):[...filteredDrafts.map(item=>`design:${item.id}` as const),...filteredTemplates.map(item=>`template:${item.id}` as const)];
  const selectedKeys=selected.filter(key=>key.startsWith('design:')?activeDesigns.some(item=>key===`design:${item.id}`):templates.some(item=>key===`template:${item.id}`));
  function bulkUpdate(metadata:Parameters<typeof bulkLibraryMetadata>[2]){
    let starterCopies=0;const replacements=new Map<LibraryItemKey,LibraryItemKey>();
    const accepted=setLibrary(current=>{const starters=libraryTemplates(current).filter(item=>!item.custom&&selectedKeys.includes(`template:${item.id}`));const result=bulkLibraryMetadata(current,selectedKeys,metadata,bulkReplace?'replace':'add');starterCopies=starters.length;starters.forEach((item,index)=>replacements.set(`template:${item.id}`,`template:${result.templates[current.templates.length+index].id}`));return result;});
    if(accepted){setMessage(`Updated ${selectedKeys.length} items.${starterCopies?` Copied ${starterCopies} starter ${starterCopies===1?'template':'templates'} to My templates.`:''}`);setBulkOpen(false);setSelected(previous=>previous.map(key=>replacements.get(key)??key));}return accepted;
  }
  function openBulkOrganization() { setBulkFolder(null);setBulkTags("");setBulkReplace(false);setBulkOpen(true); }

  function duplicateDesign(design: DesignDocument) {
    if (!permission.current) return;
    addDocument(cloneDesign(design));
  }
  function designMenu(design: DesignDocument): ContextMenuDefinition {
    return { label: design.name, items: [
      { id: "open", label: design.purpose === "template" ? "Continue editing template" : "Open design", onSelect: () => setActiveId(design.id) },
      { id: "favorite", label: design.favorite ? "Remove favorite" : "Add to favorites", disabled: !canEdit, onSelect: () => updateMetadata("design", design.id, {favorite: !design.favorite}) },
      { id: "organize", label: "Folder and tags…", disabled: !canEdit, onSelect: () => setOrganize({kind: "design", id: design.id}) },
      { id: "history", label: "Version history…", onSelect: () => setHistoryId(design.id) },
      { id: "export-document", label: "Export editable design…", onSelect: () => exportItem(design, "design") },
      { id: "rename", label: "Rename", disabled: !canEdit, onSelect: () => { if (permission.current) setRename({ kind: "design", id: design.id, value: design.name }); } },
      { id: "duplicate", label: "Duplicate design", disabled: !canEdit || library.designs.length >= 150, onSelect: () => duplicateDesign(design) },
      { id: "delete", label: design.purpose === "template" ? "Delete draft…" : "Delete design…", disabled: !canEdit, danger: true, separator: true, onSelect: () => { if (permission.current) setConfirm({ kind: "design", id: design.id, name: design.name }); } },
    ] };
  }
  function templateMenu(template: DesignTemplate): ContextMenuDefinition {
    return { label: template.name, items: [
      { id: "export-template", label: "Export editable template…", onSelect: () => exportItem(template, "template") },
      ...(template.custom ? [{id: "favorite", label: template.favorite ? "Remove favorite" : "Add to favorites", disabled: !canEdit, onSelect: () => updateMetadata("template", template.id, {favorite: !template.favorite})}, {id: "organize", label: "Folder and tags…", disabled: !canEdit, onSelect: () => setOrganize({kind: "template", id: template.id})}] : []),
      { id: "use", label: "Use template", disabled: !canEdit || library.designs.length >= 150, onSelect: () => openTemplate(template) },
      ...(template.custom ? [
        { id: "edit", label: "Edit template", disabled: !canEdit || library.designs.length >= 150, onSelect: () => openTemplateEditor(template) },
        { id: "rename", label: "Rename template", disabled: !canEdit, onSelect: () => { if (permission.current) setRename({ kind: "template" as const, id: template.id, value: template.name }); } },
      ] : []),
      { id: "duplicate", label: "Duplicate template", disabled: !canEdit || library.templates.length >= 80, onSelect: () => {
        if (!permission.current) return;
        const accepted = setLibrary((current) => {
          if (current.templates.length >= 80) throw new Error("Your workspace has reached its 80-template limit.");
          const source = libraryTemplates(current).find(item => item.id === template.id);
          if (!source) throw new Error("This template was deleted. Restore it from Trash before copying it.");
          const copy = designAsTemplate(templatePreview(source), `${source.name.slice(0, 95)} copy`);
          return { ...current, templates: [copy, ...current.templates] };
        });
        if (accepted === false) return;
        setCategory("My templates"); setMessage("Template copied to My templates.");
      } },
      { id: "delete", label: "Delete template…", disabled: !canEdit, danger: true, separator: true, onSelect: () => { if (permission.current) setConfirm({ kind: "template" as const, id: template.id, name: template.name }); } },
    ] };
  }
  const createMenu: ContextMenuDefinition = { label: "Create", items: [
    { id: "new-design", label: "Blank post", disabled: !canEdit || library.designs.length >= 150, onSelect: openBlankDesign },
    { id: "new-carousel", label: "Carousel", disabled: !canEdit || library.designs.length >= 150, onSelect: openCarousel },
    { id: "new-template", label: "Reusable template…", disabled: !canEdit || library.designs.length >= 150 || library.templates.length >= 80, onSelect: () => { if (permission.current) setCreation({kind:"template"}); } },
  ] };
  const libraryMenu: ContextMenuDefinition = { label: "Library tools", items: [
    { id: "agent-access", label: "Connect an AI agent…", disabled: !canEdit, onSelect: () => setAgentAccessOpen(true) },
    { id: "import", label: "Import backup…", disabled: !canEdit, onSelect: () => { if (permission.current) importRef.current?.click(); } },
    { id: "backup", label: "Export workspace backup", onSelect: backup },
    { id: "recoveries", label: "Browser recoveries…", separator: true, disabled: !libraryScope, onSelect: () => setRecoveriesOpen(true) },
    { id: "trash", label: trashCount ? `Trash (${trashCount})` : "Trash", onSelect: () => { setView("trash"); setQuery(""); } },
  ] };
  const workspaceMenu: ContextMenuDefinition = { label: "Workspace", items: [
    ...createMenu.items,
    { id: "templates", label: "Browse templates", separator: true, onSelect: () => { setView("templates"); setQuery(""); } },
    { id: "designs", label: "Projects", onSelect: () => { setView("designs"); setQuery(""); } },
    { id: "brand", label: "Brand kits", onSelect: () => setView("brand") },
    ...libraryMenu.items,
  ] };

  return (
    <ContextMenuProvider defaultMenu={workspaceMenu}>
    <div className={`gf-root te-root ${ENGINE_FONT_VARS}`}>
      <input type="file" ref={importRef} hidden accept="application/json,.json,.zip,application/zip" onChange={importLibrary} />
      {(error || status === "conflict") && (
        <div className="te-save-error" role="alert">
          <span>
            {error ||
              "Another window saved newer changes. Your edits are preserved locally."}
          </span>
          <button onClick={retrySave}>Retry</button>
          {status === "conflict" && (
            <button onClick={() => setConflictOpen(true)}>
              Load saved version
            </button>
          )}
          <button onClick={backup}>Download backup</button>
        </div>
      )}
      {!ready ? (
        <div className="gf-center">
          <p>Opening your workspace…</p>
        </div>
      ) : active ? (
        <DesignEditor
          workspaceScope={libraryScope}
          key={active.id}
          collaboration={{...collaboration, history: collaboration.ready ? collaboration.history : undefined}}
          design={active}
          currentPageId={navigation.pageId}
          onCurrentPageChange={navigation.setPageId}
          templates={templates}
          brand={library.brand}
          workspaceLibrary={library}
          onWorkspaceChange={setLibrary}
          brandKits={libraryBrandKits(library)}
          activeBrandKitId={library.activeBrandKitId}
          onSelectBrandKit={(id) => {
            if (!permission.current) return;
            setLibrary((current) => withBrandKits(current, libraryBrandKits(current), id));
          }}
          onSaveBrandAsset={(asset, kitId) => {
            if (!permission.current) return false;
            const kits = libraryBrandKits(library);
            const target = kits.find((kit) => kit.id === kitId);
            if (!target) throw new Error("This brand kit was removed. Choose another kit.");
            if (target.assets.length >= 40) throw new Error("This brand kit has reached its 40-asset limit.");
            return setLibrary((current) => {
              const currentKits = libraryBrandKits(current);
              const destination = currentKits.find((kit) => kit.id === kitId);
              if (!destination) throw new Error("This brand kit was removed. Choose another kit.");
              if (destination.assets.length >= 40) throw new Error("This brand kit has reached its 40-asset limit.");
              return withBrandKits(current, currentKits.map((kit) => kit.id === kitId ? { ...kit, assets: [...kit.assets, { ...asset, id: crypto.randomUUID() }] } : kit), current.activeBrandKitId);
            });
          }}
          onManageBrand={() => setView("brand")}
          saveStatus={statusText}
          canEdit={canEdit && collaboration.status !== "error"}
          onExit={() => {
            setView(active.purpose === "template" ? "templates" : "designs");
            if (active.purpose === "template") setCategory("My templates");
          }}
          onChange={(design) => {
            const before = lastVisibleDocument.current ?? active;
            const accepted = setLibrary((current) => ({
              ...current,
              designs: current.designs.map((d) =>
                d.id === design.id ? design : d,
              ),
            }));
            if (accepted && collaboration.ready) {lastVisibleDocument.current = design; collaboration.submitDocument(before, design);}
            return accepted;
          }}
          onAddDesigns={(documents) => setLibrary(current => { if (current.designs.length + documents.length > 150) throw new Error("This batch would exceed the 150-design limit."); return {...current, designs: [...documents, ...current.designs]}; })}
          onSaveTemplate={(template) => {
            let beforeDraft: DesignDocument | undefined, savedDraft: DesignDocument | undefined;
            const sourceId = active.purpose === "template" ? active.editingTemplateId : undefined;
            const existingId = library.templates.find(item => item.id === sourceId && !item.deletedAt)?.id;
            if (
              library.templates.length >= 80 &&
              !library.templates.some((t) => t.id === existingId)
            )
              throw new Error("Your library has reached 80 custom templates.");
            const accepted = setLibrary((current) => {
              const currentSourceId = current.templates.find(item => item.id === sourceId && !item.deletedAt)?.id;
              const savedTemplateId = currentSourceId ?? template.id;
              if (current.templates.length >= 80 && !currentSourceId) throw new Error("Your library has reached 80 custom templates.");
              if (active.purpose === "template" && collaboration.ready) {
                beforeDraft = current.designs.find(document => document.id === active.id);
                if (beforeDraft) savedDraft = {...beforeDraft, editingTemplateId: savedTemplateId};
              }
              return {
                ...current,
                templates: [
                  { ...template, id: savedTemplateId },
                  ...current.templates.filter((t) => t.id !== currentSourceId),
                ],
                designs: active.purpose === "template" && !collaboration.ready
                  ? current.designs.filter((d) => d.id !== active.id)
                  : current.designs.map(document => document.id === savedDraft?.id ? savedDraft! : document),
              };
            });
            if (accepted === false) throw new Error("This template could not be saved. Check the workspace save message.");
            if (beforeDraft && savedDraft) {lastVisibleDocument.current = savedDraft; collaboration.submitDocument(beforeDraft, savedDraft);}
            if (active.purpose === "template") {
              setView("templates");
              setCategory("My templates");
              setQuery("");
              setMessage(
                existingId
                  ? "Template updated. Existing posts keep their own content and styling."
                  : "Template created. Use it as the starting point for your next post.",
              );
            }
          }}
        />
      ) : (
        <div className="te-home">
          <header className="te-home-header">
            <a className="te-wordmark" href="/admin/engine" aria-label="Engine home">
              <span className="te-logo" aria-hidden>e.</span>
              <span>Engine</span>
            </a>
            <div className="te-header-right">
              <span className="te-save-status" role="status" title={statusText}>
                <span className="te-status-dot" />{statusText}
              </span>
              <WorkspaceMenu menu={libraryMenu} />
              <button className="te-button te-primary te-create-design" disabled={!canEdit || library.designs.length >= 150} onClick={openBlankDesign}><PlusIcon size={17}/><span>Create a design</span></button>
            </div>
          </header>
          <div className="te-home-shell">
            <aside className="te-home-sidebar">
              <nav aria-label="Workspace">
                {([
                  ["designs", "Projects", CopyIcon],
                  ["templates", "Templates", LayoutIcon],
                  ["brand", "Brand", StarIcon],
                  ["resources", "Saved elements", LayoutIcon],
                ] as const).map(([id, label, Icon]) => <button key={id} className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); setQuery(""); }}>
                  <Icon size={19} /><span className="te-nav-label">{label}</span>
                  {id === "designs" && activeDesigns.length > 0 && <span className="te-nav-count">{activeDesigns.length}</span>}
                </button>)}
              </nav>
              <div className="te-sidebar-shortcuts">
                <button type="button" className={filters.favorites ? "is-active" : ""} onClick={()=>{setView("designs");setQuery("");changeFilters({folder:"",favorites:!filters.favorites,tag:""});}}><StarIcon size={17}/>Starred</button>
                {!!library.folders?.length&&<details open><summary>Folders</summary>{library.folders.map(folder=><button type="button" key={folder.id} className={navigation.folder===folder.id?"is-active":""} onClick={()=>{setView("designs");setQuery("");changeFilters({folder:folder.id,favorites:false,tag:""});}}><span aria-hidden>▱</span>{folder.name}</button>)}</details>}
                <button type="button" onClick={()=>setView("trash")}>Trash{trashCount>0&&<span>{trashCount}</span>}</button>
              </div>
              <div className="te-sidebar-bottom">
                <a href="/admin/engine/research">Research<ArrowRightIcon size={16} /></a>
              </div>
            </aside>
            <main className="te-home-main">
              {navigation.notice&&<div className="te-notice" role="status">{navigation.notice}<button onClick={()=>navigation.setNotice("")} aria-label="Dismiss">×</button></div>}
              {message && <div className="te-notice" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss notification">×</button></div>}
              {(view === "templates" || view === "designs") && <>
                {view==="designs"&&!search&&!filterCount&&<section className="te-start-design" aria-label="Create a design">
                  <div className="te-start-heading"><h2>What will you create?</h2><button className="te-text-button" disabled={!canEdit} onClick={()=>setCreation({kind:"post",preset:"custom"})}>Custom size</button></div>
                  <div className="te-start-formats">{DESIGN_PRESETS.map(preset=><button type="button" key={preset.id} disabled={!canEdit||library.designs.length>=150} onClick={()=>setCreation({kind:"post",preset:preset.id})}><span className="te-format-icon" style={{aspectRatio:`${preset.width}/${preset.height}`}}/><span><strong>{preset.name}</strong><small>{preset.width} × {preset.height}</small></span><PlusIcon size={16}/></button>)}</div>
                </section>}
                <div className="te-gallery-heading">
                  <div>
                    <h1>{view === "designs" ? "Projects" : "Templates"}</h1>
                    <p>{view === "designs" ? "All your designs in one place" : "Choose a layout and make it your own"}</p>
                  </div>
                  <div className="te-gallery-controls">{view==="templates"&&<button className="te-button" disabled={!canEdit||library.templates.length>=80} onClick={()=>setCreation({kind:"template"})}><PlusIcon size={16}/>New template</button>}
                    <label className="te-search">
                      <SearchIcon size={17} />
                      <input aria-label={view === "designs" ? "Search projects" : "Search templates"} placeholder={view === "designs" ? "Search projects" : "Search templates"} value={query} onChange={event => setQuery(event.target.value)} />
                      {query && <button type="button" className="te-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>×</button>}
                    </label>
                    <button type="button" className={`te-button te-filter-toggle ${filterCount ? "has-filters" : ""}`} aria-expanded={filtersOpen} aria-controls="te-gallery-filters" onClick={() => setFiltersOpen(value => !value)}>
                      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><path d="M2 4.5h13M2 8.5h13M2 12.5h13" /><circle cx="6" cy="4.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="11" cy="8.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="6" cy="12.5" r="1.5" fill="currentColor" stroke="none" /></svg>
                      Filters{filterCount > 0 && <span>{filterCount}</span>}
                    </button>
                  </div>
                </div>
                <div id="te-gallery-filters" className="te-gallery-filters" hidden={!filtersOpen}>
                  <LibraryTools library={library} filters={{...filters,folder:navigation.folder}} onFilters={changeFilters} canEdit={canEdit} onChange={setLibrary} />
                  <div className="te-library-extra-filters">
                    <label>Format<select value={filters.format??""} onChange={event=>setFilters({...filters,format:event.target.value as SearchFilters['format']})}><option value="">All formats</option>{Object.entries(FORMATS).map(([id,format])=><option key={id} value={id}>{format.label}</option>)}<option value="custom">Custom sizes</option></select></label>
                    {view === "designs" && <>
                      <label>Type<select value={filters.purpose??""} onChange={event=>setFilters({...filters,purpose:event.target.value as SearchFilters['purpose']})}><option value="">Posts and templates</option><option value="post">Posts</option><option value="template">Templates / drafts</option></select></label>
                      <label>Review<select value={filters.review??""} onChange={event=>setFilters({...filters,review:event.target.value as SearchFilters['review']})}><option value="">Any status</option><option value="draft">Draft</option><option value="review">In review</option><option value="approved">Approved</option></select></label>
                    </>}
                  </div>
                  {filterCount > 0 && <button className="te-text-button" onClick={clearGalleryFilters}>Clear filters</button>}
                </div>
                {filterCount > 0 && <div className="te-active-filters" aria-label="Active filters">
                  {activeFilters.map(filter => <button key={filter.key} type="button" className="te-filter-chip" aria-label={`Remove ${filter.label} filter`} onClick={() => removeFilter(filter.key)}><span>{filter.label}</span><span aria-hidden>×</span></button>)}
                  <button type="button" className="te-text-button" onClick={clearGalleryFilters}>Clear all</button>
                </div>}
                {view === "templates" && <div className="te-filter-row" aria-label="Template categories">
                  {categories.map(item => <button key={item} className={selectedCategory === item ? "is-active" : ""} aria-pressed={selectedCategory === item} onClick={() => setCategory(item)}>{item}</button>)}
                </div>}
                <div className="te-gallery-summary" aria-live="polite">
                  <span>{view === "designs" ? `${filteredDesigns.length} ${filteredDesigns.length === 1 ? "project" : "projects"}` : `${filteredTemplates.length + filteredDrafts.length} ${filteredTemplates.length + filteredDrafts.length === 1 ? "template" : "templates"}`}</span>
                  <button className={`te-text-button te-selection-toggle${selectMode?" is-active":""}`} aria-pressed={selectMode} onClick={()=>{setSelectMode(!selectMode);if(selectMode)setSelected([]);}}>{selectMode?"Done selecting":"Select"}</button>
                  <label className="te-gallery-sort"><span>Sort</span><select aria-label="Sort library" value={gallerySort} onChange={event=>setFilters({...filters,sort:event.target.value as SearchFilters['sort']})}><option value="updated">{view === "templates" ? "Library order" : "Recently edited"}</option><option value="name">Name A–Z</option>{view === "designs" && <option value="created">Newest first</option>}<option value="pages">Most pages</option></select></label>
                </div>
                <div className="te-bulk-bar" hidden={!selectMode}>{selectMode&&<><button className="te-text-button" onClick={()=>setSelected([...new Set([...selected,...visibleKeys])])}>Select visible</button><button className="te-text-button" onClick={()=>setSelected([])}>Clear selection</button><span>{selectedKeys.length} selected</span><button className="te-button" disabled={!canEdit||!selectedKeys.length} onClick={openBulkOrganization}>Folder and tags…</button><button className="te-button" disabled={!canEdit||!selectedKeys.length} onClick={()=>bulkUpdate({favorite:true})}>Favorite</button><button className="te-text-button" disabled={!canEdit||!selectedKeys.length} onClick={()=>bulkUpdate({favorite:false})}>Unfavorite</button><button className="te-button" disabled={!selectedKeys.length} onClick={async()=>{try{await downloadPortableLibrary(selectedLibrary(library,selectedKeys),'engine-selection');}catch(reason){setMessage(reason instanceof Error?reason.message:'Export failed.');}}}>Export selected</button></>}</div>
                {view === "templates" ? <>
                  <div className="te-template-grid">
                    {filteredDrafts.map(draft => <LibraryCard menu={designMenu(draft)} key={draft.id} selection={selectionFor(`design:${draft.id}`)}>
                      <button className="te-template-open" onClick={() => selectMode?toggleSelection(`design:${draft.id}`):setActiveId(draft.id)} aria-label={`Continue editing ${draft.name}`}>
                        <div className="te-template-art"><DesignPreview design={draft} page={draft.pages[0]} /><span className="te-page-count">Template draft</span></div>
                        <span className="te-card-name">{draft.name}</span><span className="te-card-description">Continue editing</span>
                      </button>
                    </LibraryCard>)}
                    {filteredTemplates.map(template => <LibraryCard menu={templateMenu(template)} key={template.id} selection={selectionFor(`template:${template.id}`)}>
                      <button className="te-template-open" disabled={!selectMode&&(!canEdit || library.designs.length >= 150)} onClick={() => selectMode?toggleSelection(`template:${template.id}`):openTemplate(template)} aria-label={`Use ${template.name} template`}>
                        <div className="te-template-art">
                          <DesignPreview design={templatePreview(template)} page={template.pages[0]} />
                          {template.pages.length > 1 && <span className="te-page-count">{template.pages.length} pages</span>}
                          <span className="te-card-action">Use template<ArrowRightIcon size={15} /></span>
                        </div>
                        <span className="te-card-name">{template.favorite ? "★ " : ""}{template.name}</span>
                        <span className="te-card-description">{/^@?chatgptricks$/i.test(template.name.trim()) ? "Smart template" : template.custom ? "Your template" : template.category} · {FORMATS[template.format].label}</span>
                      </button>
                    </LibraryCard>)}
                  </div>
                  {!filteredTemplates.length && !filteredDrafts.length && <div className="te-empty">
                    <LayoutIcon size={30} /><h2>{search || filterCount ? "No matching templates" : selectedCategory === "My templates" ? "Make a template of your own" : "Your next layout starts here"}</h2>
                    <p>{search || filterCount ? "Try another search or clear your filters" : "Create a reusable template, or restore one from Trash"}</p>
                    {search || filterCount ? <button className="te-button" onClick={() => {setQuery("");clearGalleryFilters();setCategory("All templates");}}>Clear search and filters</button> : <button className="te-button te-primary" disabled={!canEdit || library.designs.length >= 150 || library.templates.length >= 80} onClick={() => setCreation({kind:"template"})}>Create template<PlusIcon size={16}/></button>}
                  </div>}
                </> : <>
                  <div className="te-template-grid">
                    {filteredDesigns.map(design => <LibraryCard menu={designMenu(design)} key={design.id} selection={selectionFor(`design:${design.id}`)}>
                      <button className="te-template-open" onClick={() => selectMode?toggleSelection(`design:${design.id}`):setActiveId(design.id)} aria-label={`Open ${design.name}`}>
                        <div className="te-template-art">
                          <DesignPreview design={design} page={design.pages[0]} />
                          <span className="te-page-count">{design.purpose === "template" ? "Template draft" : `${design.pages.length} ${design.pages.length === 1 ? "page" : "pages"}`}</span>
                          <span className="te-card-action">Open project<ArrowRightIcon size={15}/></span>
                        </div>
                        <span className="te-card-name">{design.favorite ? "★ " : ""}{design.name}</span>
                        <span className="te-card-description">Edited {new Date(design.updatedAt).toLocaleDateString(undefined, {month:"short",day:"numeric"})}</span>
                      </button>
                    </LibraryCard>)}
                  </div>
                  {!filteredDesigns.length && <div className="te-empty">
                    <CopyIcon size={30}/><h2>{activeDesigns.length ? "No matching projects" : "Your ideas start here"}</h2>
                    <p>{activeDesigns.length ? "Try another search or clear your filters" : "Start with a template or choose Create for a blank post"}</p>
                    {activeDesigns.length ? <button className="te-button" onClick={() => {setQuery("");clearGalleryFilters();}}>Clear search and filters</button> : <button className="te-button te-primary" onClick={() => {setView("templates");setQuery("");changeFilters({folder:"",favorites:false,tag:""});setCategory("All templates");}}>Browse templates<ArrowRightIcon size={16}/></button>}
                  </div>}
                </>}
              </>}
              {view === "trash" && <>
                <button className="te-text-button te-library-back" onClick={() => setView("designs")}>← Back to Projects</button>
                <LibraryTrash library={library} canEdit={canEdit} onChange={setLibrary} />
              </>}
              {view === "resources" && <WorkspaceResourcesPanel library={library} disabled={!canEdit} onChange={setLibrary}/>}
              {view === "brand" && <BrandWorkspace library={library} canEdit={canEdit} onChange={setLibrary} />}
            </main>
          </div>
        </div>
      )}
      {creation&&<CreateDesignDialog library={library} kind={creation.kind} template={creation.template} preset={creation.preset} disabled={!canEdit} onCreate={createProject} onClose={()=>setCreation(null)}/>}
      {importing&&<LibraryImportDialog current={library} incoming={importing.library} restoreMedia={importing.restoreMedia} disabled={!canEdit} onImport={setLibrary} onComplete={setMessage} onClose={()=>setImporting(null)}/>}
      {bulkOpen && <Modal title={`Organize ${selectedKeys.length} items`} onClose={() => setBulkOpen(false)}>
        <form onSubmit={event => {event.preventDefault();bulkUpdate(bulkOrganizationMetadata(bulkFolder, bulkTags));}}>
          <p>Starter templates are copied into My templates when organized.</p>
          <label className="te-field">Folder<select value={bulkFolder === null ? "keep" : bulkFolder === "" ? "none" : `folder:${bulkFolder}`} onChange={event => setBulkFolder(event.target.value === "keep" ? null : event.target.value === "none" ? "" : event.target.value.slice(7))}>
            <option value="keep">Keep current folders</option><option value="none">No folder</option>
            {(library.folders ?? []).map(folder => <option key={folder.id} value={`folder:${folder.id}`}>{folder.name}</option>)}
          </select></label>
          <label className="te-field">Tags (comma separated)<input maxLength={800} value={bulkTags} onChange={event => setBulkTags(event.target.value)}/></label>
          <label className="te-dialog-check"><input type="checkbox" checked={bulkReplace} onChange={event => setBulkReplace(event.target.checked)}/>Replace existing tags</label>
          <div className="te-modal-actions"><button type="button" className="te-button" onClick={() => setBulkOpen(false)}>Cancel</button><button className="te-button te-primary" disabled={!canEdit}>Apply</button></div>
        </form>
      </Modal>}
      {rename && <Modal title={rename.kind === "template" ? "Rename template" : "Rename design"} onClose={() => setRename(null)}>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!permission.current || !rename.value.trim()) return;
          const accepted = setLibrary((current) => rename.kind === "design" ? { ...current, designs: current.designs.map((design) => design.id === rename.id ? { ...design, name: rename.value.trim(), updatedAt: new Date().toISOString() } : design) } : { ...current, templates: current.templates.map((template) => template.id === rename.id ? { ...template, name: rename.value.trim() } : template) });
          if (accepted === false) return;
          setRename(null);
        }}>
          <label className="te-field">Name<input autoFocus required maxLength={100} value={rename.value} onChange={(event) => setRename({ ...rename, value: event.target.value })} /></label>
          <div className="te-modal-actions"><button type="button" className="te-button" onClick={() => setRename(null)}>Cancel</button><button className="te-button te-primary" disabled={!canEdit || !rename.value.trim()}>Save name</button></div>
        </form>
      </Modal>}
      {confirm && (
        <Modal
          title={`Delete ${confirm.kind}?`}
          onClose={() => setConfirm(null)}
        >
          <p>“{confirm.name}” will move to Trash. You can restore it later.</p>
          <div className="te-modal-actions">
            <button className="te-button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="te-button te-primary"
              disabled={!canEdit}
              onClick={() => {
                if (!permission.current) return;
                const accepted = setLibrary((current) =>
                  confirm.kind === "design"
                    ? {
                        ...current,
                        designs: current.designs.map(d => d.id === confirm.id ? {...d, deletedAt: new Date().toISOString()} : d),
                      }
                    : deleteLibraryTemplate(current, confirm.id),
                );
                if (accepted === false) return;
                setConfirm(null);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {recoveriesOpen && <RecoveryPanel scope={libraryScope} canEdit={canEdit} onClose={() => setRecoveriesOpen(false)} onRestore={(draft,base) => {if (!permission.current) return false; const accepted = setLibrary(current => reconcileLibraries(base??EMPTY_LIBRARY, draft, current).library); if (accepted) {setView("designs");changeFilters({folder:"",favorites:false,tag:""});setMessage("Browser recovery restored. Divergent documents are kept as independent conflict copies.");} return accepted;}}/>}
      {organized && organize && <OrganizeDialog key={organized.id} item={organized} library={library} canEdit={canEdit} onClose={() => setOrganize(null)} onSave={metadata => updateMetadata(organize.kind, organize.id, metadata)}/>}
      {historyId && library.designs.find(item => item.id === historyId) && <DocumentVersions document={library.designs.find(item => item.id === historyId)!} canEdit={canEdit} onClose={() => setHistoryId(null)} onRestore={document => setLibrary(current => ({...current, designs: current.designs.map(item => item.id === document.id ? document : item)}))}/>}
      {agentAccessOpen && <AgentAccessDialog onClose={() => setAgentAccessOpen(false)} />}
      {conflictOpen && (
        <Modal
          title="Load the saved version?"
          onClose={() => setConflictOpen(false)}
        >
          <p>
            This replaces your local edits with the latest saved workspace.
            Download a backup first if you want to keep your current changes.
          </p>
          <div className="te-modal-actions">
            <button className="te-button" onClick={backup}>
              Download backup
            </button>
            <button
              className="te-button te-primary"
              onClick={() => {
                setActiveId(null);
                setConflictOpen(false);
                void reloadServer();
              }}
            >
              Load saved version
            </button>
          </div>
        </Modal>
      )}
    </div>
    </ContextMenuProvider>
  );
}
