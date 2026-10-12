"use client";
import {useEffect, useState} from "react";
import type {DesignDocument, DesignTemplate, EditorLibrary} from "@/lib/template-editor/model";
import type {DocumentHistoryEntry} from "@/lib/template-editor/persistence";
import {Modal} from "./controls";
import {purgeLibraryTemplate, restoreLibraryTemplate, trashedTemplates} from "@/lib/template-editor/template-catalog";
export type LibraryFilters = {folder: string; favorites: boolean; tag: string};
export function libraryMatches(item: DesignDocument | DesignTemplate, filters: LibraryFilters) { return !item.deletedAt && (!filters.folder || item.folderId === filters.folder) && (!filters.favorites || item.favorite) && (!filters.tag || (item.tags ?? []).some(tag => tag.toLowerCase().includes(filters.tag.toLowerCase()))); }
export function LibraryTools({library, filters, onFilters, canEdit, onChange}: {library: EditorLibrary; filters: LibraryFilters; onFilters: (value: LibraryFilters) => void; canEdit: boolean; onChange: (next: (value: EditorLibrary) => EditorLibrary) => boolean}) {
  const [foldersOpen, setFoldersOpen] = useState(false), [name, setName] = useState("");
  return <><div className="te-library-tools"><label>Folder<select value={filters.folder} onChange={event => onFilters({...filters, folder: event.target.value})}><option value="">All folders</option>{(library.folders ?? []).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label className="te-library-favorite"><input type="checkbox" checked={filters.favorites} onChange={event => onFilters({...filters, favorites: event.target.checked})}/> Favorites</label><label>Tag<input placeholder="Filter tags" value={filters.tag} onChange={event => onFilters({...filters, tag: event.target.value})}/></label><button className="te-button" disabled={!canEdit} onClick={() => setFoldersOpen(true)}>Manage folders</button></div>
    {foldersOpen && <Modal title="Folders" onClose={() => setFoldersOpen(false)}><form onSubmit={event => {event.preventDefault(); if (!canEdit || !name.trim()) return; if (onChange(current => ({...current, folders: [...(current.folders ?? []), {id: crypto.randomUUID(), name: name.trim().slice(0,100)}]}))) setName("");}}><label className="te-field">New folder<input required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label><button className="te-button te-primary" disabled={!canEdit || (library.folders?.length ?? 0) >= 80}>Add folder</button></form><ul className="te-folder-list">{(library.folders ?? []).map(folder => <li key={folder.id}><input aria-label={`Rename ${folder.name}`} defaultValue={folder.name} maxLength={100} disabled={!canEdit} onBlur={event => {const next = event.target.value.trim(); if (next && next !== folder.name) onChange(current => ({...current, folders: current.folders?.map(item => item.id === folder.id ? {...item, name: next} : item)}));}}/><button className="te-button" disabled={!canEdit} onClick={() => {if (!canEdit) return; onChange(current => ({...current, folders: current.folders?.filter(item => item.id !== folder.id), designs: current.designs.map(item => item.folderId === folder.id ? {...item, folderId: undefined} : item), templates: current.templates.map(item => item.folderId === folder.id ? {...item, folderId: undefined} : item)})); if (filters.folder === folder.id) onFilters({...filters, folder: ""});}}>Remove folder</button></li>)}</ul><p>Removing a folder keeps all its designs and templates.</p></Modal>}
  </>;
}
export function OrganizeDialog({item, library, canEdit, onClose, onSave}: {item: DesignDocument | DesignTemplate; library: EditorLibrary; canEdit: boolean; onClose: () => void; onSave: (metadata: {folderId?: string; tags: string[]; favorite: boolean}) => boolean}) {
  const [folder, setFolder] = useState(item.folderId ?? ""), [tags, setTags] = useState((item.tags ?? []).join(", ")), [favorite, setFavorite] = useState(Boolean(item.favorite));
  return <Modal title={`Organize ${item.name}`} onClose={onClose}><form onSubmit={event => {event.preventDefault(); if (!canEdit) return; const values = [...new Set(tags.split(",").map(tag => tag.trim().slice(0,40)).filter(Boolean))].slice(0,20); if (onSave({folderId: folder || undefined, tags: values, favorite})) onClose();}}><label className="te-field">Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option value="">No folder</option>{(library.folders ?? []).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label className="te-field">Tags, separated by commas<input value={tags} maxLength={800} onChange={event => setTags(event.target.value)}/></label><label><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)}/> Favorite</label><div className="te-modal-actions"><button type="button" className="te-button" onClick={onClose}>Cancel</button><button className="te-button te-primary" disabled={!canEdit}>Save</button></div></form></Modal>;
}
export function LibraryTrash({library, canEdit, onChange}: {library: EditorLibrary; canEdit: boolean; onChange: (next: (value: EditorLibrary) => EditorLibrary) => boolean}) {
  const items = [
    ...library.designs.filter(item => item.deletedAt).map(item => ({kind: "designs" as const, item})),
    ...trashedTemplates(library).map(item => ({kind: "templates" as const, item})),
  ];
  const [purge, setPurge] = useState<{kind: "designs" | "templates"; id: string; name: string} | null>(null);
  return <section className="te-library-trash">
    <h1>Trash</h1>
    <p>Restore deleted designs and templates, or permanently remove them to free workspace space.</p>
    {!items.length && <p>Trash is empty.</p>}
    {items.map(({kind,item}) => <article key={`${kind}:${item.id}`}>
      <div><strong>{item.name}</strong><p>{kind === "designs" ? "Design" : "Template"} · deleted {new Date(item.deletedAt!).toLocaleDateString()}</p></div>
      <button className="te-button" disabled={!canEdit} onClick={() => {
        if (!canEdit) return;
        onChange(current => kind === "templates"
          ? restoreLibraryTemplate(current, item.id)
          : {...current, designs: current.designs.map(value => value.id === item.id ? {...value, deletedAt: undefined} : value)});
      }}>Restore</button>
      <button className="te-button" disabled={!canEdit} onClick={() => setPurge({kind, id: item.id, name: item.name})}>Delete permanently…</button>
    </article>)}
    {purge && <Modal title="Permanently delete?" onClose={() => setPurge(null)}>
      <p>“{purge.name}” will be removed from the active workspace and cannot be restored from Trash. Download a backup first if you need it.</p>
      <div className="te-modal-actions">
        <button className="te-button" onClick={() => setPurge(null)}>Cancel</button>
        <button className="te-button te-primary" disabled={!canEdit} onClick={() => {
          if (!canEdit) return;
          if (onChange(current => purge.kind === "templates"
            ? purgeLibraryTemplate(current, purge.id)
            : {...current, designs: current.designs.filter(item => item.id !== purge.id)})) setPurge(null);
        }}>Delete permanently</button>
      </div>
    </Modal>}
  </section>;
}
export function DocumentVersions({document, canEdit, onClose, onRestore}: {document: DesignDocument; canEdit: boolean; onClose: () => void; onRestore: (document: DesignDocument) => boolean}) {
  const [versions, setVersions] = useState<DocumentHistoryEntry[]>([]), [message, setMessage] = useState("Loading versions…");
  useEffect(() => {const controller = new AbortController(); fetch(`/api/template-editor?history=1&documentId=${encodeURIComponent(document.id)}`, {signal: controller.signal}).then(async response => {const data = await response.json(); if (!response.ok) throw new Error(data.error); setVersions(data.versions ?? []); setMessage(data.versions?.length ? "" : "No earlier checkpoints yet. Autosave keeps checkpoints while you work.");}).catch(cause => {if (!controller.signal.aborted) setMessage(cause.message);}); return () => controller.abort();}, [document.id]);
  return <Modal title={`Version history · ${document.name}`} onClose={onClose}><p role="status">{message}</p><div className="te-version-list">{versions.map(version => <article key={version.id}><div><strong>{version.name}</strong><p>{new Date(version.createdAt).toLocaleString()} · {version.document.pages.length} pages</p></div><button className="te-button" disabled={!canEdit} onClick={() => {if (canEdit && onRestore({...version.document, id: document.id, versions: document.versions, updatedAt: new Date().toISOString()})) onClose();}}>Restore checkpoint</button></article>)}</div></Modal>;
}
