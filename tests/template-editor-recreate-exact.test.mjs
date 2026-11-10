/* Run: node --test tests/template-editor-recreate-exact.test.mjs
 * The first Recreate team's exact copy, kept until the cleanup: the original
 * post rebuilt as it is. Its run (transcript, data for its charts' real
 * numbers, deck, review, and the critic's must-fix sent back once) goes
 * through the stand-in driver in helpers-legacy-recreate, as the first
 * orchestrator ran it; the current team's exact copy is in
 * template-editor-recreate-flow. Also the pieces code owns: the transcript
 * clean-up, snapping a picture's box to its real edges, cutting it out of the
 * original slide, redrawing a chart from its data, our cards for its posts from
 * X, the cover in capitals and the tidy-up. Claude is never called: the
 * transcript, the chart rebuilder and the review are stand-ins, and the real
 * deck stage builds the deck. X is a stand-in too. Local development storage only. */
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
import {LEGACY_EXACT_INPUTS,legacyExact} from "./helpers-legacy-recreate.mjs";

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

const posts=load("lib/engine/post-files.ts");
const jobs=load("lib/engine/recreate-jobs.ts");
const exact=load("lib/engine/agents/exact.ts");
const exactData=load("lib/engine/agents/exact-data.ts");
const claude=load("lib/engine/agents/claude.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const review=load("lib/engine/agents/review.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const media=load("lib/template-editor/media-storage.ts");
/** A saved deck's cuts and charts are media files it points to (stored-images.ts); this reads one back. */
async function picture(ownerKey,src){
  const id=src.match(/^\/api\/template-editor\/assets\/([a-f0-9]{64})$/)?.[1];
  assert.ok(id,`a stored image, not ${src.slice(0,40)}`);
  const asset=await media.readOriginalAsset(ownerKey,id);
  assert.ok(asset,"stored in the deck's workspace");
  return asset;
}
const typeOf=async(ownerKey,src)=>(await picture(ownerKey,src)).mimeType;
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

/**
 * Stand-in transcript, chart rebuilder and review; the deck is Engine's own exact designer. Without
 * `data` a boxed chart's real numbers aren't found, so it stays cut; a post without charts skips the
 * stage, as the real one does.
 */
function crew({transcript,review:critic,images,data}={}) {
  const calls=[];
  const record=(stage,context)=>{
    for(const input of LEGACY_EXACT_INPUTS[stage])assert.ok(["done","skipped"].includes(context.file.stages[input]?.status),`${stage} started before ${input} finished`);
    calls.push({stage,round:context.round,instructions:context.instructions,previous:context.previous});
  };
  const runners={
    transcript:async context=>{
      record("transcript",context);
      context.cache.images=images; // what originalPost keeps for the run
      return transcript?transcript(context,calls.filter(call=>call.stage==="transcript").length):{output:structuredClone(TRANSCRIPT)};
    },
    data:async context=>{
      record("data",context);
      const charts=exactData.chartSlides(context.file.stages.transcript.output);
      if(!charts.length)return exactData.exactData(context);
      return data?data(context,charts):{output:{charts:[],missing:charts.map(slide=>({slide:slide.original,why:"no real series in this test"})),notes:[]}};
    },
    review:async context=>{
      record("review",context);
      return critic?critic(context):{output:REVIEWED(context.round)};
    },
  };
  return {calls,runners,count:stage=>calls.filter(call=>call.stage===stage).length};
}
const driver=legacyExact({posts,claude,exact,exactData,review},env(english));
const start=(ownerKey,team,extra={})=>driver.start(ownerKey,team,extra);
const read=(ownerKey,id)=>posts.getPostFile(ownerKey,id);
const elements=page=>page.canvas?.elements??[];
const bySlot=(page,slot)=>elements(page).find(element=>element.slot===slot);
const notesOf=deck=>(deck.comments??[]).find(comment=>comment.text.startsWith("Notes from Recreate"))?.text??"";

test("an exact copy copies, looks for its charts' data, builds and reviews",async()=>{
  const images=[await slide(),await slide()];
  const team=crew({images}),ownerKey=owner();
  const {file,done}=await start(ownerKey,team,{notes:"Keep the chart"});
  assert.equal(file.mode,"exact");
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.deepEqual(team.calls.map(call=>call.stage),["transcript","data","review"]);
  assert.deepEqual(Object.keys(finished.stages).sort(),["data","deck","review","transcript"]);
  const view=jobs.postView(finished,false);
  assert.equal(view.mode,"exact");
  assert.equal(view.status,"done");
  assert.deepEqual(view.stages.map(stage=>stage.stage),["transcript","data","deck","review"]);
  assert.equal(view.stages[0].title,"Exact copy");
  assert.match(view.stages[0].summary,/^Copied 2 slides word for word; 1 chart to redraw; 1 picture to cut from the original$/);
  assert.equal(view.stages[1].title,"Chart rebuilder");
  assert.equal(view.stages[1].summary,"1 chart kept as cut from the original: no real series in this test");
  assert.equal(view.checkpoint,undefined);
  assert.deepEqual(view.result.factChecks,[]);

  const deck=await deckLib.loadDeck(ownerKey,view.result.deckId);
  assert.equal(deck.pages.length,2,"the same slides in the same order");
  assert.ok(deck.tags.includes("exact-copy"));
  const headline=bySlot(deck.pages[0],"cover-headline");
  assert.match(headline.text,/^SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED$/,"the cover headline is in capitals, as the template sets it");
  assert.match(bySlot(deck.pages[1],"body").text,/^The S&P 500 is up 96% while US job openings fell 29% since November 2022$/,"the body keeps every word");
  const photo=bySlot(deck.pages[0],"photo"),chart=bySlot(deck.pages[1],"media");
  assert.equal(await typeOf(ownerKey,photo.src),"image/jpeg","the photo is cut from the original slide");
  assert.notEqual(photo.fit,"contain","a photo fills its frame");
  assert.equal(await typeOf(ownerKey,chart.src),"image/jpeg","a chart whose real numbers weren't found stays cut from the original");
  assert.equal(chart.fit,"contain","a chart is shown whole");
  assert.ok(!deck.tags.includes("redrawn-charts"));
  assert.ok(notesOf(deck).includes("Slide 2: the chart stays cut from the original: no real series in this test."),notesOf(deck));
  const swipe=elements(deck.pages[0]).find(element=>element.templateRole==="brand"&&element.type==="text");
  assert.ok(swipe&&!swipe.hidden,"a carousel keeps its swipe prompt");
  assert.match(deck.caption,/^Stocks up, jobs down\.\n\nSource: BLS/,"the original's caption");
});

/** A bar chart as the chart rebuilder hands it in: the values the original prints, typed. */
const BARS={kind:"bar",unit:"%",labels:["Software","Data","Design"],series:[{name:"Change in job openings",source:"typed",fred:null,values:[-29,-12,4],emphasis:true}],
  from:null,to:null,markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",markers:[],band:null,highlight:[0]};

test("a chart rebuilt from real data is drawn in our style where the cut was, and the deck says where its numbers come from",async()=>{
  const images=[await slide(),await slide()];
  const team=crew({images,data:()=>({output:{charts:[{slide:2,chart:structuredClone(BARS),source:"the values printed on the original, checked against Indeed Hiring Lab"}],missing:[],notes:[]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  const view=jobs.postView(finished,false);
  assert.equal(view.stages[1].summary,"1 chart redrawn from real data");
  const deck=await deckLib.loadDeck(ownerKey,view.result.deckId),chart=bySlot(deck.pages[1],"media");
  assert.ok(deck.tags.includes("redrawn-charts"));
  const drawn=await picture(ownerKey,chart.src);
  assert.equal(drawn.mimeType,"image/png","drawn by our chart maker, not cut");
  assert.equal(chart.fit,"contain");
  assert.match(chart.publicAlt,/Software/,"the chart's own words, for people who can't see it");
  // Our colors on the page's background: the highlighted bar in our green, the others in our grey.
  const {data:pixels,info}=await sharp(drawn.data).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let green=0;
  for(let at=0;at<pixels.length;at+=info.channels)if(Math.abs(pixels[at]-0x00)<12&&Math.abs(pixels[at+1]-0xD9)<12&&Math.abs(pixels[at+2]-0x8A)<12)green++;
  assert.ok(green>500,`the highlighted bar is in our accent (${green} pixels)`);
  assert.ok(notesOf(deck).includes("Slide 2: the chart is redrawn in our style from real data (the values printed on the original, checked against Indeed Hiring Lab)."),notesOf(deck));
  assert.equal(bySlot(deck.pages[1],"title").text,"Stocks vs job openings","the slide keeps its own title");
  assert.equal(bySlot(deck.pages[1],"source").text,"Source: FRED","and its source line");
  assert.equal(await typeOf(ownerKey,bySlot(deck.pages[0],"photo").src),"image/jpeg","a photo is still cut");
});

test("a chart rebuilder that can't finish leaves the chart cut, with the reason, and the run still ends with a deck",async()=>{
  const team=crew({images:[await slide(),await slide()],data:()=>{throw new claude.RecreateError("Claude took too many steps to rebuild the charts. Try again with a simpler post.",504);}});
  const ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.stages.data.status,"skipped");
  const deck=await deckLib.loadDeck(ownerKey,finished.deckId);
  assert.equal(await typeOf(ownerKey,bySlot(deck.pages[1],"media").src),"image/jpeg");
  assert.equal(jobs.postView(finished,false).stages[1].summary,"Claude took too many steps to rebuild the charts. Try again with a simpler post.");
  assert.ok(notesOf(deck).includes("Slide 2: the chart stays cut from the original: the chart rebuilder stopped (Claude took too many steps to rebuild the charts. Try again with a simpler post)."),notesOf(deck));
});

test("a post without charts skips the chart rebuilder",async()=>{
  const team=crew({images:[await slide()],transcript:()=>({output:{...structuredClone(TRANSCRIPT),slides:[structuredClone(TRANSCRIPT.slides[0])]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.stages.data.status,"skipped");
  assert.equal(jobs.postView(finished,false).stages[1].summary,"No chart to rebuild");
});

// ── Posts from X ────────────────────────────────────────────────────────────
/** A post as X's own embed sends it (the shape fetchXPost reads). */
const BAUDE={__typename:"Tweet",id_str:"2118420271333777856",text:"Yesterday while I was at lunch, Claude deleted a year of con law lecture notes and my current syllabus. https://t.co/o3XB8Uiugk",
  created_at:"2026-11-05T19:08:45.000Z",favorite_count:7291,conversation_count:439,
  user:{name:"William Baude",screen_name:"WilliamBaude",profile_image_url_https:"https://pbs.twimg.com/profile_images/2110968185717428224/sYEkjNW0_normal.jpg",is_blue_verified:false,profile_image_shape:"Circle"},
  entities:{media:[{url:"https://t.co/o3XB8Uiugk"}]},mediaDetails:[{type:"photo",media_url_https:"https://pbs.twimg.com/media/HWYj89XW8AABX1T.png",original_info:{width:758,height:372}}]};
/** The copier's transcript of two slides of posts: one linked in the caption, two that X can't find. */
const POSTS={
  name:"Claude deleted my notes",originalLanguage:"en",translated:false,notes:[],
  caption:"A bad day for a law professor https://x.com/WilliamBaude/status/2118420271333777856",
  slides:[
    {original:1,templatePage:REACTION,texts:[{slot:"title",text:"A law professor's bad day"}],media:{kind:"none",box:null,alt:""},graphic:null,posts:[
      {box:{x:60,y:120,width:880,height:400},name:"William Baude",handle:"WilliamBaude",badge:"none",square:false,
        text:"Yesterday while I was at lunch, Claude deleted a year of con law lecture notes and my current syllabus.",language:"en",date:"2026-11-05",link:null,
        avatar:{x:80,y:130,width:60,height:48},photo:{x:80,y:250,width:840,height:250}},
    ]},
    {original:2,templatePage:REACTION,texts:[{slot:"title",text:"What people said"}],media:{kind:"none",box:null,alt:""},graphic:null,posts:[
      {box:{x:100,y:300,width:800,height:320},name:"Alice",handle:"alice",badge:"blue",square:false,text:"Back up your notes, people",language:"en",date:"2026-11-06",link:null,
        avatar:{x:120,y:320,width:60,height:48},photo:{x:120,y:450,width:760,height:150}},
      {box:{x:100,y:650,width:800,height:150},name:"Bob",handle:"bob_builds",badge:"none",square:true,text:"This is why I keep everything in git",language:"en",date:null,link:null,
        avatar:{x:120,y:670,width:60,height:48},photo:null},
    ]},
  ],
};
/** X as a stand-in: its embed knows one post; anything else isn't there. */
function xStandIn() {
  const calls=[];
  const fetch=async url=>{
    calls.push(String(url));
    const asked=new URL(String(url));
    if(asked.origin+asked.pathname==="https://cdn.syndication.twimg.com/tweet-result"&&asked.searchParams.get("id")===BAUDE.id_str)
      return new Response(JSON.stringify(BAUDE),{status:200,headers:{"Content-Type":"application/json"}});
    return new Response("",{status:404});
  };
  return {fetch,calls};
}
async function withX(site,work) {
  const real=globalThis.fetch;
  globalThis.fetch=site.fetch;
  try{return await work();}finally{globalThis.fetch=real;}
}

test("posts from X become our cards on the Reaction page: the real post when it's linked, else built from the screenshot",async()=>{
  const ownerKey=owner(),site=xStandIn(),images=[await slide(),await slide()];
  const team=crew({images,transcript:()=>({output:structuredClone(POSTS)}),review:context=>({output:{...REVIEWED(context.round),rendered:true,
    design:{verdict:"fix",summary:"The title lost a word",issues:[{slide:1,problem:"The title dropped \"law\"",fix:"Copy the title word for word",severity:"must_fix",route:"copy"}]},
    sentBack:context.round<review.MAX_EXACT_FIX_ROUNDS?["copy"]:[]}})});
  const finished=await withX(site,async()=>{
    const {file,done}=await start(ownerKey,team);
    await done;
    return read(ownerKey,file.id);
  });
  assert.equal(finished.status,"done");
  const view=jobs.postView(finished,false);
  assert.equal(view.stages[0].summary,"Copied 2 slides word for word; 3 posts from X as our cards");
  assert.equal(finished.stages.data.status,"skipped","no chart to rebuild");
  assert.equal(team.count("transcript"),2,"a fix round rebuilt the deck");
  assert.equal(site.calls.filter(url=>url.startsWith("https://cdn.syndication.twimg.com/")).length,1,"the caption's link is read once, and not again in the fix round");

  const deck=await deckLib.loadDeck(ownerKey,view.result.deckId),[first,second]=deck.pages;
  assert.equal(deck.pages.length,2,notesOf(deck));
  const names=page=>elements(page).filter(element=>/^reaction-name/.test(element.slot??"")).length;
  assert.deepEqual([names(first),names(second)],[1,2],"Reaction pages with one card and with two");
  assert.ok(deck.tags.includes("post-cards"));
  assert.equal(bySlot(first,"title").text,"A law professor's bad day","the words around the posts go in the title");
  assert.equal(bySlot(second,"title").text,"What people said");
  // The real post: its own words, photo and profile photo, from X.
  assert.equal(bySlot(first,"reaction-name").text,"William Baude");
  assert.equal(bySlot(first,"reaction-handle").text,"@WilliamBaude");
  assert.equal(bySlot(first,"reaction-text").text,"Yesterday while I was at lunch, Claude deleted a year of con law lecture notes and my current syllabus.");
  assert.equal(bySlot(first,"reaction-avatar").src,"https://pbs.twimg.com/profile_images/2110968185717428224/sYEkjNW0_400x400.jpg");
  assert.equal(bySlot(first,"reaction-media").src,"https://pbs.twimg.com/media/HWYj89XW8AABX1T.png?name=large","the real post's photo, not a cut");
  assert.ok(bySlot(first,"reaction-badge").hidden,"no check mark, as X shows him");
  // The posts X can't find: built from the screenshot, their photos cut from the original.
  assert.equal(bySlot(second,"reaction-name").text,"Alice");
  assert.equal(bySlot(second,"reaction-text").text,"Back up your notes, people");
  assert.equal(await typeOf(ownerKey,bySlot(second,"reaction-avatar").src),"image/jpeg","her profile photo, cut from the original");
  assert.equal(await typeOf(ownerKey,bySlot(second,"reaction-media").src),"image/jpeg","her post's photo, cut too");
  assert.ok(!bySlot(second,"reaction-media").hidden);
  assert.ok(!bySlot(second,"reaction-badge").hidden,"her blue check");
  assert.equal(bySlot(second,"reaction-handle-2").text,"@bob_builds");
  assert.equal(await typeOf(ownerKey,bySlot(second,"reaction-avatar-2").src),"image/jpeg");
  const square=bySlot(second,"reaction-avatar-2");
  assert.ok(Math.abs(square.radius-square.width*.113)<1e-9,"a rounded-square profile photo, as the screenshot shows");
  assert.ok(bySlot(second,"reaction-media-2").hidden,"his post has no photo");
  const notes=notesOf(deck);
  assert.ok(notes.includes("Slide 1: the post by @WilliamBaude is the real one from X (https://x.com/WilliamBaude/status/2118420271333777856)."),notes);
  assert.ok(notes.includes("Slide 2: the post by @alice wasn't found on X (X search isn't set up on this server), so its card is built from the screenshot, with its profile photo and its photo cut from the original."),notes);
  assert.ok(notes.includes("Slide 2: the post by @bob_builds wasn't found on X (X search isn't set up on this server), so its card is built from the screenshot, with its profile photo cut from the original."),notes);
  assert.ok(notes.includes("1 of 3 posts from X is the real one; the rest are built from the screenshots."),notes);
  const lists=(deck.comments??[]).filter(comment=>/from X, word for word/.test(comment.text)).map(comment=>comment.text);
  assert.deepEqual(lists,[
    "Real posts from X, word for word:\n@WilliamBaude (7.3K likes · Nov 5, 2026): https://x.com/WilliamBaude/status/2118420271333777856",
    "Posts from X, word for word:\n@alice (Nov 6, 2026): built from the original's screenshot, not found on X\n@bob_builds: built from the original's screenshot, not found on X",
  ]);
});

test("without a Reaction page, posts from X are cut whole from the original",()=>{
  const output=exact.normalizeTranscript(structuredClone(POSTS),usable.filter(page=>!page.cards),2);
  assert.deepEqual(output.slides.map(item=>item.templatePage),[MEDIA,MEDIA]);
  assert.ok(output.slides.every(item=>!item.posts.length&&item.media.kind==="screenshot"));
  assert.deepEqual(output.slides[1].media.box,{x:100,y:300,width:800,height:500},"one box around both posts");
  assert.match(output.slides[0].media.alt,/^@WilliamBaude: Yesterday while I was at lunch/);
  assert.ok(output.notes.includes("Slide 1: the post is cut whole: the template has no Reaction page for post cards."));
  assert.ok(output.notes.includes("Slide 2: the posts are cut whole: the template has no Reaction page for post cards."));
});

test("normalizeTranscript puts posts on the Reaction page that holds them, and keeps only posts a card can show",()=>{
  const post=(handle,text="Words")=>({box:{x:100,y:100,width:800,height:200},name:handle,handle,badge:"none",square:false,text,language:"en",date:null,link:null,avatar:null,photo:null});
  const output=exact.normalizeTranscript({...structuredClone(TRANSCRIPT),slides:[
    {original:1,templatePage:MEDIA,texts:[{slot:"title",text:"Two posts"},{slot:"body",text:"Not on a Reaction page"}],media:{kind:"screenshot",box:PICTURE,alt:"Two posts"},graphic:null,posts:[post("@alice"),post("bob")]},
    {original:2,templatePage:REACTION,texts:[{slot:"title",text:"No posts here"}],media:{kind:"photo",box:PICTURE,alt:"A photo"},graphic:null,posts:[post(""),post("carol","")]},
    {original:2,templatePage:REACTION,texts:[],media:{kind:"none",box:null,alt:""},graphic:null,posts:Array.from({length:8},(_,n)=>post(`user${n}`))},
  ]},usable,2);
  const [two,none,many]=output.slides;
  const cards=index=>catalog.find(page=>page.index===index).cards;
  assert.equal(cards(two.templatePage),2,"two posts: the page with two cards");
  assert.deepEqual(two.posts.map(item=>item.handle),["alice","bob"],"the @ goes");
  assert.deepEqual(two.media,{kind:"none",box:null,alt:""},"the cards show the posts: a box around the screenshot would repeat them");
  assert.deepEqual(two.texts,[{slot:"title",text:"Two posts"}]);
  assert.ok(output.notes.includes("Slide 1: left out \"Not on a Reaction page\", for a body slot the Reaction page doesn't have.")||output.notes.some(note=>/Slide 1: left out "Not on a Reaction page"/.test(note)));
  assert.equal(cards(none.templatePage),0,"a slide without posts leaves the Reaction page");
  assert.deepEqual(none.posts,[]);
  assert.equal(none.media.kind,"photo");
  assert.ok(output.notes.includes("Slide 2: left out 2 posts from X without an @handle, or without words or a photo."));
  assert.equal(many.posts.length,6);
  assert.equal(cards(many.templatePage),3,"the page with the most cards; the deck continues them on the next");
  assert.ok(output.notes.includes("Slide 3: kept the first 6 of its 8 posts from X."));
  const graphic={panels:[{box:{x:0,y:0,width:1000,height:1000},card:false,blocks:[{kind:"heading",box:{x:100,y:100,width:800,height:100},align:"center",text:"A meme",columns:0,logos:[],alt:""}]}]};
  const both=exact.normalizeTranscript({...structuredClone(TRANSCRIPT),slides:[{original:1,templatePage:REACTION,texts:[],media:{kind:"none",box:null,alt:""},graphic,posts:[post("alice")]}]},usable,1);
  assert.deepEqual(both.slides[0].posts,[]);
  assert.ok(both.notes.includes("Slide 1: its post is rebuilt as part of the graphic, not as a post card."));
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
  assert.equal(team.count("data"),2,"the charts are checked again after the transcript's fix");
  const fix=team.calls.filter(call=>call.stage==="transcript")[1];
  assert.equal(fix.round,1);
  assert.match(fix.instructions,/The body dropped "US"/,"the copy's fix");
  assert.match(fix.instructions,/The photo is cropped tight/,"and the picture's, heard at once");
  assert.equal(fix.previous.name,"AI vs Jobs","the transcript sees its earlier copy");
  assert.deepEqual(finished.stages.review.output.sentBack,[],"the last round sends nothing back");
  assert.equal(Object.keys(finished.stages).length,4,"a fix never reaches a full recreation's stages");
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
  assert.ok(usable.every(page=>!page.pair),"no photo pair");
  assert.deepEqual(usable.filter(page=>page.cards).map(page=>page.cards).sort(),[1,2,3],"the Reaction pages, for posts from X");
  const many=exact.normalizeTranscript({...TRANSCRIPT,slides:Array.from({length:24},()=>structuredClone(TRANSCRIPT.slides[1]))},usable,24);
  assert.equal(many.slides.length,deckLib.MAX_DECK_SLIDES);
  assert.ok(many.notes.some(note=>/Kept the first 20 slides/.test(note)));
});

test("the real review shows the critic the deck's notes, and an exact copy's chart fix goes back to the chart rebuilder",async()=>{
  // Chromium and Claude are stand-ins: every slide renders as a dark page, and the critic finds a chart that starts late.
  const render=load("lib/engine/slide-render.ts"),real={renderSlides:render.renderSlides,ask:claude.ask},asked=[];
  const png=await sharp({create:{width:1080,height:1440,channels:3,background:"#0B1014"}}).png().toBuffer();
  render.renderSlides=async document=>document.pages.map(page=>({pageId:page.id,png}));
  claude.ask=async call=>{
    asked.push(call);
    return asked.length===1?{verdict:"fix",summary:"The chart starts late",issues:[{slide:2,problem:"The chart starts in 2022; the original starts in 2020",fix:"Start it in 2020",severity:"must_fix",route:"data"}]}:{verdict:"ship",summary:"Faithful",issues:[]};
  };
  const data=[];
  try {
    const team=crew({images:[await slide(),await slide()],data:context=>{data.push(context.instructions);return {output:{charts:[{slide:2,chart:structuredClone(BARS),source:"Printed on the original"}],missing:[],notes:[]}};}});
    delete team.runners.review;
    const ownerKey=owner(),{file,done}=await start(ownerKey,team);
    await done;
    const finished=await read(ownerKey,file.id);
    assert.equal(finished.status,"done");
    assert.equal(asked.length,2,"the design critic, once a round; an exact copy has no fact critic");
    assert.match(asked[0].system,/^You are the design critic/);
    assert.match(asked[0].system,/A redrawn chart is the original's chart in our chart style/);
    assert.match(asked[0].system,/Everything else is rebuilt in our style, never pasted/);
    const words=asked[0].content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
    assert.match(words,/THE DECK'S NOTES \(what code rebuilt, and what it couldn't and why\)\n- Slide 2: the chart is redrawn in our style from real data \(Printed on the original\)\./);
    assert.deepEqual(finished.stages.review.output.round,1);
    assert.equal(data.length,2,"the chart rebuilder heard the fix");
    assert.match(data[1],/The chart starts in 2022; the original starts in 2020\. Fix: Start it in 2020/);
    assert.equal(team.count("transcript"),1);
  } finally {
    render.renderSlides=real.renderSlides;
    claude.ask=real.ask;
  }
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

test("the tidy-up hides empty slots and placeholder frames, but keeps the Follow page's frame for a person's profile screenshot",async()=>{
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Tidy",caption:"",slides:[
    {templatePage:MEDIA,texts:[{slot:"title",text:"Only a title"}],slide:0},
    {templatePage:FOLLOW,texts:[{slot:"cta",text:"FOR AI NEWS"}],slide:1},
  ]});
  exact.tidyExactDeck(document,pages,catalog,["SWIPE FOR MORE"]);
  const [media,follow]=document.pages;
  assert.ok(bySlot(media,"body").hidden&&bySlot(media,"source").hidden,"empty text slots are hidden");
  assert.ok(!bySlot(media,"title").hidden);
  assert.ok(bySlot(media,"media").hidden,"an empty photo frame is hidden");
  assert.ok(!bySlot(follow,"photo").hidden,"the Follow page keeps its frame: a person adds the profile screenshot there");
  assert.ok(!bySlot(follow,"cta").hidden);
  assert.ok(elements(media).filter(element=>element.slot&&!element.hidden).every(element=>element.type!=="image"||!/^data:image\/svg\+xml/.test(element.src)),"no other slot shows a placeholder");
});

test("a cover keeps its picture whole as its photo; words for a slot a page lacks go to its closest free slot, one entry a slot",()=>{
  const part=(kind,box,text="",alt="")=>({kind,box,align:"center",text,columns:0,logos:[],alt});
  const graphic={panels:[
    {box:{x:0,y:0,width:500,height:620},card:false,blocks:[part("photo",{x:20,y:20,width:460,height:580},"","Before")]},
    {box:{x:500,y:0,width:500,height:620},card:false,blocks:[part("photo",{x:520,y:20,width:460,height:580},"","After"),part("text",{x:540,y:540,width:200,height:40},"AFTER")]},
  ]};
  const none={kind:"none",box:null,alt:""},slide=(templatePage,texts,extra={})=>({original:1,templatePage,texts,media:none,graphic:null,posts:[],...extra});
  const output=exact.normalizeTranscript({...structuredClone(TRANSCRIPT),slides:[
    slide(COVER,[{slot:"cover-headline",text:"Before and after"}],{media:{kind:"photo",box:null,alt:" Two photos side by side "},graphic}),
    slide(MEDIA,[{slot:"cover-headline",text:"A cover headline"},{slot:"title",text:""},{slot:"body",text:"Body words"}]),
    slide(MEDIA,[{slot:"list-left-heading",text:"A column heading"},{slot:"list-left-items",text:"One\nTwo"}]),
    slide(MEDIA,[{slot:"title",text:"A title"},{slot:"title",text:"A title"},{slot:"title",text:"Its second line"},{slot:"body",text:""},{slot:"body",text:""}]),
  ]},usable,1);
  const [cover,moved,same,twice]=output.slides;
  assert.equal(cover.templatePage,COVER,"a cover stays a cover");
  assert.equal(cover.graphic,null);
  assert.deepEqual(cover.media,{kind:"photo",box:{x:0,y:0,width:1000,height:620},alt:"Two photos side by side"},"the graphic's box is cut whole as the photo, with its alt");
  assert.deepEqual(cover.texts,[{slot:"cover-headline",text:"Before and after"}]);
  assert.ok(output.notes.includes("Slide 1: the cover keeps the original's picture whole as its photo, with what is drawn on it, under its headline."));
  const rebuilt=exact.normalizeTranscript({...structuredClone(TRANSCRIPT),slides:[slide(COVER,[],{graphic}),slide(MEDIA,[],{graphic})]},usable,1).slides;
  assert.ok(rebuilt.every(item=>item.templatePage===MEDIA&&item.graphic&&item.media.kind==="none"),"a graphic without a headline, a meme put first, is still rebuilt");

  assert.deepEqual(moved.texts,[{slot:"title",text:"A cover headline"},{slot:"body",text:"Body words"}],"a cover headline goes in the free heading, and the copier's empty title doesn't follow it");
  assert.equal(Object.fromEntries(moved.texts.map(entry=>[entry.slot,entry.text])).title,"A cover headline","the deck sets a slot to its last entry");
  assert.ok(output.notes.includes("Slide 2: \"A cover headline\" goes in the Text + Media page's title slot, as it has no cover-headline slot."));
  assert.deepEqual(same.texts,[{slot:"title",text:"A column heading"}],"a heading goes in a free slot with the same role");
  assert.ok(output.notes.includes("Slide 3: left out \"One\nTwo\", for a list-left-items slot the Text + Media page doesn't have."),"no slot with its role: left out, with a note");
  assert.deepEqual(twice.texts,[{slot:"title",text:"A title\nIts second line"},{slot:"body",text:""}],"two entries with words are joined, repeats and empty ones dropped");
});

test("a rebuilt graphic goes over its page's hidden frame, whose flow goes too, so the title keeps its place above it",async()=>{
  const smart=load("lib/template-editor/smart-text.ts");
  const measure=(element,words=smart.smartWords(element))=>({size:element.fontSize,widths:words.map(word=>word.text.length*element.fontSize*.45),space:element.fontSize*.25});
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Rebuilt",caption:"",slides:[{templatePage:MEDIA,texts:[{slot:"title",text:"A meme"}],slide:0}]});
  exact.tidyExactDeck(document,pages,catalog,[]);
  const page=document.pages[0],frame=bySlot(page,"media"),top=bySlot(page,"title").y;
  const titleY=()=>smart.layoutSmartScene(page.canvas,measure).scene.elements.find(element=>element.slot==="title").y;
  assert.ok(frame.hidden&&frame.smartFlow,"the tidy-up hides the empty frame, keeping its flow");
  assert.ok(titleY()>top+20,"a hidden frame's flow centres the copy in its room: the title would sit behind the graphic");
  const layer={id:"s1-part",type:"shape",x:20,y:200,width:100,height:100};
  assert.deepEqual(exact.placeRebuilt(document,pages,new Map([[0,{elements:[layer],groups:[]}]])),[]);
  assert.ok(frame.hidden);
  assert.equal(frame.smartFlow,undefined);
  assert.ok(elements(page).every(element=>element.smartCenter===undefined));
  assert.equal(elements(page).at(-1),layer,"the graphic's layers go on top");
  assert.ok(Math.abs(titleY()-top)<1,"the title keeps the template's place");
  assert.ok(!(document.comments??[]).some(comment=>comment.pageId===page.id&&comment.text.startsWith("No photo or chart for this slide yet")));
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
});

test("the copier rebuilds every part in our style and cuts only photos; the chart rebuilder never reads numbers off a picture",()=>{
  const prompt=playbookLib.rolePrompt("transcript",english);
  assert.match(prompt,/Every part is rebuilt in our style; only photos are cut/);
  assert.match(prompt,/A chart is redrawn in our chart style from its real numbers/);
  assert.match(prompt,/A post from X becomes our post card, in its own words/);
  assert.match(prompt,/a screenshot of an article, a headline or a chat/,"articles and chats are graphics of parts");
  assert.match(prompt,/Cut whole, as media, only a photo \(kind photo/);
  assert.match(prompt,/a product's own screen \(kind screenshot/,"a product's screen is a photo of the product");
  assert.match(prompt,/Posts from X: give each post a slide shows under posts/);
  assert.match(prompt,/never translated/,"a post keeps its own words");
  assert.ok(!/A photo, a chart and a screenshot of a post, app, article or chat are cut whole/.test(prompt),"the old rule is gone");
  assert.match(playbookLib.roleCardFor("transcript").output,/posts\[\] \{box, name, handle, badge, square, text, language, date, link, avatar, photo\}/);
  const rebuilder=playbookLib.exactPrompt(english,"",playbookLib.roleCardIn("data","exact"));
  assert.match(rebuilder,/^You are the chart rebuilder/);
  assert.match(rebuilder,/never/i);
  assert.equal(playbookLib.roleCardIn("data","autopilot").title,playbookLib.roleCardFor("data").title,"a full recreation's data stage is unchanged");
  // The full recreation's design critic guards the photo slots against pictures of charts and text.
  assert.ok(playbookLib.roleCardFor("review").rules.some(rule=>/photo slot showing a chart, table, diagram, logo grid or screenshot of text is must_fix for images/.test(rule)));
});

test("the critics' chart fix goes to the chart rebuilder, with what to fix, and the copy stays as it is",async()=>{
  const images=[await slide(),await slide()],asked=[];
  const team=crew({images,data:context=>{asked.push(context.instructions);return {output:{charts:[{slide:2,chart:structuredClone(BARS),source:"Printed on the original"}],missing:[],notes:[]}};},
    review:context=>({output:{...REVIEWED(context.round),rendered:true,
      design:{verdict:"fix",summary:"The chart lost a bar",issues:[{slide:2,problem:"The chart shows 3 bars; the original shows 4",fix:"Add the Sales bar, -8%",severity:"must_fix",route:"data"}]},
      sentBack:context.round<review.MAX_EXACT_FIX_ROUNDS?["data"]:[]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,team);
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(team.count("transcript"),1,"the copy isn't redone");
  assert.equal(team.count("data"),2);
  assert.equal(asked[0],undefined);
  assert.match(asked[1],/The chart shows 3 bars; the original shows 4\. Fix: Add the Sales bar, -8%/);
  assert.match(asked[1],/Rebuild each chart these name again from its real numbers; keep the others as they are\./);
  assert.ok(!/Keep every chart's id/.test(asked[1]),"an exact copy's charts have no ids");
  assert.equal(team.count("review"),2);
});

test("the dialog's job model reads an earlier exact copy and lists its own four stages",async()=>{
  const job=load("components/template-editor/recreate-job.ts");
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({jobId:"0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f",postId:"post-0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f",version:1,mode:"exact",status:"done",message:"Created 2 editable slides",
    stages:[{stage:"transcript",title:"Exact copy",by:"agent",status:"done",summary:""},{stage:"data",title:"Chart rebuilder",by:"agent",status:"skipped",summary:""},{stage:"deck",title:"Designer",by:"code",status:"done",summary:""},{stage:"review",title:"Critics",by:"agent",status:"done",summary:""}]}),{status:200,headers:{"content-type":"application/json"}});
  try {
    const parsed=await job.fetchRecreateJob("0b6f6a5e-8a3c-4d2b-9e1f-2a3b4c5d6e7f");
    assert.deepEqual([parsed.version,parsed.mode],[1,"exact"]);
    assert.deepEqual(parsed.stages.map(stage=>stage.stage),["transcript","data","deck","review"]);
    assert.deepEqual(job.lanesOf(parsed,parsed.mode),[{title:"Earlier Recreate",stages:["transcript","data","deck","review"]}]);
  } finally { globalThis.fetch=original; }
});

test("a cover picture cut wider than the cover's frame keeps its full width, as the original shows it, and the fade moves up with it",async()=>{
  const wide="data:image/jpeg;base64,/9j/wide",tall="data:image/jpeg;base64,/9j/tall";
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Cover",caption:"",slides:[
    {templatePage:COVER,texts:[{slot:"cover-headline",text:"BEFORE AND AFTER"}],photo:{url:wide,alt:"Two photos side by side",size:{width:1080,height:734}},slide:0},
    {templatePage:COVER,texts:[{slot:"cover-headline",text:"A PORTRAIT"}],photo:{url:tall,alt:"A person",size:{width:1080,height:1440}},slide:1},
  ]});
  const frameOf=page=>elements(page).find(element=>element.type==="image"&&element.templateRole==="media"&&element.slot&&!element.hidden);
  const [before,portrait]=document.pages.map(page=>({...frameOf(page)}));
  assert.deepEqual([before.intrinsicWidth,before.intrinsicHeight],[1080,734],"a fixed frame still learns the picture's size");
  const fades=page=>elements(page).filter(element=>element.templateRole==="brand"&&element.type==="shape").map(element=>({name:element.name,y:element.y,bottom:element.y+element.height}));
  const fadesBefore=fades(document.pages[0]);
  exact.tidyExactDeck(document,pages,catalog,[]);
  const after=frameOf(document.pages[0]);
  assert.ok(Math.abs(after.width/after.height-1080/734)<0.01,"the frame takes the picture's shape: nothing is cropped from its sides");
  assert.equal(after.y,before.y,"it stays at the top of the cover");
  assert.equal(after.width,before.width);
  const rise=before.height-after.height;
  for(const fade of fades(document.pages[0])){
    const was=fadesBefore.find(item=>item.name===fade.name);
    if(Math.abs(was.bottom-(before.y+before.height))<=2)assert.ok(Math.abs(fade.bottom-(after.y+after.height))<=2,`${fade.name} moves up to the picture's new foot`);
    else assert.equal(fade.y,was.y,`${fade.name} stays where it was`);
  }
  assert.ok(rise>0);
  const kept=frameOf(document.pages[1]);
  assert.deepEqual([kept.y,kept.height],[portrait.y,portrait.height],"a picture taller than the frame keeps the template's frame, cropped top and bottom as before");
});
