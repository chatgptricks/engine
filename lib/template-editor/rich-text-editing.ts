import { sanitizeRichText, type TextElement, type ShapeImageFill } from "./model";
import { colorWithAlpha, parseColor } from "./color-utils";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export type TextFormattingPatch = Omit<Partial<TextElement>, "textureFill"> & { textureFill?: ShapeImageFill | null };
export type TextFormattingTarget = { elementId: string; html: string; start: number; end: number };
export type TextFormatter = ((patch: TextFormattingPatch, expected?: TextFormattingTarget) => boolean) & { capture: () => TextFormattingTarget | null };
type RunStyle = { weight?: string; italic?: string; decorations?: string[]; color?: string; size?: string; font?: string; textureId?: string };
type Run = { node: Node; text: string; start: number; end: number; style: RunStyle };

export function normalizedCssColor(color: string): string | undefined {
  if (parseColor(color)) return color;
  const rgb = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i);
  if (!rgb) return undefined;
  const base = `#${rgb.slice(1, 4).map(value => Math.round(Math.max(0, Math.min(255, Number(value)))).toString(16).padStart(2, "0")).join("")}`;
  return colorWithAlpha(base, rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1));
}

export function scaleRichTextFonts(html: string | undefined, factor: number): string | undefined {
  if (html === undefined || !Number.isFinite(factor) || factor <= 0) return html;
  return sanitizeRichText(html.replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, (_, value: string) => `font-size:${Math.round(Math.max(1, Math.min(500, Number(value) * factor)) * 100) / 100}px`));
}

/** Balance inline tags per line so lists and paragraphs retain rich runs. */
export function splitRichLines(richText: string | undefined, text = ""): string[] {
  const safe = richText === undefined ? undefined : sanitizeRichText(richText);
  const html = safe ?? escape(text);
  const lines: string[] = [], stack: { open: string; tag: string }[] = [];
  let line = "";
  const nextLine = () => { lines.push(line + [...stack].reverse().map(item => `</${item.tag}>`).join("")); line = stack.map(item => item.open).join(""); };
  for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (/^<br\s*\/?\s*>$/i.test(token)) { nextLine(); continue; }
    const close = token.match(/^<\/(\w+)>$/);
    if (close) { line += token; stack.pop(); continue; }
    const open = token.match(/^<(\w+)(?:\s[^>]*)?>$/);
    if (open) { stack.push({ open: token, tag: open[1] }); line += token; continue; }
    const parts = token.replace(/\r\n?/g, "\n").split("\n");
    parts.forEach((part, index) => { if (index) nextLine(); line += part; });
  }
  lines.push(line + [...stack].reverse().map(item => `</${item.tag}>`).join(""));
  return lines;
}

/** CSS decorations propagate through descendants; paint them on individual runs. */
export function resolveRichDecorations(html: string, underline = false, strikethrough = false): string {
  const safe = sanitizeRichText(html);
  if (safe === undefined) return "";
  const stack: { tag: string; decorations: string[] }[] = [];
  let decorations = [underline ? "underline" : "", strikethrough ? "line-through" : ""].filter(Boolean);
  return (safe.match(/<[^>]+>|[^<]+/g) ?? []).map(token => {
    if (token === "<br>") return token;
    const closing = token.match(/^<\/(\w+)>$/);
    if (closing) { const entry = stack.pop(); decorations = stack.at(-1)?.decorations ?? [underline ? "underline" : "", strikethrough ? "line-through" : ""].filter(Boolean); return `</${entry?.tag ?? closing[1]}>`; }
    const opening = token.match(/^<(\w+)(?:\s[^>]*)?>$/);
    if (opening) {
      let clean = token;
      if (["u", "s", "strike"].includes(opening[1])) { decorations = [...decorations, opening[1] === "u" ? "underline" : "line-through"]; clean = "<span>"; }
      const declared = token.match(/text-decoration(?:-line)?\s*:\s*([^;"']+)/i);
      if (declared) { decorations = declared[1].match(/underline|line-through/g) ?? []; clean = clean.replace(/text-decoration(?:-line)?\s*:\s*[^;"']+;?\s*/i, "").replace(/\sstyle="\s*"/, ""); }
      stack.push({ tag: clean.match(/^<(\w+)/)![1], decorations: [...decorations] });
      return clean;
    }
    return `<span style="text-decoration:${[...new Set(decorations)].join(" ") || "none"}">${token}</span>`;
  }).join("");
}

function collectRuns(root: HTMLElement) {
  const runs: Run[] = [], starts = new Map<Node, number>(), ends = new Map<Node, number>();
  let offset = 0;
  const append = (node: Node, text: string, style: RunStyle) => { if (!text) return; runs.push({ node, text, start: offset, end: offset + text.length, style }); offset += text.length; };
  const visit = (node: Node, inherited: RunStyle) => {
    starts.set(node, offset);
    if (node.nodeType === 3) { append(node, node.textContent ?? "", inherited); ends.set(node, offset); return; }
    if (!(node instanceof HTMLElement)) { ends.set(node, offset); return; }
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      const parent=node.parentElement;
      const placeholder=parent&&["DIV","P","LI"].includes(parent.tagName)&&[...parent.childNodes].every(child=>child===node||child.nodeType===3&&!child.textContent?.trim());
      if(!placeholder)append(node, "\n", inherited);
      ends.set(node, offset);return;
    }
    const style: RunStyle = { ...inherited, decorations: inherited.decorations ? [...inherited.decorations] : undefined };
    if (node !== root) {
      if (tag === "b" || tag === "strong") style.weight = "700";
      if (tag === "i" || tag === "em") style.italic = "italic";
      if (tag === "u") (style.decorations ??= []).push("underline");
      if (tag === "s" || tag === "strike") (style.decorations ??= []).push("line-through");
      if (node.style.fontWeight) style.weight = node.style.fontWeight;
      if (node.style.fontStyle) style.italic = node.style.fontStyle;
      const decoration = node.style.textDecorationLine || node.style.textDecoration;
      if (decoration) style.decorations = decoration.match(/underline|line-through/g) ?? [];
      const color = normalizedCssColor(node.style.color); if (color) style.color = color;
      if (node.style.fontSize) style.size = node.style.fontSize;
      const font = [...node.classList].find(value => /^gf-font-[a-z0-9-]+$/.test(value)); if (font) style.font = font;
      const textureId=node.getAttribute("data-texture-id");if(textureId&&/^[a-zA-Z0-9_-]{1,120}$/.test(textureId))style.textureId=textureId;
    }
    [...node.childNodes].forEach(child => visit(child, style));
    ends.set(node, offset);
    if (node !== root && ["div", "p", "li"].includes(tag) && node.nextSibling) append(node, "\n", style);
  };
  const baseDecorations=(root.style.textDecorationLine||root.style.textDecoration).match(/underline|line-through/g);
  visit(root, baseDecorations ? {decorations:baseDecorations} : {});
  return { runs, starts, ends, length: offset };
}

function runHtml(run: Pick<Run, "text" | "style">): string {
  const { style } = run;
  const declarations = [style.weight && `font-weight:${style.weight}`, style.italic && `font-style:${style.italic}`, style.decorations && `text-decoration:${[...new Set(style.decorations)].join(" ") || "none"}`, style.color && `color:${style.color}`, style.size && `font-size:${style.size}`].filter(Boolean);
  const text = escape(run.text).replace(/\r\n?|\n/g, "<br>");
  return declarations.length || style.font || style.textureId ? `<span${style.font ? ` class="${style.font}"` : ""}${style.textureId?` data-texture-id="${style.textureId}"`:""}${declarations.length ? ` style="${declarations.join("; ")}"` : ""}>${text}</span>` : text;
}

export function editorRichHtml(node: HTMLElement): string | undefined {
  return sanitizeRichText(collectRuns(node).runs.map(runHtml).join(""));
}

function rangeOffsets(collected: ReturnType<typeof collectRuns>, range: Range) {
  const boundary = (container: Node, offset: number) => container.nodeType === 3 ? (collected.starts.get(container) ?? 0) + offset : offset < container.childNodes.length ? collected.starts.get(container.childNodes[offset]) ?? 0 : collected.ends.get(container) ?? collected.length;
  return { start: boundary(range.startContainer, range.startOffset), end: boundary(range.endContainer, range.endOffset) };
}

export function textEditingFingerprint(element:Pick<TextElement,"text"|"richText"|"underline"|"strikethrough">):string {
  return JSON.stringify([element.text,element.richText,Boolean(element.underline),Boolean(element.strikethrough)]);
}
/** Logical offsets survive DOM replacement, including paragraph separators. */
export function captureTextSelection(node:HTMLElement,range:Range|null):{start:number;end:number}|null {
  return range&&node.contains(range.commonAncestorContainer)?rangeOffsets(collectRuns(node),range):null;
}
export function restoreTextSelection(node:HTMLElement,range:Range,selection:{start:number;end:number}):void {
  const collected=collectRuns(node);
  const setBoundary=(which:"start"|"end",value:number)=>{
    const offset=Math.max(0,Math.min(collected.length,value)),target=collected.runs.find(run=>offset>=run.start&&offset<=run.end);
    if(target?.node.nodeType===3){if(which==="start")range.setStart(target.node,offset-target.start);else range.setEnd(target.node,offset-target.start);}
    else if(target){if(which==="start"){if(offset>target.start)range.setStartAfter(target.node);else range.setStartBefore(target.node);}else{if(offset>target.start)range.setEndAfter(target.node);else range.setEndBefore(target.node);}}
    else{if(which==="start")range.setStart(node,node.childNodes.length);else range.setEnd(node,node.childNodes.length);}
  };
  setBoundary("start",selection.start);setBoundary("end",selection.end);
}

export function captureTextFormattingTarget(node: HTMLElement, range: Range | null, elementId: string): TextFormattingTarget | null {
  if(!range || range.collapsed || !node.contains(range.commonAncestorContainer))return null;
  const collected=collectRuns(node),{start,end}=rangeOffsets(collected,range);
  return end>start?{elementId,html:sanitizeRichText(collected.runs.map(runHtml).join(""))??"",start,end}:null;
}
export function sameTextFormattingTarget(actual: TextFormattingTarget | null, expected: TextFormattingTarget): boolean {
  return Boolean(actual&&actual.elementId===expected.elementId&&actual.html===expected.html&&actual.start===expected.start&&actual.end===expected.end);
}

/** Mixed selections enable a style; a selection uniformly using it disables it. */
export function textRangeTogglePatch(node: HTMLElement, range: Range, key: "fontWeight" | "italic" | "underline" | "strikethrough", base: TextElement): Partial<TextElement> {
  const collected = collectRuns(node), { start, end } = rangeOffsets(collected, range);
  const runs = collected.runs.filter(run => run.end > start && run.start < end && run.text.trim());
  const enabled = (run: Run) => {
    if (key === "fontWeight") return run.style.weight === "bold" || Number(run.style.weight ?? base.fontWeight) >= 700;
    if (key === "italic") return run.style.italic ? run.style.italic === "italic" : base.italic;
    return run.style.decorations ? run.style.decorations.includes(key === "underline" ? "underline" : "line-through") : Boolean(base[key]);
  };
  const allEnabled = runs.length > 0 && runs.every(enabled);
  return key === "fontWeight" ? { fontWeight: allEnabled ? 400 : 700 } : { [key]: !allEnabled };
}

/** Flatten the editable grammar so clearing a nested run removes inherited styles. */
export function formatTextRange(node: HTMLElement, range: Range, patch: TextFormattingPatch, textureId?: string | null): boolean {
  if (range.collapsed || !node.contains(range.commonAncestorContainer)) return false;
  const supported = ["fontWeight", "italic", "underline", "strikethrough", "color", "fontSize", "font", "textureFill"] as const;
  if (!supported.some(key => patch[key] !== undefined)) return false;
  const collected = collectRuns(node);
  const { start, end } = rangeOffsets(collected, range);
  if (end <= start) return false;
  const updated: Pick<Run, "text" | "style">[] = [];
  for (const run of collected.runs) {
    const left = Math.max(run.start, start), right = Math.min(run.end, end);
    if (left >= right) { updated.push(run); continue; }
    if (left > run.start) updated.push({ text: run.text.slice(0, left - run.start), style: run.style });
    const style: RunStyle = { ...run.style, decorations: run.style.decorations ? [...run.style.decorations] : undefined };
    if (patch.fontWeight !== undefined) style.weight = String(patch.fontWeight);
    if (patch.italic !== undefined) style.italic = patch.italic ? "italic" : "normal";
    for (const [key, value] of [["underline", "underline"], ["strikethrough", "line-through"]] as const) if (patch[key] !== undefined) { style.decorations = (style.decorations??[]).filter(item => item !== value); if (patch[key]) style.decorations.push(value); }
    if (patch.color !== undefined) style.color = normalizedCssColor(patch.color);
    if (patch.fontSize !== undefined) style.size = `${patch.fontSize}px`;
    if (patch.font !== undefined) style.font = `gf-font-${patch.font}`;
    if(patch.textureFill!==undefined)style.textureId=textureId??undefined;
    updated.push({ text: run.text.slice(left - run.start, right - run.start), style });
    if (right < run.end) updated.push({ text: run.text.slice(right - run.start), style: run.style });
  }
  const html = sanitizeRichText(updated.map(runHtml).join(""));
  if (html === undefined) return false;
  // Native insertHTML treats 700 as redundant inside some 600-weight boxes and
  // replays that normalized markup on Redo. The document journal owns history;
  // direct replacement retains the exact run styles and the active field focus.
  const selection = window.getSelection();
  // Keep editable paragraphs as blocks: list prefixes and paragraph spacing
  // are drawn by the same per-line CSS before and after range formatting.
  node.innerHTML = splitRichLines(html).map(line => `<div>${line || "<br>"}</div>`).join("");
  const rebuilt = collectRuns(node);
  const setBoundary = (which: "start" | "end", offset: number) => {
    const target = rebuilt.runs.find(run => offset >= run.start && offset <= run.end);
    if (target?.node.nodeType === 3) { if (which === "start") range.setStart(target.node, offset - target.start); else range.setEnd(target.node, offset - target.start); }
    else if (target) { if (which === "start") { if(offset>target.start)range.setStartAfter(target.node);else range.setStartBefore(target.node); } else { if(offset>target.start)range.setEndAfter(target.node);else range.setEndBefore(target.node); } }
    else { if (which === "start") range.setStart(node, node.childNodes.length); else range.setEnd(node, node.childNodes.length); }
  };
  setBoundary("start", start); setBoundary("end", end); selection?.removeAllRanges(); selection?.addRange(range);
  return true;
}
