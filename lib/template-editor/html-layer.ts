/**
 * HTML layers: part of a slide, or a whole slide, drawn from HTML and CSS, for
 * what boxes of text, images and shapes draw badly: charts, tables, logo grids,
 * post cards, comparisons. Claude writes them like a small web page; the
 * editor, every export and the server renderer draw them as the same DOM.
 *
 * Markup is never trusted. `cleanHtmlLayer` keeps an allowlist of tags,
 * attributes and CSS (sanitize-html for the markup, postcss for the CSS):
 *   - no scripts, event handlers, iframes, embeds, forms, or links that navigate
 *     (links become plain text)
 *   - no @import, @font-face or any other at-rule, no animations or transitions
 *   - images only from data: URLs or Engine's own storage
 *     (/api/template-editor/assets/…); nothing is fetched from anywhere else
 *   - fonts only from the brand: the brand guide's fonts, through the layer's
 *     tokens (var(--title-font)), or Engine's own fonts when there's no guide
 * It runs when a layer is saved and again before it's drawn.
 *
 * `prepareHtmlLayer` turns markup into what the canvas mounts: the CSS scoped to
 * the layer's own root (`:root`, `html` and `body` mean that root) and every
 * class name and id prefixed, so neither the app's CSS nor another layer's can
 * reach inside, and the layer can't reach out.
 */
import sanitizeHtml from "sanitize-html";
import { parse as parseCss, type Declaration, type Rule } from "postcss";
import { isSafeBrandSvgUrl, isSafeHtmlToken, MAX_HTML_CHARS, MAX_HTML_CSS_CHARS, MAX_HTML_TOKENS, type HtmlElement } from "./model";
import type { BrandGuide } from "./brand-guide";

/** Engine's fonts as the editor's text draws them (engine.css .gf-font-*). */
export const HTML_FONT_STACKS: Readonly<Record<string, string>> = {
  serif: 'var(--font-serif), Georgia, "Times New Roman", serif',
  libre: 'var(--font-serif), Georgia, "Times New Roman", serif',
  sans: "var(--font-sans), system-ui, sans-serif",
  geist: "var(--font-sans), system-ui, sans-serif",
  walsheim: "var(--gf-f-walsheim), system-ui, sans-serif",
  walsheimcond: "var(--gf-f-walsheimcond), system-ui, sans-serif",
  kyoto: "var(--gf-f-kyoto), Georgia, serif",
  century: "var(--gf-f-century), system-ui, sans-serif",
  sfpro: "var(--gf-f-sfpro), system-ui, sans-serif",
  playfair: "var(--gf-f-playfair), Georgia, serif",
  dmserif: "var(--gf-f-dmserif), Georgia, serif",
  lora: "var(--gf-f-lora), Georgia, serif",
  cormorant: "var(--gf-f-cormorant), Georgia, serif",
  crimson: "var(--gf-f-crimson), Georgia, serif",
  inter: "var(--gf-f-inter), system-ui, sans-serif",
  space: "var(--gf-f-space), system-ui, sans-serif",
  montserrat: "var(--gf-f-montserrat), system-ui, sans-serif",
  bebas: "var(--gf-f-bebas), system-ui, sans-serif",
  bebascanva: "var(--gf-f-bebascanva), var(--gf-f-bebas), system-ui, sans-serif",
  plexmono: "var(--gf-f-plexmono), ui-monospace, monospace",
  caveat: "var(--gf-f-caveat), cursive",
};
const ALL_FONTS: ReadonlySet<string> = new Set(Object.keys(HTML_FONT_STACKS));
/** Family names people write for Engine's fonts, so `"SF Pro Display"` finds the brand's SF Pro. */
const FONT_ALIASES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.keys(HTML_FONT_STACKS).map(id => [id, id])),
  "sf pro display": "sfpro", "sf pro": "sfpro", "sf pro text": "sfpro", "gf sf pro display": "sfpro",
  "bebas neue": "bebas", "bebas neue bold": "bebascanva", "gf bebas neue canva": "bebascanva",
  "geist sans": "geist", "playfair display": "playfair", "dm serif display": "dmserif",
  "cormorant garamond": "cormorant", "crimson pro": "crimson", "crimson text": "crimson",
  "space grotesk": "space", "ibm plex mono": "plexmono", "gt walsheim": "walsheim",
  "gt walsheim condensed": "walsheimcond", "pp kyoto": "kyoto", "century gothic": "century",
};
const FONT_VARIABLE_USE: Readonly<Record<string, string[]>> = {
  "--font-sans": ["sans", "geist"],
  "--font-serif": ["serif", "libre"],
  ...Object.fromEntries(Object.keys(HTML_FONT_STACKS).map(id => [`--gf-f-${id}`, [id]])),
};
/** A brand text style's font token, such as --title-font. Layers can read these but not define them. */
const ROLE_FONT_TOKEN = /^--[a-z][a-z0-9-]*-font$/;
const FONT_DEFINITION = /^--(?:[a-z0-9-]+-font|font-[a-z0-9-]*|gf-f-[a-z0-9-]*)$/i;
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji"]);
const WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

type CleanContext = { fonts: ReadonlySet<string>; prefix?: string };
type Attributes = Record<string, string>;

/** Engine's own storage, and data: images. Nothing outside Engine is ever fetched. */
const STORED_IMAGE = /^\/api\/template-editor\/assets\/[a-f0-9]{64}(?:\?maxDimension=\d{1,5})?$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
export function isHtmlLayerImageSource(value: string): boolean {
  const url = value.trim();
  if (STORED_IMAGE.test(url)) return true;
  if (url.length <= MAX_HTML_CHARS && DATA_IMAGE.test(url)) return url.slice(url.indexOf(",") + 1).length % 4 === 0;
  return isSafeBrandSvgUrl(url);
}

const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]{0,99}$/;
const isIdent = (value: string) => IDENT.test(value);

// ---------------------------------------------------------------------------
// CSS values

const BLOCKED_FUNCTIONS = new Set(["image", "image-set", "-webkit-image-set", "element", "-moz-element", "cross-fade", "-webkit-cross-fade", "src", "expression", "attr", "paint", "-webkit-canvas", "-moz-image-rect"]);

/** End of a CSS string that starts at `start`, or -1. Escapes inside strings are fine. */
function stringEnd(value: string, start: number): number {
  const quote = value[start];
  for (let index = start + 1; index < value.length; index++) {
    if (value[index] === "\\") index++;
    else if (value[index] === quote) return index;
    else if (value[index] === "\n") return -1;
  }
  return -1;
}

/** The url() targets in a CSS value, or null when the value can load or run
 * anything we don't allow: escapes outside strings (which could spell url),
 * comments, image-set() and friends, or a url() we can't read. */
function cssValueUrls(value: string): string[] | null {
  const urls: string[] = [];
  let ident = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"' || character === "'") {
      const end = stringEnd(value, index);
      if (end < 0) return null;
      index = end; ident = "";
      continue;
    }
    if (character === "\\" || character === "<" || character === ";" || character === "{" || character === "}" || (character === "/" && value[index + 1] === "*")) return null;
    if (character === "(") {
      const name = ident.toLowerCase(); ident = "";
      if (name === "url") {
        let cursor = index + 1;
        while (/\s/.test(value[cursor] ?? "")) cursor++;
        let url: string, close: number;
        if (value[cursor] === '"' || value[cursor] === "'") {
          const end = stringEnd(value, cursor);
          if (end < 0) return null;
          url = value.slice(cursor + 1, end);
          close = end + 1;
          while (/\s/.test(value[close] ?? "")) close++;
          if (value[close] !== ")" || url.includes("\\")) return null;
        } else {
          close = value.indexOf(")", cursor);
          if (close < 0) return null;
          url = value.slice(cursor, close).trim();
          if (/["'(\s\\]/.test(url)) return null;
        }
        urls.push(url.trim());
        index = close;
        continue;
      }
      if (BLOCKED_FUNCTIONS.has(name) || name.endsWith("image-set")) return null;
      continue;
    }
    ident = /[A-Za-z0-9_-]/.test(character) ? ident + character : "";
  }
  return urls;
}

const LOCAL_URL = /url\(\s*(["']?)#([_a-zA-Z][\w-]*)\1\s*\)/g;
const localUrlsPrefixed = (value: string, prefix?: string) => prefix ? value.replace(LOCAL_URL, (_, quote: string, id: string) => `url(${quote}#${prefix}-${id}${quote})`) : value;

/** Splits at top-level commas (not inside strings or parentheses). */
function splitTopLevel(value: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"' || character === "'") { const end = stringEnd(value, index); if (end < 0) return []; index = end; continue; }
    if (character === "(") depth++;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (separator === "," ? character === "," : /\s/.test(character))) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

function fontVariable(item: string): string | null {
  return item.match(/^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/)?.[1] ?? null;
}
function fontVariableAllowed(name: string, fonts: ReadonlySet<string>): boolean {
  if (ROLE_FONT_TOKEN.test(name)) return true;
  return (FONT_VARIABLE_USE[name] ?? []).some(id => fonts.has(id));
}

/** A font-family list with only the brand's fonts, Engine's fonts named by
 * their family name or id, and generic families. A list with no brand font
 * gets the layer's body font first, so it never shows a system font, and a
 * list with nothing left is the body font. */
function cleanFontFamily(value: string, context: CleanContext): string {
  const items = splitTopLevel(value, ",");
  if (items.length === 1 && WIDE_KEYWORDS.has(items[0].toLowerCase())) return items[0].toLowerCase();
  const kept: string[] = [];
  let branded = false;
  for (const item of items) {
    const variable = fontVariable(item);
    if (variable) {
      if (fontVariableAllowed(variable, context.fonts)) { kept.push(`var(${variable})`); branded = true; }
      continue;
    }
    const quoted = /^(["']).*\1$/.test(item);
    const name = (quoted ? item.slice(1, -1) : item).trim().replace(/\s+/g, " ").toLowerCase();
    if (!quoted && GENERIC_FAMILIES.has(name)) { kept.push(name); continue; }
    const id = FONT_ALIASES[name];
    if (id && context.fonts.has(id)) { kept.push(HTML_FONT_STACKS[id].split(",")[0]); branded = true; }
  }
  return (branded ? kept : ["var(--body-font)", ...kept]).join(", ");
}

const FONT_KEYWORD = /^(?:normal|italic|oblique|small-caps|bold|bolder|lighter|[1-9]00|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded)$/i;
/** The `font` shorthand with its family list cleaned like font-family. */
function cleanFontShorthand(value: string, context: CleanContext): string | null {
  const [first, ...rest] = splitTopLevel(value, ",");
  if (!first) return null;
  const words = splitTopLevel(first, " ");
  let split = words.length;
  // The family is the run of names at the end; sizes, weights and var()s that aren't fonts come before it.
  while (split > 0) {
    const word = words[split - 1];
    const variable = fontVariable(word);
    const isFamily = variable ? FONT_DEFINITION.test(variable) || variable.startsWith("--gf-f-") : /^["']/.test(word) || (/^[a-zA-Z-][\w-]*$/.test(word) && !FONT_KEYWORD.test(word) && !/^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i.test(word));
    if (!isFamily) break;
    split--;
  }
  if (split === 0 || split === words.length) return null;
  return `${words.slice(0, split).join(" ")} ${cleanFontFamily([words.slice(split).join(" "), ...rest].join(", "), context)}`;
}

const BLOCKED_PROPERTIES = new Set([
  "behavior", "-moz-binding", "pointer-events", "user-select", "-webkit-user-select", "-webkit-user-modify", "-webkit-user-drag",
  "touch-action", "cursor", "will-change", "view-transition-name", "view-transition-class", "anchor-name", "anchor-scope",
  "position-anchor", "position-area", "inset-area", "position-try", "position-try-fallbacks", "position-try-options",
  "position-try-order", "position-visibility", "src", "unicode-range", "font-display", "interactivity", "interest-target-delay",
]);

/** One declaration, cleaned, or null when it has to go. */
function cleanDeclaration(property: string, value: string, context: CleanContext): { property: string; value: string } | null {
  const custom = property.startsWith("--");
  if (custom ? !/^--[A-Za-z0-9_-]{1,80}$/.test(property) : !/^-?[a-zA-Z][a-zA-Z-]{0,60}$/.test(property)) return null;
  const name = custom ? property : property.toLowerCase();
  if (BLOCKED_PROPERTIES.has(name) || /^(?:-[a-z]+-)?(?:animation|transition|offset-path)/.test(name)) return null;
  if (custom && FONT_DEFINITION.test(name)) return null;
  let next = value.trim();
  if (next.length > 20_000) return null;
  const urls = cssValueUrls(next);
  if (!urls || urls.some(url => !/^#[_a-zA-Z][\w-]*$/.test(url) && !isHtmlLayerImageSource(url))) return null;
  if (name === "font-family") next = cleanFontFamily(next, context);
  else if (name === "font") {
    const font = cleanFontShorthand(next, context);
    if (!font) return null;
    next = font;
  } else if (name === "position" && /fixed/i.test(next)) next = "absolute";
  else if (/^overflow/.test(name) && /auto|scroll/i.test(next)) next = "hidden";
  return { property: name, value: localUrlsPrefixed(next, context.prefix) };
}

/** An inline style attribute, cleaned. */
function cleanStyleAttribute(style: string, context: CleanContext): string {
  let parsed;
  try { parsed = parseCss(`a{${style}}`); } catch { return ""; }
  const rule = parsed.nodes.find(node => node.type === "rule") as Rule | undefined;
  const declarations: string[] = [];
  rule?.each(node => {
    if (node.type !== "decl") return;
    const clean = cleanDeclaration(node.prop, node.value, context);
    if (clean) declarations.push(`${clean.property}: ${clean.value}${node.important ? " !important" : ""}`);
  });
  return declarations.join("; ");
}

// ---------------------------------------------------------------------------
// Selectors

/** `.name` and `#name` take the layer's prefix, outside strings and [attribute] tests. */
function prefixSelectorNames(selector: string, prefix: string): string {
  let result = "";
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === '"' || character === "'") {
      const end = stringEnd(selector, index);
      result += selector.slice(index, end + 1);
      index = end;
    } else if (character === "[") {
      let end = index + 1;
      while (end < selector.length && selector[end] !== "]") {
        if (selector[end] === '"' || selector[end] === "'") end = stringEnd(selector, end);
        end++;
      }
      result += selector.slice(index, end + 1);
      index = end;
    } else if ((character === "." || character === "#") && /[_a-zA-Z-]/.test(selector[index + 1] ?? "")) {
      result += `${character}${prefix}-`;
    } else result += character;
  }
  return result;
}

const ROOT_NAME = /^(?::root|html|body)(?![\w-])/i;
/** A selector inside the layer: its root (`:root`, `html`, `body`) or something under it. */
function scopeSelector(selector: string, prefix?: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > 2_000 || /[\\<{};@&]/.test(trimmed) || /^[+~]/.test(trimmed) || /:host|::?slotted|::part|:scope/i.test(trimmed)) return null;
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] !== '"' && trimmed[index] !== "'") continue;
    const end = stringEnd(trimmed, index);
    if (end < 0) return null;
    index = end;
  }
  if (!prefix) return trimmed;
  let rest = prefixSelectorNames(trimmed, prefix), root = false;
  while (ROOT_NAME.test(rest)) {
    root = true;
    rest = rest.replace(ROOT_NAME, "");
    const between = rest.match(/^\s*>?\s*(?=(?::root|html|body)(?![\w-]))/i);
    if (!between) break;
    rest = rest.slice(between[0].length);
  }
  return root ? `.${prefix}${rest}` : `.${prefix} ${rest}`;
}

/** A stylesheet, cleaned; with a prefix, scoped to the layer's root too. */
function cleanStylesheet(css: string, context: CleanContext): string {
  if (!css.trim()) return "";
  let root;
  try { root = parseCss(css.slice(0, MAX_HTML_CSS_CHARS)); } catch { return ""; }
  root.walkComments(comment => { comment.remove(); });
  root.walkAtRules(rule => { rule.remove(); });
  root.each(node => { if (node.type !== "rule") node.remove(); });
  root.each(node => {
    if (node.type !== "rule") return;
    const selectors = [...new Set(node.selectors.map(selector => scopeSelector(selector, context.prefix)).filter((selector): selector is string => !!selector))];
    if (!selectors.length) { node.remove(); return; }
    node.selectors = selectors;
    node.each(child => {
      if (child.type !== "decl") { child.remove(); return; }
      const declaration = child as Declaration;
      const clean = cleanDeclaration(declaration.prop, declaration.value, context);
      if (!clean) { declaration.remove(); return; }
      declaration.prop = clean.property;
      declaration.value = clean.value;
    });
    if (!node.nodes?.length) node.remove();
  });
  // A `<` can't close the <style> the CSS is drawn in: it only appears inside strings, escaped.
  return root.toString().replace(/</g, "\\3c ").trim();
}

// ---------------------------------------------------------------------------
// Markup

const HTML_TAGS = ["div", "span", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "ins", "small", "sub", "sup", "mark", "code", "pre", "kbd", "samp", "var", "blockquote", "q", "cite", "abbr", "time", "data", "wbr", "bdi", "bdo", "ruby", "rt", "rp", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "figure", "figcaption", "section", "article", "header", "footer", "main", "aside", "nav", "address", "img"];
// The parser keeps SVG's camelCase tag names (and lowercases attributes, which the browser restores).
const SVG_TAGS = ["svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker", "image", "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComponentTransfer", "feFuncA", "feFuncR", "feFuncG", "feFuncB", "feFlood", "feComposite", "feMerge", "feMergeNode", "feDropShadow", "feMorphology", "feTurbulence", "feDisplacementMap", "feTile"];
const ALLOWED_TAGS = [...new Set([...HTML_TAGS, ...SVG_TAGS, ...SVG_TAGS.map(tag => tag.toLowerCase())])];
const GLOBAL_ATTRIBUTES = ["class", "id", "style", "title", "lang", "dir", "role", "aria-hidden", "aria-label", "aria-labelledby", "aria-describedby", "width", "height", "align", "valign"];
const SVG_ATTRIBUTES = [
  "viewbox", "preserveaspectratio", "xmlns", "xmlns:xlink", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "d", "points", "pathlength",
  "transform", "transform-origin", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "stroke-dashoffset", "stroke-miterlimit", "opacity", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "spreadmethod", "clip-path", "clip-rule",
  "clippathunits", "mask", "maskunits", "maskcontentunits", "patternunits", "patterncontentunits", "patterntransform", "filter", "filterunits", "primitiveunits",
  "stddeviation", "dx", "dy", "in", "in2", "result", "mode", "values", "type", "operator", "k1", "k2", "k3", "k4", "flood-color", "flood-opacity", "radius",
  "basefrequency", "numoctaves", "seed", "stitchtiles", "scale", "xchannelselector", "ychannelselector", "tablevalues", "slope", "intercept", "amplitude", "exponent",
  "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "word-spacing",
  "text-decoration", "textlength", "lengthadjust", "startoffset", "rotate", "marker-start", "marker-mid", "marker-end", "markerwidth", "markerheight", "markerunits",
  "refx", "refy", "orient", "vector-effect", "paint-order", "shape-rendering", "text-rendering", "image-rendering", "color", "display", "visibility", "overflow",
  "mix-blend-mode", "isolation",
];
const TAG_ATTRIBUTES: Readonly<Record<string, string[]>> = {
  img: ["src", "alt"], td: ["colspan", "rowspan", "headers", "scope"], th: ["colspan", "rowspan", "headers", "scope", "abbr"],
  col: ["span"], colgroup: ["span"], ol: ["start", "reversed", "type"], li: ["value"], time: ["datetime"], data: ["value"],
  use: ["href", "xlink:href"], textPath: ["href", "xlink:href"], textpath: ["href", "xlink:href"], image: ["href", "xlink:href"],
};
/** Dropped along with what's inside them. Other tags that aren't allowed (form,
 * button, label, html, body…) go, but their allowed content stays. */
const DROPPED_WITH_CONTENT = ["script", "style", "textarea", "option", "select", "xmp", "noscript", "noembed", "noframes", "iframe", "frame", "frameset", "object", "embed", "applet", "template", "title", "head", "canvas", "video", "audio", "math", "desc", "metadata", "foreignObject", "foreignobject", "animate", "animateMotion", "animateTransform", "set"];
const ID_LIST_ATTRIBUTES = new Set(["aria-labelledby", "aria-describedby", "headers"]);
const TEXT_ATTRIBUTES = new Set(["alt", "title", "aria-label", "abbr"]);

const localReference = (value: string) => value.trim().match(/^#([_a-zA-Z][\w-]{0,99})$/)?.[1] ?? null;

function transformTag(context: CleanContext, inSvg: () => boolean) {
  const prefixed = (name: string) => context.prefix ? `${context.prefix}-${name}` : name;
  return (tagName: string, attribs: Attributes) => {
    // Links keep their text and look, and stop navigating. In SVG they become groups.
    const tag = tagName.toLowerCase() === "a" ? inSvg() ? "g" : "span" : tagName;
    const kind = tag.toLowerCase();
    const next: Attributes = {};
    for (const [name, raw] of Object.entries(attribs)) {
      const value = String(raw ?? "");
      if (name.startsWith("on") || value.length > 200_000) continue;
      if (name === "style") {
        const style = cleanStyleAttribute(value, context);
        if (style) next.style = style;
      } else if (name === "src") {
        if (kind === "img" && isHtmlLayerImageSource(value)) next.src = value.trim();
      } else if (name === "href" || name === "xlink:href") {
        const reference = localReference(value);
        if ((kind === "use" || kind === "textpath") && reference) next[name] = `#${prefixed(reference)}`;
        else if (kind === "image" && isHtmlLayerImageSource(value)) next[name] = value.trim();
      } else if (name === "class") {
        const classes = value.split(/\s+/).filter(isIdent);
        if (classes.length) next.class = classes.map(prefixed).join(" ");
      } else if (name === "id") {
        if (isIdent(value.trim())) next.id = prefixed(value.trim());
      } else if (ID_LIST_ATTRIBUTES.has(name)) {
        const ids = value.split(/\s+/).filter(isIdent);
        if (ids.length) next[name] = ids.map(prefixed).join(" ");
      } else if (name === "font-family") {
        next[name] = cleanFontFamily(value, context);
      } else if (TEXT_ATTRIBUTES.has(name)) {
        next[name] = value;
      } else if (!/[\\<>]/.test(value)) {
        // SVG presentation attributes are CSS values: only url(#local) references.
        if (/url\s*\(/i.test(value)) {
          const urls = cssValueUrls(value);
          if (!urls || urls.some(url => !/^#[_a-zA-Z][\w-]*$/.test(url))) continue;
          next[name] = localUrlsPrefixed(value, context.prefix);
        } else next[name] = value;
      }
    }
    return { tagName: tag, attribs: next };
  };
}

function sanitizeMarkup(html: string, context: CleanContext): string {
  let svgDepth = 0;
  return sanitizeHtml(html.slice(0, MAX_HTML_CHARS), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { "*": [...GLOBAL_ATTRIBUTES, ...SVG_ATTRIBUTES], ...TAG_ATTRIBUTES },
    allowedSchemes: [],
    allowedSchemesByTag: { img: ["data"], image: ["data"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "xlink:href"],
    allowProtocolRelative: false,
    allowVulnerableTags: false,
    disallowedTagsMode: "discard",
    nonTextTags: DROPPED_WITH_CONTENT,
    nestingLimit: 120,
    parseStyleAttributes: false,
    // SVG writes <path/>; read it the way the browser does.
    parser: { recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
    onOpenTag: name => { if (name.toLowerCase() === "svg") svgDepth++; },
    onCloseTag: name => { if (name.toLowerCase() === "svg") svgDepth = Math.max(0, svgDepth - 1); },
    transformTags: { "*": transformTag(context, () => svgDepth > 0) },
    // An image whose source was removed would draw as a broken image and stop exports.
    exclusiveFilter: frame => (frame.tag.toLowerCase() === "img" && !frame.attribs.src) || (frame.tag.toLowerCase() === "image" && !frame.attribs.href && !frame.attribs["xlink:href"]),
  }).trim();
}

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi;
/** A layer written as a page keeps its <style> blocks as the layer's CSS. */
function splitStyles(html: string): { html: string; styles: string[] } {
  const styles: string[] = [];
  const rest = html.replace(STYLE_BLOCK, (_, css: string) => { styles.push(css); return ""; });
  return { html: rest, styles };
}

// ---------------------------------------------------------------------------
// Tokens

/** The brand tokens a layer keeps: safe values, and font tokens that name one of Engine's fonts. */
export function cleanHtmlTokens(tokens: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  const stacks = new Set(Object.values(HTML_FONT_STACKS));
  for (const [name, value] of Object.entries(tokens ?? {})) {
    if (Object.keys(result).length >= MAX_HTML_TOKENS || !isSafeHtmlToken(name, value)) continue;
    if (FONT_DEFINITION.test(name) && !stacks.has(value)) continue;
    result[name] = value;
  }
  return result;
}

/** The fonts a layer may use: the fonts in its brand tokens, or all of Engine's without a brand. */
export function htmlLayerFonts(tokens: Record<string, string> | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [name, value] of Object.entries(tokens ?? {})) {
    if (!ROLE_FONT_TOKEN.test(name)) continue;
    for (const [id, stack] of Object.entries(HTML_FONT_STACKS)) if (stack === value) ids.add(id);
  }
  return ids.size ? ids : ALL_FONTS;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/**
 * A brand guide as CSS variables for HTML layers:
 *   --color-background, --color-text, --color-accent, --color-accent-end,
 *   --color-surface, --color-secondary, --color-source, --color-<color id>
 *   --gradient-accent
 *   for each text role (title, body, cover, cover-remark, source, follow, list):
 *     --<role>-font, -size, -weight, -leading, -tracking, -case, -color, -fill
 *   --page-width, --page-height, --margin-left/right/top/bottom,
 *   --gap-title-body, --gap-header-content, --min-text-size
 * Sizes are pixels on the guide's canvas, the same pixels a layer is designed in.
 */
export function htmlTokensForGuide(guide: BrandGuide): Record<string, string> {
  const tokens: Record<string, string> = {};
  const set = (name: string, value: string | number | undefined) => {
    if (value === undefined || name in tokens || Object.keys(tokens).length >= MAX_HTML_TOKENS) return;
    const text = String(value);
    if (isSafeHtmlToken(name, text)) tokens[name] = text;
  };
  const role = (name: string) => guide.colors.find(color => color.role === name)?.value;
  const text = role("text") ?? "#FFFFFF", accent = role("accent") ?? "#00D98A", background = role("background") ?? "#000000";
  const colors: Record<string, string> = {
    background, text, accent,
    "accent-end": role("accent-end") ?? guide.accentGradient?.to ?? accent,
    surface: role("surface") ?? background,
    secondary: role("secondary") ?? text,
    source: role("source") ?? role("secondary") ?? text,
  };
  for (const [name, value] of Object.entries(colors)) set(`--color-${name}`, value);
  for (const color of guide.colors) if (slug(color.id)) set(`--color-${slug(color.id)}`, color.value);
  const gradient = guide.accentGradient ? `linear-gradient(${guide.accentGradient.angle}deg, ${guide.accentGradient.from}, ${guide.accentGradient.to})` : undefined;
  set("--gradient-accent", gradient ?? `linear-gradient(180deg, ${accent}, ${colors["accent-end"]})`);
  for (const style of guide.text) {
    const name = style.role === "other" ? (slug(style.id) && /^[a-z]/.test(slug(style.id)) ? slug(style.id) : "") : style.role;
    if (!name) continue;
    const ink = colors[style.color] ?? guide.colors.find(color => color.role === style.color)?.value ?? text;
    set(`--${name}-font`, HTML_FONT_STACKS[style.font]);
    set(`--${name}-size`, px(style.size));
    set(`--${name}-weight`, style.weight);
    set(`--${name}-leading`, style.lineHeight);
    set(`--${name}-tracking`, `${style.tracking}em`);
    set(`--${name}-case`, style.case === "upper" ? "uppercase" : "none");
    set(`--${name}-color`, ink);
    set(`--${name}-fill`, style.fill === "accent-gradient" && gradient ? gradient : ink);
  }
  const fallback = guide.text.find(style => style.role === "body") ?? guide.text.find(style => style.role === "list") ?? guide.text[0];
  if (fallback) set("--body-font", HTML_FONT_STACKS[fallback.font]);
  const layout = guide.layout;
  set("--page-width", px(layout.width));
  set("--page-height", px(layout.height));
  set("--margin-left", px(layout.marginLeft));
  set("--margin-right", px(layout.marginRight));
  set("--margin-top", px(layout.marginTop));
  set("--margin-bottom", px(layout.marginBottom));
  set("--gap-title-body", px(layout.titleBodyGap));
  set("--gap-header-content", px(layout.headerContentGap));
  set("--min-text-size", px(layout.minTextSize));
  return tokens;
}

// ---------------------------------------------------------------------------
// Cleaning and drawing

const CLEANED = new Map<string, { html: string; css: string }>();
const remember = <T>(cache: Map<string, T>, key: string, value: T, size: number) => {
  cache.set(key, value);
  if (cache.size > size) cache.delete(cache.keys().next().value as string);
  return value;
};

/**
 * Markup and CSS as they're saved: only what the allowlist keeps. A page's
 * <style> blocks move into the CSS. The same input always gives the same
 * output, and cleaning clean markup changes nothing.
 */
export function cleanHtmlLayer(input: { html: string; css?: string; tokens?: Record<string, string> }): { html: string; css: string } {
  const fonts = htmlLayerFonts(cleanHtmlTokens(input.tokens));
  const key = `${input.html}\u0000${input.css ?? ""}\u0000${[...fonts].join(" ")}`;
  const cached = CLEANED.get(key);
  if (cached) return cached;
  const context: CleanContext = { fonts };
  const split = splitStyles(input.html);
  return remember(CLEANED, key, {
    html: sanitizeMarkup(split.html, context),
    css: cleanStylesheet([input.css ?? "", ...split.styles].filter(part => part.trim()).join("\n"), context),
  }, 48);
}

/** An HTML layer with its markup, CSS and tokens cleaned; the same object when nothing changed. */
export function cleanHtmlElement(element: HtmlElement): HtmlElement {
  const clean = cleanHtmlLayer(element);
  const tokens = element.tokens ? cleanHtmlTokens(element.tokens) : undefined;
  const sameTokens = !element.tokens || JSON.stringify(tokens) === JSON.stringify(element.tokens);
  if (clean.html === element.html && clean.css === (element.css ?? "") && sameTokens) return element;
  const next: HtmlElement = { ...element, html: clean.html };
  if (clean.css) next.css = clean.css; else delete next.css;
  if (tokens && Object.keys(tokens).length) next.tokens = tokens; else delete next.tokens;
  return next;
}

const isHtmlElement = (value: Record<string, unknown>): value is HtmlElement =>
  value.type === "html" && typeof value.html === "string" && typeof value.designWidth === "number" && typeof value.id === "string";

/** Cleans every HTML layer anywhere in a library, document or scene (pages,
 * versions, components, master scenes). Unchanged parts keep their identity. */
export function cleanHtmlLayersIn<T>(value: T): T {
  const visit = (node: unknown, depth: number): unknown => {
    if (!node || typeof node !== "object" || depth > 24) return node;
    if (Array.isArray(node)) {
      let changed = false;
      const items = node.map(item => { const next = visit(item, depth + 1); if (next !== item) changed = true; return next; });
      return changed ? items : node;
    }
    const record = node as Record<string, unknown>;
    if (isHtmlElement(record)) return cleanHtmlElement(record);
    let changed = false;
    const entries = Object.entries(record).map(([key, child]) => {
      if (typeof child !== "object" || child === null) return [key, child] as const;
      const next = visit(child, depth + 1);
      if (next !== child) changed = true;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : node;
  };
  return visit(value, 0) as T;
}

/** What the canvas mounts for a layer, with a placeholder where its scope goes. */
export type PreparedHtmlLayer = { key: string; html: string; css: string };
const SCOPE = "te-html-scope-placeholder";
const PREPARED = new Map<string, PreparedHtmlLayer>();

function hash(value: string): string {
  let first = 0x811c9dc5, second = 0x01000193;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
  }
  return (first >>> 0).toString(36) + (second >>> 0).toString(36);
}

/** The layer root's defaults, then its brand tokens: a layer's own `:root` rules come after and win. */
function rootRule(tokens: Record<string, string>): string {
  const variables = Object.entries(tokens).map(([name, value]) => `${name}: ${value};`).join(" ");
  return `.${SCOPE} { ${variables} position: relative; width: 100%; height: 100%; overflow: hidden; font-family: var(--body-font, var(--font-sans), system-ui, sans-serif); font-size: 16px; font-weight: 400; font-style: normal; line-height: 1.25; letter-spacing: normal; word-spacing: normal; text-align: left; text-transform: none; text-decoration: none; text-shadow: none; white-space: normal; direction: ltr; color: var(--color-text, #111111); -webkit-font-smoothing: antialiased; }`;
}

/** Cleans a layer for drawing and scopes it. Cached, since every thumbnail draws it too. */
export function prepareHtmlLayer(element: Pick<HtmlElement, "html" | "css" | "tokens">): PreparedHtmlLayer {
  const tokens = cleanHtmlTokens(element.tokens);
  const cacheKey = `${element.html}\u0000${element.css ?? ""}\u0000${JSON.stringify(tokens)}`;
  const cached = PREPARED.get(cacheKey);
  if (cached) return cached;
  const context: CleanContext = { fonts: htmlLayerFonts(tokens), prefix: SCOPE };
  const split = splitStyles(element.html);
  const css = cleanStylesheet([element.css ?? "", ...split.styles].filter(part => part.trim()).join("\n"), context);
  return remember(PREPARED, cacheKey, { key: hash(cacheKey), html: sanitizeMarkup(split.html, context), css: `${rootRule(tokens)}\n${css}` }, 48);
}

/** Puts a layer's scope (a class name unique to one drawing of it) in place of the placeholder. */
export const scopeHtmlLayer = (text: string, scope: string) => text.split(SCOPE).join(scope);

/** The words in a layer, for alt text and for agents reading a deck. */
export { htmlLayerText } from "./model";
