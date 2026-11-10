/* Run: node --test tests/template-editor-recreate-pipeline.test.mjs
 * Recreate post, build step: house text rules, cover emphasis, and turning a
 * written carousel into a native editable deck from the real @chatgptricks
 * 3:4 template (charts rendered into the photo slot, notes as comments).
 * No network: Claude and Instagram are never called here. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
function load(relative,env={NODE_ENV:"test"}) {
  const cache=new Map(),environment={cwd:()=>root,env};
  function requireModule(file) {
    const filename=path.join(root,file);
    if(cache.has(filename))return cache.get(filename).exports;
    const unit={exports:{}};cache.set(filename,unit);
    const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename,
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
      const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
      if(local)return requireModule(path.relative(root,[local+".ts",local+".tsx",local].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile())));
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  }
  return requireModule(relative);
}
const recreate=load("lib/engine/recreate.ts");
const model=load("lib/template-editor/model.ts");
const decks=load("lib/template-editor/agent-decks.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const profile=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const pages=decks.agentTemplatePages(template);
const slots=decks.agentTemplateSlots(template);
const pageWith=predicate=>pages.findIndex((page,index)=>predicate(page,index,slots.filter(slot=>slot.pageIndex===index)));

test("the @chatgptricks 3:4 template and profile are wired together",()=>{
  assert.ok(template,"chatgptricks-3x4 is a built-in template");
  assert.ok(profile,"chatgptricks is a built-in page profile");
  assert.equal(profile.templateId,template.id);
  const {width,height}=model.formatDimensions(template);
  assert.deepEqual([width,height],[1080,1440]);
  assert.ok(pageWith((page,index,own)=>own.some(slot=>slot.type==="photo"))>=0,"a page has a photo slot for charts");
});

test("cleanSlideText drops a single final period per line but keeps ellipses",()=>{
  assert.equal(recreate.cleanSlideText("AI is hiring.\nJobs are not.",true),"AI is hiring\nJobs are not");
  assert.equal(recreate.cleanSlideText("Wait for it...",true),"Wait for it...");
  assert.equal(recreate.cleanSlideText("The [[real]] story.",true),"The [[real]] story");
  assert.equal(recreate.cleanSlideText("Ends with [[a phrase.]]",true),"Ends with [[a phrase]]");
  assert.equal(recreate.cleanSlideText("Keep it.",false),"Keep it.");
});

test("emphasis turns [[phrase]] into an accent span and escapes HTML",()=>{
  const plain=recreate.emphasis("No markers here");
  assert.deepEqual(plain,{text:"No markers here"});
  const rich=recreate.emphasis("AI <killed> [[17% of jobs]]\nsince 2022","#00D98A");
  assert.equal(rich.text,"AI <killed> 17% of jobs\nsince 2022");
  assert.match(rich.richText,/&lt;killed&gt;/);
  assert.match(rich.richText,/<span style="color: #00D98A">17% of jobs<\/span>/);
  assert.match(rich.richText,/<br>/);
});

const chart={unit:"index",labels:["Jan 2020","Jan 2022","Nov 2022","Jan 2024","Jan 2026"],from:null,markerDate:null,indexToMarker:false,markerIndex:2,markerLabel:"ChatGPT launch",markerIcon:"openai",endLabel:"change_since_marker",
  series:[{name:"S&P 500",fred:null,values:[100,140,120,150,235],emphasis:false},{name:"Job openings",fred:null,values:[100,160,150,110,106],emphasis:true}]};

function carouselFor() {
  const textSlots=index=>slots.filter(slot=>slot.pageIndex===index&&slot.type==="text");
  const chartPage=pageWith((page,index,own)=>own.some(slot=>slot.type==="photo"));
  const fill=index=>textSlots(index).map(slot=>({slot:slot.slot,text:`Line for ${slot.slot}.`}));
  return {chartPage,carousel:{
    name:"AI vs Jobs",caption:"Caption line one.\n\nSources: BLS JOLTS",
    slides:[
      {templatePage:0,purpose:"cover",texts:[{slot:textSlots(0)[0].slot,text:"AI took [[the jobs]]."}],media:{kind:"none",photoBrief:"",chart:null}},
      {templatePage:chartPage,purpose:"chart",texts:fill(chartPage),media:{kind:"chart",photoBrief:"",chart}},
      {templatePage:chartPage,purpose:"repeat",texts:[...fill(chartPage),{slot:"not-a-slot",text:"x"}],media:{kind:"photo",photoBrief:"Photo of an empty office",chart:null}},
      {templatePage:99,purpose:"bad",texts:[],media:{kind:"none",photoBrief:"",chart:null}},
    ],
    factChecks:[{claim:"Job openings fell 29% since Nov 2022",verdict:"confirmed",detail:"JOLTS, seasonally adjusted",sources:[{title:"BLS JOLTS",url:"https://www.bls.gov/jlt/"}]}],
    notes:["Swapped the source's Indeed data for BLS"],
  }};
}

test("buildRecreatedDeck makes a native deck with emphasis, a chart PNG and notes",async()=>{
  const {chartPage,carousel}=carouselFor();
  const {document,notes}=await recreate.buildRecreatedDeck(profile,template,model.BUILT_IN_TEMPLATES,carousel);
  assert.equal(document.pages.length,3,"the out-of-range page is skipped, the repeated page kept");
  assert.equal(document.templateId,template.id);
  assert.ok(document.tags.includes("recreated")&&document.tags.includes("chatgptricks"));
  assert.ok(notes.some(note=>/page 99/.test(note)));
  assert.ok(notes.some(note=>/not-a-slot/.test(note)));
  const cover=document.pages[0].canvas.elements.find(element=>element.richText&&/the jobs/.test(element.richText));
  assert.ok(cover,"cover emphasis is applied");
  assert.equal(cover.text,"AI took the jobs");
  const chartSlot=slots.find(slot=>slot.pageIndex===chartPage&&slot.type==="photo");
  const element=document.pages[1].canvas.elements.find(item=>item.slot===chartSlot.slot||item.id===chartSlot.slot);
  const src=element.type==="image"?element.src:element.imageFill?.src;
  assert.match(src??"",/^data:image\/png;base64,/,"the chart is a PNG in the photo slot");
  const bodies=document.pages[1].canvas.elements.filter(item=>item.type==="text").map(item=>item.text);
  assert.ok(bodies.every(text=>!/\.$/.test(text)),"no final periods on slide text");
  const comments=document.comments.map(comment=>comment.text);
  assert.ok(comments.some(text=>text.startsWith("Photo to add: Photo of an empty office")));
  assert.ok(comments.some(text=>text.startsWith("Fact check\nCONFIRMED")));
  assert.ok(comments.some(text=>text.startsWith("Notes from Recreate")));
  assert.equal(document.caption,"Caption line one.\n\nSources: BLS JOLTS","captions keep their periods");
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}),"the deck passes Engine's library validation");
});

test("the writer never sees the Reaction pages, and a slide on one is skipped",async()=>{
  const reactionPages=["Reaction","Two reactions","Three reactions"].map(label=>pages.findIndex(page=>page.label===label)),[reaction]=reactionPages;
  assert.ok(reactionPages.every(index=>index>0),"the template has the one-, two- and three-post Reaction pages");
  const visible=recreate.writerPages(template);
  assert.ok(visible.every(page=>!reactionPages.includes(page.index)));
  assert.deepEqual(visible.map(page=>page.index),pages.map((_,index)=>index).filter(index=>!reactionPages.includes(index)),"other pages keep their template index");
  const {carousel}=carouselFor();
  const invented={templatePage:reaction,purpose:"reaction",texts:[{slot:"reaction-text",text:"A post nobody wrote"}],media:{kind:"none",photoBrief:"",chart:null}};
  const {document,notes}=await recreate.buildRecreatedDeck(profile,template,model.BUILT_IN_TEMPLATES,{...carousel,slides:[carousel.slides[0],invented]});
  assert.equal(document.pages.length,1,"only the cover is built");
  assert.ok(!JSON.stringify(document).includes("A post nobody wrote"));
  assert.ok(notes.some(note=>/Reaction page: it shows real posts from X/.test(note)));
});

test("buildRecreatedDeck refuses a carousel with no usable slides",async()=>{
  const {carousel}=carouselFor();
  await assert.rejects(recreate.buildRecreatedDeck(profile,template,model.BUILT_IN_TEMPLATES,{...carousel,slides:[carousel.slides[3]]}),/didn't produce any slides/);
});

const data=load("lib/engine/recreate-data.ts");
const chartLib=load("lib/engine/recreate-chart.ts");
const csv=(id,rows)=>`observation_date,${id}\n${rows.map(([date,value])=>`${date},${value}`).join("\n")}\n`;
const months=(start,count,value)=>Array.from({length:count},(_,index)=>{const date=new Date(Date.UTC(start,index,1));return [date.toISOString().slice(0,10),value(index)];});
function fakeFred(series){
  const calls=[];
  const fn=async url=>{
    calls.push(String(url));
    const id=new URL(url).searchParams.get("id");
    return series[id]?new Response(csv(id,series[id]),{status:200,headers:{"Content-Type":"text/csv"}}):new Response("<html>not found</html>",{status:404});
  };
  fn.calls=calls;return fn;
}

test("FRED CSV parsing keeps missing periods as gaps and rejects non-series pages",()=>{
  assert.deepEqual(data.parseFredCsv("observation_date,SP500\n2023-12-01,.\n2024-01-01,4800.5\n2024-02-01,.\n2024-03-01,\n2024-04-01,5100\n2024-05-01,.\n"),[{date:"2024-01-01",value:4800.5},{date:"2024-02-01",value:NaN},{date:"2024-03-01",value:NaN},{date:"2024-04-01",value:5100}],"gaps inside are kept, missing ends dropped");
  assert.throws(()=>data.parseFredCsv("<!doctype html><p>Error</p>"),/did not return series data/);
  assert.throws(()=>data.fredSeriesId("../etc/passwd"),/FRED series id/);
  assert.equal(data.fredSeriesId(" jtsjol "),"JTSJOL");
});

test("fetchFredSeries only calls FRED's CSV endpoint with a validated id",async()=>{
  const fetch=fakeFred({JTSJOL:months(2020,12,index=>7000+index)});
  const series=await data.fetchFredSeries("jtsjol",{start:"2020-01-01",fetch});
  assert.equal(series.observations.length,12);
  const url=new URL(fetch.calls[0]);
  assert.equal(url.origin+url.pathname,"https://fred.stlouisfed.org/graph/fredgraph.csv");
  assert.equal(url.searchParams.get("id"),"JTSJOL");
  assert.equal(url.searchParams.get("fq"),"Monthly");
  await assert.rejects(data.fetchFredSeries("NOPE",{fetch}),/no series NOPE/);
  await assert.rejects(data.fetchFredSeries("JTSJOL",{start:"2020/01/01",fetch}),/start must be a date/);
  assert.match(data.describeSeries(series),/FRED JTSJOL, monthly, 12 points from 2020-01-01 to 2020-12-01/);
});

test("resolveChartData aligns FRED series, marks the event's period and indexes to it",async()=>{
  const fetch=fakeFred({
    SP500:months(2021,36,index=>100+index*5),
    JTSJOL:months(2020,48,index=>10000-index*50),
  });
  const chart=await data.resolveChartData({
    unit:"index",labels:[],from:"2021-06-01",markerDate:"2022-11-30",indexToMarker:true,markerIndex:-1,markerLabel:"ChatGPT launch",markerIcon:"openai",endLabel:"change_since_marker",
    series:[{name:"S&P 500",fred:"SP500",values:[],emphasis:false},{name:"Job openings",fred:"JTSJOL",values:[],emphasis:true}],
  },new Map(),{fetch});
  assert.equal(chart.series[0].values.length,31,"shared months from Jun 2021 to Dec 2023");
  assert.equal(chart.labels.length,31);
  assert.equal(chart.markerIndex,17,"Nov 30 marks the November 2022 point");
  assert.ok(chart.series.every(series=>series.values[chart.markerIndex]===100),"every series is 100 at the marker");
  assert.equal(chart.unit,"index");
  assert.ok(chart.labels.includes("2022")&&chart.labels.includes("2023"),"spans of 18 months or more are labelled by year");
  await assert.rejects(data.resolveChartData({...chart,from:null,markerDate:null,indexToMarker:false,series:[{name:"A",fred:"SP500",values:[],emphasis:true},{name:"B",fred:null,values:[1,2],emphasis:false}]},new Map(),{fetch}),/can't mix/);
  const typed=await data.resolveChartData({...chart,from:null,markerDate:null,indexToMarker:false,markerIndex:1,series:[{name:"A",fred:null,values:[4,5,6],emphasis:true}]},new Map(),{fetch});
  assert.deepEqual(typed.series[0].values,[4,5,6],"typed-in values pass through untouched");
});

test("chart labels stay short and the baseline is honest",()=>{
  assert.equal(chartLib.formatValue(7612,"K"),"7.6M");
  assert.equal(chartLib.formatValue(12301,"K"),"12.3M");
  assert.equal(chartLib.formatValue(-3.25,"%"),"−3.25%");
  assert.equal(chartLib.formatValue(1534,"$"),"$1,534");
  assert.equal(chartLib.formatValue(250000000,""),"250M");
  const flat=chartLib.chartSvg({unit:"K",labels:["May","Jun","Jul","Aug","Sep"],series:[{name:"Job openings",values:[7612,7224,7398,7227,7523],emphasis:true}],markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value"},920,917);
  assert.match(flat,/>0<\/text>/,"a series that barely moves starts at zero");
  assert.doesNotMatch(flat,/x="-/,"no label starts left of the chart");
  const long=chartLib.chartSvg({unit:"",labels:["2020","2021"],series:[{name:"A remarkably long series name that cannot fit",values:[1,50],emphasis:true}],markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value"},600,600);
  assert.match(long,/…<\/text>/,"over-long end labels are shortened");
});

test("a missing period breaks the line instead of being drawn across",async()=>{
  const fetch=fakeFred({UNRATE:months(2025,6,index=>index===3?".":4+index/10)});
  const series=await data.fetchFredSeries("UNRATE",{fetch});
  assert.match(data.describeSeries(series),/Missing \(charts show a gap\): 2025-04-01/);
  const chart=await data.resolveChartData({unit:"%",labels:[],from:null,markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",series:[{name:"Unemployment",fred:"UNRATE",values:[],emphasis:true}]},new Map([["UNRATE:monthly",series]]),{fetch});
  assert.equal(chart.series[0].values.length,6);
  assert.ok(Number.isNaN(chart.series[0].values[3]));
  const svg=chartLib.chartSvg(chart,920,917);
  assert.equal((svg.match(/<polyline/g)??[]).length,2,"two line segments around the gap");
  assert.match(svg,/>4.5%<\/text>/,"the end label uses the last real value");
  assert.throws(()=>chartLib.validateChart({...chart,series:[{name:"x",values:[NaN,1,NaN],emphasis:true}]}),/two real values/);
});

const spxCsv=rows=>`Date,SP500,Dividend,Earnings\n${rows.map(([date,value])=>`${date},${value},0.0,0.0`).join("\n")}\n`;
function fakeSources(fred,spx){
  const base=fakeFred(fred),calls=base.calls;
  const fn=async url=>{
    if(String(url).startsWith("https://raw.githubusercontent.com/")){calls.push(String(url));return new Response(spxCsv(spx),{status:200});}
    return base(url);
  };
  fn.calls=calls;return fn;
}

test("the S&P 500 history comes from one fixed address and goes back before FRED's 10 years",async()=>{
  assert.deepEqual(data.parseSp500HistoryCsv("Date,SP500,Dividend\n1871-01-01,4.44,0.26\n1871-02-01,4.5,0.26\n2026-09-01,7669.41,0.0\nbad,1,2\n"),[{date:"1871-01-01",value:4.44},{date:"1871-02-01",value:4.5},{date:"2026-09-01",value:7669.41}]);
  assert.throws(()=>data.parseSp500HistoryCsv("<html>"),/did not return series data/);
  const fetch=fakeSources({},months(2001,60,index=>1000+index));
  const series=await data.fetchSp500History({start:"2003-01-01",fetch});
  assert.equal(series.observations[0].date,"2003-01-01");
  assert.equal(series.source,"sp500_history");
  assert.equal(fetch.calls[0],"https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv");
  assert.match(data.describeSeries(series),/S&P 500 monthly average of daily closes/);
  await assert.rejects(data.fetchSp500History({start:"2003/01/01",fetch}),/start must be a date/);
});

test("a chart mixes FRED and the long S&P history on shared months, with markers and a shaded period by date",async()=>{
  const fetch=fakeSources({JTSJOL:months(2000,300,index=>5000+index*10)},months(1990,420,index=>300+index*5));
  const chart=await data.resolveChartData({
    unit:"index",labels:[],from:"2003-01-01",markerDate:"2022-11-30",indexToMarker:true,markerIndex:-1,markerLabel:"ChatGPT Released",markerIcon:"openai",endLabel:"change_since_marker",
    markers:[{date:"2020-03-15",label:"Covid",icon:"none"}],band:{from:"2007-12-01",to:"2009-06-30",label:"Recession"},
    series:[{name:"S&P 500",fred:null,source:{kind:"sp500_history",id:"SP500_HISTORY"},values:[],emphasis:false},{name:"Job openings",fred:"JTSJOL",values:[],emphasis:true}],
  },new Map(),{fetch});
  assert.equal(chart.period.from,"2003-01-01","the original's start date is kept");
  assert.equal(chart.series[0].values.length,chart.labels.length);
  assert.equal(chart.labels[chart.markerIndex]??"","","");
  assert.ok(chart.series.every(series=>series.values[chart.markerIndex]===100),"both lines are 100 at the main marker");
  assert.deepEqual(chart.markers.map(marker=>marker.label),["Covid"]);
  assert.ok(chart.band&&chart.band.from<chart.band.to,"the shaded period resolves to points");
  assert.deepEqual(chart.labels.filter(Boolean),["2005","2010","2015","2020"],"long spans get round year labels");
  const alt=chartLib.chartAltText(chart,["FRED JTSJOL","S&P 500 history, Shiller data"]);
  assert.match(alt,/^Line chart of S&P 500 and Job openings from Jan 2003 to /);
  assert.match(alt,/every line set to 100 at ChatGPT Released/);
  assert.match(alt,/Since ChatGPT Released: S&P 500 [+−]\d+%, Job openings [+−]\d+%/);
  assert.match(alt,/Marked: ChatGPT Released, Covid\. Shaded: Recession\. Source: FRED JTSJOL; S&P 500 history/);
});

test("the writer's chart maps to sources and tolerates older charts",()=>{
  const spec=recreate.chartSpecFrom({unit:"index",labels:[],from:"2003-01-01",markerDate:"2022-11-30",indexToMarker:true,markerIndex:-1,markerLabel:"ChatGPT",markerIcon:"openai",endLabel:"change_since_marker",
    markers:[{date:"2020-03-01",index:-1,label:"Covid",icon:"none"}],band:{fromDate:"2008-01-01",toDate:"2009-06-01",fromIndex:-1,toIndex:-1,label:"Recession"},
    series:[{name:"S&P 500",source:"sp500_history",fred:null,values:[],emphasis:false},{name:"Jobs",source:"fred",fred:"JTSJOL",values:[],emphasis:true}]});
  assert.deepEqual(spec.series.map(series=>series.source),[{kind:"sp500_history",id:"SP500_HISTORY"},{kind:"fred",id:"JTSJOL"}]);
  assert.deepEqual(spec.markers,[{date:"2020-03-01",label:"Covid",icon:"none"}]);
  assert.deepEqual(spec.band,{from:"2008-01-01",to:"2009-06-01",label:"Recession"});
  const old=recreate.chartSpecFrom(chart);
  assert.equal(old.series[0].source,null,"a chart without sources stays typed");
  assert.deepEqual(old.markers,[]);
  assert.equal(old.band,null);
});

test("gridlines use round numbers",()=>{
  assert.deepEqual(chartLib.niceTicks(23,196),[0,50,100,150,200]);
  assert.deepEqual(chartLib.niceTicks(0,7612),[0,2000,4000,6000,8000]);
  assert.deepEqual(chartLib.niceTicks(3.4,4.6),[3,3.5,4,4.5,5]);
  const ticks=chartLib.niceTicks(-12,40);
  assert.ok(ticks.length>=3&&ticks.length<=7&&ticks[0]<=-12&&ticks.at(-1)>=40);
  assert.deepEqual(data.axisLabels(months(2024,34,()=>0).map(([date])=>date)).filter(Boolean),["2024","2025","2026"]);
  assert.deepEqual(data.axisLabels(months(2025,12,()=>0).map(([date])=>date)).filter(Boolean),["Jan 2025","Apr 2025","Jul 2025","Oct 2025"]);
  assert.equal(data.axisLabels(months(2026,9,()=>0).map(([date])=>date)).filter(Boolean).length,9,"under 9 months every month is labelled; the chart thins them");
});

test("the plot starts on the text margin and end labels keep their own column",()=>{
  const width=920,base={unit:"",labels:["2020","","","2021"],markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value"};
  const svg=chartLib.chartSvg({...base,series:[{name:"Unemployment rate",values:[3,4,5,4.2],emphasis:true},{name:"Average",values:[4,4,4,4],emphasis:false}]},width,860);
  const lines=[...svg.matchAll(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/g)].map(match=>[Number(match[1]),Number(match[2])]);
  assert.ok(lines.length>=3&&lines.every(([x1,x2])=>x1===0&&x2===690),"gridlines run from the margin to the label column");
  const points=[...svg.matchAll(/<polyline points="([^"]+)"/g)].map(match=>match[1].split(" ").map(point=>Number(point.split(",")[0])));
  assert.ok(points.every(xs=>xs[0]===3&&xs.at(-1)===687),"lines start on the margin (less half the stroke) and end at the column");
  const ends=[...svg.matchAll(/<text x="([\d.]+)"[^>]*font-weight="600"[^>]*>([^<]+)</g)].map(match=>[Number(match[1]),match[2]]);
  assert.ok(ends.length>=4&&ends.every(([x])=>x>690),"end labels sit in the right column");
  assert.ok(ends.some(([,label])=>label==="Unemployment")&&ends.some(([,label])=>label==="rate"),"a long name wraps instead of shrinking the plot");
  const scale=[...svg.matchAll(/<text x="0" [^>]*paint-order="stroke"[^>]*>([^<]+)</g)].map(match=>match[1]);
  assert.ok(scale.length>=3,"scale labels sit inside the plot on the margin");
  const wider=chartLib.chartSvg({...base,series:[{name:"A",values:[3,4,5,4.2],emphasis:true}]},width,860);
  assert.match(wider,/x2="690"/,"every chart keeps the same plot width");
});

test("marker labels never sit under another marker's line",()=>{
  const values=Array.from({length:94},(_,index)=>index<38?0.1:Math.min(5.3,0.1+(index-38)*0.4));
  const svg=chartLib.chartSvg({unit:"%",labels:[],series:[{name:"Fed funds rate",values,emphasis:true}],markerIndex:38,markerLabel:"First hike",markerIcon:"none",endLabel:"value",
    markers:[{index:46,label:"ChatGPT",icon:"openai"},{index:68,label:"First cut",icon:"none"}]},920,860);
  const labels=[...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" fill="#F9FFFE" font-size="32" font-weight="600"[^>]*>([^<]+)</g)].map(match=>({x:Number(match[1]),y:Number(match[2]),text:match[3]}));
  const markerLines=[...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="[\d.]+" stroke="#F9FFFE" stroke-width="2"/g)].map(match=>({x:Number(match[1]),top:Number(match[2])}));
  assert.equal(labels.length,3);
  assert.equal(markerLines.length,3);
  for(const label of labels){
    const right=label.x+[...label.text].length*32*0.56;
    for(const line of markerLines){
      const crosses=line.x>label.x&&line.x<right&&line.top<label.y;
      assert.ok(!crosses,`${label.text} is not crossed by the line at ${line.x}`);
    }
  }
  assert.match(svg,/<circle[^>]*r="34"/,"the OpenAI icon is drawn");
});

