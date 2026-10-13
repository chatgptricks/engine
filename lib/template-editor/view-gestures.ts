export type ViewPoint={x:number;y:number};
export function viewGestureDelta(previous:readonly ViewPoint[],current:readonly ViewPoint[]) {
  const center=(points:readonly ViewPoint[])=>({x:points.reduce((sum,point)=>sum+point.x,0)/points.length,y:points.reduce((sum,point)=>sum+point.y,0)/points.length});
  if(!previous.length||!current.length||previous.length!==current.length)return {pan:{x:0,y:0},factor:1,anchor:{x:0,y:0}};
  const before=center(previous),after=center(current);
  const distance=(points:readonly ViewPoint[])=>points.length<2?0:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
  const oldDistance=distance(previous),newDistance=distance(current);
  return {pan:{x:after.x-before.x,y:after.y-before.y},factor:oldDistance>1&&newDistance>1?newDistance/oldDistance:1,anchor:after};
}
