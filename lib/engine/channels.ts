/**
 * Channels — the Instagram accounts a curator manages. Each story belongs to
 * one channel (or none, for legacy/seed stories), and the grid can filter by
 * channel. A channel may be linked to a real Instagram login via the Meta
 * OAuth flow (/api/instagram/connect) once INSTAGRAM_APP_ID/SECRET are set;
 * until then channels are managed by handle.
 */

export interface Channel {
  id: string;
  /** Display name, e.g. "Engine". */
  name: string;
  /** Instagram handle without the @, e.g. "engine". */
  handle: string;
  /** Avatar bubble color (from CHANNEL_COLORS). */
  color: string;
  /** Set once the Instagram OAuth connect completes. */
  connected?: boolean;
  /** Instagram user id + confirmed username from the OAuth flow. */
  igUserId?: string;
  igUsername?: string;
  createdAt: string;
}

/** Muted, monochrome-adjacent bubble tones that sit well on the dark canvas. */
export const CHANNEL_COLORS = [
  "#8a8f98",
  "#a78bfa",
  "#7dd3fc",
  "#86efac",
  "#fcd34d",
  "#f9a8d4",
  "#fda4af",
  "#c4b5fd",
];

export function newChannelId(): string {
  return `ch_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
}

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase().slice(0, 60);
}

export function channelInitial(c: Channel): string {
  return (c.name.trim()[0] || c.handle[0] || "?").toUpperCase();
}
