"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ShapeImageFill, TextElement } from "@/lib/template-editor/model";
import { getTextWords, applyTextWordTextureToElement } from "@/lib/template-editor/text-word-textures";
import { activeTextTextures } from "@/lib/template-editor/text-textures";
import { proxied } from "@/lib/engine/util";
import { Modal } from "./controls";
import { SceneRenderer } from "./canvas";
import { prepareBrandAsset } from "./brand-workspace";
import "./dialog-tools.css";
import "./text-texture-dialog.css";

type Props = {
  element: TextElement;
  background: string;
  photos: ShapeImageFill[];
  initialWords?: number[];
  disabled: boolean;
  onClose: () => void;
  onApply: (words: "all" | number[], texture: ShapeImageFill | null) => void;
};

function TexturePreview({ element, background }: { element: TextElement; background: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(width / element.width, 100 / element.height, 1.4);
  return <div ref={ref} className="te-texture-preview" aria-label="Text texture preview" style={{ background }}>
    <div style={{ width: element.width * scale, height: element.height * scale }}>
      <div style={{ width: element.width, height: element.height, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }}>
        <SceneRenderer scene={{ background: "transparent", elements: [{ ...element, id: "texture-dialog-preview", x: 0, y: 0, rotation: 0, clipBounds: undefined, hidden: false }] }} />
      </div>
    </div>
  </div>;
}

export function TextTextureDialog({ element, background, photos, initialWords, disabled, onClose, onApply }: Props) {
  const words = useMemo(() => getTextWords(element), [element]);
  const [selected, setSelected] = useState<number[]>(() => initialWords ?? words.map(word => word.index));
  const [texture, setTexture] = useState<ShapeImageFill | null>(null);
  const [uploads, setUploads] = useState<ShapeImageFill[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const all = selected.length === words.length;
  const selection = all ? "all" : selected;
  const available = [...uploads, ...activeTextTextures(element), ...photos].filter((photo, index, items) => items.findIndex(other => other.src === photo.src) === index);
  let preview = element, previewError = "";
  if (texture && selected.length) {
    try { preview = applyTextWordTextureToElement(element, selection, texture, { textureId: "texture-preview", baseTextureId: "texture-preview-base" }); }
    catch (reason) { previewError = reason instanceof Error ? reason.message : "Choose fewer words or remove an existing texture."; }
  }
  const hasTexture = activeTextTextures(element).length > 0;
  function apply(photo: ShapeImageFill | null) {
    if (disabled || uploading || !selected.length) return;
    try { onApply(selection, photo); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply this texture."); }
  }
  async function upload(file: File) {
    setUploading(true); setError("");
    try {
      const asset = await prepareBrandAsset(file, "image");
      if (!mounted.current) return;
      const photo: ShapeImageFill = { src: asset.src, previewSrc: asset.previewSrc, alt: asset.name, objectFit: "cover", cropX: 50, cropY: 50, intrinsicWidth: asset.width, intrinsicHeight: asset.height };
      setUploads(items => [photo, ...items]); setTexture(photo);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not load this image."); }
    finally { if (mounted.current) setUploading(false); }
  }
  return <Modal title="Text texture" onClose={onClose}>
    <div className="te-tool-dialog te-texture-dialog">
      <fieldset disabled={disabled || uploading}>
        <section>
          <div className="te-texture-section-head"><h3>Choose words</h3><span>{selected.length} of {words.length}</span></div>
          <p>Tap the words you want to fill. Repeated words can be selected separately.</p>
          <div className="te-texture-selection-actions"><button type="button" className="te-text-button" onClick={() => setSelected(words.map(word => word.index))}>Select all</button><button type="button" className="te-text-button" onClick={() => setSelected([])}>Clear selection</button></div>
          <div className="te-texture-words" role="group" aria-label="Words to texture">
            {words.map(word => <button key={word.id} type="button" aria-label={`Word ${word.index + 1}: ${word.text}`} aria-pressed={selected.includes(word.index)} onClick={() => { setError(""); setSelected(items => items.includes(word.index) ? items.filter(index => index !== word.index) : [...items, word.index]); }}><span aria-hidden="true">{selected.includes(word.index) ? "✓" : "+"}</span>{word.text}</button>)}
          </div>
          {!selected.length && <p role="status">Select at least one word.</p>}
        </section>
        <section>
          <div className="te-texture-section-head"><h3>Choose an image</h3><label className="te-button te-texture-upload">{uploading ? "Loading…" : "Upload image"}<input type="file" aria-label="Upload text texture" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label></div>
          <div className="te-texture-photos" role="group" aria-label="Available textures">
            {available.map((photo, index) => <button key={photo.src} type="button" aria-label={`Use ${photo.alt || `image ${index + 1}`} texture`} aria-pressed={texture?.src === photo.src} onClick={() => { setTexture(photo); setError(""); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxied(photo.previewSrc ?? photo.src)} alt="" loading="lazy" /><span>{photo.alt || `Image ${index + 1}`}</span>
            </button>)}
          </div>
        </section>
      </fieldset>
      <TexturePreview element={preview} background={background} />
      <p className="te-texture-preview-note">{texture && selected.length ? all ? "Preview · all words" : `Preview · ${selected.length} selected word${selected.length === 1 ? "" : "s"}` : "Choose an image to preview your text."}</p>
      {(error || previewError) && <p className="te-dialog-error" role="alert">{error || previewError}</p>}
      <div className="te-dialog-footer">
        {hasTexture && <button type="button" className="te-text-button te-texture-remove" disabled={disabled || uploading || !selected.length} onClick={() => apply(null)}>{all ? "Remove all textures" : "Remove from selected words"}</button>}
        <button type="button" className="te-button" onClick={onClose}>Cancel</button>
        <button type="button" className="te-button te-primary" disabled={disabled || uploading || !texture || !selected.length || Boolean(previewError)} onClick={() => apply(texture)}>Apply texture</button>
      </div>
    </div>
  </Modal>;
}
