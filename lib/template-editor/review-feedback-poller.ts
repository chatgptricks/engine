import type {ReviewComment} from './reviews';
export function watchReviewFeedback(targets:{id:string;token:string}[],update:(id:string,comments:ReviewComment[])=>void,error:(message:string)=>void,options:{interval?:number;fetcher?:typeof fetch;visible?:()=>boolean;revisions?:Map<string,string>;versions?:Map<string,number>}={}):()=>void{
 if(!targets.length)return()=>{};
 const controller=new AbortController(),revisions=options.revisions??new Map<string,string>(),versions=options.versions??new Map<string,number>();let running=false;
 const poll=async()=>{
  if(running||controller.signal.aborted||(options.visible?.()??document.visibilityState!=='hidden')===false)return;
  running=true;
  try{for(const target of targets){
   if(controller.signal.aborted)break;
   const sequence=(versions.get(target.id)??0)+1;versions.set(target.id,sequence);
   try{
    const response=await(options.fetcher??fetch)(`/api/template-editor/reviews?owner=1&feedback=1&token=${target.token}&since=${encodeURIComponent(revisions.get(target.id)??'')}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),data=await response.json();
    if(controller.signal.aborted||versions.get(target.id)!==sequence)continue;
    if(!response.ok)throw Error(data.error??'Feedback temporarily unavailable.');
    revisions.set(target.id,data.revision);if(!data.notModified)update(target.id,data.comments);
   }catch(cause){if(!controller.signal.aborted)error(cause instanceof Error?cause.message:'Feedback temporarily unavailable.');}
  }}finally{running=false;}
 };
 const initial=setTimeout(()=>void poll(),0),timer=setInterval(()=>void poll(),options.interval??5000);
 return()=>{controller.abort();clearTimeout(initial);clearInterval(timer);};
}
