import type { TextElement } from "./model";

export function textDisplayFontSize(element: TextElement): number {
  return element.textMode === "auto-fit" ? element.autoFitFontSize ?? element.fontSize : element.fontSize;
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

/** Keep the visual top edge in place when a rotated text box grows or shrinks. */
export function resizeTextHeight(element: TextElement, height: number): TextElement {
  if (!Number.isFinite(height) || Math.abs(height - element.height) < .5) return element;
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
