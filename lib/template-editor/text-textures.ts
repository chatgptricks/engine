import type { CSSProperties } from "react";
import type { TextElement, ShapeImageFill } from "./model";
import { proxied } from "../engine/util";

export function textureBackgroundStyle(texture: ShapeImageFill, width?:number, height?:number): CSSProperties {
  let backgroundSize:string=texture.objectFit;
  const zoom=texture.cropScale??1;
  if(width&&height&&texture.intrinsicWidth&&texture.intrinsicHeight){
    const ratios=[width/texture.intrinsicWidth,height/texture.intrinsicHeight];
    const ratio=(texture.objectFit==="contain"?Math.min(...ratios):Math.max(...ratios))*zoom;
    backgroundSize=`${texture.intrinsicWidth*ratio}px ${texture.intrinsicHeight*ratio}px`;
  }else if(zoom!==1)backgroundSize=`${zoom*100}% auto`;
  return {backgroundImage:`url(${JSON.stringify(proxied(texture.src))})`,backgroundSize,backgroundPosition:`${texture.cropX}% ${texture.cropY}%`,backgroundRepeat:"no-repeat",backgroundClip:"text",WebkitBackgroundClip:"text",color:"transparent",WebkitTextFillColor:"transparent"};
}
export function activeTextTextures(element: TextElement): (ShapeImageFill&{id:string})[] {
  const ids=new Set([...element.richText?.matchAll(/data-texture-id="([a-zA-Z0-9_-]+)"/g)??[]].map(match=>match[1]));
  return [...(element.textureFill?[{...element.textureFill,id:"whole"}]:[]),...(element.wordTextures??[]).filter(texture=>ids.has(texture.id))];
}
export function textTextureVariables(element: TextElement): CSSProperties {
  return Object.fromEntries(activeTextTextures(element).filter(texture=>texture.id!=="whole").map(texture=>[`--te-texture-${texture.id}`,`url(${JSON.stringify(proxied(texture.src))})`])) as CSSProperties;
}
/** Sources live only in React style variables, never in persisted rich markup. */
export function textTextureCss(element: TextElement): string {
  return activeTextTextures(element).filter(texture=>texture.id!=="whole").map(texture=>`[data-element-id="${element.id}"] [data-texture-id="${texture.id}"]{background-image:var(--te-texture-${texture.id});background-size:${texture.objectFit};background-position:${texture.cropX}% ${texture.cropY}%;background-repeat:no-repeat;background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;box-decoration-break:clone;-webkit-box-decoration-break:clone}`).join("");
}
