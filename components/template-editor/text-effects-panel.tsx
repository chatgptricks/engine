"use client";

import type { CSSProperties } from "react";
import { TEXT_EFFECT_KINDS, type CanvasElement, type TextEffect, type TextEffectKind, type TextElement } from "@/lib/template-editor/model";
import { TEXT_EFFECTS, setTextEffect, textEffectSettings, textEffectStyle } from "@/lib/template-editor/text-effects";
import { ColorField } from "./controls";
import { RangeRow } from "./text-format-bar";

/** The tile's "Ag": a sample in the effect, drawn with the same CSS as the canvas. */
function Sample({ kind, color }: { kind?: TextEffectKind; color: string }) {
  const style = kind ? textEffectStyle({ kind }, color, 22).style as CSSProperties : {};
  return <span className="te-effect-preview te-text-effect-sample" data-text-effect={kind} style={{ color, ...style }}><span>Ag</span></span>;
}

/** Canva's text Effects: pick one style, then tune it. One undo step per change. */
export function TextEffectsPanel({ texts, disabled, update }: {
  texts: TextElement[];
  disabled: boolean;
  update: (group: string, transform: (element: CanvasElement) => CanvasElement) => void;
}) {
  const kinds = new Set(texts.map(text => text.textEffect?.kind ?? "none"));
  const current = kinds.size === 1 ? [...kinds][0] : undefined;
  const first = texts[0], effect = current && current !== "none" ? first.textEffect! : undefined;
  const settings = effect ? textEffectSettings(effect, first.color) : undefined;
  // Samples are white on the dark panel, whatever the text's own color.
  const sampleColor = "#ffffff";
  const set = (group: string, next: (text: TextElement) => TextEffect | null) => update(group, element => element.type === "text" ? setTextEffect(element, next(element)) : element);
  const patch = (key: keyof Omit<TextEffect, "kind">, value: string | number) => set(`text-effect-${key}`, text => text.textEffect ? { ...text.textEffect, [key]: value } : null);
  return <fieldset className="te-text-effects" disabled={disabled}>
    <div className="te-effect-presets" role="group" aria-label="Text effects">
      <button type="button" aria-label="No text effect" aria-pressed={current === "none"} onClick={() => set("text-effect", () => null)}><Sample color={sampleColor} />None</button>
      {TEXT_EFFECT_KINDS.map(kind => <button key={kind} type="button" aria-label={`${TEXT_EFFECTS[kind].label} text effect`} aria-pressed={current === kind} onClick={() => set("text-effect", text => text.textEffect?.kind === kind ? text.textEffect : { kind })}><Sample kind={kind} color={sampleColor} />{TEXT_EFFECTS[kind].label}</button>)}
    </div>
    {effect && settings && <div className="te-text-effect-controls">
      {TEXT_EFFECTS[effect.kind].controls.map(control => <RangeRow key={control.key} label={control.label} min={control.min} max={control.max} step={1} value={settings[control.key] as number} onChange={value => patch(control.key, Math.round(value))} />)}
      {TEXT_EFFECTS[effect.kind].colors.map(key => <ColorField key={key} label={key === "color2" ? "Second color" : "Effect color"} value={settings[key] || first.color} onChange={value => patch(key, value)} />)}
    </div>}
  </fieldset>;
}
