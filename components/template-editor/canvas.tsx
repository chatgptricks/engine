"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  useMemo,
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
  type SVGAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  CanvasElement,
  CanvasScene,
  TextElement,
  ShapeElement,
} from "@/lib/template-editor/model";
import { elementIntersectsCanvas, elementIntersectsRect, shapeStrokeOutset } from "@/lib/template-editor/canvas-geometry";
import { snapMove, snapPoint, translateElements, type SnapGuide } from "@/lib/template-editor/snapping";
import { gradientCss, gradientEndpoints, maskCss, shapePath } from "@/lib/template-editor/appearance";
import { editorRichHtml, formatTextRange, textRangeTogglePatch, splitRichLines, resolveRichDecorations, scaleRichTextFonts, captureTextFormattingTarget, sameTextFormattingTarget, textEditingFingerprint, captureTextSelection, restoreTextSelection, type TextFormattingPatch, type TextFormattingTarget, type TextFormatter } from "@/lib/template-editor/rich-text-editing";
import { duplicateSelection, expandGroupSelection, isElementHidden, isElementLocked, canEditElement } from "@/lib/template-editor/commands";
import { groupMemberIds } from "@/lib/template-editor/layer-tree";
import { richTextToPlain } from "@/lib/template-editor/model";
import { parseColor } from "@/lib/template-editor/color-utils";
import { photoContent, updatePhotoContent, shapeViewBox, findPhotoFrameAtPoint } from "@/lib/template-editor/photo-frames";
import { textureBackgroundStyle, activeTextTextures, textTextureVariables, textTextureCss } from "@/lib/template-editor/text-textures";
import { fillShapeWithImage } from "@/lib/template-editor/commands";
import { LayoutOverlay } from "./layout-panel";
import {historyShortcut} from "@/lib/template-editor/history";
import { proxied } from "@/lib/engine/util";
import "./canvas.css";

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number; rotation: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Gesture = {
  kind: "move" | "resize" | "rotate";
  pointer: number;
  capture: HTMLElement;
  start: Point;
  source: CanvasScene;
  latest: CanvasScene;
  ids: string[];
  bounds: Box;
  handle?: Handle;
  moved: boolean;
  duplicateRequested?: boolean;
  originalScene?: CanvasScene;
  originalSelection?: string[];
  dropPoint?: Point;
  dropTargetId?: string;
  bypassFrame?: boolean;
};
type CropGesture = { pointer:number; start:Point; source:CanvasElement; capture:HTMLElement };
type Marquee = {
  pointer: number;
  capture: HTMLElement;
  start: Point;
  source: CanvasScene;
  previousIds: string[];
  baseIds: string[];
  moved: boolean;
};
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Keep constant-size controls from covering each other on thin artwork. */
export function resizeHandlePolicy(box: Pick<Box,"width"|"height">, scale = 1, shape = false, grouped = false): Handle[] {
  const physicalWidth=box.width*scale,physicalHeight=box.height*scale;
  if(physicalWidth<16&&physicalHeight<16)return ["se"];
  if(box.width>box.height&&(physicalHeight<16||shape&&(box.height<=8||box.width/box.height>20)))return ["w","e"];
  if(box.height>box.width&&(physicalWidth<16||shape&&(box.width<=8||box.height/box.width>20)))return ["n","s"];
  return grouped?HANDLES.filter(handle=>handle.length===2):HANDLES;
}

/** Interaction targets stay usable independently of the artwork's visible box. */
export function minimumHitPadding(box: Pick<Box,"width"|"height">, scale = 1, minimumScreenPixels = 6) {
  const sceneMinimum=minimumScreenPixels/Math.max(.005,scale);
  return { x:Math.max(0,(sceneMinimum-box.width)/2),y:Math.max(0,(sceneMinimum-box.height)/2) };
}
const HANDLE_NAMES: Record<Handle, string> = {
  nw: "top left",
  n: "top",
  ne: "top right",
  e: "right",
  se: "bottom right",
  s: "bottom",
  sw: "bottom left",
  w: "left",
};
const RAD = Math.PI / 180;
const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const center = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

function bounded(element: CanvasElement): CanvasElement {
  return {
    ...element,
    x: round(clamp(element.x, -10_000, 10_000)),
    y: round(clamp(element.y, -10_000, 10_000)),
    width: round(clamp(element.width, 1, 10_000)),
    height: round(clamp(element.height, 1, 10_000)),
  };
}

/** Uploads can complete during a gesture. Preserve the latest layer list and
 * content, and apply only fields that this gesture actually transformed. */
export function mergeGesture(scene: CanvasScene, active: Gesture): CanvasScene {
  const originals = new Map(active.source.elements.map((element) => [element.id, element]));
  const transformed = new Map(active.latest.elements.map((element) => [element.id, element]));
  const selected = new Set(active.ids);
  let changed = false;
  const elements = scene.elements.map((element) => {
    if (!selected.has(element.id) || !canEditElement(scene, element, "position") || isElementHidden(scene, element)) return element;
    const original = originals.get(element.id), next = transformed.get(element.id);
    if (!original || !next || original.type !== element.type || next.type !== element.type) return element;
    const replacement = { ...element };
    let modified = false;
    for (const key of ["x", "y", "width", "height", "rotation"] as const) {
      if (next[key] !== original[key] && next[key] !== element[key]) {
        replacement[key] = next[key];
        modified = true;
      }
    }
    if (replacement.type === "text" && original.type === "text" && next.type === "text" && canEditElement(scene, element, "style")) {
      if(next.richText!==original.richText){replacement.richText=next.richText;modified=true;}
      if(next.padding!==original.padding){replacement.padding=next.padding;modified=true;}
      if(next.paragraphSpacing!==original.paragraphSpacing){replacement.paragraphSpacing=next.paragraphSpacing;modified=true;}
      for (const key of ["fontSize", "letterSpacing"] as const) {
        if (next[key] !== original[key] && next[key] !== replacement[key]) {
          replacement[key] = next[key];
          modified = true;
        }
      }
    }
    if (canEditElement(scene,element,"style") && replacement.type !== "text" && original.type !== "text" && next.type !== "text" && next.radius !== original.radius && next.radius !== replacement.radius) {
      replacement.radius = next.radius;
      modified = true;
    }
    if (canEditElement(scene,element,"style") && replacement.type === "shape" && original.type === "shape" && next.type === "shape" && next.strokeWidth !== original.strokeWidth && next.strokeWidth !== replacement.strokeWidth) {
      replacement.strokeWidth = next.strokeWidth;
      modified = true;
    }
    if (!modified) return element;
    changed = true;
    return replacement;
  });
  return changed ? { ...scene, elements } : scene;
}

export function commitCanvasGesture(scene: CanvasScene, active: Gesture, cancel = false): CanvasScene {
  if(cancel || !active.moved)return scene;
  if(active.kind === "move" && active.ids.length === 1 && active.dropTargetId && !active.bypassFrame && !active.originalScene){
    const image=scene.elements.find(element=>element.id===active.ids[0]);
    if(image?.type === "image"){
      const filled=fillShapeWithImage(scene,active.dropTargetId,image,image.id);
      if(filled.scene!==scene)return filled.scene;
    }
  }
  const added=active.originalScene?active.source.elements.filter(element=>!active.originalScene!.elements.some(original=>original.id===element.id)):[];
  const target=added.length?{...scene,groups:[...(scene.groups??[]),...(active.source.groups??[]).filter(group=>!(scene.groups??[]).some(existing=>existing.id===group.id))],elements:[...scene.elements,...added]}:scene;
  return mergeGesture(target,active);
}

function rotate(point: Point, degrees: number): Point {
  const radians = degrees * RAD;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function boxStyle(element: Box): CSSProperties {
  return {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    transform: `rotate(${element.rotation}deg)`,
  };
}

function textStyle(element: TextElement): CSSProperties {
  return {
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    fontStyle: element.italic ? "italic" : "normal",
    textDecoration: element.richText ? "none" : [element.underline ? "underline" : "",element.strikethrough ? "line-through" : ""].filter(Boolean).join(" ") || "none",
    color: element.color,
    textAlign: element.align,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing,
    padding: element.padding ?? 0,
    boxSizing: "border-box",
    ...(element.gradient ? {backgroundImage:gradientCss(element.gradient),backgroundClip:"text",color:"transparent"} : {}),
    ...(element.textureFill ? textureBackgroundStyle(element.textureFill) : {}),
  };
}

function TextureResources({ element }: { element: TextElement }) {
  const holder=useRef<HTMLSpanElement>(null);
  const textures=activeTextTextures(element);
  const measure=useCallback(()=>{
    const owner=holder.current?.closest<HTMLElement>("[data-element-id]");if(!owner)return;
    for(const texture of textures){
      const img=holder.current?.querySelector<HTMLImageElement>(`img[data-engine-texture-id="${texture.id}"]`);
      const targets=texture.id==="whole"?[...owner.querySelectorAll<HTMLElement>(".te-canvas-text")]:[...owner.querySelectorAll<HTMLElement>(`[data-texture-id="${texture.id}"]`)];
      for(const target of targets){const style=textureBackgroundStyle({...texture,intrinsicWidth:texture.intrinsicWidth??img?.naturalWidth,intrinsicHeight:texture.intrinsicHeight??img?.naturalHeight},target.offsetWidth,target.offsetHeight);target.style.backgroundSize=String(style.backgroundSize);target.style.backgroundPosition=String(style.backgroundPosition);}
    }
  },[textures]);
  useLayoutEffect(measure,[measure]);
  // Export preflight decodes these original images before capturing CSS glyph fills.
  // eslint-disable-next-line @next/next/no-img-element
  return <span ref={holder} style={{display:"none"}} aria-hidden="true"><style>{textTextureCss(element)}</style>{textures.map(texture=><img key={texture.id} src={proxied(texture.src)} alt="" data-engine-texture-preload="true" data-engine-texture-id={texture.id} data-engine-image-fit={texture.objectFit} data-engine-image-crop-scale={texture.cropScale??1} onLoad={measure} />)}</span>;
}

/** A world-space viewport stays fixed while its editable object moves/rotates. */
function WorldClip({ bounds, children }: { bounds?: CanvasElement["clipBounds"]; children: ReactNode }) {
  if (!bounds) return <>{children}</>;
  return <div className="te-canvas-source-clip" style={{left:bounds.x,top:bounds.y,width:bounds.width,height:bounds.height}}><div style={{left:-bounds.x,top:-bounds.y}}>{children}</div></div>;
}

function SceneElement({ element }: { element: CanvasElement }) {
  const token = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const filterId = `effect-${token}`, gradientId = `gradient-${token}`;
  const shadow = element.shadow;
  const padding = shadow ? Math.abs(shadow.spread) + shadow.blur * 3 + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) + 10 : 0;
  const shadowColor = shadow ? parseColor(shadow.color) : null;
  const filter = [shadow ? `url(#${filterId})` : "", element.blur ? `blur(${element.blur}px)` : ""].filter(Boolean).join(" ") || undefined;
  const lines = element.type === "text" ? splitRichLines(element.richText ? resolveRichDecorations(element.richText, element.underline, element.strikethrough) : undefined, element.text) : [];
  const gradient = element.gradient;
  const endpoints = gradientEndpoints(gradient?.angle ?? 0, element.width, element.height);
  const radialRadius=Math.hypot(element.width,element.height)/2;
  const shape = element.type === "shape" ? element : undefined;
  const photo = shape?.imageFill;
  const photoClipId = `photo-${token}`, outsideMaskId = `outside-${token}`;
  const strokeAlign = shape?.strokeAlign ?? "center";
  const view = shape ? shapeViewBox(shape) : {x:0,y:0,width:100,height:100};
  const geometry = (props: SVGAttributes<SVGElement>) => !shape ? null : shape.shape === "rectangle" ? <rect x="0" y="0" width={shape.width} height={shape.height} rx={shape.radius} {...props} /> : shape.shape === "ellipse" ? <ellipse cx={shape.width / 2} cy={shape.height / 2} rx={shape.width / 2} ry={shape.height / 2} {...props} /> : <path d={shapePath(shape)} transform={`scale(${shape.width/view.width} ${shape.height/view.height}) translate(${-view.x} ${-view.y})`} {...props} />;
  const fillRule = shape?.fillRule ?? "nonzero";
  return <WorldClip bounds={element.clipBounds}><div className={`te-canvas-element te-canvas-element-${element.type}`} style={{ ...boxStyle(element), opacity: element.opacity, mixBlendMode: element.blendMode as CSSProperties["mixBlendMode"], filter,...(element.type==="text"?textTextureVariables(element):{}) }} data-element-id={element.id}>
    {element.type==="text"&&<TextureResources element={element} />}
    {shadow && <svg width="0" height="0" className="te-canvas-effect-defs" aria-hidden="true"><defs><filter id={filterId} filterUnits="userSpaceOnUse" x={-padding} y={-padding} width={element.width + padding * 2} height={element.height + padding * 2} colorInterpolationFilters="sRGB">
      <feMorphology in="SourceAlpha" operator={shadow.spread < 0 ? "erode" : "dilate"} radius={Math.abs(shadow.spread)} result="spread" />
      <feGaussianBlur in="spread" stdDeviation={shadow.blur / 2} result="soft" />
      <feOffset in="soft" dx={shadow.offsetX} dy={shadow.offsetY} result="offset" />
      <feFlood floodColor={shadowColor?.rgb ?? shadow.color} floodOpacity={shadowColor?.alpha ?? 1} result="color" />
      <feComposite in="color" in2="offset" operator="in" result="shadow" />
      <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter></defs></svg>}
    {element.type === "text" ? <div className={`te-canvas-text-frame${(element.textMode ?? "fixed") !== "auto-height" ? " is-fixed" : ""}`} style={{ justifyContent: element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start", "--te-paragraph-spacing": `${element.paragraphSpacing ?? 0}px` } as CSSProperties}>
      <div className={`te-canvas-text gf-font-${element.font}`} style={textStyle(element)}>{lines.map((line, index) => <div className="te-canvas-text-line" key={index}>{element.listStyle && element.listStyle !== "none" && <span className="te-canvas-list-prefix" aria-hidden="true">{element.listStyle === "number" ? `${index + 1}. ` : "• "}</span>}<span dangerouslySetInnerHTML={{ __html: line || "<br>" }} /></div>)}</div>
    </div> : element.type === "image" ? <div className="te-canvas-image-frame" style={{ borderRadius: element.radius, clipPath: maskCss(element.mask) }}><div className="te-canvas-image-zoom" style={{ width: "100%", height: "100%", transform: `scale(${element.cropScale ?? 1})`, transformOrigin: `${element.cropX}% ${element.cropY}%` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="te-canvas-image" src={proxied(element.src)} alt="" draggable={false} referrerPolicy="no-referrer" style={{ objectFit: element.fit, objectPosition: `${element.cropX}% ${element.cropY}%`, transform: `scale(${element.flipX ? -1 : 1}, ${element.flipY ? -1 : 1})`, transformOrigin: "center" }} />
    </div></div> : shape && <svg className="te-canvas-vector" viewBox={`0 0 ${shape.width} ${shape.height}`} preserveAspectRatio="none" aria-hidden="true"><defs>
      <clipPath id={photoClipId} clipPathUnits="userSpaceOnUse">{geometry({fillRule,clipRule:fillRule})}</clipPath>
      {strokeAlign === "outside" && <mask id={outsideMaskId} maskUnits="userSpaceOnUse" x={-shape.strokeWidth*2} y={-shape.strokeWidth*2} width={shape.width+shape.strokeWidth*4} height={shape.height+shape.strokeWidth*4} style={{maskType:"luminance"}}><rect x={-shape.strokeWidth*2} y={-shape.strokeWidth*2} width={shape.width+shape.strokeWidth*4} height={shape.height+shape.strokeWidth*4} fill="white" />{geometry({fill:"black",fillRule})}</mask>}
      {gradient && (gradient.type === "radial" ? <radialGradient id={gradientId} cx=".5" cy=".5" r="1" gradientTransform={`translate(.5 .5) scale(${radialRadius/element.width} ${radialRadius/element.height}) translate(-.5 -.5)`}>{gradient.stops.map((stop, index) => <stop key={index} offset={`${stop.position}%`} stopColor={stop.color} />)}</radialGradient> : <linearGradient id={gradientId} x1={`${endpoints.x1}%`} y1={`${endpoints.y1}%`} x2={`${endpoints.x2}%`} y2={`${endpoints.y2}%`}>{gradient.stops.map((stop, index) => <stop key={index} offset={`${stop.position}%`} stopColor={stop.color} />)}</linearGradient>)}
    </defs>
    {geometry({fill:gradient?`url(#${gradientId})`:shape.fill,fillRule})}
    {photo && <foreignObject x="0" y="0" width={shape.width} height={shape.height} clipPath={`url(#${photoClipId})`}><div className="te-canvas-shape-photo"><div className="te-canvas-image-zoom" style={{width:"100%",height:"100%",transform:`scale(${photo.cropScale??1})`,transformOrigin:`${photo.cropX}% ${photo.cropY}%`}}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="te-canvas-image" data-shape-photo-id={shape.id} src={proxied(photo.src)} alt={photo.alt??""} draggable={false} referrerPolicy="no-referrer" style={{objectFit:photo.objectFit,objectPosition:`${photo.cropX}% ${photo.cropY}%`,transform:`scale(${photo.flipX?-1:1}, ${photo.flipY?-1:1})`,transformOrigin:"center"}} />
    </div></div></foreignObject>}
    {shape.strokeWidth>0 && <g {...(strokeAlign==="inside"?{clipPath:`url(#${photoClipId})`}:strokeAlign==="outside"?{mask:`url(#${outsideMaskId})`}:{})}>{geometry({fill:"none",stroke:shape.stroke,strokeWidth:shape.strokeWidth*(strokeAlign==="center"?1:2),strokeDasharray:shape.strokeDash?.join(" "),strokeLinejoin:"round",strokeLinecap:"round",vectorEffect:"non-scaling-stroke",fillRule})}</g>}
    </svg>}
  </div></WorldClip>;
}

/** One 360px coordinate system is used for the editor, thumbnails and exports. */
export function SceneRenderer({ scene, isolate = true }: { scene: CanvasScene; isolate?: boolean }) {
  return (
    <div className="te-canvas-scene" style={{ background: scene.background, ...(!isolate ? {isolation:"auto" as const} : {}) }}>
      {scene.elements.filter((element) => !isElementHidden(scene,element)).map((element) => (
        <SceneElement key={element.id} element={element} />
      ))}
    </div>
  );
}

function selectionBounds(elements: CanvasElement[], rotatedSingle = true): Box {
  if (elements.length === 1 && rotatedSingle) {
    const { x, y, width, height, rotation } = elements[0];
    const padding=shapeStrokeOutset(elements[0]);
    return { x:x-padding, y:y-padding, width:width+padding*2, height:height+padding*2, rotation };
  }
  const points = elements.flatMap((element) => {
    const midpoint = center(element);
    const padding=shapeStrokeOutset(element);
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => {
      const offset = rotate(
        { x: x * (element.width/2+padding), y: y * (element.height/2+padding) },
        element.rotation,
      );
      return { x: midpoint.x + offset.x, y: midpoint.y + offset.y };
    });
  });
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: Math.max(...points.map((point) => point.x)) - left,
    height: Math.max(...points.map((point) => point.y)) - top,
    rotation: 0,
  };
}

/** Rectangle intersection in each box's axes avoids selecting the empty
 * corners around rotated artwork when drawing a selection rectangle. */
function intersectsMarquee(element: CanvasElement, area: Box): boolean {
  return elementIntersectsRect(element,area);
}

export function resizeSingle(
  element: CanvasElement,
  handle: Handle,
  delta: Point,
  preserveAspect: boolean,
  fromCenter = false,
): CanvasElement {
  const local = rotate({x:delta.x*(fromCenter?2:1),y:delta.y*(fromCenter?2:1)}, -element.rotation);
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  let width = sx ? clamp(element.width + sx * local.x, 1, 10_000) : element.width;
  let height = sy ? clamp(element.height + sy * local.y, 1, 10_000) : element.height;
  const isCorner = Boolean(sx && sy);
  // Text corners scale the type; side handles reflow the text within its box.
  if ((isCorner && element.type === "text") || preserveAspect) {
    const dw = (width - element.width) / element.width;
    const dh = (height - element.height) / element.height;
    const maximum = Math.min(10_000 / element.width, 10_000 / element.height);
    const scale = clamp(
      1 + (Math.abs(dw) >= Math.abs(dh) ? dw : dh),
      Math.min(maximum, 1 / Math.min(element.width, element.height)),
      maximum,
    );
    width = element.width * scale;
    height = element.height * scale;
  }
  const shift = rotate(
    {
      x: fromCenter ? 0 : ((width - element.width) * sx) / 2,
      y: fromCenter ? 0 : ((height - element.height) * sy) / 2,
    },
    element.rotation,
  );
  const midpoint = center(element);
  const result = {
    ...element,
    x: round(midpoint.x + shift.x - width / 2),
    y: round(midpoint.y + shift.y - height / 2),
    width: round(width),
    height: round(height),
  };
  return element.type === "text" && isCorner
    ? ({
        ...result,
        richText: scaleRichTextFonts(element.richText,width/element.width),
        ...(element.padding!==undefined?{padding:round(clamp(element.padding*width/element.width,0,1000))}:{}),
        ...(element.paragraphSpacing!==undefined?{paragraphSpacing:round(clamp(element.paragraphSpacing*width/element.width,0,1000))}:{}),
        fontSize: round(
          clamp((element.fontSize * width) / element.width, 1, 500),
        ),
        letterSpacing: round(
          clamp((element.letterSpacing * width) / element.width, -20, 100),
        ),
      } as CanvasElement)
    : result;
}

export function resizeGroup(
  elements: CanvasElement[],
  bounds: Box,
  handle: Handle,
  delta: Point,
  fromCenter = false,
): CanvasElement[] {
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const anchor = {
    x: fromCenter || !sx ? bounds.x + bounds.width/2 : bounds.x + (sx === -1 ? bounds.width : 0),
    y: fromCenter || !sy ? bounds.y + bounds.height/2 : bounds.y + (sy === -1 ? bounds.height : 0),
  };
  const diagonal = { x: bounds.width * sx/(fromCenter?2:1), y: bounds.height * sy/(fromCenter?2:1) };
  const minimum = Math.max(
    ...elements.map((element) => 1 / Math.min(element.width, element.height)),
  );
  const maximum = Math.min(
    10,
    ...elements.flatMap((element) => [
      10_000 / element.width,
      10_000 / element.height,
    ]),
  );
  const scale = clamp(
    1 +
      (delta.x * diagonal.x + delta.y * diagonal.y) /
        (diagonal.x ** 2 + diagonal.y ** 2),
    Math.min(minimum, maximum),
    maximum,
  );
  return elements.map((element) => {
    const midpoint = center(element);
    const width = element.width * scale;
    const height = element.height * scale;
    const resized = {
      ...element,
      x: round(anchor.x + (midpoint.x - anchor.x) * scale - width / 2),
      y: round(anchor.y + (midpoint.y - anchor.y) * scale - height / 2),
      width: round(width),
      height: round(height),
    };
    if (element.type === "text")
      return {
        ...resized,
        richText: scaleRichTextFonts(element.richText,scale),
        ...(element.padding!==undefined?{padding:round(clamp(element.padding*scale,0,1000))}:{}),
        ...(element.paragraphSpacing!==undefined?{paragraphSpacing:round(clamp(element.paragraphSpacing*scale,0,1000))}:{}),
        fontSize: round(clamp(element.fontSize * scale, 1, 500)),
        letterSpacing: round(clamp(element.letterSpacing * scale, -20, 100)),
      } as CanvasElement;
    if (element.type === "shape")
      return {
        ...resized,
        radius: round(clamp(element.radius * scale, 0, 5000)),
        strokeWidth: round(clamp(element.strokeWidth * scale, 0, 200)),
      } as CanvasElement;
    return {
      ...resized,
      radius: round(clamp(element.radius * scale, 0, 5000)),
    } as CanvasElement;
  });
}

export type CanvasHistoryBridge = {flush:()=>boolean};
type CanvasEditorProps = {
  scene: CanvasScene;
  width?: number;
  height: number;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onChange: (scene: CanvasScene, group?: string) => boolean | void;
  /** The document journal also owns typing and rich-range formatting history. */
  onHistory?: (direction: "undo" | "redo") => boolean | void;
  onRegisterHistoryBridge?: (bridge:CanvasHistoryBridge|null)=>void;
  onHistoryBoundary?: ()=>void;
  historyRevision?: number;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, targetId: string | null) => void;
  editingRequest?: { id: string; serial: number };
  /** Editor-only view setting; thumbnails and exports always clip to the page. */
  clipToCanvas?: boolean;
  /** Blank workspace available for marquee selection, in page coordinates. */
  pasteboardBounds?: { x: number; y: number; width: number; height: number };
  /** Show editor-only boundaries for a continuous carousel. */
  slideWidth?: number;
  /** Previous-slide guide; never part of the design or export renderer. */
  onionScene?: CanvasScene;
  onionOpacity?: number;
  disabled?: boolean;
  viewScale?: number;
  outputScale?: number;
  isolatedGroupId?: string | null;
  onEnterGroup?: (id: string) => void;
  onRegisterTextFormatter?: (formatter: TextFormatter | null) => void;
  cropImageId?: string | null;
  /** Stable target computed by the native asset/file drag integration. */
  imageDropTargetId?: string | null;
  masterScene?: CanvasScene;
  /** Visibility of the canonical master per slide, including separate-page mode. */
  masterPageVisibility?: boolean[];
  drawingMode?: 'pen';
  onDrawPath?: (element: ShapeElement) => void;
};

export function CanvasEditor({
  scene,
  width = 360,
  height,
  selectedIds,
  onSelect,
  onChange,
  onHistory,
  onRegisterHistoryBridge,
  onHistoryBoundary,
  historyRevision=0,
  onContextMenu,
  editingRequest,
  clipToCanvas = true,
  pasteboardBounds,
  slideWidth,
  onionScene,
  onionOpacity = 0.2,
  disabled = false,
  viewScale = 1,
  outputScale = 3,
  isolatedGroupId,
  onEnterGroup,
  onRegisterTextFormatter,
  cropImageId,
  imageDropTargetId,
  masterScene,
  masterPageVisibility,
  drawingMode,
  onDrawPath,
}: CanvasEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const marquee = useRef<Marquee | null>(null);
  const lastEditingRequest = useRef<string | null>(null);
  const editingNode = useRef<HTMLDivElement>(null);
  const editingActive = useRef<string | null>(null);
  const editingOriginal = useRef<TextElement | null>(null);
  const editingSnapshot = useRef<{ source: string; html: string | undefined;node:HTMLElement|null } | null>(null);
  const editingAccepted=useRef(true);
  const observedHistoryRevision=useRef(historyRevision);
  const formatSerial = useRef(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSeed, setEditingSeed] = useState("");
  const [live, setLive] = useState<CanvasScene | null>(null);
  const [previewSelectedIds,setPreviewSelectedIds]=useState<string[]|null>(null);
  const [selectionArea, setSelectionArea] = useState<Box | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const richRange = useRef<Range | null>(null);
  const cropGesture = useRef<CropGesture|null>(null);
  const [pathPoints,setPathPoints]=useState<Point[]>([]);
  const [dragFrameId,setDragFrameId]=useState<string|null>(null);
  const currentScene = live ?? scene;
  const isolationIds = useMemo(() => isolatedGroupId ? new Set(groupMemberIds(currentScene, isolatedGroupId)) : null,[currentScene,isolatedGroupId]);
  const inScope = useCallback((element: CanvasElement) => !isolationIds || isolationIds.has(element.id),[isolationIds]);
  const cropLatest = useRef<CanvasScene | null>(null);
  const slideCount = slideWidth && Number.isFinite(slideWidth) && slideWidth > 0
    ? Math.min(20, Math.ceil(width / slideWidth)) : 0;
  const clippedIds = new Set(clipToCanvas ? currentScene.elements
    .filter((element) => !isElementHidden(currentScene, element) && elementIntersectsCanvas(element, width, height))
    .map((element) => element.id) : []);
  const previewSelection=previewSelectedIds??selectedIds;
  const selected = currentScene.elements.filter((element) =>
    !isElementHidden(currentScene,element) && inScope(element) && previewSelection.includes(element.id),
  );
  const selectionBox = selected.length ? selectionBounds(selected) : null;
  const editingElement = currentScene.elements.find(
    (element): element is TextElement =>
      !isElementHidden(currentScene, element) && inScope(element) && element.id === editingId && element.type === "text",
  );
  function updateEditing(cancel = false, formatting = false, extra?: Partial<TextElement>): CanvasScene {
    editingAccepted.current=true;
    const id = editingActive.current;
    if (!id) return scene;
    const html = editingNode.current ? editorRichHtml(editingNode.current) : undefined;
    if (!cancel && !extra && html === editingSnapshot.current?.html) return scene;
    const value = cancel
      ? (editingOriginal.current?.text ?? "")
      : html === undefined ? editingNode.current?.innerText ?? "" : richTextToPlain(html);
    const previous = scene.elements.find((element) => element.id === id);
    if (previous?.type !== "text" || disabled || !canEditElement(scene,previous,"content") || isElementHidden(scene,previous) || !inScope(previous)) return scene;
    const measuredHeight = cancel ? editingOriginal.current?.height ?? previous.height : previous.textMode === "auto-height" && canEditElement(scene,previous,"position") ? clamp(editingNode.current?.scrollHeight ?? previous.height,1,10000) : previous.height;
    // Growing a rotated box keeps its top edge anchored in the same place.
    const shift = rotate(
      { x: 0, y: (measuredHeight - previous.height) / 2 },
      previous.rotation,
    );
    const usedTextures=new Set([...html?.matchAll(/data-texture-id="([a-zA-Z0-9_-]+)"/g)??[]].map(match=>match[1]));
    const wordTextures=(extra?.wordTextures??previous.wordTextures)?.filter(texture=>usedTextures.has(texture.id));
    const replacement = bounded(
      cancel && editingOriginal.current
        ? editingOriginal.current
        : {
            ...previous,
            ...extra,
            wordTextures:wordTextures?.length?wordTextures:undefined,
            text: value.slice(0, 20_000),
            richText: html,
            height: measuredHeight,
            x: previous.x + shift.x,
            y: previous.y + shift.y - (measuredHeight - previous.height) / 2,
          },
    );
    if (JSON.stringify(previous) === JSON.stringify(replacement)) return scene;
    const next = {
      ...scene,
      elements: scene.elements.map((element) =>
        element.id === id ? replacement : element,
      ),
    };
    // Keep the DOM's original React text child stable while editing. Publishing
    // scene changes here drives autosave without replacing the caret/selection.
    if(onChange(next, formatting ? `text-format:${id}:${++formatSerial.current}` : `text:${id}`)===false){editingAccepted.current=false;return scene;}
    editingSnapshot.current = { source: replacement.type==='text'?textEditingFingerprint(replacement):"", html,node:editingNode.current };
    return next;
  }

  function captureFormatting() {
    const node=editingNode.current;
    return node&&editingElement?captureTextFormattingTarget(node,richRange.current,editingElement.id):null;
  }
  function formatRange(patch:TextFormattingPatch,expected?:TextFormattingTarget) {
    const node=editingNode.current; const range=richRange.current;
    if(expected&&!sameTextFormattingTarget(captureFormatting(),expected))throw new Error("The word selection changed while the photo was loading. Select the words and try again.");
    if(!node||!range||disabled||!editingElement||!canEditElement(scene,editingElement,"content")||!canEditElement(scene,editingElement,"style"))return false;
    if(patch.textureFill && (editingElement.wordTextures?.length??0)>=30)throw new Error("A text layer supports up to 30 word textures. Remove a texture before adding another.");
    const textureId=patch.textureFill?crypto.randomUUID():null;
    if(!formatTextRange(node,range,patch,textureId))return false;
    const html=editorRichHtml(node),used=new Set([...html?.matchAll(/data-texture-id="([a-zA-Z0-9_-]+)"/g)??[]].map(match=>match[1]));
    const wordTextures=[...(editingElement.wordTextures??[]),...(patch.textureFill&&textureId?[{...patch.textureFill,id:textureId}]:[])].filter(texture=>used.has(texture.id));
    richRange.current=range.cloneRange();updateEditing(false,true,{wordTextures:wordTextures.length?wordTextures:undefined});return editingAccepted.current;
  }
  function toggleRange(key: "fontWeight" | "italic" | "underline" | "strikethrough") {
    const node=editingNode.current, range=richRange.current;
    return node && range && editingElement ? formatRange(textRangeTogglePatch(node,range,key,editingElement)) : false;
  }
  useEffect(()=>{
    const remember=()=>{const s=window.getSelection();if(s?.rangeCount&&editingNode.current?.contains(s.anchorNode))richRange.current=s.isCollapsed?null:s.getRangeAt(0).cloneRange();};
    document.addEventListener('selectionchange',remember);return()=>document.removeEventListener('selectionchange',remember);
  },[]);
  useEffect(()=>{onRegisterTextFormatter?.(editingId?Object.assign(formatRange,{capture:captureFormatting}):null);return()=>onRegisterTextFormatter?.(null);});
  useEffect(()=>{onRegisterHistoryBridge?.({flush:()=>{updateEditing();return editingAccepted.current;}});return()=>onRegisterHistoryBridge?.(null);});
  useLayoutEffect(()=>{
    if(disabled||live||editingId)return;
    let changed=false;
    const elements=scene.elements.map(element=>{
      if(element.type!=="text"||!element.textMode||element.textMode==="fixed"||isElementHidden(scene,element)||!inScope(element))return element;
      const text=[...root.current?.querySelectorAll<HTMLElement>("[data-element-id] .te-canvas-text")??[]].find(node=>node.closest<HTMLElement>("[data-element-id]")?.dataset.elementId===element.id);
      if(!text)return element;
      if(element.textMode==="auto-height"){
        if(!canEditElement(scene,element,"position"))return element;
        const height=clamp(text.scrollHeight,1,10000);
        if(Math.abs(height-element.height)<.5)return element;
        const shift=rotate({x:0,y:(height-element.height)/2},element.rotation);
        changed=true;return {...element,height,x:element.x+shift.x,y:element.y+shift.y-(height-element.height)/2};
      }
      if(!canEditElement(scene,element,"style"))return element;
      const spans=[...text.querySelectorAll<HTMLElement>("[style]")].filter(node=>Boolean(node.style.fontSize)).map(node=>({node,size:parseFloat(node.style.fontSize)}));
      const setSize=(size:number)=>{text.style.fontSize=`${size}px`;spans.forEach(span=>{span.node.style.fontSize=`${Math.max(1,span.size*size/element.fontSize)}px`;});};
      const fits=()=>text.scrollHeight<=element.height+.5&&text.scrollWidth<=element.width+.5;
      if(fits())return element;
      let low=1,high=element.fontSize;
      for(let attempt=0;attempt<12;attempt++){const size=(low+high)/2;setSize(size);if(fits())low=size;else high=size;}
      const size=Math.floor(low*100)/100;
      text.style.fontSize=`${element.fontSize}px`;spans.forEach(span=>{span.node.style.fontSize=`${span.size}px`;});
      if(Math.abs(size-element.fontSize)<.01)return element;
      changed=true;return {...element,fontSize:size,richText:scaleRichTextFonts(element.richText,size/element.fontSize)};
    });
    if(changed)onChange({...scene,elements},"text-fit");
  },[scene,disabled,live,editingId,onChange,isolatedGroupId,inScope]);

  useLayoutEffect(() => {
    if (!editingId || !editingNode.current) return;
    const node = editingNode.current;
    const original = editingOriginal.current;
    if (original) node.innerHTML = splitRichLines(original.richText ? resolveRichDecorations(original.richText, original.underline, original.strikethrough) : undefined, original.text).map(line => `<div>${line || "<br>"}</div>`).join("");
    if (original) editingSnapshot.current = { source: textEditingFingerprint(original), html: editorRichHtml(node),node };
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingId]);

  useLayoutEffect(() => {
    const node = editingNode.current;
    if (!editingId || !node) return;
    const element = scene.elements.find((item): item is TextElement => item.id === editingId && item.type === "text");
    if (!element) return;
    const source = textEditingFingerprint(element);
    if (source === editingSnapshot.current?.source && node===editingSnapshot.current?.node) return;
    // Journal travel and other document updates replace only the editor DOM;
    // ordinary input has already recorded this snapshot and keeps its caret.
    const focused=document.activeElement===node,selection=window.getSelection();
    const previousRange=selection?.rangeCount&&node.contains(selection.getRangeAt(0).commonAncestorContainer)?selection.getRangeAt(0):richRange.current;
    const bookmark=captureTextSelection(node,previousRange);
    node.innerHTML = splitRichLines(element.richText ? resolveRichDecorations(element.richText,element.underline,element.strikethrough) : undefined,element.text).map(line=>`<div>${line || "<br>"}</div>`).join("");
    editingSnapshot.current = { source, html: editorRichHtml(node),node };
    const range=document.createRange();
    if(bookmark)restoreTextSelection(node,range,bookmark);else{range.selectNodeContents(node);range.collapse(false);}
    richRange.current=range.collapsed?null:range.cloneRange();
    if(focused){selection?.removeAllRanges();selection?.addRange(range);}
  }, [scene,editingId]);
  useLayoutEffect(()=>{
    if(observedHistoryRevision.current===historyRevision)return;
    observedHistoryRevision.current=historyRevision;
    const id=editingActive.current;if(!id)return;
    const element=scene.elements.find((item):item is TextElement=>item.id===id&&item.type==="text");
    if(!element||!selectedIds.includes(id)||isElementHidden(scene,element)||!canEditElement(scene,element,"content")){
      editingActive.current=null;editingOriginal.current=null;editingSnapshot.current=null;richRange.current=null;setEditingId(null);return;
    }
    // Escape now cancels edits since the last Undo/Redo rather than restoring
    // a stale session baseline from before the journal traveled.
    editingOriginal.current=element;
  },[historyRevision,scene,selectedIds]);

  useEffect(
    () => () => {
      gesture.current = null;
      marquee.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!editingRequest || disabled) return;
    const request = `${editingRequest.id}:${editingRequest.serial}`;
    if (lastEditingRequest.current === request) return;
    const element = scene.elements.find((item) => item.id === editingRequest.id);
    if (element?.type !== "text" || !canEditElement(scene,element,'content') || isElementHidden(scene,element) || !inScope(element)) return;
    let cancelled = false;
    // Defer until a context menu has released its focus and restored the
    // canvas. Repeated scene changes during typing do not restart editing.
    queueMicrotask(() => {
      if (cancelled) return;
      lastEditingRequest.current = request;
      onHistoryBoundary?.();
      onSelect([element.id]);
      editingActive.current = element.id;
      editingOriginal.current = element;
      setEditingSeed(element.text);
      setEditingId(element.id);
    });
    return () => { cancelled = true; };
  }, [editingRequest, scene, disabled, onSelect,inScope,onHistoryBoundary]);

  function position(event: { clientX: number; clientY: number }): Point {
    const bounds = root.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * width) / bounds.width,
      y: ((event.clientY - bounds.top) * height) / bounds.height,
    };
  }

  function finishEditing(cancel = false): CanvasScene {
    const next = updateEditing(cancel);
    if(!editingAccepted.current&&!cancel)return next;
    editingActive.current = null;
    editingOriginal.current = null;
    editingSnapshot.current = null;
    richRange.current = null;
    setEditingId(null);
    onHistoryBoundary?.();
    return next;
  }

  function startEditing(element: CanvasElement) {
    if (disabled || !canEditElement(scene,element,'content') || isElementHidden(scene,element) || !inScope(element) || element.type !== "text") return;
    if (editingActive.current && editingActive.current !== element.id)
      finishEditing();
    if(editingActive.current===element.id){editingNode.current?.focus({preventScroll:true});return;}
    if(editingActive.current)return;
    onHistoryBoundary?.();
    onSelect([element.id]);
    editingActive.current = element.id;
    editingOriginal.current = element;
    setEditingSeed(element.text);
    setEditingId(element.id);
  }

  function begin(
    event: ReactPointerEvent,
    kind: Gesture["kind"],
    ids: string[],
    handle?: Handle,
  ) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const source = finishEditing();
    const movable = source.elements.filter(
      (element) => ids.includes(element.id) && inScope(element) && !isElementLocked(source,element) && !isElementHidden(source,element) && !element.protected?.includes('position'),
    );
    if (!movable.length) return;
    root.current?.focus({ preventScroll: true });
    // Keep capture on the pressed layer/handle so a stationary double-click
    // still reaches that layer instead of being retargeted to the canvas root.
    const capture = event.currentTarget as HTMLElement;
    capture.setPointerCapture(event.pointerId);
    gesture.current = {
      kind,
      pointer: event.pointerId,
      capture,
      start: position(event),
      source,
      latest: source,
      ids: movable.map((element) => element.id),
      bounds: selectionBounds(movable, kind !== "move"),
      handle,
      moved: false,
      duplicateRequested: kind === "move" && event.altKey,
      originalSelection: [...selectedIds],
    };
  }

  function selectElement(event: ReactPointerEvent, element: CanvasElement) {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    if (drawingMode === "pen") { event.preventDefault(); root.current?.focus({preventScroll:true}); setPathPoints(points => [...points,position(event)]); return; }
    if (!inScope(element)) return;
    if(cropImageId===element.id&&photoContent(element)&&canEditElement(scene,element,'content')&&canEditElement(scene,element,'style')){event.preventDefault();root.current?.focus({preventScroll:true});const capture=event.currentTarget as HTMLElement;capture.setPointerCapture(event.pointerId);cropLatest.current=null;cropGesture.current={pointer:event.pointerId,start:position(event),source:element,capture};return;}
    const ids=expandGroupSelection(scene,[element.id],isolatedGroupId??undefined);
    const exists = selectedIds.includes(element.id);
    const next = event.shiftKey
      ? exists
        ? selectedIds.filter((id) => !ids.includes(id))
        : [...new Set([...selectedIds, ...ids])]
      : exists
        ? selectedIds
        : ids;
    onSelect(next);
    if (!canEditElement(scene,element,"position") || (event.shiftKey && exists)) {
      event.preventDefault();
      finishEditing();
      root.current?.focus({ preventScroll: true });
      return;
    }
    begin(event, "move", next);
  }

  function beginMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || gesture.current || marquee.current) return;
    if(drawingMode==='pen'){event.preventDefault();root.current?.focus({preventScroll:true});setPathPoints(points=>[...points,position(event)]);return;}
    event.preventDefault();
    const source = finishEditing();
    const capture = event.currentTarget;
    const point = position(event);
    root.current?.focus({ preventScroll: true });
    capture.setPointerCapture(event.pointerId);
    marquee.current = {
      pointer: event.pointerId, capture,
      start: point,
      source, previousIds: [...selectedIds], baseIds: event.shiftKey ? selected.map((element) => element.id) : [], moved: false,
    };
    if (!event.shiftKey) onSelect([]);
  }

  function endMarquee(cancel = false) {
    const active = marquee.current;
    if (!active) return;
    marquee.current = null;
    if (active.capture.hasPointerCapture(active.pointer)) active.capture.releasePointerCapture(active.pointer);
    setSelectionArea(null);
    if (cancel) onSelect(active.previousIds);
  }

  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onContextMenu || disabled) return;
    const target = event.target instanceof Element ? event.target : null;
    // The tool-wide provider preserves text selection and its editing menu.
    if (target?.closest("[contenteditable=true]")) return;
    event.preventDefault();
    event.stopPropagation();
    endCrop(true);
    end(true);
    endMarquee(true);
    finishEditing();
    const hitId = target?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
    const targetId = hitId ?? (target?.closest("[data-canvas-selection]") ? selectedIds[0] : null) ?? null;
    if (targetId && scene.elements.some((element) => element.id === targetId)) {
      if (!selectedIds.includes(targetId)) onSelect([targetId]);
    } else onSelect([]);
    onContextMenu(event, targetId);
  }

  function endCrop(cancel = false) {
    const active = cropGesture.current;
    if (!active) return;
    cropGesture.current = null;
    const nextElement = cropLatest.current?.elements.find(element => element.id === active.source.id);
    const current = scene.elements.find(element=>element.id===active.source.id);
    const nextPhoto = nextElement && photoContent(nextElement), currentPhoto = current && photoContent(current);
    const scoped = !isolatedGroupId || groupMemberIds(scene,isolatedGroupId).includes(active.source.id);
    if (!cancel && !disabled && nextPhoto && currentPhoto && current && scoped && !isElementHidden(scene,current) && canEditElement(scene,current,"content") && canEditElement(scene,current,"style") && (nextPhoto.cropX!==currentPhoto.cropX || nextPhoto.cropY!==currentPhoto.cropY || nextPhoto.cropScale!==currentPhoto.cropScale)) {
      onChange({...scene,elements:scene.elements.map(element => element.id === current.id ? updatePhotoContent(element,{cropX:nextPhoto.cropX,cropY:nextPhoto.cropY,cropScale:nextPhoto.cropScale}) : element)},"crop");
    }
    cropLatest.current=null;setLive(null);
    if(active.capture.hasPointerCapture(active.pointer))active.capture.releasePointerCapture(active.pointer);
  }
  useEffect(() => {
    const node=root.current;
    if(!node||!cropImageId||disabled)return;
    const wheel=(event:WheelEvent)=>{
      const target=scene.elements.find(element=>element.id===cropImageId);
      if(!target||!photoContent(target)||!canEditElement(scene,target,"content")||!canEditElement(scene,target,"style")||isElementHidden(scene,target)||!inScope(target))return;
      event.preventDefault();event.stopPropagation();
      const source=cropLatest.current??scene;
      const current=source.elements.find(element=>element.id===target.id);
      const photo=current&&photoContent(current);
      if(!photo)return;
      const next={...source,elements:source.elements.map(element=>element.id===target.id?updatePhotoContent(element,{cropScale:clamp((photo.cropScale??1)-event.deltaY*.002,1,10)}):element)};
      if(cropGesture.current){cropLatest.current=next;setLive(next);}else onChange(next,"crop-scale");
    };
    node.addEventListener("wheel",wheel,{passive:false});return()=>node.removeEventListener("wheel",wheel);
  },[scene,cropImageId,disabled,onChange,inScope]);

  function move(event: ReactPointerEvent) {
    const cropping = cropGesture.current;
    if (cropping && cropping.pointer === event.pointerId) {
      event.preventDefault();
      const image = scene.elements.find(element => element.id === cropping.source.id);
      const startPhoto = photoContent(cropping.source);
      if (!image || !photoContent(image) || !startPhoto || !canEditElement(scene,image,"content") || !canEditElement(scene,image,"style") || isElementHidden(scene,image) || !inScope(image)) { endCrop(true); return; }
      const point=position(event), local=rotate({x:point.x-cropping.start.x,y:point.y-cropping.start.y},-image.rotation);
      const liveElement=cropLatest.current?.elements.find(item=>item.id===image.id), livePhoto=liveElement&&photoContent(liveElement);
      const next = { ...scene, elements:scene.elements.map(element => element.id === image.id ? updatePhotoContent(element,{cropX:clamp(startPhoto.cropX-local.x/image.width*100,0,100),cropY:clamp(startPhoto.cropY-local.y/image.height*100,0,100),...(livePhoto?{cropScale:livePhoto.cropScale}:{})}) : element) };
      cropLatest.current=next; setLive(next); return;
    }
    const selecting = marquee.current;
    if (selecting && selecting.pointer === event.pointerId) {
      event.preventDefault();
      const point = position(event);
      const { x, y } = point;
      const gestureScale = root.current!.getBoundingClientRect().width / width;
      if (!selecting.moved && Math.hypot(x - selecting.start.x, y - selecting.start.y) * gestureScale < 3) return;
      selecting.moved = true;
      const area = { x: Math.min(selecting.start.x, x), y: Math.min(selecting.start.y, y), width: Math.abs(x - selecting.start.x), height: Math.abs(y - selecting.start.y), rotation: 0 };
      setSelectionArea(area);
      const hitIds = selecting.source.elements.filter((element) => {
        if (isElementLocked(selecting.source,element) || isElementHidden(selecting.source,element) || !inScope(element)) return false;
        if (!clipToCanvas || !elementIntersectsCanvas(element, width, height)) return intersectsMarquee(element, area);
        // A partly clipped layer can only be selected through its visible area.
        const left = Math.max(0, area.x), top = Math.max(0, area.y);
        const visible = { x: left, y: top, width: Math.min(width, area.x + area.width) - left, height: Math.min(height, area.y + area.height) - top, rotation: 0 };
        return visible.width > 0 && visible.height > 0 && intersectsMarquee(element, visible);
      }).map((element) => element.id);
      onSelect([...new Set([...selecting.baseIds, ...expandGroupSelection(selecting.source, hitIds, isolatedGroupId ?? undefined)])]);
      return;
    }
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.preventDefault();
    const point = position(event);
    let delta = { x: point.x - active.start.x, y: point.y - active.start.y };
    const gestureScale = root.current!.getBoundingClientRect().width / width;
    if (!active.moved && Math.hypot(delta.x, delta.y) * gestureScale < 2) return;
    if (!active.moved && active.duplicateRequested) {
      const duplicate = duplicateSelection(active.source, active.ids, { x: active.bounds.x, y: active.bounds.y });
      if (duplicate.limited || duplicate.scene === active.source) { end(true); return; }
      if(isolatedGroupId){const addedGroups=(duplicate.scene.groups??[]).filter(group=>!(active.source.groups??[]).some(existing=>existing.id===group.id));const duplicatedRoot=addedGroups.filter(group=>!group.parentId);const removeRoots=new Set(duplicatedRoot.map(group=>group.id));duplicate.scene={...duplicate.scene,groups:duplicate.scene.groups?.filter(group=>!removeRoots.has(group.id)).map(group=>group.parentId&&removeRoots.has(group.parentId)?{...group,parentId:isolatedGroupId}:group),elements:duplicate.scene.elements.map(element=>duplicate.selectedIds.includes(element.id)&&element.groupId&&removeRoots.has(element.groupId)?{...element,groupId:isolatedGroupId}:element)};}
      active.originalScene = active.source; active.source = duplicate.scene; active.latest = duplicate.scene; active.ids = duplicate.selectedIds;
      // Keep the original selection in the journal until this preview commits.
      setPreviewSelectedIds(active.ids);
    }
    active.moved = true;
    active.dropPoint=point; active.bypassFrame=event.altKey || Boolean(active.originalScene);
    const sourceImage=active.ids.length===1?scene.elements.find(element=>element.id===active.ids[0]):undefined;
    const frame=active.kind === "move" && !active.bypassFrame && sourceImage?.type === "image" && canEditElement(scene,sourceImage,"content") && canEditElement(scene,sourceImage,"delete") ? findPhotoFrameAtPoint(scene,point,{excludedIds:active.ids,isolationGroupId:isolatedGroupId}) : null;
    active.dropTargetId=frame?.id;setDragFrameId(frame?.id??null);
    const sourceElements = active.source.elements.filter((element) =>
      active.ids.includes(element.id),
    );
    let elements: CanvasElement[];
    if (active.kind === "move") {
      const axis=event.shiftKey?(Math.abs(delta.x)>Math.abs(delta.y)?'x':'y'):undefined;
      if(axis)delta={x:axis==='x'?delta.x:0,y:axis==='y'?delta.y:0};
      const snap=snapMove(active.source,active.ids,active.bounds,delta,{width,height,slideWidth,outputScale,scale:gestureScale,disabled:event.altKey,axis});
      setGuides(snap.guides);elements=translateElements(sourceElements,snap.delta);
    } else if (active.kind === "resize") {
      if(!active.bounds.rotation){const handle=active.handle!;const tip={x:active.bounds.x+(handle.includes("w")?0:handle.includes("e")?active.bounds.width:active.bounds.width/2)+delta.x,y:active.bounds.y+(handle.includes("n")?0:handle.includes("s")?active.bounds.height:active.bounds.height/2)+delta.y};const snap=snapPoint(active.source,active.ids,tip,{width,height,slideWidth,outputScale,scale:gestureScale,disabled:event.altKey});delta={x:delta.x+snap.delta.x,y:delta.y+snap.delta.y};setGuides(snap.guides);}
      elements =
        sourceElements.length === 1
          ? [
              resizeSingle(
                sourceElements[0],
                active.handle!,
                delta,
                event.shiftKey,
                event.altKey,
              ),
            ]
          : resizeGroup(sourceElements, active.bounds, active.handle!, delta, event.altKey);
    } else {
      const pivot = center(active.bounds);
      const startAngle = Math.atan2(
        active.start.y - pivot.y,
        active.start.x - pivot.x,
      );
      const currentAngle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
      let angle = (currentAngle - startAngle) / RAD;
      if (event.shiftKey)
        angle =
          Math.round((active.bounds.rotation + angle) / 15) * 15 -
          active.bounds.rotation;
      elements = sourceElements.map((element) => {
        const midpoint = center(element);
        const offset = rotate(
          { x: midpoint.x - pivot.x, y: midpoint.y - pivot.y },
          angle,
        );
        return {
          ...element,
          x: round(pivot.x + offset.x - element.width / 2),
          y: round(pivot.y + offset.y - element.height / 2),
          rotation: round((((element.rotation + angle) % 360) + 360) % 360),
        };
      });
    }
    elements = elements.map(element => {
      const original=sourceElements.find(source=>source.id===element.id);
      if(!original||canEditElement(active.source,original,"style"))return element;
      return {...element,...(original.type==="text"?{fontSize:original.fontSize,letterSpacing:original.letterSpacing,richText:original.richText,padding:original.padding,paragraphSpacing:original.paragraphSpacing}:original.type==="shape"?{radius:original.radius,strokeWidth:original.strokeWidth}:{radius:original.radius})} as CanvasElement;
    });
    const replacements = new Map(
      elements.map((element) => [element.id, bounded(element)]),
    );
    active.latest = {
      ...active.source,
      elements: active.source.elements.map(
        (element) => replacements.get(element.id) ?? element,
      ),
    };
    setLive(active.latest);
    const scroll=root.current?.closest<HTMLElement>('.te-canvas-space');if(scroll){const b=scroll.getBoundingClientRect();scroll.scrollBy({left:event.clientX<b.left+24?-12:event.clientX>b.right-24?12:0,top:event.clientY<b.top+24?-12:event.clientY>b.bottom-24?12:0});}
  }

  function end(cancel = false) {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.capture.hasPointerCapture(active.pointer))
      active.capture.releasePointerCapture(active.pointer);
    setLive(null);
    setPreviewSelectedIds(null);
    setGuides([]);
    setDragFrameId(null);
    if(!active.bypassFrame&&active.dropTargetId&&active.dropPoint)active.dropTargetId=findPhotoFrameAtPoint(scene,active.dropPoint,{excludedIds:active.ids,isolationGroupId:isolatedGroupId})?.id;
    if (cancel && active.originalSelection) onSelect(active.originalSelection);
    if (!cancel && active.moved && !disabled) {
      const next = commitCanvasGesture(scene,active);
      if (next !== scene && onChange(next)!==false) { if(active.originalScene)onSelect(active.ids);else if(active.dropTargetId&&!active.bypassFrame&&!next.elements.some(element=>active.ids.includes(element.id)))onSelect([active.dropTargetId]); }
    }
  }

  // Editing uses the same typography and box styles as the saved renderer.
  // Hide only the saved text beneath the plaintext contenteditable surface.
  const dropFrame=currentScene.elements.find((element):element is ShapeElement=>element.id===(imageDropTargetId??dragFrameId)&&element.type==="shape"&&!isElementHidden(currentScene,element)&&inScope(element));
  const displayScene = editingId
    ? {
        ...currentScene,
        elements: currentScene.elements.map((element) =>
          element.id === editingId ? { ...element, opacity: 0 } : element,
        ),
      }
    : currentScene;

  return (
    <div
      ref={root}
      className={`te-canvas-editor${disabled ? " is-disabled" : ""}${live ? " is-transforming" : ""}${selectionArea ? " is-selecting" : ""}`}
      style={{ width, height, background: onionScene ? currentScene.background : undefined,"--te-handle-size":`${9/viewScale}px`,"--te-handle-hit":`${6/viewScale}px`,"--te-control-scale":1/viewScale } as CSSProperties}
      role="region"
      aria-label="Design canvas"
      tabIndex={0}
      onPointerDown={beginMarquee}
      onContextMenu={openContextMenu}
      onPointerMove={move}
      onPointerUp={(event) => {
        if(cropGesture.current?.pointer===event.pointerId)endCrop();
        if (gesture.current?.pointer === event.pointerId) end();
        if (marquee.current?.pointer === event.pointerId) endMarquee();
      }}
      onPointerCancel={() => { endCrop(true);end(true); endMarquee(true); }}
      onLostPointerCapture={() => { endCrop(true);end(true); endMarquee(true); }}
      onKeyDown={(event) => {
        if(drawingMode&&!disabled){if(event.key==='Enter'&&pathPoints.length>1){event.preventDefault();event.stopPropagation();const x=Math.min(...pathPoints.map(p=>p.x)),y=Math.min(...pathPoints.map(p=>p.y)),w=Math.max(1,Math.max(...pathPoints.map(p=>p.x))-x),h=Math.max(1,Math.max(...pathPoints.map(p=>p.y))-y);onDrawPath?.({id:crypto.randomUUID(),type:'shape',name:'Path',shape:'path',...(isolatedGroupId?{groupId:isolatedGroupId}:{}),x:clamp(x,-10000,10000),y:clamp(y,-10000,10000),width:Math.min(10000,w),height:Math.min(10000,h),rotation:0,opacity:1,locked:false,fill:pathPoints.length>2?'#ffffff':'transparent',stroke:'#ffffff',strokeWidth:1,radius:0,path:`M${pathPoints.map(p=>`${p.x-x} ${p.y-y}`).join(' L')}${pathPoints.length>2?' Z':''}`,viewBox:`0 0 ${w} ${h}`});setPathPoints([]);return;}if(event.key==='Escape'){event.stopPropagation();setPathPoints([]);return;}if(event.key==='Backspace'){event.preventDefault();event.stopPropagation();setPathPoints(p=>p.slice(0,-1));return;}}
        if (gesture.current || marquee.current || cropGesture.current) {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            endCrop(true);
            end(true);
            endMarquee(true);
          }
          return;
        }
        if (
          event.key === "Enter" &&
          event.target === event.currentTarget &&
          selected.length === 1 &&
          selected[0].type === "text"
        ) {
          event.preventDefault();
          event.stopPropagation();
          startEditing(selected[0]);
        }
      }}
    >
      <div className="te-canvas-pasteboard-hit" aria-hidden="true" style={pasteboardBounds ? {left: pasteboardBounds.x, top: pasteboardBounds.y, width: pasteboardBounds.width, height: pasteboardBounds.height} : {inset: 0}} />
      {onionScene && (
        <div className="te-canvas-onion-skin" data-onion-skin="true" aria-hidden="true" style={{opacity: Number.isFinite(onionOpacity) ? clamp(onionOpacity, 0, 1) : 0.2}}>
          <SceneRenderer scene={{...onionScene, background: "transparent"}} />
        </div>
      )}
      <div className="te-canvas-scene te-canvas-editor-scene" style={{background: onionScene ? "transparent" : displayScene.background}}>
        {masterScene&&Array.from({length:slideCount||1},(_,index)=>masterPageVisibility?.[index]!==false&&<div className="te-canvas-master-page" key={index} data-master-slide={index} style={{left:index*(slideWidth??width),width:slideWidth??width,height}}><SceneRenderer scene={{...masterScene,background:"transparent"}} isolate={false}/></div>)}
        {displayScene.elements.filter((element) => !isElementHidden(displayScene,element)).map((element) => (
          <div key={element.id} className={`te-canvas-page-layer${clippedIds.has(element.id) ? " is-clipped" : ""}${!inScope(element)?" is-outside-isolation":""}`}>
            <SceneElement element={element} />
          </div>
        ))}
      </div>
      <div className="te-canvas-hit-area" aria-label="Canvas layers">
        {currentScene.elements.filter((element) => !isElementHidden(currentScene,element) && inScope(element)).map((element) => (
          <div key={element.id} className={`te-canvas-page-layer${clippedIds.has(element.id) ? " is-clipped" : ""}`}>
          <WorldClip bounds={element.clipBounds}><div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${element.name || element.type} layer${isElementLocked(currentScene,element) ? ", locked" : ""}`}
            aria-pressed={previewSelection.includes(element.id)}
            aria-disabled={disabled}
            className={`te-canvas-hit${isElementLocked(currentScene,element) ? " is-locked" : ""}${previewSelection.includes(element.id) ? " is-selected" : ""}`}
            data-layer-id={element.id}
            title={isElementLocked(currentScene,element) ? `${element.name || element.type} · Locked` : `${element.name || element.type} · Drag to move${element.type === "text" ? " · Double-click to edit" : ""} · Right-click for actions`}
            style={{...boxStyle(element),"--te-hit-pad-x":`${Math.max(minimumHitPadding(element,viewScale).x,shapeStrokeOutset(element))}px`,"--te-hit-pad-y":`${Math.max(minimumHitPadding(element,viewScale).y,shapeStrokeOutset(element))}px`} as CSSProperties}
            onPointerDown={(event) => selectElement(event, element)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if(drawingMode)return;
              if(element.groupId&&element.groupId!==isolatedGroupId){onEnterGroup?.(element.groupId);return;}
              startEditing(element);
            }}
            onKeyDown={(event) => {
              if (disabled || drawingMode) return;
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Enter" && selectedIds.includes(element.id))
                  startEditing(element);
                else
                  onSelect(
                    event.shiftKey
                      ? selectedIds.includes(element.id)
                        ? selectedIds.filter((id) => id !== element.id)
                        : [...selectedIds, element.id]
                      : [element.id],
                  );
              }
            }}
          /></WorldClip>
          </div>
        ))}
      </div>
      {dropFrame && <div className="te-canvas-frame-drop-preview" aria-hidden="true" data-frame-drop-target={dropFrame.id}><SceneElement element={{...dropFrame,id:`drop-preview-${dropFrame.id}`,imageFill:undefined,fill:"#9a86ff33",gradient:undefined,stroke:"#9a86ff",strokeWidth:2/viewScale,strokeAlign:"inside",strokeDash:[4/viewScale,3/viewScale],opacity:1,shadow:undefined,blur:0,blendMode:"normal"}} /></div>}
      {slideCount > 0 && (
        <div className="te-canvas-slide-guides" aria-hidden="true">
          {Array.from({length: slideCount}, (_, index) => (
            <div key={index} className="te-canvas-slide-marker" style={{left: index * slideWidth!}}>
              <span className="te-canvas-slide-label">Slide {index + 1}</span>
              {index > 0 && <span className="te-canvas-slide-seam" />}
            </div>
          ))}
        </div>
      )}
      {editingElement && (
        <div className={`te-canvas-page-layer is-editing${clippedIds.has(editingElement.id) ? " is-clipped" : ""}`}>
        <WorldClip bounds={editingElement.clipBounds}><div
          className="te-canvas-edit-box"
          data-element-id={editingElement.id}
          style={{
            ...boxStyle(editingElement),
            opacity: editingElement.opacity,
            ...textTextureVariables(editingElement),
            justifyContent: editingElement.verticalAlign === "middle" ? "center" : editingElement.verticalAlign === "bottom" ? "flex-end" : "flex-start",
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <div
            key={editingElement.id}
            ref={editingNode}
            className={`te-canvas-text te-canvas-edit-text gf-font-${editingElement.font}`}
            contentEditable={!disabled && canEditElement(currentScene,editingElement,"content")}
            data-list-style={editingElement.listStyle ?? "none"}
            style={{...textStyle(editingElement),"--te-paragraph-spacing":`${editingElement.paragraphSpacing ?? 0}px`} as CSSProperties}
            suppressContentEditableWarning
            role="textbox"
            aria-label="Edit text"
            aria-multiline="true"
            spellCheck
            onInput={() => updateEditing()}
            onBlur={(event) => {
              if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="menu"],.te-element-inspector,.te-quick-toolbar,.te-rich-controls')) return;
              finishEditing();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              const modifier = event.metaKey || event.ctrlKey;
              const key = event.key.toLowerCase();
              const historyDirection=historyShortcut(event.nativeEvent);
              if (historyDirection && onHistory) {
                event.preventDefault();
                updateEditing();
                if(editingAccepted.current)onHistory(historyDirection);
                return;
              }
              if (
                modifier && ["b", "i", "u"].includes(key)
              ) {
                event.preventDefault();
                const selection=window.getSelection();
                if(selection?.rangeCount)richRange.current=selection.getRangeAt(0).cloneRange();
                toggleRange(key==='b'?"fontWeight":key==='i'?"italic":"underline");
              }
              if (event.key === "Escape") {
                event.preventDefault();
                finishEditing(true);
                root.current?.focus({ preventScroll: true });
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                finishEditing();
                root.current?.focus({ preventScroll: true });
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              const text = event.clipboardData
                .getData("text/plain")
                .slice(0, 20_000);
              // insertText keeps the inline run at the caret when pasting.
              // The Range fallback remains plaintext on browsers without it.
              if (document.execCommand("insertText", false, text)) return;
              const selection = window.getSelection();
              if (!selection?.rangeCount) return;
              const range = selection.getRangeAt(0);
              if (!editingNode.current?.contains(range.commonAncestorContainer))
                return;
              range.deleteContents();
              const textNode = document.createTextNode(text);
              range.insertNode(textNode);
              range.setStartAfter(textNode);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
              updateEditing();
            }}
          >
            {editingSeed}
          </div>
          <TextureResources element={editingElement} />
        </div></WorldClip>
        </div>
      )}
      {selected.length > 1 &&
        selected.map((element) => (
          <div
            key={element.id}
            className="te-canvas-outline is-member"
            style={boxStyle(selectionBounds([element]))}
          />
        ))}
      {selectionBox && (
        <div
          className={`te-canvas-outline${selected.some((element) => isElementLocked(currentScene,element)) ? " is-locked" : ""}`}
          data-canvas-selection="true"
          style={boxStyle(selectionBox)}
        >
          {!selectionArea && (
            <span className="te-canvas-layer-label">
              {selected.length === 1 ? `${isElementLocked(currentScene,selected[0]) ? "Locked · " : ""}${selected[0].name || selected[0].type}` : `${selected.length} layers selected`}
            </span>
          )}
          {!disabled &&
            !editingId &&
            !selectionArea &&
            selected.every((element) => canEditElement(currentScene,element,"position")) && (
              <>
                {resizeHandlePolicy(selectionBox,viewScale,selected.length===1&&selected[0].type==="shape",selected.length>1).map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className={`te-canvas-handle te-canvas-handle-${handle}`}
                    aria-label={`Resize ${HANDLE_NAMES[handle]}`}
                    title={`Resize ${HANDLE_NAMES[handle]} · Shift preserves proportions · Alt resizes from center`}
                    onPointerDown={(event) =>
                      begin(event, "resize", selectedIds, handle)
                    }
                  />
                ))}
                <span className="te-canvas-rotate-line" />
                <button
                  type="button"
                  className="te-canvas-rotate"
                  aria-label="Rotate selection"
                  title="Rotate · Shift snaps to 15°"
                  onPointerDown={(event) => begin(event, "rotate", selectedIds)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      d="M13 7a5 5 0 1 0-1 4M13 3v4H9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </>
            )}
        </div>
      )}
      {selectionArea && <div className="te-canvas-marquee" style={boxStyle(selectionArea)} aria-hidden>
        <span>{selected.length} selected</span>
      </div>}
      <LayoutOverlay outputScale={outputScale} scene={scene} width={width} height={height} slideWidth={slideWidth} scale={viewScale} onChange={onChange} disabled={disabled}/>
      {drawingMode&&<svg className="te-path-preview"><polyline points={pathPoints.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeWidth={1/viewScale}/>{pathPoints.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={3/viewScale} fill="#fff"/>)}<text x="8" y="20" fill="#fff" fontSize={12/viewScale}>Click to add points · Enter to finish · Backspace to remove a point</text></svg>}
      {guides.map((guide,i)=><div key={i} className={`te-canvas-guide te-canvas-guide-${guide.axis}`} style={guide.axis==='x'?{left:guide.position,width:1/viewScale}:{top:guide.position,height:1/viewScale}}>{guide.label&&<span style={{fontSize:10/viewScale}}>{guide.label}</span>}</div>)}
      {editingElement&&<div className="te-rich-controls" style={{left:editingElement.x,top:editingElement.y-36/viewScale,transform:`scale(${1/viewScale})`,transformOrigin:'left bottom'}} onPointerDown={e=>{e.preventDefault();e.stopPropagation();}}><button type="button" aria-label="Bold selected text" onClick={()=>toggleRange("fontWeight")}><b>B</b></button><button type="button" aria-label="Italic selected text" onClick={()=>toggleRange("italic")}><i>I</i></button><button type="button" aria-label="Underline selected text" onClick={()=>toggleRange("underline")}><u>U</u></button><button type="button" aria-label="Strike selected text" onClick={()=>toggleRange("strikethrough")}><s>S</s></button><button type="button" aria-label="Clear selected text formatting" onClick={()=>formatRange({fontWeight:400,italic:false,underline:false,strikethrough:false,color:editingElement.color,font:editingElement.font,fontSize:editingElement.fontSize})}>Clear</button></div>}
      <span className="te-canvas-screen-reader">
        Drag layers to move them. Drag empty canvas to select layers. Hold Shift
        to add to the selection. Double-click text to edit. Right-click for
        actions. Escape cancels a transformation or selection.
      </span>
    </div>
  );
}
