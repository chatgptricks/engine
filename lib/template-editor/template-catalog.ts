import { BUILT_IN_TEMPLATES, parseBuiltInTemplateState, templateFingerprint, type BuiltInTemplateState, type DesignTemplate, type EditorLibrary } from "./model";

function stateById(library: EditorLibrary): Map<string, BuiltInTemplateState> {
  return new Map(library.builtInTemplateStates?.map(state => [state.id, state]));
}
function isBuiltIn(id: string): boolean {
  return BUILT_IN_TEMPLATES.some(template => template.id === id);
}
function timestamp(library: EditorLibrary, id: string, now?: string): string {
  if (now !== undefined) {
    if (now.length > 40 || !Number.isFinite(Date.parse(now))) throw new Error("Use a valid template change timestamp.");
    return new Date(now).toISOString();
  }
  // Consecutive local actions can occur in the same millisecond. Give a restore
  // its own revision so a deterministic merge cannot mistake it for the delete.
  const previous = library.builtInTemplateStates?.find(state => state.id === id)?.updatedAt;
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}
function withState(library: EditorLibrary, state: BuiltInTemplateState): EditorLibrary {
  return { ...library, builtInTemplateStates: [...(library.builtInTemplateStates ?? []).filter(current => current.id !== state.id), state] };
}

const builtInPrints = new WeakMap<DesignTemplate, string | null>(), followingCopies = new WeakMap<DesignTemplate, { builtIn?: DesignTemplate; view: DesignTemplate }>();
function builtInPrint(template: DesignTemplate): string | null {
  if (!builtInPrints.has(template)) builtInPrints.set(template, templateFingerprint(template));
  return builtInPrints.get(template)!;
}

/**
 * The workspace's copy of a built-in template as people see it. A copy made by
 * Save as layout (saved-layouts.ts) carries the fingerprint of the built-in it
 * was copied from. While its own content still matches that fingerprint and its
 * saved layouts come after the built-in's pages, nobody has changed the
 * built-in's part of it: it shows the built-in's current pages, then its saved
 * layouts, so Engine's later changes to the built-in reach it. Any other copy,
 * an edited one or one without a fingerprint, is the person's own and shows as
 * saved.
 */
export function withBuiltInPages(template: DesignTemplate): DesignTemplate {
  if (!template.builtInFingerprint) return template;
  const builtIn = BUILT_IN_TEMPLATES.find(item => item.id === template.id), cached = followingCopies.get(template);
  if (cached && cached.builtIn === builtIn) return cached.view;
  const first = template.pages.findIndex(page => page.savedLayout);
  const layouts = first < 0 ? [] : template.pages.slice(first);
  let view = template;
  if (builtIn && layouts.every(page => page.savedLayout) && builtIn.pages.length + layouts.length <= 20 && templateFingerprint(template) === template.builtInFingerprint) {
    const current = builtInPrint(builtIn);
    if (current) {
      const filed = Object.fromEntries((["tags", "folderId", "favorite", "deletedAt"] as const).filter(key => template[key] !== undefined).map(key => [key, template[key]]));
      view = { ...builtIn, ...filed, custom: true, builtInFingerprint: current, pages: [...builtIn.pages, ...layouts] };
    }
  }
  followingCopies.set(template, { builtIn, view });
  return view;
}

/** A custom template with a legacy bundled ID shadows the static definition. */
export function libraryTemplates(library: EditorLibrary): DesignTemplate[] {
  const states = stateById(library), customIds = new Set(library.templates.map(template => template.id));
  return [
    ...BUILT_IN_TEMPLATES.filter(template => !customIds.has(template.id) && !states.get(template.id)?.deletedAt && !states.get(template.id)?.permanentlyDeleted),
    ...library.templates.flatMap(saved => {
      const state = states.get(saved.id);
      if (state?.deletedAt || state?.permanentlyDeleted || (!state && saved.deletedAt)) return [];
      const template = withBuiltInPages(saved);
      if (!template.deletedAt) return [template];
      const active = { ...template }; delete active.deletedAt; return [active];
    }),
  ];
}
export function trashedTemplates(library: EditorLibrary): DesignTemplate[] {
  const states = stateById(library), customIds = new Set(library.templates.map(template => template.id));
  return [
    ...BUILT_IN_TEMPLATES.flatMap(template => { const state = states.get(template.id); return !customIds.has(template.id) && state?.deletedAt && !state.permanentlyDeleted ? [{ ...template, deletedAt: state.deletedAt }] : []; }),
    ...library.templates.flatMap(template => {
      const state = states.get(template.id);
      if (state?.permanentlyDeleted || (state && !state.deletedAt)) return [];
      const deletedAt = state?.deletedAt ?? template.deletedAt;
      return deletedAt ? [{ ...template, deletedAt }] : [];
    }),
  ];
}

export function deleteLibraryTemplate(library: EditorLibrary, id: string, now?: string): EditorLibrary {
  const custom = library.templates.find(template => template.id === id);
  if (!custom && !isBuiltIn(id)) return library;
  if (stateById(library).get(id)?.permanentlyDeleted && !custom) return library;
  const changedAt = timestamp(library, id, now);
  let next = custom ? { ...library, templates: library.templates.map(template => template.id === id ? { ...template, deletedAt: changedAt } : template) } : library;
  if (isBuiltIn(id)) next = withState(next, { id, updatedAt: changedAt, deletedAt: changedAt });
  return next;
}
export function restoreLibraryTemplate(library: EditorLibrary, id: string, now?: string): EditorLibrary {
  const custom = library.templates.find(template => template.id === id);
  if (!custom && !isBuiltIn(id)) return library;
  if (stateById(library).get(id)?.permanentlyDeleted && !custom) return library;
  let next = custom ? { ...library, templates: library.templates.map(template => { if (template.id !== id) return template; const restored = { ...template }; delete restored.deletedAt; return restored; }) } : library;
  if (isBuiltIn(id)) next = withState(next, { id, updatedAt: timestamp(library, id, now) });
  return next;
}
export function purgeLibraryTemplate(library: EditorLibrary, id: string, now?: string): EditorLibrary {
  if (!library.templates.some(template => template.id === id) && !isBuiltIn(id)) return library;
  let next = { ...library, templates: library.templates.filter(template => template.id !== id) };
  if (isBuiltIn(id)) next = withState(next, { id, updatedAt: timestamp(library, id, now), permanentlyDeleted: true });
  return next;
}

/** Import adds absent decisions; existing workspace choices remain authoritative. */
export function withImportedTemplateStates(current: EditorLibrary, imported: Pick<EditorLibrary, "builtInTemplateStates">): EditorLibrary {
  if (imported.builtInTemplateStates === undefined) return current;
  const states = stateById(current);
  for (const candidate of imported.builtInTemplateStates) {
    const state = parseBuiltInTemplateState(candidate);
    if (!state) throw new Error("This backup contains an invalid built-in template decision.");
    if (!states.has(state.id)) states.set(state.id, structuredClone(state));
  }
  return { ...current, builtInTemplateStates: [...states.values()] };
}

function severity(state: BuiltInTemplateState): number {
  return state.permanentlyDeleted ? 2 : state.deletedAt ? 1 : 0;
}
/** Stable per-template conflict resolution, without creating a new catalog ID. */
export function latestBuiltInTemplateState(left: BuiltInTemplateState | undefined, right: BuiltInTemplateState | undefined): BuiltInTemplateState | undefined {
  if (!left) return right;
  if (!right) return left;
  const difference = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  if (difference) return difference > 0 ? left : right;
  const actionDifference = severity(left) - severity(right);
  if (actionDifference) return actionDifference > 0 ? left : right;
  // Equal actions and timestamps must also converge when date spellings differ.
  const signature = (state: BuiltInTemplateState) => `${state.deletedAt ?? ""}|${state.permanentlyDeleted === undefined ? "" : String(state.permanentlyDeleted)}|${state.updatedAt}`;
  return signature(left) >= signature(right) ? left : right;
}
