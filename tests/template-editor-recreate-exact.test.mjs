/* Run: node --test tests/template-editor-recreate-exact.test.mjs
 * Exact copy: the original post rebuilt as it is. The run goes transcript,
 * deck, review with no pause; the critics send work back to the transcript at
 * most once; and the pieces code owns: the transcript clean-up, snapping a
 * picture's box to its real edges, cutting it out of the original slide, the
 * cover in capitals and the tidy-up. Claude is never called: the transcript and
 * the review are stand-ins, and the real deck stage builds the deck. Local
 * development storage only. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import sharp from "sharp";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-exact-test-"));
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
const environment={cwd:()=>directory,env:{NODE_ENV:"test"}};
const overrides={"@/lib/supabase/admin":{getAdminSupabase:()=>null}};
const cache=new Map();
function load(relative) {
  const filename=path.join(root,relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const unit={exports:{}};cache.set(filename,unit);
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename,
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
    if(Object.hasOwn(overrides,name))return overrides[name];
    const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
    if(local)return load(path.relative(root,[local+".ts",local+".tsx",local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
    return nativeRequire(name);
  },unit,unit.exports,environment);
  return unit.exports;
}

const orchestrator=load("lib/engine/agents/orchestrator.ts");
const posts=load("lib/engine/post-files.ts");
const jobs=load("lib/engine/recreate-jobs.ts");
const exact=load("lib/engine/agents/exact.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const review=load("lib/engine/agents/review.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const spanish=profiles.builtInPageProfiles().find(item=>item.id==="pagina-es");
const catalog=pagesLib.templatePages(template);
const usable=exact.exactPages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media"),LIST=pageIndex("List"),FOLLOW=pageIndex("Follow"),REACTION=pageIndex("Reaction");
const env=profile=>async()=>({profile,template,templates:model.BUILT_IN_TEMPLATES});
let owners=0;
const owner=()=>`owner-exact-${++owners}`;

// A slide like an Instagram one: a dark background, a headline band, and a busy picture in a known box.
const SLIDE={width:1080,height:1350};
const PICTURE={x:100,y:300,width:800,height:500}; // on the 0-1000 grid
async function slide({picture=PICTURE,background=[16,20,24],headline=true}={}) {
  const {width,height}=SLIDE,data=Buffer.alloc(width*height*3),box=picture??{x:0,y:0,width:0,height:0};
  const x0=Math.round(box.x/1000*width),x1=Math.round((box.x+box.width)/1000*width);
  const y0=Math.round(box.y/1000*height),y1=Math.round((box.y+box.height)/1000*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*3,inside=x>=x0&&x<x1&&y>=y0&&y<y1,text=headline&&y>=150&&y<300&&x>=100&&x<980&&(x>>4)%3!==2;
    if(inside){const noise=((x*73856093)^(y*19349663))>>>0;data[at]=60+noise%160;data[at+1]=60+(noise>>>8)%160;data[at+2]=60+(noise>>>16)%160;}
    else if(text){data[at]=245;data[at+1]=245;data[at+2]=245;}
    else{data[at]=background[0];data[at+1]=background[1];data[at+2]=background[2];}
  }
  const png=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  return {mediaType:"image/png",base64:png.toString("base64")};
}

/** A meme like a two-panel one: a white panel on light grey, a photo in a black frame inside it, and a row of labels near its foot. */
async function panelSlide() {
  const {width,height}=SLIDE,data=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*3,panel=x>=43&&x<1037&&y>=41&&y<1310,frame=x>=120&&x<440&&y>=200&&y<640,inner=x>=126&&x<434&&y>=206&&y<634;
    const label=y>=1240&&y<1258&&x>=150&&x<950&&(x-150)%60<40;
    let color=[228,228,228];
    if(panel)color=[250,250,250];
    if(frame)color=[20,20,20];
    if(inner){const noise=((x*73856093)^(y*19349663))>>>0;color=[60+noise%160,60+(noise>>>8)%160,60+(noise>>>16)%160];}
    if(label)color=[40,40,40];
    data[at]=color[0];data[at+1]=color[1];data[at+2]=color[2];
  }
  return {mediaType:"image/png",base64:(await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer()).toString("base64")};
}
/** A dark slide with a white headline band just above a busy picture (the gap between them is 15 pixels). */
async function headlineSlide() {
  const {width,height}=SLIDE,data=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*3,picture=x>=108&&x<972&&y>=405&&y<1080,headline=x>=100&&x<980&&y>=350&&y<390;
    let color=[16,20,24];
    if(headline)color=[245,245,245];
    if(picture){const noise=((x*73856093)^(y*19349663))>>>0;color=[60+noise%160,60+(noise>>>8)%160,60+(noise>>>16)%160];}
    data[at]=color[0];data[at+1]=color[1];data[at+2]=color[2];
  }
  return {mediaType:"image/png",base64:(await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer()).toString("base64")};
}

/**
 * A chart drawn on a light slide, as charts are: a line and an axis, years under the axis, and a column
 * of small left-aligned labels on its right (glyphs 6 pixels wide, 3 apart, so the gaps line up), the
 * longest ending at x 949. A title sits well above it.
 */
const CHART={left:100,right:949,top:500,bottom:965},BEIGE=[235,232,227];
async function chartSlide() {
  const {width,height}=SLIDE,data=Buffer.alloc(width*height*3),lengths=[8,4,6,8,5,7,8,3];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*3,row=Math.floor((y-500)/28),glyph=Math.floor((x-880)/9);
    const label=y>=500&&row<16&&(y-500)%28<10&&x>=880&&glyph<lengths[row%8]&&(x-880)%9<6;
    const year=y>=955&&y<965&&x>=100&&x<885&&(x-100)%75<36&&(x-100)%75%9<6;
    const line=x>=100&&x<850&&Math.abs(y-(900-(x-100)*.5))<=2,axis=y>=940&&y<942&&x>=100&&x<850,title=y>=300&&y<360&&x>=100&&x<700&&(x>>5)%4!==3;
    const color=label||year||title?[40,40,40]:axis?[60,60,60]:line?[240,100,40]:BEIGE;
    data[at]=color[0];data[at+1]=color[1];data[at+2]=color[2];
  }
  return {mediaType:"image/png",base64:(await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer()).toString("base64")};
}

const TRANSCRIPT={
  name:"AI vs Jobs",originalLanguage:"en",translated:false,
  slides:[
    {original:1,templatePage:COVER,texts:[{slot:"cover-headline",text:"since ChatGPT came out, [[stocks]] nearly doubled"}],media:{kind:"photo",box:PICTURE,alt:"A trader at a screen"}},
    {original:2,templatePage:MEDIA,texts:[{slot:"title",text:"Stocks vs job openings"},{slot:"body",text:"The S&P 500 is up 96% while US job openings fell 29% since November 2022"},{slot:"source",text:"Source: FRED"}],media:{kind:"chart",box:PICTURE,alt:"Two lines: stocks up, openings down"}},
  ],
  caption:"Stocks up, jobs down.\n\nSource: BLS",notes:[],
};
const REVIEWED=round=>({round,rendered:false,checks:[],facts:null,design:null,sentBack:[]});

/** Stand-in transcript and review; the deck is Engine's own exact designer. */
function crew({transcript,review:critic,images}={}) {
  const calls=[];
  const record=(stage,context)=>{
    for(const input of posts.inputsOf(stage,context.file.mode))assert.ok(["done","skipped"].includes(context.file.stages[input]?.status),`${stage} started before ${input} finished`);
    calls.push({stage,round:context.round,instructions:context.instructions,previous:context.previous});
  };
  const runners={
    transcript:async context=>{
      record("transcript",context);
      context.cache.images=images; // what originalPost keeps for the run
      return transcript?transcript(context,calls.filter(call=>call.stage==="transcript").length):{output:structuredClone(TRANSCRIPT)};
    },
    review:async context=>{
      record("review",context);
      return critic?critic(context):{output:REVIEWED(context.round)};
    },
  };
  return {calls,runners,count:stage=>calls.filter(call=>call.stage===stage).length};
}
const start=(ownerKey,team,extra={})=>orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",url:"https://www.instagram.com/p/exact/",mode:"exact",...extra},{runners:team.runners,environment:env(english)});
const read=(ownerKey,id)=>posts.getPostFile(ownerKey,id);
const elements=page=>page.canvas?.elements??[];
const bySlot=(page,slot)=>elements(page).find(element=>element.slot===slot);

test("an exact copy copies, builds and reviews, with no pause, research or posts from X",async()=>{
  const images=[await slide(),await slide()];
  const team=crew({images}),ownerKey=owner();
  const {file,done}=await start(ownerKey,team,{xPosts:["https://x.com/alice/status/101"],notes:"Keep the chart"});
  assert.equal(file.mode,"exact");
  assert.equal(file.source.xPosts,undefined,"an exact copy has no reaction slides for posts from X");
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.deepEqual(team.calls.map(call=>call.stage),["transcript","review"]);
  assert.deepEqual(Object.keys(finished.stages).sort(),["deck","review","transcript"],"no brief, research, outline, hooks or approval");
  const view=jobs.postView(finished,false);
  assert.equal(view.mode,"exact");
  assert.equal(view.status,"done");
  assert.deepEqual(view.stages.map(stage=>stage.stage),["transcript","deck","review"]);
  assert.equal(view.stages[0].title,"Exact copy");
  assert.match(view.stages[0].summary,/^Copied 2 slides word for word; 2 pictures to cut from the original$/);
  assert.equal(view.checkpoint,undefined);
  assert.deepEqual(view.result.factChecks,[]);

  const deck=await deckLib.loadDeck(ownerKey,view.result.deckId);
  assert.equal(deck.pages.length,2,"the same slides in the same order");
  assert.ok(deck.tags.includes("exact-copy"));
  const headline=bySlot(deck.pages[0],"cover-headline");
  assert.match(headline.text,/^SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED$/,"the cover headline is in capitals, as the template sets it");
  assert.match(bySlot(deck.pages[1],"body").text,/^The S&P 500 is up 96% while US job openings fell 29% since November 2022$/,"the body keeps every word");
  const photo=bySlot(deck.pages[0],"photo"),chart=bySlot(deck.pages[1],"media");
  assert.match(photo.src,/^data:image\/jpeg;base64,/,"the photo is cut from the original slide");
  assert.notEqual(photo.fit,"contain","a photo fills its frame");
  assert.match(chart.src,/^data:image\/jpeg;base64,/);
  assert.equal(chart.fit,"contain","a chart is shown whole");
  const swipe=elements(deck.pages[0]).find(element=>element.templateRole==="brand"&&element.type==="text");
  assert.ok(swipe&&!swipe.hidden,"a carousel keeps its swipe prompt");
  assert.match(deck.caption,/^Stocks up, jobs down\.\n\nSource: BLS/,"the original's caption");
});

test("a one-slide post stays one slide, without the swipe prompt",async()=>{
  const images=[await slide()];
  const team=crew({images,transcript:()=>({output:{...structuredClone(TRANSCRIPT),slides:[structuredClone(TRANSCRIPT.slides[0])]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  const deck=await deckLib.loadDeck(ownerKey,finished.stages.deck.output.deckId);
  assert.equal(deck.pages.length,1,"no Follow slide is added");
  const swipe=elements(deck.pages[0]).find(element=>element.templateRole==="brand"&&element.type==="text");
  assert.ok(swipe?.hidden,"there is nothing to swipe to");
});

test("a picture that can't be cut is noted for a person, and the deck is still built",async()=>{
  const team=crew({images:[]}),ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.ok(finished.stages.deck.output.notes.some(note=>/Slide 1: the photo couldn't be cut from the original \(its original slide is missing\); add it by hand/.test(note)));
});

test("the critic's must-fix goes back to the transcript once, with what to fix and the earlier copy",async()=>{
  const images=[await slide(),await slide()];
  const team=crew({images,review:context=>({output:{...REVIEWED(context.round),rendered:true,
    design:{verdict:"fix",summary:"Slide 2 lost a word",issues:[{slide:2,problem:"The body dropped \"US\"",fix:"Copy the body word for word",severity:"must_fix",route:"copy"},{slide:1,problem:"The photo is cropped tight",fix:"Cut the whole photo",severity:"must_fix",route:"images"}]},
    sentBack:context.round<review.MAX_EXACT_FIX_ROUNDS?["copy","images"]:[]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(review.MAX_EXACT_FIX_ROUNDS,1);
  assert.equal(team.count("transcript"),2,"the first copy plus one fix round");
  assert.equal(team.count("review"),2);
  const fix=team.calls.filter(call=>call.stage==="transcript")[1];
  assert.equal(fix.round,1);
  assert.match(fix.instructions,/The body dropped "US"/,"the copy's fix");
  assert.match(fix.instructions,/The photo is cropped tight/,"and the picture's, heard at once");
  assert.equal(fix.previous.name,"AI vs Jobs","the transcript sees its earlier copy");
  assert.deepEqual(finished.stages.review.output.sentBack,[],"the last round sends nothing back");
  assert.equal(Object.keys(finished.stages).length,3,"a fix never reaches a full recreation's stages");
});

test("an exact copy can't be approved or given posts from X, and only its own stages rerun or are handed in",async()=>{
  const images=[await slide(),await slide()];
  const team=crew({images}),ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const options={runners:team.runners,environment:env(english)};
  await assert.rejects(orchestrator.approveRecreate(ownerKey,file.id,{option:0},"human",options),/doesn't pause for approval/);
  await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/alice/status/101"],"human"),/no reaction slides/);
  await assert.rejects(orchestrator.rerunRecreateStage(ownerKey,file.id,"copy",undefined,"human",options),/An exact copy has no copy stage\. Its stages are transcript, deck, review/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"brief",{},"agent",options),/no brief stage/);
  const again=await orchestrator.rerunRecreateStage(ownerKey,file.id,"transcript","Keep the brand name off slide 2","human",options);
  await again.done;
  assert.equal(team.count("transcript"),2);
  assert.equal(team.calls.filter(call=>call.stage==="transcript")[1].instructions,"Keep the brand name off slide 2");
  assert.equal(team.count("review"),2,"the deck and the review follow the transcript");
  const handed=await orchestrator.submitRecreateStage(ownerKey,file.id,"transcript",{...structuredClone(TRANSCRIPT),slides:[{...structuredClone(TRANSCRIPT.slides[1]),templatePage:REACTION}]},"agent",options);
  await handed.done;
  const after=await read(ownerKey,file.id);
  assert.equal(after.stages.transcript.by,"agent");
  assert.equal(after.stages.transcript.output.slides[0].templatePage,MEDIA,"a Reaction page shows posts from X, so the copy goes on the photo page");
  assert.equal(team.count("transcript"),2,"the handed-in transcript isn't rewritten");
  assert.equal(after.status,"done");
});

test("the stage graph of an exact copy is its own",()=>{
  assert.deepEqual(posts.stagesFor("exact"),["transcript","deck","review"]);
  assert.ok(!posts.stagesFor("autopilot").includes("transcript"),"a full recreation never copies word for word");
  assert.deepEqual(posts.inputsOf("deck","exact"),["transcript"]);
  assert.deepEqual(posts.inputsOf("review","exact"),["deck"]);
  assert.deepEqual(posts.downstreamOf("transcript","exact"),["deck","review"]);
  assert.deepEqual(posts.downstreamOf("deck","exact"),["review"]);
  assert.ok(posts.downstreamOf("copy").includes("deck"),"the full graph is unchanged");
});

test("normalizeTranscript keeps the copy to pages and slots the template has, and says what it left out",()=>{
  const output=exact.normalizeTranscript({
    name:"  ",originalLanguage:"en",translated:false,caption:"  Caption  ",notes:[],
    slides:[
      {original:1,templatePage:99,texts:[{slot:"title",text:" Made-up page "}],media:{kind:"photo",box:{x:-20,y:100,width:500,height:400},alt:" A photo "}},
      {original:7,templatePage:LIST,texts:[{slot:"title",text:"Two lists"},{slot:"subtitle",text:"Not on this page"}],media:{kind:"chart",box:{x:100,y:100,width:500,height:500},alt:"A chart"}},
      {original:2,templatePage:MEDIA,texts:[{slot:"body",text:"Tiny box"}],media:{kind:"photo",box:{x:100,y:100,width:40,height:500},alt:"Too thin"}},
    ],
  },usable,2);
  assert.equal(output.name,"Exact copy");
  assert.equal(output.caption,"Caption");
  assert.deepEqual(output.slides.map(item=>item.templatePage),[MEDIA,LIST,MEDIA],"a made-up page becomes the photo page");
  assert.deepEqual(output.slides[0].texts,[{slot:"title",text:"Made-up page"}]);
  assert.deepEqual(output.slides[0].media,{kind:"photo",box:{x:0,y:100,width:500,height:400},alt:"A photo"},"a box stays inside the slide");
  assert.equal(output.slides[1].original,2,"an original slide that doesn't exist becomes the slide in that place, at most the last");
  assert.deepEqual(output.slides[1].texts,[{slot:"title",text:"Two lists"}]);
  assert.deepEqual(output.slides[1].media,{kind:"none",box:null,alt:""},"the List page has no photo slot");
  assert.equal(output.slides[2].media.kind,"none","a box under 6% a side isn't a picture");
  assert.ok(output.notes.some(note=>/Slide 2: left out "Not on this page", for a subtitle slot the List page doesn't have/.test(note)));
  assert.ok(output.notes.some(note=>/Slide 2: the original's chart was left out, because the List page has no photo slot/.test(note)));
  assert.ok(usable.every(page=>!page.cards&&!page.pair),"no Reaction pages and no photo pair");
  const many=exact.normalizeTranscript({...TRANSCRIPT,slides:Array.from({length:24},()=>structuredClone(TRANSCRIPT.slides[1]))},usable,24);
  assert.equal(many.slides.length,deckLib.MAX_DECK_SLIDES);
  assert.ok(many.notes.some(note=>/Kept the first 20 slides/.test(note)));
});

test("a picture's box snaps to its real edges, and stays put where there are none",async()=>{
  const image=await slide();
  const guess={x:70,y:275,width:860,height:540}; // about 3% out on every side
  const snapped=await exact.snapBox(image,guess);
  for(const key of ["x","y","width","height"])assert.ok(Math.abs(snapped[key]-PICTURE[key])<=2,`${key}: ${snapped[key]} is close to ${PICTURE[key]}`);
  const wide=await slide({picture:{x:0,y:300,width:1000,height:500}});
  const edge=await exact.snapBox(wide,{x:0,y:280,width:1000,height:530});
  assert.deepEqual([edge.x,edge.width],[0,1000],"a picture that runs to the slide's edge keeps it");
  assert.ok(Math.abs(edge.y-300)<=2&&Math.abs(edge.height-500)<=2);
  const plain=await slide({picture:null,headline:false});
  const kept=await exact.snapBox(plain,guess);
  for(const key of ["x","y","width","height"])assert.ok(Math.abs(kept[key]-guess[key])<=1,"no edge nearby: the box stays");
  const far=await exact.snapBox(image,{x:300,y:450,width:400,height:200});
  for(const key of ["x","y","width","height"])assert.ok(Math.abs(far[key]-({x:300,y:450,width:400,height:200})[key])<=1,"an edge more than 4% away is out of reach");
});

test("a snap never takes an edge inside the picture for its border: a frame, a row of labels or a white margin",async()=>{
  // The box Claude drew is a little outside the panel; the panel's edge is the picture's edge.
  const snapped=await exact.snapBox(await panelSlide(),{x:38,y:28,width:924,height:944});
  const truth={x:43/1080*1000,y:41/1350*1000,width:(1037-43)/1080*1000,height:(1310-41)/1350*1000};
  for(const key of ["x","y","width","height"])assert.ok(Math.abs(snapped[key]-truth[key])<=2,`${key}: ${snapped[key]} is close to ${truth[key].toFixed(1)}`);
});

test("a snap never grows a box onto a headline just outside the picture",async()=>{
  const image=await headlineSlide();
  const snapped=await exact.snapBox(image,{x:100,y:395/1350*1000,width:800,height:500});
  assert.ok(Math.abs(snapped.y-300)<=1,`the top moves down to the picture (${snapped.y}), not up to the headline`);
  const exactly=await exact.snapBox(image,{x:100,y:300,width:800,height:500});
  assert.ok(Math.abs(exactly.y-300)<=1,"a box already on the picture's edge stays there");
});

test("a chart's cut keeps its thin labels whole, with a little room, and leaves the title above it out",async()=>{
  const image=await chartSlide(),px=(box,key)=>key==="x"||key==="width"?box[key]/1000*SLIDE.width:box[key]/1000*SLIDE.height;
  const edges=box=>({left:px(box,"x"),right:px(box,"x")+px(box,"width"),top:px(box,"y"),bottom:px(box,"y")+px(box,"height")});
  const tight={x:70,y:360,width:790,height:380}; // its right edge, x 929, runs through the labels
  const loose={x:50,y:330,width:900,height:450};
  const plain=edges(await exact.snapBox(image,tight,"screenshot"));
  assert.ok(plain.right>=928,`without the chart pass the box never sheds labels (${plain.right.toFixed(1)})`);
  const fitted=edges(await exact.snapBox(image,tight,"chart"));
  const room={x:SLIDE.width*.02,y:SLIDE.height*.02};
  assert.ok(fitted.right>=CHART.right+room.x-2&&fitted.right<=CHART.right+room.x+2,`the right edge clears the longest label by about 2% (${fitted.right.toFixed(1)})`);
  assert.ok(fitted.left>=CHART.left-room.x-2&&fitted.left<=CHART.left-room.x+2,`plain background on the left is trimmed to the same room (${fitted.left.toFixed(1)})`);
  assert.ok(fitted.top>=CHART.top-room.y-2&&fitted.top<=CHART.top-room.y+2&&fitted.top>400,`the top keeps clear of the title (${fitted.top.toFixed(1)})`);
  assert.ok(fitted.bottom>=CHART.bottom+room.y-2&&fitted.bottom<=CHART.bottom+room.y+2,`the years under the axis stay in (${fitted.bottom.toFixed(1)})`);
  const again=edges(await exact.snapBox(image,loose,"chart"));
  for(const key of ["left","right","top","bottom"])assert.ok(Math.abs(again[key]-fitted[key])<=1,`a loose box fits the same chart (${key}: ${again[key].toFixed(1)} and ${fitted[key].toFixed(1)})`);
});

test("a picture alone takes the room of its hidden copy and keeps its shape; under a shown title the layout places it",async()=>{
  const photo=(width,height)=>({url:"https://example.com/a.jpg",alt:"",credit:"",sourceUrl:"",size:{width,height},fit:"contain"});
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Alone",caption:"",slides:[
    {templatePage:MEDIA,texts:[],photo:photo(800,1000),slide:0},
    {templatePage:MEDIA,texts:[{slot:"title",text:"AI vs Jobs"}],photo:photo(1000,680),slide:1},
  ]});
  const framed=structuredClone(bySlot(document.pages[1],"media"));
  exact.tidyExactDeck(document,pages,catalog,[]);
  const alone=bySlot(document.pages[0],"media"),title=bySlot(document.pages[0],"title"),{bottom,media}=alone.smartFlow;
  assert.ok(title.hidden);
  assert.ok(Math.abs(alone.width/alone.height-.8)<1e-9,"the picture keeps its shape");
  assert.ok(Math.abs(alone.y-title.y-(bottom-alone.y-alone.height))<1e-9,"centred in the room from the title's top to the flow's foot");
  assert.ok(alone.height>framed.height,"larger than the template's frame");
  assert.ok(alone.x>=media.x&&alone.x+alone.width<=media.x+media.width+1e-9);
  const placed=bySlot(document.pages[1],"media");
  assert.deepEqual([placed.x,placed.y,placed.width,placed.height],[framed.x,framed.y,framed.width,framed.height],"under a shown title, the layout flows the picture");
});

test("cropOriginal cuts the box out of the slide as a JPEG data URL with its size",async()=>{
  const cut=await exact.cropOriginal(await slide(),PICTURE);
  assert.deepEqual([cut.width,cut.height],[864,675]);
  assert.match(cut.url,/^data:image\/jpeg;base64,/);
  const meta=await sharp(Buffer.from(cut.url.split(",")[1],"base64")).metadata();
  assert.deepEqual([meta.format,meta.width,meta.height],["jpeg",864,675]);
  await assert.rejects(exact.cropOriginal(await slide(),{x:0,y:0,width:10,height:10}),/too small/);
  assert.equal(exact.cleanBox({x:990,y:0,width:500,height:500}),null,"a box squeezed off the slide is no picture");
});

test("the cover headline goes to capitals in the page's language, and accent marks stay",()=>{
  assert.equal(exact.coverCaps("since ChatGPT came out, [[stocks]] nearly doubled","en"),"SINCE CHATGPT CAME OUT, [[STOCKS]] NEARLY DOUBLED");
  assert.equal(exact.coverCaps("¿qué pasó con la economía? ñandú","es"),"¿QUÉ PASÓ CON LA ECONOMÍA? ÑANDÚ");
});

test("the tidy-up hides empty slots and placeholder frames, but not the Follow page's",async()=>{
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Tidy",caption:"",slides:[
    {templatePage:MEDIA,texts:[{slot:"title",text:"Only a title"}],slide:0},
    {templatePage:FOLLOW,texts:[{slot:"cta",text:"FOR AI NEWS"}],slide:1},
  ]});
  exact.tidyExactDeck(document,pages,catalog,["SWIPE FOR MORE"]);
  const [media,follow]=document.pages;
  assert.ok(bySlot(media,"body").hidden&&bySlot(media,"source").hidden,"empty text slots are hidden");
  assert.ok(!bySlot(media,"title").hidden);
  assert.ok(bySlot(media,"media").hidden,"an empty photo frame is hidden");
  assert.ok(!bySlot(follow,"photo").hidden,"the Follow page keeps the frame for the page's profile screenshot");
});

test("Engine's checks leave an exact copy's words alone",async()=>{
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Long",caption:"",slides:[
    {templatePage:COVER,texts:[{slot:"cover-headline",text:"Not in capitals"}],slide:0},
    {templatePage:MEDIA,texts:[{slot:"title",text:"A title"},{slot:"body",text:"This body runs much longer than the two short lines the house rules allow for a full recreation's slides"}],slide:1},
  ]});
  const full=review.houseChecks(document,pages,catalog,english);
  assert.ok(full.some(issue=>/cover headline isn't in capitals/.test(issue.problem)));
  assert.ok(full.some(issue=>/more than two short lines/.test(issue.problem)));
  const copy=review.houseChecks(document,pages,catalog,english,[{pageId:document.pages[1].id,exportError:"Shorten “Post text” before exporting"}],{exact:true});
  assert.ok(!copy.some(issue=>/capitals|two short lines/.test(issue.problem)),"no length or caps rules");
  assert.match(copy.find(issue=>/Shorten/.test(issue.problem)).fix,/Move this slide's words to a page with room for them, keeping every word/);
  assert.match(review.reviewComment({round:0,rendered:true,checks:[],facts:null,design:{verdict:"ship",summary:"Faithful",issues:[]},sentBack:[]},true),/Facts: not checked, as an exact copy keeps the original's words/);
});

test("the copier's prompt keeps the words and leaves out the page's voice and house rules",()=>{
  const prompt=playbookLib.rolePrompt("transcript",spanish);
  assert.ok(playbookLib.EXACT_RULES.every(rule=>prompt.includes(rule)));
  assert.ok(!prompt.includes(spanish.voice),"the page's voice would reword the original");
  assert.ok(!playbookLib.HOUSE_RULES.some(rule=>prompt.includes(rule)),"the house rules shape a full recreation");
  assert.match(prompt,/Spanish/);
  assert.ok(prompt.includes(`Its first line is always "${spanish.followCta.line1}"`)&&prompt.includes(`fit in ${spanish.followCta.maxChars} characters`),"the page's own Follow line and its limit");
  const critic=playbookLib.exactPrompt(english,"",{title:"Design critic",job:"Check",rules:["Rule"],bar:"Bar"});
  assert.ok(critic.includes(`Its first line is always "${english.followCta.line1}"`),"the critic is told the Follow page's second line is limited, so it never asks for more");
  const book=playbookLib.playbook();
  assert.equal(book.stages[0].stage,"transcript");
  assert.deepEqual(book.exactRules,playbookLib.EXACT_RULES);
  assert.ok(book.notes.some(note=>/mode exact/.test(note)));
});

test("the dialog's job model reads an exact copy and lays out its three stages",async()=>{
  const job=load("components/template-editor/recreate-job.ts");
  assert.deepEqual(job.lanesFor("exact").flatMap(lane=>lane.stages),["transcript","deck","review"]);
  assert.ok(!job.lanesFor("autopilot").flatMap(lane=>lane.stages).includes("transcript"));
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({jobId:"0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f",postId:"post-0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f",mode:"exact",status:"writing",message:"Copying",
    stages:[{stage:"transcript",title:"Exact copy",by:"agent",status:"running",summary:""},{stage:"deck",title:"Designer",by:"code",status:"pending",summary:""},{stage:"review",title:"Critics",by:"agent",status:"pending",summary:""}]}),{status:200,headers:{"content-type":"application/json"}});
  try {
    const parsed=await job.fetchRecreateJob("0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f");
    assert.equal(parsed.mode,"exact");
    assert.deepEqual(parsed.stages.map(stage=>stage.stage),["transcript","deck","review"]);
  } finally { globalThis.fetch=original; }
});
