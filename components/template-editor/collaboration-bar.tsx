"use client";

import { useState, type CSSProperties } from "react";
import { CopyIcon } from "@/components/engine/icons";
import { Modal } from "./controls";
import "./collaboration.css";

export type CollaborationPreviewElement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize?: number;
};
export type CollaborationPeer = {
  id: string;
  name: string;
  color: string;
  pageId?: string;
  selected: string[];
  cursor?: { x: number; y: number } | null;
  preview?: { elements: CollaborationPreviewElement[] } | null;
};
export type EditorCollaboration = {
  status: "connecting" | "live" | "reconnecting" | "offline" | "error";
  self: { id: string; name: string; color: string };
  peers: CollaborationPeer[];
  setAwareness: (value: {
    pageId?: string;
    selected?: string[];
    cursor?: { x: number; y: number } | null;
    preview?: { elements: CollaborationPreviewElement[] } | null;
  }) => void;
  setName?: (name: string) => void;
  shareLink?: string;
  history?: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
};

const statusLabels: Record<EditorCollaboration["status"], string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  error: "Connection needs attention",
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";
}

function Avatar({ person }: { person: { name: string; color: string } }) {
  return <span className="te-collaboration-avatar" style={{ "--te-peer-color": person.color } as CSSProperties} aria-hidden="true">{initials(person.name)}</span>;
}

export function CollaborationBar({ collaboration }: { collaboration: EditorCollaboration }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(collaboration.self.name);
  const [copyStatus, setCopyStatus] = useState("");
  const people = [{ ...collaboration.self, selected: [] as string[], self: true }, ...collaboration.peers.map(peer => ({ ...peer, self: false }))];
  const label = statusLabels[collaboration.status];
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(collaboration.shareLink ?? window.location.href);
      setCopyStatus("Editing link copied");
    } catch {
      setCopyStatus("Select the editing link below to copy it");
    }
  }
  return <>
    <button type="button" className={`te-collaboration-trigger is-${collaboration.status}`} aria-label="Live collaboration" aria-haspopup="dialog" title={`${label} · ${people.length} ${people.length === 1 ? "person" : "people"}`} onClick={() => { setName(collaboration.self.name); setCopyStatus(""); setOpen(true); }}>
      <span className="te-collaboration-status-dot" aria-hidden="true" />
      <span className="te-collaboration-status" role="status">{label}</span>
      <span className="te-collaboration-avatars">{people.slice(0, 3).map(person => <Avatar key={person.id} person={person} />)}</span>
      <span className="te-collaboration-count">{people.length}</span>
    </button>
    {open && <Modal title="Collaborate live" onClose={() => setOpen(false)}>
      <div className="te-collaboration-dialog">
        <p>Open this editing link together to work on the same post or template. Everyone with editing access to this workspace can join.</p>
        <div className="te-collaboration-link">
          <input aria-label="Editing link" readOnly value={collaboration.shareLink ?? window.location.href} onFocus={event => event.currentTarget.select()} />
          <button type="button" className="te-button te-primary" onClick={() => { void copyLink(); }}><CopyIcon size={15} />Copy link</button>
        </div>
        {copyStatus && <p className="te-help" role="status">{copyStatus}</p>}
        <div className={`te-collaboration-connection is-${collaboration.status}`} role="status"><span className="te-collaboration-status-dot" aria-hidden="true" />{label}{collaboration.status === "live" ? " · Changes appear for everyone as you edit" : " · Reconnect to see the latest collaborators"}</div>
        <ul className="te-collaboration-people" aria-label="People in this document">
          {people.map(person => <li key={person.id}><Avatar person={person} /><span>{person.name}{person.self && <small>You</small>}</span><span className="te-collaboration-person-state">{person.self ? "Editing" : person.selected.length ? "Selecting layers" : "In this document"}</span></li>)}
        </ul>
        {collaboration.setName && <form className="te-collaboration-name" onSubmit={event => { event.preventDefault(); const next = name.trim(); if (next) collaboration.setName?.(next); }}>
          <label>Your collaboration name<input aria-label="Your collaboration name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
          <button type="submit" className="te-button" disabled={!name.trim()}>Update name</button>
        </form>}
      </div>
    </Modal>}
  </>;
}
