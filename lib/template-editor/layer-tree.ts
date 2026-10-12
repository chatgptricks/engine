import type { CanvasElement, CanvasScene } from "./model";

export type LayerTreeRow = { kind: "element"; element: CanvasElement; depth: number } | { kind: "group"; group: NonNullable<CanvasScene["groups"]>[number]; depth: number; memberIds: string[] };

/** Resolve descendants defensively: malformed cycles must never hang a panel. */
export function groupMemberIds(scene: CanvasScene, groupId: string): string[] {
  const groups = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of scene.groups ?? []) if (group.parentId && groups.has(group.parentId) && !groups.has(group.id)) { groups.add(group.id); changed = true; }
  }
  return scene.elements.filter(element => element.groupId && groups.has(element.groupId)).map(element => element.id);
}

/** Keep sibling groups ordered by their frontmost artwork, matching canvas stacking. */
export function buildLayerRows(scene: CanvasScene, collapsed: ReadonlySet<string> = new Set(), isolatedGroupId?: string, query = ""): LayerTreeRow[] {
  const groups = scene.groups ?? [];
  const known = new Set(groups.map(group => group.id));
  const search = query.trim().toLowerCase();
  const order = [...scene.elements].reverse();
  const rank = new Map(order.map((element, index) => [element.id, index]));
  const rows: LayerTreeRow[] = [];
  const visiting = new Set<string>();
  function visit(parentId: string | undefined, depth: number, includeAll = false) {
    const children = groups.filter(group => parentId ? group.parentId === parentId : !group.parentId || !known.has(group.parentId));
    const entries = [
      ...order.filter(element => parentId ? element.groupId === parentId : !element.groupId || !known.has(element.groupId)).map(element => ({ kind: "element" as const, element, rank: rank.get(element.id)! })),
      ...children.map(group => ({ kind: "group" as const, group, memberIds: groupMemberIds(scene, group.id), rank: Math.min(...groupMemberIds(scene, group.id).map(id => rank.get(id) ?? Infinity)) })),
    ].sort((a, b) => a.rank - b.rank);
    for (const entry of entries) {
      if (entry.kind === "element") {
        const element = entry.element;
        if (!search || includeAll || `${element.name} ${element.type} ${element.type === "text" ? element.text : element.type === "shape" ? element.shape : ""}`.toLowerCase().includes(search)) rows.push({ kind: "element", element, depth });
      } else {
        if (visiting.has(entry.group.id)) continue;
        const groupMatches = entry.group.name.toLowerCase().includes(search);
        const descendantMatches = entry.memberIds.some(id => { const element = scene.elements.find(item => item.id === id)!; return `${element.name} ${element.type} ${element.type === "text" ? element.text : ""}`.toLowerCase().includes(search); });
        if (search && !includeAll && !groupMatches && !descendantMatches) continue;
        rows.push({ kind: "group", group: entry.group, memberIds: entry.memberIds, depth });
        if (!collapsed.has(entry.group.id) || search) { visiting.add(entry.group.id); visit(entry.group.id, depth + 1, includeAll || (Boolean(search) && groupMatches)); visiting.delete(entry.group.id); }
      }
    }
  }
  visit(isolatedGroupId, 0);
  return rows;
}
