/* Run: node --test tests/template-editor-recreate-design.test.mjs
 * The design stage (lib/engine/agents/stages/design.ts) and the designer's
 * tools (design-tools.ts, cut.ts). A stand-in designer drives the real tools:
 * it builds the deck from the template's pages, cuts photos out of the
 * original's slides, draws a chart from chart_data in an HTML layer, reads a
 * post from X into a post card, looks at the slides and hands the deck in.
 * Both modes are built from stored stage outputs. The saved deck holds no data:
 * URLs but the template's own artwork, and its HTML only the brand's
 * variables. A fix round edits the same deck. Claude and Chromium are
 * stand-ins; the deck and its images are saved for real, in local development
 * storage only. */
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-design-test-"));
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

const {design}=load("lib/engine/agents/stages/design.ts");
const tools=load("lib/engine/agents/design-tools.ts");
const claude=load("lib/engine/agents/claude.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const render=load("lib/engine/slide-render.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const model=load("lib/template-editor/model.ts");
const stored=load("lib/template-editor/stored-images.ts");
const media=load("lib/template-editor/media-storage.ts");
const htmlLayer=load("lib/template-editor/html-layer.ts");
const profiles=load("lib/engine/page-profiles.ts");
const seed=load("lib/template-editor/brand-guide-seed.ts");
const persistence=load("lib/template-editor/persistence.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const guide=seed.builtInBrandGuide("chatgptricks");
const tokens=htmlLayer.htmlTokensForGuide(guide);
const catalog=pagesLib.templatePages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media"),FOLLOW=pageIndex("Follow"),REACTION=catalog.find(page=>page.cards===1).index;
const ASSET=/^\/api\/template-editor\/assets\/([a-f0-9]{64})$/;
let owners=0;
const owner=()=>`owner-design-${++owners}`;

// A slide like an Instagram one: a dark background with a busy picture in a known box (on the 0-1000 grid).
const PICTURE={x:100,y:300,width:800,height:500};
async function slideImage() {
  const width=1080,height=1350,data=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*3,inside=x>=108&&x<972&&y>=405&&y<1080,noise=((x*73856093)^(y*19349663))>>>0;
    data[at]=inside?60+noise%160:16;data[at+1]=inside?60+(noise>>>8)%160:20;data[at+2]=inside?60+(noise>>>16)%160:24;
  }
  const png=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  return {mediaType:"image/png",base64:png.toString("base64")};
}

const HEADLINE="SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED WHILE US JOB OPENINGS FELL ALMOST 30%";
const templateNotes={
  cover:{layout:"A chart fills the top, the headline under it",headline:{text:HEADLINE,casing:"upper",lines:[HEADLINE],weight:"bold",highlighted:["STOCKS"]},subject:{kind:"none",what:"",position:"",size:""},background:"Dark",insets:[]},
  branding:["@thepage handle in the corner"],
  slides:[{index:1,role:"cover",layout:"chart, then headline"},{index:2,role:"text",layout:"title, body, photo"},{index:3,role:"post",layout:"a post from X"},{index:4,role:"follow",layout:"follow line"}],
  avoid:["The original page's handle"],
};
/** What the source stage hands in for a short AI vs Jobs post: a chart cover, a slide with a photo, a post from X and a follow slide. */
const sourceNotes={
  post:{author:{handle:"thepage",name:"The Page"},format:"carousel",date:"2025-04-01",caption:"Stocks up, jobs down.\n\nSource: FRED",url:"https://www.instagram.com/p/TEST/",traction:{likes:12000,comments:300,views:null}},
  originalLanguage:"en",shows:"A chart of job openings and the S&P 500, a trader, a post from X",claims:"Stocks nearly doubled since ChatGPT while job openings fell",mismatch:"",
  template:templateNotes,
  slides:[
    {index:1,role:"cover",texts:[{role:"headline",text:HEADLINE}],parts:[{kind:"chart",box:{x:60,y:60,width:880,height:560},what:"US job openings (FRED JTSJOL, left scale 0-15M) and the S&P 500 (right scale 0-6,000), 2003-2025, ChatGPT's release marked",text:"Job Openings · S&P 500 · ChatGPT released",post:null}]},
    {index:2,role:"text",texts:[{role:"title",text:"AI vs Jobs"},{role:"body",text:"Since ChatGPT came out, stocks went up\nand job openings went down"},{role:"source",text:"Source: FRED"}],parts:[{kind:"photo",box:PICTURE,what:"A trader at a screen",text:"",post:null}]},
    {index:3,role:"post",texts:[],parts:[{kind:"x_post",box:{x:60,y:200,width:880,height:600},what:"A post by @sama",text:"jobs are going to change a lot",post:{name:"Sam Altman",handle:"sama",badge:"blue",square:false,date:"2025-03-01",link:null,avatar:{x:100,y:300,width:200,height:200},photo:null}}]},
    {index:4,role:"follow",texts:[{role:"headline",text:"FOLLOW FOR MORE"}],parts:[]},
  ],
  notes:[],
};
const done=output=>({status:"done",output});
const fileFor=(mode,stages)=>({id:`post-design-${mode}`,version:2,profileId:"chatgptricks",mode,status:"running",message:"",source:{url:"https://www.instagram.com/p/TEST/",caption:sourceNotes.post.caption,imageIds:[],slideCount:4},stages,history:[]});

async function contextFor(mode,stages,extra={}) {
  const images=await Promise.all([1,2,3,4].map(()=>slideImage()));
  return {
    ownerKey:owner(),file:fileFor(mode,stages),profile:english,template,templates:model.BUILT_IN_TEMPLATES,guide,
    signal:new AbortController().signal,usage:new claude.UsageMeter(),cache:{images,chartData:new Map()},round:0,...extra,
  };
}

/** Claude's designer and Chromium stood in: `designer` drives the real tools; every slide renders dark. */
async function stand(designer,run) {
  const real={work:claude.work,renderSlides:render.renderSlides},calls=[],renders=[];
  const png=await sharp({create:{width:1080,height:1440,channels:3,background:"#0B1014"}}).png().toBuffer();
  render.renderSlides=async(document,options)=>{renders.push(options.pageIds);return options.pageIds.map(pageId=>({pageId,png}));};
  claude.work=async call=>{
    calls.push(call);
    assert.equal(call.role,"designer");
    const tool=name=>{const found=call.tools.find(item=>item.name===name);assert.ok(found,`no ${name} tool`);return found;};
    // As work() does: the input is checked against the tool's schema, then the tool runs.
    const invoke=async(name,input)=>tool(name).run(tool(name).schema.parse(input));
    const refused=async(name,input,pattern)=>{
      await assert.rejects(()=>invoke(name,input),error=>error instanceof claude.ToolError&&pattern.test(error.message),`${name} should refuse: ${pattern}`);
    };
    return designer({call,tool,invoke,refused,json:async(name,input)=>JSON.parse(await invoke(name,input))});
  };
  try { return await run({calls,renders}); } finally { claude.work=real.work; render.renderSlides=real.renderSlides; }
}
const layer=(deck,slide,slot)=>deck.slides[slide-1].layers.find(item=>item.slot===slot);
const textOf=call=>call.content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
const chartSvg=(chart,width,height)=>`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Job openings and the S&amp;P 500 since 2003">${chart.scales.left.ticks.map(tick=>`<line class="grid" x1="0" x2="${width}" y1="${tick.y}" y2="${tick.y}"/>`).join("")}${chart.series.map((line,index)=>`<path class="line line-${index}" d="${line.path}"/>`).join("")}</svg>`;
const CHART_CSS=".grid{stroke:color-mix(in srgb, var(--color-text) 20%, transparent);stroke-width:2}.line{fill:none;stroke-width:6}.line-0{stroke:var(--color-accent)}.line-1{stroke:var(--color-secondary)}text{fill:var(--color-text);font-family:var(--body-font);font-size:var(--min-text-size)}";
const without=(object,...keys)=>Object.fromEntries(Object.entries(object).filter(([key])=>!keys.includes(key)));
const leftovers=deck=>{const keep=stored.imagesToKeep(template);return [...stored.embeddedImages(deck)].filter(url=>!keep.has(url));};

/** The chart an exact copy rebuilds: typed values here, so the test needs no network; two scales, as the original prints them. */
const exactChart={
  kind:"line",unit:"K",labels:["2003","","2008","","2013","","2020","","2025"],
  series:[
    {name:"Job openings",source:"typed",fred:null,values:[3600,4400,3100,3800,4600,6900,12000,9000,7600],emphasis:true,axis:"left"},
    {name:"S&P 500",source:"typed",fred:null,values:[900,1300,900,1700,2100,2800,3800,4500,5600],emphasis:false,axis:"right"},
  ],
  from:null,to:null,markerDate:null,indexToMarker:false,markerIndex:6,markerLabel:"ChatGPT released",markerIcon:"openai",endLabel:"none",
  markers:[],band:null,highlight:[],range:{min:0,max:15000},right:{unit:"",range:{min:0,max:6000}},
};

test("placeChart puts each scale's ticks, the lines and the marker in the designer's box",()=>{
  const chart=tools.placeChart(load("lib/engine/recreate-chart.ts").validateChart({...exactChart,series:exactChart.series.map(line=>without(line,"source","fred"))}),900,600);
  assert.deepEqual(chart.scales.left.ticks.map(tick=>tick.label),["0","5M","10M","15M"],"thousands of openings print as millions");
  assert.deepEqual(chart.scales.left.ticks.map(tick=>tick.y),[600,400,200,0]);
  assert.deepEqual(chart.scales.right.ticks.map(tick=>tick.label),["0","2,000","4,000","6,000"],"the second scale keeps its printed range");
  assert.equal(chart.series.length,2);
  assert.match(chart.series[0].path,/^M0 \d+(\.\d)?L/);
  assert.equal(chart.series[0].end.x,900);
  assert.equal(chart.series[1].axis,"right");
  assert.equal(chart.markers[0].x,675,"the marker sits at its point");
  assert.equal(chart.markers[0].at.length,2);
  assert.deepEqual(chart.x.map(label=>label.label),["2003","2008","2013","2020","2025"]);
  const gap=tools.placeChart({unit:"",labels:[],series:[{name:"a",values:[1,2,Number.NaN,4,5],emphasis:true}],markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value"},400,100);
  assert.equal(gap.series[0].path.match(/M/g).length,2,"a missing period breaks the line");
  const bars=tools.placeChart(load("lib/engine/recreate-chart.ts").validateChart({kind:"bar",unit:"%",labels:["A","B","C"],series:[{name:"Share",values:[10,40,25],emphasis:true}],markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",highlight:[1]}),600,300);
  assert.equal(bars.bars.length,3);
  assert.deepEqual(bars.bars.map(bar=>bar.highlight),[false,true,false]);
  assert.equal(bars.bars[1].y,0,"the tallest bar reaches the top of the scale");
});

test("HTML layers keep to the brand's variables: written colors and unknown variables are caught",()=>{
  assert.deepEqual(tools.offBrand('<svg><path style="stroke: var(--color-accent)" d="M0 0"/></svg>',".a{fill:var(--color-text);border:1px solid color-mix(in srgb, var(--color-text) 20%, transparent)}",tokens),[]);
  assert.deepEqual(tools.offBrand('<div class="x"><svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg></div>',":root{--line:var(--color-accent)}.x{color:var(--line)}",tokens),[],"a layer may name its own variables from the brand's, and point to its own gradients");
  assert.equal(tools.offBrand('<div style="color:#FF0000">x</div>',"",tokens).length,1);
  assert.match(tools.offBrand("<p>x</p>","p{color:white}",tokens)[0],/writes the color white/);
  assert.match(tools.offBrand('<svg><rect fill="rgb(0, 0, 0)"/></svg>',"",tokens)[0],/rgb\(\)/);
  assert.match(tools.offBrand("<p>x</p>","p{color:var(--color-made-up)}",tokens)[0],/isn't one of the brand's variables/);
  assert.match(tools.offBrand("<style>p{background:#0B1014}</style><p>x</p>","",tokens)[0],/#0B1014/,"style blocks are read too");
  assert.deepEqual(tools.offBrand("<p>x</p>","p{font-family:var(--title-font);white-space:nowrap;text-transform:var(--title-case)}",tokens),[],"words that only look like colors don't count");
});

test("an exact copy rebuilds every slide in the template, with stored images and brand variables only",async()=>{
  const context=await contextFor("exact",{source:done(sourceNotes),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null})});
  await stand(async({call,tool,invoke,refused,json})=>{
    assert.match(call.system,/exact copy/);
    assert.match(call.system,/Page \d+ · Text \+ Media/,"the template's pages are listed");
    assert.match(call.system,/--color-accent: #00D98A/i,"the brand's variables are listed");
    assert.equal(call.content.filter(block=>block.type==="image").length,4,"the designer sees every original slide");
    assert.ok("right" in tool("chart_data").schema.shape.chart.shape,"an exact copy's chart may keep two scales");
    assert.ok(!call.tools.some(item=>item.name==="find_photos"),"an exact copy's photos are only cut from the original");
    // A post on the original slide becomes our post card; X search isn't set up here, so it is built from the screenshot.
    const post=await json("x_post",{handle:"sama",name:"Sam Altman",text:"jobs are going to change a lot",badge:"blue",square:false,date:"2025-03-01",slide:3,avatar:{x:100,y:300,width:200,height:200}});
    assert.equal(post.found,false);
    assert.match(post.avatar,ASSET,"its profile photo, cut from the screenshot, is a workspace file");
    const built=await json("create_deck",{name:"AI vs Jobs",caption:sourceNotes.post.caption,slides:[
      {templatePage:COVER,slots:{"cover-headline":"SINCE CHATGPT CAME OUT, [[STOCKS]] NEARLY DOUBLED WHILE US JOB OPENINGS FELL ALMOST 30%"}},
      {templatePage:MEDIA,slots:{title:"AI vs Jobs",body:"Since ChatGPT came out, stocks went up\nand job openings went down",source:"Source: FRED"}},
      {templatePage:REACTION,slots:{},posts:[post.id]},
      {templatePage:FOLLOW,slots:{cta:"FOR MORE"}},
    ]});
    assert.equal(built.deck.slides.length,4);
    await refused("create_deck",{name:"x",caption:"",slides:[{templatePage:MEDIA,slots:{media:"https://example.com/a.jpg"}}]},/isn't an image your tools gave you/);
    const cut=await json("cut_from_source",{slide:2,box:{x:80,y:280,width:840,height:540},kind:"photo",what:"A trader at a screen"});
    assert.match(cut.src,ASSET);
    assert.ok(Math.abs(cut.box.x-PICTURE.x)<=12&&Math.abs(cut.box.width-PICTURE.width)<=24,"the box snaps to the picture's edges");
    await refused("cut_from_source",{slide:9,box:PICTURE,kind:"photo",what:"x"},/The original has 4 slides/);
    const chart=await json("chart_data",{chart:exactChart,width:936,height:700});
    assert.equal(chart.scales.right.ticks.at(-1).label,"6,000");
    const coverPhoto=layer(built.deck,1,"photo"),mediaFrame=layer(built.deck,2,"media");
    // Colors written out, data: images and images no tool gave are refused, and nothing changes.
    await refused("edit_deck",{operations:[{op:"add_html",pageId:built.deck.slides[0].pageId,replaces:coverPhoto.id,html:'<svg><rect fill="#FF0000" width="10" height="10"/></svg>'}]},/writes the color #FF0000/);
    await refused("edit_deck",{operations:[{op:"add_html",pageId:built.deck.slides[0].pageId,html:'<img src="data:image/png;base64,iVBORw0KGgo=">'}]},/can't hold data: images/);
    await refused("edit_deck",{operations:[{op:"update_element",pageId:built.deck.slides[1].pageId,elementId:mediaFrame.id,properties:{src:`/api/template-editor/assets/${"a".repeat(64)}`}}]},/isn't an image your tools gave you/);
    const edited=await json("edit_deck",{operations:[
      {op:"add_html",pageId:built.deck.slides[0].pageId,replaces:coverPhoto.id,name:"Chart",html:chartSvg(chart,936,700),css:CHART_CSS},
      {op:"update_element",pageId:built.deck.slides[1].pageId,elementId:mediaFrame.id,properties:{src:cut.src,intrinsicWidth:cut.width,intrinsicHeight:cut.height}},
    ]});
    assert.deepEqual(edited.deck.slides.map(slide=>slide.slide),[1,2],"the result shows the slides it changed");
    const handIn={pages:[{slide:1,layout:"Cover"},{slide:2,layout:"Text + Media"},{slide:3,layout:"Reaction"},{slide:4,layout:"Follow"}],notes:[]};
    assert.match(await call.submit.check(handIn),/Look at slides 1, 2, 3, 4 with look_at_slides first/);
    const seen=await invoke("look_at_slides",{slides:[1,2,3,4]});
    assert.equal(seen.filter(block=>block.type==="image").length,4,"look_at_slides shows the slides as pictures");
    assert.match(await call.submit.check({...handIn,pages:handIn.pages.slice(1)}),/The deck has 4 slides/);
    assert.match(await call.submit.check({...handIn,pages:[...handIn.pages.slice(0,3),{slide:5,layout:"Follow"}]}),/only 4 slides to rebuild/);
    assert.equal(await call.submit.check(handIn),null);
    return handIn;
  },async({calls,renders})=>{
    const {output}=await design(context);
    assert.equal(calls.length,1);
    assert.equal(renders.length,1);
    assert.equal(output.slideCount,4);
    assert.deepEqual(output.pages.map(page=>page.slide),[1,2,3,4]);
    assert.equal(output.held,"");
    const deck=await deckLib.loadDeck(context.ownerKey,output.deckId);
    assert.deepEqual(output.pages.map(page=>page.pageId),deck.pages.map(page=>page.id));
    assert.deepEqual(leftovers(deck),[],"no data: URLs but the template's own artwork");
    const elements=index=>deck.pages[index].canvas.elements;
    const headline=elements(0).find(item=>item.slot==="cover-headline");
    assert.equal(headline.type,"text","the headline stays a native text layer");
    assert.equal(headline.text,HEADLINE);
    assert.match(headline.richText,/<span style="color: #00D98A">STOCKS<\/span>/i);
    const html=elements(0).filter(item=>item.type==="html");
    assert.equal(html.length,1);
    assert.deepEqual(tools.offBrand(html[0].html,html[0].css,html[0].tokens),[],"the HTML uses the brand's variables only");
    assert.equal(html[0].tokens["--color-accent"],tokens["--color-accent"],"the layer carries the brand's variables");
    assert.equal(elements(0).find(item=>item.slot==="photo").hidden,true,"the chart takes the cover photo frame's place");
    const photo=elements(1).find(item=>item.slot==="media");
    const [,id]=photo.src.match(ASSET);
    assert.ok(await media.hasOriginalAsset(context.ownerKey,id),"the cut is a stored media file");
    assert.equal(elements(1).find(item=>item.slot==="title").text,"AI vs Jobs");
    const card=elements(2);
    assert.equal(card.find(item=>item.slot==="reaction-handle").text,"@sama");
    assert.match(card.find(item=>item.slot==="reaction-avatar").src,ASSET);
    assert.equal(card.find(item=>item.slot==="title").text,"","a slot the copy leaves out is emptied");
    assert.equal(elements(3).find(item=>item.slot==="cta").text,"FOR MORE");
    assert.equal(deck.caption,sourceNotes.post.caption);
    assert.ok(deck.comments.some(comment=>/Cut from the original's slide 2/.test(comment.text)),"the deck's notes say what was cut");
    assert.ok(deck.tags.includes("recreated"));

    // A fix round opens the same deck and edits it.
    const fix={...context,round:1,instructions:"Slide 2 (must fix): the title should say AI vs Jobs: the data. Fix: change the title",previous:output};
    await stand(async({call,invoke,json})=>{
      const words=textOf(call);
      assert.match(words,/FIX THIS/);
      const view=JSON.parse(words.slice(words.indexOf("It is now:\n")+"It is now:\n".length).split("\n")[0]);
      const title=layer(view,2,"title");
      await json("edit_deck",{operations:[{op:"update_element",pageId:view.slides[1].pageId,elementId:title.id,properties:{text:"AI vs Jobs: the data"}}]});
      const handIn={pages:output.pages.map(({slide,layout})=>({slide,layout})),notes:["Changed slide 2's title."]};
      assert.match(await call.submit.check(handIn),/Look at slide 2 with look_at_slides first/);
      await invoke("look_at_slides",{slides:[2]});
      assert.equal(await call.submit.check(handIn),null);
      return handIn;
    },async()=>{
      const {output:again}=await design(fix);
      assert.equal(again.deckId,output.deckId,"the fix saves over the same deck");
      const fixed=await deckLib.loadDeck(context.ownerKey,again.deckId);
      assert.equal(fixed.pages[1].canvas.elements.find(item=>item.slot==="title").text,"AI vs Jobs: the data");
      assert.equal(fixed.pages[0].canvas.elements.filter(item=>item.type==="html").length,1,"the rest stays as it was");
      assert.ok(fixed.comments.some(comment=>/Fix round 1/.test(comment.text)));
      const {library}=await persistence.getEditorLibrary(context.ownerKey);
      assert.equal(library.designs.filter(item=>item.name.startsWith("AI vs Jobs")).length,1,"no copy is made");
    });
  });
});

const research={
  quick:false,origin:{found:true,url:"https://fred.stlouisfed.org/series/JTSJOL",who:"U.S. Bureau of Labor Statistics",date:null,note:"The data is FRED's"},surfaces:[],
  facts:[{claim:"US job openings fell from 12.1M in March 2022 to 7.6M in early 2025",label:"confirmed",detail:"FRED JTSJOL",correction:"",sources:[{title:"FRED",url:"https://fred.stlouisfed.org/series/JTSJOL"}]}],
  worth:{traction:{post:{likes:12000,comments:300,views:null},usual:null,ratio:null,performing:true},fresh:{firstSeen:null,ageDays:null,stale:false},saturation:{note:"",saturated:false},covered:{already:false,by:[],note:""}},
  fabrication:[],positions:[],reactions:[],recommendation:{outcome:"proceed",reason:"Real data"},
};
const plan={slides:[
  {kind:"cover",purpose:"The headline over the chart",points:["Job openings fell 37% from their 2022 peak"],original:1,chart:"US job openings and the S&P 500 since 2003, indexed to 100 at ChatGPT's release",reactionIds:[],photo:""},
  {kind:"original",purpose:"What the chart shows",points:["Openings fell from 12.1M to 7.6M"],original:2,chart:"",reactionIds:[],photo:"The original's photo of a trader"},
  {kind:"follow",purpose:"Follow",points:[],original:4,chart:"",reactionIds:[],photo:""},
],why:"Short"};
const brief={
  topic:"Job openings fell while stocks rose",angle:"The chart mixes two stories",originalHeadline:HEADLINE,whatHappened:"Openings fell from their 2022 peak",backstory:"Rates went up",positions:[],
  guardrails:{alleged:[],numbers:["Job openings 7.6M in early 2025 (FRED JTSJOL)"],names:[],warnings:[]},template:templateNotes,links:[{title:"FRED",url:"https://fred.stlouisfed.org/series/JTSJOL"}],
  slides:plan.slides,why:"Short",
};
const APPROVED="AI DIDN'T TAKE THE JOBS. RATES DID";

test("a full recreation builds the approved plan with the approved headline, on one scale",async()=>{
  const context=await contextFor("autopilot",{
    source:done(sourceNotes),research:done(research),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null}),brief:done(brief),
    approval:done({plan,headline:{text:APPROVED,option:0},notes:""}),
  });
  await stand(async({call,tool,invoke,json})=>{
    assert.match(call.system,/This full recreation/);
    assert.match(textOf(call),new RegExp(APPROVED));
    assert.ok(!("right" in tool("chart_data").schema.shape.chart.shape),"a full recreation's chart has one scale");
    assert.ok(call.tools.some(item=>item.name==="find_photos"));
    const first=call.content[0].text,inputs=JSON.parse(first.slice(first.indexOf("\n")+1));
    assert.equal(inputs.plan.slides.length,3);
    assert.equal(inputs.brief.slides,undefined,"only the approved plan is given, not the brief's proposal");
    const cut=await json("cut_from_source",{slide:2,box:PICTURE,kind:"photo",what:"A trader at a screen"});
    const oneScale=without(exactChart,"range","right");
    const chart=await json("chart_data",{chart:{...oneScale,unit:"index",indexToMarker:true,series:oneScale.series.map(line=>without(line,"axis"))},width:936,height:700});
    assert.equal(chart.scales.right,undefined);
    const built=await json("create_deck",{name:"AI vs Jobs: the data",caption:"Job openings fell as rates rose.",slides:[
      {templatePage:COVER,slots:{"cover-headline":"AI DIDN'T TAKE THE JOBS. [[RATES]] DID"}},
      {templatePage:MEDIA,slots:{title:"What the chart shows",body:"Openings fell from 12.1M to 7.6M",source:"Source: FRED JTSJOL",media:cut.src}},
      {templatePage:FOLLOW,slots:{cta:"FOR THE REAL NUMBERS"}},
    ]});
    await invoke("edit_deck",{operations:[{op:"add_html",pageId:built.deck.slides[0].pageId,replaces:layer(built.deck,1,"photo").id,html:chartSvg(chart,936,700),css:CHART_CSS}]});
    await invoke("look_at_slides",{slides:[1,2,3]});
    const handIn={pages:[{slide:1,layout:"Cover with a chart"},{slide:2,layout:"Text + Media"},{slide:3,layout:"Follow"}],notes:["The cover chart indexes both lines to 100 at ChatGPT's release."]};
    assert.equal(await call.submit.check(handIn),null);
    return handIn;
  },async()=>{
    const {output}=await design(context);
    assert.equal(output.slideCount,3);
    assert.equal(output.caption,"Job openings fell as rates rose.");
    assert.ok(output.notes.includes("The cover chart indexes both lines to 100 at ChatGPT's release."));
    const deck=await deckLib.loadDeck(context.ownerKey,output.deckId);
    assert.deepEqual(leftovers(deck),[]);
    assert.equal(deck.pages[0].canvas.elements.find(item=>item.slot==="cover-headline").text,APPROVED);
    const photo=deck.pages[1].canvas.elements.find(item=>item.slot==="media");
    assert.match(photo.src,ASSET,"a photo slot filled in create_deck takes the stored cut");
    assert.equal(photo.publicAlt,"A trader at a screen");
    assert.ok(photo.intrinsicWidth>0&&photo.intrinsicHeight>0);
    for(const page of deck.pages)for(const element of page.canvas.elements)if(element.type==="html")assert.deepEqual(tools.offBrand(element.html,element.css,element.tokens),[]);
  });
});

test("slide 1 is built on the Cover page, or the deck isn't handed in",async()=>{
  const context=await contextFor("autopilot",{
    source:done(sourceNotes),research:done(research),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null}),brief:done(brief),
    approval:done({plan,headline:{text:APPROVED,option:0},notes:""}),
  });
  const handIn={pages:[{slide:1,layout:"Cover"},{slide:2,layout:"Text + Media"},{slide:3,layout:"Follow"}],notes:[]};
  await stand(async({call,invoke,json})=>{
    const build=async first=>{
      await json("create_deck",{name:"AI vs Jobs",caption:"Openings fell as rates rose.",slides:[first,{templatePage:MEDIA,slots:{title:"What the chart shows"}},{templatePage:FOLLOW,slots:{cta:"FOR MORE"}}]});
      await invoke("look_at_slides",{slides:[1,2,3]});
    };
    await build({templatePage:MEDIA,slots:{title:APPROVED}});
    assert.match(await call.submit.check(handIn),new RegExp(`Slide 1 is the post's cover: build it on the Cover page \\(templatePage ${COVER}\\)`));
    await build({templatePage:COVER,slots:{"cover-headline":APPROVED}});
    assert.equal(await call.submit.check(handIn),null);
    return handIn;
  },async()=>{
    const {output}=await design(context);
    assert.deepEqual(output.pages.map(page=>page.layout),["Cover","Text + Media","Follow"]);
  });
});

/** The designer's tools on a session of their own, with `fetch` standing in for the web. */
async function photoSession(fetch) {
  const session=tools.designSession({ownerKey:owner(),mode:"exact",profile:english,template,templates:model.BUILT_IN_TEMPLATES,guide,tokens,slides:[],caption:"",chartData:new Map(),signal:new AbortController().signal,deckId:"recreate-photo-test",fetch});
  const invoke=(name,input)=>{const tool=tools.designTools(session).find(item=>item.name===name);return tool.run(tool.schema.parse(input));};
  const built=JSON.parse(await invoke("create_deck",{name:"Photos",caption:"",slides:[{templatePage:MEDIA,slots:{title:"A photo"}}]}));
  const place=src=>invoke("edit_deck",{operations:[{op:"update_element",pageId:built.deck.slides[0].pageId,elementId:layer(built.deck,1,"media").id,properties:{src}}]});
  return {session,place};
}
const FOUND="https://example.com/photos/fed.jpg";

test("a photo found online is stored as a workspace file, and its credit goes in the deck's notes while it's in the deck",async()=>{
  const photo=background=>sharp({create:{width:640,height:480,channels:3,background}}).jpeg().toBuffer();
  const [fed,eccles]=await Promise.all([photo("#336699"),photo("#996633")]);
  const OTHER="https://example.com/photos/eccles.jpg",requests=[];
  const {session,place}=await photoSession(async(url,init)=>{
    requests.push(String(url));
    assert.equal(init.redirect,"manual","each redirect is followed by hand");
    if(String(url)===FOUND)return new Response(null,{status:301,headers:{location:"/photos/fed-large.jpg"}});
    return new Response(String(url)===OTHER?eccles:fed,{headers:{"content-type":"image/jpeg"}});
  });
  session.found.set(FOUND,{width:640,height:480,what:"The Federal Reserve building",credit:"Jane Doe via Example"});
  session.found.set(OTHER,{width:640,height:480,what:"The Eccles Building",credit:"John Roe via Elsewhere"});
  await place(FOUND);
  assert.deepEqual(requests,[FOUND,"https://example.com/photos/fed-large.jpg"],"a redirect on a public site is followed");
  const src=session.document.pages[0].canvas.elements.find(item=>item.slot==="media").src;
  assert.match(src,ASSET);
  assert.ok(await media.hasOriginalAsset(session.ownerKey,src.match(ASSET)[1]));
  assert.deepEqual(tools.creditsFor(session,session.document),["Photo: Jane Doe via Example"]);
  await place(OTHER);
  assert.deepEqual(tools.creditsFor(session,session.document),["Photo: John Roe via Elsewhere"],"a photo the designer replaced isn't credited");
});

test("a template text slot left without words is hidden, and shows again once it's given words",async()=>{
  const {session}=await photoSession(async()=>{throw new Error("no network in this test");});
  const invoke=(name,input)=>{const tool=tools.designTools(session).find(item=>item.name===name);return tool.run(tool.schema.parse(input));};
  // Slots left out of create_deck are emptied: an empty list slot would still draw its bullet.
  await invoke("create_deck",{name:"Lists",caption:"",slides:[{templatePage:pageIndex("List"),slots:{title:"Two lists","list-left-heading":"Risk","list-left-items":"Management\nLegal"}}]});
  const page=session.document.pages[0],slot=name=>session.document.pages[0].canvas.elements.find(item=>item.slot===name);
  assert.ok(!slot("list-left-items").hidden&&!slot("title").hidden,"slots with words show");
  for(const name of ["body","list-right-heading","list-right-items","source"])assert.equal(slot(name).hidden,true,`the empty ${name} slot is hidden`);
  // An edit that empties a slot hides it; one that gives an empty slot words shows it again.
  await invoke("edit_deck",{operations:[
    {op:"update_element",pageId:page.id,elementId:slot("list-left-items").id,properties:{text:""}},
    {op:"update_element",pageId:page.id,elementId:slot("list-right-items").id,properties:{text:"Construction\nAgriculture"}},
  ]});
  assert.equal(slot("list-left-items").hidden,true);
  assert.ok(!slot("list-right-items").hidden,"given words, the slot shows again");
  assert.equal(slot("list-right-heading").hidden,true,"a slot still without words stays hidden");
  const brand=session.document.pages[0].canvas.elements.filter(item=>item.type==="text"&&item.templateRole==="brand");
  assert.ok(brand.every(item=>!item.hidden),"the brand's own text is left alone");
});

test("a photo link that redirects to a private address, or keeps redirecting, isn't downloaded",async()=>{
  const requests=[];
  const {session,place}=await photoSession(async url=>{
    requests.push(String(url));
    return new Response(null,{status:302,headers:{location:String(url).includes("loop")?"/loop/again":"http://127.0.0.1:8080/inside.png"}});
  });
  session.found.set(FOUND,{width:640,height:480,what:"A photo"});
  await assert.rejects(()=>place(FOUND),/isn't a public web address/);
  assert.deepEqual(requests,[FOUND],"the private address is never asked for");
  const loop="https://example.com/loop/start.jpg";
  session.found.set(loop,{width:640,height:480,what:"A photo"});
  await assert.rejects(()=>place(loop),/redirects too many times/);
  assert.equal(requests.length,1+6);
  assert.match(session.document.pages[0].canvas.elements.find(item=>item.slot==="media").src,/^data:/,"the frame keeps the template's placeholder");
});

test("a deck with an outside link or a data: image isn't handed in",()=>{
  const document=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
  const deck=structuredClone({...document,pages:document.pages.slice(0,1)});
  const frame=deck.pages[0].canvas.elements.find(item=>item.slot==="photo");
  assert.deepEqual(tools.unstoredImages(deck,template),[],"the template's own artwork and placeholders stay");
  frame.src="https://example.com/photo.jpg";
  assert.equal(tools.unstoredImages(deck,template).length,1);
  frame.src="data:image/jpeg;base64,/9j/4AAQ";
  assert.equal(tools.unstoredImages(deck,template).length,1);
});
