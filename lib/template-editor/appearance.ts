import type { CanvasElement, ShapeElement } from "./model";

export function gradientCss(gradient: CanvasElement["gradient"]) {
  if (!gradient) return undefined;
  const stops = gradient.stops.map(stop => `${stop.color} ${stop.position}%`).join(", ");
  return gradient.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${gradient.angle}deg, ${stops})`;
}

/** CSS's gradient angle is measured in page pixels, not normalized SVG axes. */
export function gradientEndpoints(angle: number, width: number, height: number) {
  const radians=angle*Math.PI/180, dx=Math.sin(radians), dy=-Math.cos(radians);
  const length=Math.abs(width*dx)+Math.abs(height*dy);
  return { x1:50-dx*length/width*50,y1:50-dy*length/height*50,x2:50+dx*length/width*50,y2:50+dy*length/height*50 };
}
export function shapePath(element: ShapeElement): string {
  const { shape } = element;
  if (shape === "path") return element.path ?? "";
  if (shape === "triangle") return "M50 0 L100 100 L0 100 Z";
  if (shape === "diamond") return "M50 0 L100 50 L50 100 L0 50 Z";
  if (shape === "arrow") return "M0 30 L65 30 L65 0 L100 50 L65 100 L65 70 L0 70 Z";
  const star = shape === "star";
  const sides = star ? (element.starPoints ?? 5) : (element.sides ?? 6);
  const count = star ? sides * 2 : sides;
  const points = Array.from({length:count},(_,i)=>{
    const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
    const radius = star && i%2 ? (element.innerRadius ?? .45)*50 : 50;
    return `${50+Math.cos(angle)*radius} ${50+Math.sin(angle)*radius}`;
  });
  return `M${points.join(" L")} Z`;
}
export function maskCss(mask: string | undefined) {
  if(mask==='ellipse')return 'ellipse(50% 50% at 50% 50%)';
  if(mask==='triangle')return 'polygon(50% 0,100% 100%,0 100%)';
  if(mask==='diamond')return 'polygon(50% 0,100% 50%,50% 100%,0 50%)';
  return undefined;
}
