/**
 * Edits inside an HTML layer: its words and the brand styles of its parts.
 *
 * Every element of a layer's markup has a number, its place in document order
 * (0 is the first element). The canvas draws each element with its number in
 * data-te-node (html-layer.ts prepareHtmlLayer), so a click on the canvas finds
 * the same element here even where the browser rearranged the markup (a table
 * gets a tbody). Markup is read the way the sanitizer reads it, and every edit
 * is cleaned again before it is saved.
 */
import { parseDocument } from "htmlparser2";
import { render } from "dom-serializer";
import { Element, Text, type ChildNode, type Document, type ParentNode } from "domhandler";
import { cleanHtmlLayer, HTML_NODE_ATTRIBUTE } from "./html-layer";
import type { HtmlElement } from "./model";

/** Which part of which HTML layer is selected, and the selected words in it. */
export type HtmlNodeSelection = {
  elementId: string;
  /** The element's number in the layer's markup. */
  node: number;
  /** Selected words, as offsets into the element's text. */
  range?: { start: number; end: number };
};

/** CSS properties to set on a part, or to remove (null). */
export type HtmlStylePatch = Record<string, string | null>;

export type HtmlNodeInfo = {
  node: number;
  tag: string;
  /** All the words in it. */
  text: string;
  /** Its own words, not counting other elements inside it. */
  ownText: string;
  /** Inside an <svg>: colors are fills and selected words become <tspan>s. */
  svg: boolean;
  /** Its inline style, property by property. */
  style: Record<string, string>;
};

// The sanitizer's parser options (html-layer.ts sanitizeMarkup): the same markup gives the same elements in the same order.
const PARSE = { recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true };
const parse = (html: string): Document => parseDocument(html, PARSE);
const serialize = (nodes: Document | ChildNode[]) => render(nodes, { decodeEntities: true });

function elements(root: ParentNode): Element[] {
  const result: Element[] = [];
  const visit = (parent: ParentNode) => {
    for (const child of parent.children) {
      if (!(child instanceof Element)) continue;
      result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

const textOf = (node: ChildNode): string => node instanceof Text ? node.data : node instanceof Element ? node.children.map(textOf).join("") : "";
const ownTextOf = (node: Element) => node.children.filter((child): child is Text => child instanceof Text).map(child => child.data).join("");
const inSvg = (node: Element) => {
  for (let current: ParentNode | null = node; current instanceof Element; current = current.parent) {
    const name = current.name.toLowerCase();
    if (name === "foreignobject" && current !== node) return false;
    if (name === "svg") return true;
  }
  return false;
};

/** Inline style, split on the semicolons that aren't inside parentheses or quotes. */
export function parseInlineStyle(style: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  let depth = 0, quote = "", start = 0;
  const declarations: string[] = [];
  const text = style ?? "";
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (index === text.length || (char === ";" && !depth && !quote)) { declarations.push(text.slice(start, index)); start = index + 1; continue; }
    if (quote) { if (char === quote) quote = ""; } else if (char === "\"" || char === "'") quote = char; else if (char === "(") depth++; else if (char === ")") depth = Math.max(0, depth - 1);
  }
  for (const declaration of declarations) {
    const colon = declaration.indexOf(":");
    if (colon < 1) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
    if (name && value) result[name] = value;
  }
  return result;
}
const inlineStyle = (style: Record<string, string>) => Object.entries(style).map(([name, value]) => `${name}: ${value}`).join("; ");

/** Colors in an SVG are fills. */
function svgPatch(patch: HtmlStylePatch, svg: boolean): HtmlStylePatch {
  if (!svg || !("color" in patch)) return patch;
  const { color, ...rest } = patch;
  return { ...rest, fill: color };
}
function applyStyle(node: Element, patch: HtmlStylePatch) {
  const style = parseInlineStyle(node.attribs.style);
  for (const [name, value] of Object.entries(svgPatch(patch, inSvg(node)))) {
    if (value === null || !value.trim()) delete style[name.toLowerCase()];
    else style[name.toLowerCase()] = value.trim();
  }
  const text = inlineStyle(style);
  if (text) node.attribs.style = text; else delete node.attribs.style;
}

/** How many elements a layer's markup has. */
export function htmlNodeCount(html: string): number {
  return elements(parse(html)).length;
}

/** One element of a layer's markup, by its number; undefined when there's no such element. */
export function htmlNodeInfo(html: string, index: number): HtmlNodeInfo | undefined {
  const node = elements(parse(html))[index];
  return node && { node: index, tag: node.name.toLowerCase(), text: textOf(node), ownText: ownTextOf(node), svg: inSvg(node), style: parseInlineStyle(node.attribs.style) };
}

/** The markup with element `index` changed by `edit`. Throws when there's no such element. */
export function editHtmlNode(html: string, index: number, edit: (node: Element) => void): string {
  const document = parse(html);
  const node = elements(document)[index];
  if (!node) throw new Error("That part of the HTML layer is gone. Click the text again.");
  edit(node);
  return serialize(document);
}

/** Puts children in a node, in place of its own. */
function replaceChildren(node: Element, children: ChildNode[]) {
  for (const child of node.children) child.parent = null;
  node.children = children;
  children.forEach((child, index) => {
    child.parent = node;
    child.prev = children[index - 1] ?? null;
    child.next = children[index + 1] ?? null;
  });
}

/** Element `index` with new contents: markup from the canvas's text editor (its
 * drawing numbers are dropped; the result is cleaned when it is saved). */
export function setHtmlNodeContent(html: string, index: number, markup: string): string {
  const fragment = parse(markup);
  for (const element of elements(fragment)) delete element.attribs[HTML_NODE_ATTRIBUTE];
  return editHtmlNode(html, index, node => replaceChildren(node, [...fragment.children]));
}

/** Element `index` with new words of its own, in place of its first words. Elements
 * inside it stay, so "7,669 <tspan>+96%</tspan>" can become "7,700 <tspan>+96%</tspan>". */
export function setHtmlNodeText(html: string, index: number, text: string): string {
  return editHtmlNode(html, index, node => {
    const texts = node.children.filter((child): child is Text => child instanceof Text);
    if (!texts.length) { replaceChildren(node, [new Text(text), ...node.children]); return; }
    const [first, ...rest] = texts;
    first.data = text;
    replaceChildren(node, node.children.filter(child => !rest.includes(child as Text)));
  });
}

/** Element `index` with its inline style changed. */
export function styleHtmlNode(html: string, index: number, patch: HtmlStylePatch): string {
  return editHtmlNode(html, index, node => applyStyle(node, patch));
}

/** The words from `start` to `end` of element `index`'s text in a span (a tspan in
 * an SVG) styled with `patch`; the whole element when the range covers all of it. */
export function styleHtmlText(html: string, index: number, range: { start: number; end: number }, patch: HtmlStylePatch): string {
  return editHtmlNode(html, index, node => {
    const length = textOf(node).length, start = Math.max(0, Math.min(range.start, range.end)), end = Math.min(length, Math.max(range.start, range.end));
    if (end <= start) return;
    if (start === 0 && end === length) { applyStyle(node, patch); return; }
    // Words that are exactly an element's words already (a span styled earlier):
    // style that element, the outermost one, rather than nesting another span.
    let position = 0, exact: Element | undefined;
    const measure = (parent: Element) => {
      for (const child of parent.children) {
        if (child instanceof Text) { position += child.data.length; continue; }
        if (!(child instanceof Element)) continue;
        const from = position;
        measure(child);
        if (from === start && position === end) exact = child;
      }
    };
    measure(node);
    if (exact) { applyStyle(exact, patch); return; }
    const svg = inSvg(node);
    let offset = 0;
    const visit = (parent: Element) => {
      for (const child of [...parent.children]) {
        if (child instanceof Element) { visit(child); continue; }
        if (!(child instanceof Text)) continue;
        const from = offset, to = offset + child.data.length;
        offset = to;
        const a = Math.max(start, from) - from, b = Math.min(end, to) - from;
        if (b <= a) continue;
        const pieces: ChildNode[] = [];
        if (a > 0) pieces.push(new Text(child.data.slice(0, a)));
        const wrapper = new Element(svg ? "tspan" : "span", {}, [new Text(child.data.slice(a, b))]);
        wrapper.children[0].parent = wrapper;
        applyStyle(wrapper, svg ? svgPatch(patch, true) : patch);
        pieces.push(wrapper);
        if (b < child.data.length) pieces.push(new Text(child.data.slice(b)));
        const siblings = parent.children.flatMap(item => item === child ? pieces : [item]);
        replaceChildren(parent, siblings);
      }
    };
    visit(node);
  });
}

/** The layer with new markup, cleaned as it is saved; the same object when nothing changed. */
export function withHtmlLayerMarkup(element: HtmlElement, html: string): HtmlElement {
  const clean = cleanHtmlLayer({ html, css: element.css, tokens: element.tokens });
  if (clean.html === element.html) return element;
  if (!clean.html.trim()) throw new Error("The HTML layer would be empty. Undo instead, or delete the layer.");
  return { ...element, html: clean.html };
}

// ---------------------------------------------------------------------------
// The brand's choices for the style panel

const COLOR_ROLES: [string, string][] = [["--color-text", "Text"], ["--color-accent", "Accent"], ["--color-accent-end", "Accent 2"], ["--color-secondary", "Secondary"], ["--color-source", "Muted"], ["--color-surface", "Surface"], ["--color-background", "Background"]];
const TEXT_STYLE_LABELS: Record<string, string> = { title: "Title", body: "Body", cover: "Cover", "cover-remark": "Cover remark", source: "Source", follow: "Follow", list: "List" };

export type HtmlBrandColor = { name: string; label: string; value: string; css: string };
export type HtmlBrandTextStyle = { name: string; label: string; size: string; weight?: string; css: { fontSize: string; fontWeight?: string; fontFamily?: string } };

/** The brand's colors in a layer's variables: its color roles first, then other palette colors once each. */
export function htmlBrandColors(tokens: Record<string, string> | undefined): HtmlBrandColor[] {
  const result: HtmlBrandColor[] = [], seen = new Set<string>();
  const add = (name: string, label: string) => {
    const value = tokens?.[name];
    if (!value || seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    result.push({ name, label, value, css: `var(${name})` });
  };
  for (const [name, label] of COLOR_ROLES) add(name, label);
  for (const name of Object.keys(tokens ?? {}).filter(key => /^--color-[a-z0-9-]+$/.test(key))) add(name, name.slice(8).split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "));
  return result;
}

/** The brand's text styles in a layer's variables, largest first: each style's size, and its weight and font. */
export function htmlBrandTextStyles(tokens: Record<string, string> | undefined): HtmlBrandTextStyle[] {
  const styles = Object.keys(tokens ?? {}).flatMap(key => /^--([a-z0-9-]+)-size$/.exec(key)?.[1] ?? []).filter(name => name !== "min-text");
  return styles.map(name => ({
    name,
    label: TEXT_STYLE_LABELS[name] ?? name.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "),
    size: tokens![`--${name}-size`],
    ...(tokens![`--${name}-weight`] ? { weight: tokens![`--${name}-weight`] } : {}),
    css: { fontSize: `var(--${name}-size)`, ...(tokens![`--${name}-weight`] ? { fontWeight: `var(--${name}-weight)` } : {}), ...(tokens![`--${name}-font`] ? { fontFamily: `var(--${name}-font)` } : {}) },
  })).sort((a, b) => (Number.parseFloat(b.size) || 0) - (Number.parseFloat(a.size) || 0));
}
