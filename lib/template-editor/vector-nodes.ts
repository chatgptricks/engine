import {isSafeVectorPath,type ShapeElement} from "./model";
import {flattenVectorPath} from "./vector";
import {shapePath} from "./appearance";
import {shapeViewBox} from "./photo-frames";

export type VectorPoint={x:number;y:number};
export type VectorNode={id:string;point:VectorPoint;incoming?:VectorPoint;outgoing?:VectorPoint};
export type VectorSubpath={nodes:VectorNode[];closed:boolean};
export type VectorGraph={subpaths:VectorSubpath[]};
const same=(a:VectorPoint,b:VectorPoint)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-7;
const lerp=(a:VectorPoint,b:VectorPoint,t:number):VectorPoint=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const round=(value:number)=>Math.round(value*10000)/10000;
const reflect=(point:VectorPoint,center:VectorPoint)=>({x:center.x*2-point.x,y:center.y*2-point.y});

/** Normalize all SVG commands to editable anchors and cubic handles. Arc
 * segments use <=45° cubic approximations (maximum relative error <0.00001). */
export function parseVectorNodes(path:string):VectorGraph {
  if(!isSafeVectorPath(path))throw new Error("Choose a valid SVG path before editing its nodes.");
  const tokens=path.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g)??[];
  const subpaths:VectorSubpath[]=[];let subpath:VectorSubpath|undefined,index=0,command="",current={x:0,y:0},previous="",quad:VectorPoint|undefined;
  const read=()=>Number(tokens[index++]);
  const point=(relative:boolean)=>({x:read()+(relative?current.x:0),y:read()+(relative?current.y:0)});
  const append=(end:VectorPoint,c1?:VectorPoint,c2?:VectorPoint)=>{if(!subpath)throw new Error("SVG path needs a starting point.");if(c1)subpath.nodes.at(-1)!.outgoing=c1;const node:VectorNode={id:`node-${subpaths.length-1}-${subpath.nodes.length}`,point:end,...(c2?{incoming:c2}:{})};subpath.nodes.push(node);current=end;};
  while(index<tokens.length){
    if(/^[a-z]$/i.test(tokens[index]))command=tokens[index++];
    const kind=command.toUpperCase(),relative=command!==kind,start={...current};
    if(kind==="M"){current=point(relative);subpath={nodes:[{id:`node-${subpaths.length}-0`,point:current}],closed:false};subpaths.push(subpath);command=relative?"l":"L";}
    else if(kind==="Z"){
      if(subpath){subpath.closed=true;const first=subpath.nodes[0],last=subpath.nodes.at(-1)!;if(subpath.nodes.length>1&&same(first.point,last.point)){first.incoming=last.incoming;subpath.nodes.pop();}current=first.point;}
      command="";
    }
    else if(kind==="L")append(point(relative));
    else if(kind==="H")append({x:read()+(relative?current.x:0),y:current.y});
    else if(kind==="V")append({x:current.x,y:read()+(relative?current.y:0)});
    else if(kind==="C"||kind==="S"){
      const c1=kind==="C"?point(relative):["C","S"].includes(previous)&&subpath?.nodes.at(-1)?.incoming?reflect(subpath.nodes.at(-1)!.incoming!,start):start;
      const c2=point(relative),end=point(relative);append(end,c1,c2);
    }else if(kind==="Q"||kind==="T"){
      const control=kind==="Q"?point(relative):["Q","T"].includes(previous)&&quad?reflect(quad,start):start,end=point(relative);
      append(end,lerp(start,control,2/3),lerp(end,control,2/3));quad=control;
    }else if(kind==="A"){
      let rx=Math.abs(read()),ry=Math.abs(read());const phi=read()*Math.PI/180,large=read(),sweep=read(),end=point(relative);
      if(!rx||!ry||same(start,end))append(end);
      else{
        const cos=Math.cos(phi),sin=Math.sin(phi),dx=(start.x-end.x)/2,dy=(start.y-end.y)/2,xp=cos*dx+sin*dy,yp=-sin*dx+cos*dy;
        const scale=Math.sqrt(xp*xp/(rx*rx)+yp*yp/(ry*ry));if(scale>1){rx*=scale;ry*=scale;}
        const coefficient=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp)));
        const cxp=coefficient*rx*yp/ry,cyp=-coefficient*ry*xp/rx,cx=cos*cxp-sin*cyp+(start.x+end.x)/2,cy=sin*cxp+cos*cyp+(start.y+end.y)/2;
        const angle=Math.atan2((yp-cyp)/ry,(xp-cxp)/rx);let span=Math.atan2((-yp-cyp)/ry,(-xp-cxp)/rx)-angle;
        if(!sweep&&span>0)span-=2*Math.PI;if(sweep&&span<0)span+=2*Math.PI;
        const evaluate=(a:number)=>({x:cx+cos*rx*Math.cos(a)-sin*ry*Math.sin(a),y:cy+sin*rx*Math.cos(a)+cos*ry*Math.sin(a)});
        const derivative=(a:number)=>({x:-cos*rx*Math.sin(a)-sin*ry*Math.cos(a),y:-sin*rx*Math.sin(a)+cos*ry*Math.cos(a)});
        const count=Math.ceil(Math.abs(span)/(Math.PI/4));
        for(let step=0;step<count;step++){const a=angle+span*step/count,b=angle+span*(step+1)/count,k=4/3*Math.tan((b-a)/4),p=evaluate(a),q=step===count-1?end:evaluate(b),u=derivative(a),v=derivative(b);append(q,{x:p.x+k*u.x,y:p.y+k*u.y},{x:q.x-k*v.x,y:q.y-k*v.y});}
      }
    }else throw new Error("This SVG path cannot be edited.");
    previous=kind;if(kind!=="Q"&&kind!=="T")quad=undefined;
  }
  return {subpaths};
}
export function serializeVectorNodes(graph:VectorGraph):string {
  const xy=(point:VectorPoint)=>`${round(point.x)} ${round(point.y)}`;
  const path=graph.subpaths.map(subpath=>{
    if(!subpath.nodes.length)return "";
    let result=`M${xy(subpath.nodes[0].point)}`;
    const segment=(a:VectorNode,b:VectorNode)=>a.outgoing||b.incoming?` C${xy(a.outgoing??a.point)} ${xy(b.incoming??b.point)} ${xy(b.point)}`:` L${xy(b.point)}`;
    for(let index=1;index<subpath.nodes.length;index++)result+=segment(subpath.nodes[index-1],subpath.nodes[index]);
    if(subpath.closed){const first=subpath.nodes[0],last=subpath.nodes.at(-1)!;if(first.incoming||last.outgoing)result+=segment(last,first);result+=" Z";}
    return result;
  }).join(" ");
  if(!isSafeVectorPath(path))throw new Error("The edited path exceeds SVG limits.");return path;
}
export function moveVectorNode(graph:VectorGraph,id:string,point:VectorPoint,handle?:"incoming"|"outgoing",smooth=false):VectorGraph {
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return graph;
  point={x:Math.max(-25000,Math.min(25000,point.x)),y:Math.max(-25000,Math.min(25000,point.y))};
  const next=structuredClone(graph);
  for(const subpath of next.subpaths)for(const node of subpath.nodes)if(node.id===id){
    if(handle){node[handle]=point;if(smooth)node[handle==="incoming"?"outgoing":"incoming"]=reflect(point,node.point);}
    else{const dx=point.x-node.point.x,dy=point.y-node.point.y;node.point=point;for(const key of ["incoming","outgoing"] as const)if(node[key])node[key]={x:node[key]!.x+dx,y:node[key]!.y+dy};}
  }
  return next;
}
export function setVectorNodeCurve(graph:VectorGraph,id:string,curve:boolean):VectorGraph {
  const next=structuredClone(graph);
  for(const subpath of next.subpaths){const index=subpath.nodes.findIndex(node=>node.id===id);if(index<0)continue;
    const node=subpath.nodes[index],before=subpath.nodes[index-1]??(subpath.closed?subpath.nodes.at(-1):undefined),after=subpath.nodes[index+1]??(subpath.closed?subpath.nodes[0]:undefined);
    if(curve){if(before)node.incoming=lerp(node.point,before.point,1/3);if(after)node.outgoing=lerp(node.point,after.point,1/3);}
    else{delete node.incoming;delete node.outgoing;if(before)delete before.outgoing;if(after)delete after.incoming;}
  }return next;
}
/** Split cubic segments with De Casteljau so adding an anchor changes no curve. */
export function insertVectorNode(graph:VectorGraph,id:string):VectorGraph {
  const next=structuredClone(graph);
  for(const subpath of next.subpaths){const index=subpath.nodes.findIndex(node=>node.id===id),a=subpath.nodes[index],b=subpath.nodes[index+1]??(subpath.closed?subpath.nodes[0]:undefined);if(index<0)continue;if(!b){subpath.nodes.push({id:crypto.randomUUID(),point:{x:a.point.x+10,y:a.point.y}});continue;}
    const p=lerp(a.point,a.outgoing??a.point,.5),q=lerp(a.outgoing??a.point,b.incoming??b.point,.5),r=lerp(b.incoming??b.point,b.point,.5),u=lerp(p,q,.5),v=lerp(q,r,.5);
    const node:VectorNode={id:crypto.randomUUID(),point:lerp(u,v,.5)};
    if(a.outgoing||b.incoming){a.outgoing=p;node.incoming=u;node.outgoing=v;b.incoming=r;}
    subpath.nodes.splice(index+1,0,node);
  }return next;
}
export function removeVectorNode(graph:VectorGraph,id:string):VectorGraph {
  const next=structuredClone(graph);
  for(const subpath of next.subpaths){if(subpath.nodes.length<=2)continue;const index=subpath.nodes.findIndex(node=>node.id===id);if(index>=0){subpath.nodes.splice(index,1);const before=subpath.nodes[index-1]??(subpath.closed?subpath.nodes.at(-1):undefined),after=subpath.nodes[index]??(subpath.closed?subpath.nodes[0]:undefined);if(before)delete before.outgoing;if(after)delete after.incoming;}}
  return next;
}
export function vectorGraphForShape(shape:ShapeElement):VectorGraph {
  if(shape.shape==="rectangle"){
    const r=Math.max(0,Math.min(shape.radius,shape.width/2,shape.height/2));
    return parseVectorNodes(r?`M${r} 0 H${shape.width-r} A${r} ${r} 0 0 1 ${shape.width} ${r} V${shape.height-r} A${r} ${r} 0 0 1 ${shape.width-r} ${shape.height} H${r} A${r} ${r} 0 0 1 0 ${shape.height-r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`:`M0 0 H${shape.width} V${shape.height} H0 Z`);
  }
  if(shape.shape==="ellipse")return parseVectorNodes(`M0 ${shape.height/2} A${shape.width/2} ${shape.height/2} 0 1 0 ${shape.width} ${shape.height/2} A${shape.width/2} ${shape.height/2} 0 1 0 0 ${shape.height/2} Z`);
  return parseVectorNodes(shapePath(shape));
}
/** Reframe without moving the path in scene space, including rotated artwork. */
export function shapeWithVectorGraph(shape:ShapeElement,graph:VectorGraph):ShapeElement {
  const path=serializeVectorNodes(graph),points=flattenVectorPath(path,.05).flat();if(!points.length)throw new Error("Keep at least two anchors in the path.");
  const view=shapeViewBox(shape);
  let x=Math.min(...points.map(point=>point[0])),y=Math.min(...points.map(point=>point[1]));
  const rawWidth=Math.max(...points.map(point=>point[0]))-x,rawHeight=Math.max(...points.map(point=>point[1]))-y;
  const w=Math.max(rawWidth,view.width/shape.width),h=Math.max(rawHeight,view.height/shape.height);
  x-=(w-rawWidth)/2;y-=(h-rawHeight)/2;
  const width=Math.max(1,w/view.width*shape.width),height=Math.max(1,h/view.height*shape.height),dx=(x+w/2-view.x-view.width/2)/view.width*shape.width,dy=(y+h/2-view.y-view.height/2)/view.height*shape.height,angle=shape.rotation*Math.PI/180;
  const next={...shape,shape:"path" as const,path,viewBox:`${x} ${y} ${w} ${h}`,width,height,x:shape.x+shape.width/2+dx*Math.cos(angle)-dy*Math.sin(angle)-width/2,y:shape.y+shape.height/2+dx*Math.sin(angle)+dy*Math.cos(angle)-height/2};
  if(width>10000||height>10000||Math.abs(next.x)>10000||Math.abs(next.y)>10000)throw new Error("Keep the path within the editable canvas limits.");return next;
}
