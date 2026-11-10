/* A stand-in for the first Recreate team's run of an exact copy (post files of
 * version 1), so the tests of that team's modules (the copier's clean-up, the
 * exact deck, the chart rebuilder and the critics' fix routing) keep running
 * until the cleanup removes those modules. It runs the stages one at a time, as
 * the first orchestrator did for an exact copy: transcript, data (optional: one
 * that fails is skipped), deck, review (optional), and sends the critic's
 * must-fix back once. Engine itself never runs this; the current team's runs
 * are in template-editor-recreate-flow. */
import {randomUUID} from "node:crypto";

/** What each stage of a first-team exact copy read. */
export const LEGACY_EXACT_INPUTS={transcript:[],data:["transcript"],deck:["transcript","data"],review:["deck"]};
const ORDER=["transcript","data","deck","review"];
const OPTIONAL=new Set(["data","review"]);
/** What each critic route reran: the transcript holds the words and the picture boxes, the chart data its redrawn charts. */
const FIX_STAGES={copy:["transcript"],data:["data"],images:["transcript"]};

/**
 * `modules` are the loaded post-files, claude, exact, exact-data and review
 * modules. `environment(ownerKey, profileId)` gives the page profile and the
 * templates, as the orchestrator's does. `start` runs an exact copy with a
 * team's stand-in runners over the first team's own data, deck and review.
 */
export function legacyExact({posts,claude,exact,exactData,review},environment) {
  const defaults={transcript:exact.transcript,data:exactData.exactData,deck:exact.exactDeck,review:review.review};
  const settled=record=>record?.status==="done"||record?.status==="skipped";
  const ready=(file,stage)=>{
    const status=file.stages[stage]?.status;
    return status!=="done"&&status!=="skipped"&&status!=="error"&&LEGACY_EXACT_INPUTS[stage].every(input=>settled(file.stages[input]));
  };

  function scheduleFixes(file,output) {
    if(!output.sentBack.length||output.round>=review.MAX_EXACT_FIX_ROUNDS)return;
    const round=output.round+1,wanted=new Map();
    for(const route of output.sentBack)for(const stage of FIX_STAGES[route]??[])wanted.set(stage,[...(wanted.get(stage)??[]),route]);
    if(!wanted.size)return;
    // One stage may fix several routes: it hears them all at once.
    for(const [stage,from] of wanted)posts.setStage(file,stage,{status:"pending",round,instructions:review.fixInstructions(output,from,true)},"engine",`sent back by the critics (round ${round})`);
    // The chart data reads the transcript: it checks again which slides show a chart.
    if(wanted.has("transcript")&&!wanted.has("data"))posts.setStage(file,"data",{status:"pending",round,instructions:undefined},"engine",`recheck the charts for round ${round}`);
    posts.setStage(file,"deck",{status:"pending",round,instructions:undefined},"engine",`rebuild for round ${round}`);
    posts.setStage(file,"review",{status:"pending",round,instructions:undefined},"engine",`review round ${round}`);
  }

  async function runStage(run,stage) {
    const attempt=randomUUID();
    const file=await posts.updatePostFile(run.ownerKey,run.id,next=>{posts.setStage(next,stage,{status:"running",attempt},"engine");next.status="running";});
    const record=file.stages[stage];
    const context={ownerKey:run.ownerKey,file,...run.environment,signal:run.controller.signal,usage:new claude.UsageMeter(),cache:run.cache,
      round:record.round??0,instructions:record.instructions,previous:record.output};
    let result,failure;
    try{result=await run.runners[stage](context);}catch(error){failure=error;}
    await posts.updatePostFile(run.ownerKey,run.id,current=>{
      if(result) {
        const status=result.status??"done";
        posts.setStage(current,stage,{status,output:result.output,error:undefined,instructions:undefined},"engine");
        if(result.source)current.source={...current.source,...result.source};
        if(stage==="deck"&&status==="done")current.deckId=result.output.deckId;
        if(stage==="review"&&status==="done")scheduleFixes(current,result.output);
        return;
      }
      const text=failure instanceof claude.RecreateError?failure.message:`The ${stage} stage failed unexpectedly. Rerun this stage.`;
      if(OPTIONAL.has(stage))posts.setStage(current,stage,{status:"skipped",output:undefined,error:text,instructions:undefined},"engine",`skipped: ${text}`);
      else posts.setStage(current,stage,{status:"error",error:text},"engine",`failed: ${text}`);
    });
  }

  async function drive(run) {
    for(;;) {
      const file=await posts.getPostFile(run.ownerKey,run.id);
      const stage=ORDER.find(candidate=>ready(file,candidate));
      if(!stage)break;
      await runStage(run,stage);
    }
    await posts.updatePostFile(run.ownerKey,run.id,file=>{
      const failed=ORDER.find(stage=>file.stages[stage]?.status==="error");
      if(failed) { file.status="error"; file.message=file.stages[failed].error; }
      else if(ORDER.every(stage=>settled(file.stages[stage]))&&file.stages.deck?.status==="done") { file.status="done"; file.message=`Created ${file.stages.deck.output.slideCount} editable slides`; }
      else { file.status="error"; file.message="The run stopped before the post was finished."; }
    });
  }

  /** Starts an exact copy as a version-1 file. Resolves `done` when the run ends. */
  async function start(ownerKey,team,{url="https://www.instagram.com/p/exact/",profileId="chatgptricks",notes=""}={}) {
    const created=await posts.createPostFile(ownerKey,{profileId,mode:"exact",source:{url,caption:"",notes,slideCount:0,imageIds:[]}});
    const file=await posts.updatePostFile(ownerKey,created.id,next=>{next.version=1;});
    const run={ownerKey,id:file.id,runners:{...defaults,...team.runners},environment:await environment(ownerKey,profileId),cache:{chartData:new Map()},controller:new AbortController()};
    return {file,done:drive(run)};
  }
  return {start};
}
