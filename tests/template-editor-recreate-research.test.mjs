/* Run: node --test tests/template-editor-recreate-research.test.mjs
 * Build step B: the research stage and the check (the verdict), in both
 * modes. Research reads the source page's and our page's last posts through
 * Apify, works out the traction ratio itself and applies the page's limits;
 * the check stops, asks or lets a post through. Claude's work loop, Apify's
 * Instagram and X scrapers and X's embed are all stand-ins: nothing leaves
 * the machine. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-research-test-"));
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
const environment={cwd:()=>directory,env:{NODE_ENV:"test",APIFY_TOKEN:"test-token"}};
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

const pagePosts=load("lib/engine/page-posts.ts");
const research=load("lib/engine/agents/stages/research.ts");
const verdict=load("lib/engine/agents/stages/verdict.ts");
const schemas=load("lib/engine/agents/schemas.ts");
const claude=load("lib/engine/agents/claude.ts");
const profiles=load("lib/engine/page-profiles.ts");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const spanish=profiles.builtInPageProfiles().find(item=>item.id==="pagina-es");
const plain=value=>JSON.parse(JSON.stringify(value));
const NOW=new Date("2026-11-08T12:00:00.000Z");
const daysAgo=days=>new Date(NOW.getTime()-days*864e5).toISOString();
/** Each test reads pages afresh: the page-post cache lives for the process. */
const forget=()=>globalThis[Symbol.for("engine.page-posts")]?.clear();

// ── The outside services, standing in ────────────────────────────────────────
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
/** One item as apify~instagram-scraper returns it. */
const igPost=(shortCode,{likes=1000,comments=50,views,type="Sidecar",productType,days=1,pinned=false,caption=`Post ${shortCode}`}={})=>({
  id:`id-${shortCode}`,type,shortCode,url:`https://www.instagram.com/p/${shortCode}/`,caption,likesCount:likes,commentsCount:comments,
  ...(productType?{productType}:{}),...(views===undefined?{}:{videoViewCount:views}),timestamp:daysAgo(days),isPinned:pinned,ownerUsername:"page",
});
/** One item as apidojo~tweet-scraper returns it. */
const tweet=(id,handle,text,likes,createdAt)=>({
  type:"tweet",id,url:`https://x.com/${handle}/status/${id}`,text,fullText:text,retweetCount:3,replyCount:1,likeCount:likes,quoteCount:0,viewCount:likes*20,createdAt,lang:"en",
  isReply:false,isRetweet:false,isQuote:false,entities:{hashtags:[],symbols:[],urls:[],user_mentions:[]},
  author:{type:"user",userName:handle,name:handle.toUpperCase(),isVerified:false,isBlueVerified:false,profilePicture:`https://pbs.twimg.com/profile_images/1/${handle}_normal.jpg`},
});
/** A post as X's embed sends it. */
const embed=(id,handle,text,likes=500)=>({__typename:"Tweet",id_str:id,text,created_at:"2026-11-05T10:00:00.000Z",favorite_count:likes,user:{name:handle.toUpperCase(),screen_name:handle,is_blue_verified:false}});

/** Apify (each page's posts, X's search) and X's embed. A page that's a number answers with that HTTP status. */
function services({pages={},tweets=[],embeds={}}={}) {
  const calls=[];
  const fetch=async(url,init={})=>{
    const href=String(url);
    if(href.startsWith("https://api.apify.com/v2/acts/apify~instagram-scraper/")){
      const body=JSON.parse(init.body),handle=new URL(body.directUrls[0]).pathname.split("/")[1];
      calls.push({kind:"instagram",handle,href,body,authorization:init.headers.Authorization});
      const page=pages[handle];
      if(typeof page==="number")return new Response(JSON.stringify({error:{message:"No"}}),{status:page});
      return json(page??[{error:"not_found",errorDescription:"Page not found"}]);
    }
    if(href.startsWith("https://api.apify.com/v2/acts/apidojo~tweet-scraper/")){
      calls.push({kind:"x",body:JSON.parse(init.body)});
      return json(tweets);
    }
    if(href.startsWith("https://cdn.syndication.twimg.com/tweet-result")){
      const id=new URL(href).searchParams.get("id");
      calls.push({kind:"embed",id});
      return embeds[id]?json(embeds[id]):new Response("",{status:404});
    }
    throw new Error(`Unexpected request: ${href}`);
  };
  return {fetch,calls,count:kind=>calls.filter(call=>call.kind===kind).length};
}

// The source page: a pinned favorite (dropped), the post itself (left out of its own page's usual), its 12 latest others, and an older one past the 12.
const OTHERS=Array.from({length:12},(_,index)=>`OTHER${String(index+1).padStart(2,"0")}`);
const SOURCE_PAGE=[
  igPost("PINNED1",{likes:5_000_000,comments:90_000,days:400,pinned:true}),
  igPost("SRC0001",{likes:4000,comments:0,days:2}),
  ...OTHERS.map((code,index)=>igPost(code,{likes:1000+index*100,comments:50,days:3+index})),
  igPost("OLDEST1",{likes:900_000,comments:1,days:60}),
];
const OUR_PAGE=[
  igPost("OURS001",{likes:30000,comments:400,days:1,caption:"Google's new chip, explained"}),
  igPost("OURS002",{likes:25000,comments:300,days:4,type:"Video",productType:"clips",views:400000,caption:"The AI that writes code by itself"}),
];
const DECKS=[
  {id:"deck-1",name:"Google's chip",date:"2026-11-07",page:"chatgptricks",cover:"GOOGLE'S NEW CHIP",caption:"Google made a chip",story:"Google's TPU launch",url:"/admin/engine?design=deck-1"},
  {id:"deck-2",name:"Chip en español",date:"2026-11-07",page:"pagina-es",cover:"EL NUEVO CHIP",caption:"",story:"",url:"/admin/engine?design=deck-2"},
  {id:"deck-3",name:"An untagged deck",date:"2026-11-01",page:"",cover:"AN OLD ONE",caption:"",story:"",url:"/admin/engine?design=deck-3"},
];
const TWEETS=[
  tweet("1001","early_bird","OpenAI just shipped a new model",40,"2026-11-05T10:05:00.000Z"),
  tweet("1002","sharp_take","The new OpenAI model is the real deal",9000,"2026-11-06T09:00:00.000Z"),
  tweet("1003","late_news","Everyone is talking about OpenAI today",300,"2026-11-07T08:00:00.000Z"),
];

// ── A post file at the research stage ────────────────────────────────────────
const SOURCE={
  post:{author:{handle:"otherpage",name:"Other Page"},format:"carousel",date:"2026-11-06",caption:"OpenAI just released a new model.",url:"https://www.instagram.com/p/SRC0001/",traction:{likes:4000,comments:0,views:null}},
  originalLanguage:"en",shows:"A screenshot of a post on X",claims:"OpenAI released a new model",mismatch:"",template:{},
  slides:[{index:1,role:"cover",texts:[{role:"headline",text:"OPENAI JUST DROPPED IT"}],parts:[{kind:"x_post",box:{x:0,y:0,width:500,height:300},what:"A post by OpenAI",text:"Introducing our new model",
    post:{name:"OpenAI",handle:"OpenAI",badge:"gold",square:true,date:"2026-11-05",link:null,avatar:null,photo:null}}]}],
  notes:[],
};
function postFile({mode="autopilot",source={}}={}) {
  return {
    version:2,id:"post-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",profileId:"chatgptricks",mode,status:"running",revision:1,history:[],
    source:{caption:SOURCE.post.caption,notes:"",slideCount:1,imageIds:[],url:"https://www.instagram.com/p/SRC0001/",...source},
    stages:{source:{status:"done",output:SOURCE}},createdAt:NOW.toISOString(),updatedAt:NOW.toISOString(),
  };
}
const context=(file,profile=english)=>({ownerKey:"owner-research-test",file,profile,template:null,templates:[],signal:new AbortController().signal,usage:new claude.UsageMeter(),cache:{chartData:new Map()},round:0});

/** Claude's work loop, standing in: `answer` sees the call (its prompts, tools and hand-in) and hands in. */
async function withWork(answer,run) {
  const real=claude.work;
  claude.work=async call=>answer(call);
  try{return await run();}finally{claude.work=real;}
}
/** A hand-in as the real loop takes it: parsed by its schema, then checked. */
async function hand(call,value) {
  const parsed=call.submit.schema.parse(value);
  assert.equal(await call.submit.check(parsed),null,"the hand-in is taken");
  return parsed;
}
const tool=(call,name)=>call.tools.find(item=>item.name===name);

const FULL={
  origin:{found:true,url:"https://x.com/OpenAI/status/777",who:"OpenAI",date:"2026-11-05",note:"OpenAI's own post, read with x_post"},
  surfaces:[{title:"The Verge",url:"https://www.theverge.com/ai/openai-model",independent:true},{title:"A script",url:"javascript:alert(1)",independent:false}],
  facts:[{claim:"OpenAI released the model on Nov 5",label:"confirmed",detail:"OpenAI's own post",correction:"",sources:[{title:"OpenAI on X",url:"https://x.com/OpenAI/status/777"}]}],
  firstSeen:"2026-11-05",
  saturation:{pages:4,note:"A few tech pages so far"},
  covered:{already:false,by:[],note:"Our last posts are about other stories"},
  fabrication:[],
  positions:[{who:"Sam Altman",role:"OpenAI's CEO",said:"Our best model yet",url:"https://x.com/sama/status/778"}],
  reactions:[{id:"1002",why:"A sharp take"},{id:"777",why:"The announcement itself"},{id:"900",why:"Picked again"}],
  recommendation:{outcome:"proceed",reason:"Traced to OpenAI's own post, and the original is performing"},
};

// ── Research ──────────────────────────────────────────────────────────────────
test("a full recreation researches the story, with the page's numbers worked out by Engine",async()=>{
  forget();
  const outside=services({pages:{otherpage:SOURCE_PAGE,chatgptricks:OUR_PAGE},tweets:TWEETS,embeds:{777:embed("777","OpenAI","Introducing our new model",120000),900:embed("900","person","I tried it and it's fast",800)}});
  const libraries=[];
  const stage=research.researchWith({fetch:outside.fetch,now:()=>NOW,library:async(ownerKey,profileId)=>{libraries.push([ownerKey,profileId]);return DECKS;}});
  const result=await withWork(async call=>{
    assert.deepEqual([call.role,call.effort,call.maxTurns],["research","high",24]);
    assert.deepEqual(call.tools.map(item=>item.name),["search_x","x_post","page_posts","our_library"]);
    assert.deepEqual(plain(call.serverTools),[{type:"web_search_20260209",name:"web_search",max_uses:12},{type:"web_fetch_20260209",name:"web_fetch",max_uses:8}]);
    assert.deepEqual(Object.keys(call.submit.schema.shape),["origin","originals","surfaces","facts","firstSeen","saturation","covered","fabrication","positions","reactions","recommendation"]);
    // The prompt: the card's rules, the page's limits and the budgets; then what Engine read before the loop.
    assert.match(call.system,/You are the researcher on the team that recreates Instagram posts/);
    assert.match(call.system,/search X first: search_x sorted by Latest/);
    assert.match(call.system,/Stale: news that first broke more than 14 days ago/);
    assert.match(call.system,/Saturated: a story 10 other Instagram pages or more already posted/);
    assert.match(call.system,/Budgets for this run: web_search 12, web_fetch 8, search_x 4, x_post 10, page_posts 3, our_library 3\./);
    assert.match(call.content,/^TODAY\n2026-11-08\n\nTHE POST BEING RECREATED/);
    assert.match(call.content,/THE SOURCE PAGE'S USUAL NUMBERS \(worked out by Engine: don't redo them\)\n4,000 likes and comments against a median of 1,600 over @otherpage's last 12 posts: 2\.5×, performing \(1\.5× or more performs\)/);
    assert.doesNotMatch(call.content,/PINNED1/,"a pinned post isn't one of the page's last posts");
    assert.match(call.content,/OUR PAGE ON INSTAGRAM: @chatgptricks's last 2 posts, newest first\n- 2026-11-07 · carousel · 30,000 likes, 400 comments · https:\/\/www\.instagram\.com\/p\/OURS001\/\n  Google's new chip, explained/);
    assert.match(call.content,/OUR LIBRARY: the newest 2 of the 2 decks Engine made for this page\n- 2026-11-07 · "Google's chip" · for chatgptricks · \/admin\/engine\?design=deck-1/);
    assert.doesNotMatch(call.content,/Chip en español/,"a deck made for another page isn't our page covering it");
    assert.match(call.content,/POSTS FROM X A PERSON ADDED[^\n]*\n- id 900 · PERSON @person/);
    // The tools: X's Latest lists the first post first; x_post reads one post; our library pages through our decks.
    const latest=await tool(call,"search_x").run({terms:["\"new model\" from:OpenAI"],sort:"Latest",since:"2026-11-01",minLikes:0,language:"en"});
    assert.match(latest,/^3 posts since 2026-11-01, oldest first \(3 searches left\)\n/);
    assert.ok(latest.indexOf("id 1001")<latest.indexOf("id 1002")&&latest.indexOf("id 1002")<latest.indexOf("id 1003"),"oldest first");
    assert.match(await tool(call,"x_post").run({link:"https://x.com/OpenAI/status/777"}),/^- id 777 · OPENAI @OpenAI · 2026-11-05 · 120,000 likes/);
    assert.match(await tool(call,"our_library").run({skip:0}),/^Decks 1-2 of 2, newest first:\n- 2026-11-07 · "Google's chip"/);
    // A pick it never saw goes back to it.
    assert.match(await call.submit.check(call.submit.schema.parse({...FULL,reactions:[{id:"555",why:"Made up"}]})),/These reaction ids weren't in your search_x or x_post results: 555\./);
    return hand(call,FULL);
  },()=>stage(context(postFile({source:{xPosts:["https://x.com/person/status/900"]}}))));
  const found=result.output;
  schemas.ResearchSchema.parse(found);
  assert.equal(found.quick,false);
  assert.deepEqual(plain(found.worth.traction),{post:{likes:4000,comments:0,views:null},usual:{likes:1550,comments:50,views:null},ratio:2.5,performing:true},"Engine's own traction, not the agent's");
  assert.deepEqual(plain(found.worth.fresh),{firstSeen:"2026-11-05",ageDays:3,stale:false});
  assert.deepEqual(plain(found.worth.saturation),{note:"Posted by 4 other Instagram pages. A few tech pages so far",saturated:false});
  assert.deepEqual(found.surfaces.map(item=>item.url),["https://www.theverge.com/ai/openai-model"],"a link that isn't a public web page is dropped");
  assert.deepEqual(found.reactions.map(item=>[item.id,item.why]),[["900","Added by you"],["1002","A sharp take"],["777","The announcement itself"]],"a person's posts first, each once");
  assert.deepEqual([found.reactions[1].url,found.reactions[1].text],["https://x.com/sharp_take/status/1002","The new OpenAI model is the real deal"],"a pick keeps X's own words and link");
  assert.deepEqual(libraries,[["owner-research-test","chatgptricks"]]);
  assert.deepEqual(outside.calls.filter(call=>call.kind==="instagram").map(call=>call.handle),["otherpage","chatgptricks"]);
  assert.deepEqual(plain(outside.calls.find(call=>call.kind==="x").body),{searchTerms:["\"new model\" from:OpenAI"],maxItems:30,sort:"Latest",tweetLanguage:"en",minimumFavorites:0,start:"2026-11-01"});
  // The check lets it through, with the original as its evidence.
  assert.deepEqual(plain(verdict.decideVerdict(found,{mode:"autopilot",now:NOW.getTime()})),{outcome:"proceed",reason:FULL.recommendation.reason,evidence:[{title:"OpenAI",url:"https://x.com/OpenAI/status/777"}],answer:null});
  // A second run the same day reads neither page again.
  await withWork(call=>hand(call,{...FULL,reactions:[]}),()=>stage(context(postFile())));
  assert.equal(outside.count("instagram"),2,"each page is read once a day");
});

test("research works out the story's age and saturation against the page's own limits",async()=>{
  forget();
  const outside=services({pages:{otherpage:SOURCE_PAGE,chatgptricks:OUR_PAGE}});
  const stage=research.researchWith({fetch:outside.fetch,now:()=>NOW,library:async()=>[]});
  const old={...FULL,reactions:[],firstSeen:"2026-10-01",saturation:{pages:12,note:"Every big tech page has it"}};
  const strict=(await withWork(call=>hand(call,old),()=>stage(context(postFile())))).output;
  assert.deepEqual(plain(strict.worth.fresh),{firstSeen:"2026-10-01",ageDays:38,stale:true});
  assert.deepEqual(plain(strict.worth.saturation),{note:"Posted by 12 other Instagram pages. Every big tech page has it",saturated:true});
  const relaxed=(await withWork(call=>{
    assert.match(call.system,/more than 60 days ago/);
    assert.match(call.system,/a story 20 other Instagram pages or more/);
    return hand(call,old);
  },()=>stage(context(postFile(),{...english,check:{staleAfterDays:60,saturatedAfterPages:20}})))).output;
  assert.deepEqual([relaxed.worth.fresh.stale,relaxed.worth.saturation.saturated],[false,false],"a page with looser limits takes it");
  const timeless=(await withWork(call=>hand(call,{...old,firstSeen:null}),()=>stage(context(postFile())))).output;
  assert.deepEqual(plain(timeless.worth.fresh),{firstSeen:null,ageDays:null,stale:false},"a meme or a tip has no age");
});

test("an exact copy's quick check reads only where the post comes from, and the check asks when only reposts carry it",async()=>{
  forget();
  const outside=services({pages:{otherpage:SOURCE_PAGE}});
  let libraryRead=false;
  const stage=research.researchWith({fetch:outside.fetch,now:()=>NOW,library:async()=>{libraryRead=true;return DECKS;}});
  const result=await withWork(async call=>{
    assert.deepEqual([call.effort,call.maxTurns],["medium",14]);
    assert.deepEqual(call.tools.map(item=>item.name),["search_x","x_post","page_posts"]);
    assert.deepEqual(plain(call.serverTools).map(item=>item.max_uses),[6,4]);
    assert.deepEqual(Object.keys(call.submit.schema.shape),["origin","originals","fabrication","recommendation"]);
    assert.match(call.system,/You are the quick check on the team that rebuilds Instagram posts/);
    assert.match(call.system,/Budgets for this run: web_search 6, web_fetch 4, search_x 3, x_post 6, page_posts 2\./);
    assert.doesNotMatch(call.system,/This page's limits/);
    assert.doesNotMatch(call.content,/USUAL NUMBERS|OUR PAGE|OUR LIBRARY/);
    return hand(call,{
      origin:{found:false,url:null,who:"",date:null,note:"Every copy is the same screenshot, and no post by that account says it"},
      fabrication:[{sign:"no_original",detail:"Only reposts of one screenshot",sources:[{title:"A repost",url:"https://www.instagram.com/p/REPOST1/"}]}],
      recommendation:{outcome:"stop",reason:"No original anywhere"},
    });
  },()=>stage(context(postFile({mode:"exact"}))));
  const found=result.output;
  schemas.ResearchSchema.parse(found);
  assert.equal(found.quick,true);
  assert.deepEqual([found.surfaces,found.facts,found.positions,found.reactions].map(plain),[[],[],[],[]]);
  assert.deepEqual(plain(found.worth),{traction:{post:SOURCE.post.traction,usual:null,ratio:null,performing:false},fresh:{firstSeen:null,ageDays:null,stale:false},saturation:{note:"",saturated:false},covered:{already:false,by:[],note:""}});
  assert.equal(outside.calls.length,0,"no page is read for a quick check");
  assert.equal(libraryRead,false,"nor our library");
  const check=plain(verdict.decideVerdict(found,{mode:"exact",now:NOW.getTime()}));
  assert.equal(check.outcome,"ask","research's stop softens to an ask: a person may know the original");
  assert.equal(check.reason,"Only a repost page's summary carries it, and the search for the original was inconclusive: Only reposts of one screenshot. Research's own call was to stop: No original anywhere");
  assert.deepEqual(check.evidence,[{title:"A repost",url:"https://www.instagram.com/p/REPOST1/"}]);
});

test("research goes on when a page or our library can't be read, and says why",async()=>{
  forget();
  const outside=services({pages:{otherpage:402}});
  const stage=research.researchWith({fetch:outside.fetch,now:()=>NOW,library:async()=>{throw new Error("The library is offline");}});
  const result=await withWork(async call=>{
    assert.match(call.content,/THE SOURCE PAGE'S USUAL NUMBERS\nUnknown: The Apify account is out of credit, so the page's posts can't be read\./);
    assert.match(call.content,/OUR PAGE ON INSTAGRAM\nNot read: @tu_pagina is a placeholder handle, so our page's posts weren't read\./);
    assert.match(call.content,/OUR LIBRARY\nOur library couldn't be read: The library is offline/);
    return hand(call,{...FULL,reactions:[]});
  },()=>stage(context(postFile(),spanish)));
  assert.deepEqual(plain(result.output.worth.traction),{post:SOURCE.post.traction,usual:null,ratio:null,performing:false});
  assert.deepEqual(outside.calls.map(call=>call.handle),["otherpage"],"the placeholder handle isn't read");
});

test("research's hand-in can't claim an origin and no original at once",()=>{
  const seen=new Map(),base={origin:{found:true,url:"https://x.com/OpenAI/status/777",who:"OpenAI",date:null,note:""},fabrication:[],recommendation:{outcome:"proceed",reason:"Traced"}};
  assert.equal(research.handInProblem(base,seen),null);
  assert.match(research.handInProblem({...base,fabrication:[{sign:"no_original",detail:"",sources:[]}]},seen),/no_original can't be a sign/);
  assert.match(research.handInProblem({...base,origin:{...base.origin,who:"",url:null}},seen),/say who first posted or published it/);
  assert.match(research.handInProblem({...base,recommendation:{outcome:"stop",reason:" "}},seen),/Give the reason/);
});

test("search_x keeps to its budget and its dates, and tells the agent why",async()=>{
  const outside=services(),search=research.searchXTool(new Map(),1,{fetch:outside.fetch,now:NOW});
  assert.equal(await search.run({terms:["nothing here"],sort:"Top",since:"2019-01-01",minLikes:100,language:"en"}),
    "No posts in en since 2023-11-09 with at least 100 likes. Try other words, an earlier start or a lower floor. 0 searches left.");
  assert.equal(outside.calls[0].body.start,"2023-11-09","three years back at most");
  await assert.rejects(search.run({terms:["again"],sort:"Top",since:"2026-11-01",minLikes:100,language:"en"}),error=>error instanceof claude.ToolError&&/No X searches left \(1 per run\)/.test(error.message));
  assert.equal(outside.count("x"),1);
  assert.equal(research.searchSince("not a date",NOW.getTime()),"2026-10-09","30 days back without a date");
  assert.equal(research.searchSince("2027-01-01",NOW.getTime()),"2026-11-08","never after today");
  assert.equal(research.daysSince("2026-11-01",NOW.getTime()),7);
  assert.equal(research.daysSince("2026-12-01",NOW.getTime()),0,"a date in the future is today");
  assert.equal(research.daysSince("soon",NOW.getTime()),null);
});

// ── The check ─────────────────────────────────────────────────────────────────
const ORIGIN={found:true,url:"https://x.com/OpenAI/status/777",who:"OpenAI",date:"2026-11-05",note:""};
const NO_ORIGIN={found:false,url:null,who:"",date:null,note:"Only reposts"};
const OWN="Research's own call was to proceed: Traced to OpenAI's own post";
function researched(changes={},worth={}) {
  return {
    quick:false,origin:ORIGIN,surfaces:[{title:"The Verge",url:"https://www.theverge.com/ai/openai-model",independent:true}],facts:[],
    worth:{traction:{post:SOURCE.post.traction,usual:null,ratio:null,performing:false},fresh:{firstSeen:"2026-11-05",ageDays:3,stale:false},saturation:{note:"",saturated:false},covered:{already:false,by:[],note:""},...worth},
    fabrication:[],positions:[],reactions:[],recommendation:{outcome:"proceed",reason:"Traced to OpenAI's own post"},...changes,
  };
}
const decide=(found,options={})=>plain(verdict.decideVerdict(found,{mode:"autopilot",now:NOW.getTime(),...options}));
const sign=(kind,detail,url)=>({sign:kind,detail,sources:url?[{title:kind,url}]:[]});
const STALE={fresh:{firstSeen:"2026-10-01",ageDays:38,stale:true}};

test("the check lets a traced, fresh story through, with research's reason and the original",()=>{
  assert.deepEqual(decide(researched()),{outcome:"proceed",reason:"Traced to OpenAI's own post",evidence:[{title:"OpenAI",url:ORIGIN.url}],answer:null});
});

test("the check stops a debunked story, a satire account's and an untraceable one, whatever research called",()=>{
  const debunked=decide(researched({origin:NO_ORIGIN,fabrication:[sign("debunked","Reuters checked it: the quote is fake.","https://www.reuters.com/fact-check/quote")]}));
  assert.deepEqual(debunked,{outcome:"stop",reason:`It has been debunked: Reuters checked it: the quote is fake. ${OWN}`,evidence:[{title:"debunked",url:"https://www.reuters.com/fact-check/quote"}],answer:null});
  const satire=decide(researched({fabrication:[sign("satire_account","The Onion posted it first","https://x.com/TheOnion/status/1")],recommendation:{outcome:"stop",reason:"It's satire"}}));
  assert.deepEqual([satire.outcome,satire.reason],["stop","It's satire"],"research's own reason when it agrees");
  const untraceable=decide(researched({origin:NO_ORIGIN,surfaces:[],fabrication:[sign("no_original","No post by that account"),sign("lone_quote","Nobody else carries the quote")]}));
  assert.deepEqual([untraceable.outcome,untraceable.reason],["stop",`Untraceable: no original could be found, and its quote has no other source. ${OWN}`]);
  const own=decide(researched({origin:NO_ORIGIN,fabrication:[sign("shifting_numbers","29% in one copy, 40% in another","https://example.com/repost")],recommendation:{outcome:"stop",reason:"The numbers change"}}));
  assert.deepEqual([own.outcome,own.reason,own.evidence],["stop","The numbers change",[{title:"shifting_numbers",url:"https://example.com/repost"}]],"research's own stop stands");
});

test("the check asks when only reposts carry the story, softening research's stop; an independent source lets it through",()=>{
  const repostOnly={origin:NO_ORIGIN,surfaces:[{title:"Another repost",url:"https://www.instagram.com/p/REPOST2/",independent:false}],fabrication:[sign("no_original","Every copy is the same screenshot","https://www.instagram.com/p/REPOST1/")]};
  for(const outcome of ["proceed","ask","stop"]) {
    const check=decide(researched({...repostOnly,recommendation:{outcome,reason:`Research said ${outcome}`}}));
    assert.equal(check.outcome,"ask",`research's ${outcome}`);
    assert.deepEqual(check.evidence,[{title:"no_original",url:"https://www.instagram.com/p/REPOST1/"}]);
  }
  assert.equal(decide(researched({...repostOnly,recommendation:{outcome:"ask",reason:"Only reposts"}})).reason,"Only reposts");
  assert.equal(decide(researched({...repostOnly,recommendation:{outcome:"stop",reason:"No original"}})).reason,
    "Only a repost page's summary carries it, and the search for the original was inconclusive: Every copy is the same screenshot. Research's own call was to stop: No original");
  assert.equal(decide(researched({...repostOnly,surfaces:[{title:"Reuters",url:"https://www.reuters.com/tech/openai",independent:true}]})).outcome,"proceed","reported independently: the missing original alone doesn't ask");
  assert.equal(decide(researched({recommendation:{outcome:"ask",reason:"Only one account has posted it"}})).reason,"Only one account has posted it","research's own ask stands");
});

test("the check stops a stale or saturated story by the page's own limits",()=>{
  const stale=decide(researched({},STALE));
  assert.deepEqual([stale.outcome,stale.reason],["stop",`Old news: it first broke 38 days ago, on 2026-10-01, past this page's limit of 14 days. ${OWN}`]);
  assert.equal(decide(researched({},STALE),{limits:{staleAfterDays:60,saturatedAfterPages:10}}).outcome,"proceed","a page with a longer limit takes it");
  assert.equal(decide(researched({},{fresh:{firstSeen:"2026-10-01",ageDays:null,stale:false}})).outcome,"stop","the age comes from the first-seen date when research didn't count it");
  assert.equal(decide(researched({},{fresh:{firstSeen:null,ageDays:null,stale:false}})).outcome,"proceed","a timeless post has no age");
  assert.match(decide(researched({},{fresh:{firstSeen:null,ageDays:null,stale:true}})).reason,/^Old news: research found it stale\./);
  const saturated=decide(researched({},{saturation:{note:"Posted by 14 other Instagram pages. Every big tech page has it",saturated:true}}));
  assert.deepEqual([saturated.outcome,saturated.reason],["stop",`Saturated: Posted by 14 other Instagram pages. Every big tech page has it. This page's limit is 10 other pages. ${OWN}`]);
});

test("the check asks when our page already covered the story, with what covered it",()=>{
  const covered=decide(researched({},{covered:{already:true,by:[{title:"GPT-6 is here",url:"/admin/engine?design=deck-1"}],note:"Same launch, two days ago"}}));
  assert.deepEqual(covered,{outcome:"ask",reason:`Our page already covered it: GPT-6 is here. Same launch, two days ago. ${OWN}`,evidence:[{title:"OpenAI",url:ORIGIN.url},{title:"GPT-6 is here",url:"/admin/engine?design=deck-1"}],answer:null});
});

test("stop wins over ask; an exact copy's check has no worth rules; the evidence stays short",()=>{
  const both=decide(researched({},{...STALE,covered:{already:true,by:[{title:"Ours",url:"/admin/engine?design=deck-1"}],note:""}}));
  assert.deepEqual([both.outcome,both.reason],["stop",`Old news: it first broke 38 days ago, on 2026-10-01, past this page's limit of 14 days. ${OWN}`]);
  assert.deepEqual(both.evidence,[{title:"OpenAI",url:ORIGIN.url},{title:"Ours",url:"/admin/engine?design=deck-1"}]);
  const worthless={...STALE,covered:{already:true,by:[],note:""},saturation:{note:"",saturated:true}};
  assert.equal(decide(researched({quick:true},worthless),{mode:"exact"}).outcome,"proceed","a quick check goes by the origin and the signs");
  assert.equal(decide(researched({},worthless),{mode:"exact"}).outcome,"proceed","so does any exact copy");
  const many=decide(researched({fabrication:Array.from({length:10},(_,index)=>sign("other",`Odd ${index}`,`https://example.com/${index}`)),recommendation:{outcome:"stop",reason:"Too many odd things"}}));
  assert.equal(many.evidence.length,8);
  assert.deepEqual(many.evidence[0],{title:"OpenAI",url:ORIGIN.url});
});

test("the check's stage reads the page profile's limits",async()=>{
  const file=postFile();
  file.stages.research={status:"done",output:researched({},STALE)};
  assert.equal((await verdict.verdict(context(file))).output.outcome,"stop");
  assert.equal((await verdict.verdict(context(file,{...english,check:{staleAfterDays:60,saturatedAfterPages:10}}))).output.outcome,"proceed");
  assert.deepEqual(plain(profiles.checkLimits({})),{staleAfterDays:14,saturatedAfterPages:10});
  assert.deepEqual(plain(english.check),{staleAfterDays:14,saturatedAfterPages:10});
});

// ── A page's posts, and our library ──────────────────────────────────────────
test("a page's handle comes from @name, name or its profile link",()=>{
  assert.equal(pagePosts.pageHandle("@ChatGPTricks"),"chatgptricks");
  assert.equal(pagePosts.pageHandle("https://www.instagram.com/nasa/?hl=en"),"nasa");
  assert.equal(pagePosts.pageHandle("instagram.com/nasa"),"nasa");
  assert.equal(pagePosts.pageHandle("https://www.instagram.com/p/ABC123/"),null,"a post isn't a page");
  assert.equal(pagePosts.pageHandle("reel"),null);
  assert.equal(pagePosts.pageHandle("two words"),null);
});

test("a scraper item becomes a post with its format and numbers; hidden likes stay unknown",()=>{
  assert.deepEqual(plain(pagePosts.normalizePagePost(igPost("REEL001",{type:"Video",productType:"clips",views:52000,likes:-1,comments:12}))),
    {shortcode:"REEL001",url:"https://www.instagram.com/p/REEL001/",date:daysAgo(1),format:"reel",caption:"Post REEL001",traction:{likes:null,comments:12,views:52000}});
  assert.equal(pagePosts.normalizePagePost(igPost("CARO001",{views:999})).traction.views,null,"only a video's views count");
  assert.equal(pagePosts.normalizePagePost(igPost("PHOTO01",{type:"Image"})).format,"photo");
  assert.equal(pagePosts.normalizePagePost(igPost("VIDEO01",{type:"Video",views:10})).format,"video");
  assert.equal(pagePosts.normalizePagePost({error:"not_found"}),null);
  assert.equal(pagePosts.normalizePagePost({...igPost("PHOTO02"),shortCode:"x"}),null,"no shortcode, no post");
});

test("a page's posts are read once a day, without pinned posts, newest first",async()=>{
  forget();
  const outside=services({pages:{otherpage:SOURCE_PAGE}});
  const [first,second]=await Promise.all([pagePosts.fetchPagePosts("@OtherPage",{fetch:outside.fetch,now:NOW}),pagePosts.fetchPagePosts("otherpage",{fetch:outside.fetch,now:NOW})]);
  assert.equal(outside.count("instagram"),1,"calls made while one runs share it");
  assert.equal(first,second);
  const [call]=outside.calls,query=new URL(call.href).searchParams;
  assert.equal(call.authorization,"Bearer test-token");
  assert.deepEqual([query.get("maxTotalChargeUsd"),query.get("maxItems")],["0.05","15"]);
  assert.deepEqual(call.body,{directUrls:["https://www.instagram.com/otherpage/"],resultsType:"posts",resultsLimit:15,addParentData:false});
  assert.deepEqual(first.posts.map(post=>post.shortcode),["SRC0001",...OTHERS,"OLDEST1"],"the pinned favorite is dropped");
  await pagePosts.fetchPagePosts("otherpage",{fetch:outside.fetch,now:NOW});
  assert.equal(outside.count("instagram"),1,"read once a day");
  await pagePosts.fetchPagePosts("otherpage",{fetch:outside.fetch,now:new Date("2026-11-09T08:00:00.000Z")});
  assert.equal(outside.count("instagram"),2,"and again the next day");
});

test("a page that can't be read says why, and a failure isn't kept",async()=>{
  forget();
  const pages={busy:429,privatepage:[{error:"restricted_page",errorDescription:"This account is private"}]};
  const outside=services({pages}),options={fetch:outside.fetch,now:NOW};
  await assert.rejects(pagePosts.fetchPagePosts("busy",options),error=>error instanceof pagePosts.PagePostsError&&error.status===429&&/rate limiting/.test(error.message));
  pages.busy=SOURCE_PAGE;
  assert.equal((await pagePosts.fetchPagePosts("busy",options)).posts.length,14,"the next call tries again");
  await assert.rejects(pagePosts.fetchPagePosts("privatepage",options),/@privatepage is private/);
  await assert.rejects(pagePosts.fetchPagePosts("nobody",options),/Instagram sent no posts for @nobody/);
  await assert.rejects(pagePosts.fetchPagePosts("https://www.instagram.com/p/ABC123/",options),/isn't an Instagram handle/);
  const token=environment.env.APIFY_TOKEN;
  delete environment.env.APIFY_TOKEN;
  try{await assert.rejects(pagePosts.fetchPagePosts("otherpage",options),error=>error.status===503&&/needs APIFY_TOKEN/.test(error.message));}
  finally{environment.env.APIFY_TOKEN=token;}
});

test("one caller stopping never stops a page read others share",async()=>{
  forget();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const outside=services({pages:{otherpage:SOURCE_PAGE}}),slow=async(url,init)=>{await gate;return outside.fetch(url,init);};
  const controller=new AbortController();
  const stopped=pagePosts.fetchPagePosts("otherpage",{fetch:slow,now:NOW,signal:controller.signal});
  const waiting=pagePosts.fetchPagePosts("otherpage",{fetch:slow,now:NOW});
  controller.abort(new Error("The person stopped the run"));
  await assert.rejects(stopped,/The person stopped the run/);
  release();
  assert.equal((await waiting).posts.length,14);
  assert.equal(outside.count("instagram"),1);
});

test("traction: a post against the median of its page's last 12 posts, without itself; a reel by its views",()=>{
  const page=SOURCE_PAGE.filter(item=>!item.isPinned).map(pagePosts.normalizePagePost);
  assert.deepEqual(plain(pagePosts.compareTraction({shortcode:"SRC0001",format:"carousel",traction:{likes:4000,comments:0,views:null}},page,"@otherpage")),{
    post:{likes:4000,comments:0,views:null},usual:{likes:1550,comments:50,views:null},ratio:2.5,performing:true,basis:"likes and comments",compared:12,
    note:"4,000 likes and comments against a median of 1,600 over @otherpage's last 12 posts: 2.5×, performing (1.5× or more performs)",
  },"the post itself and the 13th post back are left out");
  const at=likes=>pagePosts.compareTraction({format:"photo",traction:{likes,comments:0,views:null}},page.slice(1,13));
  assert.deepEqual([at(2400).ratio,at(2400).performing],[1.5,true],"1.5 times the median performs");
  assert.deepEqual([at(2380).ratio,at(2380).performing],[1.49,false]);
  const reels=[10000,12000,14000,16000,18000].map((views,index)=>pagePosts.normalizePagePost(igPost(`REEL0${index+1}`,{type:"Video",productType:"clips",views,likes:500,comments:20,days:index+1})));
  const reel=pagePosts.compareTraction({format:"reel",traction:{likes:900,comments:10,views:30000}},[...reels,...page.slice(1,4)],"@reels");
  assert.deepEqual([reel.basis,reel.ratio,reel.performing,reel.compared,reel.usual.views],["views",2.14,true,5,14000]);
  const few=pagePosts.compareTraction({format:"reel",traction:{likes:900,comments:10,views:30000}},[...reels.slice(0,2),...page.slice(1,4)]);
  assert.deepEqual([few.basis,few.ratio],["likes and comments",0.87],"fewer than 3 of the page's posts show views: likes and comments");
  const hidden=pagePosts.compareTraction({format:"photo",traction:{likes:null,comments:10,views:null}},page);
  assert.deepEqual([hidden.ratio,hidden.performing,hidden.note],[null,false,"Not compared: the post's likes aren't shown"]);
  assert.match(pagePosts.compareTraction({format:"photo",traction:{likes:10,comments:0,views:null}},page.slice(0,2),"@tiny").note,/^Not compared: fewer than 3 of @tiny's last posts show their likes and comments/);
  assert.deepEqual([pagePosts.median([3,1,2]),pagePosts.median([4,1,3,2]),pagePosts.median([])],[2,2.5,null]);
});

test("our library: the workspace's decks, newest first, with the page each was made for and its story",async()=>{
  const FILE_ID="post-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  const text=(value,y,extra={})=>({type:"text",text:value,y,...extra});
  const deck=(id,updatedAt,extra={})=>({id,name:`Deck ${id}`,createdAt:"2026-10-01T00:00:00.000Z",updatedAt,caption:"",comments:[],tags:[],pages:[{canvas:{elements:[]}}],...extra});
  const designs=[
    deck("old","2026-10-20T00:00:00.000Z",{tags:["chatgptricks"]}),
    deck("new","2026-11-07T10:00:00.000Z",{caption:"OpenAI shipped it.\n\nSource: OpenAI",comments:[{text:`Made by Recreate from ${FILE_ID}`}],
      pages:[{canvas:{elements:[text("OpenAI's new model",300),text("GPT-6 IS HERE",100),text("@chatgptricks",40,{templateRole:"brand"}),text("Draft",10,{hidden:true})]}}]}),
    deck("gone","2026-11-08T00:00:00.000Z",{deletedAt:"2026-11-08T01:00:00.000Z"}),
    deck("layout","2026-11-08T00:00:00.000Z",{purpose:"template"}),
  ];
  const reads=[];
  const decks=await pagePosts.ourLibrary("owner-x","chatgptricks",{designs,readPostFile:async(ownerKey,id)=>{
    reads.push([ownerKey,id]);
    return {profileId:"chatgptricks",stages:{brief:{status:"done",output:{topic:"OpenAI's GPT-6 launch"}}}};
  }});
  assert.deepEqual(plain(decks),[
    {id:"new",name:"Deck new",date:"2026-11-07",page:"chatgptricks",cover:"GPT-6 IS HERE · OpenAI's new model",caption:"OpenAI shipped it. Source: OpenAI",story:"OpenAI's GPT-6 launch",url:"/admin/engine?design=new"},
    {id:"old",name:"Deck old",date:"2026-10-20",page:"chatgptricks",cover:"",caption:"",story:"",url:"/admin/engine?design=old"},
  ],"deleted decks and saved layouts aren't posts");
  assert.deepEqual(reads,[["owner-x",FILE_ID]]);
});
