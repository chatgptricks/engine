import type {CanvasElement} from './model';
export interface PdfOptions {pdfMode?:'document'|'raster';dpi?:number;widthMm?:number;bleedMm?:number;cropMarks?:boolean}
export function pdfGeometry(canvasWidth:number,canvasHeight:number,options:PdfOptions={}){
 const dpi=options.dpi??150,widthMm=options.widthMm??canvasWidth/96*25.4,bleedMm=options.bleedMm??0;
 if(!Number.isFinite(dpi)||dpi<72||dpi>600||!Number.isFinite(widthMm)||widthMm<10||widthMm>2000||!Number.isFinite(bleedMm)||bleedMm<0||bleedMm>10)throw Error('Choose DPI 72–600, width 10–2000 mm and bleed 0–10 mm.');
 const trimWidth=widthMm*72/25.4,trimHeight=trimWidth*canvasHeight/canvasWidth,bleed=bleedMm*72/25.4,marks=options.cropMarks?9:0;
 if(Math.max(trimWidth,trimHeight)>14400)throw Error('PDF pages must fit within 200 inches. Choose a smaller physical width.');
 return{dpi,widthMm,trimWidth,trimHeight,bleed,marks,width:trimWidth+2*(bleed+marks),height:trimHeight+2*(bleed+marks),scale:trimWidth/360,rasterScale:trimWidth*dpi/72/360};
}

export function needsPdfRaster(elements:CanvasElement[],groups:unknown[]=[]):boolean{return groups.some(group=>typeof (group as {opacity?:number}).opacity==='number'&&(group as {opacity:number}).opacity!==1)||elements.some(element=>Boolean(element.shadow||element.blur||element.gradient?.type==='radial'||element.type==='shape'&&(element.opacity!==1||element.shape!=='rectangle'&&element.shape!=='ellipse'&&element.strokeWidth>0)||element.blendMode&&element.blendMode!=='normal'||element.type==='text'&&(element.gradient||element.richText||/[^\u0000-\u024f\u2000-\u206f\u20a0-\u20cf]/u.test(element.text)||element.letterSpacing!==0||element.textureFill||element.wordTextures?.length||element.listStyle&&element.listStyle!=='none')));}

export function photoRasterDimension(width:number,height:number,sourceWidth:number,sourceHeight:number,fit:string,zoom:number,scale:number):number{
 const ratio=(fit==='contain'?Math.min:Math.max)(width/sourceWidth,height/sourceHeight);
 return Math.min(8192,Math.max(1,Math.ceil(Math.max(sourceWidth,sourceHeight)*ratio*zoom*scale)));
}
