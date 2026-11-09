/* Run: node --test tests/template-editor-recreate-rebuild.test.mjs
 * Exact copy rebuilds a graphic made of parts in the page's template instead
 * of pasting it whole: a meme's panels become cards in the page's surface
 * color, its words text in the page's styles, its photos cuts of their own,
 * its logos clean files found by name (cut from the original when no source
 * has one), every part its own layer. The meme is drawn by the test, every
 * logo request goes to a stand-in for the web, and Claude is never called: the
 * transcript is a stand-in that runs the transcript stage's own clean-up.
 * Local development storage only. */
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-rebuild-test-"));
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
const rebuild=load("lib/engine/agents/rebuild.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const review=load("lib/engine/agents/review.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const logos=load("lib/engine/logos.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const seed=load("lib/template-editor/brand-guide-seed.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const guide=seed.builtInBrandGuide("chatgptricks");
const catalog=pagesLib.templatePages(template);
const usable=exact.exactPages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media");
const {width:PAGE_WIDTH,height:PAGE_HEIGHT}=model.formatDimensions(template);
const K=PAGE_WIDTH/360,FOOT=360*PAGE_HEIGHT/PAGE_WIDTH; // page px to a scene unit, and the page's height in scene units
const MIN_TEXT=guide.layout.minTextSize;
const signal=new AbortController().signal;
let owners=0;
const owner=()=>`owner-rebuild-${++owners}`;
const elements=page=>page.canvas?.elements??[];
const bySlot=(page,slot)=>elements(page).find(element=>element.slot===slot);
const overlap=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.7&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.7;

// ── The meme ────────────────────────────────────────────────────────────────
// Two white panels on light grey, as the @leadgenman meme draws them: a heading
// in each, a photo in a black frame, and logos with labels under them: a row of
// three (with a line of words under it) in the first, a grid of six in the second.
const SLIDE={width:1080,height:1350};
const COLUMNS=[644,788,932]; // logo cell centres across, in pixels
const square=(cx,cy,size)=>[cx-size/2,cy-size/2,cx+size/2,cy+size/2];
const DRAWN={ // [left, top, right, bottom) in pixels
  panels:[[43,40,1037,648],[43,702,1037,1310]],
  frames:[[90,150,515,605],[90,815,515,1270]], // a 6-pixel frame around each photo
  words:[[90,68,720,112],[90,730,800,774],[600,470,980,520]],
  marks:[
    ...[[217,119,87],[30,30,30],[20,20,20]].map((fill,at)=>[square(COLUMNS[at],262,80),fill]),
    ...[[255,153,0],[36,150,237],[50,108,229],[210,73,57],[86,153,64],[40,40,40]].map((fill,at)=>[square(COLUMNS[at%3],[895,1124][Math.floor(at/3)],70),fill]),
  ],
  labels:[...COLUMNS.map(cx=>[cx-45,385,cx+45,401]),...[998,1228].flatMap(cy=>COLUMNS.map(cx=>[cx-40,cy-8,cx+40,cy+8]))],
};
const PHOTOS=[[96,156,509,599],[96,821,509,1264]]; // each photo inside its frame
const noise=(x,y)=>{const n=((x*73856093)^(y*19349663))>>>0;return [60+n%160,60+(n>>>8)%160,60+(n>>>16)%160];};
const within=(x,y,[x0,y0,x1,y1])=>x>=x0&&x<x1&&y>=y0&&y<y1;
async function memeSlide() {
  const {width,height}=SLIDE,data=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    let color=[228,228,228];
    if(DRAWN.panels.some(box=>within(x,y,box)))color=[250,250,250];
    if((x>>4)%3!==2&&DRAWN.words.some(box=>within(x,y,box)))color=[30,30,30];
    DRAWN.frames.forEach((box,at)=>{if(within(x,y,box))color=within(x,y,PHOTOS[at])?noise(x,y):[20,20,20];});
    for(const [box,fill] of DRAWN.marks)if(within(x,y,box))color=fill;
    if(DRAWN.labels.some(box=>within(x,y,box)))color=[60,60,60];
    data[(y*width+x)*3]=color[0];data[(y*width+x)*3+1]=color[1];data[(y*width+x)*3+2]=color[2];
  }
  return {mediaType:"image/png",base64:(await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer()).toString("base64")};
}
let memo;
const meme=()=>memo??=memeSlide();

// What the copier gives for it, on the 0-1000 grid: photo boxes a little loose, as a model draws them.
const block=(kind,box,extra={})=>({kind,box,text:"",align:"center",columns:0,logos:[],alt:"",...extra});
const ROW=[{brand:"Claude",label:"Claude Code"},{brand:"Cursor",label:"Cursor"},{brand:"OpenAI",label:"Codex"}];
const GRID=[{brand:"Amazon Web Services",label:"AWS"},{brand:"Docker",label:"Docker"},{brand:"Kubernetes",label:"Kubernetes"},{brand:"Jenkins",label:"Jenkins"},{brand:"Amazon S3",label:"S3"},{brand:"",label:"Bash"}];
const MEME={panels:[
  {box:{x:40,y:30,width:920,height:450},card:true,blocks:[
    block("heading",{x:80,y:45,width:840,height:45},{text:"Software Engineer Today:",align:"left"}),
    block("photo",{x:78,y:106,width:404,height:346},{alt:"A man smiling at his desk"}),
    block("logos",{x:530,y:120,width:400,height:200},{columns:3,logos:ROW}),
    block("text",{x:550,y:340,width:380,height:50},{text:"All we need now:)"}),
  ]},
  {box:{x:40,y:520,width:920,height:450},card:true,blocks:[
    block("heading",{x:80,y:535,width:840,height:45},{text:"Software Engineer 10 years ago:",align:"left"}),
    block("photo",{x:78,y:600,width:404,height:344},{alt:"The same man, tired"}),
    block("logos",{x:530,y:600,width:400,height:340},{columns:3,logos:GRID}),
  ]},
]};
const TRANSCRIPT={
  name:"Software engineers",originalLanguage:"en",translated:false,
  slides:[{original:1,templatePage:COVER,texts:[],media:{kind:"screenshot",box:{x:40,y:30,width:920,height:940},alt:"A meme"},graphic:MEME}],
  caption:"Then and now.",notes:[],
};

// ── The web, stood in for ───────────────────────────────────────────────────
const SVGL=logos.LOGO_SOURCES.svgl,SIMPLE=logos.LOGO_SOURCES.simpleIcons;
const svg=color=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="M2 2h20v20H2z"/></svg>`;
const simpleIcon=title=>`<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${title}</title><path d="M2 2h20v20H2z"/></svg>`;
/** svgl has five of the brands (Docker's mark is dark in two colors, so it needs a tile), Simple Icons two more; nobody has Amazon S3. */
const FILES={
  [SVGL]:[
    {title:"Claude",route:`${SVGL}/library/claude.svg`},
    {title:"Cursor",route:{light:`${SVGL}/library/cursor_light.svg`,dark:`${SVGL}/library/cursor_dark.svg`}},
    {title:"OpenAI",route:{light:`${SVGL}/library/openai.svg`,dark:`${SVGL}/library/openai_dark.svg`}},
    {title:"Amazon Web Services",route:`${SVGL}/library/aws.svg`},
    {title:"Docker",route:`${SVGL}/library/docker.svg`},
  ],
  [`${SVGL}/library/claude.svg`]:svg("#D97757"),
  [`${SVGL}/library/cursor_light.svg`]:svg("#141414"),[`${SVGL}/library/cursor_dark.svg`]:svg("#EDECEC"),
  [`${SVGL}/library/openai.svg`]:svg("#000000"),[`${SVGL}/library/openai_dark.svg`]:svg("#FFFFFF"),
  [`${SVGL}/library/aws.svg`]:svg("#FF9900"),
  [`${SVGL}/library/docker.svg`]:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#111111" d="M0 0h12v24H0z"/><path fill="#3A1A8A" d="M12 0h12v24H12z"/></svg>',
  [`${SIMPLE}/data/simple-icons.json`]:[{title:"Kubernetes",slug:"kubernetes",hex:"326CE5"},{title:"Jenkins",slug:"jenkins",hex:"D24939"}],
  [`${SIMPLE}/icons/kubernetes.svg`]:simpleIcon("Kubernetes"),[`${SIMPLE}/icons/jenkins.svg`]:simpleIcon("Jenkins"),
};
function web(files=FILES) {
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(!Object.hasOwn(files,url))return new Response("not found",{status:404});
    return new Response(typeof files[url]==="string"?files[url]:JSON.stringify(files[url]),{status:200});
  };
  return {fetch:fetcher,calls};
}

/** The transcript stage's own clean-up and snapping, on the copier's answer. */
async function copied(images,raw) {
  const plan=exact.normalizeTranscript(structuredClone(raw),usable,images.length);
  const slides=await Promise.all(plan.slides.map(async slide=>slide.graphic&&images[slide.original-1]?{...slide,graphic:await exact.snapGraphic(images[slide.original-1],slide.graphic)}:slide));
  return {...plan,slides};
}
let laidMemo;
/** The meme rebuilt once for the tests that look at it. */
const rebuilt=()=>laidMemo??=(async()=>{
  const image=await meme(),plan=await copied([image],TRANSCRIPT),notes=[],site=web();
  const laid=await exact.rebuildGraphic(plan.slides[0],0,{template,catalog,image,guide,signal,fetch:site.fetch},notes);
  return {image,plan,slide:plan.slides[0],laid,notes,site};
})();
async function assembled() {
  const deck=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Software engineers",caption:"",slides:[{templatePage:MEDIA,slide:0,texts:[]}],notes:[]});
  exact.tidyExactDeck(deck.document,deck.pages,catalog,["SWIPE FOR MORE",english.swipeText]);
  return deck;
}
async function decode(url) {
  const {data,info}=await sharp(Buffer.from(url.slice(url.indexOf(",")+1),"base64")).raw().toBuffer({resolveWithObject:true});
  const at=(x,y)=>(y*info.width+x)*info.channels,brightness=(x,y)=>(data[at(x,y)]+data[at(x,y)+1]+data[at(x,y)+2])/3;
  const line=(points)=>points.reduce((sum,[x,y])=>sum+brightness(x,y),0)/points.length;
  const across=y=>Array.from({length:info.width},(_,x)=>[x,y]),down=x=>Array.from({length:info.height},(_,y)=>[x,y]);
  return {width:info.width,height:info.height,edges:[line(down(0)),line(down(info.width-1)),line(across(0)),line(across(info.height-1))]};
}

// ── The copier's graphic, checked ───────────────────────────────────────────
test("the copier's graphic is kept to parts that can be laid out",()=>{
  assert.equal(rebuild.normalizeGraphic(null),null);
  assert.equal(rebuild.normalizeGraphic({panels:[]}),null);
  const normalized=rebuild.normalizeGraphic({panels:[
    {box:{x:0,y:0,width:10,height:500},card:true,blocks:[block("heading",{x:0,y:0,width:10,height:20},{text:"Too thin"})]},
    {box:{x:50,y:50,width:900,height:600},card:true,blocks:[
      block("heading",{x:40,y:60,width:600,height:50},{text:"  Today:  ",align:"justify"}),
      block("text",{x:60,y:120,width:500,height:40},{text:"   "}),
      block("photo",{x:60,y:200,width:400,height:300},{alt:"  A man at a desk  "}),
      block("logos",{x:500,y:200,width:400,height:300},{columns:0,logos:[{brand:" Docker ",label:"Docker"},{brand:"",label:""},{brand:"x".repeat(100),label:""}]}),
      block("logos",{x:500,y:520,width:400,height:100},{columns:9,logos:[{brand:"Git",label:"Git"},{brand:"",label:"Bash"}]}),
      block("picture",{x:980,y:980,width:200,height:200},{alt:"Outside the panel"}),
    ]},
    {box:{x:50,y:700,width:900,height:200},card:false,blocks:[block("text",{x:60,y:710,width:300,height:10},{text:"Too short"})]},
  ]});
  assert.equal(normalized.panels.length,1,"a panel under 1.5% of the slide a side, or with nothing left in it, goes");
  const [heading,photo,logoBlock,pair]=normalized.panels[0].blocks;
  assert.equal(normalized.panels[0].blocks.length,4,"empty words and a block outside its panel go");
  assert.deepEqual(heading.box,{x:50,y:60,width:590,height:50},"a block is kept inside its panel");
  assert.equal(heading.text,"Today:");
  assert.equal(heading.align,"center");
  assert.equal(photo.alt,"A man at a desk");
  assert.deepEqual(logoBlock.logos,[{brand:"Docker",label:"Docker"},{brand:"x".repeat(80),label:""}],"a logo with neither brand nor label goes, and names are trimmed");
  assert.equal(logoBlock.columns,2,"a row length of 0 means one row");
  assert.equal(pair.columns,2,"a row is never longer than its logos");
});

test("a graphic goes on the page with a heading and a photo frame, or is cut whole on a template without one",()=>{
  const normalized=exact.normalizeTranscript(structuredClone(TRANSCRIPT),usable,1);
  const [slide]=normalized.slides;
  assert.equal(slide.templatePage,MEDIA,"the copier's page gives way to the page a graphic is rebuilt on");
  assert.deepEqual(slide.media,{kind:"none",box:null,alt:""},"a rebuilt graphic is not also cut whole");
  assert.equal(slide.graphic.panels.length,2);
  assert.deepEqual(normalized.notes,[]);

  const without=usable.filter(page=>!(page.photo.length&&page.text.some(slot=>slot.role==="heading")));
  const cut=exact.normalizeTranscript(structuredClone(TRANSCRIPT),without,1);
  assert.equal(cut.slides[0].graphic,null);
  assert.equal(cut.slides[0].templatePage,COVER);
  assert.equal(cut.slides[0].media.kind,"screenshot");
  assert.deepEqual(cut.slides[0].media.box,{x:40,y:30,width:920,height:940},"cut whole, around all its panels");
  assert.match(cut.slides[0].media.alt,/^Software Engineer Today: \/ All we need now:\) \/ Software Engineer 10 years ago:$/);
  assert.deepEqual(cut.notes,["Slide 1: the graphic is cut whole: the template has no page with a heading and a photo frame to rebuild it on."]);
});

test("a photo inside a graphic snaps to its own edges, inside the frame drawn around it",async()=>{
  const {slide}=await rebuilt();
  const expected=PHOTOS.map(([x0,y0,x1,y1])=>({x:x0/SLIDE.width*1000,y:y0/SLIDE.height*1000,width:(x1-x0)/SLIDE.width*1000,height:(y1-y0)/SLIDE.height*1000}));
  slide.graphic.panels.forEach((panel,at)=>{
    const box=panel.blocks[1].box;
    for(const side of ["x","y","width","height"])assert.ok(Math.abs(box[side]-expected[at][side])<=2,`photo ${at+1} ${side}: ${box[side]} is not ${expected[at][side].toFixed(1)}`);
    assert.deepEqual(panel.blocks[2].box,MEME.panels[at].blocks[2].box,"other parts keep their boxes");
  });
});

// ── The rebuild ─────────────────────────────────────────────────────────────
test("a meme is rebuilt from its parts: cards, headings, photos cut one by one, logos found or cut, labels never under the minimum",async()=>{
  const {laid,notes}=await rebuilt();
  assert.deepEqual(notes,[]);
  assert.equal(laid.elements.length,26,"2 cards, a tile, 2 photos, 9 logos and 12 lines of words");
  assert.ok(elements(template.pages[MEDIA]).length+laid.elements.length<=rebuild.MAX_LAYERS);

  const cards=laid.elements.filter(element=>element.name==="Card");
  assert.equal(cards.length,2,"each panel is a card");
  for(const card of cards) {
    assert.equal(card.type,"shape");
    assert.equal(card.fill.toUpperCase(),"#1A242B","in the guide's surface color");
    assert.equal(card.stroke,"transparent","with no window border");
  }
  const title=bySlot(template.pages[MEDIA],"title");
  const headings=laid.elements.filter(element=>element.type==="text"&&element.smartText?.group==="s1-headings");
  assert.deepEqual(headings.map(element=>element.text),["Software Engineer Today:","Software Engineer 10 years ago:"]);
  for(const heading of headings) {
    assert.equal(heading.font,title.font,"headings in the page's title style");
    assert.equal(heading.color,title.color);
    assert.equal(heading.align,"left","aligned as in the original");
  }
  const words=laid.elements.find(element=>element.name==="Text: All we need now:)");
  assert.equal(words.smartText.role,"body");
  assert.equal(words.font,bySlot(template.pages[MEDIA],"body").font,"other words in the page's text style");

  const photos=laid.elements.filter(element=>element.name==="Photo");
  assert.equal(photos.length,2);
  assert.equal(laid.photos,2);
  for(const [at,photo] of photos.entries()) {
    assert.match(photo.src,/^data:image\/jpeg;base64,/,"cut from the original");
    assert.equal(photo.fit,"cover");
    assert.equal(photo.publicAlt,MEME.panels[at].blocks[1].alt);
    const [x0,y0,x1,y1]=PHOTOS[at],cut=await decode(photo.src);
    assert.ok(Math.abs(cut.width-(x1-x0))<=3&&Math.abs(cut.height-(y1-y0))<=3,`photo ${at+1} is ${cut.width}x${cut.height}`);
    assert.ok(cut.edges.every(edge=>edge>80),`photo ${at+1} has no frame along its edges (${cut.edges.map(Math.round)})`);
  }

  const marks=laid.elements.filter(element=>element.type==="image"&&/ logo$/.test(element.publicAlt??""));
  assert.deepEqual(marks.map(element=>element.publicAlt.replace(/ logo$/,"")),["Claude","Cursor","OpenAI","Amazon Web Services","Docker","Kubernetes","Jenkins","Amazon S3","Bash"],"every logo, in the original's order");
  const mark=name=>marks.find(element=>element.publicAlt===`${name} logo`);
  assert.equal(mark("Claude").sourceUrl,`${SVGL}/library/claude.svg`,"a found logo keeps where it came from");
  assert.equal(mark("Cursor").sourceUrl,`${SVGL}/library/cursor_dark.svg`,"the dark-page version on the dark card");
  assert.equal(mark("Kubernetes").sourceUrl,`${SIMPLE}/icons/kubernetes.svg`);
  for(const name of ["Claude","Cursor","OpenAI","Amazon Web Services","Kubernetes","Jenkins"])assert.ok(model.isSafeBrandSvgUrl(mark(name).src),`${name} is a clean vector`);
  for(const name of ["Amazon S3","Bash"]) {
    assert.equal(mark(name).name,`${name} logo (cut from the original)`,"a logo no source has is cut from the original, and says so");
    assert.match(mark(name).src,/^data:image\/jpeg;base64,/);
    const cut=await decode(mark(name).src);
    assert.ok(cut.width>=70&&cut.width<=90&&cut.height>=70&&cut.height<=90,`${name} is cut around its mark (${cut.width}x${cut.height})`);
  }
  const tile=laid.elements.find(element=>element.name==="Docker tile");
  assert.ok(tile,"a dark logo in several colors sits on a light tile");
  assert.ok(mark("Docker").x>tile.x&&mark("Docker").x+mark("Docker").width<tile.x+tile.width,"inside its tile");
  assert.deepEqual(laid.logos,{found:["Claude","Cursor","OpenAI","Amazon Web Services","Docker","Kubernetes","Jenkins"],cut:["Amazon S3","Bash"],missing:[],sources:["svgl","simple-icons"]});

  const labels=laid.elements.filter(element=>element.type==="text"&&/ label$/.test(element.name));
  assert.deepEqual(labels.map(element=>element.text),[...ROW,...GRID].map(logo=>logo.label));
  for(const label of labels)assert.ok(label.smartText.minFontSize*K>=MIN_TEXT-.01,`"${label.text}" may go down to ${label.smartText.minFontSize*K} px`);
  assert.deepEqual(laid.small,[]);
  assert.deepEqual([...new Set(labels.map(element=>element.smartText.group))],["s1-labels-0-2","s1-labels-1-2"],"a block's labels share one size");

  const groups=new Map(laid.groups.map(group=>[group.id,group]));
  assert.deepEqual(laid.groups.map(group=>group.name),["Software Engineer Today:","Logos","Software Engineer 10 years ago:","Logos"],"a group per panel, its logos in a group of their own");
  for(const group of laid.groups.filter(group=>group.name==="Logos"))assert.ok(groups.has(group.parentId));
  for(const element of laid.elements)assert.ok(groups.has(element.groupId),`${element.name} is in its panel's group`);
  const order=element=>element.name==="Card"?0:element.type==="shape"?1:element.type==="image"&&!/ logo$/.test(element.publicAlt??"")?2:element.type==="image"?3:4;
  assert.deepEqual(laid.elements.map(order),[...laid.elements.map(order)].sort((a,b)=>a-b),"cards, tiles, photos, logos, then words, from the bottom up");

  const frame=bySlot(template.pages[MEDIA],"media"),source=bySlot(template.pages[MEDIA],"source");
  for(const element of laid.elements) {
    assert.ok(element.x>=frame.x-.01&&element.x+element.width<=frame.x+frame.width+.01,`${element.name} stays across the media frame`);
    assert.ok(element.y>=title.y-.01&&element.y+element.height<=source.y+source.height+.01&&element.y+element.height<=FOOT,`${element.name} stays on the page`);
  }
  const parts=laid.elements.filter(element=>element.type!=="shape"),pairs=[];
  parts.forEach((a,at)=>parts.slice(at+1).forEach(b=>{if(overlap(a,b))pairs.push(`${a.name} / ${b.name}`);}));
  assert.deepEqual(pairs,[],"nothing sits on top of anything else");

  assert.deepEqual(exact.rebuildNotes(1,MEME,laid,MIN_TEXT),[
    "Slide 1: rebuilt the graphic from its parts in the template: 2 panels, 2 photos and 9 logos, each its own layer.",
    "Slide 1: no clean file was found for Amazon S3 and Bash, so they are cut from the original; swap in real files when you have them.",
  ]);
  assert.equal(exact.logoCredits(laid.logos.sources),"Logos come from svgl.app and Simple Icons (CC0). The marks remain their owners' trademarks, used as the original post uses them.");
  assert.equal(exact.logoCredits([]),"");
});

test("the notes say what is missing and what may be set small",()=>{
  const laid={photos:1,logos:{found:["Docker"],cut:[],missing:["Vercel"]},small:["A very long label that runs on"]};
  assert.deepEqual(exact.rebuildNotes(3,{panels:[{}]},laid,24),[
    "Slide 3: rebuilt the graphic from its parts in the template: 1 panel, 1 photo and 2 logos, each its own layer.",
    "Slide 3: Vercel couldn't be found or cut; add it by hand.",
    "Slide 3: \"A very long label that runs on\" may be set under 24 px to fit; check it in the editor.",
  ]);
});

// ── Words the original sets apart ───────────────────────────────────────────
const ACCENT="#00D98A",NO_FILES={pictures:new Map(),logos:new Map()};
test("words the original sets apart come in [[double brackets]]: rich text in the accent color, never marks",()=>{
  assert.deepEqual(rebuild.accented("All we need now",ACCENT),{text:"All we need now"},"words with nothing set apart get no rich text");
  const {text,richText}=rebuild.accented("Use [[Claude]] & <b>Codex</b>\n[[then ship]]",ACCENT);
  assert.equal(text,"Use Claude & <b>Codex</b>\nthen ship");
  assert.equal(richText,'Use <span style="color: #00D98A">Claude</span> &amp; &lt;b&gt;Codex&lt;/b&gt;<br><span style="color: #00D98A">then ship</span>',"escaped, with a line break as <br>");
  assert.equal(model.sanitizeRichText(richText),richText,"the editor keeps it as it is");
  assert.equal(model.richTextToPlain(richText),text,"and reads it as the same words");
  assert.deepEqual(rebuild.accented("[[Claude]] Code]] wins [[",ACCENT),{text:"Claude Code wins ",richText:'<span style="color: #00D98A">Claude</span> Code wins '},"a mark without its partner is dropped");
  assert.deepEqual(rebuild.accented("Claude]] Code",ACCENT),{text:"Claude Code"});
  const graphic={panels:[{box:{x:0,y:0,width:1000,height:1000},card:false,blocks:[
    block("heading",{x:0,y:0,width:500,height:100},{text:"Then [[and]] now"}),block("text",{x:0,y:200,width:500,height:100},{text:"Two\n[[lines]]"}),block("photo",{x:0,y:400,width:500,height:500},{alt:"[[A photo]]"}),
  ]}]};
  assert.equal(rebuild.graphicWords(graphic),"Then and now / Two lines","a graphic's words, in one line, without marks");
});

test("a rebuilt graphic's words carry the accent as rich text, and its layers and groups are named without marks",async()=>{
  const style=rebuild.rebuildStyle(template.pages[MEDIA],guide,K);
  const graphic={panels:[{box:{x:40,y:30,width:920,height:450},card:true,blocks:[
    block("heading",{x:80,y:45,width:840,height:45},{text:"Software Engineer [[Today]]:",align:"left"}),
    block("text",{x:80,y:150,width:840,height:80},{text:"All we need [[now]] & then"}),
    block("text",{x:80,y:300,width:840,height:80},{text:"Plain words"}),
  ]}]};
  const laid=rebuild.layoutGraphic({graphic,slide:SLIDE,area:{x:72,y:300,width:936,height:900},style,files:NO_FILES,pixels:K,key:"s1"});
  const [heading,words,plain]=laid.elements.filter(element=>element.type==="text");
  assert.equal(heading.name,"Software Engineer Today:");
  assert.equal(heading.text,"Software Engineer Today:");
  assert.equal(heading.richText,`Software Engineer <span style="color: ${style.accent}">Today</span>:`);
  assert.equal(words.name,"Text: All we need now & then");
  assert.equal(words.richText,`All we need <span style="color: ${style.accent}">now</span> &amp; then`);
  assert.ok(!("richText" in plain),"words with nothing set apart stay plain text");
  assert.deepEqual(laid.groups.map(group=>group.name),["Software Engineer Today:"],"the panel's group is named after its heading, without marks");

  const deck=await assembled(),page=deck.document.pages[0];
  assert.deepEqual(exact.placeRebuilt(deck.document,deck.pages,new Map([[0,laid]])),[]);
  const parsed=model.parseCanvas(page.canvas);
  assert.ok(parsed,"the page is one the editor opens");
  assert.equal(parsed.elements.find(element=>element.name==="Software Engineer Today:").richText,heading.richText,"with the accent kept");
});

test("the accent comes from the guide, else the page's title color when it isn't the ink, else our green",()=>{
  const page=template.pages[MEDIA],orange=structuredClone(guide);
  orange.colors.find(color=>color.role==="accent").value="#FF5500";
  assert.equal(rebuild.rebuildStyle(page,orange,K).accent,"#FF5500","the guide's accent first");
  const titled=structuredClone(page);
  bySlot(titled,"title").color="#7C5CFF";
  assert.equal(rebuild.rebuildStyle(titled,null,K).accent,"#7C5CFF","without a guide, the title's color");
  const inked=structuredClone(page);
  bySlot(inked,"title").color=bySlot(inked,"body").color.toLowerCase();
  assert.equal(rebuild.rebuildStyle(inked,null,K).accent,"#00D98A","a title in the ink's color sets nothing apart, so our green");
});

// ── Panels side by side ─────────────────────────────────────────────────────
// Slide 3 of the bars run: two uncarded panels side by side, each a centred name over "$0" over a
// picture, and a line of words at the bottom. Words on a panel without a card spread past it, but
// they grew over the whole area, into the next panel's words.
const RECEIPTS={panels:[
  {box:{x:56,y:122,width:412,height:100},card:false,blocks:[
    block("heading",{x:176,y:124,width:171,height:24},{text:"GPT-6 Astra"}),block("text",{x:243,y:152,width:38,height:27},{text:"$0"}),
    block("picture",{x:58,y:200,width:408,height:19},{alt:"Receipt printer slot, empty"}),
  ]},
  {box:{x:532,y:122,width:412,height:100},card:false,blocks:[
    block("heading",{x:678,y:124,width:118,height:24},{text:"Fable 5.1"}),block("text",{x:718,y:152,width:39,height:27},{text:"$0"}),
    block("picture",{x:534,y:200,width:408,height:19},{alt:"Receipt printer slot, empty"}),
  ]},
  {box:{x:40,y:905,width:520,height:52},card:false,blocks:[block("heading",{x:44,y:913,width:510,height:37},{text:"Same $200. Print the receipt",align:"left"})]},
]};
test("words on panels side by side without cards share the space between them, never growing into each other",()=>{
  const style=rebuild.rebuildStyle(template.pages[MEDIA],guide,K);
  const shown=new Map([["title","$200 a month.\nHere's your receipt"],["source","1 line = $500 of API-equivalent value / month · agentic workload · SemiAnalysis, Oct 2026"]]);
  const area=rebuild.graphicArea(template.pages[MEDIA],"media",shown,K);
  const laid=rebuild.layoutGraphic({graphic:RECEIPTS,slide:SLIDE,area,style,files:NO_FILES,pixels:K,key:"s3"});
  const words=laid.elements.filter(element=>element.type==="text"),pairs=[];
  assert.deepEqual(words.map(element=>element.text),["GPT-6 Astra","$0","Fable 5.1","$0","Same $200. Print the receipt"]);
  words.forEach((a,at)=>words.slice(at+1).forEach(b=>{if(overlap(a,b))pairs.push(`${a.name} / ${b.name}`);}));
  assert.deepEqual(pairs,[],"no words sit on each other");
  const [left,,right]=words;
  assert.ok(left.x+left.width<right.x,"each name keeps to its side");
  for(const element of words)assert.ok(element.x>=area.x/K-.01&&element.x+element.width<=(area.x+area.width)/K+.01,`${element.name} stays across the area`);

  // A panel with a card is a wall the words of a panel beside it stop at.
  const carded=structuredClone(RECEIPTS);
  carded.panels[1].card=true;
  const beside=rebuild.layoutGraphic({graphic:carded,slide:SLIDE,area,style,files:NO_FILES,pixels:K,key:"s3"});
  const card=beside.elements.find(element=>element.name==="Card"),name=beside.elements.find(element=>element.text==="GPT-6 Astra");
  assert.ok(name.x+name.width<=card.x,"the name stops before the card beside it");
});

test("a logo block that would pass the 100 layers a slide holds stays one picture cut from the original",async()=>{
  const many=Array.from({length:30},(_,at)=>({brand:`Brand ${at+1}`,label:`B${at+1}`}));
  const graphic={panels:[{box:{x:0,y:0,width:1000,height:1000},card:false,blocks:[
    block("heading",{x:50,y:20,width:900,height:60},{text:"The stack"}),
    block("logos",{x:50,y:100,width:900,height:500},{columns:6,logos:many}),
    block("logos",{x:50,y:650,width:900,height:300},{columns:5,logos:many.slice(0,10).map(logo=>({brand:logo.brand,label:""}))}),
  ]}]};
  assert.equal(rebuild.graphicLayers(graphic),71);
  assert.equal(rebuild.graphicLayers(graphic,2),73,"a tile is a layer too");
  const fitted=rebuild.fitLayerBudget(graphic,30);
  assert.equal(rebuild.graphicLayers(fitted.graphic),12);
  assert.deepEqual(fitted.cut.map(item=>item.logos.length),[30],"the largest block goes first, and only as many as needed");
  const [,picture,kept]=fitted.graphic.panels[0].blocks;
  assert.equal(picture.kind,"picture","the block keeps its place, so keys to the other parts stay right");
  assert.match(picture.alt,/^Logos: B1, B2, B3, .*B30$/);
  assert.equal(kept.kind,"logos");
  assert.equal(graphic.panels[0].blocks[1].kind,"logos","the copier's graphic is left as it was");

  const image=await meme(),notes=[];
  const grid={panels:[{box:{x:40,y:30,width:920,height:940},card:true,blocks:[
    block("heading",{x:80,y:45,width:840,height:45},{text:"Software Engineer 10 years ago:",align:"left"}),
    block("logos",{x:100,y:150,width:800,height:800},{columns:8,logos:Array.from({length:48},(_,at)=>({brand:`Brand ${at+1}`,label:`Tool ${at+1}`}))}),
  ]}]};
  const laid=await exact.rebuildGraphic({original:1,templatePage:MEDIA,texts:[],media:{kind:"none",box:null,alt:""},graphic:grid},0,{template,catalog,image,guide,signal,fetch:web().fetch},notes);
  assert.deepEqual(notes,["Slide 1: a block of 48 logos stays one picture cut from the original: rebuilt, the slide would pass the 100 layers a slide holds."]);
  assert.deepEqual(laid.elements.map(element=>element.name),["Card","Picture","Software Engineer 10 years ago:"]);
  assert.match(laid.elements[1].publicAlt,/^Logos: Tool 1, Tool 2/);
  assert.match(laid.elements[1].src,/^data:image\/jpeg;base64,/);
  assert.deepEqual(laid.logos,{found:[],cut:[],missing:[],sources:[]});
});

test("a graphic isn't rebuilt where the slide's copy leaves it no room, nor without its original slide",async()=>{
  const image=await meme(),graphic=structuredClone(MEME);
  const crowded={original:1,templatePage:MEDIA,media:{kind:"none",box:null,alt:""},graphic,texts:[
    {slot:"title",text:"word ".repeat(15).trim()},{slot:"body",text:"lorem ".repeat(140).trim()},{slot:"source",text:"Source: the original"},
  ]};
  await assert.rejects(exact.rebuildGraphic(crowded,0,{template,catalog,image,guide,signal,fetch:web().fetch},[]),/the page's copy leaves it no room/);
  await assert.rejects(exact.rebuildGraphic({...crowded,texts:[]},0,{template,catalog,guide,signal,fetch:web().fetch},[]),/its original slide is missing/);
});

// ── On the page ─────────────────────────────────────────────────────────────
test("the rebuilt layers go over the page's hidden photo frame, and a graphic past the slide's layers is refused",async()=>{
  const {laid}=await rebuilt(),deck=await assembled(),page=deck.document.pages[0];
  const before=elements(page).length,empty=comment=>comment.pageId===page.id&&comment.text.startsWith("No photo or chart for this slide yet");
  assert.ok((deck.document.comments??[]).some(empty),"the deck notes the empty frame");
  bySlot(page,"title").smartCenter={top:30,bottom:417};
  assert.deepEqual(exact.placeRebuilt(deck.document,deck.pages,new Map([[0,laid]])),[]);
  assert.equal(elements(page).length,before+laid.elements.length);
  assert.equal(bySlot(page,"media").hidden,true,"the photo frame stays hidden under the graphic");
  assert.ok(elements(page).every(element=>!element.smartCenter),"the page's copy keeps the template's place");
  assert.ok(!(deck.document.comments??[]).some(empty),"the note about an empty frame goes");
  assert.ok(model.parseCanvas(page.canvas),"the page is one the editor opens");

  const full=await assembled(),fullPage=full.document.pages[0],count=elements(fullPage).length;
  const filler=Array.from({length:rebuild.MAX_LAYERS-count+1},(_,at)=>model.createCanvasElement("shape",{name:`Shape ${at+1}`,x:10,y:10,width:10,height:10}));
  assert.deepEqual(exact.placeRebuilt(full.document,full.pages,new Map([[0,{elements:filler,groups:[]}]])),["Slide 1: the rebuilt graphic has more layers than the slide holds; add it by hand."]);
  assert.equal(elements(fullPage).length,count,"the page is left as it was");
});

test("code checks a rebuilt slide for words under the minimum, layers off the page or on top of each other, and logos cut from the original",async()=>{
  const {laid}=await rebuilt(),deck=await assembled();
  exact.placeRebuilt(deck.document,deck.pages,new Map([[0,structuredClone(laid)]]));
  const clean=review.rebuildChecks(deck.document,MIN_TEXT);
  assert.deepEqual(clean.map(issue=>[issue.severity,issue.route]),[["note","none"]],"only a note: nothing overlaps or runs off");
  assert.match(clean[0].problem,/^No clean file was found for "Amazon S3" and "Bash", so they are cut from the original/);

  const text=review.slideText(deck.document,deck.pages,catalog);
  assert.match(text,/^Slide 1 · Text \+ Media\n/);
  assert.ok(text.includes("graphic words, in layer order: Software Engineer Today: | Claude Code | Cursor | Codex | All we need now:) | Software Engineer 10 years ago: | AWS | Docker | Kubernetes | Jenkins | S3 | Bash"),text);
  assert.ok(text.includes("graphic logos, in order: Claude, Cursor, OpenAI, Amazon Web Services, Docker, Kubernetes, Jenkins, Amazon S3, Bash"),text);
  assert.ok(text.includes("graphic (image): A man smiling at his desk")&&text.includes("graphic (image): The same man, tired"),text);

  const page=deck.document.pages[0],find=name=>elements(page).find(element=>element.name===name);
  Object.assign(find("Codex label"),{x:find("Cursor label").x,y:find("Cursor label").y});
  find("Photo").x=-20;
  find("Jenkins label").smartText.minFontSize=5;
  elements(page).push(model.createCanvasElement("image",{name:"Picture",x:2,y:2,width:10,height:10,src:"data:image/jpeg;base64,AAAA",publicAlt:"Logos: Git, Bash"}));
  const issues=review.rebuildChecks(deck.document,MIN_TEXT),problem=pattern=>issues.find(issue=>pattern.test(issue.problem));
  assert.equal(problem(/^"Jenkins" may be set under 24 px/)?.severity,"note");
  assert.equal(problem(/^"Photo" runs off the page$/)?.severity,"should_fix");
  assert.equal(problem(/^"Cursor label" and "Codex label" overlap$/)?.severity,"should_fix");
  assert.equal(problem(/^A block of logos stays one picture/)?.severity,"note");
  assert.ok(issues.every(issue=>issue.route==="none"&&issue.slide===1),"code checks go to a person, not back to the copier");
});

// ── The whole run ───────────────────────────────────────────────────────────
const REVIEWED=round=>({round,rendered:false,checks:[],facts:null,design:null,sentBack:[]});
function crew(images,transcript) {
  return {runners:{
    transcript:async context=>{context.cache.images=images;return {output:await transcript()};},
    review:async context=>({output:REVIEWED(context.round)}),
  }};
}
const start=(ownerKey,team)=>orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",url:"https://www.instagram.com/p/meme/",mode:"exact"},{runners:team.runners,environment:async()=>({profile:english,template,templates:model.BUILT_IN_TEMPLATES,guide})});
async function withWeb(site,work) {
  const real=globalThis.fetch;
  globalThis.fetch=site.fetch;
  try{return await work();}finally{globalThis.fetch=real;}
}

test("an exact copy of a meme ends with a deck that rebuilds it, every part its own layer",async()=>{
  const image=await meme(),ownerKey=owner(),site=web();
  const finished=await withWeb(site,async()=>{
    const {file,done}=await start(ownerKey,crew([image],()=>copied([image],TRANSCRIPT)));
    await done;
    return posts.getPostFile(ownerKey,file.id);
  });
  assert.equal(finished.status,"done");
  const view=jobs.postView(finished,false);
  assert.equal(view.stages[0].summary,"Copied 1 slide word for word; 1 graphic to rebuild from its parts");
  assert.ok(site.calls.length,"the logos were looked up");
  assert.ok(site.calls.every(url=>/^https:\/\/(api\.svgl\.app|cdn\.jsdelivr\.net|unpkg\.com)\//.test(url+"/")),"only at the logo sources");

  const deck=await deckLib.loadDeck(ownerKey,view.result.deckId),page=deck.pages[0];
  assert.equal(deck.pages.length,1);
  assert.ok(deck.tags.includes("exact-copy")&&deck.tags.includes("rebuilt-graphics"));
  assert.equal(bySlot(page,"media").hidden,true);
  const layers=elements(page).filter(element=>!element.slot&&!element.templateRole);
  assert.equal(layers.length,26);
  assert.ok(model.parseCanvas(page.canvas),"the page is one the editor opens");
  const notes=(deck.comments??[]).find(comment=>comment.text.startsWith("Notes from Recreate"))?.text??"";
  assert.ok(notes.includes("Slide 1: rebuilt the graphic from its parts in the template: 2 panels, 2 photos and 9 logos, each its own layer."),notes);
  assert.ok(notes.includes("no clean file was found for Amazon S3 and Bash"),notes);
  assert.ok(notes.includes("Logos come from svgl.app and Simple Icons (CC0)."),notes);
  assert.ok(!(deck.comments??[]).some(comment=>comment.text.startsWith("No photo or chart for this slide yet")));
  assert.deepEqual(review.rebuildChecks(deck,MIN_TEXT).filter(issue=>issue.severity!=="note"),[],"nothing overlaps or runs off the page");
});

test("a graphic that can't be rebuilt falls back to a cut, and the run still ends with a deck",async()=>{
  const image=await meme(),ownerKey=owner();
  const finished=await withWeb(web(),async()=>{
    const team=crew([image],async()=>{const plan=await copied([image],TRANSCRIPT);return {...plan,slides:plan.slides.map(slide=>({...slide,original:2}))};});
    const {file,done}=await start(ownerKey,team);
    await done;
    return posts.getPostFile(ownerKey,file.id);
  });
  assert.equal(finished.status,"done");
  const deck=await deckLib.loadDeck(ownerKey,jobs.postView(finished,false).result.deckId);
  assert.ok(!deck.tags.includes("rebuilt-graphics"));
  const notes=(deck.comments??[]).find(comment=>comment.text.startsWith("Notes from Recreate"))?.text??"";
  assert.ok(notes.includes("Slide 1: the graphic couldn't be rebuilt (its original slide is missing), so it is cut whole from the original."),notes);
  assert.equal(elements(deck.pages[0]).filter(element=>!element.slot&&!element.templateRole).length,0,"no half-built graphic is left on the page");
});
