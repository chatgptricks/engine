export const MAX_SAVE_RETRIES=5;
export function saveRetryDelay(attempt:number,random=Math.random(),retryAfterSeconds?:number):number|null{
 if(!Number.isInteger(attempt)||attempt<0||attempt>=MAX_SAVE_RETRIES)return null;
 const delay=Math.min(30000,1000*2**attempt)*(0.75+Math.max(0,Math.min(1,random))*.5);
 return Math.max(delay,Math.min(60000,Math.max(0,retryAfterSeconds??0)*1000));
}

export function autosaveDelay(retryAt:number,paused:boolean,now=Date.now()):number|null{return paused?null:Math.max(600,retryAt-now);}
