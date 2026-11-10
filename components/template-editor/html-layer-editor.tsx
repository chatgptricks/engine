"use client";
/**
 * Typing in an HTML layer, in place.
 *
 * A double-click finds the words under the pointer (htmlTextPartAt): the block
 * that holds them, such as a heading, a paragraph, a table cell or a chart
 * label, or an SVG <text>. The canvas then draws the layer a second time above
 * the page, with only that part editable, and hides the page's drawing of it.
 * Every keystroke saves the part's new contents into the layer's markup
 * (html-edit.ts), cleaned like any markup and kept as one undo step per run of
 * typing, so autosave, live sync and undo treat it like any other edit.
 *
 * While someone types, the editable drawing is left to the browser. It's drawn
 * again only when the layer changes some other way (undo, a collaborator, the
 * style panel), and the selection comes back by its place in the part's words.
 * SVG text can't take a caret, so an SVG label gets a small field next to it.
 */
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { HTML_NODE_ATTRIBUTE, prepareHtmlLayer, scopeHtmlLayer } from "@/lib/template-editor/html-layer";
import { historyShortcut } from "@/lib/template-editor/history";
import type { HtmlElement } from "@/lib/template-editor/model";
import "./html-editing.css";

/** Selected words, as offsets into a part's words (html-edit.ts styleHtmlText). */
export type HtmlTextRange = { start: number; end: number };
type ScreenPoint = { x: number; y: number };

const NUMBERED = `[${HTML_NODE_ATTRIBUTE}]`;
/** Focus can move here without ending the edit: menus, the inspector and its style panel, toolbars. */
const KEEPS_EDITING = '[role="menu"],.te-element-inspector,.te-quick-toolbar,.te-rich-controls,.te-paint-popover,.te-html-text-field';
const MAX_PASTE = 20_000;

/** Text that shows: not only spaces between tags. */
function textNodes(container: Element): Text[] {
  const result: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue?.trim()) result.push(node as Text);
  return result;
}

function textRects(text: Text): DOMRect[] {
  const parent = text.parentElement;
  if (parent instanceof SVGElement) return [parent.getBoundingClientRect()];
  const range = document.createRange();
  range.selectNodeContents(text);
  return [...range.getClientRects()];
}

/** The part a piece of text belongs to: the block around it (a <b> belongs to its
 * paragraph; a flex or grid item is a block of its own), or its SVG <text> or <tspan>. */
function partOf(text: Text, container: Element): number | null {
  let element: Element | null = text.parentElement;
  if (!element || element === container || !container.contains(element)) return null;
  if (!(element instanceof SVGElement)) {
    while (element.parentElement && element.parentElement !== container && !(element.parentElement instanceof SVGElement) && getComputedStyle(element).display === "inline") element = element.parentElement;
  }
  const numbered = element.closest(NUMBERED);
  if (!numbered || !container.contains(numbered)) return null;
  const node = Number(numbered.getAttribute(HTML_NODE_ATTRIBUTE));
  return Number.isInteger(node) ? node : null;
}

/** The part with words under a point on screen (the last one drawn wins), or null. */
export function htmlTextPartAt(container: Element, x: number, y: number): number | null {
  let found: number | null = null;
  for (const text of textNodes(container)) {
    if (!textRects(text).some(rect => rect.width > 0 && x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)) continue;
    found = partOf(text, container) ?? found;
  }
  return found;
}

/** The first part with words that show, or null. */
export function firstHtmlTextPart(container: Element): number | null {
  for (const text of textNodes(container)) {
    if (!textRects(text).some(rect => rect.width > 0 && rect.height > 0)) continue;
    const part = partOf(text, container);
    if (part !== null) return part;
  }
  return null;
}

/** The selection inside a part, as offsets into its words; null when it's elsewhere. */
function selectionIn(part: Element): HtmlTextRange | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!part.contains(range.startContainer) || !part.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(part);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

/** A place in a part's words. A start on the edge between two pieces of text goes
 * into the later one, so typed words don't land in the piece before it. */
function pointIn(part: Element, offset: number, edge: "start" | "end"): [Node, number] {
  let remaining = Math.max(0, offset), last: Text | null = null;
  for (const node of textNodesAll(part)) {
    if (edge === "start" ? remaining < node.data.length : remaining <= node.data.length) return [node, remaining];
    remaining -= node.data.length;
    last = node;
  }
  return last ? [last, last.data.length] : [part, part.childNodes.length];
}
function textNodesAll(part: Element): Text[] {
  const result: Text[] = [];
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) result.push(node as Text);
  return result;
}

/** Selects a part's words: from its first words to its last, not the empty
 * elements around them (typing over a selection that starts in an empty color
 * swatch would put the new words inside the swatch). */
function select(part: Element, range: HtmlTextRange | "words" | Range) {
  const selection = window.getSelection();
  if (!selection) return;
  let next: Range;
  if (range instanceof Range) next = range;
  else {
    next = document.createRange();
    if (range === "words") {
      const words = textNodesAll(part).filter(node => node.data.trim());
      if (words.length) { next.setStart(words[0], 0); next.setEnd(words.at(-1)!, words.at(-1)!.data.length); }
      else next.selectNodeContents(part);
    } else { next.setStart(...pointIn(part, range.start, "start")); next.setEnd(...pointIn(part, range.end, "end")); }
  }
  selection.removeAllRanges();
  selection.addRange(next);
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};
/** A collapsed range where a click on screen would put the caret. */
function caretAt(x: number, y: number): Range | null {
  const doc = document as CaretDocument;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return doc.caretRangeFromPoint?.(x, y) ?? null;
}

/** An element's own words (not its children's), as html-edit.ts setHtmlNodeText replaces them. */
const ownTexts = (element: Element) => [...element.childNodes].filter((child): child is Text => child.nodeType === Node.TEXT_NODE);
function setOwnText(element: Element, value: string) {
  const [first, ...rest] = ownTexts(element);
  if (!first) { element.insertBefore(document.createTextNode(value), element.firstChild); return; }
  first.data = value;
  for (const extra of rest) extra.remove();
}

const transparent = (color: string) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

/** Where the label field goes: under the label, or above it near the bottom of the window. */
function fieldPlace(rect: DOMRect) {
  const width = Math.round(Math.min(360, Math.max(180, rect.width + 40)));
  const left = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)));
  const top = Math.round(rect.bottom + 48 > window.innerHeight ? Math.max(8, rect.top - 42) : rect.bottom + 8);
  return { left, top, width };
}

export type HtmlLayerEditorProps = {
  element: HtmlElement;
  /** The part being edited: its number in the layer's markup. */
  node: number;
  /** Where a click on other words was, on screen: the caret goes there. Without
   * it, every word of the part is selected, as a double-click on text does. */
  caret?: ScreenPoint;
  /** Changes on every new start, so starting again on the same part starts afresh. */
  serial: number;
  opacity: number;
  /** The canvas zoom; the label field moves with it. */
  viewScale: number;
  /** Saves the part's new contents: its markup ("content"), or an SVG label's
   * words ("text"). Returns the layer's saved markup, or null when the edit wasn't taken. */
  onCommit: (value: string, kind: "content" | "text") => string | null;
  /** The selected words changed; undefined when none are selected. */
  onSelection: (range: HtmlTextRange | undefined) => void;
  /** A click on other words of the same layer. */
  onPick: (node: number, caret: ScreenPoint) => void;
  /** The layer changed some other way while this part was open. */
  onRedraw: () => void;
  /** Done (or cancelled with Escape). `refocus` gives the keyboard back to the canvas. */
  onFinish: (cancel: boolean, refocus: boolean) => void;
  onHistory?: (direction: "undo" | "redo") => void;
};

export function HtmlLayerEditor(props: HtmlLayerEditorProps) {
  const { element, node, caret, serial, opacity, viewScale } = props;
  const { html, css, tokens, designWidth, width, height } = element;
  // A scope of its own that doesn't change while typing, so the drawing under the caret keeps its styles.
  const scope = `teh-edit-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const prepared = useMemo(() => prepareHtmlLayer({ html, css, tokens }), [html, css, tokens]);
  const host = useRef<HTMLDivElement>(null);
  const fieldInput = useRef<HTMLInputElement>(null);
  const part = useRef<Element | null>(null);
  const drawn = useRef<{ markup: string; node: number; serial: number } | null>(null);
  const redrawing = useRef(false);
  const reported = useRef<string | null>(null);
  const callbacks = useRef(props);
  useLayoutEffect(() => { callbacks.current = props; });
  const [field, setField] = useState<{ value: string; left: number; top: number; width: number } | null>(null);
  const scale = width / designWidth;

  /** Draws the layer and opens the part for typing. The same part keeps its selection. */
  function draw() {
    const container = host.current;
    if (!container) return;
    const previous = drawn.current, samePart = previous?.node === node && previous.serial === serial;
    const before = part.current;
    const focused = !!before && (document.activeElement === before || before.contains(document.activeElement));
    const kept = samePart && before ? selectionIn(before) : null;
    redrawing.current = true;
    container.innerHTML = scopeHtmlLayer(prepared.html, scope);
    redrawing.current = false;
    drawn.current = { markup: prepared.html, node, serial };
    const target = container.querySelector(`[${HTML_NODE_ATTRIBUTE}="${node}"]`);
    part.current = target;
    if (!samePart) reported.current = null;
    if (!target) { callbacks.current.onFinish(false, false); return; }
    target.setAttribute("data-te-editing", "");
    if (samePart) callbacks.current.onRedraw();
    if (target instanceof SVGElement) {
      const value = ownTexts(target).map(text => text.data).join("");
      setField({ value, ...fieldPlace(target.getBoundingClientRect()) });
      return;
    }
    setField(null);
    if (!(target instanceof HTMLElement)) return;
    target.contentEditable = "true";
    target.spellcheck = true;
    if (transparent(getComputedStyle(target).color)) target.style.caretColor = "var(--te-canvas-accent, #7967df)";
    if (samePart && !focused) return;
    target.focus({ preventScroll: true });
    if (kept) { select(target, kept); return; }
    if (samePart) return;
    const range = caret ? caretAt(caret.x, caret.y) : null;
    select(target, range && target.contains(range.startContainer) ? range : "words");
  }
  // Drawn again only when the layer changed some other way, or another part opened.
  useLayoutEffect(() => {
    const previous = drawn.current;
    if (previous && previous.markup === prepared.html && previous.node === node && previous.serial === serial) return;
    draw();
  });

  /** After a saved edit, the drawing on screen is already right: remember what it shows. */
  function saved(markup: string | null) {
    if (markup === null) { draw(); return; }
    if (drawn.current) drawn.current = { ...drawn.current, markup: prepareHtmlLayer({ html: markup, css, tokens }).html };
  }
  function typed() {
    const target = part.current;
    if (!(target instanceof HTMLElement)) return;
    // Names in the drawing carry this drawing's scope; the saved markup has the layer's own.
    saved(callbacks.current.onCommit(target.innerHTML.split(`${scope}-`).join(""), "content"));
  }
  function typeLabel(value: string) {
    setField(previous => previous && { ...previous, value });
    if (part.current) setOwnText(part.current, value);
    saved(callbacks.current.onCommit(value, "text"));
  }

  // The selected words, for the style panel.
  useEffect(() => {
    const report = () => {
      const target = part.current;
      if (!(target instanceof HTMLElement)) return;
      const range = selectionIn(target);
      if (!range) return;
      const next = range.end > range.start ? range : undefined;
      const key = next ? `${next.start}:${next.end}` : "";
      if (key === reported.current) return;
      reported.current = key;
      callbacks.current.onSelection(next);
    };
    document.addEventListener("selectionchange", report);
    return () => document.removeEventListener("selectionchange", report);
  }, []);

  // Words only: no bold or lists from the browser (the style panel styles words
  // with the brand's choices), no dropped content, and Undo goes to the editor's history.
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const filter = (event: InputEvent) => {
      const type = event.inputType;
      if (type.startsWith("format") || ["insertFromDrop", "insertLink", "insertOrderedList", "insertUnorderedList", "insertHorizontalRule"].includes(type)) event.preventDefault();
      else if (type === "insertParagraph") { event.preventDefault(); document.execCommand("insertLineBreak"); }
      else if (type === "historyUndo" || type === "historyRedo") { event.preventDefault(); callbacks.current.onHistory?.(type === "historyUndo" ? "undo" : "redo"); }
    };
    container.addEventListener("beforeinput", filter);
    return () => container.removeEventListener("beforeinput", filter);
  }, []);

  const fieldOpen = field !== null;
  useEffect(() => {
    if (!fieldOpen) return;
    fieldInput.current?.focus({ preventScroll: true });
    fieldInput.current?.select();
  }, [fieldOpen, serial]);
  // The field follows its label when the page scrolls or zooms.
  useEffect(() => {
    if (!fieldOpen) return;
    let frame = 0;
    const move = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = part.current;
        if (target instanceof SVGElement) setField(previous => previous && { ...previous, ...fieldPlace(target.getBoundingClientRect()) });
      });
    };
    move();
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", move); window.removeEventListener("scroll", move, true); };
  }, [fieldOpen, viewScale, element.x, element.y, element.width, element.height, element.rotation]);

  function keyDown(event: ReactKeyboardEvent) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    const direction = historyShortcut(event.nativeEvent);
    if (direction) { event.preventDefault(); callbacks.current.onHistory?.(direction); return; }
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && ["b", "i", "u"].includes(event.key.toLowerCase())) { event.preventDefault(); return; }
    if (event.key === "Escape") { event.preventDefault(); callbacks.current.onFinish(true, true); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (modifier || event.currentTarget === fieldInput.current) { callbacks.current.onFinish(false, true); return; }
    if (!document.execCommand("insertLineBreak")) insertAtCaret(document.createElement("br"));
  }
  /** Where the browser has no editing commands: puts a node at the caret and saves. */
  function insertAtCaret(inserted: Node) {
    const selection = window.getSelection(), target = part.current;
    if (!selection?.rangeCount || !target) return;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    range.insertNode(inserted);
    range.setStartAfter(inserted);
    range.collapse(true);
    select(target, range);
    typed();
  }
  function paste(event: ReactClipboardEvent) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").slice(0, MAX_PASTE).replace(/\r\n?/g, "\n");
    // Line breaks stay line breaks (<br>): a pasted paragraph mustn't put blocks inside the part.
    text.split("\n").forEach((line, index) => {
      if (index && !document.execCommand("insertLineBreak")) insertAtCaret(document.createElement("br"));
      if (line && !document.execCommand("insertText", false, line)) insertAtCaret(document.createTextNode(line));
    });
  }
  function blurred(event: ReactFocusEvent) {
    if (redrawing.current || !document.hasFocus()) return;
    const next = event.relatedTarget;
    if (next instanceof Node && (host.current?.contains(next) || fieldInput.current === next)) return;
    if (next instanceof Element && next.closest(KEEPS_EDITING)) return;
    callbacks.current.onFinish(false, false);
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // The label field is in a portal, but its events still come through here.
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && fieldInput.current?.contains(target)) return;
    const current = part.current;
    if (current instanceof HTMLElement && target && current.contains(target)) return;
    event.preventDefault();
    const next = host.current ? htmlTextPartAt(host.current, event.clientX, event.clientY) : null;
    if (next === null) { callbacks.current.onFinish(false, true); return; }
    if (next === node) { fieldInput.current?.focus({ preventScroll: true }); return; }
    callbacks.current.onPick(next, { x: event.clientX, y: event.clientY });
  }

  return <div className="te-html-edit-box" data-html-editing={element.id} style={{ left: element.x, top: element.y, width, height, transform: `rotate(${element.rotation}deg)`, opacity }} onPointerDown={pointerDown} onDoubleClick={event => event.stopPropagation()}>
    <div className="te-canvas-html" style={{ position: "absolute", inset: 0, overflow: "hidden", contain: "layout paint style", isolation: "isolate", "--te-html-scale": scale } as CSSProperties}>
      <style>{scopeHtmlLayer(prepared.css, scope)}</style>
      <div style={{ position: "absolute", left: 0, top: 0, width: designWidth, height: height / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <div ref={host} className={`te-canvas-html-root ${scope}`} onInput={typed} onKeyDown={keyDown} onPaste={paste} onBlur={blurred} />
      </div>
    </div>
    {field && createPortal(<input
      ref={fieldInput}
      className="te-html-text-field"
      aria-label="Edit label"
      title="Enter or ⌘/Ctrl Enter: done · Escape: cancel"
      value={field.value}
      maxLength={MAX_PASTE}
      spellCheck
      style={{ left: field.left, top: field.top, width: field.width }}
      onChange={event => typeLabel(event.target.value)}
      onKeyDown={keyDown}
      onBlur={blurred}
    />, document.body)}
  </div>;
}
