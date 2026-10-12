import { BUILT_IN_TEMPLATES, parseBuiltInTemplateState, type BuiltInTemplateState, type DesignTemplate, type EditorLibrary } from "./model";

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

/** A custom template with a legacy bundled ID shadows the static definition. */
export function libraryTemplates(library: EditorLibrary): DesignTemplate[] {
  const states = stateById(library), customIds = new Set(library.templates.map(template => template.id));
  return [
    ...BUILT_IN_TEMPLATES.filter(template => !customIds.has(template.id) && !states.get(template.id)?.deletedAt && !states.get(template.id)?.permanentlyDeleted),
    ...library.templates.flatMap(template => {
      const state = states.get(template.id);
      if (state?.deletedAt || state?.permanentlyDeleted || (!state && template.deletedAt)) return [];
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
