import {parseBuiltInTemplateState, type BuiltInTemplateState, type EditorLibrary} from "./model";
import {latestBuiltInTemplateState} from "./template-catalog";
export const ASSET_PREFIX = "engine-asset:";
export function stableStringify(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child) ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
}
export function sameContent(a: unknown, b: unknown): boolean {return a === b || stableStringify(a) === stableStringify(b);}
export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value) ?? "null");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function packAssets<T>(value: T, known = new Set<string>()): Promise<{value: T; assets: Record<string, string>}> {
  const assets: Record<string, string> = {}, cache = new Map<string, Promise<string>>();
  async function visit(input: unknown, field = ""): Promise<unknown> {
    if ((field === "src" || field === "url") && typeof input === "string" && /^data:image\//.test(input)) {
      let key = cache.get(input); if (!key) { key = contentHash(input); cache.set(input, key); }
      const hash = await key; if (!known.has(hash)) assets[hash] = input; return `${ASSET_PREFIX}${hash}`;
    }
    if (Array.isArray(input)) return Promise.all(input.map(child => visit(child)));
    if (input && typeof input === "object") return Object.fromEntries(await Promise.all(Object.entries(input).map(async ([key, child]) => [key, await visit(child, key)])));
    return input;
  }
  return {value: await visit(value) as T, assets};
}
export function unpackAssets<T>(value: T, assets: Record<string, string>): T {
  function visit(input: unknown, field = ""): unknown {
    if ((field === "src" || field === "url") && typeof input === "string" && input.startsWith(ASSET_PREFIX)) {
      const hash = input.slice(ASSET_PREFIX.length), asset = assets[hash];
      if (!/^[a-f0-9]{64}$/.test(hash) || typeof asset !== "string" || !asset.startsWith("data:image/")) throw new Error("An embedded asset is missing. Saved artwork has not been overwritten.");
      return asset;
    }
    if (Array.isArray(input)) return input.map(child => visit(child));
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, visit(child, key)]));
    return input;
  }
  return visit(value) as T;
}
export type CollectionName = "designs" | "templates" | "brandKits" | "folders" | "builtInTemplateStates" | "workspaceStyles" | "workspaceComponents";
export interface LibraryChange {id: string; beforeHash: string; value: unknown | null}
export interface LibraryPatch {version: 1; collections: Partial<Record<CollectionName, LibraryChange[]>>; settings: {key: string; beforeHash: string; value: unknown}[]}
const equal = sameContent;
export async function createLibraryPatch(base: EditorLibrary, next: EditorLibrary): Promise<LibraryPatch> {
  const collections: LibraryPatch["collections"] = {};
  for (const name of ["designs", "templates", "brandKits", "folders", "builtInTemplateStates", "workspaceStyles", "workspaceComponents"] as const) {
    if ((name === "builtInTemplateStates" || name === "workspaceStyles" || name === "workspaceComponents") && next[name] === undefined) continue;
    const previous = new Map((base[name] ?? []).map(item => [item.id, item]));
    const current = new Map((next[name] ?? []).map(item => [item.id, item]));
    const changes: LibraryChange[] = [];
    for (const id of new Set([...previous.keys(), ...current.keys()])) {
      const before = previous.get(id) ?? null, after = current.get(id) ?? null;
      if (name === "builtInTemplateStates" && after === null) throw new Error("Restore built-in templates explicitly; their saved decisions cannot be removed.");
      if (!equal(before, after)) changes.push({id, beforeHash: await contentHash(before), value: after});
    }
    if (changes.length) collections[name] = changes;
  }
  const settings: LibraryPatch["settings"] = [];
  for (const key of ["activeBrandKitId"] as const) {
    const before = base[key] ?? null, after = next[key] ?? null;
    if (!equal(before, after)) settings.push({key, beforeHash: await contentHash(before), value: after});
  }
  return {version: 1, collections, settings};
}
export class LibraryPatchConflict extends Error {
  constructor(public ids: string[]) { super("The same document changed in another tab. Both versions have been preserved."); this.name = "LibraryPatchConflict"; }
}
export async function applyLibraryPatch(current: EditorLibrary, patch: LibraryPatch): Promise<EditorLibrary> {
  if (!patch || patch.version !== 1 || !patch.collections || !Array.isArray(patch.settings)) throw new Error("Invalid document changes.");
  const result = structuredClone(current), conflicts: string[] = [];
  for (const [name, changes] of Object.entries(patch.collections)) {
    if (!["designs", "templates", "brandKits", "folders", "builtInTemplateStates", "workspaceStyles", "workspaceComponents"].includes(name) || !Array.isArray(changes) || changes.length > 250) throw new Error("Invalid collection changes.");
    const collection = name as CollectionName;
    const records = new Map<string, unknown>(((result[collection] ?? []) as {id: string}[]).map(item => [item.id, item]));
    const seen = new Set<string>();
    for (const change of changes) {
      if (!change || typeof change.id !== "string" || seen.has(change.id) || !/^[a-f0-9]{64}$/.test(change.beforeHash) || (change.value !== null && (typeof change.value !== "object" || !change.value || (change.value as {id?: string}).id !== change.id))) throw new Error("Invalid document change.");
      seen.add(change.id);
      const before = records.get(change.id) ?? null;
      if (collection === "builtInTemplateStates") {
        const incoming = parseBuiltInTemplateState(change.value);
        if (!incoming || incoming.id !== change.id) throw new Error("Invalid built-in template change. Restore it explicitly instead of removing its saved decision.");
        const saved = before === null ? undefined : parseBuiltInTemplateState(before);
        if (before !== null && !saved) throw new Error("Invalid saved built-in template decision.");
        const latest = latestBuiltInTemplateState(saved ?? undefined, incoming);
        if (latest) records.set(change.id, structuredClone(latest));
        continue;
      }
      if (await contentHash(before) !== change.beforeHash && !equal(before, change.value)) { conflicts.push(change.id); continue; }
      if (change.value === null) records.delete(change.id); else records.set(change.id, change.value);
    }
    // Retain existing ordering; newly-created documents are shown first in the UI.
    (result as unknown as Record<string, unknown>)[name] = [...records.values()];
  }
  for (const setting of patch.settings) {
    if (!setting || !["activeBrandKitId"].includes(setting.key) || !/^[a-f0-9]{64}$/.test(setting.beforeHash)) throw new Error("Invalid workspace settings.");
    const data = result as unknown as Record<string, unknown>;
    if (await contentHash(data[setting.key] ?? null) !== setting.beforeHash && !equal(data[setting.key] ?? null, setting.value)) conflicts.push(setting.key);
    else if (setting.value === null) delete data[setting.key]; else data[setting.key] = setting.value;
  }
  if (conflicts.length) throw new LibraryPatchConflict(conflicts);
  const kit = result.brandKits.find(item => item.id === result.activeBrandKitId) ?? result.brandKits[0];
  if (kit) { result.activeBrandKitId = kit.id; result.brand = {name: kit.name, font: kit.font, background: kit.background, text: kit.text}; }
  return result;
}
/** Three-way merge: disjoint edits merge, divergent documents become independent copies. */
export function reconcileLibraries(base: EditorLibrary, local: EditorLibrary, remote: EditorLibrary): {library: EditorLibrary; copies: number} {
  const result = structuredClone(remote); let copies = 0;
  for (const name of ["designs", "templates", "brandKits", "folders", "workspaceStyles", "workspaceComponents"] as const) {
    if ((name === "workspaceStyles" || name === "workspaceComponents") && local[name] === undefined) continue;
    const old = new Map<string, unknown>((base[name] ?? []).map(item => [item.id, item]));
    const server = new Map<string, unknown>((remote[name] ?? []).map(item => [item.id, item]));
    const mine = new Map<string, unknown>((local[name] ?? []).map(item => [item.id, item]));
    for (const id of new Set([...old.keys(), ...mine.keys()])) {
      const before = old.get(id) ?? null, change = mine.get(id) ?? null, saved = server.get(id) ?? null;
      if (equal(before, change) || equal(saved, change)) continue;
      if (equal(before, saved)) { if (change === null) server.delete(id); else server.set(id, change); }
      else if (change !== null) {
        if (name === "templates") {
          const changedTemplate = change as Record<string, unknown>, savedTemplate = saved as Record<string, unknown> | null;
          const omitDeletion = (template: Record<string, unknown>) => { const copy = { ...template }; delete copy.deletedAt; return copy; };
          if (typeof changedTemplate.deletedAt === "string" && savedTemplate && typeof savedTemplate.deletedAt === "string" && equal(omitDeletion(changedTemplate), omitDeletion(savedTemplate))) {
            server.set(id, Date.parse(changedTemplate.deletedAt) > Date.parse(savedTemplate.deletedAt) ? changedTemplate : savedTemplate);
            continue;
          }
        }
        const copy = structuredClone(change) as Record<string, unknown>; copy.id = crypto.randomUUID(); copy.name = `${String(copy.name).slice(0, name === "folders" || name === "brandKits" ? 80 : 175)} (conflict copy)`; delete copy.deletedAt;
        if (name === "designs") { delete copy.reviewLinks; delete copy.editingTemplateId; delete copy.purpose; copy.updatedAt = new Date().toISOString(); }
        if (name === "templates") {
          copy.custom = true;
          const deletedAt = (change as Record<string, unknown>).deletedAt ?? (saved as Record<string, unknown> | null)?.deletedAt ?? (saved === null && before !== null ? (before as Record<string, unknown>).deletedAt ?? new Date().toISOString() : undefined);
          if (typeof deletedAt === "string") copy.deletedAt = deletedAt;
        }
        server.set(String(copy.id), copy); copies++;
      }
    }
    (result as unknown as Record<string, unknown>)[name] = [...server.values()];
  }
  if (base.builtInTemplateStates !== undefined || local.builtInTemplateStates !== undefined || remote.builtInTemplateStates !== undefined) {
    const states = new Map<string, BuiltInTemplateState>();
    // Missing rows are older-client omissions, never permission to reseed a template.
    for (const source of [base.builtInTemplateStates, remote.builtInTemplateStates, local.builtInTemplateStates]) for (const candidate of source ?? []) {
      const state = parseBuiltInTemplateState(candidate);
      if (!state) throw new Error("Invalid built-in template decision.");
      const latest = latestBuiltInTemplateState(states.get(state.id), state);
      if (latest) states.set(state.id, structuredClone(latest));
    }
    result.builtInTemplateStates = [...states.values()];
  }
  for (const key of ["activeBrandKitId"] as const) if (!equal(local[key], base[key]) && equal(remote[key], base[key])) (result as unknown as Record<string, unknown>)[key] = structuredClone(local[key]);
  const kit = result.brandKits.find(item => item.id === result.activeBrandKitId) ?? result.brandKits[0];
  if (kit) { result.activeBrandKitId = kit.id; result.brand = {name: kit.name, font: kit.font, background: kit.background, text: kit.text}; }
  return {library: result, copies};
}
