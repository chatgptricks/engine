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
import {randomUUID} from "node:crypto";
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

const stage=load("lib/engine/agents/stages/design.ts"),{design}=stage;
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
const cards=load("lib/template-editor/platform-cards.ts");
const pagePosts=load("lib/engine/page-posts.ts");
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
  assert.match(tools.offBrand('<svg><rect fill="rgb(0, 0, 0)"/></svg>',"",tokens)[0],/writes the color rgb\(0, 0, 0\)/);
  // A mask reads only its colors' opacity and paints nothing, so its black is fine; what it paints still isn't.
  assert.deepEqual(tools.offBrand('<div class="band"></div>',".band{background:var(--color-background);-webkit-mask-image:linear-gradient(90deg,transparent,black 40px);mask-image:linear-gradient(90deg,transparent,black 40px);mask:linear-gradient(#000,transparent)}",tokens),[]);
  assert.match(tools.offBrand('<div class="band"></div>',".band{background:black;mask-image:linear-gradient(black,transparent)}",tokens)[0],/^background: black writes the color black/);
  assert.match(tools.offBrand("<p>x</p>","p{color:var(--color-made-up)}",tokens)[0],/isn't one of the brand's variables/);
  assert.match(tools.offBrand("<style>p{background:#0B1014}</style><p>x</p>","",tokens)[0],/#0B1014/,"style blocks are read too");
  assert.deepEqual(tools.offBrand("<p>x</p>","p{font-family:var(--title-font);white-space:nowrap;text-transform:var(--title-case)}",tokens),[],"words that only look like colors don't count");
});

test("a platform card (its outermost element marked platform-card platform-reddit) may write out that platform's colors, and only those",()=>{
  const reddit=`class="${cards.platformCardClass("reddit")}"`;
  assert.deepEqual(tools.offBrand(`<div ${reddit}><svg><circle fill="#FF4500"/><path stroke="#fff"/></svg><b style="color:#F2F4F5">u/a</b></div>`,"div{background:#0E1113;border:3px solid #2F3336;box-shadow:0 0 0 1px rgb(47, 51, 54)}p{color:var(--color-text)}",tokens),[],"Reddit's colors, as hex or rgb(), and the brand's variables");
  assert.match(tools.offBrand(`<div ${reddit}>x</div>`,"div{background:#0E1113;border:3px solid #343536}",tokens)[0],/writes #343536, which isn't one of Reddit's own colors \(#0E1113, /);
  assert.match(tools.offBrand(`<div ${reddit}>x</div>`,"div{box-shadow:0 0 0 1px #2F3336, 0 8px 24px #123456}",tokens)[0],/#123456/,"every color in a value is read, not only the first");
  assert.match(tools.offBrand(`<div ${reddit}>x</div>`,"div{color:white}",tokens)[0],/writes white, which isn't one of Reddit's/,"named colors aren't read as the platform's");
  assert.match(tools.offBrand(`<div ${reddit}>x</div>`,"div{color:#000000}",tokens)[0],/isn't one of Reddit's/,"X's black isn't Reddit's");
  assert.deepEqual(tools.offBrand(`<div class="${cards.platformCardClass("x")}">x</div>`,"div{background:#000;color:#E7E9EA;border-color:#2F3336}",tokens),[],"an X post drawn in HTML keeps X's colors");
  // Marked in the wrong place, or for a platform without colors of its own: the brand's rule, and how the mark goes.
  const inner=tools.offBrand(`<div class="area"><div ${reddit}>x</div></div>`,".card{background:#0E1113}",tokens);
  assert.match(inner[0],/writes the color #0E1113 itself/);
  assert.match(inner.at(-1),/the layer's outermost element carries the mark: class="platform-card platform-reddit"/);
  assert.match(tools.offBrand('<div class="platform-card platform-tiktok">x</div>',"div{background:#121212}",tokens).at(-1),/Only X and Reddit have colors of their own/);
  assert.equal(tools.offBrand('<div class="card">x</div>',"div{background:#0E1113}",tokens).length,1,"an unmarked layer is checked as before, with no word about marks");
  // The designer's Reddit card: every color it's given is Reddit's, and the avatar passes as drawn.
  for(const color of Object.values(stage.REDDIT_CARD).flatMap(value=>typeof value==="string"?[value]:Object.values(value)))assert.ok(cards.isPlatformColor("reddit",color),color);
  for(const color of Object.values(stage.REDDIT_CARD.avatars))assert.deepEqual(tools.offBrand(`<div ${reddit}>${stage.REDDIT_AVATAR.replaceAll("COLOR",color)}</div>`,"",tokens),[],color);
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
    const shot=await sharp(Buffer.from(seen.find(block=>block.type==="image").source.data,"base64")).metadata();
    assert.ok(shot.format==="jpeg"&&shot.width<=540,"each slide comes back as a small JPEG: it stays in the conversation for every later turn");
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
    const card=elements(2),post=card.find(item=>item.slot==="reaction-card");
    assert.equal(post.type,"html","the post is E's HTML X card (htmlReactionCards)");
    assert.equal(cards.platformOfLayer(post.html),"x");
    assert.match(post.html,/@sama/);
    assert.match(post.html,/src="\/api\/template-editor\/assets\/[a-f0-9]{64}"/,"its avatar is a stored file");
    assert.ok(!card.some(item=>item.slot?.startsWith("reaction-")&&item.slot!=="reaction-card"),"the native card's layers are gone");
    assert.equal(card.find(item=>item.slot==="title").text,"","a slot the copy leaves out is emptied");
    assert.equal(elements(3).find(item=>item.slot==="cta").text,"FOR MORE");
    assert.equal(deck.caption,sourceNotes.post.caption);
    assert.ok(deck.comments.some(comment=>/Cut from the original's slide 2/.test(comment.text)),"the deck's notes say what was cut");
    assert.ok(deck.tags.includes("recreated"));
    assert.ok(deck.tags.includes(context.file.profileId),"the page's tag");
    assert.equal(deck.comments.filter(comment=>comment.text.includes(context.file.id)).length,1,"a comment names the post file");

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
      assert.ok(fixed.tags.includes(context.file.profileId));
      assert.equal(fixed.comments.filter(comment=>comment.text.includes(context.file.id)).length,1,"still named once");
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

test("slide 1 is built on the Cover page and the last on the Follow page, or the deck isn't handed in",async()=>{
  const context=await contextFor("autopilot",{
    source:done(sourceNotes),research:done(research),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null}),brief:done(brief),
    approval:done({plan,headline:{text:APPROVED,option:0},notes:""}),
  });
  const handIn={pages:[{slide:1,layout:"Cover"},{slide:2,layout:"Text + Media"},{slide:3,layout:"Follow"}],notes:[]};
  await stand(async({call,invoke,json})=>{
    const build=async(first,last={templatePage:FOLLOW,slots:{cta:"FOR MORE"}})=>{
      const built=await json("create_deck",{name:"AI vs Jobs",caption:"Openings fell as rates rose.",slides:[first,{templatePage:MEDIA,slots:{title:"What the chart shows"}},last]});
      await invoke("look_at_slides",{slides:[1,2,3]});
      return built.deck;
    };
    await build({templatePage:MEDIA,slots:{title:APPROVED}});
    assert.match(await call.submit.check(handIn),new RegExp(`Slide 1 is the post's cover: build it on the Cover page \\(templatePage ${COVER}\\)`));
    await build({templatePage:COVER,slots:{"cover-headline":APPROVED}},{templatePage:MEDIA,slots:{title:"Follow us"}});
    assert.match(await call.submit.check(handIn),new RegExp(`The last slide is the Follow page \\(templatePage ${FOLLOW}\\)`));
    const deck=await build({templatePage:COVER,slots:{"cover-headline":APPROVED}});
    // The template's cover sets its key phrase apart in the accent, so a cover without one isn't handed in.
    assert.match(await call.submit.check(handIn),/The cover's headline sets its key phrase apart in the accent, as the template's cover does: give the cover-headline slot its words again with \[\[ \]\]/);
    // edit_deck takes [[ ]] in a text slot's words, in the page's text style, so the deck isn't built again.
    // A look sent in the same turn waits for the edit, as work() runs a turn's calls together.
    const headline=layer(deck,1,"cover-headline"),follow=deck.slides[2];
    const [edited,looked]=await Promise.all([
      invoke("edit_deck",{operations:[
        {op:"update_element",pageId:deck.slides[0].pageId,elementId:headline.id,properties:{text:"AI didn’t take the jobs. [[Rates]] did."}},
        {op:"add_slide",index:3,slide:{layout:"blank",background:"#0B1014",elements:[]}},
      ]}),
      invoke("look_at_slides",{slides:[1,4]}),
    ]);
    const added=JSON.parse(edited).deck.slides.find(item=>item.slide===4);
    assert.ok(added,"the edit added slide 4");
    assert.deepEqual(looked.filter(block=>block.type==="text").map(block=>block.text),["Slide 1","Slide 4"],"the look saw the edit's new slide");
    await json("edit_deck",{operations:[{op:"remove_slide",pageId:added.pageId}]});
    assert.equal(await call.submit.check(handIn),null);
    assert.ok(follow);
    return handIn;
  },async()=>{
    const {output}=await design(context);
    assert.deepEqual(output.pages.map(page=>page.layout),["Cover","Text + Media","Follow"]);
    const saved=await deckLib.loadDeck(context.ownerKey,output.deckId);
    const headline=saved.pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
    assert.equal(headline.text,"AI didn’t take the jobs. Rates did","in the page's text style: no final period");
    assert.match(headline.richText,/<span style="color: #00D98A">Rates<\/span>/i,"and its accent");
  });
});

/** A post of Reddit comments, like the design proof's: a photo under a comment on the cover, a comment alone, the cover's comment again, and no follow slide. */
const COMMENT="Swapped airplane seats with a mom so she could sit next to her kid. The guy next to my new seat became my business partner. We sold the company last year";
const redditNotes={...sourceNotes,shows:"A dinner photo under a Reddit comment, then Reddit comments",claims:"Small decisions changed people's lives",slides:[
  {index:1,role:"cover",texts:[{role:"label",text:"seat12b · 1d"},{role:"quote",text:COMMENT},{role:"headline",text:"Reddit Users Reveal the Small Decisions That Changed Their Lives Forever"}],parts:[
    {kind:"screenshot",box:{x:80,y:30,width:840,height:200},what:"A Reddit comment by seat12b, 1d",text:COMMENT,post:null},
    {kind:"photo",box:PICTURE,what:"Friends at a dinner table",text:"",post:null},
  ]},
  {index:2,role:"post",texts:[{role:"label",text:"no_thanks_nate · 9h"},{role:"quote",text:"Said no to one more drink at a bar."}],parts:[{kind:"screenshot",box:{x:60,y:300,width:880,height:300},what:"A Reddit comment by no_thanks_nate, 9h",text:"Said no to one more drink at a bar.",post:null}]},
  {index:3,role:"post",texts:[{role:"label",text:"seat12b · 1d"},{role:"quote",text:COMMENT}],parts:[{kind:"screenshot",box:{x:60,y:300,width:880,height:300},what:"A Reddit comment by seat12b, 1d",text:COMMENT,post:null}]},
]};
const redditCard=(name,words,mark="platform-card platform-reddit")=>`<div class="card ${mark}"><div class="who">${stage.REDDIT_AVATAR.replaceAll("COLOR","#FF4500")}<b>${name}</b><span class="when">· 9h</span></div><p>${words}</p></div>`;
const REDDIT_CSS=":root{display:flex;flex-direction:column;justify-content:center}.card{background:#0E1113;border:3px solid #2F3336;border-radius:24px;padding:45px}.who svg{width:105px;height:105px}b{color:#F2F4F5}.when{color:#8BA2AD}p{color:#EEF1F3;font-family:var(--body-font);font-size:50px;line-height:1.25;text-wrap:pretty}";

test("another platform's comments become our cards in its own colors, and the deck ends on a Follow page made for the post",async()=>{
  const context=await contextFor("exact",{source:done(redditNotes),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null})});
  await stand(async({call,invoke,refused,json})=>{
    assert.match(call.system,/the frame of our X card: 936 px wide at x 72, 24 px corners and a 3 px border/,"cards take the template's X card frame");
    assert.match(call.system,/A card alone on its slide: 44 px of padding \(48 at the sides, 52 at the bottom\); the avatar 92 px, 24 px from the name; the name and time at 40 px; the words 28 px below the avatar, at 50 px on 63 px lines/,"a lone card's sizes are the approved proof's");
    assert.match(call.system,/A card on a photo, compact so the photo shows: 34 px of padding \(40 at the sides, 40 at the bottom\); the avatar 64 px, 18 px from the name; the name and time at 32 px; the words 18 px below the avatar, at 38 px on 49 px lines/,"and so are a cover card's");
    assert.match(call.system,/the outermost element of the layer's markup carries class="platform-card platform-reddit"/,"the mark the review reads too");
    assert.match(call.system,/the card #0E1113, its border #2F3336, the name #F2F4F5, the time #8BA2AD, the words #EEF1F3/);
    assert.match(call.system,/red #FF4500, orange #FF8717, blue #24A0ED, green #46D160/,"the avatars by the color names the notes use");
    assert.match(call.system,/a band of var\(--color-background\)/,"an overlay our card can't cover goes under a band of the brand's background");
    assert.match(call.system,/It is solid to about 40 px past the overlay's lowest edge, its border and shadow too/,"solid past the overlay's edge, so no thin line shows");
    assert.match(call.system,/no face is cut by the frame's edges \(each is whole inside the frame, or out of it\)/,"on every photo, the cover's too");
    assert.match(call.system,/fit: contain keeps them all; then cropScale brings it as close to filling the frame as the faces allow/,"and a contained photo still fills as much of its frame as the faces allow");
    assert.match(call.system,/it sits low in the frame \(cropY 100\), whether or not it still holds an overlay, so the template's bottom fade takes its bottom edge/,"low in its frame, overlay or not, so the fade takes its bottom edge");
    assert.match(call.system,/gets the same kind of band over each edge it leaves inside the frame \(at cropY 100, its top edge\): solid just past the edge/,"and a band takes the edge left inside the frame");
    assert.match(call.system,/no period at the end of a paragraph/,"HTML words follow the page's no-final-periods style");
    assert.match(call.system,/then the words, word for word, in the page's text style: no period at the end of the last sentence, and curly quotes/,"said in the card rule too, where the words are");
    assert.match(call.system,/The page's text style \(Layout\) still applies to them, in slots and in HTML alike/,"and in the exact copy's words rule");
    assert.match(call.system,/An exact copy's too: the accent is our template's look, not a change to the words/,"the cover's key phrase is set apart even when the original's headline is one color");
    assert.match(call.system,/place it so the least of the overlay shows \(an overlay at the photo's top: cropY 100/,"the Follow photo shows as little of the original's overlay as it can");
    assert.match(call.system,/a little closer \(cropScale about 1\.1 to 1\.25; 1 just fills it\)[^.]*\. No face is cut by the frame's edges/,"and comes only a little closer, as the proof's does, with no face cut by the frame");
    assert.match(call.system,/x 72, y 90, 936 px wide and 1262 px tall/,"a lone card is centred in the guide's content area");
    const photo=await json("cut_from_source",{slide:1,box:PICTURE,kind:"photo",what:"Friends at a dinner table"});
    const built=await json("create_deck",{name:"Small decisions",caption:sourceNotes.post.caption,slides:[
      {templatePage:COVER,slots:{"cover-headline":"REDDIT USERS REVEAL THE [[SMALL DECISIONS]] THAT CHANGED THEIR LIVES FOREVER",photo:photo.src}},
      {templatePage:FOLLOW,slots:{cta:"FOR MORE LIFE STORIES",photo:photo.src}},
    ]});
    const [cover,follow]=built.deck.slides.map(slide=>slide.pageId);
    // The cover's comment is rebuilt where the original's was, over the photo.
    await json("edit_deck",{operations:[{op:"add_html",pageId:cover,name:"Reddit comment · seat12b",x:72,y:90,width:936,height:300,html:redditCard("seat12b",COMMENT),css:REDDIT_CSS}]});
    // A comment alone is a blank slide with one card. Unmarked, marked inside a wrapper, or marked for a platform without colors of its own, its colors are refused.
    const story=mark=>({op:"add_slide",index:1,slide:{label:"Story",layout:"blank",background:"#0B1014",elements:[
      {type:"html",id:"story-card",name:"Reddit comment · no_thanks_nate",x:72,y:90,width:936,height:1262,html:redditCard("no_thanks_nate","Said no to one more drink at a bar.",mark),css:REDDIT_CSS},
    ]}});
    await refused("edit_deck",{operations:[story("")]},/writes the color #0E1113/);
    await refused("edit_deck",{operations:[story("platform-card platform-myspace")]},/Only X and Reddit have colors of their own/);
    const wrapped=story();
    wrapped.slide.elements[0].html=`<div class="area">${wrapped.slide.elements[0].html}</div>`;
    await refused("edit_deck",{operations:[wrapped]},/outermost element carries the mark/);
    const added=await json("edit_deck",{operations:[story()]});
    assert.deepEqual(added.deck.slides.map(slide=>slide.slide),[2],"the card's slide goes in second");
    const storyPage=added.deck.slides[0].pageId;
    // A change to its CSS alone is checked on the card as it ends up, mark and all: Reddit's colors or the brand's.
    await refused("edit_deck",{operations:[{op:"update_element",pageId:storyPage,elementId:"story-card",properties:{css:REDDIT_CSS.replace("#2F3336","#343536")}}]},/#343536, which isn't one of Reddit's own colors/);
    const changed=await json("edit_deck",{operations:[{op:"update_element",pageId:storyPage,elementId:"story-card",properties:{css:REDDIT_CSS.replace(".when{color:#8BA2AD}",".when{color:var(--color-source)}")}}]});
    assert.deepEqual(changed.deck.slides.map(slide=>slide.slide),[2]);
    // The Follow page shows the post's photo again, closer.
    const followPhoto=layer(built.deck,2,"photo");
    await json("edit_deck",{operations:[{op:"update_element",pageId:follow,elementId:followPhoto.id,properties:{cropScale:1.3,cropX:50,cropY:40}}]});
    await invoke("look_at_slides",{slides:[1,2,3]});
    // Slide 3 repeats slide 1's comment, so it's left out; the Follow page the original doesn't have is slide 0.
    const handIn={pages:[{slide:1,layout:"Cover"},{slide:2,layout:"blank, one Reddit card"},{slide:0,layout:"Follow"}],notes:["Slide 3 repeats slide 1's comment, so it's left out."]};
    assert.equal(await call.submit.check(handIn),null);
    return handIn;
  },async()=>{
    const {output}=await design(context);
    assert.deepEqual(output.pages.map(page=>page.slide),[1,2,0]);
    const deck=await deckLib.loadDeck(context.ownerKey,output.deckId);
    const card=deck.pages[1].canvas.elements.find(item=>item.type==="html");
    assert.equal(cards.platformOfLayer(card.html),"reddit","the mark survives the save");
    assert.match(card.css,/\.when\{color:var\(--color-source\)\}/);
    assert.deepEqual(tools.deckOffBrand(deck,tokens),[],"a platform's card keeps its own colors; everything else keeps the brand's");
    assert.equal(deck.pages[2].canvas.elements.find(item=>item.slot==="cta").text,"FOR MORE LIFE STORIES");
    assert.equal(deck.pages[2].canvas.elements.find(item=>item.slot==="photo").cropScale,1.3);
    assert.deepEqual(leftovers(deck),[]);
  });
});

test("a photo that stops inside a frame the template fades isn't handed in until its edge sits at the frame's or a band covers it",async()=>{
  const context=await contextFor("exact",{source:done(redditNotes),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null})});
  await stand(async({call,invoke,json})=>{
    // A wide strip, like the one run 8 of the design proof cut below the original's card: 864 × 405 px, which a contain fit shows 1080 × 506 in the 1080 × 926 cover frame.
    const strip=await json("cut_from_source",{slide:1,box:{x:100,y:300,width:800,height:300},kind:"photo",what:"Friends at a dinner table"});
    assert.deepEqual([strip.width,strip.height],[864,405]);
    const built=await json("create_deck",{name:"Small decisions",caption:sourceNotes.post.caption,slides:[
      {templatePage:COVER,slots:{"cover-headline":"REDDIT USERS REVEAL THE [[SMALL DECISIONS]] THAT CHANGED THEIR LIVES FOREVER",photo:strip.src}},
      {templatePage:FOLLOW,slots:{cta:"FOR MORE LIFE STORIES",photo:strip.src}},
    ]});
    const cover=built.deck.slides[0].pageId,frame=layer(built.deck,1,"photo");
    const handIn={pages:[{slide:1,layout:"Cover"},{slide:0,layout:"Follow"}],notes:["Slides 2 and 3 aren't in this deck."]};
    const look=async()=>{await invoke("look_at_slides",{slides:[1,2]});return call.submit.check(handIn);};
    const place=async properties=>{await json("edit_deck",{operations:[{op:"update_element",pageId:cover,elementId:frame.id,properties}]});return look();};
    // Filling the frame leaves no edge inside it.
    assert.equal(await look(),null);
    // At cropY 77 the strip stops 97 px above the frame's bottom, where the template's bottom fade is still see-through.
    assert.match(await place({fit:"contain",cropX:50,cropY:77,cropScale:1}),/^Slide 1's photo stops at y 829, 97 px above the bottom of its frame \(y 926\)\. The template's fade hides a photo's edge only at the frame's own, so this one shows as a straight line\. Set cropY 100/);
    // At the frame's bottom the fade takes that edge, and the top edge needs a band.
    assert.match(await place({cropY:100}),/^Slide 1's photo starts at y 420, 420 px below the top of its frame, and nothing covers that edge/);
    // A band of the background over the top edge, right above the photo in the stack.
    await json("edit_deck",{operations:[{op:"add_html",pageId:cover,index:1,name:"Band over the photo's top edge",x:0,y:0,width:1080,height:600,html:"<div></div>",css:":root{background:linear-gradient(to bottom,var(--color-background) 0,var(--color-background) 540px,transparent 600px)}"}]});
    assert.equal(await look(),null);
    // A photo narrower than its frame shows its sides.
    assert.match(await place({cropScale:.8}),/^Slide 1's photo shows from x 108 to x 972, inside its frame's x 0 to x 1080, so its sides show as straight lines\. Bring it closer with cropScale/);
    assert.equal(await place({cropScale:1.1}),null,"coming closer fills the width again, the bottom edge at the frame's");
    return handIn;
  },async()=>{
    const {output}=await design(context);
    assert.deepEqual(output.pages.map(page=>page.slide),[1,0]);
  });
});

test("shownPhoto places a photo as the canvas draws it: fit, crop point, flip, then the zoom about the crop point",()=>{
  const photo={type:"image",x:0,y:0,width:360,height:300,intrinsicWidth:720,intrinsicHeight:240,fit:"contain",cropX:50,cropY:100,cropScale:1};
  // Contained: 360 × 120, at the frame's bottom.
  assert.deepEqual(stage.shownPhoto(photo),{left:0,right:360,top:180,bottom:300});
  // Zoomed 1.5× about the crop point (the bottom centre): 540 × 180, still on the frame's bottom.
  assert.deepEqual(stage.shownPhoto({...photo,cropScale:1.5}),{left:-90,right:450,top:120,bottom:300});
  // A flip mirrors it in the frame before the zoom: cropY 0 puts it at the top, flipped it sits at the bottom.
  assert.deepEqual(stage.shownPhoto({...photo,cropY:0,flipY:true}),{left:0,right:360,top:180,bottom:300});
  // Covering, it fills the frame: 900 × 300 around the centre.
  assert.deepEqual(stage.shownPhoto({...photo,fit:"cover",cropY:50}),{left:-270,right:630,top:0,bottom:300});
  assert.equal(stage.shownPhoto({...photo,intrinsicWidth:undefined}),null);
});

test("a deck keeps its page's tag and names its post file, even when a fix round builds it afresh, so the page's library finds it",async()=>{
  const context=await contextFor("exact",{source:done(redditNotes),verdict:done({outcome:"proceed",reason:"",evidence:[],answer:null})});
  context.file={...context.file,id:`post-${randomUUID()}`};
  const build=async({call,invoke,json})=>{
    const photo=await json("cut_from_source",{slide:1,box:PICTURE,kind:"photo",what:"Friends at a dinner table"});
    await json("create_deck",{name:"Small decisions",caption:sourceNotes.post.caption,slides:[
      {templatePage:COVER,slots:{"cover-headline":"REDDIT USERS REVEAL THE [[SMALL DECISIONS]] THAT CHANGED THEIR LIVES FOREVER",photo:photo.src}},
      {templatePage:FOLLOW,slots:{cta:"FOR MORE LIFE STORIES",photo:photo.src}},
    ]});
    await invoke("look_at_slides",{slides:[1,2]});
    const handIn={pages:[{slide:1,layout:"Cover"},{slide:0,layout:"Follow"}],notes:[]};
    assert.equal(await call.submit.check(handIn),null);
    return handIn;
  };
  let output;
  await stand(build,async()=>{({output}=await design(context));});
  // The fix round calls create_deck again instead of editing, so the deck it saves starts without comments.
  await stand(build,async()=>{
    const {output:again}=await design({...context,round:1,instructions:"Slide 1 (must fix): build the deck again.",previous:output});
    assert.equal(again.deckId,output.deckId);
    const deck=await deckLib.loadDeck(context.ownerKey,again.deckId);
    assert.ok(deck.tags.includes("chatgptricks"),"the page's tag");
    assert.equal(deck.comments.filter(comment=>comment.text.includes(context.file.id)).length,1,"the post file is named again, once");
    const asked=[];
    const [mine]=await pagePosts.ourLibrary(context.ownerKey,"chatgptricks",{readPostFile:async(ownerKey,id)=>{asked.push(id);return context.file;}});
    assert.equal(mine.id,deck.id);
    assert.equal(mine.page,"chatgptricks");
    assert.deepEqual(asked,[context.file.id],"step B's library reads the post file the deck names");
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
