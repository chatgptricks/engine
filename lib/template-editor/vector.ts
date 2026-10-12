import clipping from "polygon-clipping";
import type { MultiPolygon, Pair } from "polygon-clipping";
import { createCanvasElement, isSafeVectorPath, parseCanvasScene, type CanvasScene, type ShapeElement, type CanvasGradient } from "./model";
import { canEditElement, removeSelection, type SceneCommandResult } from "./commands";

export type VectorOperation = "union" | "intersect" | "subtract" | "xor";
type Point = Pair;
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const numeric = (value: string | undefined, fallback = 0) => { const result = value === undefined ? fallback : Number.parseFloat(value); if (!Number.isFinite(result) || Math.abs(result) > 100_000) throw new Error("SVG coordinates must be finite and bounded."); return result; };
const round = (value: number) => Math.round(value * 10000) / 10000;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const equal = (a: Point, b: Point) => distance(a, b) < 1e-8;
const matrixPoint = (matrix: Matrix, point: Point): Point => [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4], matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function parseSVGTransform(source = ""): Matrix {
  let result = IDENTITY;
  const tokens = Array.from(source.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g));
  if (source.replace(/([a-zA-Z]+)\s*\(([^)]*)\)/g, "").trim()) throw new Error("Unsupported SVG transform.");
  for (const token of tokens) {
    const values = token[2].trim().split(/[\s,]+/).filter(Boolean).map(value => numeric(value));
    const [first = 0, second = 0, third = 0] = values; let matrix: Matrix;
    if (token[1] === "matrix" && values.length === 6) matrix = values as Matrix;
    else if (token[1] === "translate" && values.length >= 1 && values.length <= 2) matrix = [1, 0, 0, 1, first, second];
    else if (token[1] === "scale" && values.length >= 1 && values.length <= 2) matrix = [first, 0, 0, values.length === 1 ? first : second, 0, 0];
    else if (token[1] === "rotate" && (values.length === 1 || values.length === 3)) {
      const angle = first * Math.PI / 180, rotation: Matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      matrix = values.length === 3 ? multiply(multiply([1, 0, 0, 1, second, third], rotation), [1, 0, 0, 1, -second, -third]) : rotation;
    } else if ((token[1] === "skewX" || token[1] === "skewY") && values.length === 1) matrix = token[1] === "skewX" ? [1, 0, Math.tan(first * Math.PI / 180), 1, 0, 0] : [1, Math.tan(first * Math.PI / 180), 0, 1, 0, 0];
    else throw new Error("Unsupported SVG transform.");
    result = multiply(result, matrix);
  }
  if (!result.every(Number.isFinite)) throw new Error("This SVG transform cannot be represented.");
  return result;
}

/** Pure SVG path sampler: straight paths remain exact, curves/arcs become bounded polygons for clipping. */
export function flattenVectorPath(path: string, tolerance = .25): Point[][] {
  if (!isSafeVectorPath(path)) throw new Error("Invalid SVG path data.");
  const tokens = path.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  let index = 0, command = "", current: Point = [0, 0], start: Point = [0, 0], control: Point = [0, 0], previous = "";
  const rings: Point[][] = []; let ring: Point[] = [];
  const finish = () => { if (ring.length > 1) rings.push(ring); ring = []; };
  const push = (point: Point) => { if (!ring.length || !equal(ring.at(-1)!, point)) ring.push(point); current = point; if (rings.reduce((sum, item) => sum + item.length, ring.length) > 30_000) throw new Error("This SVG path is too complex to edit."); };
  const read = () => { const value = tokens[index++]; if (value === undefined || /^[a-z]$/i.test(value)) throw new Error("Incomplete SVG path command."); return Number(value); };
  const point = (relative: boolean): Point => { const x = read(), y = read(); return [x + (relative ? current[0] : 0), y + (relative ? current[1] : 0)]; };
  const sample = (end: Point, evaluate: (t: number) => Point, length: number) => { const steps = Math.max(8, Math.min(512, Math.ceil(Math.sqrt(Math.max(length, 1) / Math.max(.01, tolerance)) * 2))); for (let step = 1; step <= steps; step++) push(evaluate(step / steps)); current = end; };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    if (!command) throw new Error("SVG path must begin with a command.");
    const kind = command.toUpperCase(), relative = command !== kind, origin: Point = [...current];
    if (kind === "Z") { push(start); finish(); current = start; previous = kind; command = ""; continue; }
    if (kind === "M") { finish(); start = point(relative); push(start); command = relative ? "l" : "L"; }
    else if (kind === "L") push(point(relative));
    else if (kind === "H") push([read() + (relative ? current[0] : 0), current[1]]);
    else if (kind === "V") push([current[0], read() + (relative ? current[1] : 0)]);
    else if (kind === "C" || kind === "S") {
      const first: Point = kind === "C" ? point(relative) : [previous === "C" || previous === "S" ? 2 * origin[0] - control[0] : origin[0], previous === "C" || previous === "S" ? 2 * origin[1] - control[1] : origin[1]];
      const second = point(relative), end = point(relative);
      sample(end, t => { const u = 1 - t; return [u ** 3 * origin[0] + 3 * u ** 2 * t * first[0] + 3 * u * t ** 2 * second[0] + t ** 3 * end[0], u ** 3 * origin[1] + 3 * u ** 2 * t * first[1] + 3 * u * t ** 2 * second[1] + t ** 3 * end[1]]; }, distance(origin, first) + distance(first, second) + distance(second, end)); control = second;
    } else if (kind === "Q" || kind === "T") {
      const first: Point = kind === "Q" ? point(relative) : [previous === "Q" || previous === "T" ? 2 * origin[0] - control[0] : origin[0], previous === "Q" || previous === "T" ? 2 * origin[1] - control[1] : origin[1]], end = point(relative);
      sample(end, t => { const u = 1 - t; return [u ** 2 * origin[0] + 2 * u * t * first[0] + t ** 2 * end[0], u ** 2 * origin[1] + 2 * u * t * first[1] + t ** 2 * end[1]]; }, distance(origin, first) + distance(first, end)); control = first;
    } else if (kind === "A") {
      let rx = Math.abs(read()), ry = Math.abs(read()); const phi = read() * Math.PI / 180, large = read(), sweep = read(), end = point(relative);
      if (![0, 1].includes(large) || ![0, 1].includes(sweep)) throw new Error("Invalid SVG arc flags.");
      if (!rx || !ry || equal(origin, end)) push(end);
      else {
        const cos = Math.cos(phi), sin = Math.sin(phi), dx = (origin[0] - end[0]) / 2, dy = (origin[1] - end[1]) / 2, xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
        const radiusScale = Math.sqrt(xp ** 2 / rx ** 2 + yp ** 2 / ry ** 2);
        if (radiusScale > 1) { rx *= radiusScale; ry *= radiusScale; }
        const coefficient = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx ** 2 * ry ** 2 - rx ** 2 * yp ** 2 - ry ** 2 * xp ** 2) / (rx ** 2 * yp ** 2 + ry ** 2 * xp ** 2)));
        const cxp = coefficient * rx * yp / ry, cyp = -coefficient * ry * xp / rx, cx = cos * cxp - sin * cyp + (origin[0] + end[0]) / 2, cy = sin * cxp + cos * cyp + (origin[1] + end[1]) / 2;
        const startAngle = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx), endAngle = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx);
        let span = endAngle - startAngle; if (!sweep && span > 0) span -= 2 * Math.PI; if (sweep && span < 0) span += 2 * Math.PI;
        sample(end, t => { const angle = startAngle + span * t; return [cx + cos * rx * Math.cos(angle) - sin * ry * Math.sin(angle), cy + sin * rx * Math.cos(angle) + cos * ry * Math.sin(angle)]; }, Math.abs(span) * Math.max(rx, ry));
      }
    } else throw new Error("Unsupported SVG path command.");
    previous = kind;
  }
  finish(); return rings;
}

function pointsPath(rings: Point[][], close = true): string {
  return rings.map(ring => ring.length ? `M${round(ring[0][0])} ${round(ring[0][1])}${ring.slice(1).map(point => `L${round(point[0])} ${round(point[1])}`).join("")}${close ? "Z" : ""}` : "").join("");
}
function bounds(rings: Point[][]) {
  const points = rings.flat(); if (!points.length) throw new Error("This shape has no vector outline.");
  const x = Math.min(...points.map(point => point[0])), y = Math.min(...points.map(point => point[1]));
  return { x, y, width: Math.max(...points.map(point => point[0])) - x, height: Math.max(...points.map(point => point[1])) - y };
}
function contains(ring: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) && point[0] < (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
  }
  return inside;
}
function signedArea(ring: Point[]): number { return ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2; }
function ringsToPolygons(rings: Point[][], fillRule: "nonzero" | "evenodd" = "nonzero"): MultiPolygon {
  const sorted = rings.filter(ring => ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-9).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const polygons: MultiPolygon = [];
  for (const ring of sorted) {
    const containers = polygons.filter(polygon => contains(polygon[0], ring[0]));
    const container = containers.at(-1);
    if (container && (fillRule === "evenodd" ? !container.slice(1).some(hole => contains(hole, ring[0])) : Math.sign(signedArea(container[0])) !== Math.sign(signedArea(ring)))) container.push(ring);
    else polygons.push([ring]);
  }
  return polygons;
}
export function shapeToPolygons(shape: ShapeElement): MultiPolygon {
  let path: string;
  if (shape.shape === "path") path = shape.path ?? "";
  else if (shape.shape === "ellipse") path = "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z";
  else if (shape.shape === "triangle") path = "M50 0L100 100H0Z";
  else if (shape.shape === "diamond") path = "M50 0L100 50L50 100L0 50Z";
  else if (shape.shape === "arrow") path = "M0 35H60V0L100 50L60 100V65H0Z";
  else if (shape.shape === "polygon" || shape.shape === "star") {
    const count = shape.shape === "star" ? (shape.starPoints ?? 5) * 2 : shape.sides ?? 6;
    path = pointsPath([Array.from({ length: count }, (_, index): Point => { const angle = index * 2 * Math.PI / count - Math.PI / 2, radius = shape.shape === "star" && index % 2 ? 50 * (shape.innerRadius ?? .45) : 50; return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)]; })]);
  } else {
    const radius = Math.max(0, Math.min(shape.width / 2, shape.height / 2, shape.radius)), rx = radius * 100 / shape.width, ry = radius * 100 / shape.height;
    path = radius ? `M${rx} 0H${100-rx}A${rx} ${ry} 0 0 1 100 ${ry}V${100-ry}A${rx} ${ry} 0 0 1 ${100-rx} 100H${rx}A${rx} ${ry} 0 0 1 0 ${100-ry}V${ry}A${rx} ${ry} 0 0 1 ${rx} 0Z` : "M0 0H100V100H0Z";
  }
  const [vx, vy, vw, vh] = shape.shape === "path" && shape.viewBox ? shape.viewBox.trim().split(/[\s,]+/).map(Number) : [0, 0, 100, 100];
  const angle = shape.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2;
  const rings = flattenVectorPath(path).map(ring => ring.map((point): Point => { const x = (point[0] - vx) / vw * shape.width - shape.width / 2, y = (point[1] - vy) / vh * shape.height - shape.height / 2; return [cx + cos * x - sin * y, cy + sin * x + cos * y]; }));
  const polygons = ringsToPolygons(rings, shape.fillRule), clip = shape.clipBounds;
  return clip ? clipping.intersection(polygons, [[[clip.x, clip.y], [clip.x + clip.width, clip.y], [clip.x + clip.width, clip.y + clip.height], [clip.x, clip.y + clip.height], [clip.x, clip.y]]]) : polygons;
}
export function booleanPolygons(polygons: MultiPolygon[], operation: VectorOperation): MultiPolygon {
  if (!polygons.length) return [];
  const [first, ...rest] = polygons;
  return operation === "union" ? clipping.union(first, ...rest) : operation === "intersect" ? clipping.intersection(first, ...rest) : operation === "subtract" ? clipping.difference(first, ...rest) : clipping.xor(first, ...rest);
}
export function combineShapes(scene: CanvasScene, ids: readonly string[], operation: VectorOperation): SceneCommandResult {
  const selected = new Set(ids), shapes = scene.elements.filter((element): element is ShapeElement => selected.has(element.id) && element.type === "shape");
  if (shapes.length < 2 || shapes.some(shape => !canEditElement(scene, shape, "position") || !canEditElement(scene, shape, "delete"))) return { scene, selectedIds: [...ids], limited: false };
  const polygons = booleanPolygons(shapes.map(shapeToPolygons), operation);
  const removed = removeSelection(scene, shapes.map(shape => shape.id));
  if (!polygons.length) return { ...removed, selectedIds: [] };
  const rings = polygons.flat(), box = bounds(rings), path = pointsPath(rings.map(ring => ring.map((point): Point => [point[0] - box.x, point[1] - box.y])));
  if (path.length > 20_000 || Math.abs(box.x) > 10_000 || Math.abs(box.y) > 10_000 || box.width > 10_000 || box.height > 10_000) throw new Error("The combined shape exceeds editable vector limits.");
  const top = shapes.at(-1)!, combined = createCanvasElement("shape", { name: `${operation[0].toUpperCase()}${operation.slice(1)} shape`, x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height), shape: "path", path, viewBox: `0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`, fillRule: "evenodd", fill: top.fill, stroke: top.stroke, strokeWidth: top.strokeWidth, opacity: top.opacity, ...(top.strokeAlign ? { strokeAlign: top.strokeAlign } : {}), ...(top.imageFill ? { imageFill: structuredClone(top.imageFill) } : {}), ...(top.gradient ? { gradient: structuredClone(top.gradient) } : {}) });
  const lastIndex = scene.elements.findIndex(element => element.id === top.id), insertion = scene.elements.slice(0, lastIndex).filter(element => !shapes.some(shape => shape.id === element.id)).length;
  return { scene: { ...removed.scene, elements: [...removed.scene.elements.slice(0, insertion), combined, ...removed.scene.elements.slice(insertion)] }, selectedIds: [combined.id], limited: false };
}

type SVGNode = { tag: string; attrs: Record<string, string>; children: SVGNode[] };
function parseSVGTree(source: string): SVGNode {
  if (source.length > 1_000_000) throw new Error("Choose an SVG smaller than 1 MB.");
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\s*(?:script|foreignObject|iframe|object|embed|image|use|animate|set|style)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=/i.test(source)) throw new Error("Use a standalone SVG containing only vector artwork, without scripts or external content.");
  if (/<\s*(?:clipPath|mask|filter|pattern|text)\b|\b(?:clip-path|mask|filter)\s*=/i.test(source)) throw new Error("Convert SVG text, masks and filters to plain paths before importing.");
  const cleaned = source.replace(/<!--[^]*?-->/g, "").replace(/<\?xml[^]*?\?>/g, "");
  const roots: SVGNode[] = [], stack: SVGNode[] = [];
  const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]!);
  for (const token of cleaned.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith("<")) { if (!stack.length && token.trim()) throw new Error("Invalid SVG document."); continue; }
    const closing = token.match(/^<\/([\w:-]+)\s*>$/);
    if (closing) { if (stack.pop()?.tag !== closing[1].toLowerCase()) throw new Error("Invalid SVG nesting."); continue; }
    const opening = token.match(/^<([\w:-]+)\s*([^]*?)\/?\s*>$/);
    if (!opening) throw new Error("Invalid SVG markup.");
    const attrs: Record<string, string> = {}, matches = Array.from(opening[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g));
    if (opening[2].replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, "").replace(/\/$/, "").trim()) throw new Error("SVG attributes must be quoted.");
    for (const match of matches) { if (Object.hasOwn(attrs, match[1])) throw new Error("Duplicate SVG attribute."); attrs[match[1]] = decode(match[2] ?? match[3]); }
    const node: SVGNode = { tag: opening[1].toLowerCase(), attrs, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node); else roots.push(node);
    if (!/\/\s*>$/.test(token)) stack.push(node);
    if (stack.length > 30) throw new Error("This SVG has too many nested groups.");
  }
  if (stack.length || roots.length !== 1 || roots[0].tag !== "svg") throw new Error("Choose a valid SVG document.");
  return roots[0];
}
function color(value: string | undefined, fallback = "#000000"): string {
  if (!value) return fallback;
  const named: Record<string, string> = { none: "transparent", transparent: "transparent", black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080", orange: "#ffa500", purple: "#800080" };
  if (named[value.toLowerCase()]) return named[value.toLowerCase()];
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
  const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.min(255, Math.max(0, Math.round(Number(channel)))).toString(16).padStart(2, "0")).join("")}${rgb[4] !== undefined ? Math.round(Math.min(1, Math.max(0, Number(rgb[4]))) * 255).toString(16).padStart(2, "0") : ""}`;
  throw new Error(`Unsupported SVG color: ${value}. Use HEX or RGB colors.`);
}
function alphaColor(value: string, opacity: number): string {
  if (value === "transparent" || opacity >= 1) return value;
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = hex.split("").map(character => character + character).join("");
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  return `#${hex.slice(0, 6)}${Math.round(Math.max(0, Math.min(1, alpha * opacity)) * 255).toString(16).padStart(2, "0")}`;
}
function attributes(node: SVGNode, inherited: Record<string, string>): Record<string, string> {
  const result = { ...inherited, ...node.attrs };
  for (const declaration of node.attrs.style?.split(";") ?? []) {
    const [name, ...value] = declaration.split(":");
    if (!name.trim()) continue;
    if (!/^(?:fill|stroke|stroke-width|stroke-dasharray|fill-rule|opacity|fill-opacity|stroke-opacity|display|visibility|stop-color|stop-opacity)$/.test(name.trim())) throw new Error("SVG inline styles contain unsupported properties.");
    result[name.trim()] = value.join(":").trim();
  }
  return result;
}
function nodePath(node: SVGNode): string | undefined {
  const a = node.attrs, x = numeric(a.x), y = numeric(a.y), w = numeric(a.width), h = numeric(a.height);
  if (node.tag === "path") return a.d;
  if (node.tag === "rect") {
    if (w <= 0 || h <= 0) return undefined;
    const rx = Math.min(w / 2, Math.max(0, numeric(a.rx, numeric(a.ry)))), ry = Math.min(h / 2, Math.max(0, numeric(a.ry, rx)));
    return rx && ry ? `M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z` : `M${x} ${y}H${x+w}V${y+h}H${x}Z`;
  }
  if (node.tag === "circle" || node.tag === "ellipse") {
    const cx = numeric(a.cx), cy = numeric(a.cy), rx = numeric(node.tag === "circle" ? a.r : a.rx), ry = numeric(node.tag === "circle" ? a.r : a.ry);
    if (rx <= 0 || ry <= 0) return undefined;
    return `M${cx-rx} ${cy}A${rx} ${ry} 0 1 0 ${cx+rx} ${cy}A${rx} ${ry} 0 1 0 ${cx-rx} ${cy}Z`;
  }
  if (node.tag === "line") return `M${numeric(a.x1)} ${numeric(a.y1)}L${numeric(a.x2)} ${numeric(a.y2)}`;
  if (node.tag === "polygon" || node.tag === "polyline") {
    const values = (a.points ?? "").trim().split(/[\s,]+/).map(value => numeric(value));
    if (values.length < 4 || values.length % 2) throw new Error("Invalid SVG polygon points.");
    return pointsPath([Array.from({ length: values.length / 2 }, (_, index): Point => [values[index * 2], values[index * 2 + 1]])], node.tag === "polygon");
  }
  return undefined;
}

/** Import original paths and basic shapes as editable objects. No SVG markup is inserted into the DOM. */
export function importSVG(source: string, name = "Imported SVG"): CanvasScene {
  const root = parseSVGTree(source), box = root.attrs.viewBox?.trim().split(/[\s,]+/).map(value => numeric(value)) ?? [0, 0, numeric(root.attrs.width, 360), numeric(root.attrs.height, 360)];
  if (box.length !== 4 || box[2] <= 0 || box[3] <= 0) throw new Error("SVG needs a valid viewBox or size.");
  const scale = 360 / box[2], canvas: CanvasScene = { background: "transparent", elements: [], groups: [] }, gradients = new Map<string, CanvasGradient>();
  const collect = (node: SVGNode) => {
    if ((node.tag === "lineargradient" || node.tag === "radialgradient") && node.attrs.id) {
      const stops = node.children.filter(child => child.tag === "stop").map(child => { const attrs = attributes(child, {}), raw = attrs.offset ?? "0", position = raw.endsWith("%") ? numeric(raw) : numeric(raw) * 100; return { color: alphaColor(color(attrs["stop-color"]), numeric(attrs["stop-opacity"], 1)), position: Math.min(100, Math.max(0, position)) }; });
      if (stops.length >= 2) gradients.set(node.attrs.id, { type: node.tag === "radialgradient" ? "radial" : "linear", angle: Math.atan2(numeric(node.attrs.y2) - numeric(node.attrs.y1), numeric(node.attrs.x2, 1) - numeric(node.attrs.x1)) * 180 / Math.PI + 90, stops });
    }
    node.children.forEach(collect);
  }; collect(root);
  const walk = (node: SVGNode, parentMatrix: Matrix, inherited: Record<string, string>, parentOpacity: number, groupId?: string) => {
    if (["defs", "lineargradient", "radialgradient", "stop", "title", "desc", "metadata"].includes(node.tag)) return;
    if (!["svg", "g", "path", "rect", "circle", "ellipse", "line", "polygon", "polyline"].includes(node.tag)) throw new Error(`Unsupported SVG element: ${node.tag}. Convert it to paths before importing.`);
    const attrs = attributes(node, inherited), matrix = multiply(parentMatrix, parseSVGTransform(node.attrs.transform)), opacity = parentOpacity * Math.min(1, Math.max(0, numeric(attributes(node, {}).opacity, 1)));
    let nextGroup = groupId;
    if (node.tag === "g") { nextGroup = crypto.randomUUID(); canvas.groups!.push({ id: nextGroup, name: (node.attrs.id ?? "Group").slice(0, 200), ...(groupId ? { parentId: groupId } : {}) }); if (canvas.groups!.length > 100) throw new Error("An SVG supports up to 100 editable groups."); }
    const path = nodePath(node);
    if (path) {
      const localRings = flattenVectorPath(path), local = bounds(localRings), transformed = localRings.map(ring => ring.map(point => matrixPoint(matrix, point))), world = bounds(transformed);
      const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]), orthogonal = Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) < 1e-7 && matrix[0] * matrix[3] - matrix[1] * matrix[2] > 0;
      const center = matrixPoint(matrix, [local.x + local.width / 2, local.y + local.height / 2]), width = Math.max(1, (orthogonal ? local.width * sx : world.width) * scale), height = Math.max(1, (orthogonal ? local.height * sy : world.height) * scale);
      const x = (orthogonal ? center[0] - width / scale / 2 : world.x) * scale, y = (orthogonal ? center[1] - height / scale / 2 : world.y) * scale;
      const gradientId = attrs.fill?.match(/^url\(#([\w-]+)\)$/)?.[1], gradient = gradientId ? gradients.get(gradientId) : undefined;
      if (gradientId && !gradient) throw new Error("This SVG references an unavailable gradient.");
      if (width > 10_000 || height > 10_000 || Math.abs(x) > 10_000 || Math.abs(y) > 10_000) throw new Error("SVG artwork exceeds editable size limits.");
      const shape = createCanvasElement("shape", { name: (node.attrs.id ?? `${name} ${canvas.elements.length + 1}`).slice(0, 200), x, y, width, height, rotation: orthogonal ? Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI : 0, shape: "path", path: orthogonal ? path : pointsPath(transformed), viewBox: orthogonal ? `${local.x} ${local.y} ${Math.max(.0001, local.width)} ${Math.max(.0001, local.height)}` : `${world.x} ${world.y} ${Math.max(.0001, world.width)} ${Math.max(.0001, world.height)}`, fill: gradient ? gradient.stops[0].color : alphaColor(color(attrs.fill), numeric(attrs["fill-opacity"], 1)), stroke: alphaColor(color(attrs.stroke, "transparent"), numeric(attrs["stroke-opacity"], 1)), strokeWidth: Math.min(200, Math.max(0, numeric(attrs["stroke-width"], 1) * scale * (sx + sy) / 2)), fillRule: attrs["fill-rule"] === "evenodd" ? "evenodd" : "nonzero", opacity, ...(gradient ? { gradient } : {}), ...(groupId || nextGroup ? { groupId: nextGroup } : {}), ...(attrs["stroke-dasharray"] && attrs["stroke-dasharray"] !== "none" ? { strokeDash: attrs["stroke-dasharray"].split(/[\s,]+/).map(value => Math.max(0, numeric(value) * scale)) } : {}), ...(attrs.display === "none" || attrs.visibility === "hidden" ? { hidden: true } : {}) });
      canvas.elements.push(shape); if (canvas.elements.length > 100) throw new Error("An imported SVG supports up to 100 editable objects.");
    }
    const nextStyles: Record<string, string> = {}; for (const key of ["fill", "stroke", "stroke-width", "stroke-dasharray", "fill-rule", "display", "visibility"]) if (attrs[key]) nextStyles[key] = attrs[key];
    node.children.forEach(child => walk(child, matrix, nextStyles, opacity, nextGroup));
  };
  walk(root, [1, 0, 0, 1, -box[0], -box[1]], {}, 1);
  if (!canvas.elements.length) throw new Error("No supported vector artwork was found in this SVG.");
  if (!canvas.groups?.length) delete canvas.groups;
  const validated = parseCanvasScene(canvas);
  if (!validated) throw new Error("This SVG exceeds supported vector styling limits.");
  return validated;
}
