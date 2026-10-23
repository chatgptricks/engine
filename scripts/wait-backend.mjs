const origin=new URL(process.env.ENGINE_API_URL).origin,expected=process.env.GITHUB_SHA;
if(!expected)throw Error("GITHUB_SHA is required to verify the release.");
for(let attempt=0;attempt<50;attempt++){
  try{
    const response=await fetch(`${origin}/api/engine/version?release=${expected}`,{signal:AbortSignal.timeout(20000),cache:"no-store"});
    const value=await response.json();
    if(response.ok&&value.commit===expected){console.log(`Backend is live at ${expected}`);process.exit(0);}
  }catch{/* Render may still be starting the new release. */}
  await new Promise(resolve=>setTimeout(resolve,15000));
}
throw Error("Render did not publish this commit. The existing Pages deployment is unchanged.");
