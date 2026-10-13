"use client";

import { useState, type ReactNode } from "react";
import { CopyIcon, TrashIcon } from "@/components/engine/icons";
import type {
  CanvasElement,
  CanvasScene,
  ImageElement,
  ShapeElement,
  TextElement,
  TextStyle,
} from "@/lib/template-editor/model";
import type { TextFormattingPatch } from "@/lib/template-editor/rich-text-editing";
import { ColorField, FontSelect, NumberField } from "./controls";
import { AdvancedProperties, ColorRolesPanel, type ColorRoleOption } from "./advanced-properties";
import { updatePhotoContent } from "@/lib/template-editor/photo-frames";
import { boldState, booleanState } from "@/lib/template-editor/property-utils";
import { alignSelectionTo, distributeSelection, matchSelectionSize, copyAppearance, pasteAppearance, applyTextTexture, duplicateSelection, removeSelection, reorderSelection, isElementLocked, canEditElement } from "@/lib/template-editor/commands";
import "./element-inspector.css";

type Props = {
  scene: CanvasScene;
  selectedIds: string[];
  onChange: (scene: CanvasScene, group?: string) => void;
  onSelect: (ids: string[]) => void;
  /** Canvas dimensions in the model's 360px-wide coordinate system. */
  width: number;
  height: number;
  disabled?: boolean;
  outputScale?: number;
  initialSection?: "edit"|"position";
  slideBounds?: { x: number; y: number; width: number; height: number };
  textStyles?: TextStyle[];
  onSaveTextStyle?: (style: TextStyle) => void;
  onDeleteTextStyle?: (id: string) => void;
  colorRoles?: ColorRoleOption[];
  onSaveColorRole?: (role: ColorRoleOption) => void;
  onDeleteColorRole?: (id: string) => void;
  onFormatText?: (patch: TextFormattingPatch) => boolean;
  onTextTexture?: () => void;
  onUploadTextTexture?: (file:File)=>Promise<void>;
  onUploadFramePhoto?: (file:File,shapeId:string)=>Promise<void>;
};

const MAX_ELEMENTS = 100;

export function changeTextCase(element: TextElement, upper: boolean): TextElement {
  const change=(text:string)=>upper?text.toUpperCase():text.toLowerCase();
  return {...element,text:change(element.text).slice(0,20_000),richText:element.richText?.replace(/<[^>]+>|&(?:#[0-9]+|#x[0-9a-f]+|[a-z]+);|[^<&]+|[<&]/gi,token=>token.startsWith("<")||token.startsWith("&")?token:change(token))};
}

function shared<T, K extends keyof T>(items: T[], key: K): T[K] | undefined {
  const first = items[0]?.[key];
  return items.every((item) => item[key] === first) ? first : undefined;
}

function Section({ title, children, disclosure = false, defaultOpen = false }: { title: string; children: ReactNode; disclosure?: boolean; defaultOpen?: boolean }) {
  if(disclosure)return <details className="te-element-section te-advanced-section" open={defaultOpen}><summary>{title}</summary><div>{children}</div></details>;
  return (
    <section className="te-element-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean | "mixed";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active === true ? "is-active" : active === "mixed" ? "is-mixed" : ""}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const x = align === "left" ? 4 : align === "right" ? 10 : 7;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <path d={`M4 5h16M${x} 10h10M4 15h16M${x} 20h10`} />
    </svg>
  );
}

function PageAlignIcon({
  align,
}: {
  align: "left" | "center" | "right" | "top" | "middle" | "bottom";
}) {
  const paths = {
    left: "M4 3v18M8 6h12v4H8zM8 14h8v4H8z",
    center: "M12 3v18M4 6h16v4H4zM7 14h10v4H7z",
    right: "M20 3v18M4 6h12v4H4zM8 14h8v4H8z",
    top: "M3 4h18M6 8h4v12H6zM14 8h4v8h-4z",
    middle: "M3 12h18M6 4h4v16H6zM14 7h4v10h-4z",
    bottom: "M3 20h18M6 4h4v12H6zM14 8h4v8h-4z",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[align]} />
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d={locked ? "M8 10V6a4 4 0 0 1 8 0v4" : "M8 10V6a4 4 0 0 1 8 0"} />
    </svg>
  );
}

export function ElementInspector({
  scene,
  selectedIds,
  onChange,
  onSelect,
  width,
  height,
  disabled = false, outputScale = 3, initialSection = "edit",
  slideBounds, textStyles, onSaveTextStyle, onDeleteTextStyle, colorRoles, onFormatText, onSaveColorRole, onDeleteColorRole, onTextTexture, onUploadTextTexture, onUploadFramePhoto,
}: Props) {
  const OUTPUT_SCALE = outputScale;
  const px = (value: number | undefined) => value === undefined ? undefined : Number((value * OUTPUT_SCALE).toFixed(2));
  const [alignmentScope, setAlignmentScope] = useState<"page" | "slide" | "selection" | "key-object">("page");
  const [alignmentMode, setAlignmentMode] = useState<"group" | "individual">("group");
  const [keyObjectId, setKeyObjectId] = useState("");
  const [distributionMode, setDistributionMode] = useState<"centers" | "gaps">("gaps");
  const [useGap, setUseGap] = useState(false);
  const [gap, setGap] = useState(24);
  const [frameUploading,setFrameUploading]=useState(false),[frameError,setFrameError]=useState("");
  const [appearance, setAppearance] = useState<ReturnType<typeof copyAppearance> | null>(null);
  const selected = new Set(selectedIds);
  const elements = scene.elements.filter((element) => selected.has(element.id));
  const editable = elements.filter((element) => !isElementLocked(scene, element));
  const displayed = editable.length ? editable : elements;
  const effectiveAlignmentScope=(alignmentScope==="slide"&&!slideBounds || (alignmentScope==="selection"||alignmentScope==="key-object")&&elements.length<2)?"page":alignmentScope;
  const texts = displayed.filter(
    (element): element is TextElement => element.type === "text",
  );
  const images:ImageElement[] = displayed.flatMap(element=>element.type==="image"?[element]:element.type==="shape"&&element.imageFill?[{...element,...element.imageFill,type:"image" as const,fit:element.imageFill.objectFit,radius:0}]:[]);
  const standaloneImages=displayed.filter((element):element is ImageElement=>element.type==="image");
  const shapes = displayed.filter(
    (element): element is ShapeElement => element.type === "shape",
  );
  const editableIds = new Set(editable.map((element) => element.id));
  const groupPrefix = `inspector:${editable.map((element) => element.id).join(",")}`;
  const allLocked = elements.length > 0 && editable.length === 0;
  const hasLocked = editable.length !== elements.length;
  const inheritedLock = elements.some(element => isElementLocked(scene, element) && !element.locked);
  const noEdits = disabled || allLocked;

  function update(
    group: string,
    transform: (element: CanvasElement) => CanvasElement,
  ) {
    if (noEdits) return;
    const metadata = ["name", "slot", "master", "anchor", "protection"].includes(group);
    const property = ["text", "uppercase", "lowercase", "image-fill", "public-alt"].includes(group) ? "content" : ["x", "y", "width", "height", "rotation", "square-shape"].includes(group) ? "position" : "style";
    const next = scene.elements.map((element) => editableIds.has(element.id) && (metadata || canEditElement(scene, element, property)) ? transform(element) : element);
    if (next.some((element, index) => element !== scene.elements[index])) onChange({ ...scene, elements: next }, `${groupPrefix}:${group}`);
  }

  function updateText(patch: Partial<TextElement>, group: string) {
    if (!noEdits && onFormatText?.(patch)) return;
    update(group, (element) =>
      element.type === "text" ? { ...element, ...patch } : element,
    );
  }

  function updateImage(patch: Partial<ImageElement>, group: string) {
    update(group, (element) =>
      element.type === "image" ? { ...element, ...patch } : updatePhotoContent(element,patch),
    );
  }

  function updateShape(patch: Partial<ShapeElement>, group: string) {
    update(group, (element) =>
      element.type === "shape" ? { ...element, ...patch } : element,
    );
  }

  function alignToPage(align: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    if (noEdits) return;
    const result = alignSelectionTo(scene, selectedIds, align, {
      scope: effectiveAlignmentScope === "slide" ? "page" : effectiveAlignmentScope,
      page: effectiveAlignmentScope === "slide" && slideBounds ? slideBounds : { x: 0, y: 0, width, height },
      mode: alignmentMode,
      keyObjectId: keyObjectId || elements[0]?.id,
    });
    if (result.scene !== scene) onChange(result.scene, "align-selection");
  }
  function reorder(direction: "forward" | "backward") {
    const result = reorderSelection(scene, selectedIds, direction);
    if (!noEdits && result.scene !== scene) onChange(result.scene);
  }
  function duplicate() {
    if (noEdits) return;
    const result = duplicateSelection(scene, selectedIds);
    if (result.scene !== scene) { onChange(result.scene); onSelect(result.selectedIds); }
  }
  function distribute(axis: "horizontal" | "vertical") {
    const result = distributeSelection(scene, selectedIds, axis, distributionMode, useGap ? gap / OUTPUT_SCALE : undefined);
    if (!noEdits && result.scene !== scene) onChange(result.scene);
  }
  function matchSize(mode: "width" | "height" | "both") {
    const result = matchSelectionSize(scene, selectedIds, mode, keyObjectId || elements[0]?.id);
    if (!noEdits && result.scene !== scene) onChange(result.scene);
  }

  function toggleLock() {
    if (disabled) return;
    // A mixed selection locks the remaining editable elements; the next click unlocks all.
    onChange({
      ...scene,
      elements: scene.elements.map((element) =>
        selected.has(element.id) ? { ...element, locked: !allLocked } : element,
      ),
    });
  }

  function remove() {
    if (noEdits) return;
    const result = removeSelection(scene, selectedIds);
    if (result.scene !== scene) { onChange(result.scene); onSelect(result.selectedIds); }
  }

  const commonFont = shared(texts, "font");
  const commonItalic = shared(texts, "italic");
  const commonUnderline = shared(texts, "underline");
  const canForward = scene.elements.some(
    (element, index) =>
      editableIds.has(element.id) &&
      index < scene.elements.length - 1 &&
      !editableIds.has(scene.elements[index + 1].id),
  );
  const canBackward = scene.elements.some(
    (element, index) =>
      editableIds.has(element.id) &&
      index > 0 &&
      !editableIds.has(scene.elements[index - 1].id),
  );
  const canDuplicate = scene.elements.length + editable.length <= MAX_ELEMENTS;
  const pageAlignLabels = {
    left: "Align left",
    center: "Center horizontally",
    right: "Align right",
    top: "Align top",
    middle: "Center vertically",
    bottom: "Align bottom",
  };

  const advancedProps={outputScale,elements:displayed,update,textStyles,onSaveTextStyle,onDeleteTextStyle,colorRoles,onSaveColorRole,onDeleteColorRole,onUploadTextTexture,onClearTextTexture:()=>{if(noEdits||onFormatText?.({textureFill:null}))return;const result=applyTextTexture(scene,selectedIds,null);if(result.scene!==scene)onChange(result.scene,"remove-text-texture");}};
  const outlineAlignment=shapes.every(shape=>(shape.strokeAlign??"center")===(shapes[0]?.strokeAlign??"center"))?(shapes[0]?.strokeAlign??"center"):"";
  const positionSection=(
            <Section key={`position-${initialSection}`} title="Position & size" disclosure defaultOpen={initialSection==="position"}>
              <div className="te-element-grid">
                <NumberField
                  label="X"
                  unit="px"
                  min={-10000 * OUTPUT_SCALE}
                  max={10000 * OUTPUT_SCALE}
                  value={px(shared(displayed, "x"))}
                  onChange={(value) =>
                    update("x", (element) => ({
                      ...element,
                      x: value / OUTPUT_SCALE,
                    }))
                  }
                />
                <NumberField
                  label="Y"
                  unit="px"
                  min={-10000 * OUTPUT_SCALE}
                  max={10000 * OUTPUT_SCALE}
                  value={px(shared(displayed, "y"))}
                  onChange={(value) =>
                    update("y", (element) => ({
                      ...element,
                      y: value / OUTPUT_SCALE,
                    }))
                  }
                />
                <NumberField
                  label="Width"
                  unit="px"
                  min={OUTPUT_SCALE}
                  max={10000 * OUTPUT_SCALE}
                  value={px(shared(displayed, "width"))}
                  onChange={(value) =>
                    update("width", (element) => ({
                      ...element,
                      width: value / OUTPUT_SCALE,
                    }))
                  }
                />
                <NumberField
                  label="Height"
                  unit="px"
                  min={OUTPUT_SCALE}
                  max={10000 * OUTPUT_SCALE}
                  value={px(shared(displayed, "height"))}
                  onChange={(value) =>
                    update("height", (element) => ({
                      ...element,
                      height: value / OUTPUT_SCALE,
                    }))
                  }
                />
                <NumberField
                  label="Rotation"
                  unit="°"
                  min={-3600}
                  max={3600}
                  value={shared(displayed, "rotation")}
                  onChange={(rotation) =>
                    update("rotation", (element) => ({ ...element, rotation }))
                  }
                />
                <NumberField
                  label="Opacity"
                  unit="%"
                  min={0}
                  max={100}
                  value={
                    shared(displayed, "opacity") === undefined
                      ? undefined
                      : shared(displayed, "opacity")! * 100
                  }
                  onChange={(value) =>
                    update("opacity", (element) => ({
                      ...element,
                      opacity: value / 100,
                    }))
                  }
                />
              </div>
              <label className="te-field">Align relative to<select aria-label="Alignment reference" value={effectiveAlignmentScope} onChange={event => { const value = event.target.value as typeof alignmentScope; setAlignmentScope(value); setAlignmentMode(value === "selection" || value === "key-object" ? "individual" : "group"); }}><option value="page">Canvas</option>{slideBounds && <option value="slide">Current slide</option>}<option value="selection" disabled={elements.length < 2}>Selection bounds</option><option value="key-object" disabled={elements.length < 2}>Key object</option></select></label>
              {displayed.length>1&&<label className="te-field">Selection behavior<select aria-label="Alignment behavior" value={alignmentMode} onChange={event => setAlignmentMode(event.target.value as typeof alignmentMode)}><option value="group">Keep arrangement together</option><option value="individual">Align each object</option></select></label>}
              {elements.length > 1 && <label className="te-field">Key / reference object<select aria-label="Key object" value={keyObjectId || elements[0].id} onChange={event => setKeyObjectId(event.target.value)}>{elements.map(item => <option key={item.id} value={item.id}>{item.name || item.type}</option>)}</select></label>}
              <span className="te-element-label">Align selection</span>
              <div
                className="te-element-segments te-element-align"
                role="group"
                aria-label="Align selection"
              >
                {(
                  [
                    "left",
                    "center",
                    "right",
                    "top",
                    "middle",
                    "bottom",
                  ] as const
                ).map((align) => (
                  <button
                    key={align}
                    type="button"
                    aria-label={pageAlignLabels[align]}
                    title={pageAlignLabels[align]}
                    onClick={() => alignToPage(align)}
                  >
                    <PageAlignIcon align={align} />
                  </button>
                ))}
              </div>
            </Section>
  );

  return (
    <aside
      className="te-element-inspector"
      aria-label="Element properties"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="te-element-heading">
        <div>
          <span className="te-eyebrow">
            {elements.length ? "SELECTION" : "CANVAS"}
          </span>
          <h2>
            {elements.length > 1
              ? `${elements.length} elements`
              : elements[0]?.name || "Page settings"}
          </h2>
        </div>
        {elements.length > 0 && (
          <div className="te-element-heading-actions">
            <button
              type="button"
              className="te-icon"
              aria-label={
                allLocked
                  ? "Unlock selected elements"
                  : "Lock selected elements"
              }
              title={allLocked ? "Unlock selection" : "Lock selection"}
              disabled={disabled || inheritedLock}
              onClick={toggleLock}
            >
              <LockIcon locked={allLocked} />
            </button>
            <button
              type="button"
              className="te-icon"
              aria-label="Clear selection"
              title="Clear selection"
              onClick={() => onSelect([])}
            >
              ×
            </button>
          </div>
        )}
      </header>

      {!elements.length ? (
        <>
          <fieldset disabled={disabled}>
            <Section title="Page">
              <ColorField
                label="Background"
                value={scene.background}
                onChange={(background) =>
                  onChange({ ...scene, background }, "page-background")
                }
              />
              <p className="te-element-hint">
                {Math.round(width * OUTPUT_SCALE)} ×{" "}
                {Math.round(height * OUTPUT_SCALE)} px
              </p>
            </Section>
            <ColorRolesPanel roles={colorRoles ?? []} onSave={onSaveColorRole} onDelete={onDeleteColorRole} />
          </fieldset>
          <div className="te-element-empty">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              aria-hidden
            >
              <path d="m5 3 14 10-7 1-3 7z" />
            </svg>
            <strong>Make it yours</strong>
            <p>
              Select an element to edit its style, size, and position.
              Double-click text to write directly on the canvas.
            </p>
            <p>
              Shift-click to select more. Drag to move; use the corner handles
              to resize.
            </p>
          </div>
        </>
      ) : (
        <>
          {hasLocked && (
            <p className="te-element-lock-note">
              <LockIcon locked />
              {allLocked
                ? inheritedLock ? "Unlock the parent group in Layers to edit this selection." : "Unlock to edit this selection."
                : "Locked elements stay unchanged."}
            </p>
          )}

          <fieldset disabled={noEdits}>
            {initialSection==="position"&&positionSection}


            {texts.length > 0 && (
              <Section
                title={
                  texts.length === elements.length
                    ? "Text"
                    : `Text · ${texts.length}`
                }
              >
                <FontSelect
                  value={commonFont ?? ""}
                  onChange={(font) => updateText({ font }, "font")}
                />
                {commonFont === undefined && (
                  <p className="te-element-mixed">Multiple typefaces</p>
                )}
                <div className="te-element-grid">
                  <NumberField
                    label="Font size"
                    unit="px"
                    min={OUTPUT_SCALE}
                    max={500 * OUTPUT_SCALE}
                    value={px(shared(texts, "fontSize"))}
                    onChange={(value) =>
                      updateText(
                        { fontSize: value / OUTPUT_SCALE },
                        "font-size",
                      )
                    }
                  />
                </div>
                <div
                  className="te-element-segments te-element-type-tools"
                  role="group"
                  aria-label="Text styling"
                >
                  <Toggle
                    label="Bold"
                    active={boldState(texts)}
                    onClick={() =>
                      updateText(
                        {
                          fontWeight:
                            boldState(texts) === true
                              ? 400
                              : 700,
                        },
                        "bold",
                      )
                    }
                  >
                    <b>B</b>
                  </Toggle>
                  <Toggle
                    label="Italic"
                    active={booleanState(texts, "italic")}
                    onClick={() =>
                      updateText({ italic: commonItalic !== true }, "italic")
                    }
                  >
                    <i>I</i>
                  </Toggle>
                </div>
                <div
                  className="te-element-segments"
                  role="group"
                  aria-label="Text alignment"
                >
                  {(["left", "center", "right"] as const).map((align) => (
                    <Toggle
                      key={align}
                      label={`Align text ${align}`}
                      active={shared(texts, "align") === align}
                      onClick={() => updateText({ align }, "text-align")}
                    >
                      <AlignIcon align={align} />
                    </Toggle>
                  ))}
                </div>
                <ColorField
                  label="Text color"
                  value={shared(texts, "color") ?? "Mixed"}
                  onChange={(color) => updateText({ color, colorRoleId: undefined }, "text-color")}
                />
                <Section title="Spacing & text formatting" disclosure>
                  <NumberField
                    label="Line spacing"
                    min={0.5}
                    max={5}
                    step={0.05}
                    value={shared(texts, "lineHeight")}
                    onChange={(lineHeight) =>
                      updateText({ lineHeight }, "line-height")
                    }
                  />
                <NumberField
                  label="Letter spacing"
                  unit="px"
                  min={-20 * OUTPUT_SCALE}
                  max={100 * OUTPUT_SCALE}
                  step={0.1}
                  value={px(shared(texts, "letterSpacing"))}
                  onChange={(value) =>
                    updateText(
                      { letterSpacing: value / OUTPUT_SCALE },
                      "letter-spacing",
                    )
                  }
                />
                  <div className="te-element-segments te-element-type-tools" role="group" aria-label="Additional text styling">
                  <Toggle
                    label="Underline"
                    active={booleanState(texts, "underline")}
                    onClick={() =>
                      updateText(
                        { underline: commonUnderline !== true },
                        "underline",
                      )
                    }
                  >
                    <u>U</u>
                  </Toggle>
                  <button
                    type="button"
                    aria-label="Uppercase"
                    title="Uppercase"
                    onClick={() =>
                      update("uppercase", (element) =>
                        element.type === "text"
                          ? changeTextCase(element,true)
                          : element,
                      )
                    }
                  >
                    AA
                  </button>
                  <button
                    type="button"
                    aria-label="Lowercase"
                    title="Lowercase"
                    onClick={() =>
                      update("lowercase", (element) =>
                        element.type === "text"
                          ? changeTextCase(element,false)
                          : element,
                      )
                    }
                  >
                    aa
                  </button>
                  </div>
                </Section>
                {texts.length===1&&<Section title="Text content" disclosure>
                {texts.length === 1 && (
                  <label className="te-field">
                    Text content
                    <p className="te-element-hint">Double-click on the canvas to keep individual word styles.</p>
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={texts[0].text}
                      onChange={(event) =>
                        updateText({ text: event.target.value, richText: undefined, wordTextures: undefined }, "text")
                      }
                    />
                  </label>
                )}
                </Section>}
                {onTextTexture&&texts.length===1?<button type="button" className="te-property-action" disabled={noEdits||!canEditElement(scene,texts[0],"content")} onMouseDown={event=>event.preventDefault()} onClick={onTextTexture}>Image texture · choose words</button>:<AdvancedProperties {...advancedProps} sections={["texture"]} />}
              </Section>
            )}

            {images.length > 0 && (
              <Section
                title={
                  images.length === elements.length
                    ? "Image"
                    : `Images · ${images.length}`
                }
              >
                <div
                  className="te-element-segments"
                  role="group"
                  aria-label="Image fit"
                >
                  <Toggle
                    label="Fill image frame"
                    active={shared(images, "fit") === "cover"}
                    onClick={() => updateImage({ fit: "cover" }, "image-fit")}
                  >
                    Fill frame
                  </Toggle>
                  <Toggle
                    label="Fit entire image"
                    active={shared(images, "fit") === "contain"}
                    onClick={() => updateImage({ fit: "contain" }, "image-fit")}
                  >
                    Fit image
                  </Toggle>
                </div>
                <p className="te-element-hint">Choose Crop above to reposition the photo on the canvas.</p>
                <Section title="Accessibility" disclosure>
                  <label className="te-field">Image description<textarea aria-label="Public image description" rows={3} maxLength={2000} disabled={noEdits||elements.every(element=>!canEditElement(scene,element,"content"))} value={shared(images,"publicAlt")??""} placeholder={images.length>1&&shared(images,"publicAlt")===undefined?"Mixed descriptions":"What should a screen reader say about this image?"} onChange={event=>{const publicAlt=event.target.value;update("public-alt",element=>element.type==="image"?{...element,publicAlt}:element.type==="shape"&&element.imageFill?{...element,imageFill:{...element.imageFill,publicAlt}}:element);}}/></label>
                  <p className="te-element-hint">Shared in review links. Leave blank for decorative images. Internal image notes stay private.</p>
                </Section>
                {standaloneImages.length>0 && <Section title="Image corners" disclosure><NumberField label="Corner radius" unit="px" min={0} max={1080} value={px(shared(standaloneImages,"radius"))} onChange={value=>updateImage({radius:value/OUTPUT_SCALE},"image-radius")} /></Section>}
              </Section>
            )}

            {shapes.length > 0 && (
              <Section
                title={
                  shapes.length === elements.length
                    ? "Shape"
                    : `Shapes · ${shapes.length}`
                }
              >
                {onUploadFramePhoto&&shapes.length===1&&<label className="te-frame-photo-upload">{frameUploading?"Loading photo…":shapes[0].imageFill?"Replace frame photo":"Add photo to shape"}<input type="file" aria-label="Choose shape frame photo" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={frameUploading||!canEditElement(scene,shapes[0],"content")} onChange={async event=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;setFrameUploading(true);setFrameError("");try{await onUploadFramePhoto(file,shapes[0].id);}catch(error){setFrameError(error instanceof Error?error.message:"Could not load this photo.");}finally{setFrameUploading(false);}}} /></label>}
                {frameError&&<p className="te-element-hint" role="alert">{frameError}</p>}
                {!shapes.every(shape=>shape.imageFill)&&<ColorField
                  label="Fill"
                  value={shared(shapes, "fill") ?? "Mixed"}
                  onChange={(fill) => updateShape({ fill, colorRoleId: undefined }, "shape-fill")}
                />}
                <Section title="Border & corners" disclosure defaultOpen={shapes.some(shape=>shape.strokeWidth>0)}>
                <ColorField
                  label="Border color"
                  value={shared(shapes, "stroke") ?? "Mixed"}
                  onChange={(stroke) => updateShape({ stroke }, "shape-stroke")}
                />
                <div className="te-element-grid">
                  <NumberField
                    label="Border width"
                    unit="px"
                    min={0}
                    max={90}
                    value={px(shared(shapes, "strokeWidth"))}
                    onChange={(value) =>
                      updateShape(
                        { strokeWidth: value / OUTPUT_SCALE },
                        "stroke-width",
                      )
                    }
                  />
                  {shapes.some(shape=>shape.shape==="rectangle")&&<NumberField
                    label="Corner radius"
                    unit="px"
                    min={0}
                    max={1080}
                    value={px(shared(shapes, "radius"))}
                    onChange={(value) =>
                      updateShape(
                        { radius: value / OUTPUT_SCALE },
                        "shape-radius",
                      )
                    }
                  />}
                </div>
                <label className="te-field">Outline alignment<select aria-label="Outline alignment" value={outlineAlignment} onChange={event=>updateShape({strokeAlign:event.target.value as ShapeElement["strokeAlign"]},"stroke-alignment")}>{!outlineAlignment&&<option value="" disabled>Mixed</option>}<option value="inside">Inside</option><option value="center">Center</option><option value="outside">Outside</option></select></label>
                </Section>
              </Section>
            )}

            {initialSection!=="position"&&positionSection}

            <Section title="More options" disclosure>
              <AdvancedProperties {...advancedProps} sections={[...(texts.length?["text"] as const:[]),...(images.length?["photo"] as const:[]),...(shapes.length?["shape"] as const:[]),"effects","brand","constraints"]} />
            </Section>
            <Section title="Arrange & appearance" disclosure>
              {editable.length > 1 && <>
                <label className="te-field">Distribute<select aria-label="Distribution method" value={distributionMode} onChange={event => setDistributionMode(event.target.value as typeof distributionMode)}><option value="gaps">Equal gaps</option><option value="centers">Equal centers</option></select></label>
                <label className="te-property-check"><input type="checkbox" checked={useGap} onChange={event => setUseGap(event.target.checked)} />Set an exact gap</label>
                {useGap && <NumberField label="Distribution gap" unit="px" min={0} max={3000} value={gap} onChange={setGap} />}
                <div className="te-element-grid te-element-actions"><button type="button" onClick={() => distribute("horizontal")}>Distribute ↔</button><button type="button" onClick={() => distribute("vertical")}>Distribute ↕</button><button type="button" onClick={() => matchSize("width")}>Match width</button><button type="button" onClick={() => matchSize("height")}>Match height</button><button type="button" onClick={() => matchSize("both")}>Match size</button></div>
              </>}
              <div className="te-element-grid te-element-actions"><button type="button" disabled={displayed.length !== 1} onClick={() => setAppearance(copyAppearance(displayed[0]))}>Copy appearance</button><button type="button" disabled={!appearance} onClick={() => { if (appearance) { const result = pasteAppearance(scene, selectedIds, appearance); if (result.scene !== scene) onChange(result.scene); } }}>Paste appearance</button></div>
              <div className="te-element-grid te-element-actions">
                <button
                  type="button"
                  disabled={!canBackward}
                  onClick={() => reorder("backward")}
                  title="Send backward one layer"
                >
                  <span aria-hidden>↓</span> Backward
                </button>
                <button
                  type="button"
                  disabled={!canForward}
                  onClick={() => reorder("forward")}
                  title="Bring forward one layer"
                >
                  <span aria-hidden>↑</span> Forward
                </button>
                <button
                  type="button"
                  disabled={!canDuplicate}
                  title={
                    canDuplicate
                      ? "Duplicate selection"
                      : "A page can contain up to 100 elements"
                  }
                  onClick={duplicate}
                >
                  <CopyIcon /> Duplicate
                </button>
                <button
                  type="button"
                  className="te-element-delete"
                  onClick={remove}
                >
                  <TrashIcon /> Delete
                </button>
              </div>
            </Section>
          </fieldset>
          <Section title="Layer options" disclosure>
            {elements.length === 1 && (
              <label className="te-field te-element-name">
                Layer name
                <input
                  value={elements[0].name}
                  disabled={noEdits}
                  maxLength={120}
                  onChange={(event) =>
                    update("name", (element) => ({
                      ...element,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
            )}          <button
            type="button"
            className="te-element-lock"
            disabled={disabled || inheritedLock}
            onClick={toggleLock}
          >
            <LockIcon locked={allLocked} />
            {allLocked ? "Unlock selection" : "Lock selection"}
          </button>
          </Section>
        </>
      )}
    </aside>
  );
}
