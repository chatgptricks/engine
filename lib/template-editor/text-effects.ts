import { TEXT_EFFECT_KINDS, parseTextEffect, type TextEffect, type TextEffectKind, type TextElement } from "./model";
import { parseColor } from "./color-utils";

/**
 * Text effects, after Canva's Effects panel: one at a time, on Canva's scales
 * (direction in degrees, everything else 0–100). They're drawn in CSS on the
 * text, so the canvas, PNG, PDF (the editor's snapshot) and MP4 (its DOM
 * layers) all show the same thing. Sizes follow the font size, so an effect
 * looks the same on a headline and on a caption.
 */

export type TextEffectSettings = Required<Omit<TextEffect, "kind">> & { kind: TextEffectKind };

type Control = { key: keyof Omit<TextEffect, "kind">; label: string; min: number; max: number };
const DIRECTION: Control = { key: "direction", label: "Direction", min: -180, max: 180 };
const OFFSET: Control = { key: "offset", label: "Offset", min: 0, max: 100 };
const BLUR: Control = { key: "blur", label: "Blur", min: 0, max: 100 };
const TRANSPARENCY: Control = { key: "transparency", label: "Transparency", min: 0, max: 100 };
const INTENSITY: Control = { key: "intensity", label: "Intensity", min: 0, max: 100 };
const THICKNESS: Control = { key: "thickness", label: "Thickness", min: 0, max: 100 };

/** Each effect: its name, defaults (Canva's), and the controls it shows. color "" means the text's own color. */
export const TEXT_EFFECTS: Record<TextEffectKind, { label: string; defaults: Omit<TextEffect, "kind">; controls: Control[]; colors: ("color" | "color2")[] }> = {
  drop: { label: "Drop", defaults: { direction: -45, offset: 20, blur: 10, transparency: 30, color: "#000000" }, controls: [DIRECTION, OFFSET, BLUR, TRANSPARENCY], colors: ["color"] },
  glow: { label: "Glow", defaults: { intensity: 40, color: "" }, controls: [INTENSITY], colors: ["color"] },
  outline: { label: "Outline", defaults: { thickness: 50, color: "#000000" }, controls: [{ ...THICKNESS, max: 200 }], colors: ["color"] },
  hollow: { label: "Hollow", defaults: { thickness: 50 }, controls: [THICKNESS], colors: [] },
  neon: { label: "Neon", defaults: { intensity: 50, color: "" }, controls: [INTENSITY], colors: ["color"] },
  echo: { label: "Echo", defaults: { direction: -45, offset: 50, color: "" }, controls: [DIRECTION, OFFSET], colors: ["color"] },
  splice: { label: "Splice", defaults: { thickness: 50, offset: 25, direction: -45, color: "#808080" }, controls: [THICKNESS, OFFSET, DIRECTION], colors: ["color"] },
  glitch: { label: "Glitch", defaults: { direction: 90, offset: 30, color: "#00FFFF", color2: "#FF00FF" }, controls: [DIRECTION, OFFSET], colors: ["color", "color2"] },
  highlight: { label: "Highlight", defaults: { roundness: 50, spread: 50, transparency: 0, color: "#FFE14D" }, controls: [{ key: "roundness", label: "Roundness", min: 0, max: 100 }, { key: "spread", label: "Spread", min: 0, max: 100 }, TRANSPARENCY], colors: ["color"] },
};

/** An effect with its defaults filled in; the text's own color where the effect follows it. */
export function textEffectSettings(effect: TextEffect, textColor: string): TextEffectSettings {
  const base = { color: "", color2: "", direction: 0, offset: 0, blur: 0, transparency: 0, intensity: 0, thickness: 0, roundness: 0, spread: 0 };
  const settings = { ...base, ...TEXT_EFFECTS[effect.kind].defaults, ...effect } as TextEffectSettings;
  if (!settings.color) settings.color = textColor;
  return settings;
}

/** A color with an alpha multiplied in, as rgba(). */
function rgba(color: string, alpha = 1) {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(parsed.rgb.slice(index, index + 2), 16));
  return `rgba(${r},${g},${b},${Math.round(Math.max(0, Math.min(1, parsed.alpha * alpha)) * 1000) / 1000})`;
}
const px = (value: number) => `${Math.round(value * 100) / 100}px`;
/** Canva's direction: −45 is up and to the right. */
const along = (direction: number, distance: number) => ({ x: Math.cos(direction * Math.PI / 180) * distance, y: Math.sin(direction * Math.PI / 180) * distance });

export type TextEffectStyle = {
  /** CSS for the text block. */
  style: Record<string, string>;
  /** How far the effect reaches past the glyphs, so a fixed box doesn't clip it. */
  reach: number;
  /** Hollow and splice with a filter id: an SVG filter that outlines the glyphs' shape,
   * so a variable font's overlapping contours don't show inside the letters. */
  ring?: TextRingFilter;
};
export type TextRingFilter = { id: string; width: number; color: string; copy?: { x: number; y: number; color: string } };

/** The CSS for an effect at a font size (scene units, as the canvas draws them). With
 * filterId, hollow and splice use the SVG filter in `ring` (the canvas renders it);
 * without, a text stroke (small samples, the text being typed). */
export function textEffectStyle(effect: TextEffect, textColor: string, fontSize: number, filterId?: string): TextEffectStyle {
  const s = textEffectSettings(effect, textColor), f = fontSize;
  switch (s.kind) {
    case "drop": {
      const at = along(s.direction, s.offset / 100 * f * 0.5), blur = s.blur / 100 * f * 0.4;
      return { style: { filter: `drop-shadow(${px(at.x)} ${px(at.y)} ${px(blur)} ${rgba(s.color, 1 - s.transparency / 100)})` }, reach: Math.max(Math.abs(at.x), Math.abs(at.y)) + blur * 2 };
    }
    case "glow": {
      const radius = f * (0.04 + 0.3 * s.intensity / 100);
      return { style: { filter: `drop-shadow(0 0 ${px(radius)} ${rgba(s.color, 0.55 + 0.4 * s.intensity / 100)})` }, reach: radius * 2 };
    }
    case "neon": {
      const k = 0.4 + s.intensity / 100 * 1.2;
      const radii = [0.03, 0.09, 0.2].map(r => f * r * k);
      return { style: { color: mixWithWhite(textColor, 0.75), filter: radii.map((r, index) => `drop-shadow(0 0 ${px(r)} ${rgba(s.color, index ? 0.85 : 1)})`).join(" ") }, reach: radii[2] * 2.5 };
    }
    case "outline": {
      const width = s.thickness / 100 * f * 0.08;
      return { style: { WebkitTextStroke: `${px(width * 2)} ${s.color}`, paintOrder: "stroke fill" }, reach: width };
    }
    case "hollow": {
      const width = Math.max(0.4, s.thickness / 100 * f * 0.05);
      if (filterId) return { style: { filter: `url(#${filterId})` }, reach: width, ring: { id: filterId, width, color: textColor } };
      return { style: { WebkitTextFillColor: "transparent", backgroundImage: "none", WebkitTextStroke: `${px(width)} ${textColor}` }, reach: width };
    }
    case "splice": {
      const width = Math.max(0.4, s.thickness / 100 * f * 0.05), at = along(s.direction, s.offset / 100 * f * 0.4);
      if (filterId) return { style: { filter: `url(#${filterId})` }, reach: Math.max(Math.abs(at.x), Math.abs(at.y)) + width, ring: { id: filterId, width, color: textColor, copy: { ...at, color: s.color } } };
      return { style: { WebkitTextFillColor: "transparent", backgroundImage: "none", WebkitTextStroke: `${px(width)} ${textColor}`, textShadow: `${px(at.x)} ${px(at.y)} 0 ${s.color}` }, reach: Math.max(Math.abs(at.x), Math.abs(at.y)) + width };
    }
    case "echo": {
      // Three drop shadows in a row repeat the text at one, two and three steps, each fainter.
      const at = along(s.direction, s.offset / 100 * f * 0.12), shadow = `drop-shadow(${px(at.x)} ${px(at.y)} 0 ${rgba(s.color, 0.6)})`;
      return { style: { filter: [shadow, shadow, shadow].join(" ") }, reach: Math.max(Math.abs(at.x), Math.abs(at.y)) * 3 };
    }
    case "glitch": {
      // The first color one way, then the second the other way: the second's copy of the first lands under the text.
      const at = along(s.direction + 90, s.offset / 100 * f * 0.1);
      return { style: { filter: `drop-shadow(${px(-at.x)} ${px(-at.y)} 0 ${s.color}) drop-shadow(${px(at.x)} ${px(at.y)} 0 ${s.color2})` }, reach: Math.max(Math.abs(at.x), Math.abs(at.y)) * 2 };
    }
    case "highlight": {
      const padX = f * (0.08 + 0.5 * s.spread / 100), padY = f * (0.02 + 0.12 * s.spread / 100);
      return { style: { "--te-highlight": rgba(s.color, 1 - s.transparency / 100), "--te-highlight-x": px(padX), "--te-highlight-y": px(padY), "--te-highlight-radius": px(s.roundness / 100 * f * 0.4) }, reach: padX };
    }
  }
}

function mixWithWhite(color: string, amount: number) {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const channel = (index: number) => Math.round(parseInt(parsed.rgb.slice(index, index + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** What agents may send: a kind name alone, null (no effect), or the settings. */
export function agentTextEffect(value: unknown): TextEffect | null | undefined {
  if (value === null || value === "none") return null;
  if (typeof value === "string") return TEXT_EFFECT_KINDS.includes(value as TextEffectKind) ? { kind: value as TextEffectKind } : undefined;
  return parseTextEffect(value) ?? undefined;
}

/** A text layer with an effect, or without one (null). */
export function setTextEffect(element: TextElement, effect: TextEffect | null): TextElement {
  if (effect) return { ...element, textEffect: effect };
  const next = { ...element };
  delete next.textEffect;
  return next;
}
