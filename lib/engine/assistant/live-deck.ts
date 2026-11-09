import * as Y from "yjs";
import {agentDeckView} from "@/lib/template-editor/agent-decks";
import {createCollaborationDocument, decodeCollaborationUpdate, encodeCollaborationUpdate, readCollaborationDocument, writeCollaborationDocument} from "@/lib/template-editor/collaboration-document";
import {getCollaborationDocument, saveCollaborationDocument} from "@/lib/template-editor/persistence";
import type {DesignDocument} from "@/lib/template-editor/model";
import {applyChatEdits} from "./chat-edits";

/**
 * The open post as the chat sees it. Reads come from the live room, so the
 * agent sees edits people haven't finished saving the old way. Edits are
 * normally applied in the editor of the person who asked (one undo step for
 * them); when no editor is there to take them, they go into the live room
 * from here, as another collaborator's edit, and everyone sees them.
 */

export const ASSISTANT_ORIGIN = "engine-assistant";

export type LiveDeckStore = {
  read: (ownerKey: string, deckId: string) => Promise<{document: DesignDocument; state: string; epoch: string}>;
  save: (ownerKey: string, deckId: string, update: string, epoch: string) => Promise<{document: DesignDocument}>;
};
const persistence: LiveDeckStore = {read: getCollaborationDocument, save: saveCollaborationDocument};

export async function readLiveDeck(ownerKey: string, deckId: string, store: LiveDeckStore = persistence): Promise<DesignDocument> {
  return (await store.read(ownerKey, deckId)).document;
}

/** Applies edits through the live room. Retries once when the room started a new generation meanwhile. */
export async function applyEditsOnServer(ownerKey: string, deckId: string, operations: unknown, store: LiveDeckStore = persistence): Promise<DesignDocument> {
  for (let attempt = 0; ; attempt++) {
    const live = await store.read(ownerKey, deckId);
    const doc = createCollaborationDocument();
    try {
      Y.applyUpdate(doc, decodeCollaborationUpdate(live.state));
      const before = readCollaborationDocument(doc);
      const next = applyChatEdits(before, operations);
      const vector = Y.encodeStateVector(doc);
      writeCollaborationDocument(doc, before, next, ASSISTANT_ORIGIN);
      const saved = await store.save(ownerKey, deckId, encodeCollaborationUpdate(Y.encodeStateAsUpdate(doc, vector)), live.epoch);
      return saved.document;
    } catch (error) {
      if (attempt < 1 && error instanceof Error && /generation changed|Reload the live document/.test(error.message)) continue;
      throw error;
    } finally {
      doc.destroy();
    }
  }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const IMAGE_KEYS = new Set(["src", "previewSrc", "url"]);
// Layout internals the agent doesn't edit; they only make the view longer.
// An HTML layer's tokens are the brand's CSS variables, which Engine sets; the system prompt names them.
const DROPPED = new Set(["smartText", "autoFitFontSize", "wordTextures", "textureFill", "imageFill", "clipBounds", "groups", "readingOrder", "tokens"]);

function compact(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (IMAGE_KEYS.has(key) && value.startsWith("data:")) {
      const type = value.slice(5, value.indexOf(";") > 0 ? value.indexOf(";") : 20);
      return `embedded ${type} (${Math.round(value.length * 0.75 / 1000)} KB)`;
    }
    if (IMAGE_KEYS.has(key) && value.length > 400) return `${value.slice(0, 400)}…`;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => compact(item));
  if (record(value)) {
    const result: RecordValue = {};
    for (const [field, child] of Object.entries(value)) {
      if (DROPPED.has(field) || child === undefined) continue;
      // Rich text matters only when some words are styled differently.
      if (field === "richText" && (typeof child !== "string" || !child.includes("<span"))) continue;
      result[field] = compact(child, field);
    }
    return result;
  }
  return value;
}

/** Which Recreate run made a post, from the credit it leaves in the post's notes. */
export function runOfDeck(document: DesignDocument): string | null {
  for (const comment of document.comments ?? []) {
    const match = comment.text.match(/\b(post-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/);
    if (match) return match[1];
  }
  return null;
}

/** The post for the agent: slides numbered from 1, element ids to edit, embedded images shortened, and the team's notes. */
export function postForAgent(document: DesignDocument) {
  const view = agentDeckView(document);
  const comments = (document.comments ?? []).filter(comment => !comment.resolved).slice(-12).map(comment => {
    const slide = comment.pageId ? document.pages.findIndex(page => page.id === comment.pageId) + 1 : 0;
    return {...(slide > 0 ? {slide} : {}), text: comment.text.slice(0, 1500)};
  });
  return {
    id: view.id, name: view.name, size: view.size, coordinates: view.coordinates, caption: view.caption,
    tags: document.tags ?? [],
    slides: view.slides.map((slide, index) => ({number: index + 1, ...(compact(slide) as RecordValue)})),
    ...(view.master ? {master: compact(view.master)} : {}),
    ...(view.continuousCanvas ? {continuousCanvas: "This post is one continuous canvas; only its name and caption can be edited here."} : {}),
    ...(comments.length ? {notes: comments} : {}),
  };
}
