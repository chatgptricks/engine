import { Fragment, type ReactNode } from "react";
import { isElementHidden } from "@/lib/template-editor/commands";
import type { CanvasElement, CanvasScene } from "@/lib/template-editor/model";

/** Group opacity must composite the group's artwork once, including overlap. */
export function SceneLayers({ scene, render }: { scene: CanvasScene; render: (element: CanvasElement) => ReactNode }) {
  const elements = scene.elements.filter(element => !isElementHidden(scene, element));
  if (!scene.groups?.some(group => group.opacity !== undefined)) return <>{elements.map(element => <Fragment key={element.id}>{render(element)}</Fragment>)}</>;
  const groups = new Map(scene.groups.map(group => [group.id, group]));
  const rank = (id: string): number => {
    const descendant = (element: CanvasElement) => {
      let parent = element.groupId; const seen = new Set<string>();
      while (parent && !seen.has(parent)) { if (parent === id) return true; seen.add(parent); parent = groups.get(parent)?.parentId; }
      return false;
    };
    return scene.elements.findIndex(descendant);
  };
  const children = (parent?: string): ReactNode => {
    const entries = [...elements.filter(element => element.groupId === parent || !parent && element.groupId && !groups.has(element.groupId)).map(element => ({ rank: scene.elements.indexOf(element), element })), ...scene.groups!.filter(group => group.parentId === parent).map(group => ({ rank: rank(group.id), group }))].sort((a, b) => a.rank - b.rank);
    return entries.map(entry => "element" in entry ? <Fragment key={entry.element.id}>{render(entry.element)}</Fragment> : <div key={entry.group.id} className="te-canvas-composite-group" data-composite-group={entry.group.id} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: entry.group.opacity }}>{children(entry.group.id)}</div>);
  };
  return <>{children()}</>;
}
