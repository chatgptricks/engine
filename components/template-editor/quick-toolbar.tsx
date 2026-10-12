"use client";

import type { MouseEvent } from "react";
import type { CanvasScene, TextElement } from "@/lib/template-editor/model";
import { FONTS } from "./controls";
import { commonValue, boldState, booleanState } from "@/lib/template-editor/property-utils";
import { isElementLocked } from "@/lib/template-editor/commands";
import { parseColor, colorWithAlpha } from "@/lib/template-editor/color-utils";

export function QuickToolbar({ scene, selectedIds, disabled, onChange, onDuplicate, onDelete, onMore, onAddText, onUpload, onFormatText, outputScale = 3 }: {
  scene: CanvasScene;
  outputScale?: number;
  selectedIds: string[];
  disabled: boolean;
  onChange: (scene: CanvasScene, group?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMore: (event: MouseEvent<HTMLButtonElement>) => void;
  onAddText: () => void;
  onUpload: () => void;
  onFormatText?: (patch: Partial<TextElement>) => boolean;
}) {
  const selected = scene.elements.filter((element) => selectedIds.includes(element.id));
  const editable = selected.filter((element) => !isElementLocked(scene, element));
  const texts = editable.filter((element): element is TextElement => element.type === "text" && !element.protected?.includes("style"));
  const text = texts[0];
  const locked = selected.length > 0 && editable.length === 0;
  function patchText(patch: Partial<TextElement>) {
    if (disabled || onFormatText?.(patch)) return;
    onChange({ ...scene, elements: scene.elements.map((element) =>
      selectedIds.includes(element.id) && !isElementLocked(scene, element) && !element.protected?.includes("style") && element.type === "text"
        ? { ...element, ...patch } : element,
    ) }, "quick-text");
  }
  return <div className="te-quick-toolbar" role="toolbar" aria-label="Quick formatting" onKeyDown={(event) => {
    if ((event.target as HTMLElement).matches("input, select")) event.stopPropagation();
  }}>
    {!selected.length ? <>
      <span className="te-quick-label">Make it yours</span>
      <button disabled={disabled} onClick={onAddText}>+ Text</button>
      <button disabled={disabled} onClick={onUpload}>Upload image</button>
      <span className="te-quick-tip">Drag to select · Right-click for actions</span>
    </> : <>
      <span className="te-quick-label">{selected.length > 1 ? `${selected.length} selected` : locked ? "Locked layer" : selected[0].type === "text" ? "Text" : selected[0].type === "image" ? "Image" : "Shape"}</span>
      {text && <>
        <select aria-label="Quick font" disabled={disabled} value={commonValue(texts, "font") ?? ""} onChange={(event) => patchText({ font: event.target.value })}>
          {commonValue(texts, "font") === undefined && <option value="" disabled>Mixed fonts</option>}
          {FONTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <input aria-label="Quick font size" title="Font size in export pixels" type="number" min={outputScale} max={500 * outputScale} disabled={disabled} placeholder="Mixed" value={commonValue(texts, "fontSize") === undefined ? "" : Number((commonValue(texts, "fontSize")! * outputScale).toFixed(2))} onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && value >= outputScale && value <= 500 * outputScale) patchText({ fontSize: value / outputScale });
        }} />
        <button aria-label="Quick bold" title="Bold" aria-pressed={boldState(texts)} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => patchText({fontWeight: boldState(texts) === true ? 400 : 700})}><b>B</b></button>
        <button aria-label="Quick italic" title="Italic" aria-pressed={booleanState(texts, "italic")} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => patchText({italic: booleanState(texts, "italic") !== true})}><i>I</i></button>
        <button aria-label="Quick underline" title="Underline" aria-pressed={booleanState(texts, "underline")} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => patchText({underline: booleanState(texts, "underline") !== true})}><u>U</u></button>
        <button aria-label="Quick strikethrough" title="Strikethrough" aria-pressed={booleanState(texts, "strikethrough")} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => patchText({strikethrough: booleanState(texts, "strikethrough") !== true})}><s>S</s></button>
        <button aria-label="Quick uppercase" title="Toggle uppercase" aria-pressed={texts.every((item) => item.text === item.text.toUpperCase())} disabled={disabled} onClick={() => {
          const upper = !texts.every((item) => item.text === item.text.toUpperCase());
          onChange({...scene, elements: scene.elements.map((item) => selectedIds.includes(item.id) && !item.locked && !item.protected?.includes("content") && item.type === "text" ? {...item, richText: undefined, text: (upper ? item.text.toUpperCase() : item.text.toLowerCase()).slice(0, 20_000)} : item)});
        }}>aA</button>
        <select aria-label="Quick text alignment" disabled={disabled} value={commonValue(texts, "align") ?? ""} onChange={(event) => patchText({align: event.target.value as TextElement["align"]})}>
          {commonValue(texts, "align") === undefined && <option value="" disabled>Mixed alignment</option>}
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
        <input aria-label="Quick text color" title={commonValue(texts, "color") === undefined ? "Mixed text colors" : "Text color"} type="color" value={parseColor(commonValue(texts, "color") ?? "")?.rgb ?? "#ffffff"} data-mixed={commonValue(texts, "color") === undefined || undefined} disabled={disabled} onChange={(event) => patchText({colorRoleId: undefined, color: colorWithAlpha(event.target.value, parseColor(commonValue(texts, "color") ?? "")?.alpha || 1)})} />
      </>}
      <span className="te-quick-spacer" />
      <button aria-label="Quick duplicate" title="Duplicate (⌘/Ctrl D)" disabled={disabled || !editable.length || scene.elements.length >= 100} onClick={onDuplicate}>Duplicate</button>
      <button aria-label="Quick delete" title="Delete selected" disabled={disabled || !editable.length} onClick={onDelete}>Delete</button>
    </>}
    <button aria-label="More canvas actions" title="More actions" aria-haspopup="menu" onClick={onMore}>•••</button>
  </div>;
}
