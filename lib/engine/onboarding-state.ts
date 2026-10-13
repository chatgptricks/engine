export const ONBOARDING_DRAFT_KEY="engine:onboarding-draft";
export type OnboardingDraft={step:number;name:string;email:string;channelName:string;handle:string;savedAt:number};
export function parseOnboardingDraft(value:unknown,now=Date.now()):OnboardingDraft|null {
  if(!value||typeof value!=="object")return null;
  const draft=value as Record<string,unknown>;
  if(!Number.isInteger(draft.step)||Number(draft.step)<0||Number(draft.step)>2||typeof draft.savedAt!=="number"||draft.savedAt>now+60_000||now-draft.savedAt>86_400_000)return null;
  for(const key of ["name","email","channelName","handle"] as const)if(typeof draft[key]!=="string"||draft[key].length>200)return null;
  return {step:Number(draft.step),name:draft.name as string,email:draft.email as string,channelName:draft.channelName as string,handle:draft.handle as string,savedAt:draft.savedAt};
}
export function readOnboardingDraft():OnboardingDraft|null {try{return typeof sessionStorage==="undefined"?null:parseOnboardingDraft(JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)??"null"));}catch{return null;}}
export function saveOnboardingDraft(draft:Omit<OnboardingDraft,"savedAt">):void {try{sessionStorage.setItem(ONBOARDING_DRAFT_KEY,JSON.stringify({...draft,savedAt:Date.now()}));}catch{/* The form remains usable when browser storage is unavailable. */}}
