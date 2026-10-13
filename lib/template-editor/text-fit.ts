import type { TextElement } from "./model";

export function textDisplayFontSize(element: TextElement): number {
  return element.textMode === "auto-fit" ? element.autoFitFontSize ?? element.fontSize : element.fontSize;
}
export function textFitLimits(element: TextElement) {
  const min=Math.max(1,Math.min(500,element.autoFitMinFontSize??1));
  const max=Math.max(min,Math.min(500,element.autoFitMaxFontSize??element.fontSize));
  return {min,max};
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
