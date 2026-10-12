"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  SearchIcon,
  PlusIcon,
  LayoutIcon,
  CopyIcon,
  TrashIcon,
  DownloadIcon,
  ArrowRightIcon,
  StarIcon,
} from "@/components/engine/icons";
import {
  BUILT_IN_TEMPLATES,
  EMPTY_LIBRARY,
  FORMATS,
  createDesign,
  createBlankTemplateDesign,
  createBlankDesign,
  duplicatePage,
  sceneForPage,
  editTemplateDesign,
  cloneDesign,
  designAsTemplate,
  libraryBrandKits,
  withBrandKits,
  parseLibrary,
  type DesignDocument,
  type DesignTemplate,
  type DesignFormat,
} from "@/lib/template-editor/model";
import { useEditorLibrary } from "@/lib/template-editor/use-library";
import {RecoveryPanel} from "./recovery-panel";
import {reconcileLibraries} from "@/lib/template-editor/library-sync";
import {LibraryTools, OrganizeDialog, LibraryTrash, DocumentVersions, libraryMatches, type LibraryFilters} from "./library-tools";
import {consumeResearchTransfer} from "@/lib/template-editor/research-transfer";
import { saveBlob } from "@/lib/template-editor/export";
import { enableContinuousCarousel } from "@/lib/template-editor/continuous-carousel";
import { ENGINE_FONT_VARS } from "@/app/admin/(tool)/engine/fonts";
import { DesignPreview } from "./preview";
import { DesignEditor } from "./design-editor";
import { Modal } from "./controls";
import { BrandWorkspace } from "./brand-workspace";
import { ContextMenuProvider, useContextMenu, type ContextMenuDefinition } from "./context-menu";
import "./studio.css";

function LibraryCard({ menu, children }: { menu: ContextMenuDefinition; children: ReactNode }) {
  const { openMenu } = useContextMenu();
  return <article className="te-template-card" onContextMenu={(event) => openMenu(event, menu)}>
    {children}
    <button type="button" className="te-card-menu" aria-label={`Actions for ${menu.label}`} title={`Actions for ${menu.label}`} aria-haspopup="menu" onClick={(event) => openMenu(event, menu)}>⋯</button>
  </article>;
}

function WorkspaceMenu({ menu }: { menu: ContextMenuDefinition }) {
  const { openMenu } = useContextMenu();
  return <button type="button" className="te-icon te-workspace-menu" aria-label="Workspace actions" title="Workspace actions" aria-haspopup="menu" onClick={(event) => openMenu(event, menu)}>⋯</button>;
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
    documentEpochs,
    scope: libraryScope,
  } = useEditorLibrary(workspaceScope);
  const [view, setView] = useState<"templates" | "designs" | "brand" | "trash">(
    "templates",
  );
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>({folder: "", favorites: false, tag: ""});
  const [organize, setOrganize] = useState<{kind: "design" | "template"; id: string} | null>(null);
  const [recoveriesOpen, setRecoveriesOpen] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [category, setCategory] = useState("All templates");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<{
    kind: "design" | "template";
    id: string;
    name: string;
  } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [rename, setRename] = useState<{ kind: "design" | "template"; id: string; value: string } | null>(null);
  const [newTemplate, setNewTemplate] = useState<{
    name: string;
    format: DesignFormat;
    layout?: "separate" | "continuous";
    pageCount?: number;
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const permission = useRef(canEdit);
  useEffect(() => { permission.current = canEdit; }, [canEdit]);
  const templates = [...BUILT_IN_TEMPLATES, ...library.templates].filter(item => !item.deletedAt);
  const active = library.designs.find((d) => d.id === activeId && !d.deletedAt);
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
      const transfer = consumeResearchTransfer();
      if (!transfer) return;
      if (library.designs.length >= 150) { setMessage("The workspace is full. Remove an older design, then transfer the research again."); return; }
      const accepted = setLibrary(current => ({...current, designs: [transfer, ...current.designs]}));
      if (accepted) { setActiveId(transfer.id); setView("designs"); setMessage("Research images and caption are ready to edit as a post."); }
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, canEdit, library.designs.length, setLibrary]);

  function exportItem(item: DesignDocument | DesignTemplate, kind: "design" | "template") {
    const kit = libraryBrandKits(library).find(value => value.id === library.activeBrandKitId) ?? libraryBrandKits(library)[0];
    const bundle = {...EMPTY_LIBRARY, brand: library.brand, brandKits: [kit], activeBrandKitId: kit.id, ...(library.folders ? {folders: library.folders.filter(folder => folder.id === item.folderId)} : {}), designs: kind === "design" ? [item] : [], templates: kind === "template" ? [item] : library.templates.filter(template => template.id === (item as DesignDocument).templateId)};
    saveBlob(new Blob([JSON.stringify(bundle, null, 2)], {type: "application/json"}), `${item.name.replace(/[^a-z0-9]+/gi, "-").slice(0,70)}.engine.json`);
  }
  function updateMetadata(kind: "design" | "template", id: string, metadata: Partial<DesignDocument>) {
    if (!permission.current) return false;
    const field = kind === "design" ? "designs" : "templates";
    return setLibrary(current => ({...current, [field]: current[field].map(item => item.id === id ? {...item, ...metadata, ...(kind === "design" ? {updatedAt: new Date().toISOString()} : {})} : item)}));
  }
  function addDocument(document: DesignDocument) {
    return setLibrary((current) => {
      if (current.designs.length >= 150) throw new Error("Your workspace has reached its 150-design limit.");
      return { ...current, designs: [document, ...current.designs] };
    });
  }

  function openTemplate(template: DesignTemplate) {
    if (!permission.current || library.designs.length >= 150) return;
    const document = createDesign(template);
    document.pages = document.pages.map((p) => ({
      ...p,
      canvas: sceneForPage(p, document.format),
    }));
    const accepted = addDocument(document);
    if (accepted !== false) setActiveId(document.id);
  }
  function openBlankDesign() {
    if (!permission.current || library.designs.length >= 150) return;
    const document = createBlankDesign("Untitled design", "portrait");
    const accepted = addDocument(document);
    if (accepted !== false) setActiveId(document.id);
  }
  function openTemplateEditor(template: DesignTemplate) {
    const draft = library.designs.find(
      (d) => d.purpose === "template" && d.editingTemplateId === template.id,
    );
    if (draft) {
      setActiveId(draft.id);
      return;
    }
    if (!permission.current || library.designs.length >= 150) return;
    const document = editTemplateDesign(template);
    const accepted = addDocument(document);
    if (accepted !== false) setActiveId(document.id);
  }
  async function importLibrary(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !permission.current) return;
    try {
      if (file.size > 64 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 64 MB.");
      const imported = parseLibrary(JSON.parse(await file.text()));
      if (!permission.current) return;
      if (!imported)
        throw new Error("This file is not a valid Engine workspace backup.");
      if (
        library.designs.length + imported.designs.length > 150 ||
        library.templates.length + imported.templates.length > 80 ||
        libraryBrandKits(library).length + libraryBrandKits(imported).length > 20
      )
        throw new Error(
          "This backup would exceed the workspace limit. Export and remove older designs first.",
        );
      const folderIds = new Map((imported.folders ?? []).map(folder => [folder.id, crypto.randomUUID()]));
      const restoredFolders = (imported.folders ?? []).map(folder => ({...folder, id: folderIds.get(folder.id)!}));
      const templateIds = new Map(
        imported.templates.map((template) => [
          template.id,
          crypto.randomUUID(),
        ]),
      );
      const restoredTemplates = imported.templates.map((template) => ({
        ...template,
        id: templateIds.get(template.id)!,
        custom: true,
        deletedAt: undefined,
        ...(template.folderId ? {folderId: folderIds.get(template.folderId)} : {}),
      }));
      const restoredDesigns = imported.designs.map((design) => ({
        ...cloneDesign(design),
        ...(design.folderId ? {folderId: folderIds.get(design.folderId)} : {}),
        templateId: templateIds.get(design.templateId) ?? design.templateId,
        ...(design.purpose === "template"
          ? {
              purpose: "template" as const,
              editingTemplateId: design.editingTemplateId
                ? (templateIds.get(design.editingTemplateId) ??
                  design.editingTemplateId)
                : undefined,
            }
          : {}),
      }));
      const kitIds = new Map(libraryBrandKits(imported).map((kit) => [kit.id, crypto.randomUUID()]));
      const restoredKits = libraryBrandKits(imported).map((kit) => ({ ...kit, id: kitIds.get(kit.id)!, palette: [...kit.palette], assets: kit.assets.map((asset) => ({ ...asset, id: crypto.randomUUID() })) }));
      const accepted = setLibrary((current) => {
        if (!permission.current) throw new Error("This workspace is not currently editable.");
        if (current.designs.length + restoredDesigns.length > 150 || current.templates.length + restoredTemplates.length > 80 || libraryBrandKits(current).length + restoredKits.length > 20) throw new Error("This backup would exceed the workspace limit. Remove older items and try again.");
        if ((current.folders?.length ?? 0) + restoredFolders.length > 80) throw new Error("Import would exceed the 80-folder limit.");
        return withBrandKits({ ...current, folders: [...(current.folders ?? []), ...restoredFolders], designs: [...restoredDesigns, ...current.designs], templates: [...current.templates, ...restoredTemplates] }, [...libraryBrandKits(current), ...restoredKits], kitIds.get(imported.activeBrandKitId) ?? restoredKits[0].id);
      });
      if (accepted === false) return;
      setView("designs");
      setMessage(
        `Imported ${imported.designs.length} designs, ${imported.templates.length} templates, and ${restoredKits.length} brand kits.`,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Could not import that backup.",
      );
    }
  }
  function backup() {
    saveBlob(
      new Blob([JSON.stringify(library, null, 2)], {
        type: "application/json",
      }),
      "engine-workspace.json",
    );
  }

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
        const copy = designAsTemplate(templatePreview(template), `${template.name.slice(0, 95)} copy`);
        const accepted = setLibrary((current) => {
          if (current.templates.length >= 80) throw new Error("Your workspace has reached its 80-template limit.");
          return { ...current, templates: [copy, ...current.templates] };
        });
        if (accepted === false) return;
        setCategory("My templates"); setMessage("Template copied to My templates.");
      } },
      ...(template.custom ? [{ id: "delete", label: "Delete template…", disabled: !canEdit, danger: true, separator: true, onSelect: () => { if (permission.current) setConfirm({ kind: "template" as const, id: template.id, name: template.name }); } }] : []),
    ] };
  }
  const workspaceMenu: ContextMenuDefinition = { label: "Workspace", items: [
    { id: "new-design", label: "New design", disabled: !canEdit || library.designs.length >= 150, onSelect: openBlankDesign },
    { id: "new-template", label: "Create template", disabled: !canEdit || library.designs.length >= 150 || library.templates.length >= 80, onSelect: () => { if (permission.current) setNewTemplate({ name: "Untitled template", format: "portrait" }); } },
    { id: "templates", label: "Browse templates", separator: true, onSelect: () => { setView("templates"); setQuery(""); } },
    { id: "designs", label: "Your designs", onSelect: () => { setView("designs"); setQuery(""); } },
    { id: "brand", label: "Brand kits", onSelect: () => setView("brand") },
    { id: "recoveries", label: "Browser recoveries…", disabled: !libraryScope, onSelect: () => setRecoveriesOpen(true) },
    { id: "backup", label: "Download workspace backup", separator: true, onSelect: backup },
    { id: "import", label: "Import workspace backup…", disabled: !canEdit, onSelect: () => { if (permission.current) importRef.current?.click(); } },
  ] };

  return (
    <ContextMenuProvider defaultMenu={workspaceMenu}>
    <div className={`gf-root te-root ${ENGINE_FONT_VARS}`}>
      <input type="file" ref={importRef} hidden accept="application/json,.json" onChange={importLibrary} />
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
          key={`${active.id}:${documentEpochs[active.id] ?? 0}`}
          design={active}
          templates={templates}
          brand={library.brand}
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
          onManageBrand={() => { setActiveId(null); setView("brand"); }}
          saveStatus={statusText}
          canEdit={canEdit}
          onExit={() => {
            setActiveId(null);
            setView(active.purpose === "template" ? "templates" : "designs");
            if (active.purpose === "template") setCategory("My templates");
          }}
          onChange={(design) =>
            setLibrary((current) => ({
              ...current,
              designs: current.designs.map((d) =>
                d.id === design.id ? design : d,
              ),
            }))
          }
          onAddDesigns={(documents) => setLibrary(current => { if (current.designs.length + documents.length > 150) throw new Error("This batch would exceed the 150-design limit."); return {...current, designs: [...documents, ...current.designs]}; })}
          onSaveTemplate={(template) => {
            const existingId =
              active.purpose === "template"
                ? active.editingTemplateId
                : undefined;
            if (
              library.templates.length >= 80 &&
              !library.templates.some((t) => t.id === existingId)
            )
              throw new Error("Your library has reached 80 custom templates.");
            const accepted = setLibrary((current) => ({
              ...current,
              templates: [
                { ...template, id: existingId ?? template.id },
                ...current.templates.filter((t) => t.id !== existingId),
              ],
              designs:
                active.purpose === "template"
                  ? current.designs.filter((d) => d.id !== active.id)
                  : current.designs,
            }));
            if (accepted === false) throw new Error("This template could not be saved. Check the workspace save message.");
            if (active.purpose === "template") {
              setActiveId(null);
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
        <>
          <header className="te-home-header">
            <a className="te-wordmark" href="/admin/engine">
              <span className="te-logo" aria-hidden>
                e.
              </span>
              <span>
                Engine<span className="te-wordmark-sub">template studio</span>
              </span>
            </a>
            <div className="te-header-right">
              <WorkspaceMenu menu={workspaceMenu} />
              <span className="te-save-status" role="status">
                <span className="te-status-dot" />
                {statusText}
              </span>
              <button
                className="te-button te-new-design"
                onClick={openBlankDesign}
                disabled={!canEdit || library.designs.length >= 150}
              >
                <PlusIcon />
                New design
              </button>
              <button
                className="te-button te-primary"
                disabled={
                  !canEdit ||
                  library.designs.length >= 150 ||
                  library.templates.length >= 80
                }
                onClick={() =>
                  setNewTemplate({
                    name: "Untitled template",
                    format: "portrait",
                  })
                }
              >
                <PlusIcon />
                Create template
              </button>
            </div>
          </header>
          <div className="te-home-shell">
            <aside className="te-home-sidebar">
              <span className="te-eyebrow">WORKSPACE</span>
              <nav aria-label="Workspace">
                {(
                  [
                    ["templates", "Templates", LayoutIcon],
                    ["designs", "Your designs", CopyIcon],
                    ["brand", "Brand kits", StarIcon],
                    ["trash", "Trash", TrashIcon],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    className={view === id ? "is-active" : ""}
                    onClick={() => {
                      setView(id);
                      setQuery("");
                    }}
                  >
                    <Icon size={18} />
                    {label}
                    {id === "designs" && <span>{library.designs.filter(design => !design.deletedAt).length}</span>}
                  </button>
                ))}
              </nav>
              <div className="te-sidebar-bottom">
                <a href="/admin/engine/research">
                  Research workspace
                  <ArrowRightIcon size={15} />
                </a>
                <p>
                  A starting point for every
                  <br />
                  story you want to tell.
                </p>
              </div>
            </aside>
            <main className="te-home-main">
              {message && (
                <div className="te-notice" role="status">
                  {message}
                  <button
                    onClick={() => setMessage("")}
                    aria-label="Dismiss notification"
                  >
                    ×
                  </button>
                </div>
              )}
              {(view === "templates" || view === "designs") && <LibraryTools library={library} filters={filters} onFilters={setFilters} canEdit={canEdit} onChange={setLibrary}/>}
              {view === "trash" && <LibraryTrash library={library} canEdit={canEdit} onChange={setLibrary}/>}
              {view === "templates" && (
                <>
                  <section className="te-hero">
                    <div>
                      <span className="te-eyebrow">
                        LESS SETUP. MORE CREATING.
                      </span>
                      <h1>
                        Good posts start
                        <br />
                        with a great template.
                      </h1>
                      <p>
                        Pick a starting point. Make it yours.
                        <br />
                        Create something worth sharing.
                      </p>
                      <button
                        className="te-button te-primary"
                        onClick={() => openTemplate(BUILT_IN_TEMPLATES[0])}
                        disabled={!canEdit || library.designs.length >= 150}
                      >
                        Create a carousel
                        <ArrowRightIcon size={16} />
                      </button>
                    </div>
                    <div className="te-hero-art" aria-hidden>
                      <div>
                        <DesignPreview
                          design={templatePreview(BUILT_IN_TEMPLATES[1])}
                          page={BUILT_IN_TEMPLATES[1].pages[0]}
                        />
                      </div>
                      <div>
                        <DesignPreview
                          design={templatePreview(BUILT_IN_TEMPLATES[0])}
                          page={BUILT_IN_TEMPLATES[0].pages[0]}
                        />
                      </div>
                      <div>
                        <DesignPreview
                          design={templatePreview(BUILT_IN_TEMPLATES[2])}
                          page={BUILT_IN_TEMPLATES[2].pages[0]}
                        />
                      </div>
                    </div>
                  </section>
                  <div className="te-section-heading">
                    <div>
                      <h2>Find your starting point</h2>
                      <p>Defined layouts. Endless possibilities.</p>
                    </div>
                    <label className="te-search">
                      <SearchIcon />
                      <input
                        aria-label="Search templates"
                        placeholder="Search templates…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="te-filter-row">
                    {[
                      "All templates",
                      ...new Set(BUILT_IN_TEMPLATES.map((t) => t.category)),
                      "My templates",
                    ].map((item) => (
                      <button
                        key={item}
                        className={category === item ? "is-active" : ""}
                        onClick={() => setCategory(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="te-template-grid">
                    {category === "My templates" &&
                      library.designs
                        .filter((d) => d.purpose === "template" && libraryMatches(d, filters))
                        .map((draft) => (
                          <LibraryCard menu={designMenu(draft)} key={draft.id}>
                            <button
                              className="te-template-open"
                              onClick={() => setActiveId(draft.id)}
                            >
                              <div className="te-template-art">
                                <DesignPreview
                                  design={draft}
                                  page={draft.pages[0]}
                                />
                                <span className="te-page-count">
                                  TEMPLATE DRAFT
                                </span>
                                <span className="te-card-action">
                                  Continue editing
                                  <ArrowRightIcon size={15} />
                                </span>
                              </div>
                              <span className="te-card-name">{draft.name}</span>
                              <span className="te-card-description">
                                Your changes are autosaved. Save the template
                                when it’s ready.
                              </span>
                            </button>
                          </LibraryCard>
                        ))}
                    {category === "My templates" && (
                      <button
                        className="te-blank-template"
                        disabled={
                          !canEdit ||
                          library.designs.length >= 150 ||
                          library.templates.length >= 80
                        }
                        onClick={() =>
                          setNewTemplate({
                            name: "Untitled template",
                            format: "portrait",
                          })
                        }
                      >
                        <PlusIcon size={26} />
                        <strong>Create a template</strong>
                        <span>Start with a blank canvas</span>
                      </button>
                    )}
                    {templates
                      .filter(
                        (t) =>
                          libraryMatches(t, filters) &&
                          (category === "All templates" ||
                            (category === "My templates"
                              ? t.custom
                              : t.category === category)) &&
                          `${t.name} ${t.description} ${t.category}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      )
                      .map((template) => (
                        <LibraryCard menu={templateMenu(template)} key={template.id}>
                          <button
                            className="te-template-open"
                            disabled={!canEdit || library.designs.length >= 150}
                            onClick={() => openTemplate(template)}
                            aria-label={`Use ${template.name} template`}
                          >
                            <div className="te-template-art">
                              <DesignPreview
                                design={templatePreview(template)}
                                page={template.pages[0]}
                              />
                              <span className="te-card-action">
                                Use template
                                <ArrowRightIcon size={15} />
                              </span>
                              <span className="te-page-count">
                                {template.pages.length > 1
                                  ? `${template.pages.length} pages`
                                  : FORMATS[template.format].label}
                              </span>
                            </div>
                            <span className="te-card-name">
                              {template.favorite ? "★ " : ""}{template.name}
                            </span>
                            <span className="te-card-description">
                              {template.description}
                            </span>
                          </button>
                          {template.custom && (
                            <div className="te-design-actions">
                              <button
                                className="te-icon"
                                title="Edit template"
                                aria-label={`Edit ${template.name} template`}
                                disabled={
                                  !canEdit || library.designs.length >= 150
                                }
                                onClick={() => openTemplateEditor(template)}
                              >
                                <LayoutIcon />
                              </button>
                              <button
                                className="te-icon"
                                title="Delete template"
                                aria-label={`Delete ${template.name} template`}
                                disabled={!canEdit}
                                onClick={() =>
                                  setConfirm({
                                    kind: "template",
                                    id: template.id,
                                    name: template.name,
                                  })
                                }
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          )}
                        </LibraryCard>
                      ))}
                  </div>
                  {!(
                    category === "My templates" &&
                    library.designs.some((d) => d.purpose === "template")
                  ) &&
                    !templates.some(
                      (t) =>
                        (category === "All templates" ||
                          (category === "My templates"
                            ? t.custom
                            : t.category === category)) &&
                        `${t.name} ${t.description} ${t.category}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    ) && (
                      <div className="te-empty">
                        <LayoutIcon size={28} />
                        <h3>
                          {category === "My templates"
                            ? "Your next signature template starts here."
                            : "No templates found."}
                        </h3>
                        <p>
                          {category === "My templates"
                            ? "Choose Create template to build one from a blank canvas."
                            : "Try a different search or category."}
                        </p>
                      </div>
                    )}
                </>
              )}
              {view === "designs" && (
                <>
                  <div className="te-section-heading">
                    <div>
                      <span className="te-eyebrow">
                        PICK UP WHERE YOU LEFT OFF
                      </span>
                      <h1>Your designs</h1>
                      <p>Your posts, carousels, and ideas in progress.</p>
                    </div>
                    <div className="te-actions">
                      <button className="te-button" onClick={backup}>
                        <DownloadIcon />
                        Backup
                      </button>
                      <button
                        className="te-button"
                        disabled={!canEdit}
                        onClick={() => importRef.current?.click()}
                      >
                        Import backup
                      </button>
                    </div>
                  </div>
                  <label className="te-search te-design-search">
                    <SearchIcon />
                    <input
                      aria-label="Search designs"
                      placeholder="Find a design…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="te-template-grid">
                    {library.designs
                      .filter((d) =>
                        libraryMatches(d, filters) && `${d.name} ${(d.tags ?? []).join(" ")}`.toLowerCase().includes(query.toLowerCase()),
                      )
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .map((design) => (
                        <LibraryCard menu={designMenu(design)} key={design.id}>
                          <button
                            className="te-template-open"
                            onClick={() => setActiveId(design.id)}
                          >
                            <div className="te-template-art">
                              <DesignPreview
                                design={design}
                                page={design.pages[0]}
                              />
                              <span className="te-page-count">
                                {design.purpose === "template"
                                  ? "Template draft · "
                                  : ""}
                                {design.pages.length}{" "}
                                {design.pages.length === 1 ? "page" : "pages"}
                              </span>
                              <span className="te-card-action">
                                Open design
                                <ArrowRightIcon size={15} />
                              </span>
                            </div>
                            <span className="te-card-name">{design.favorite ? "★ " : ""}{design.name}</span>
                            <span className="te-card-description">
                              Edited{" "}
                              {new Date(design.updatedAt).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </span>
                          </button>
                          <div className="te-design-actions">
                            <button
                              className="te-icon"
                              title="Duplicate design"
                              aria-label={`Duplicate ${design.name}`}
                              disabled={
                                !canEdit || library.designs.length >= 150
                              }
                              onClick={() => duplicateDesign(design)}
                            >
                              <CopyIcon />
                            </button>
                            <button
                              className="te-icon"
                              title="Delete design"
                              aria-label={`Delete ${design.name}`}
                              disabled={!canEdit}
                              onClick={() =>
                                setConfirm({
                                  kind: "design",
                                  id: design.id,
                                  name: design.name,
                                })
                              }
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </LibraryCard>
                      ))}
                  </div>
                  {!library.designs.length && (
                    <div className="te-empty">
                      <CopyIcon size={32} />
                      <h3>Your first design is one template away.</h3>
                      <p>Choose a layout, add your words, and make it yours.</p>
                      <button
                        className="te-button te-primary"
                        onClick={() => setView("templates")}
                      >
                        Explore templates
                        <ArrowRightIcon />
                      </button>
                    </div>
                  )}
                  {library.designs.length > 0 &&
                    !library.designs.some((d) =>
                      d.name.toLowerCase().includes(query.toLowerCase()),
                    ) && (
                      <div className="te-empty">
                        <h3>No matching designs.</h3>
                        <p>Try another search.</p>
                      </div>
                    )}
                </>
              )}
              {view === "brand" && <BrandWorkspace library={library} canEdit={canEdit} onChange={setLibrary} />}
            </main>
          </div>
        </>
      )}
      {newTemplate && (
        <Modal title="Create a template" onClose={() => setNewTemplate(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !canEdit ||
                library.designs.length >= 150 ||
                library.templates.length >= 80
              )
                return;
              let document = createBlankTemplateDesign(
                newTemplate.name.trim() || "Untitled template",
                newTemplate.format,
              );
              if (newTemplate.layout === "continuous") {
                const count = Math.max(2, Math.min(20, Math.floor(newTemplate.pageCount ?? 2)));
                document = enableContinuousCarousel({
                  ...document,
                  pages: [document.pages[0], ...Array.from({ length: count - 1 }, () => duplicatePage(document.pages[0]))],
                });
              }
              const accepted = addDocument(document);
              if (accepted === false) return;
              setActiveId(document.id);
              setNewTemplate(null);
            }}
          >
            <p>
              Start with an empty canvas. Build individual slides, or one
              continuous composition with images that span across slides.
            </p>
            <label className="te-field">
              Template name
              <input
                autoFocus
                required
                maxLength={100}
                value={newTemplate.name}
                onChange={(event) =>
                  setNewTemplate({ ...newTemplate, name: event.target.value })
                }
              />
            </label>
            <fieldset className="te-format-options">
              <legend>Choose a format</legend>
              {Object.entries(FORMATS).map(([id, format]) => (
                <label
                  key={id}
                  className={newTemplate.format === id ? "is-active" : ""}
                >
                  <input
                    type="radio"
                    name="template-format"
                    value={id}
                    checked={newTemplate.format === id}
                    onChange={() =>
                      setNewTemplate({
                        ...newTemplate,
                        format: id as DesignFormat,
                      })
                    }
                  />
                  <span
                    className="te-format-shape"
                    style={{ aspectRatio: `${format.width}/${format.height}` }}
                  />
                  <strong>{format.label}</strong>
                  <small>
                    {format.width} × {format.height}
                  </small>
                </label>
              ))}
            </fieldset>
            <fieldset className="te-format-options" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 20 }}>
              <legend>Canvas layout</legend>
              <label className={newTemplate.layout !== "continuous" ? "is-active" : ""}>
                <input type="radio" name="template-layout" value="separate" checked={newTemplate.layout !== "continuous"} onChange={() => setNewTemplate({ ...newTemplate, layout: "separate" })} />
                <LayoutIcon size={24} />
                <strong>Separate slides</strong>
                <small>Design each slide on its own</small>
              </label>
              <label className={newTemplate.layout === "continuous" ? "is-active" : ""}>
                <input type="radio" name="template-layout" value="continuous" checked={newTemplate.layout === "continuous"} onChange={() => setNewTemplate({ ...newTemplate, layout: "continuous", pageCount: newTemplate.pageCount ?? 2 })} />
                <svg width="42" height="24" viewBox="0 0 42 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><rect x="1" y="2" width="40" height="20" rx="2" /><path d="M14 2v20m14-20v20" strokeDasharray="2 2" /><path d="m5 18 10-10 10 8 8-6 4 4" /></svg>
                <strong>Continuous carousel</strong>
                <small>One wide canvas across slides</small>
              </label>
            </fieldset>
            {newTemplate.layout === "continuous" && <label className="te-field" style={{ marginTop: 18 }}>
              Number of slides
              <select aria-label="Number of carousel slides" value={newTemplate.pageCount ?? 2} onChange={(event) => setNewTemplate({ ...newTemplate, pageCount: Number(event.target.value) })}>
                {Array.from({ length: 19 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} slides</option>)}
              </select>
              <span className="te-field-note">Export creates a separate {FORMATS[newTemplate.format].width} × {FORMATS[newTemplate.format].height} PNG for every slide.</span>
            </label>}
            <div className="te-modal-actions">
              <button
                className="te-button"
                type="button"
                onClick={() => setNewTemplate(null)}
              >
                Cancel
              </button>
              <button className="te-button te-primary" disabled={!canEdit}>
                Open template editor
                <ArrowRightIcon size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}
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
                    : {
                        ...current,
                        templates: current.templates.map(t => t.id === confirm.id ? {...t, deletedAt: new Date().toISOString()} : t),
                      },
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
      {recoveriesOpen && <RecoveryPanel scope={libraryScope} canEdit={canEdit} onClose={() => setRecoveriesOpen(false)} onRestore={draft => {if (!permission.current) return false; const accepted = setLibrary(current => reconcileLibraries(EMPTY_LIBRARY, draft, current).library); if (accepted) {setView("designs");setFilters({folder:"",favorites:false,tag:""});setMessage("Browser recovery restored. Divergent documents are kept as independent conflict copies.");} return accepted;}}/>}
      {organized && organize && <OrganizeDialog key={organized.id} item={organized} library={library} canEdit={canEdit} onClose={() => setOrganize(null)} onSave={metadata => updateMetadata(organize.kind, organize.id, metadata)}/>}
      {historyId && library.designs.find(item => item.id === historyId) && <DocumentVersions document={library.designs.find(item => item.id === historyId)!} canEdit={canEdit} onClose={() => setHistoryId(null)} onRestore={document => setLibrary(current => ({...current, designs: current.designs.map(item => item.id === document.id ? document : item)}))}/>}
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
