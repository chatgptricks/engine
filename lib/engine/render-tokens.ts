import {createHash, randomBytes} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {DesignDocument} from "@/lib/template-editor/model";

/**
 * Short-lived tokens for the private slide-render page
 * (`/engine/render/[token]`). A token names one page of one design held in
 * this server's memory, so headless Chromium can open the page without any
 * document data, image address or session cookie in the URL. Tokens are 32
 * random bytes, expire after two minutes and are revoked as soon as the
 * screenshot is taken.
 *
 * The store is a globalThis singleton, so it survives dev reloads and is shared
 * by the route and page bundles of one server process. Outside production a
 * caller that is not the Next server itself (a test or script rendering
 * against `next dev`) also leaves a private copy in the OS temp folder, so the
 * dev server can read it; production never writes one.
 */
export const RENDER_TOKEN_TTL_MS = 2 * 60_000;
export type RenderTokenEntry = {document: DesignDocument; pageId: string; expiresAt: number};
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STORE = Symbol.for("engine.render-tokens");
type Holder = typeof globalThis & {[STORE]?: Map<string, RenderTokenEntry>};
function memory(): Map<string, RenderTokenEntry> {
  const holder = globalThis as Holder;
  return holder[STORE] ??= new Map();
}
function sweep(now: number) {
  for (const [token, entry] of memory()) if (entry.expiresAt <= now) memory().delete(token);
}
const production = () => process.env.NODE_ENV === "production";
function bridgeFile(token: string) {
  const project = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), "engine-render-tokens", project, `${createHash("sha256").update(token).digest("hex")}.json`);
}
export function isRenderToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function createRenderToken({document, pageId, now = Date.now()}: {document: DesignDocument; pageId: string; now?: number}): string {
  if (!document?.pages?.some(page => page.id === pageId)) throw new Error(`Page ${pageId} is not in this design.`);
  sweep(now);
  const token = randomBytes(32).toString("base64url");
  const entry: RenderTokenEntry = {document: structuredClone(document), pageId, expiresAt: now + RENDER_TOKEN_TTL_MS};
  memory().set(token, entry);
  if (!production() && !process.env.NEXT_RUNTIME) {
    const file = bridgeFile(token), directory = path.dirname(file);
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    for (const name of fs.readdirSync(directory)) {
      const stale = path.join(directory, name);
      try { if (fs.statSync(stale).mtimeMs + RENDER_TOKEN_TTL_MS <= now) fs.rmSync(stale, {force: true}); } catch { /* Already removed. */ }
    }
    fs.writeFileSync(file, JSON.stringify(entry), {encoding: "utf8", mode: 0o600});
  }
  return token;
}

export function readRenderToken(token: string, now = Date.now()): RenderTokenEntry | null {
  if (!isRenderToken(token)) return null;
  sweep(now);
  const held = memory().get(token);
  if (held) return held;
  if (production()) return null;
  const file = bridgeFile(token);
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as RenderTokenEntry;
    if (typeof entry?.expiresAt === "number" && entry.expiresAt > now && typeof entry.pageId === "string" && entry.document?.pages?.some(page => page.id === entry.pageId)) return entry;
    fs.rmSync(file, {force: true});
  } catch { /* No bridge copy: the token is unknown here. */ }
  return null;
}

export function revokeRenderToken(token: string): void {
  if (!isRenderToken(token)) return;
  memory().delete(token);
  if (!production()) fs.rmSync(bridgeFile(token), {force: true});
}
