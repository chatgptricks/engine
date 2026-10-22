import type {DesignDocument} from "./model";

export const COLLABORATION_PRESENCE_TTL = 15_000;
export type CollaborationCursor = {x: number; y: number} | null;
export type CollaborationPreview = {elements: {id: string; x: number; y: number; width: number; height: number; rotation: number; fontSize?: number}[]} | null;
export type CollaborationAwareness = {pageId?: string; selected: string[]; cursor: CollaborationCursor; preview?: CollaborationPreview};
export type CollaborationActor = {id: string; name: string; color: string; canRename?: boolean};
export type CollaborationParticipant = CollaborationActor & CollaborationAwareness & {sessionId: string; seenAt: number};
export type CollaborationSnapshot = {
  state: string;
  document: DesignDocument;
  revision: string | null;
  scope: string;
  version: number;
  epoch: string;
  storage: "cloud" | "local";
  assetKeys?: string[];
  participants: CollaborationParticipant[];
  actor: CollaborationActor;
};
