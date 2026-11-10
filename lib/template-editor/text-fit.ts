import type { TextElement } from "./model";

export function textDisplayFontSize(element: TextElement): number {
  return element.textMode === "auto-fit" ? element.autoFitFontSize ?? element.fontSize : element.fontSize;
}
/** How far a line's glyphs can reach past its line box, in px. Each line box centres the
 * font's ascent and descent, so with a line height under the font's own (Bebas Neue at .836)
 * accented capitals rise above the first line and descenders drop below the last. Measured
 * over the editor's fonts, ink reaches at most .64em from the middle of a line box (Inter's
 * Á above, Lora's descenders below); .7em leaves room for the licensed fonts. */
export function glyphOverhang(fontSize: number, lineHeight: number): number {
  return Math.round(Math.max(0, .7 - lineHeight / 2) * fontSize * 100) / 100;
}
export function textFitLimits(element: TextElement) {
  const min=Math.max(1,Math.min(500,element.autoFitMinFontSize??1));
  const max=Math.max(min,Math.min(500,element.autoFitMaxFontSize??element.fontSize));
  return {min,max};
}

/** Measure natural content height without the current box limiting shrinkage. */
export function measureTextHeight(node: HTMLElement): number {
  const { height, minHeight, maxHeight } = node.style;
  try {
    node.style.height = "auto";
    node.style.minHeight = "0";
    node.style.maxHeight = "none";
    const computed = node.ownerDocument?.defaultView?.getComputedStyle(node);
    const natural = Number.parseFloat(computed?.height ?? "");
    return Math.max(1, Math.min(10000, Math.ceil(Math.max(node.scrollHeight, Number.isFinite(natural) ? natural : 0))));
  } finally {
    node.style.height = height;
    node.style.minHeight = minHeight;
    node.style.maxHeight = maxHeight;
  }
}

/** A text box shrinks only when its words are more than this many units
 * shorter. Measured heights round up to whole units, so two browsers can
 * disagree by one; without this slack, two canvases in a live room would keep
 * re-fitting the same layer to each other's height. */
export const TEXT_HEIGHT_SLACK = 1;
/** A fitted font size grows back only by more than this share of itself, for
 * the same reason. Overflow is always fixed, so canvases settle on the
 * smaller size. */
export const TEXT_FONT_SIZE_SLACK = .01;

/** Keep the visual top edge in place when a rotated text box grows or shrinks.
 * A box always grows to fit its words, and shrinks past TEXT_HEIGHT_SLACK. */
export function resizeTextHeight(element: TextElement, height: number): TextElement {
  if (!Number.isFinite(height) || height - element.height < .5 && element.height - height <= TEXT_HEIGHT_SLACK) return element;
  const nextHeight = Math.max(1, Math.min(10000, height));
  const delta = (nextHeight - element.height) / 2, radians = element.rotation * Math.PI / 180;
  return { ...element, height: nextHeight, x: element.x - delta * Math.sin(radians), y: element.y + delta * Math.cos(radians) - delta };
}
/** The requested fontSize is never replaced by a temporary measured result. */
export function fitTextFontSize(element:TextElement,fits:(size:number)=>boolean):number {
  let {min:low,max:high}=textFitLimits(element);
  if(fits(high))return high;
  if(!fits(low))return low;
  for(let attempt=0;attempt<16;attempt++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
  return Math.floor(low*100)/100;
}

/** Whether a measured auto-fit size should replace the current one: always
 * when the words overflow at the current size, and when they have room to
 * grow by more than TEXT_FONT_SIZE_SLACK. */
export function shouldRefitFontSize(current:number,fitted:number):boolean {
  if(!Number.isFinite(fitted))return false;
  return fitted<=current-.01||fitted-current>Math.max(.01,current*TEXT_FONT_SIZE_SLACK);
}

/** Measure candidates, then put the editable DOM back exactly as it was. */
export function measureFittedText(node:HTMLElement,element:TextElement):number {
  const current=textDisplayFontSize(element),originalFont=node.style.fontSize;
  const spans=Array.from(node.querySelectorAll<HTMLElement>("[style]")).filter(span=>Boolean(span.style.fontSize)).map(node=>({node,original:node.style.fontSize,size:parseFloat(node.style.fontSize)}));
  try{return fitTextFontSize(element,size=>{node.style.fontSize=`${size}px`;spans.forEach(span=>span.node.style.fontSize=`${Math.max(1,span.size*size/current)}px`);return node.scrollHeight<=element.height+.5&&node.scrollWidth<=element.width+.5;});}
  finally{node.style.fontSize=originalFont;spans.forEach(span=>span.node.style.fontSize=span.original);}
}
export function scaleEditableText(node:HTMLElement,previousSize:number,nextSize:number):void {
  if(previousSize===nextSize)return;
  for(const span of node.querySelectorAll<HTMLElement>("[style]"))if(span.style.fontSize)span.style.fontSize=`${Math.max(1,parseFloat(span.style.fontSize)*nextSize/previousSize)}px`;
  node.style.fontSize=`${nextSize}px`;
}
