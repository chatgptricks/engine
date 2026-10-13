"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SlideFrame } from "@/components/engine/slide-templates";
import {
  formatDimensions,
  storyForDesign,
  type DesignDocument,
  type DesignPage,
} from "@/lib/template-editor/model";
import {sceneWithPreviewAssets} from "@/lib/template-editor/media-preview";
import { composeScene } from "@/lib/template-editor/advanced";
import { SceneRenderer } from "./canvas";
import {prepareExportScene} from '@/lib/template-editor/export-renditions';
import {frameScene} from '@/lib/template-editor/export-scene';

/** A single canonical layout size makes thumbnails, canvas and exports agree. */
export const FRAME_WIDTH = 360;

export function DesignFrame({
  design,
  page,
  preview = false,
  bleed = 0,
  outputScale,
}: {
  design: DesignDocument;
  page: DesignPage;
  preview?: boolean;
  bleed?: number;
  outputScale?: number;
}) {
  const format = formatDimensions(design);
  const original = design.continuousCanvas||design.masterScene ? composeScene(design,page) : page.canvas;
  const scene=original&&bleed?{...original,elements:original.elements.map(element=>({...element,x:element.x+bleed,y:element.y+bleed,...(element.clipBounds?{clipBounds:{...element.clipBounds,x:element.clipBounds.x+bleed,y:element.clipBounds.y+bleed}}:{})}))}:original;
  const height=FRAME_WIDTH*format.height/format.width;
  const prepared=outputScale?prepareExportScene(frameScene(scene??composeScene(design,page),FRAME_WIDTH+2*bleed,height+2*bleed),outputScale,!page.canvas&&page.style.template==='masonry'?design.pages.map(item=>({src:item.image.url,intrinsicWidth:item.image.width,intrinsicHeight:item.image.height,width:FRAME_WIDTH,height,fit:'cover'})):[]):null;
  const image=(value:DesignPage['image'])=>prepared?{...value,url:prepared.sources.get(value.url)??value.url}:value;
  return (
    <div
      className="te-frame"
      data-page-id={page.id}
      style={{
        width: FRAME_WIDTH+2*bleed,
        background:bleed&&!original?composeScene(design,page).background:undefined,
        height: (FRAME_WIDTH * format.height) / format.width+2*bleed,
      }}
    >
      {scene ? (
        <SceneRenderer scene={prepared?.scene??frameScene(preview ? sceneWithPreviewAssets(scene) : scene,FRAME_WIDTH+2*bleed,FRAME_WIDTH*format.height/format.width+2*bleed)} />
      ) : (
        <div style={bleed?{position:"absolute",left:bleed,top:bleed,width:FRAME_WIDTH,height:FRAME_WIDTH*format.height/format.width}:undefined}><SlideFrame
          img={image(page.image)}
          style={page.style}
          story={storyForDesign(design)}
          gallery={design.pages.map((p) => image(p.image))}
          index={design.pages.findIndex((p) => p.id === page.id)}
        /></div>
      )}
    </div>
  );
}

export function DesignPreview(props: Parameters<typeof DesignFrame>[0]) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FRAME_WIDTH);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const format = formatDimensions(props.design);
  return (
    <div
      ref={ref}
      className="te-preview"
      data-format={props.design.format}
      style={
        {
          aspectRatio: `${format.width}/${format.height}`,
          "--te-preview-scale": width / FRAME_WIDTH,
        } as CSSProperties
      }
    >
      <div className="te-preview-inner">
        <DesignFrame {...props} preview />
      </div>
    </div>
  );
}
