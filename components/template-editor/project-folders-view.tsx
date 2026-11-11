"use client";

import {useState} from "react";
import type {DesignDocument} from "@/lib/template-editor/model";
import {UNSORTED_PAGE_ID, UNSORTED_PAGE_NAME, designMonth, designPageId, type MonthFolder, type PageFolder, type ProjectPage} from "@/lib/template-editor/project-folders";
import {DesignPreview} from "./preview";
import {Modal} from "./controls";
import "./project-folders.css";

/** Up to three of a folder's most recently edited designs, as its cover. */
function FolderCover({designs}: {designs: DesignDocument[]}) {
  const latest = [...designs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  return <div className="te-folder-art" aria-hidden>
    {latest.length ? latest.map(design => <div key={design.id} className="te-folder-thumb"><DesignPreview design={design} page={design.pages[0]}/></div>)
      : <svg className="te-folder-empty" width="42" height="34" viewBox="0 0 42 34" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 6.5A3.5 3.5 0 0 1 5.5 3h9.2l4 4.5h17.8A3.5 3.5 0 0 1 40 11v16.5a3.5 3.5 0 0 1-3.5 3.5h-31A3.5 3.5 0 0 1 2 27.5Z"/></svg>}
  </div>;
}

const designsLabel = (count: number) => `${count} ${count === 1 ? "design" : "designs"}`;

export function PageFolderGrid({folders, designs, pages, monthName, onOpen}: {folders: PageFolder[]; designs: DesignDocument[]; pages: ProjectPage[]; monthName: string; onOpen: (pageId: string) => void}) {
  return <div className="te-template-grid te-folder-grid">
    {folders.map(folder => {
      const inside = designs.filter(design => designPageId(design, pages) === folder.id);
      return <article key={folder.id} className="te-template-card te-folder-card">
        <button type="button" className="te-template-open" onClick={() => onOpen(folder.id)} aria-label={`Open ${folder.name}, ${designsLabel(folder.count)}`}>
          <FolderCover designs={inside}/>
          <span className="te-card-name">{folder.name}</span>
          <span className="te-card-description">{folder.id === UNSORTED_PAGE_ID ? "Designs with no page" : folder.handle && folder.handle !== folder.name ? folder.handle : "Page"} · {designsLabel(folder.count)}{folder.currentMonthCount ? ` · ${folder.currentMonthCount} in ${monthName}` : ""}</span>
        </button>
      </article>;
    })}
  </div>;
}

export function MonthFolderGrid({months, designs, pageId, pages, onOpen}: {months: MonthFolder[]; designs: DesignDocument[]; pageId: string; pages: ProjectPage[]; onOpen: (month: string) => void}) {
  return <div className="te-template-grid te-folder-grid">
    {months.map(month => {
      const inside = designs.filter(design => designPageId(design, pages) === pageId && designMonth(design) === month.id);
      return <article key={month.id} className={`te-template-card te-folder-card${month.current ? " is-current" : ""}`}>
        <button type="button" className="te-template-open" onClick={() => onOpen(month.id)} aria-label={`Open ${month.label}, ${designsLabel(month.count)}`}>
          <FolderCover designs={inside}/>
          {month.current && <span className="te-folder-badge">This month</span>}
          <span className="te-card-name">{month.label}</span>
          <span className="te-card-description">{month.count ? designsLabel(month.count) : "Empty · new designs go here"}</span>
        </button>
      </article>;
    })}
  </div>;
}

export type Crumb = {label: string; onSelect?: () => void};
/** Projects › page › month. The last crumb is where you are; the back button goes up one level. */
export function ProjectBreadcrumbs({crumbs}: {crumbs: Crumb[]}) {
  if (crumbs.length < 2) return null;
  const parent = crumbs[crumbs.length - 2];
  return <nav className="te-project-crumbs" aria-label="Projects folders">
    <button type="button" className="te-crumb-back" onClick={parent.onSelect} aria-label={`Back to ${parent.label}`} title={`Back to ${parent.label}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>
    </button>
    <ol>
      {crumbs.map((crumb, index) => <li key={index}>
        {index < crumbs.length - 1 ? <button type="button" onClick={crumb.onSelect}>{crumb.label}</button> : <span aria-current="page">{crumb.label}</span>}
      </li>)}
    </ol>
  </nav>;
}

/** Moves one or more designs to another page, or to Unsorted. Their month stays the month they were made. */
export function MovePageDialog({count, name, current, pages, disabled, onMove, onClose}: {count: number; name?: string; current?: string; pages: ProjectPage[]; disabled: boolean; onMove: (pageId: string) => boolean | void; onClose: () => void}) {
  const [page, setPage] = useState(current ?? pages[0]?.id ?? UNSORTED_PAGE_ID);
  return <Modal title={name ? `Move “${name}”` : `Move ${count} ${count === 1 ? "design" : "designs"}`} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (!disabled && onMove(page) !== false) onClose(); }}>
      <label className="te-field">Page<select autoFocus value={page} onChange={event => setPage(event.target.value)}>
        {pages.map(item => <option key={item.id} value={item.id}>{item.name}{item.handle && item.handle !== item.name ? ` (${item.handle})` : ""}</option>)}
        <option value={UNSORTED_PAGE_ID}>{UNSORTED_PAGE_NAME}</option>
      </select></label>
      <p>{count === 1 ? "It stays" : "They stay"} in the month {count === 1 ? "it was" : "they were"} made.</p>
      <div className="te-modal-actions"><button type="button" className="te-button" onClick={onClose}>Cancel</button><button className="te-button te-primary" disabled={disabled}>Move</button></div>
    </form>
  </Modal>;
}
