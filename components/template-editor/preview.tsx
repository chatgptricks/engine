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

/** A single canonical layout size makes thumbnails, canvas and exports agree. */
export const FRAME_WIDTH = 360;

export function DesignFrame({
  design,
  page,
  preview = false,
}: {
  design: DesignDocument;
  page: DesignPage;
  preview?: boolean;
}) {
  const format = formatDimensions(design);
  const scene = design.continuousCanvas||design.masterScene ? composeScene(design,page) : page.canvas;
  return (
    <div
      className="te-frame"
      style={{
        width: FRAME_WIDTH,
        height: (FRAME_WIDTH * format.height) / format.width,
      }}
    >
      {scene ? (
        <SceneRenderer scene={preview ? sceneWithPreviewAssets(scene) : scene} />
      ) : (
        <SlideFrame
          img={page.image}
          style={page.style}
          story={storyForDesign(design)}
          gallery={design.pages.map((p) => p.image)}
          index={design.pages.findIndex((p) => p.id === page.id)}
        />
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
