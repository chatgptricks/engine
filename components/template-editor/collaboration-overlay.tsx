"use client";

import type { CSSProperties } from "react";
import type { CanvasScene } from "@/lib/template-editor/model";
import { isElementHidden } from "@/lib/template-editor/commands";
import type { CollaborationPeer } from "./collaboration-bar";
import "./collaboration.css";

/** Awareness remains an editor overlay; it never enters document exports. */
export function CollaborationOverlay({ peers, pageId, scene, viewScale }: { peers: CollaborationPeer[]; pageId: string; scene: CanvasScene; viewScale: number }) {
  const scale = 1 / Math.max(.005, viewScale);
  const visible = peers.filter(peer => peer.pageId === pageId);
  if (!visible.length) return null;
  return <div className="te-collaboration-overlay" aria-label="Collaborator cursors and selections" style={{ "--te-peer-scale": scale } as CSSProperties}>
    {visible.map(peer => <div key={peer.id} className="te-collaboration-peer" data-collaboration-participant={peer.id} data-collaboration-name={peer.name} style={{ "--te-peer-color": peer.color } as CSSProperties}>
      {scene.elements.filter(element => peer.selected.includes(element.id) && !isElementHidden(scene, element)).map((element, index) => <div key={element.id} className="te-collaboration-selection" aria-label={`${peer.name} selected ${element.name || element.type}`} style={{ left: element.x, top: element.y, width: element.width, height: element.height, transform: `rotate(${element.rotation}deg)`, borderWidth: 1.5 * scale }}>
        {index === 0 && <span className="te-collaboration-selection-name">{peer.name}</span>}
      </div>)}
      {peer.cursor && Number.isFinite(peer.cursor.x) && Number.isFinite(peer.cursor.y) && <div className="te-collaboration-cursor" aria-label={`${peer.name}'s cursor`} style={{ left: peer.cursor.x, top: peer.cursor.y, transform: `scale(${scale})` }}>
        <svg width="19" height="24" viewBox="0 0 19 24" fill="none" aria-hidden="true"><path d="M1 1.5V20L6.5 14.5L10 22L13.5 20.5L10 13H17L1 1.5Z" fill="currentColor" stroke="white" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        <span>{peer.name}</span>
      </div>}
    </div>)}
  </div>;
}
