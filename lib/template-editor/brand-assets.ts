import { BRAND_SVG_PREFIX, isSafeBrandSvg, type BrandAsset, type ImageElement, type ShapeImageFill } from "./model";
import { importSVG } from "./vector";
import { gradientEndpoints } from "./appearance";
import { isElementHidden } from "./commands";
import { proxied } from "../engine/util";

export function imageAsBrandAsset(image: ImageElement, dimensions?: { width: number; height: number }): BrandAsset {
  return {
    id: crypto.randomUUID(), name: image.name, src: image.src, kind: "image",
    width: dimensions?.width ?? image.intrinsicWidth ?? image.width,
    height: dimensions?.height ?? image.intrinsicHeight ?? image.height,
    ...(image.publicAlt !== undefined ? { publicAlt: image.publicAlt } : {}),
    ...(image.previewSrc ? { previewSrc: image.previewSrc } : {}),
    ...(image.directive !== undefined ? { directive: image.directive } : {}),
    ...(image.rightsNote !== undefined ? { rightsNote: image.rightsNote } : {}),
    ...(image.sourceUrl !== undefined ? { sourceUrl: image.sourceUrl } : {}),
    ...(image.provenance ? { provenance: structuredClone(image.provenance) } : {}),
  };
}
export async function captureBrandImage(image: ImageElement): Promise<BrandAsset> {
  if (image.intrinsicWidth && image.intrinsicHeight) return imageAsBrandAsset(image);
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const picture = new Image();
    const timeout = setTimeout(() => { picture.src = ""; reject(new Error("This photo could not be read. Try again while connected.")); }, 20_000);
    picture.onload = () => { clearTimeout(timeout); resolve({ width: picture.naturalWidth, height: picture.naturalHeight }); };
    picture.onerror = () => { clearTimeout(timeout); reject(new Error("This photo could not be read. Your brand kit has not changed.")); };
    picture.src = proxied(image.src);
  });
  return imageAsBrandAsset(image, dimensions);
}
export function brandAssetPhoto(asset: BrandAsset): ShapeImageFill {
  return {src:asset.src,alt:asset.name,objectFit:"contain",cropX:50,cropY:50,intrinsicWidth:asset.width,intrinsicHeight:asset.height,...(asset.previewSrc?{previewSrc:asset.previewSrc}:{}),...(asset.publicAlt!==undefined?{publicAlt:asset.publicAlt}:{}),...(asset.directive!==undefined?{directive:asset.directive}:{}),...(asset.rightsNote!==undefined?{rightsNote:asset.rightsNote}:{}),...(asset.sourceUrl!==undefined?{sourceUrl:asset.sourceUrl}:{}),...(asset.provenance?{provenance:structuredClone(asset.provenance)}:{})};
}
export function prepareVectorBrandAsset(source: string, name: string, kind: BrandAsset["kind"] = "logo"): BrandAsset {
  const scene = importSVG(source, name);
  const opening = source.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const attr = (key: string) => opening.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const box = (attr("viewBox") ?? "").trim().split(/[ ,]+/).map(Number);
  const width = Math.min(100_000, Math.max(1, parseFloat(attr("width") ?? "") || box[2] || 360));
  const height = Math.min(100_000, Math.max(1, parseFloat(attr("height") ?? "") || box[3] || width));
  const normalizedHeight = 360 * (box[3] > 0 && box[2] > 0 ? box[3] / box[2] : height / width);
  const defs: string[] = [], paths: {id:string;groupId?:string;index:number;html:string}[] = [];
  for (const [index, element] of scene.elements.entries()) {
    if (element.type !== "shape" || isElementHidden(scene, element)) continue;
    const [vx, vy, vw, vh] = (element.viewBox ?? "0 0 100 100").split(/[ ,]+/).map(Number);
    const gradient = element.gradient, id = `brand-g${index}`;
    if (gradient) {
      const stops = gradient.stops.map(stop => `<stop offset="${stop.position}%" stop-color="${stop.color}"/>`).join("");
      if (gradient.type === "radial") defs.push(`<radialGradient id="${id}" cx="50%" cy="50%" r="50%">${stops}</radialGradient>`);
      else {
        const points = gradientEndpoints(gradient.angle, element.width, element.height);
        defs.push(`<linearGradient id="${id}" x1="${points.x1}%" y1="${points.y1}%" x2="${points.x2}%" y2="${points.y2}%">${stops}</linearGradient>`);
      }
    }
    const sx = element.width / vw, sy = element.height / vh;
    const transform = `translate(${element.x + element.width / 2} ${element.y + element.height / 2}) rotate(${element.rotation}) translate(${-element.width / 2} ${-element.height / 2}) scale(${sx} ${sy}) translate(${-vx} ${-vy})`;
    paths.push({id:element.id,groupId:element.groupId,index,html:`<path d="${element.path}" fill="${gradient ? `url(#${id})` : element.fill}" stroke="${element.stroke}" stroke-width="${element.strokeWidth / ((sx + sy) / 2)}" fill-rule="${element.fillRule ?? "nonzero"}" opacity="${element.opacity}" transform="${transform}"${element.strokeDash?.length ? ` stroke-dasharray="${element.strokeDash.map(value => value / ((sx + sy) / 2)).join(" ")}"` : ""}/>`});
  }
  const body=(parentId?:string):{index:number;html:string}=>{
    const items=paths.filter(path=>path.groupId===parentId).map(path=>({index:path.index,html:path.html}));
    for(const group of scene.groups??[])if(group.parentId===parentId){const children=body(group.id);if(children.html)items.push({index:children.index,html:`<g opacity="${group.opacity??1}">${children.html}</g>`});}
    items.sort((a,b)=>a.index-b.index);return {index:items[0]?.index??Infinity,html:items.map(item=>item.html).join("")};
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 360 ${normalizedHeight}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body().html}</svg>`;
  if (!paths.length || !isSafeBrandSvg(svg)) throw new Error("This SVG exceeds supported logo limits. Convert unsupported features to paths and try again.");
  return { id: crypto.randomUUID(), name: name.slice(0, 200), src: BRAND_SVG_PREFIX + encodeURIComponent(svg), width, height, kind, variant: "universal" };
}
