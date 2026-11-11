/* Run: node --test tests/template-editor-brand-guides.test.mjs
 * Brand guides: validation, the built-in ChatGPTricks guide, the brief every
 * agent reads, versioned per-owner storage, the brands routes, the guide's
 * code checks, and the templates and deck touches drafted from a guide.
 * Only auth, env and Supabase are faked. */
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

/** Loads the project's TypeScript modules, with some imports replaced. */
function loader(overrides={},environment=process) {
  const cache=new Map();
  return function load(relative) {
    const filename=path.join(root,relative);
    if(cache.has(filename))return cache.get(filename).exports;
    const unit={exports:{}};cache.set(filename,unit);
    const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename,
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
      if(Object.hasOwn(overrides,name))return overrides[name];
      const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
      if(local){
        const target=[local,local+".ts",local+".tsx",path.join(local,"index.ts")].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
        if(!target)throw Error(`Unresolved local dependency ${name} from ${relative}`);
        return load(path.relative(root,target));
      }
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  };
}

const pure=loader({"server-only":{}});
const model=pure("lib/template-editor/model.ts");
const {CHATGPTRICKS_TEMPLATE}=pure("lib/template-editor/chatgptricks-template.ts");
const guides=pure("lib/template-editor/brand-guide.ts");
const {builtInBrandGuide,builtInBrandGuides,BUILT_IN_GUIDE_UPDATED_AT}=pure("lib/template-editor/brand-guide-seed.ts");
const {designTemplateFromGuide,applyGuideToDeck,guideTemplateId,isGuideTemplate,templateBrand}=pure("lib/template-editor/guide-template.ts");

const guide=builtInBrandGuide("chatgptricks");
const json=value=>JSON.parse(JSON.stringify(value));
const layers=template=>template.pages.flatMap(page=>page.canvas?.elements??[]);
const isReaction=page=>(page.canvas?.elements??[]).some(element=>element.slot?.startsWith("reaction-"));
const kinds=issues=>issues.map(issue=>`${issue.slide}:${issue.check}`).sort();
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<0.01,`${message}: ${actual} vs ${expected}`);
/** A new brand: the built-in guide's content under another name. */
function newBrand(name) {
  const content=json(guide);
  delete content.id;delete content.version;delete content.updatedAt;
  return {...content,name,logos:[]};
}

function fakeDatabase() {
  const valueAt=(row,column)=>column.startsWith("data->>")?row?.data?.[column.slice(7)]:row?.[column];
  const rows=new Map();
  let writes=0;
  return {
    rows,
    get writes(){return writes;},
    from(table) {
      assert.equal(table,"gf_client_state");
      const conditions=new Map();
      let update,pattern,maximum,range,projection;
      const orderings=[];
      const query={
        abortSignal(){return query;},
        select(columns){projection=columns;return query;},
        eq(column,value){conditions.set(column,value);return query;},
        like(column,value){pattern={column,value};return query;},
        order(column,options){orderings.push({column,...options});return query;},
        range(start,end){range={start,end};return query;},
        limit(value){maximum=value;return query;},
        update(value){update=structuredClone(value);return query;},
        insert(value){
          return {abortSignal(){return this;},then(resolve,reject){return Promise.resolve().then(()=>{
            if(rows.has(value.owner))return {error:{code:"23505"}};
            rows.set(value.owner,structuredClone(value));writes++;
            return {error:null};
          }).then(resolve,reject);}};
        },
        async maybeSingle(){
          await new Promise(resolve=>setImmediate(resolve)); // Let concurrent writers interleave.
          const owner=conditions.get("owner"),row=rows.get(owner);
          if(update){
            if(!row||![...conditions].every(([column,value])=>valueAt(row,column)===value))return {data:null,error:null};
            rows.set(owner,{...row,...update});writes++;
            return {data:{owner},error:null};
          }
          if(projection==="library:data->library,revision:data->>revision,assets:data->assets")return {data:row?structuredClone({library:row.data.library,revision:row.data.revision,assets:row.data.assets}):null,error:null};
          return {data:row?structuredClone(row):null,error:null};
        },
        then(resolve,reject){
          try{
            let selected=[...rows.values()].filter(row=>[...conditions].every(([column,value])=>valueAt(row,column)===value));
            if(pattern){const prefix=pattern.value.replace(/%$/,""),suffix=pattern.value.endsWith("%");selected=selected.filter(row=>suffix?row[pattern.column].startsWith(prefix):row[pattern.column]===prefix);}
            if(orderings.length)selected.sort((a,b)=>{for(const order of orderings){const comparison=String(a[order.column]).localeCompare(String(b[order.column]))*(order.ascending===false?-1:1);if(comparison)return comparison;}return 0;});
            if(range)selected=selected.slice(range.start,range.end+1);
            if(maximum!==undefined)selected=selected.slice(0,maximum);
            return Promise.resolve({data:structuredClone(selected),error:null}).then(resolve,reject);
          }catch(error){return Promise.reject(error).then(resolve,reject);}
        },
      };
      return query;
    },
  };
}

function fixture(t,{db=fakeDatabase(),ownerKey="owner-a",production=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-brand-guides-test-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const environment=Object.assign(Object.create(process),{cwd:()=>directory,env:{NODE_ENV:production?"production":"test"}});
  let access=ownerKey?{kind:"owner",ownerKey}:null;
  const load=loader({
    "@/lib/engine/member":{resolveEngineAccess:async()=>access},
    "@/lib/supabase/admin":{getAdminSupabase:()=>db},
    "server-only":{},
  },environment);
  return {
    db,directory,load,
    setOwner(owner){access=owner?{kind:"owner",ownerKey:owner}:null;},
    storage:()=>load("lib/engine/brand-guides.ts"),
    route:()=>load("app/api/engine/brands/route.ts"),
    templatesRoute:()=>load("app/api/engine/brands/templates/route.ts"),
    checkRoute:()=>load("app/api/engine/brands/check/route.ts"),
    actions:()=>load("lib/engine/brand-actions.ts"),
    agentAccess:()=>load("lib/template-editor/agent-access.ts"),
    persistence:()=>load("lib/template-editor/persistence.ts"),
  };
}

const baseUrl="https://engine.example";
function request(method,{route="/api/engine/brands",query="",body,raw,token,origin,headers={}}={}) {
  const all={"Content-Type":"application/json",...headers};
  if(token!==undefined)all.Authorization=`Bearer ${token}`;
  if(origin!==undefined)all.Origin=origin;
  return new Request(`${baseUrl}${route}${query}`,{method,headers:all,...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{})});
}
const rejectsGuide=(promise,status,pattern)=>assert.rejects(promise,error=>{
  assert.equal(error.name,"BrandGuideError",error.message);assert.equal(error.status,status,error.message);
  if(pattern)assert.match(error.message,pattern);return true;
});

/* ─── The guide itself ───────────────────────────────────────────────────── */

test("parseBrandGuide keeps a clean copy of a guide and lists every problem in a bad one",()=>{
  const {parseBrandGuide}=guides;
  assert.deepEqual(json(parseBrandGuide(json(guide))),json(guide),"the built-in guide round-trips unchanged");
  const tidy=parseBrandGuide({...json(guide),name:"  ChatGPTricks  ",extra:"dropped",colors:guide.colors.map(color=>({...color,value:color.value.toLowerCase()})),layout:{...guide.layout,titleBodyGap:26.12345}},{version:7,updatedAt:"2026-11-08T10:00:00.000Z"});
  assert.equal(tidy.name,"ChatGPTricks");
  assert.equal(tidy.extra,undefined);
  assert.deepEqual(tidy.colors.map(color=>color.value),guide.colors.map(color=>color.value.toUpperCase()));
  assert.equal(tidy.layout.titleBodyGap,26.123);
  assert.deepEqual([tidy.version,tidy.updatedAt],[7,"2026-11-08T10:00:00.000Z"]);

  const base=json(guide);
  const invalid=[
    [null,/^A brand guide object is required/],
    [[base],/^A brand guide object is required/],
    [{...base,id:"Bad Id"},/^id must be 1–48 lowercase/],
    [{...base,name:""},/^name is required/],
    [{...base,colors:base.colors.filter(color=>color.role!=="accent")},/^colors needs an accent color/],
    [{...base,colors:[...base.colors,{id:"red",role:"other",name:"Red",value:"red"}]},/must be a color like #00D98A/],
    [{...base,accentGradient:null},/uses the accent gradient, so accentGradient is required/],
    [{...base,text:[...base.text,{id:"comic",role:"other",name:"Comic",font:"comic-sans",size:20,weight:400,lineHeight:1}]},/font must be one of/],
    [{...base,logos:[{id:"bad",name:"Bad",src:"javascript:alert(1)",width:10,height:10}]},/src must be a site path/],
    [{...base,logos:[{id:"claude",name:"Claude",src:"/claude.svg",width:10,height:10,role:"topic",topics:[]}]},/topic logo, so name at least one topic/],
    [{...base,rules:[{id:"r1",text:"Made up",use:"check",check:"made-up"}]},/check must be one of/],
    [{...base,rules:[{id:"r1",text:"One"},{id:"r1",text:"Two"}]},/repeats the id r1/],
    [{...base,layout:{...base.layout,marginLeft:600,marginRight:600}},/margins leave no room for text/],
    [{...base,bannedWords:Array.from({length:41},(_,index)=>`word${index}`)},/at most 40 items/],
    [{...base,purpose:"Tab\there"},/unsupported characters/],
  ];
  for(const [input,pattern] of invalid) assert.throws(()=>parseBrandGuide(input),error=>{
    assert.equal(error.name,"BrandGuideError");assert.equal(error.status,400);assert.match(error.message,pattern);return true;
  },String(pattern));
  assert.throws(()=>parseBrandGuide({id:"empty"}),error=>error.issues.length>=4&&error.issues.includes("name is required.")&&/\(\d+ more issues\)$/.test(error.message));
});

test("guide images are site paths, HTTPS, safe SVGs or small raster data URLs, and new ids come from names",()=>{
  const {isSafeGuideImage,brandGuideSlug,isBrandGuideId}=guides;
  for(const ok of ["/brand-guides/chatgptricks/example-cover.jpg","https://cdn.example.com/logo.png",`/api/template-editor/assets/${"a".repeat(64)}?w=400`,"data:image/png;base64,iVBORw0KGgo="]) assert.equal(isSafeGuideImage(ok),true,ok);
  for(const bad of ["http://cdn.example.com/logo.png","//evil.example/logo.png","/a/../b.png","/a%2fb.png","javascript:alert(1)","data:image/svg+xml;base64,PHN2Zz4=","data:text/html;base64,PGgxPg==","https://user:secret@example.com/logo.png","",42]) assert.equal(isSafeGuideImage(bad),false,String(bad));
  assert.equal(brandGuideSlug("ChatGPT Tricks"),"chatgpt-tricks");
  assert.equal(brandGuideSlug("  Página Señal!  "),"pagina-senal");
  assert.equal(brandGuideSlug("x".repeat(60)).length,48);
  assert.equal(isBrandGuideId("chatgptricks"),true);
  for(const bad of ["","-a","a-","Upper","a_b","x".repeat(49),42]) assert.equal(isBrandGuideId(bad),false,String(bad));
});

test("the built-in ChatGPTricks guide carries the style guide and the house rules",()=>{
  assert.deepEqual(builtInBrandGuides().map(item=>item.id),["chatgptricks"]);
  assert.deepEqual([guide.version,guide.updatedAt],[1,BUILT_IN_GUIDE_UPDATED_AT]);
  const color=role=>guides.guideColor(guide,role);
  assert.deepEqual(["background","text","accent","accent-end","surface","secondary","source"].map(color),["#0B1014","#FFFFFF","#00D98A","#32FFBB","#1A242B","#D9D9D9","#7D858A"]);
  assert.deepEqual(json(guide.accentGradient),{from:"#00D98A",to:"#32FFBB",angle:180});
  const style=role=>guides.guideTextStyle(guide,role);
  assert.deepEqual([style("title").font,style("title").fill,style("body").font,style("cover").font,style("follow").font],["sfpro","accent-gradient","sfpro","bebas","bebas"]);
  assert.deepEqual([style("source").size,style("source").color],[24,"source"]);
  assert.deepEqual(json(guide.layout),{width:1080,height:1440,marginLeft:72,marginRight:72,marginTop:90,marginBottom:88,titleBodyGap:26,headerContentGap:64,minTextSize:24,media:"natural"});
  const rule=id=>guide.rules.find(item=>item.id===id);
  assert.match(rule("w-follow").text,/21 characters/);
  assert.match(rule("c-remark").text,/SWIPE FOR MORE/);
  assert.match(rule("c-hype").text,/INSANE/);
  assert.match(rule("y-reactions").text,/no source line/);
  assert.equal(rule("y-reactions").use,"guide","Reaction pages are an exception the checks leave alone");
  assert.ok(guide.rules.every(item=>!item.text.endsWith(".")),"house style: no final periods");
  assert.deepEqual([...guides.enabledChecks(guide)].sort(),[...guides.GUIDE_CHECK_KINDS].filter(kind=>kind!=="x-font").sort(),"every code check is on (the X font check needs no rule: it runs whenever X's font is missing)");
  assert.equal(guide.hooks.method,"headline-engine");
  for(const image of [...guide.logos,...guide.examples]) assert.ok(fs.existsSync(path.join(root,"public",image.src)),`${image.src} ships with the app`);
});

test("the brief tells every agent the guide in plain words",()=>{
  const brief=guides.guideBrief(guide);
  assert.ok(brief.startsWith("BRAND GUIDE: ChatGPTricks, version 1 (from ChatGPTricks Style Guide and the Recreate house rules, Nov 2026)"));
  for(const part of [
    "Purpose: ChatGPTricks turns AI and technology stories",
    "- Green #00D98A: Top of the accent gradient",
    "- Accent gradient #00D98A to #32FFBB, top to bottom inside the letters",
    "- Content title: SF Pro Display 56 px, weight 700, line height 1.04, sentence case, accent gradient inside the letters",
    "- Cover headline: Bebas Neue 97 px, weight 400, line height 0.836, capitals, text",
    "Layout: 1080 × 1440 px. Text margins 72 px left and 72 px right (text 936 px wide), 26 px from title to text, about 64 px from the text to the media. Nothing under 24 px. Photos and videos keep their own proportions",
    "- Reaction pages keep their own design: no source line",
    "Never in our headlines: BREAKING:, exciting, amazing, ..., …",
    "Approved example posts: Cover (",
    "Checked on every post (a critic or code flags anything that breaks these):\n- Content titles in sentence case",
  ]) assert.ok(brief.includes(part),part);
  assert.ok(brief.split("\n").filter(line=>line.startsWith("- ")).every(line=>!/[^.]\.$/.test(line)),"house style: no final periods");
  assert.ok(!brief.includes("Topic logos on file"));
  const topical={...guide,logos:[...guide.logos,{id:"claude",role:"topic",name:"Claude",src:"/claude.svg",width:1,height:1,topics:["Claude","Anthropic"],note:""}]};
  assert.match(guides.guideBrief(topical),/Topic logos on file: Claude\. A cover that names one of these carries its logo/);
  assert.deepEqual(json(guides.guideSummary(guide)),{id:"chatgptricks",name:"ChatGPTricks",version:1,updatedAt:BUILT_IN_GUIDE_UPDATED_AT,source:guide.source,colors:7,textStyles:7,logos:1,topicLogos:0,examples:3,rules:guide.rules.length,checks:15});
});

test("topic logos match whole words a cover names, in the cover's order, two at most",()=>{
  const topical=guides.parseBrandGuide({...json(guide),logos:[...json(guide.logos),
    {id:"claude",role:"topic",name:"Claude",src:"/c.svg",width:1,height:1,topics:["Claude","Anthropic"]},
    {id:"openai",role:"topic",name:"OpenAI",src:"/o.svg",width:1,height:1,topics:["OpenAI","ChatGPT"]},
    {id:"meta",role:"topic",name:"Meta",src:"/m.svg",width:1,height:1,topics:["Meta"]},
    {id:"gemini",role:"topic",name:"Gemini",src:"/g.svg",width:1,height:1,topics:["Gemini 2.5"]},
  ]});
  const found=(text,max)=>guides.topicLogosFor(text,topical,max).map(logo=>logo.id);
  assert.deepEqual(found("ANTHROPIC SUED OPENAI"),["claude","openai"]);
  assert.deepEqual(found("OPENAI SUED ANTHROPIC"),["openai","claude"]);
  assert.deepEqual(found("THE METAVERSE IS BACK"),[],"whole words only");
  assert.deepEqual(found("CHATGPT, CLAUDE AND META"),["openai","claude"]);
  assert.deepEqual(found("CHATGPT, CLAUDE AND META",3),["openai","claude","meta"]);
  assert.deepEqual(found("GOOGLE'S GEMINI 2.5 IS HERE"),["gemini"]);
  assert.deepEqual(found("THE TRICKS LOGO"),[],"brand logos are never topics");
});

/* ─── Checks ─────────────────────────────────────────────────────────────── */

test("deck checks flag copy and added layers slide by slide, and leave Reaction pages alone",()=>{
  const deck=model.createDesign(designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"en"}));
  assert.deepEqual(guides.runGuideChecks(deck,guide,{scope:"deck",language:"en"}),[],"the template's sample copy passes");
  const at=(index,slot)=>deck.pages[index].canvas.elements.find(element=>element.slot===slot);
  const headline=at(0,"cover-headline");
  headline.text="Breaking: OpenAI did it — again.";delete headline.richText;delete headline.wordTextures;
  at(0,"cover-remark").text="HERE'S WHAT HAPPENED WHEN WE TRIED IT FOR A WEEK";
  at(1,"title").text="The Jobs That Artificial Intelligence Cannot Replace";
  at(1,"body").text="Since ChatGPT came out, stocks went up and job openings went down across every single industry";
  // A layer someone added: off-palette, an unknown font, too small and past the margin.
  const add=(index,extra={})=>{
    const note={...structuredClone(at(1,"body")),id:`added-${index}`,name:"Added note",color:"#FF0000",font:"inter",fontSize:6,x:0,width:100,align:"left",text:"Note.",...extra};
    for(const key of ["slot","templateRole","protected","smartFlow","smartText"]) delete note[key];
    deck.pages[index].canvas.elements.push(note);
  };
  add(2);
  add(3,{hidden:true});
  const reaction=deck.pages.findIndex(isReaction);
  assert.ok(reaction>0);
  add(reaction);
  const issues=guides.runGuideChecks(deck,guide,{scope:"deck",language:"en"});
  assert.deepEqual(kinds(issues),["1:banned-words","1:cover-remark","1:no-em-dash","1:no-final-period","1:upper-cover","2:body-length","2:sentence-case-titles","3:fonts","3:min-text-size","3:palette","3:text-margins"]);
  const of=kind=>issues.find(issue=>issue.check===kind);
  assert.deepEqual([of("upper-cover").severity,of("upper-cover").route],["must_fix","copy"]);
  assert.deepEqual([of("palette").severity,of("palette").route],["should_fix","none"]);
  assert.match(of("palette").problem,/“Added note” uses #FF0000, which isn't in the ChatGPTricks colors/);
  assert.match(of("banned-words").problem,/“BREAKING:”/);

  const skipped=guides.runGuideChecks(deck,guide,{scope:"deck",skip:["no-final-period","upper-cover"],slideOf:index=>index+10});
  assert.ok(!skipped.some(issue=>issue.check==="no-final-period"||issue.check==="upper-cover"));
  assert.deepEqual([...new Set(skipped.map(issue=>issue.slide))].sort(),[10,11,12]);
  const relaxed={...guide,rules:guide.rules.filter(rule=>rule.check!=="palette")};
  assert.ok(!guides.runGuideChecks(deck,relaxed,{scope:"deck"}).some(issue=>issue.check==="palette"),"a check runs only when a rule turns it on");

  assert.equal(guides.notSentenceCase("AI vs Jobs"),null);
  assert.equal(guides.notSentenceCase("THE JOBS AI CAN'T REPLACE"),"capitals");
  assert.equal(guides.notSentenceCase("GPT-5 is here"),null);

  const spanish=model.createDesign(designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"es"}));
  assert.deepEqual(guides.runGuideChecks(spanish,guide,{scope:"deck",language:"es"}),[],"the Spanish sample copy passes too");
  spanish.pages[0].canvas.elements.find(element=>element.slot==="cover-headline").text="ÓSCAR CREÓ UNA APP Y AHORA LA USAN MILES";
  assert.deepEqual(guides.runGuideChecks(spanish,guide,{scope:"deck",language:"es"}),[],"accented capitals are capitals");
});

test("template checks find what the original template misses, and measure padded text where its words are",()=>{
  const original=guides.runGuideChecks(CHATGPTRICKS_TEMPLATE,guide,{scope:"template",language:"en"});
  const found=new Set(kinds(original));
  for(const expected of ["2:accent-fill","3:accent-fill"]) assert.ok(found.has(expected),expected);
  assert.ok(![...found].some(kind=>kind.endsWith(":spacing")),"the template's text sits the guide's 26 px under its title");
  const loose=structuredClone(CHATGPTRICKS_TEMPLATE),body=loose.pages[1].canvas.elements.find(element=>element.slot==="body");
  body.smartFlow.gap+=4;
  assert.ok(kinds(guides.runGuideChecks(loose,guide,{scope:"template",language:"en"})).includes("2:spacing"),"text further under its title than the guide's gap is found");
  assert.ok(original.every(issue=>issue.route==="none"),"template issues go to designers, not writers");
  assert.ok(!original.some(issue=>CHATGPTRICKS_TEMPLATE.pages[issue.slide-1]&&isReaction(CHATGPTRICKS_TEMPLATE.pages[issue.slide-1])),"Reaction pages keep their own design");

  const spanish=designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"es"});
  const title=spanish.pages[1].canvas.elements.find(element=>element.slot==="title");
  assert.ok(title.padding>0&&title.x*3<72,"the Spanish title's box reaches past the margin by its accent room");
  assert.deepEqual(guides.runGuideChecks(spanish,guide,{scope:"template",language:"es"}),[]);
  title.padding=0;
  assert.ok(kinds(guides.runGuideChecks(spanish,guide,{scope:"template",language:"es"})).includes("2:text-margins"),"without the padding the same box is past the margin");
});

/* ─── Templates and decks from a guide ───────────────────────────────────── */

test("templates drafted from the guide follow it in English and Spanish, and keep Reaction pages as they are",()=>{
  for(const language of ["en","es"]) {
    const draft=designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language});
    assert.equal(draft.id,`chatgptricks-guide-${language}`);
    assert.equal(draft.id,guideTemplateId("chatgptricks",language));
    assert.ok(isGuideTemplate(draft.id,"chatgptricks"));
    assert.equal(templateBrand(draft),"chatgptricks");
    assert.equal(draft.custom,true);
    for(const tag of ["brand:chatgptricks","brand-guide:chatgptricks@1",`language:${language}`]) assert.ok(draft.tags.includes(tag),tag);
    assert.deepEqual(draft.pages.map(page=>page.label),CHATGPTRICKS_TEMPLATE.pages.map(page=>page.label));
    const parsed=model.parseLibrary({...model.EMPTY_LIBRARY,templates:[draft]});
    assert.ok(parsed,`Engine accepts the ${language} draft`);
    assert.deepEqual(json(parsed.templates[0]),json(draft),"and keeps every field");
    assert.deepEqual(guides.runGuideChecks(draft,guide,{scope:"template",language}),[],`the ${language} draft passes its guide`);
    CHATGPTRICKS_TEMPLATE.pages.forEach((page,index)=>{
      if(isReaction(page))assert.deepEqual(json(draft.pages[index]),json(page),`${page.label} is left alone`);
    });
    const titles=draft.pages.filter(page=>page.canvas&&!isReaction(page)).flatMap(page=>page.canvas.elements).filter(element=>element.slot==="title");
    assert.ok(titles.length>=2);
    for(const title of titles) assert.deepEqual(title.gradient.stops.map(stop=>stop.color),["#00D98A","#32FFBB"],"content titles carry the accent gradient");
    const headline=layers(draft).find(element=>element.slot==="cover-headline");
    assert.match(headline.richText,/<span data-texture-id="accent">/,"the cover's key words carry the gradient");
    assert.deepEqual(headline.wordTextures.map(texture=>texture.id),["accent"]);
    const remark=layers(draft).find(element=>element.slot==="cover-remark");
    assert.deepEqual([remark.text,remark.color,remark.font],[language==="es"?"DESLIZA PARA VER MÁS":"SWIPE FOR MORE","#D9D9D9","sfpro"]);
    const spots=layers(draft).filter(element=>element.slot==="topic-logo"||element.slot==="topic-logo-2");
    assert.equal(spots.length,2);
    assert.ok(spots.every(spot=>spot.type==="image"&&spot.hidden),"topic logo spots wait, hidden, for a deck that names a topic");
  }
  const spanish=designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"es"});
  assert.equal(layers(spanish).find(element=>element.id==="cgt-follow-line").text,"SIGUE ESTA PÁGINA");
  assert.match(spanish.name,/en español/);
});

test("Spanish drafts give accented capitals room without moving a single word",()=>{
  const english=designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"en"}),spanish=designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"es"});
  const coverEn=layers(english).find(element=>element.slot==="cover-headline"),coverEs=layers(spanish).find(element=>element.slot==="cover-headline");
  assert.equal(coverEn.padding??0,0,"English needs no accent room");
  near(coverEs.padding,coverEs.fontSize*0.2,"Bebas gets a fifth of its size");
  near(coverEs.x+coverEs.padding,coverEn.x,"the words keep their left edge");
  near(coverEs.width-2*coverEs.padding,coverEn.width,"and their line length");
  near(coverEs.smartText.anchorBottom-coverEs.padding,coverEn.smartText.anchorBottom,"and their bottom");
  for(const element of layers(spanish)) if(element.smartFlow) assert.ok(element.smartFlow.gap>=0,`${element.id} keeps a gap Engine accepts`);

  const media=spanish.pages.find(page=>page.canvas?.elements.some(element=>element.type==="image"&&element.smartFlow?.after==="body"));
  const find=matches=>media.canvas.elements.find(matches);
  const title=find(element=>element.slot==="title"),body=find(element=>element.slot==="body"),photo=find(element=>element.type==="image"&&element.smartFlow?.after==="body");
  assert.ok(title.padding>0&&body.padding>0);
  near(body.smartFlow.gap+title.padding+body.padding,26/3,"26 px from the title to the text");
  near(photo.smartFlow.gap+body.padding,64/3,"64 px from the text to the media");

  // The Follow page's two lines sit flush: the green line gets the padding and the white line drops its line box to match.
  const cta=layers(spanish).find(element=>element.id==="cgt-follow-cta"),line=layers(spanish).find(element=>element.id==="cgt-follow-line");
  assert.ok(cta.padding>0);
  assert.equal(line.padding??0,0);
  assert.deepEqual([line.verticalAlign,line.smartFlow.gap,line.smartFlow.direction],["bottom",0,"up"]);
  assert.ok(line.lineHeight>=0.5);
  near(cta.padding+line.lineHeight*line.fontSize/2,0.92*line.fontSize/2,"the white line's words sit where they would with no padding");
});

test("Spanish accent room leaves centred blocks, hugging cards and inline badges as they are",()=>{
  // The Reaction page's layout under other names, so a draft treats it as an ordinary page.
  const page=json(CHATGPTRICKS_TEMPLATE.pages.find(item=>item.label==="Reaction"));
  const rename=key=>key==="title"?"post-title":key.replace(/^reaction-/,"post-");
  for(const element of page.canvas.elements) {
    element.id=element.id.replace(/^cgt-reaction-/,"cgt-post-");
    if(element.slot)element.slot=rename(element.slot);
    if(element.smartFlow)element.smartFlow={...element.smartFlow,after:rename(element.smartFlow.after),...(element.smartFlow.hug?{hug:{...element.smartFlow.hug,after:rename(element.smartFlow.hug.after)}}:{})};
  }
  const plain={...json(page.canvas.elements.find(element=>element.id==="cgt-post-x-com")),id:"cgt-post-plain"};
  delete plain.smartFlow;
  page.canvas.elements.push(plain);
  assert.ok(!isReaction(page));
  const kinds=new Set(page.canvas.elements.flatMap(element=>[element.smartCenter&&"center",element.smartFlow?.hug&&"hug",element.smartFlow?.direction==="right"&&"right"]).filter(Boolean));
  assert.deepEqual([...kinds].sort(),["center","hug","right"],"the page uses all three layouts");

  const drafted=designTemplateFromGuide(guide,{...json(CHATGPTRICKS_TEMPLATE),pages:[page]},{language:"es"}).pages[0].canvas.elements;
  const geometry=element=>json({x:element.x,y:element.y,width:element.width,height:element.height,padding:element.padding??0,lineHeight:element.lineHeight,smartFlow:element.smartFlow,smartCenter:element.smartCenter});
  for(const element of page.canvas.elements.filter(item=>item.id!==plain.id)) assert.deepEqual(geometry(drafted.find(item=>item.id===element.id)),geometry(element),`${element.id} keeps its box`);
  near(drafted.find(item=>item.id===plain.id).padding,plain.fontSize*0.12,"a layer outside them still gets accent room");
});

test("decks on a guide's template get the gradient words, the remark and the logos the cover names",()=>{
  const topical=guides.parseBrandGuide({...json(guide),logos:[...json(guide.logos),
    {id:"claude",role:"topic",name:"Claude",src:"/template-editor/orbits.svg",width:400,height:300,topics:["Claude","Anthropic"]},
    {id:"openai",role:"topic",name:"OpenAI logo",src:"/logos/openai.png",previewSrc:"/logos/openai-small.png",width:200,height:200,topics:["OpenAI","ChatGPT"]},
  ]});
  const template=designTemplateFromGuide(topical,CHATGPTRICKS_TEMPLATE,{language:"en"});
  const deck=model.createDesign(template);
  const cover=slot=>deck.pages[0].canvas.elements.find(element=>element.slot===slot);
  const headline=cover("cover-headline");
  headline.text="CHATGPT MAKER OPENAI JUST SUED ANTHROPIC OVER CLAUDE";
  headline.richText='CHATGPT MAKER OPENAI JUST SUED <span style="color: #00D98A">ANTHROPIC OVER CLAUDE</span>';
  delete headline.wordTextures;
  cover("cover-remark").text="";
  assert.deepEqual(applyGuideToDeck(deck,topical,{swipeText:"SWIPE FOR MORE"}),["Added the OpenAI logo to the cover.","Added the Claude logo to the cover."]);
  assert.equal(headline.richText,'CHATGPT MAKER OPENAI JUST SUED <span data-texture-id="accent">ANTHROPIC OVER CLAUDE</span>');
  assert.deepEqual(headline.wordTextures.map(texture=>texture.id),["accent"]);
  assert.equal(cover("cover-remark").text,"SWIPE FOR MORE","an empty remark becomes SWIPE FOR MORE");
  const first=cover("topic-logo"),second=cover("topic-logo-2");
  assert.deepEqual([first.src,first.previewSrc,first.hidden,first.publicAlt,first.intrinsicWidth,first.fit],["/logos/openai.png","/logos/openai-small.png",false,"OpenAI logo",200,"contain"]);
  assert.deepEqual([second.src,"previewSrc" in second,second.hidden,second.publicAlt,second.intrinsicWidth,second.intrinsicHeight],["/template-editor/orbits.svg",false,false,"Claude logo",400,300]);

  const written=model.createDesign(template);
  written.pages[0].canvas.elements.find(element=>element.slot==="cover-remark").text="HERE'S OUR TOP 16";
  applyGuideToDeck(written,topical,{swipeText:"SWIPE FOR MORE"});
  assert.equal(written.pages[0].canvas.elements.find(element=>element.slot==="cover-remark").text,"HERE'S OUR TOP 16","a remark the writer chose stays");

  const other=model.createDesign(CHATGPTRICKS_TEMPLATE),before=JSON.stringify(other);
  assert.deepEqual(applyGuideToDeck(other,topical,{swipeText:"SWIPE FOR MORE"}),[]);
  assert.equal(JSON.stringify(other),before,"decks on other templates are left alone");

  const flatGuide=guides.parseBrandGuide({...json(topical),accentGradient:null,text:json(topical.text).map(style=>({...style,fill:"solid"}))});
  const flat=model.createDesign(designTemplateFromGuide(flatGuide,CHATGPTRICKS_TEMPLATE,{language:"en"}));
  const flatHeadline=flat.pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
  flatHeadline.text="OPENAI SUED";flatHeadline.richText='OPENAI <span style="color:#FF0000">SUED</span>';delete flatHeadline.wordTextures;
  applyGuideToDeck(flat,flatGuide,{swipeText:"SWIPE FOR MORE"});
  assert.equal(flatHeadline.richText,'OPENAI <span style="color:#00D98A">SUED</span>',"with no gradient, highlighted words take the flat accent");
  assert.equal(flatHeadline.wordTextures,undefined);
});

test("plain hooks keep the house rules and leave out the engine's formulas, data and proven covers",()=>{
  const {headlineEngineInstructions}=pure("lib/engine/agents/headline-engine.ts");
  const options={language:"es",room:90,notes:["Never invent numbers"]};
  const engine=headlineEngineInstructions(options),plain=headlineEngineInstructions({...options,plain:true});
  assert.match(engine,/^HOOKS: WRITE THEM WITH THE HEADLINE ENGINE/);
  assert.match(plain,/^HOOKS: WRITE THEM IN THE PAGE'S OWN VOICE/);
  for(const section of ["WHAT THE DATA SAYS","ARCHETYPES\n","FORMULAS\n","PROVEN COVERS BY ARCHETYPE"]) {
    assert.ok(engine.includes(section),section);
    assert.ok(!plain.includes(section),section);
  }
  for(const kept of ["STYLE\n","NEVER\n","CHECK YOUR TOP THREE","SPANISH:","THIS PAGE'S BRAND GUIDE SAYS\n- Never invent numbers","about 90 characters"]) assert.ok(plain.includes(kept),kept);
  assert.match(plain,/write "Plain" as each hook's framework/);
  assert.ok(plain.length<engine.length/2);
});

/* ─── Storage ────────────────────────────────────────────────────────────── */

test("a built-in guide is version 1 until a workspace saves its own versions, each one restorable",async t=>{
  const f=fixture(t),s=f.storage();
  const [listed]=await s.listBrandGuides("owner-a");
  assert.deepEqual([listed.id,listed.version,listed.builtIn,listed.overridden],["chatgptricks",1,true,false]);
  assert.deepEqual(json(await s.brandGuideVersions("owner-a","chatgptricks")),[{version:1,updatedAt:BUILT_IN_GUIDE_UPDATED_AT,savedBy:"person",note:"Built-in version"}]);
  assert.equal(f.db.writes,0,"reading never writes");

  const edited=await s.saveBrandGuide("owner-a",{id:"chatgptricks",bannedWords:["BREAKING:","INSANE"]},{expectedVersion:1,savedBy:"agent",note:"  Ban INSANE  "});
  assert.deepEqual([edited.version,edited.builtIn,edited.overridden,edited.savedBy,edited.note],[2,true,true,"agent","Ban INSANE"]);
  assert.deepEqual(json(edited.bannedWords),["BREAKING:","INSANE"]);
  assert.deepEqual(json(edited.colors),json(guide.colors),"fields left out keep their value");
  assert.notEqual(edited.updatedAt,BUILT_IN_GUIDE_UPDATED_AT);

  const writes=f.db.writes;
  await rejectsGuide(s.saveBrandGuide("owner-a",{id:"chatgptricks",name:"Stale edit"},{expectedVersion:1}),409,/now at version 2, newer than the version 1 you edited/);
  assert.equal(f.db.writes,writes,"a stale save writes nothing");

  const restored=await s.restoreBrandGuide("owner-a","chatgptricks",1);
  assert.deepEqual([restored.version,restored.note,restored.savedBy],[3,"Restored version 1","person"]);
  assert.deepEqual(json(restored.bannedWords),json(guide.bannedWords));
  assert.deepEqual((await s.brandGuideVersions("owner-a","chatgptricks")).map(item=>[item.version,item.savedBy,item.note]),[[3,"person","Restored version 1"],[2,"agent","Ban INSANE"],[1,"person","Built-in version"]]);
  assert.deepEqual(json((await s.getBrandGuideVersion("owner-a","chatgptricks",2)).bannedWords),["BREAKING:","INSANE"]);
  assert.equal(await s.getBrandGuideVersion("owner-a","chatgptricks",9),null);
  await rejectsGuide(s.restoreBrandGuide("owner-a","chatgptricks",9),404,/isn't saved any more/);
  assert.equal((await s.getBrandGuide("owner-b","chatgptricks")).version,1,"another workspace keeps the original");
  assert.equal(await s.getBrandGuide("owner-a","../etc"),null);
  assert.equal(await s.getBrandGuide("owner-a","missing"),null);
  await rejectsGuide(s.listBrandGuides(""),401);
});

test("new brands get an id from their name, stay in their workspace, and can be deleted",async t=>{
  const f=fixture(t),s=f.storage();
  const created=await s.saveBrandGuide("owner-a",newBrand("Página Señal"),{expectedVersion:0});
  assert.deepEqual([created.id,created.version,created.builtIn,created.overridden,created.savedBy],["pagina-senal",1,false,false,"person"]);
  assert.deepEqual((await s.brandGuideVersions("owner-a","pagina-senal")).map(item=>item.version),[1]);
  assert.equal((await s.saveBrandGuide("owner-a",{id:"pagina-senal",personality:"Calm"},{expectedVersion:1})).version,2);
  assert.deepEqual((await s.listBrandGuides("owner-a")).map(item=>item.id),["chatgptricks","pagina-senal"]);
  assert.deepEqual((await s.listBrandGuides("owner-b")).map(item=>item.id),["chatgptricks"]);

  const writes=f.db.writes;
  await assert.rejects(s.saveBrandGuide("owner-a",{...newBrand("Broken"),colors:[]}),error=>error.status===400&&error.issues.includes("colors needs a background color."));
  await rejectsGuide(s.saveBrandGuide("owner-a",{name:"!!!"}),400,/^id must be/);
  await rejectsGuide(s.saveBrandGuide("owner-a","not an object"),400);
  await rejectsGuide(s.saveBrandGuide("",newBrand("No Owner")),401);
  assert.equal(f.db.writes,writes,"invalid saves write nothing");

  await rejectsGuide(s.deleteBrandGuide("owner-a","chatgptricks"),400,/Restore version 1/);
  assert.equal(await s.deleteBrandGuide("owner-a","missing"),false);
  assert.equal(await s.deleteBrandGuide("owner-b","pagina-senal"),false,"another workspace can't delete it");
  assert.equal(await s.deleteBrandGuide("owner-a","pagina-senal"),true);
  assert.deepEqual((await s.listBrandGuides("owner-a")).map(item=>item.id),["chatgptricks"]);
});

test("history keeps the last 25 versions, and saved data that can't be read is never destroyed",async t=>{
  const f=fixture(t),s=f.storage();
  for(let index=0;index<27;index++) await s.saveBrandGuide("owner-a",{id:"chatgptricks",purpose:`Purpose ${index}`},{note:"n".repeat(300)});
  const versions=await s.brandGuideVersions("owner-a","chatgptricks");
  assert.equal(versions.length,26,"the current version and 25 before it");
  assert.deepEqual([versions[0].version,versions.at(-1).version],[28,3]);
  assert.equal(versions[0].note.length,200);

  f.db.rows.set("brand-guides:owner-c",{owner:"brand-guides:owner-c",data:{revision:"r1",guides:{chatgptricks:{current:{guide:{id:"chatgptricks",name:""}},history:[]},"broken-brand":{current:"garbage"}}}});
  assert.deepEqual((await s.listBrandGuides("owner-c")).map(item=>[item.id,item.overridden]),[["chatgptricks",false]],"unreadable versions fall back to the built-in, unreadable brands are skipped");
  await s.saveBrandGuide("owner-c",newBrand("Fresh Brand"));
  assert.deepEqual(json(f.db.rows.get("brand-guides:owner-c").data.guides["broken-brand"]),{current:"garbage"});

  f.db.rows.set("brand-guides:owner-d",{owner:"brand-guides:owner-d",data:{guides:"garbage"}});
  await rejectsGuide(s.listBrandGuides("owner-d"),503,/could not be read/);
  await rejectsGuide(s.saveBrandGuide("owner-d",newBrand("Other Brand")),503);
  assert.deepEqual(f.db.rows.get("brand-guides:owner-d").data,{guides:"garbage"});
});

test("concurrent saves from separate server instances all land through revision checks",async t=>{
  const db=fakeDatabase(),one=fixture(t,{db}).storage(),two=fixture(t,{db}).storage();
  await Promise.all([one.saveBrandGuide("owner-a",newBrand("First Brand")),two.saveBrandGuide("owner-a",newBrand("Second Brand")),one.saveBrandGuide("owner-a",{id:"chatgptricks",purpose:"Edited"})]);
  assert.deepEqual((await two.listBrandGuides("owner-a")).map(item=>item.id),["chatgptricks","first-brand","second-brand"]);
  assert.equal((await two.getBrandGuide("owner-a","chatgptricks")).purpose,"Edited");
});

test("local development keeps guides in their own file, and production requires cloud storage",async t=>{
  const f=fixture(t,{db:null}),s=f.storage();
  await s.saveBrandGuide("owner-a",newBrand("Local Brand"));
  await s.saveBrandGuide("owner-a",{id:"chatgptricks",purpose:"Local edit"});
  const folder=path.join(f.directory,".engine-dev","template-editor","brand-guides");
  const files=fs.readdirSync(folder);
  assert.equal(files.length,1);
  assert.match(files[0],/^[a-f0-9]{64}\.json$/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(folder,files[0]),"utf8")).guides).sort(),["chatgptricks","local-brand"]);
  assert.deepEqual((await s.listBrandGuides("owner-a")).map(item=>item.id),["chatgptricks","local-brand"]);
  assert.deepEqual((await s.listBrandGuides("owner-b")).map(item=>item.id),["chatgptricks"]);
  const production=fixture(t,{db:null,production:true}).storage();
  await rejectsGuide(production.listBrandGuides("owner-a"),503,/Cloud storage is not configured/);
});

/* ─── Routes and actions ─────────────────────────────────────────────────── */

test("the brands route serves people and agent tokens, scoped to their workspace",async t=>{
  const f=fixture(t),route=f.route();
  const listed=await route.GET(request("GET"));
  assert.equal(listed.status,200);
  assert.equal(listed.headers.get("cache-control"),"private, no-store");
  const summaries=(await listed.json()).guides;
  assert.deepEqual(summaries.map(item=>[item.id,item.version,item.builtIn,item.overridden,item.checks]),[["chatgptricks",1,true,false,15]]);

  const one=await (await route.GET(request("GET",{query:"?id=chatgptricks"}))).json();
  assert.equal(one.guide.id,"chatgptricks");
  assert.match(one.brief,/^BRAND GUIDE: ChatGPTricks, version 1/);
  assert.deepEqual(one.versions.map(item=>item.version),[1]);
  assert.deepEqual(one.pages.map(page=>page.id),["chatgptricks","pagina-es"],"the pages that follow this guide");
  assert.deepEqual([one.pages[0].handle,one.pages[0].language,one.pages[0].templateId],["@chatgptricks","en","chatgptricks-3x4"]);
  assert.equal((await route.GET(request("GET",{query:"?id=nope"}))).status,404);
  assert.equal((await (await route.GET(request("GET",{query:"?id=chatgptricks&version=1"}))).json()).guide.version,1);
  for(const version of ["2","abc","-1"]) assert.equal((await route.GET(request("GET",{query:`?id=chatgptricks&version=${version}`}))).status,404,version);

  const created=await route.PUT(request("PUT",{origin:baseUrl,body:{guide:newBrand("Mi Marca"),expectedVersion:0,note:"First version"}}));
  assert.equal(created.status,200,await created.clone().text());
  const saved=await created.json();
  assert.deepEqual([saved.guide.id,saved.guide.version,saved.guide.savedBy,saved.guide.note],["mi-marca",1,"person","First version"]);
  assert.match(saved.brief,/^BRAND GUIDE: Mi Marca, version 1/);
  assert.equal((await (await route.PUT(request("PUT",{body:{id:"chatgptricks",purpose:"Sent without a guide wrapper"}}))).json()).guide.version,2);
  assert.equal((await route.PUT(request("PUT",{body:{guide:{id:"chatgptricks",purpose:"Stale"},expectedVersion:1}}))).status,409);
  const invalid=await route.PUT(request("PUT",{body:{guide:{...newBrand("Bad Brand"),colors:[]}}}));
  assert.equal(invalid.status,400);
  assert.deepEqual((await invalid.json()).issues,["colors needs a background color.","colors needs a text color.","colors needs an accent color."]);
  assert.equal((await route.PUT(request("PUT",{raw:"{broken"}))).status,400);
  assert.equal((await route.PUT(request("PUT",{raw:JSON.stringify({guide:{purpose:"x".repeat(1_600_000)}})}))).status,413);

  const restored=await route.POST(request("POST",{body:{action:"restore",id:"chatgptricks",version:1}}));
  assert.equal(restored.status,200);
  assert.equal((await restored.json()).guide.version,3);
  assert.equal((await route.POST(request("POST",{body:{action:"undo"}}))).status,400);
  assert.equal((await route.POST(request("POST",{body:{action:"restore",id:"chatgptricks"}}))).status,400);
  assert.equal((await route.POST(request("POST",{body:{action:"restore",id:"chatgptricks",version:42}}))).status,404);

  assert.equal((await route.DELETE(request("DELETE"))).status,400);
  assert.equal((await route.DELETE(request("DELETE",{query:"?id=chatgptricks"}))).status,400);
  assert.equal((await route.DELETE(request("DELETE",{query:"?id=nope"}))).status,404);
  assert.deepEqual(await (await route.DELETE(request("DELETE",{query:"?id=mi-marca"}))).json(),{deleted:true,id:"mi-marca"});

  // Agent tokens act for the workspace that created them, and their saves are marked as the agent's.
  const {token}=await f.agentAccess().createAgentCredential("owner-b","Recreate agent");
  f.setOwner(null);
  assert.equal((await route.GET(request("GET"))).status,401);
  const agentSave=await route.PUT(request("PUT",{token,body:{guide:{id:"chatgptricks",bannedWords:["BREAKING:"]},expectedVersion:1,note:"Agent edit"}}));
  assert.equal(agentSave.status,200,await agentSave.clone().text());
  assert.equal((await agentSave.json()).guide.savedBy,"agent");
  assert.equal((await (await route.GET(request("GET",{token}))).json()).guides[0].version,2,"owner-b's versions, not owner-a's");
  for(const headers of [{Authorization:"Bearer definitely-invalid"},{Authorization:"Basic Zm9vOmJhcg=="}]) assert.equal((await route.GET(request("GET",{headers}))).status,401);
});

test("the brands routes refuse unauthenticated and cross-origin requests before reading or writing",async t=>{
  const f=fixture(t,{ownerKey:null}),route=f.route(),templates=f.templatesRoute(),check=f.checkRoute();
  const draft={route:"/api/engine/brands/templates",body:{brandId:"chatgptricks",language:"en"}},checking={route:"/api/engine/brands/check",body:{templateId:"chatgptricks-3x4"}};
  assert.equal((await route.GET(request("GET"))).status,401);
  assert.equal((await route.PUT(request("PUT",{body:newBrand("X Brand")}))).status,401);
  assert.equal((await route.POST(request("POST",{body:{action:"restore",id:"chatgptricks",version:1}}))).status,401);
  assert.equal((await route.DELETE(request("DELETE",{query:"?id=x-brand"}))).status,401);
  assert.equal((await templates.POST(request("POST",draft))).status,401);
  assert.equal((await check.POST(request("POST",checking))).status,401);
  f.setOwner("owner-a");
  const evil="https://evil.example";
  for(const method of ["GET","PUT","POST","DELETE"]) {
    const body=method==="PUT"?newBrand("X Brand"):method==="POST"?{action:"restore",id:"chatgptricks",version:1}:undefined;
    assert.equal((await route[method](request(method,{origin:evil,query:"?id=x-brand",body}))).status,403,method);
  }
  assert.equal((await templates.POST(request("POST",{...draft,origin:evil}))).status,403);
  assert.equal((await check.POST(request("POST",{...checking,origin:evil}))).status,403);
  assert.equal(f.db.writes,0);
});

test("a drafted template is saved in the workspace and passes its guide, and decks on it are checked",async t=>{
  const f=fixture(t,{db:null}),actions=f.actions(),store=f.persistence();
  const drafted=await actions.draftTemplateFromGuide("owner-a",{brandId:"chatgptricks",language:"es"});
  assert.deepEqual([drafted.template.id,drafted.replaced,drafted.issues.length],["chatgptricks-guide-es",false,0]);
  assert.deepEqual(drafted.pagesUsingIt,[],"no page switches to a draft by itself");
  assert.deepEqual(drafted.template.pages,CHATGPTRICKS_TEMPLATE.pages.map(page=>page.label),"the draft keeps the base template's pages");
  assert.ok(drafted.template.tags.includes("language:es"));
  assert.equal((await actions.draftTemplateFromGuide("owner-a",{brandId:"chatgptricks",language:"es"})).replaced,true);
  let stored=await store.getEditorLibrary("owner-a");
  assert.equal(stored.library.templates.filter(item=>item.id==="chatgptricks-guide-es").length,1,"a new draft replaces the old one");
  await rejectsGuide(actions.draftTemplateFromGuide("owner-a",{brandId:"nope",language:"en"}),404);
  await rejectsGuide(actions.draftTemplateFromGuide("owner-a",{brandId:"chatgptricks",language:"en",baseTemplateId:"chatgptricks-guide-es"}),400,/original template/);
  await rejectsGuide(actions.draftTemplateFromGuide("owner-a",{brandId:"chatgptricks",language:"en",baseTemplateId:"missing"}),404);

  const passes=await actions.checkAgainstGuide("owner-a",{templateId:"chatgptricks-guide-es"});
  assert.deepEqual([passes.brand.id,passes.target.kind,passes.issues.length],["chatgptricks","template",0]);
  assert.match(passes.summary,/passes every ChatGPTricks guide check/);
  assert.ok(passes.checks.some(item=>item.kind==="spacing")&&!passes.checks.some(item=>item.kind==="no-final-period"),"templates get layout checks, not copy checks");
  // The original template names no brand; the page that uses it does.
  const original=await actions.checkAgainstGuide("owner-a",{templateId:"chatgptricks-3x4"});
  assert.ok(original.issues.some(issue=>issue.check==="accent-fill"));

  const deck=f.load("lib/template-editor/model.ts").createDesign(stored.library.templates.find(item=>item.id==="chatgptricks-guide-es"));
  const headline=deck.pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
  headline.text="breaking: óscar lo hizo.";delete headline.richText;delete headline.wordTextures;
  await store.saveEditorLibrary("owner-a",{...stored.library,designs:[deck,...stored.library.designs]},stored.revision);
  const checked=await actions.checkAgainstGuide("owner-a",{deckId:deck.id});
  // Whether X's font is missing depends on this machine's font files; text-accents.test.ts covers that check.
  assert.deepEqual(kinds(checked.issues.filter(issue=>issue.check!=="x-font")),["1:banned-words","1:no-final-period","1:upper-cover"]);
  assert.equal(checked.target.kind,"deck");
  const xFont=checked.issues.some(issue=>issue.check==="x-font")?1:0;
  assert.equal(checked.summary,`${3+xFont} issues against the ChatGPTricks guide (2 must fix, ${1+xFont} should fix).`);
  assert.ok(!checked.checks.some(item=>item.kind==="spacing"),"decks get copy and layer checks");
  for(const [input,status] of [[{},400],[{deckId:deck.id,templateId:"chatgptricks-3x4"},400],[{templateId:"missing"},404],[{deckId:"missing"},404],[{templateId:"chatgptricks-guide-es",brandId:"nope"},404]]) await rejectsGuide(actions.checkAgainstGuide("owner-a",input),status);

  const templates=f.templatesRoute(),check=f.checkRoute();
  assert.equal((await templates.POST(request("POST",{route:"/api/engine/brands/templates",body:{brandId:"chatgptricks",language:"fr"}}))).status,400);
  const viaRoute=await templates.POST(request("POST",{route:"/api/engine/brands/templates",body:{brandId:"chatgptricks",language:"en"}}));
  assert.equal(viaRoute.status,201,await viaRoute.clone().text());
  assert.equal((await viaRoute.json()).template.id,"chatgptricks-guide-en");
  const checkedViaRoute=await check.POST(request("POST",{route:"/api/engine/brands/check",body:{templateId:"chatgptricks-guide-en"}}));
  assert.equal(checkedViaRoute.status,200,await checkedViaRoute.clone().text());
  assert.deepEqual((await checkedViaRoute.json()).issues,[]);
  stored=await store.getEditorLibrary("owner-a");
  assert.deepEqual(stored.library.templates.map(item=>item.id).filter(id=>id.startsWith("chatgptricks-guide-")).sort(),["chatgptricks-guide-en","chatgptricks-guide-es"]);
});

test("Recreate's team reads the guide's brief, and its deck checks leave the house checks to the house",async t=>{
  const f=fixture(t),team=f.load("lib/engine/agents/brand.ts");
  const profile={id:"chatgptricks",name:"ChatGPTricks",handle:"@chatgptricks",language:"en",voice:"House voice.",rules:[],format:{noFinalPeriods:true,bodyMaxLines:2},brandId:"chatgptricks"};
  const briefed=team.withGuideBrief(profile,guide);
  assert.ok(briefed.voice.startsWith("House voice.\n\nThis page follows the ChatGPTricks brand guide below. Everything you make must fit it.\n\nBRAND GUIDE: ChatGPTricks, version 1"));
  assert.equal(team.withGuideBrief(profile,null),profile);
  assert.equal((await team.loadGuide("owner-a",profile)).id,"chatgptricks");
  assert.equal(await team.loadGuide("owner-a",{...profile,brandId:undefined}),null);
  assert.equal(await team.loadGuide("owner-a",{...profile,brandId:"missing"}),null);

  const deck=model.createDesign(designTemplateFromGuide(guide,CHATGPTRICKS_TEMPLATE,{language:"en"}));
  const headline=deck.pages[0].canvas.elements.find(element=>element.slot==="cover-headline");
  headline.text="Breaking: it happened — again.";delete headline.richText;delete headline.wordTextures;
  const issues=team.guideDeckChecks(deck,profile,guide);
  assert.deepEqual(issues.map(issue=>issue.problem),["The cover-headline text uses an em dash","The cover-headline uses “BREAKING:”"],"capitals and final periods are the house checks' job");
  assert.deepEqual(Object.keys(issues[0]).sort(),["fix","problem","route","severity","slide"]);
  assert.deepEqual(team.guideDeckChecks(deck,profile,null),[]);
});
