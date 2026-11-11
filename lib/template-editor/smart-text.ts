import { richTextToPlain, sanitizeRichText, type CanvasScene, type DesignDocument, type TextElement } from "./model";
import { bounded } from "./export";
import { scaleRichTextFonts, splitRichLines } from "./rich-text-editing";

export type SmartWord = { text: string; html: string; paragraph: number };
export type SmartMetrics = { widths: number[]; space: number; size: number };
/** `paragraphSpacing` is set for lists, whose gaps open up to fill their box. */
export type SmartTextLayout = { fontSize: number; height: number; lines: { text: string; html: string; width: number }[]; warning?: string; overflow: boolean; paragraphSpacing?: number };
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
      // Body copy never ends a paragraph on one word: the word before it moves down too, when its line keeps two.
      if (balance && rule.role === "body") for (let line = 1; line < ends.length; line++) {
        const start = ends[line - 1], end = ends[line], before = line > 1 ? ends[line - 2] : 0;
        const lastOfParagraph = end === words.length || words[end].paragraph !== words[start].paragraph;
        if (lastOfParagraph && end - start === 1 && start - before >= 3 && words[start - 1].paragraph === words[start].paragraph && widths[start - 1] + space + widths[start] <= width) ends[line - 1] = start - 1;
      }
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
  // A size the person set is kept as it is: only the line breaks follow it.
  const fixed = rule.fontSize !== undefined && Number.isFinite(rule.fontSize) ? Math.max(1, Math.min(500, rule.fontSize)) : undefined;
  if (fixed !== undefined) chosen = fixed;
  else if (!requested && rule.baseHeight !== undefined && rule.softMinFontSize !== undefined && rule.baseHeight < rule.maxHeight) {
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
    // A size the person set wraps on as many lines as it needs; only running out of room is a problem.
    if (fixed !== undefined) return { ...fallback, warning: fallback.overflow ? fallback.warning : `At this size the text needs ${fallback.lines.length} lines, not ${requested}. Make it smaller for ${requested} lines.` };
    return { ...fallback, overflow: true, warning: "This text needs shortening to fit legibly. Choose Auto or use fewer words." };
  }
  let start = 0;
  const lines = result.ends.flatMap(end => {
    const blankLines = !requested && start > 0 ? Math.max(0, words[start].paragraph - words[start - 1].paragraph - 1) : 0;
    const subset = words.slice(start, end), used = result.widths.slice(start, end).reduce((sum, value) => sum + value, 0) + result.space * (end - start - 1);
    start = end;
    return [...Array.from({length:blankLines}, () => ({text:"", html:"<br>", width:0})), { text: subset.map(word => word.text).join(" "), html: subset.map(word => word.html).join(" "), width: used }];
  });
  return { fontSize: chosen, height: Math.ceil(result.height * 100) / 100, lines, overflow, warning: overflow ? fixed !== undefined ? "This size is too big for the text's space. Make it smaller or choose Auto size." : "This text needs shortening to fit legibly. Use fewer words or another slide." : requested && lines.length !== requested ? `Add more words to fill ${requested} balanced lines. Using ${lines.length} for now.` : undefined };
}

/** The bullet or number column, as wide as `.te-canvas-list-prefix`; wrapped lines hang under the item's text. */
export const LIST_MARKER_EM = 1.35;

/** Largest value in [from, to] that passes a monotonic `test`, or null when even `from` fails. */
function largestPassing(from: number, to: number, test: (value: number) => boolean): number | null {
  let lo = from, hi = Math.max(from, to);
  if (test(hi)) return hi;
  if (!test(lo)) return null;
  for (let step = 0; step < 14; step++) { const middle = (lo + hi) / 2; if (test(middle)) lo = middle; else hi = middle; }
  return Math.floor(lo * 100) / 100;
}

/** A bulleted (or numbered) list: each paragraph is one item. A list that fits
 * at its authored size fills its column: type grows up to `maxFontSize` while
 * no item needs another line or, when single lines would still leave a fifth
 * of the column empty, as far as the wrapped items fit with two words on every
 * line; then the gaps open, up
 * to `maxParagraphSpacing` scaled with the type. A list that doesn't fit
 * shrinks type and gaps together down to `minFontSize`. `fixed` sets the size
 * outright and caps the gap (the shared values of a group of columns). */
export function fitSmartList(element: TextElement, metrics: SmartMetrics, words = smartWords(element), fixed?: { fontSize: number; paragraphSpacing?: number }): SmartTextLayout {
  const rule = element.smartText!, pad = element.padding ?? 0;
  const width = Math.max(1, element.width - 2 * pad - .5), available = Math.max(1, rule.maxHeight - 2 * pad);
  const items = splitRichLines(element.richText, element.text), count = Math.max(1, items.length);
  const marker = element.listStyle && element.listStyle !== "none" ? LIST_MARKER_EM : 0, hang = element.hangingIndent ? marker : 0;
  const base = element.fontSize, baseSpacing = rule.paragraphSpacing ?? element.paragraphSpacing ?? 0;
  const spacingAt = (size: number) => baseSpacing * size / base;
  const itemWords = new Array<number>(count).fill(0);
  for (const word of words) itemWords[word.paragraph] = (itemWords[word.paragraph] ?? 0) + 1;
  function wrap(size: number) {
    const ratio = size / metrics.size, first = Math.max(1, width - marker * size), rest = Math.max(1, width - hang * size);
    const widths = words.map((word, index) => Math.max(.01, (metrics.widths[index] - element.letterSpacing * word.text.length) * ratio + element.letterSpacing * word.text.length));
    const space = Math.max(0, (metrics.space - element.letterSpacing) * ratio + element.letterSpacing);
    const lines = new Array<number>(count).fill(1);
    let used = 0, limit = first;
    words.forEach((word, index) => {
      if (index === 0 || word.paragraph !== words[index - 1].paragraph) { used = widths[index]; limit = first; return; }
      if (used + space + widths[index] > limit) { lines[word.paragraph]++; used = widths[index]; limit = rest; } else used += space + widths[index];
    });
    // `lone`: some wrapped item can't give each of its lines two words.
    return { lines: lines.reduce((total, value) => total + value, 0), fits: widths.every(value => value <= first), lone: lines.some((value, item) => value > 1 && itemWords[item] < 2 * value) };
  }
  const textHeight = (size: number) => wrap(size).lines * size * element.lineHeight;
  const fits = (size: number, spacing: number) => wrap(size).fits && textHeight(size) + (count - 1) * spacing <= available + .01;
  // The gap that fills the column at `size`, at least the authored ratio and at most `maxParagraphSpacing`
  // scaled with the type. Half a point of slack, so browser rounding never pushes the last line past the box.
  const gapAt = (size: number) => count > 1 ? Math.max(spacingAt(size), Math.min(Math.max(spacingAt(size), (rule.maxParagraphSpacing ?? 0) * size / base), (available - .5 - textHeight(size)) / (count - 1))) : spacingAt(size);
  let size: number;
  if (fixed) size = fixed.fontSize;
  else if (fits(base, baseSpacing)) {
    const natural = wrap(base).lines, top = Math.max(base, rule.maxFontSize);
    size = largestPassing(base, top, candidate => wrap(candidate).lines <= natural && fits(candidate, spacingAt(candidate))) ?? base;
    // Wrapping to fill the column is only worth it when no line is left with a single word.
    if (textHeight(size) + (count - 1) * gapAt(size) < .8 * available) size = largestPassing(size, top, candidate => fits(candidate, spacingAt(candidate)) && !wrap(candidate).lone) ?? size;
  } else {
    const low = Math.min(rule.minFontSize, base);
    size = largestPassing(low, base, candidate => fits(candidate, spacingAt(candidate))) ?? low;
  }
  const spacing = Math.min(gapAt(size), fixed?.paragraphSpacing ?? Infinity);
  const overflow = !fits(size, spacing), height = textHeight(size) + (count - 1) * spacing + 2 * pad;
  const lines = items.map((_, paragraph) => {
    const own = words.filter(word => word.paragraph === paragraph);
    return { text: own.map(word => word.text).join(" "), html: own.map(word => word.html).join(" "), width: 0 };
  });
  return { fontSize: size, paragraphSpacing: Math.floor(spacing * 100) / 100, height: Math.ceil(height * 100) / 100, lines, overflow, warning: overflow ? "This list needs fewer or shorter items to fit legibly." : undefined };
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

type SceneElement = CanvasScene["elements"][number];

/** Where a layer of `height` sits `gap` after the end of a text's last line, centred on that line. */
function afterLastLine(text: SceneElement, layout: SmartTextLayout | undefined, height: number, gap: number): { x: number; y: number } {
  if (text.type !== "text" || !layout?.lines.length) return { x: text.x + text.width + gap, y: text.y + (text.height - height) / 2 };
  const pad = text.padding ?? 0, line = layout.lines[layout.lines.length - 1], pitch = layout.fontSize * text.lineHeight;
  const room = text.width - 2 * pad, start = text.align === "center" ? (room - line.width) / 2 : text.align === "right" ? room - line.width : 0;
  const top = text.y + pad + (layout.lines.length - 1) * (pitch + (text.paragraphSpacing ?? 0));
  return { x: text.x + pad + start + line.width + gap, y: top + (pitch - height) / 2 };
}

/** Moves each centred flow (a layer with `smartCenter` and every layer that
 * follows it, directly or through others) as one block, so the block sits in
 * the middle of its space when it leaves room and starts at its top when not. */
function centreFlows(elements: SceneElement[]): SceneElement[] {
  const roots = elements.filter(element => element.smartCenter && !element.smartFlow && !element.hidden);
  if (!roots.length) return elements;
  const keys = new Map(elements.flatMap(element => [[element.id, element.id] as const, ...(element.slot ? [[element.slot, element.id] as const] : [])]));
  const shifts = new Map<string, number>();
  for (const root of roots) {
    const block = new Set([root.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const element of elements) {
        const anchor = element.smartFlow && keys.get(element.smartFlow.after);
        if (anchor && block.has(anchor) && !block.has(element.id)) { block.add(element.id); grew = true; }
      }
    }
    const shown = elements.filter(element => block.has(element.id) && !element.hidden);
    const top = Math.min(...shown.map(element => element.y)), bottom = Math.max(...shown.map(element => element.y + element.height));
    const space = root.smartCenter!, shift = space.top + Math.max(0, (space.bottom - space.top - (bottom - top)) / 2) - top;
    if (Math.abs(shift) > .005) for (const id of block) shifts.set(id, shift);
  }
  return shifts.size ? elements.map(element => shifts.has(element.id) ? { ...element, y: element.y + shifts.get(element.id)! } : element) : elements;
}

/** What the layers of one `group` share: the smallest size, then (once they all
 * have it) the smallest gap, and the tallest height. */
type GroupCap = { fontSize: number; paragraphSpacing?: number; height: number };

/** Lays out a page's copy. Layers in a `group` are fitted on their own first,
 * then again at the group's shared size and gap. Each pass moves a centred flow
 * (`smartCenter`) as one block (see `centreFlows`); copy that can't reach the
 * foot of its flow is then centred on it (see `balanceShortCopy`). Last, a layer
 * that `leadsGroup` carries its group as far as it moved (see `carryGroups`). */
export function layoutSmartScene(scene: CanvasScene, measure = measureSmartText): SmartSceneLayout {
  let caps = new Map<string, GroupCap>(), layout = layoutPass(scene, measure, caps);
  for (let pass = 0; pass < 3; pass++) {
    const next = groupCaps(layout);
    if (sameCaps(caps, next)) break;
    caps = next; layout = layoutPass(scene, measure, caps);
  }
  return carryGroups(scene, balanceShortCopy(layout));
}

/** A layer that `leadsGroup` and that the layout moved carries the rest of its
 * group (and its subgroups) the same distance, crops included. Layers with a
 * flow of their own, and layers the layout placed itself, stay where it put them. */
function carryGroups(before: CanvasScene, layout: SmartSceneLayout): SmartSceneLayout {
  const elements = layout.scene.elements;
  if (!elements.some(element => element.leadsGroup && element.groupId)) return layout;
  const was = new Map(before.elements.map(element => [element.id, element]));
  const moved = (element: CanvasScene["elements"][number]) => {
    const old = was.get(element.id);
    return old ? { x: element.x - old.x, y: element.y - old.y } : { x: 0, y: 0 };
  };
  const still = (move: { x: number; y: number }) => Math.abs(move.x) < 1e-6 && Math.abs(move.y) < 1e-6;
  const moves = new Map<string, { x: number; y: number }>();
  for (const leader of elements) {
    if (!leader.leadsGroup || !leader.groupId || moves.has(leader.groupId)) continue;
    const move = moved(leader);
    if (!still(move)) moves.set(leader.groupId, move);
  }
  if (!moves.size) return layout;
  const parents = new Map((layout.scene.groups ?? []).map(group => [group.id, group.parentId]));
  const carried = (groupId: string | undefined) => {
    for (let id = groupId, steps = 0; id && steps < 50; id = parents.get(id), steps++) {
      const move = moves.get(id);
      if (move) return move;
    }
  };
  return { ...layout, scene: { ...layout.scene, elements: elements.map(element => {
    const move = element.smartFlow || element.smartCenter || !still(moved(element)) ? undefined : carried(element.groupId);
    if (!move) return element;
    const clip = element.clipBounds;
    return { ...element, x: element.x + move.x, y: element.y + move.y, ...(clip ? { clipBounds: { ...clip, x: clip.x + move.x, y: clip.y + move.y } } : {}) };
  }) } };
}

function groupCaps({ scene, texts }: SmartSceneLayout): Map<string, GroupCap> {
  const members = new Map<string, { fontSize: number; paragraphSpacing?: number; height: number }[]>();
  for (const element of scene.elements) {
    // A size the person set neither sets nor takes the group's shared size.
    const group = element.type === "text" && !element.hidden && element.smartText?.fontSize === undefined ? element.smartText?.group : undefined, fitted = texts.get(element.id);
    if (group && fitted) members.set(group, [...(members.get(group) ?? []), { fontSize: fitted.fontSize, paragraphSpacing: fitted.paragraphSpacing, height: element.height }]);
  }
  const caps = new Map<string, GroupCap>();
  for (const [group, list] of members) {
    if (list.length < 2) continue;
    const fontSize = Math.min(...list.map(member => member.fontSize));
    // A gap measured at another size says nothing about this one, so the gap is shared only once every member has the shared size.
    const gaps = list.every(member => Math.abs(member.fontSize - fontSize) < .01) ? list.flatMap(member => member.paragraphSpacing ?? []) : [];
    caps.set(group, { fontSize, ...(gaps.length ? { paragraphSpacing: Math.min(...gaps) } : {}), height: Math.max(...list.map(member => member.height)) });
  }
  return caps;
}
function sameCaps(a: Map<string, GroupCap>, b: Map<string, GroupCap>) {
  const near = (x?: number, y?: number) => x === y || x !== undefined && y !== undefined && Math.abs(x - y) < .01;
  return a.size === b.size && [...b].every(([group, cap]) => { const other = a.get(group); return other && near(other.fontSize, cap.fontSize) && near(other.paragraphSpacing, cap.paragraphSpacing) && near(other.height, cap.height); });
}

/** The shape (width over height) of a picture whose size is known. */
function pictureRatio(element: CanvasScene["elements"][number]): number | undefined {
  return element.type === "image" && element.intrinsicWidth && element.intrinsicHeight ? element.intrinsicWidth / element.intrinsicHeight : undefined;
}

/** Where a `smartFlow.media` layer goes: its picture's shape, as large as fits
 * across the span and `height`, centred across the span. A picture of unknown
 * size fills the whole area. */
export function mediaBox(element: CanvasScene["elements"][number], span: { x: number; width: number }, height: number): { x: number; width: number; height: number } {
  const ratio = pictureRatio(element);
  if (!ratio) return { x: span.x, width: span.width, height };
  const width = Math.min(span.width, height * ratio);
  return { x: span.x + (span.width - width) / 2, width, height: width / ratio };
}

/** The layer a flow follows. A hidden layer takes no room: a layer flowing
 * under it flows under what that layer follows instead, as a picture moves up
 * under the title when the copy between them is hidden. Only plain downward
 * flows pass through; a layer riding on another's top, flowing up or inline
 * keeps its anchor. */
function flowAnchor(element: SceneElement, byKey: Map<string, SceneElement>): SceneElement | undefined {
  if (!element.smartFlow) return undefined;
  const plain = (layer: SceneElement) => Boolean(layer.smartFlow && !layer.smartFlow.direction && !layer.smartFlow.edge);
  let anchor = byKey.get(element.smartFlow.after);
  for (let step = 0; plain(element) && anchor?.hidden && plain(anchor) && step < 8; step++) {
    const next = byKey.get(anchor.smartFlow!.after);
    if (!next) break;
    anchor = next;
  }
  return anchor;
}

/** Copy that can't reach the foot of its flow gives the space back: when the
 * photo or chart frame under it is hidden (there is nothing to show), keeps a
 * picture's shape that is shorter than the room left, or a list is too short
 * to fill its column, the copy (with that picture) is centred between the top
 * of its flow (`anchorTop`) and that foot, so the page has no empty block at
 * the bottom. A frame something else still follows keeps its place. */
function balanceShortCopy(layout: SmartSceneLayout): SmartSceneLayout {
  type Layer = CanvasScene["elements"][number];
  const elements = layout.scene.elements;
  const byKey = new Map(elements.flatMap(element => [[element.id, element] as const, ...(element.slot ? [[element.slot, element] as const] : [])]));
  const anchorOf = (element: Layer) => element.smartFlow && element.smartFlow.direction !== "up" ? flowAnchor(element, byKey) : undefined;
  const following = (element: Layer) => Boolean(element.smartFlow && element.smartFlow.direction !== "up" && !element.smartFlow.edge);
  const shaped = (element: Layer) => Boolean(following(element) && element.smartFlow?.media && pictureRatio(element));
  // Stretched to the foot of its flow (a picture keeping its shape has its own height).
  const stretched = (element: Layer) => Boolean(following(element) && (element.smartFlow?.resize || element.smartFlow?.media) && !shaped(element));
  const isList = (element: Layer) => element.type === "text" && element.smartText?.role === "list";
  // A list's box runs to the foot of its flow; its items may stop short of it.
  const reach = (element: Layer) => element.y + (isList(element) ? layout.texts.get(element.id)?.height ?? element.height : element.height);
  const shifts = new Map<string, number>();
  for (const foot of elements) {
    const flow = foot.smartFlow;
    if (!flow || !(stretched(foot) || shaped(foot)) || !foot.hidden && !isList(foot) && !shaped(foot)) continue;
    if (elements.some(other => !other.hidden && anchorOf(other) === foot)) continue;
    let root = anchorOf(foot);
    for (let steps = 0; root && anchorOf(root) && steps < 50; steps++) root = anchorOf(root);
    if (!root || root.hidden || root.type !== "text" || root.smartText?.anchorTop === undefined) continue;
    const block = new Set([root.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const element of elements) if (!block.has(element.id) && !element.hidden && block.has(anchorOf(element)?.id ?? "")) { block.add(element.id); grew = true; }
    }
    const shift = (flow.bottom - Math.max(...elements.filter(element => block.has(element.id)).map(reach))) / 2;
    if (shift > .5) for (const id of block) shifts.set(id, shift);
  }
  if (!shifts.size) return layout;
  // A layer stretched to the foot of its flow keeps that foot.
  return { ...layout, scene: { ...layout.scene, elements: elements.map(element => {
    const shift = shifts.get(element.id);
    return shift ? { ...element, y: element.y + shift, ...(stretched(element) ? { height: Math.max(1, element.height - shift) } : {}) } : element;
  }) } };
}

function layoutPass(scene: CanvasScene, measure: typeof measureSmartText, caps: Map<string, GroupCap>): SmartSceneLayout {
  const texts = new Map<string, SmartTextLayout>(), resolved = new Map<string, SceneElement>(), visiting = new Set<string>();
  // A centred flow is laid out from the top of its space, then moved as a block (centreFlows).
  const start = scene.elements.map(element => element.smartCenter && !element.smartFlow && element.y !== element.smartCenter.top ? { ...element, y: element.smartCenter.top } : element);
  const slots = new Map(start.flatMap(element => [[element.id, element] as const, ...(element.slot ? [[element.slot, element] as const] : [])]));
  function resolve(original: SceneElement): SceneElement {
    if (resolved.has(original.id)) return resolved.get(original.id)!;
    if (visiting.has(original.id)) return original; // Malformed/cyclic imported flows stay bounded.
    visiting.add(original.id);
    let element = original;
    const flow = original.smartFlow, anchor = flow && flowAnchor(original, slots);
    const upward = flow?.direction === "up", inline = flow?.direction === "right";
    // Upward flows: the bottom edge sits `gap` above the anchor's resolved top.
    let edge: number | undefined;
    if (anchor && !anchor.hidden) {
      const other = resolve(anchor);
      if (inline) element = { ...element, ...afterLastLine(other, texts.get(other.id), element.height, flow!.gap) };
      else if (upward) {
        edge = other.y - flow!.gap;
        element = flow!.resize ? { ...element, height: Math.max(1, edge - element.y) } : { ...element, y: edge - element.height };
      } else {
        const y = other.y + (flow!.edge === "top" ? 0 : other.height) + flow!.gap;
        element = { ...element, y, ...(flow!.resize ? { height: Math.max(1, flow!.bottom - y) } : {}) };
        if (flow!.media && !flow!.edge && element.type === "image") element = { ...element, ...mediaBox(element, flow!.media, Math.max(1, flow!.bottom - y)) };
      }
    }
    if (element.type === "text" && element.smartText && !element.hidden) {
      const rule = element.smartText, bottomEdge = edge ?? rule.anchorBottom, cap = rule.group && rule.fontSize === undefined ? caps.get(rule.group) : undefined;
      let maximum = rule.maxHeight;
      if (flow && !upward && !inline) maximum = Math.min(maximum, Math.max(1, flow.bottom - element.y));
      if (flow && upward && edge !== undefined) maximum = Math.min(maximum, Math.max(1, edge - flow.bottom));
      const words = smartWords(element);
      let layout: SmartTextLayout;
      if (rule.role === "list") {
        const candidate = { ...element, smartText: { ...rule, maxHeight: maximum } };
        layout = fitSmartList(candidate, measure(candidate, words), words, cap ? { fontSize: cap.fontSize, ...(cap.paragraphSpacing !== undefined ? { paragraphSpacing: cap.paragraphSpacing } : {}) } : undefined);
      } else {
        // A group's shared size caps each member; the tallest member sets the height they all keep.
        const shared = cap ? { maxFontSize: Math.min(rule.maxFontSize, cap.fontSize), minFontSize: Math.min(rule.minFontSize, cap.fontSize), ...(rule.softMinFontSize !== undefined ? { softMinFontSize: Math.min(rule.softMinFontSize, cap.fontSize) } : {}) } : {};
        const candidate = { ...element, smartText: { ...rule, maxHeight: maximum, ...shared } };
        layout = fitSmartText(candidate, measure(candidate, words), words);
      }
      texts.set(element.id, layout);
      // A list keeps its whole box: the canvas wraps its items, and nothing follows it.
      const height = rule.role === "list" ? maximum : Math.min(maximum, Math.max(layout.height, cap?.height ?? 0));
      const top = bottomEdge !== undefined ? { y: bottomEdge - height } : rule.anchorTop !== undefined && !flow ? { y: rule.anchorTop } : {};
      element = { ...element, autoFitFontSize: layout.fontSize, height, textMode: "auto-fit", ...(layout.paragraphSpacing !== undefined ? { paragraphSpacing: layout.paragraphSpacing } : {}), ...top };
    }
    const hug = flow?.hug;
    let hugged = hug && slots.get(hug.after);
    // A hidden layer takes no room: the edge hugs what that layer follows instead, as a
    // post card ends under its text when the post has no photo.
    for (let step = 0; hugged?.hidden && hugged.smartFlow && step < 8; step++) hugged = slots.get(hugged.smartFlow.after);
    if (hug && hugged && !hugged.hidden) {
      // The copy inside may follow this layer's top, so it sees this position first.
      resolved.set(original.id, element);
      const inner = resolve(hugged);
      element = { ...element, height: Math.max(1, inner.y + inner.height + hug.gap - element.y) };
    }
    visiting.delete(original.id); resolved.set(original.id, element); return element;
  }
  const elements = centreFlows(start.map(resolve));
  const changed = elements.some((element, index) => { const before = scene.elements[index]; return element.x !== before.x || element.y !== before.y || element.width !== before.width || element.height !== before.height || element.type === "text" && before.type === "text" && (element.autoFitFontSize !== before.autoFitFontSize || element.paragraphSpacing !== before.paragraphSpacing); });
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
      return { ...element, smartText: undefined, smartFlow: undefined, smartCenter: undefined, fontSize: layout.fontSize, autoFitFontSize: undefined, textMode: "fixed" as const, text: layout.lines.map(line => line.text).join("\n"), richText: sanitizeRichText(layout.lines.map(line => line.text ? scaleRichTextFonts(line.html, layout.fontSize / element.fontSize) : "").join("<br>")) }; // A blank line is the join's own <br>; its "<br>" html would double it.
    }) };
  };
  return { ...design, pages: design.pages.map(page => page.canvas && pageIds.includes(page.id) ? { ...page, canvas: materialize(page.canvas) } : page), ...(design.masterScene ? { masterScene: materialize(design.masterScene) } : {}), ...(design.continuousCanvas ? { continuousCanvas: materialize(design.continuousCanvas) } : {}) };
}
