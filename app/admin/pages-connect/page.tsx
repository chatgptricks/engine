import {isFrontendOrigin} from "@/lib/engine/frontend-origin";
import {PagesConnect} from "@/components/engine-hosting/pages-connect";
export const metadata={title:"Sign in · Engine",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function Page({searchParams}:{searchParams:Promise<{origin?:string;state?:string}>}) {
  const {origin,state}=await searchParams;
  if(!isFrontendOrigin(origin??null)||!state||!/^[a-f0-9-]{36}$/.test(state))return <main>Open sign-in from your Engine workspace.</main>;
  return <PagesConnect origin={origin!} state={state}/>;
}
