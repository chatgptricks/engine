import { Fragment, type ReactNode } from "react";
import {scenePaintTree,type ScenePaintLayer} from "@/lib/template-editor/paint-order";
import type { CanvasElement, CanvasScene } from "@/lib/template-editor/model";

/** Group opacity must composite the group's artwork once, including overlap. */
export function SceneLayers({ scene, render }: { scene: CanvasScene; render: (element: CanvasElement) => ReactNode }) {
  const layers=(entries:ScenePaintLayer[]):ReactNode=>entries.map(entry=>entry.kind==="element"?<Fragment key={entry.element.id}>{render(entry.element)}</Fragment>:<div key={entry.group.id} className="te-canvas-composite-group" data-composite-group={entry.group.id} style={{position:"absolute",inset:0,pointerEvents:"none",opacity:entry.group.opacity}}>{layers(entry.children)}</div>);
  return <>{layers(scenePaintTree(scene))}</>;
}
