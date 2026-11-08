/**
 * Templates drafted from a brand guide, and the guide's finishing touches on
 * decks made from them.
 *
 * `designTemplateFromGuide` restyles a base carousel (the built-in
 * @chatgptricks template) with the guide's colors, type, margins and spacing:
 * content titles in the accent gradient, text inside the guide's margins, the
 * guide's gaps, a cover remark slot, spots for topic logos on the cover, and
 * photos that keep their own shape. Pages that show real posts from X
 * (Reaction pages) are copied unchanged. The result is a custom template a
 * person reviews and then picks for a page; nothing switches by itself.
 *
 * Works by slot name, so it follows the base template as it changes.
 */
import { accentTexture, guideTextStyle, guideTokens, topicLogosFor, type BrandGuide, type GuideTextStyle } from "./brand-guide";
import { FORMATS, type CanvasElement, type DesignDocument, type DesignPage, type DesignTemplate, type ImageElement, type TextElement } from "./model";

export type GuideLanguage = "en" | "es";
export const guideTemplateId = (guideId: string, language: GuideLanguage) => `${guideId}-guide-${language}`;
export const isGuideTemplate = (templateId: string, guideId: string) => templateId === guideTemplateId(guideId, "en") || templateId === guideTemplateId(guideId, "es");
export const brandTag = (guideId: string) => `brand:${guideId}`;
export const guideVersionTag = (guide: Pick<BrandGuide, "id" | "version">) => `brand-guide:${guide.id}@${guide.version}`;
/** The brand a template names in its tags, if any. */
export const templateBrand = (template: Pick<DesignTemplate, "tags">) => template.tags?.find(tag => tag.startsWith("brand:"))?.slice(6);

const isReactionPage = (page: DesignPage) => (page.canvas?.elements ?? []).some(element => element.slot?.startsWith("reaction-"));
const HEX = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

/** Fixed words a template carries, per language. */
const WORDS: Record<GuideLanguage, { swipe: string; follow: string }> = {
  en: { swipe: "SWIPE FOR MORE", follow: "FOLLOW THIS PAGE" },
  es: { swipe: "DESLIZA PARA VER MÁS", follow: "SIGUE ESTA PÁGINA" },
};
/** Sample copy for a Spanish draft, by element id suffix. Slots without one keep the base text. */
const SPANISH: Record<string, { text: string; accent?: string }> = {
  "cover-headline": { text: "DESDE QUE SALIÓ CHATGPT, LA BOLSA CASI SE DUPLICÓ Y LAS OFERTAS DE EMPLEO EN EE. UU. CAYERON CASI UN 30%", accent: "CAYERON CASI UN 30%" },
  "media-title": { text: "La IA frente al empleo" },
  "media-body": { text: "Desde que salió ChatGPT, la bolsa subió\ny las ofertas de empleo bajaron" },
  "media-source": { text: "Fuente: JOLTS de la Oficina de Estadísticas Laborales de EE. UU. y promedio mensual del S&P 500, de ene. 2003 a sep. 2026. Ambos en 100 en nov. 2022, cuando salió ChatGPT" },
  "list-title": { text: "Los empleos que la IA no puede reemplazar" },
  "list-body": { text: "Anthropic estudió la IA en el trabajo. Los empleos de oficina corren más riesgo" },
  "list-left-heading": { text: "En riesgo por la IA", accent: "En riesgo" },
  "list-left-items": { text: ["Dirección", "Negocios y finanzas", "Informática y matemáticas", "Arquitectura e ingeniería", "Ciencias de la vida y sociales", "Derecho", "Educación y bibliotecas", "Arte y medios", "Oficina y administración", "Ventas", "Servicios sociales"].join("\n") },
  "list-right-heading": { text: "A salvo de la IA", accent: "A salvo" },
  "list-right-items": { text: ["Instalación y reparación", "Construcción", "Agricultura", "Transporte", "Producción", "Seguridad", "Comida y servicio", "Jardinería y mantenimiento", "Cuidado personal", "Apoyo sanitario", "Profesionales de la salud"].join("\n") },
  "list-source": { text: "Fuente: Anthropic, [nombre del estudio y fecha]" },
  "follow-cta": { text: "PARA NO QUEDARTE ATRÁS" },
};
/** Bebas capitals with accents (Á, É, Ñ) need taller lines than the guide's English setting. */
const SPANISH_DISPLAY_LINE_HEIGHT = 0.92;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type GuideTemplateOptions = { language: GuideLanguage; id?: string; name?: string };

export function designTemplateFromGuide(guide: BrandGuide, base: DesignTemplate, options: GuideTemplateOptions): DesignTemplate {
  const tokens = guideTokens(guide), { layout } = guide, language = options.language;
  const width = base.customSize?.width ?? FORMATS[base.format].width;
  // Guide pixels → the 360-wide scene every template is stored on.
  const px = (value: number) => value * 360 / layout.width;
  const left = px(layout.marginLeft), textWidth = px(layout.width - layout.marginLeft - layout.marginRight);
  const height = px((base.customSize?.height ?? FORMATS[base.format].height) * layout.width / width);
  const colors = colorMap(base, tokens);
  const recolor = (value: string) => {
    const match = HEX.exec(value);
    if (!match) return value;
    const mapped = colors.get(`#${match[1].toUpperCase()}`);
    return mapped ? `${mapped}${match[2] ?? ""}` : value;
  };
  const recolorRich = (html: string) => html.replace(/(color\s*:\s*)(#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?)/g, (_, prefix: string, color: string) => `${prefix}${recolor(color)}`);
  const texture = accentTexture(guide);

  /** Restyles a text layer to a guide style and rescales its fitting boxes to the new line height. */
  const restyle = (element: TextElement, style: GuideTextStyle | undefined, lineHeight = style?.lineHeight): TextElement => {
    if (!style) return element;
    const size = px(style.size), lh = lineHeight ?? element.lineHeight;
    const ratio = (size * lh) / (element.fontSize * element.lineHeight), fontRatio = size / element.fontSize;
    const next: TextElement = {
      ...element, font: style.font, fontSize: size, fontWeight: style.weight, lineHeight: lh, letterSpacing: size * style.tracking,
      color: style.fill === "accent-gradient" ? tokens.accent : roleColor(tokens, style.color),
      height: element.height * ratio,
    };
    if (element.smartText) {
      const rule = element.smartText;
      next.smartText = {
        ...rule,
        minFontSize: rule.minFontSize * fontRatio, maxFontSize: rule.maxFontSize * fontRatio,
        maxHeight: rule.maxHeight * ratio, ...(rule.baseHeight !== undefined ? { baseHeight: rule.baseHeight * ratio } : {}),
        ...(rule.softMinFontSize !== undefined ? { softMinFontSize: rule.softMinFontSize * fontRatio } : {}),
      };
      if (rule.anchorBottom !== undefined) next.y = rule.anchorBottom - next.height;
    }
    if (element.autoFitMinFontSize !== undefined) next.autoFitMinFontSize = element.autoFitMinFontSize * fontRatio;
    if (element.autoFitMaxFontSize !== undefined) next.autoFitMaxFontSize = element.autoFitMaxFontSize * fontRatio;
    if (style.fill === "accent-gradient" && tokens.gradient) {
      next.gradient = { type: "linear", angle: tokens.gradient.angle, stops: [{ color: tokens.gradient.from, position: 0 }, { color: tokens.gradient.to, position: 100 }] };
    } else delete next.gradient;
    return next;
  };
  const inMargins = <T extends CanvasElement>(element: T): T => ({ ...element, x: left, width: textWidth });
  const sample = (element: TextElement): TextElement => {
    const key = Object.keys(SPANISH).find(suffix => element.id.endsWith(suffix));
    if (language !== "es" || !key) return element;
    const { text, accent } = SPANISH[key];
    const next: TextElement = { ...element, text };
    delete next.richText; delete next.wordTextures;
    if (accent && text.includes(accent)) {
      const [before, after] = [text.slice(0, text.indexOf(accent)), text.slice(text.indexOf(accent) + accent.length)];
      const weight = /heading/.test(key) ? "; font-weight:700" : "";
      next.richText = `${escapeHtml(before)}<span style="color:${tokens.accent}${weight}">${escapeHtml(accent)}</span>${escapeHtml(after)}`.replace(/\n/g, "<br>");
    }
    return next;
  };
  const columns = (element: CanvasElement): CanvasElement => {
    const gap = px(40), column = (textWidth - gap) / 2;
    const right = /(^|-)right(-|$)/.test(element.slot ?? element.id);
    return { ...element, x: right ? left + column + gap : left, width: column };
  };

  const pages = base.pages.map((page): DesignPage => {
    if (!page.canvas || isReactionPage(page)) return structuredClone(page);
    const style = { ...page.style, ...(page.style.bgColor ? { bgColor: recolor(page.style.bgColor) } : {}), ...(page.style.textColor ? { textColor: recolor(page.style.textColor) } : {}) };
    const elements: CanvasElement[] = [];
    for (const original of structuredClone(page.canvas.elements)) {
      let element: CanvasElement = recolorElement(original, recolor, recolorRich);
      const slot = element.slot ?? "";
      if (element.type === "text") {
        if (slot === "title") element = inMargins(restyle(element, guideTextStyle(guide, "title")));
        else if (slot === "body") {
          element = inMargins(restyle(element, guideTextStyle(guide, "body")));
          if (element.smartFlow?.after === "title") element.smartFlow = { ...element.smartFlow, gap: px(layout.titleBodyGap) };
        } else if (slot === "source") {
          element = inMargins(restyle(element, guideTextStyle(guide, "source")));
          if (element.type === "text" && element.smartText?.anchorBottom !== undefined) {
            const bottom = height - px(layout.marginBottom);
            element.smartText = { ...element.smartText, anchorBottom: bottom };
            element.y = bottom - element.height;
          }
        } else if (/^list-(left|right)-(heading|items)$/.test(slot)) {
          element = columns(slot.endsWith("items") ? { ...element, color: tokens.text } : element);
        } else if (slot === "cover-headline") {
          element = inMargins(restyle(element, guideTextStyle(guide, "cover"), language === "es" ? SPANISH_DISPLAY_LINE_HEIGHT : undefined));
        } else if (slot === "cta") {
          element = restyle(element, guideTextStyle(guide, "follow"), language === "es" ? SPANISH_DISPLAY_LINE_HEIGHT : undefined);
          if (element.type === "text") element = { ...inMargins(element), color: tokens.accent };
        } else if (!slot && element.templateRole === "brand" && element.text === "FOLLOW THIS PAGE") {
          element = inMargins(restyle({ ...element, text: WORDS[language].follow }, guideTextStyle(guide, "follow"), language === "es" ? SPANISH_DISPLAY_LINE_HEIGHT : undefined));
        } else if (!slot && element.templateRole === "brand" && element.text === "SWIPE FOR MORE") {
          element = coverRemark(element, guideTextStyle(guide, "cover-remark"), WORDS[language].swipe, px, left, textWidth, tokens);
        }
        if (element.type === "text") element = sample(element);
        // The cover's highlighted words (in the sample copy too) carry the accent gradient inside the letters.
        if (element.type === "text" && slot === "cover-headline" && texture && element.richText) {
          element.richText = element.richText.replace(/<span style="color:\s*#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?\s*;?">/g, `<span data-texture-id="${texture.id}">`);
          if (element.richText.includes(`data-texture-id="${texture.id}"`)) element.wordTextures = [texture];
        }
      } else if (element.type === "image" && slot && element.templateRole === "media" && page.canvas.elements.some(other => other.slot === "title")) {
        // Text + Media: a photo, chart or video keeps its own shape, centered under the text with the page around it.
        element = { ...inMargins(element), fit: "contain", cropX: 50, cropY: 0 };
        if (element.smartFlow?.after === "body") element.smartFlow = { ...element.smartFlow, gap: px(layout.headerContentGap) };
      }
      elements.push(element);
      // Topic logos sit over the cover photo, under the fades' text.
      if (element.type === "shape" && /bottom-fade$/.test(element.id) && page.canvas.elements.some(other => other.slot === "cover-headline")) {
        elements.push(...topicLogoSpots(element.id.replace(/bottom-fade$/, ""), px, tokens.surface));
      }
    }
    const margins = page.canvas.layout?.margins;
    const layoutNext = page.canvas.layout ? { ...page.canvas.layout, ...(margins ? { margins: { ...margins, left, right: px(layout.marginRight), top: px(layout.marginTop), bottom: px(layout.marginBottom) } } : {}) } : undefined;
    const placed = language === "es" ? withAccentRoom(elements) : elements;
    return { ...structuredClone(page), style, canvas: { ...page.canvas, background: recolor(page.canvas.background), elements: placed, ...(layoutNext ? { layout: layoutNext } : {}) } };
  });

  const name = options.name ?? `${guide.name}${language === "es" ? " en español" : ""} (from the brand guide)`;
  return {
    ...structuredClone(base),
    id: options.id ?? guideTemplateId(guide.id, language),
    name: name.slice(0, 120),
    description: `Drafted from the ${guide.name} brand guide, version ${guide.version}${language === "es" ? ", with room for Spanish accents" : ""}. Based on ${base.name}.`.slice(0, 500),
    category: base.category,
    pages,
    ...(base.colorRoles ? { colorRoles: base.colorRoles.map(role => ({ ...role, color: recolor(role.color) })) } : {}),
    tags: [...new Set([...(base.tags ?? []).filter(tag => !tag.startsWith("brand:") && !tag.startsWith("brand-guide:") && !tag.startsWith("language:")), brandTag(guide.id), guideVersionTag(guide), `language:${language}`])].slice(0, 40),
    custom: true,
  };
}

/**
 * Spanish capitals carry accents above the cap height (Á, É, Ñ), and a fixed
 * text box clips whatever rises above its first line. Each text layer gets
 * padding as accent room: the box grows on every side while the words stay
 * exactly where they were, and the flows between layers keep their visible
 * gaps. Bebas display lines need the most room.
 */
function withAccentRoom(elements: CanvasElement[]): CanvasElement[] {
  const anchorOf = (list: CanvasElement[], key: string) => list.find(element => element.id === key) ?? list.find(element => element.slot === key);
  const kept = unmodeledLayers(elements, anchorOf), added = new Map<string, number>();
  for (const element of elements) {
    const pad = element.type === "text" && !kept.has(element.id) ? Math.round(element.fontSize * (/^bebas/.test(element.font) ? 0.2 : 0.12) * 100) / 100 : 0;
    if (pad > 0) added.set(element.id, pad);
  }
  // Visible gap = gap plus the padding on both sides of it (top-edge flows measure from the anchor's top instead).
  const gapFor = (element: CanvasElement, list: CanvasElement[]) => {
    const flow = element.smartFlow!, anchor = anchorOf(list, flow.after), a = anchor ? added.get(anchor.id) ?? 0 : 0, own = added.get(element.id) ?? 0;
    return flow.direction === "up" || flow.edge !== "top" ? flow.gap - a - own : flow.gap + a - own;
  };
  // A single fixed line stacked flush on a padded layer (the Follow page's two lines) can't give up gap.
  // It stays unpadded and sits on the bottom of its box with a line box shorter by twice the layer's
  // padding, so its words drop by exactly that padding and its box keeps free room above for accents.
  const dropped = new Map<string, number>();
  for (const element of elements) {
    const flow = element.smartFlow, anchor = flow && anchorOf(elements, flow.after), drop = anchor ? added.get(anchor.id) ?? 0 : 0;
    if (!flow || kept.has(element.id) || flow.direction !== "up" || !drop || element.type !== "text" || element.smartText || element.text.includes("\n") || gapFor(element, elements) >= 0) continue;
    // Templates allow line heights down to 0.5.
    if (element.lineHeight - 2 * drop / element.fontSize < 0.5) continue;
    added.delete(element.id);
    dropped.set(element.id, drop);
  }
  // Other lines stacked flush (a flow with no gap to give) keep their boxes as they are.
  for (let changed = true; changed;) {
    changed = false;
    for (const element of elements) {
      if (!element.smartFlow || dropped.has(element.id) || gapFor(element, elements) >= 0) continue;
      const anchor = anchorOf(elements, element.smartFlow.after);
      changed = added.delete(element.id) || changed;
      if (anchor) changed = added.delete(anchor.id) || changed;
    }
  }
  const padded = elements.map(element => {
    const pad = added.get(element.id), drop = dropped.get(element.id);
    if (element.type === "text" && drop) {
      const anchor = element.smartFlow && anchorOf(elements, element.smartFlow.after);
      // Its anchor lost its padding after all: nothing to make up for.
      if (!anchor || !added.get(anchor.id)) return element;
      return { ...element, verticalAlign: "bottom" as const, lineHeight: element.lineHeight - 2 * drop / element.fontSize };
    }
    if (element.type !== "text" || !pad) return element;
    const next: TextElement = { ...element, padding: (element.padding ?? 0) + pad, x: element.x - pad, y: element.y - pad, width: element.width + 2 * pad, height: element.height + 2 * pad };
    if (element.smartText) {
      const rule = element.smartText;
      next.smartText = {
        ...rule, maxHeight: rule.maxHeight + 2 * pad, ...(rule.baseHeight !== undefined ? { baseHeight: rule.baseHeight + 2 * pad } : {}),
        ...(rule.anchorBottom !== undefined ? { anchorBottom: rule.anchorBottom + pad } : {}),
      };
    }
    return next;
  });
  return padded.map(element => {
    const flow = element.smartFlow, anchor = flow && anchorOf(padded, flow.after);
    if (!flow || dropped.has(element.id) || !added.get(element.id) && !(anchor && added.get(anchor.id))) return element;
    const own = added.get(element.id) ?? 0, up = flow.direction === "up";
    return { ...element, smartFlow: { ...flow, gap: gapFor(element, padded), bottom: up ? flow.bottom - own : flow.bottom + own } };
  });
}

/**
 * Layers in layouts the accent room doesn't model keep their boxes, so their
 * words can't move: a layer set after another's last line and that line's
 * layer, a layer whose height hugs another and every layer that one follows,
 * and a centred block. Today these sit only on Reaction pages, which are copied
 * unchanged anyway.
 */
function unmodeledLayers(elements: CanvasElement[], anchorOf: (list: CanvasElement[], key: string) => CanvasElement | undefined): Set<string> {
  const kept = new Set<string>();
  for (const element of elements) {
    const flow = element.smartFlow;
    if (flow?.direction === "right") [element, anchorOf(elements, flow.after)].forEach(layer => layer && kept.add(layer.id));
    // A hidden layer hands its hug on to what it follows, so the whole chain stays as it is.
    if (flow?.hug) {
      kept.add(element.id);
      for (let inner = anchorOf(elements, flow.hug.after), step = 0; inner && !kept.has(inner.id) && step < 8; step++) {
        kept.add(inner.id);
        inner = inner.smartFlow && anchorOf(elements, inner.smartFlow.after);
      }
    }
    if (element.smartCenter && !flow) {
      const block = new Set([element.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const other of elements) {
          const anchor = other.smartFlow && anchorOf(elements, other.smartFlow.after);
          if (anchor && block.has(anchor.id) && !block.has(other.id)) { block.add(other.id); grew = true; }
        }
      }
      block.forEach(id => kept.add(id));
    }
  }
  return kept;
}

function roleColor(tokens: ReturnType<typeof guideTokens>, role: GuideTextStyle["color"]): string {
  switch (role) {
    case "background": return tokens.background;
    case "accent": return tokens.accent;
    case "accent-end": return tokens.accentEnd;
    case "surface": return tokens.surface;
    case "secondary": return tokens.secondary;
    case "source": return tokens.source;
    default: return tokens.text;
  }
}

/** Base color → guide color, from the base's named color roles (Background, Text, Accent green, …). */
function colorMap(base: DesignTemplate, tokens: ReturnType<typeof guideTokens>): Map<string, string> {
  const map = new Map<string, string>();
  for (const role of base.colorRoles ?? []) {
    const name = `${role.id} ${role.name}`.toLowerCase();
    const target = /background/.test(name) ? tokens.background : /accent|green/.test(name) ? tokens.accent : /surface|placeholder/.test(name) ? tokens.surface
      : /source/.test(name) ? tokens.source : /grey|gray|secondary/.test(name) ? tokens.secondary : /text|white/.test(name) ? tokens.text : null;
    const match = HEX.exec(role.color);
    if (target && match) map.set(`#${match[1].toUpperCase()}`, target.toUpperCase());
  }
  return map;
}

function recolorElement(element: CanvasElement, recolor: (value: string) => string, recolorRich: (html: string) => string): CanvasElement {
  const next = { ...element } as CanvasElement;
  if (next.gradient) next.gradient = { ...next.gradient, stops: next.gradient.stops.map(stop => ({ ...stop, color: recolor(stop.color) })) };
  if (next.type === "text") {
    next.color = recolor(next.color);
    if (next.richText) next.richText = recolorRich(next.richText);
  } else if (next.type === "shape") {
    next.fill = recolor(next.fill);
    next.stroke = recolor(next.stroke);
  }
  return next;
}

function coverRemark(element: TextElement, style: GuideTextStyle | undefined, text: string, px: (value: number) => number, left: number, textWidth: number, tokens: ReturnType<typeof guideTokens>): TextElement {
  const size = px(style?.size ?? 32), lineHeight = style?.lineHeight ?? 1, boxHeight = size * lineHeight;
  const next: TextElement = {
    ...element, name: "Cover remark", slot: "cover-remark", text, x: left, width: textWidth, y: element.y + element.height - boxHeight, height: boxHeight,
    font: style?.font ?? element.font, fontSize: size, fontWeight: style?.weight ?? element.fontWeight, lineHeight, letterSpacing: size * (style?.tracking ?? 0),
    color: style ? roleColor(tokens, style.color) : element.color, align: "center", verticalAlign: "top", layoutRole: "text", textMode: "auto-fit",
    autoFitMinFontSize: px(24), autoFitMaxFontSize: size, protected: ["position", "style", "delete"],
    smartText: { role: "body", lines: 0, minFontSize: px(24), maxFontSize: size, maxHeight: boxHeight + .01, baseHeight: boxHeight + .01, softMinFontSize: size },
  };
  delete next.templateRole;
  delete next.richText;
  return next;
}

/** Two square spots over the cover photo, front one lower left: a logo keeps its own proportions inside. Hidden until a deck fills them. */
function topicLogoSpots(prefix: string, px: (value: number) => number, surface: string): ImageElement[] {
  const size = 220;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="M${size / 2} 0a${size / 2} ${size / 2} 0 1 0 0.01 0Z" fill="${surface}"/></svg>`;
  const spot = (suffix: string, name: string, slot: string, [x, y]: [number, number]): ImageElement => ({
    type: "image", id: `${prefix}topic-logo${suffix}`, name, x: px(x), y: px(y), width: px(size), height: px(size), rotation: 0, opacity: 1, locked: false, hidden: true,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, fit: "contain", cropX: 50, cropY: 50, radius: 0, intrinsicWidth: size, intrinsicHeight: size,
    directive: "The logo of a product or company the cover names, from the brand guide", slot, templateRole: "media", layoutRole: "media", protected: ["position", "delete"],
    shadow: { color: "#00000066", offsetX: 0, offsetY: px(8), blur: px(30), spread: 0 },
  });
  // The second logo sits behind and above the first, as on the approved cover.
  return [spot("-2", "Second topic logo", "topic-logo-2", [791, 394]), spot("", "Topic logo", "topic-logo", [669, 574])];
}

/**
 * A deck from a template drafted from this guide gets the guide's finishing
 * touches: the cover's highlighted words in the accent gradient, SWIPE FOR
 * MORE when the cover has no remark, and the logos of what the cover names
 * (when the guide has them). Decks from other templates are left alone.
 * Changes `document` in place and returns what it did.
 */
export function applyGuideToDeck(document: DesignDocument, guide: BrandGuide, options: { swipeText: string }): string[] {
  if (!isGuideTemplate(document.templateId, guide.id)) return [];
  const notes: string[] = [], texture = accentTexture(guide), accent = guideTokens(guide).accent;
  for (const page of document.pages) {
    if (isReactionPage(page)) continue;
    const elements = page.canvas?.elements ?? [];
    const headline = elements.find((element): element is TextElement => element.type === "text" && element.slot === "cover-headline");
    if (!headline) continue;
    if (headline.richText && /<span style="color:/.test(headline.richText)) {
      if (texture) {
        headline.richText = headline.richText.replace(/<span style="color:\s*#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?\s*;?">/g, `<span data-texture-id="${texture.id}">`);
        headline.wordTextures = [texture];
      } else headline.richText = headline.richText.replace(/(<span style="color:\s*)#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?/g, `$1${accent}`);
    }
    const remark = elements.find((element): element is TextElement => element.type === "text" && element.slot === "cover-remark");
    if (remark && !remark.text.trim()) { remark.text = options.swipeText; delete remark.richText; }
    const logos = topicLogosFor(headline.text, guide, 2);
    for (const [index, slot] of ["topic-logo", "topic-logo-2"].entries()) {
      const spot = elements.find((element): element is ImageElement => element.type === "image" && element.slot === slot);
      const logo = logos[index];
      if (!spot || !logo) continue;
      // "Claude" → "Claude logo", but a logo already named "Tricks logo" stays as it is.
      const label = /\blogo$/i.test(logo.name.trim()) ? logo.name.trim() : `${logo.name.trim()} logo`;
      Object.assign(spot, { src: logo.src, previewSrc: logo.previewSrc, intrinsicWidth: logo.width, intrinsicHeight: logo.height, publicAlt: label, hidden: false, fit: "contain" });
      if (!logo.previewSrc) delete spot.previewSrc;
      notes.push(`Added the ${label} to the cover.`);
    }
  }
  return notes;
}
