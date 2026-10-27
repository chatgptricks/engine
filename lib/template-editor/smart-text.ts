import { richTextToPlain, sanitizeRichText, type CanvasScene, type DesignDocument, type TextElement } from "./model";
import { bounded } from "./export";
import { scaleRichTextFonts, splitRichLines } from "./rich-text-editing";

export type SmartWord = { text: string; html: string; paragraph: number };
export type SmartMetrics = { widths: number[]; space: number; size: number };
export type SmartTextLayout = { fontSize: number; height: number; lines: { text: string; html: string; width: number }[]; warning?: string; overflow: boolean };
export type SmartSceneLayout = { scene: CanvasScene; texts: Map<string, SmartTextLayout> };

/** Balanced HTML fragments keep colored words, emphasis and texture bindings. */
export function smartWords(element: Pick<TextElement, "text" | "richText">): SmartWord[] {
  const words: SmartWord[] = [];
  for (const [paragraph, line] of splitRichLines(element.richText, element.text).entries()) {
    const stack: { tag: string; open: string }[] = [];
    let html = "", hasText = false;
    const finish = () => {
      if (hasText) {
        const balanced = html + [...stack].reverse().map(entry => `</${entry.tag}>`).join("");
        words.push({ text: richTextToPlain(balanced), html: balanced, paragraph });
      }
      html = stack.map(entry => entry.open).join(""); hasText = false;
    };
    for (const token of line.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith("</")) { html += token; stack.pop(); continue; }
      if (token.startsWith("<")) { const tag = token.match(/^<(\w+)/)?.[1]; if (tag) { stack.push({ tag, open: token }); html += token; } continue; }
      for (const part of token.split(/(\s+|&nbsp;)/)) {
        if (!part) continue;
        if (/^(\s+|&nbsp;)$/.test(part)) finish();
        else { html += part; hasText = true; }
      }
    }
    finish();
  }
  return words;
}

/** Exact line-count partitioning with an orphan penalty and balanced widths. */
function partition(widths: number[], space: number, width: number, count: number, minWords: number): number[] | null {
  const n = widths.length;
  if (!count || count > n || count * minWords > n) return null;
  const prefix = [0]; widths.forEach(value => prefix.push(prefix.at(-1)! + value));
  const costs = Array.from({ length: count + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const parents = Array.from({ length: count + 1 }, () => new Int32Array(n + 1).fill(-1));
  costs[0][0] = 0;
  const ideal = (prefix[n] + space * (n - count)) / count;
  for (let line = 1; line <= count; line++) for (let end = line * minWords; end <= n; end++) {
    for (let start = end - minWords; start >= (line - 1) * minWords; start--) {
      const used = prefix[end] - prefix[start] + space * (end - start - 1);
      if (used > width + .01) break;
      if (!Number.isFinite(costs[line - 1][start])) continue;
      const orphan = end - start === 1 && n >= count * 2 ? width * width * 4 : 0;
      const cost = costs[line - 1][start] + (used - ideal) ** 2 + orphan;
      if (cost < costs[line][end]) { costs[line][end] = cost; parents[line][end] = start; }
    }
  }
  if (!Number.isFinite(costs[count][n])) return null;
  const ends: number[] = []; let end = n;
  for (let line = count; line > 0; line--) { ends.unshift(end); end = parents[line][end]; }
  return ends;
}

export function fitSmartText(element: TextElement, metrics: SmartMetrics, words = smartWords(element)): SmartTextLayout {
  const rule = element.smartText!;
  const width = Math.max(1, element.width - 2 * (element.padding ?? 0) - .5), available = Math.max(1, rule.maxHeight - 2 * (element.padding ?? 0));
  if (!words.length) return { fontSize: element.fontSize, height: element.fontSize * element.lineHeight, lines: [], overflow: false };
  const tooLong = words.length > 512;
  const requested = rule.lines, maxCount = rule.role === "cover" ? Math.max(1, Math.floor(words.length / 2)) : words.length;
  const target = requested ? Math.min(requested, maxCount) : 0;
  const minimumWords = rule.role === "cover" && words.length >= target * 2 ? 2 : 1;
  function atSize(size: number, balance: boolean, limit = available) {
    const ratio = size / metrics.size;
    const widths = words.map((word, index) => Math.max(.01, (metrics.widths[index] - element.letterSpacing * word.text.length) * ratio + element.letterSpacing * word.text.length));
    const space = Math.max(0, (metrics.space - element.letterSpacing) * ratio + element.letterSpacing);
    let ends: number[] = [];
    if (target && !tooLong) ends = partition(widths, space, width, target, minimumWords) ?? [];
    else {
      let start = 0, used = 0;
      for (let index = 0; index < words.length; index++) {
        const paragraph = !requested && index > 0 && words[index].paragraph !== words[index - 1].paragraph;
        if (index > start && (paragraph || used + space + widths[index] > width)) { ends.push(index); start = index; used = 0; }
        used += (index > start ? space : 0) + widths[index];
      }
      ends.push(words.length);
      // Balance short headlines. Body copy keeps paragraph boundaries and rhythm.
      if (balance && rule.role !== "body" && ends.length <= 8 && !tooLong && words.every(word => word.paragraph === words[0].paragraph)) ends = partition(widths, space, width, ends.length, rule.role === "cover" && words.length >= ends.length * 2 ? 2 : 1) ?? ends;
    }
    const blankLines = requested ? 0 : ends.slice(0, -1).reduce((total, end) => total + Math.max(0, words[end].paragraph - words[end - 1].paragraph - 1), 0);
    const height = (ends.length + blankLines) * size * element.lineHeight + Math.max(0, ends.length + blankLines - 1) * (element.paragraphSpacing ?? 0) + 2 * (element.padding ?? 0);
    const fits = ends.length > 0 && widths.every(value => value <= width) && height <= limit + 2 * (element.padding ?? 0) + .01;
    return { ends, widths, space, height, fits };
  }
  const low = rule.minFontSize, high = Math.max(low, requested ? rule.maxFontSize : Math.min(element.fontSize, rule.maxFontSize));
  /** Largest size in [from, to] that fits `limit`, or null when even `from` overflows. */
  const largest = (from: number, to: number, limit: number) => {
    let lo = from, hi = Math.max(from, to);
    if (atSize(hi, false, limit).fits) return hi;
    if (!atSize(lo, false, limit).fits) return null;
    for (let step = 0; step < 14; step++) { const middle = (lo + hi) / 2; if (atSize(middle, false, limit).fits) lo = middle; else hi = middle; }
    return Math.floor(lo * 100) / 100;
  };
  let chosen: number;
  const pad = 2 * (element.padding ?? 0);
  if (!requested && rule.baseHeight !== undefined && rule.softMinFontSize !== undefined && rule.baseHeight < rule.maxHeight) {
    // Stay in the authored box while a modest size change is enough; only then
    // take room from the layout, and finally shrink to the readable minimum.
    const soft = Math.min(high, Math.max(low, rule.softMinFontSize));
    chosen = largest(soft, high, Math.min(available, Math.max(1, rule.baseHeight - pad))) ?? largest(low, soft, available) ?? low;
  } else chosen = largest(low, high, available) ?? low;
  const result = atSize(chosen, true);
  const overflow = !result.fits || tooLong;
  if (!result.ends.length) {
    // Show all content, with a visible warning; never silently truncate the copy.
    const fallback = fitSmartText({ ...element, smartText: { ...rule, lines: 0, minFontSize: chosen, maxFontSize: chosen } }, metrics, words);
    return { ...fallback, overflow: true, warning: "This text needs shortening to fit legibly. Choose Auto or use fewer words." };
  }
  let start = 0;
  const lines = result.ends.flatMap(end => {
    const blankLines = !requested && start > 0 ? Math.max(0, words[start].paragraph - words[start - 1].paragraph - 1) : 0;
    const subset = words.slice(start, end), used = result.widths.slice(start, end).reduce((sum, value) => sum + value, 0) + result.space * (end - start - 1);
    start = end;
    return [...Array.from({length:blankLines}, () => ({text:"", html:"<br>", width:0})), { text: subset.map(word => word.text).join(" "), html: subset.map(word => word.html).join(" "), width: used }];
  });
  return { fontSize: chosen, height: Math.ceil(result.height * 100) / 100, lines, overflow, warning: overflow ? "This text needs shortening to fit legibly. Use fewer words or another slide." : requested && lines.length !== requested ? `Add more words to fill ${requested} balanced lines. Using ${lines.length} for now.` : undefined };
}

const metricCache = new Map<string, SmartMetrics>();
export function clearSmartTextMeasurements() { metricCache.clear(); }
export function measureSmartText(element: TextElement, words = smartWords(element)): SmartMetrics {
  const key = JSON.stringify([element.text, element.richText, element.font, element.fontSize, element.fontWeight, element.italic, element.letterSpacing]);
  const cached = metricCache.get(key); if (cached) return cached;
  const node = document.createElement("div");
  node.className = `gf-font-${element.font}`;
  Object.assign(node.style, { position: "fixed", left: "-20000px", top: "0", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre", fontSize: `${element.fontSize}px`, fontWeight: String(element.fontWeight), fontStyle: element.italic ? "italic" : "normal", letterSpacing: `${element.letterSpacing}px`, lineHeight: String(element.lineHeight) });
  const spans = words.map(word => { const span = document.createElement("span"); span.style.display = "inline-block"; span.innerHTML = word.html; node.append(span); return span; });
  const space = document.createElement("span"); space.textContent = " "; node.append(space); (document.querySelector(".gf-root") ?? document.body).append(node);
  try {
    const metrics = { widths: spans.map(span => span.getBoundingClientRect().width), space: space.getBoundingClientRect().width, size: element.fontSize };
    if (metricCache.size >= 150) metricCache.delete(metricCache.keys().next().value!);
    metricCache.set(key, metrics); return metrics;
  } finally { node.remove(); }
}

export function layoutSmartScene(scene: CanvasScene, measure = measureSmartText): SmartSceneLayout {
  const texts = new Map<string, SmartTextLayout>(), resolved = new Map<string, CanvasScene["elements"][number]>(), visiting = new Set<string>();
  const slots = new Map(scene.elements.flatMap(element => [[element.id, element] as const, ...(element.slot ? [[element.slot, element] as const] : [])]));
  function resolve(original: CanvasScene["elements"][number]): CanvasScene["elements"][number] {
    if (resolved.has(original.id)) return resolved.get(original.id)!;
    if (visiting.has(original.id)) return original; // Malformed/cyclic imported flows stay bounded.
    visiting.add(original.id);
    let element = original;
    const flow = original.smartFlow, anchor = flow && slots.get(flow.after);
    const upward = flow?.direction === "up";
    // Upward flows: the bottom edge sits `gap` above the anchor's resolved top.
    let edge: number | undefined;
    if (anchor && !anchor.hidden) {
      const other = resolve(anchor);
      if (upward) {
        edge = other.y - flow!.gap;
        element = flow!.resize ? { ...element, height: Math.max(1, edge - element.y) } : { ...element, y: edge - element.height };
      } else {
        const y = other.y + (flow!.edge === "top" ? 0 : other.height) + flow!.gap;
        element = { ...element, y, ...(flow!.resize ? { height: Math.max(1, flow!.bottom - y) } : {}) };
      }
    }
    if (element.type === "text" && element.smartText && !element.hidden) {
      const rule = element.smartText, bottomEdge = edge ?? rule.anchorBottom;
      let maximum = rule.maxHeight;
      if (flow && !upward) maximum = Math.min(maximum, Math.max(1, flow.bottom - element.y));
      if (flow && upward && edge !== undefined) maximum = Math.min(maximum, Math.max(1, edge - flow.bottom));
      const candidate = { ...element, smartText: { ...rule, maxHeight: maximum } };
      const words = smartWords(element), layout = fitSmartText(candidate, measure(candidate, words), words);
      texts.set(element.id, layout);
      const height = Math.min(maximum, layout.height);
      element = { ...element, autoFitFontSize: layout.fontSize, height, textMode: "auto-fit", ...(bottomEdge !== undefined ? { y: bottomEdge - height } : {}) };
    }
    visiting.delete(original.id); resolved.set(original.id, element); return element;
  }
  const elements = scene.elements.map(resolve);
  const changed = elements.some((element, index) => element.y !== scene.elements[index].y || element.height !== scene.elements[index].height || element.type === "text" && scene.elements[index].type === "text" && element.autoFitFontSize !== (scene.elements[index] as TextElement).autoFitFontSize);
  return { scene: changed ? { ...scene, elements } : scene, texts };
}

/** Resolve every exported page after its fonts load, including unvisited pages.
 * Bake breaks into an export-only copy so raster and document PDF use the same lines. */
export async function prepareSmartTextExport(design: DesignDocument, signal?: AbortSignal, pageIds = design.pages.map(page => page.id)): Promise<DesignDocument> {
  const scenes = [design.masterScene, design.continuousCanvas, ...design.pages.filter(page => pageIds.includes(page.id)).map(page => page.canvas)].filter((scene): scene is CanvasScene => Boolean(scene));
  if (!scenes.some(scene => scene.elements.some(element => element.type === "text" && element.smartText))) return design;
  for (const scene of scenes) for (const element of scene.elements) if (element.type === "text" && element.smartText) {
    signal?.throwIfAborted();
    const probe = document.createElement("span"); probe.className = `gf-font-${element.font}`; (document.querySelector(".gf-root") ?? document.body).append(probe);
    const family = getComputedStyle(probe).fontFamily; probe.remove();
    await bounded(document.fonts.load(`${element.fontWeight} ${element.fontSize}px ${family}`, element.text.slice(0, 200)), signal);
  }
  await bounded(document.fonts.ready, signal); signal?.throwIfAborted(); clearSmartTextMeasurements();
  const materialize = (scene: CanvasScene) => {
    const fitted = layoutSmartScene(scene);
    return { ...fitted.scene, elements: fitted.scene.elements.map(element => {
      const layout = fitted.texts.get(element.id);
      if (element.type !== "text" || !layout) return element;
      if (layout.overflow) throw new Error(`Shorten “${element.name}” before exporting: the text does not fit legibly.`);
      return { ...element, smartText: undefined, smartFlow: undefined, fontSize: layout.fontSize, autoFitFontSize: undefined, textMode: "fixed" as const, text: layout.lines.map(line => line.text).join("\n"), richText: sanitizeRichText(layout.lines.map(line => scaleRichTextFonts(line.html, layout.fontSize / element.fontSize)).join("<br>")) };
    }) };
  };
  return { ...design, pages: design.pages.map(page => page.canvas && pageIds.includes(page.id) ? { ...page, canvas: materialize(page.canvas) } : page), ...(design.masterScene ? { masterScene: materialize(design.masterScene) } : {}), ...(design.continuousCanvas ? { continuousCanvas: materialize(design.continuousCanvas) } : {}) };
}
