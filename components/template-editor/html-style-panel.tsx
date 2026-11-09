"use client";
/**
 * The HTML tab of the element inspector. While a part of an HTML layer is being
 * edited on the canvas, it offers the brand's colors and text sizes, Bold and
 * Clear style for that part, or for the words selected in it. Without a part it
 * says how to start, and it always offers "Break into layers".
 *
 * Every control keeps the canvas's focus (onMouseDown preventDefault), so the
 * words selected on the canvas stay selected while a color is chosen. Each click
 * is its own undo step.
 */
import { useId, useState, type MouseEvent } from "react";
import { Element, Text } from "domhandler";
import { canEditElement, isElementHidden } from "@/lib/template-editor/commands";
import {
  editHtmlNode,
  htmlBrandColors,
  htmlBrandTextStyles,
  htmlNodeInfo,
  parseInlineStyle,
  styleHtmlNode,
  styleHtmlText,
  withHtmlLayerMarkup,
  type HtmlNodeInfo,
  type HtmlNodeSelection,
  type HtmlStylePatch,
} from "@/lib/template-editor/html-edit";
import { htmlLayerText, type CanvasScene, type HtmlElement } from "@/lib/template-editor/model";
import "./html-style-panel.css";

type Range = { start: number; end: number };

/** What the style controls change: the selected words, or the whole part. */
export type HtmlStyleTarget = {
  info: HtmlNodeInfo;
  /** The selected words; undefined when no words are selected and the whole part is styled. */
  words?: string;
  range?: Range;
  /** Some, not all, of the part's words are selected. */
  partial: boolean;
  /** The color (a fill in an SVG), size and weight the target has now, from inline styles. */
  current: { color?: string; size?: string; weight?: string };
};

/** For each property, the inline value every selected word gets from the part or
 * from an element inside it; undefined when the words differ or none sets it. */
function wordsStyle(html: string, index: number, range: Range, names: string[]): Record<string, string | undefined> {
  const found = new Map(names.map(name => [name, new Set<string>()]));
  editHtmlNode(html, index, node => {
    let offset = 0;
    const visit = (parent: Element) => {
      for (const child of parent.children) {
        if (child instanceof Element) { visit(child); continue; }
        if (!(child instanceof Text)) continue;
        const from = offset, to = offset + child.data.length;
        offset = to;
        const start = Math.max(range.start, from), end = Math.min(range.end, to);
        if (end <= start || !child.data.slice(start - from, end - from).trim()) continue;
        for (const name of names) {
          let value = "";
          for (let current: Element | null = parent; current; current = current === node || !(current.parent instanceof Element) ? null : current.parent) {
            const own = parseInlineStyle(current.attribs.style)[name];
            if (own) { value = own; break; }
          }
          found.get(name)!.add(value);
        }
      }
    };
    visit(node);
  });
  return Object.fromEntries(names.map(name => {
    const values = [...found.get(name)!];
    return [name, values.length === 1 && values[0] ? values[0] : undefined];
  }));
}

/** The part a canvas selection points at, its selected words and its current style;
 * undefined when the layer no longer has that part. */
export function htmlStyleTarget(html: string, selection: HtmlNodeSelection): HtmlStyleTarget | undefined {
  const info = htmlNodeInfo(html, selection.node);
  if (!info) return undefined;
  const color = info.svg ? "fill" : "color";
  const own = { color: info.style[color], size: info.style["font-size"], weight: info.style["font-weight"] };
  const range = selection.range;
  const start = range ? Math.max(0, Math.min(range.start, range.end)) : 0;
  const end = range ? Math.min(info.text.length, Math.max(range.start, range.end)) : 0;
  const words = info.text.slice(start, end);
  if (!words.trim()) return { info, partial: false, current: own };
  const partial = start > 0 || end < info.text.length;
  if (!partial) return { info, words, range: { start, end }, partial, current: own };
  const style = wordsStyle(html, selection.node, { start, end }, [color, "font-size", "font-weight"]);
  return { info, words, range: { start, end }, partial, current: { color: style[color], size: style["font-size"], weight: style["font-weight"] } };
}

function safeTarget(html: string, selection: HtmlNodeSelection) {
  try { return htmlStyleTarget(html, selection); } catch { return undefined; }
}

/** The markup with `patch` on the target's words, or on its whole part when no words are selected. */
export function styleHtmlTarget(html: string, node: number, target: Pick<HtmlStyleTarget, "range">, patch: HtmlStylePatch): string {
  return target.range ? styleHtmlText(html, node, target.range, patch) : styleHtmlNode(html, node, patch);
}

const CLEARED = ["color", "fill", "font-size", "font-weight", "font-family"];

/** The part without inline color, fill, size, weight and font, and without them on
 * the words styled inside it (elements with words of their own). Shapes inside it,
 * such as an icon's paths, keep their fills. */
export function clearHtmlStyle(html: string, node: number): string {
  return editHtmlNode(html, node, part => {
    const clear = (element: Element) => {
      const style = parseInlineStyle(element.attribs.style);
      if (!CLEARED.some(name => name in style)) return;
      for (const name of CLEARED) delete style[name];
      const text = Object.entries(style).map(([name, value]) => `${name}: ${value}`).join("; ");
      if (text) element.attribs.style = text; else delete element.attribs.style;
    };
    const visit = (parent: Element) => {
      for (const child of parent.children) {
        if (!(child instanceof Element)) continue;
        if (child.children.some(item => item instanceof Text && item.data.trim())) clear(child);
        visit(child);
      }
    };
    clear(part);
    visit(part);
  });
}

let serial = 0;

/** Saves the layer's new markup, cleaned, as its own undo step. Returns false when
 * nothing changed. Throws, in plain English, when the markup can't change. */
export function commitHtmlStyle(scene: CanvasScene, element: HtmlElement, html: string, onChange: (scene: CanvasScene, group?: string) => void): boolean {
  const next = withHtmlLayerMarkup(element, html);
  if (next === element) return false;
  onChange({ ...scene, elements: scene.elements.map(item => item.id === element.id ? next : item) }, `html-style:${element.id}:${++serial}`);
  return true;
}

/** html-edit throws plain Errors with a sentence meant for the user; anything else is a bug. */
const errorMessage = (error: unknown) => error instanceof Error && error.name === "Error" && error.message ? error.message : "That change didn't work. Click the words again, or undo.";

const normalize = (value: string) => {
  const compact = value.trim().toLowerCase().replace(/\s+/g, "");
  return /^#[0-9a-f]{3}$/.test(compact) ? `#${[...compact.slice(1)].map(digit => digit + digit).join("")}` : compact;
};
/** A value with the layer's brand variables filled in: var(--color-accent) is #00d98a. */
function resolve(value: string | undefined, tokens: Record<string, string> | undefined): string | undefined {
  let current = value?.trim();
  for (let step = 0; current && step < 4; step++) {
    const match = /^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i.exec(current);
    if (!match) break;
    current = (tokens?.[match[1]] ?? match[2])?.trim();
  }
  return current ? normalize(current) : undefined;
}
/** The target's value is this brand variable, or the same value. */
function same(current: string | undefined, variable: string, value: string, tokens: Record<string, string> | undefined) {
  if (!current) return false;
  if (normalize(current) === normalize(variable)) return true;
  const resolved = resolve(current, tokens);
  return resolved !== undefined && resolved === normalize(value);
}
function isBold(weight: string | undefined, tokens: Record<string, string> | undefined) {
  const value = resolve(weight, tokens);
  return value === "bold" || value === "bolder" || Number(value) >= 600;
}

const preview = (text: string, max = 90) => {
  const words = text.replace(/\s+/g, " ").trim();
  return words.length > max ? `${words.slice(0, max - 1)}…` : words;
};
const sizeLabel = (size: string) => /^\d+(\.\d+)?px$/.test(size.trim()) ? String(Number.parseFloat(size)) : size;
const keepCanvasFocus = (event: MouseEvent) => event.preventDefault();

type Props = {
  scene: CanvasScene;
  element: HtmlElement;
  /** The part of an HTML layer being edited on the canvas, with any selected words. */
  selection?: HtmlNodeSelection | null;
  disabled?: boolean;
  onChange: (scene: CanvasScene, group?: string) => void;
  /** Starts editing the layer's words on the canvas. */
  onEditHtmlLayer?: (id: string) => void;
  /** Turns the layer into text, image and shape layers. */
  onBreakHtmlLayer?: (id: string) => void;
};

export function HtmlStylePanel({ scene, element, selection, disabled = false, onChange, onEditHtmlLayer, onBreakHtmlLayer }: Props) {
  const breakHint = useId();
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const active = selection?.elementId === element.id ? selection : null;
  const target = active ? safeTarget(element.html, active) : undefined;
  const key = active ? `${active.node}:${active.range?.start ?? ""}:${active.range?.end ?? ""}` : "";
  const styleOff = disabled || !canEditElement(scene, element, "style");
  const contentOff = disabled || !canEditElement(scene, element, "content");
  // Like the canvas menu's Edit text: a hidden layer, or one without words, has nothing to type in.
  const editOff = contentOff || !onEditHtmlLayer || isElementHidden(scene, element) || !htmlLayerText(element.html).trim();
  const breakOff = contentOff || !canEditElement(scene, element, "delete") || !onBreakHtmlLayer;
  const colors = htmlBrandColors(element.tokens), sizes = htmlBrandTextStyles(element.tokens);
  const bold = isBold(target?.current.weight, element.tokens);

  function apply(change: (html: string, node: number) => string) {
    if (styleOff || !active) return;
    try {
      commitHtmlStyle(scene, element, change(element.html, active.node), onChange);
      setFailure(null);
    } catch (error) {
      setFailure({ key, message: errorMessage(error) });
    }
  }
  // Words inside a bold part stay bold under a span without a weight, so they get a normal one.
  const boldPatch: HtmlStylePatch = { "font-weight": !bold ? "700" : target?.partial ? "400" : null };

  return (
    <div className="te-html-style">
      {active && target ? (
        <section className="te-element-section">
          <h3>{target.words ? "Selected words" : "Selected part"}</h3>
          <p className="te-html-style-selection">
            {target.words ? <q>{preview(target.words)}</q> : <><code>{`<${target.info.tag}>`}</code>{target.info.text.trim() && <span>{preview(target.info.text, 60)}</span>}</>}
          </p>
          {failure?.key === key && <p className="te-element-hint te-html-style-error" role="alert">{failure.message}</p>}
          {!colors.length && !sizes.length ? (
            <p className="te-element-hint te-html-style-brandless">This deck has no brand guide, so there are no brand colors or sizes.</p>
          ) : <>
            {colors.length > 0 && <>
              <span className="te-element-label">Color</span>
              <div className="te-html-style-swatches" role="group" aria-label="Brand colors">
                {colors.map(color => {
                  const on = same(target.current.color, color.css, color.value, element.tokens);
                  return (
                    <button key={color.name} type="button" className={on ? "is-active" : undefined} aria-pressed={on} aria-label={`${color.label} color`} title={`${color.label} · ${color.value}`} disabled={styleOff} onMouseDown={keepCanvasFocus} onClick={() => apply((html, node) => styleHtmlTarget(html, node, target, { color: color.css }))}>
                      <span className="te-html-style-chip" style={{ background: color.value }} aria-hidden />
                      <span>{color.label}</span>
                    </button>
                  );
                })}
              </div>
            </>}
            {sizes.length > 0 && <>
              <span className="te-element-label">Size</span>
              <div className="te-element-segments te-html-style-sizes" role="group" aria-label="Brand text sizes">
                {sizes.map(style => {
                  const on = same(target.current.size, style.css.fontSize, style.size, element.tokens);
                  const patch: HtmlStylePatch = { "font-size": style.css.fontSize, ...(style.css.fontWeight ? { "font-weight": style.css.fontWeight } : {}) };
                  return (
                    <button key={style.name} type="button" className={on ? "is-active" : undefined} aria-pressed={on} title={`${style.label} text: ${style.size}${style.weight ? `, weight ${style.weight}` : ""}`} disabled={styleOff} onMouseDown={keepCanvasFocus} onClick={() => apply((html, node) => styleHtmlTarget(html, node, target, patch))}>
                      <span>{style.label} <span aria-hidden>·</span> {sizeLabel(style.size)}</span>
                    </button>
                  );
                })}
              </div>
            </>}
          </>}
          <div className="te-element-segments te-html-style-tools" role="group" aria-label="Text styling">
            <button type="button" className={bold ? "is-active" : undefined} aria-pressed={bold} title="Bold" disabled={styleOff} onMouseDown={keepCanvasFocus} onClick={() => apply((html, node) => styleHtmlTarget(html, node, target, boldPatch))}><b aria-hidden>B</b> Bold</button>
            <button type="button" title="Remove color, size, weight and font from this part" disabled={styleOff} onMouseDown={keepCanvasFocus} onClick={() => apply(clearHtmlStyle)}>Clear style</button>
          </div>
        </section>
      ) : (
        <section className="te-element-section">
          <h3>Text</h3>
          {active && <p className="te-element-hint te-html-style-error" role="alert">That part of the HTML layer is gone. Double-click the words again.</p>}
          <p className="te-element-hint">Double-click words on the slide to edit them, or select words to color them.</p>
          <button type="button" className="te-property-action te-html-style-action" disabled={editOff} onMouseDown={keepCanvasFocus} onClick={() => { if (!editOff) onEditHtmlLayer?.(element.id); }}>Edit text</button>
        </section>
      )}
      <section className="te-element-section">
        <button type="button" className="te-property-action te-html-style-action" aria-describedby={breakHint} disabled={breakOff} onMouseDown={keepCanvasFocus} onClick={() => { if (!breakOff) onBreakHtmlLayer?.(element.id); }}>Break into layers</button>
        <p id={breakHint} className="te-element-hint">Turns this HTML into separate text, image and shape layers.</p>
      </section>
    </div>
  );
}
