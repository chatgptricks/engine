/* Run: node --test tests/template-editor-recreate-exact-charts.test.mjs
 * Charts an exact copy redraws in our style: bar charts (one series, up to 12
 * bars, the original's highlighted bars in our green) and line charts that end
 * where the original ends; and the chart rebuilder that finds their real
 * numbers. No network: FRED and Claude are stand-ins. */
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
const environment={cwd:()=>root,env:{NODE_ENV:"test"}};
const cache=new Map();
function load(relative) {
  const filename=path.join(root,relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const unit={exports:{}};cache.set(filename,unit);
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText;
  vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
    if(name==="@/lib/supabase/admin")return {getAdminSupabase:()=>null};
    const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
    if(local)return load(path.relative(root,[local+".ts",local+".tsx",local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
    return nativeRequire(name);
  },unit,unit.exports,environment);
  return unit.exports;
}
const chartLib=load("lib/engine/recreate-chart.ts");
const data=load("lib/engine/recreate-data.ts");
const charts=load("lib/engine/agents/charts.ts");
const schemas=load("lib/engine/agents/schemas.ts");

const ACCENT="#00D98A", MUTED="#D9D9D9", BACKGROUND="#0B1014";
const bars=(overrides={})=>({kind:"bar",unit:"%",labels:["Claude","GPT","Gemini","Grok"],series:[{name:"SWE-bench Verified",values:[80.9,74.9,63.8,58.6],emphasis:true}],
  markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",highlight:[0],...overrides});
const rects=svg=>[...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="([^"]+)"( fill-opacity="([\d.]+)")?/g)]
  .map(match=>({x:Number(match[1]),y:Number(match[2]),width:Number(match[3]),height:Number(match[4]),fill:match[5],opacity:match[7]?Number(match[7]):1}));
const texts=svg=>[...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(match=>({x:Number(match[1]),y:Number(match[2]),text:match[3]}));

test("a bar chart draws one bar per value from zero, its value printed at its end, the highlighted bar in our green",()=>{
  const svg=chartLib.chartSvg(bars(),920,700);
  const drawn=rects(svg);
  assert.equal(drawn.length,4,"one bar per value");
  assert.deepEqual(drawn.map(bar=>bar.fill),[ACCENT,MUTED,MUTED,MUTED],"the bar the original sets apart is green, the rest our muted grey");
  assert.deepEqual(drawn.map(bar=>bar.opacity),[1,.5,.5,.5],"the other bars are dimmed");
  assert.ok(drawn[0].height>drawn[1].height&&drawn[1].height>drawn[2].height&&drawn[2].height>drawn[3].height,"bars are as tall as their values");
  const bottom=drawn.map(bar=>Math.round(bar.y+bar.height));
  assert.ok(bottom.every(value=>value===bottom[0]),"every bar starts on the same zero line");
  assert.ok(Math.abs(drawn[1].height/drawn[0].height-74.9/80.9)<.01,"the scale starts at zero, so heights compare honestly");
  const labels=texts(svg).map(item=>item.text);
  for(const value of ["80.9%","74.9%","63.8%","58.6%","Claude","GPT","Gemini","Grok"])assert.ok(labels.includes(value),`${value} is printed`);
  assert.match(svg,new RegExp(`<rect width="920" height="700" fill="${BACKGROUND}"/>`),"on the page's background");
  const plain=rects(chartLib.chartSvg(bars({highlight:[]}),920,700));
  assert.ok(plain.every(bar=>bar.fill===ACCENT&&bar.opacity===1),"with no bar set apart, every bar is green");
});

test("long labels turn the chart into horizontal bars, labels on the left and values after each bar",()=>{
  const chart=bars({labels:["Claude Opus 5.5 (thinking)","GPT-5.1 Codex Max","Gemini 3 Pro Deep Think","Grok 5 Heavy"],highlight:[2]});
  const svg=chartLib.chartSvg(chart,920,700);
  const drawn=rects(svg);
  assert.equal(drawn.length,4);
  assert.ok(drawn.every(bar=>bar.x===drawn[0].x),"every bar starts on the same line");
  assert.ok(drawn[0].width>drawn[3].width,"bars are as long as their values");
  assert.ok(drawn[0].y<drawn[1].y&&drawn[1].y<drawn[2].y,"bars run top to bottom in the original's order");
  assert.equal(drawn[2].fill,ACCENT);
  const words=texts(svg);
  const value=words.find(item=>item.text==="80.9%");
  assert.ok(value&&value.x>drawn[0].x+drawn[0].width,"the value sits after its bar");
  assert.ok(words.filter(item=>/Claude|GPT|Gemini|Grok/.test(item.text)).every(item=>item.x<=drawn[0].x),"the labels sit left of the bars");
  assert.ok(words.every(item=>item.x>=0&&item.x<=920),"nothing leaves the chart");
});

test("negative values keep columns around a zero line, values below the bars that go down",()=>{
  const svg=chartLib.chartSvg(bars({unit:"%",labels:["2023","2024","2025"],series:[{name:"Change in postings",values:[12,-8,-31],emphasis:true}],highlight:[]}),920,700);
  const drawn=rects(svg);
  const zero=Math.round(drawn[0].y+drawn[0].height);
  assert.ok(drawn.slice(1).every(bar=>Math.round(bar.y)===zero),"bars below zero hang from the zero line");
  const minus=texts(svg).find(item=>item.text==="−31%");
  assert.ok(minus&&minus.y>drawn[2].y+drawn[2].height,"a negative value is printed under its bar");
});

test("a bar chart must be one series of 2 to 12 labelled numbers",()=>{
  assert.throws(()=>chartLib.validateChart(bars({labels:["A"],series:[{name:"S",values:[1],emphasis:true}]})),/at least two bars/);
  assert.throws(()=>chartLib.validateChart(bars({labels:Array.from({length:13},(_,i)=>`B${i}`),series:[{name:"S",values:Array.from({length:13},(_,i)=>i+1),emphasis:true}]})),/at most 12 bars/);
  assert.throws(()=>chartLib.validateChart(bars({series:[{name:"A",values:[1,2,3,4],emphasis:true},{name:"B",values:[4,3,2,1],emphasis:false}]})),/one series/);
  assert.throws(()=>chartLib.validateChart(bars({labels:["A","","C","D"]})),/needs a label/);
  assert.throws(()=>chartLib.validateChart(bars({series:[{name:"S",values:[1,NaN,3,4],emphasis:true}]})),/needs a number/);
  const clean=chartLib.validateChart(bars({highlight:[0,0,9,-1,2],markerIndex:2,markers:[{index:1,label:"x",icon:"none"}]}));
  assert.deepEqual(clean.highlight,[0,2],"highlights outside the bars are dropped");
  assert.equal(clean.markerIndex,-1,"bars have no markers");
  assert.deepEqual(clean.markers,[]);
});

test("a bar chart's alt text names every bar and its value, and the highlighted ones",()=>{
  const alt=chartLib.chartAltText(bars(),["the SWE-bench leaderboard"]);
  assert.equal(alt,"Bar chart of SWE-bench Verified: Claude 80.9%, GPT 74.9%, Gemini 63.8%, Grok 58.6%. Highlighted: Claude. Source: the SWE-bench leaderboard.");
});

test("a bar chart renders to a PNG at twice the frame's size, and its colors keep their contrast",async()=>{
  const url=await chartLib.chartPngDataUrl(bars(),600,450);
  assert.match(url,/^data:image\/png;base64,/);
  const bytes=Buffer.from(url.slice(url.indexOf(",")+1),"base64");
  assert.equal(bytes.readUInt32BE(16),1200);
  assert.equal(bytes.readUInt32BE(20),900);
  // The dimmed bars are our muted grey at half strength over the background: still 3:1 against it, as a bar must be.
  const hex=value=>[1,3,5].map(at=>parseInt(value.slice(at,at+2),16));
  const blend=hex(MUTED).map((channel,index)=>channel*.5+hex(BACKGROUND)[index]*.5);
  const light=rgb=>rgb.map(channel=>{const c=channel/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const contrast=(a,b)=>{const [hi,lo]=[light(a),light(b)].sort((x,y)=>y-x);return (hi+.05)/(lo+.05);};
  assert.ok(contrast(blend,hex(BACKGROUND))>=3,`dimmed bars ${contrast(blend,hex(BACKGROUND)).toFixed(2)}:1`);
  assert.ok(contrast(hex(ACCENT),hex(BACKGROUND))>=3,"green bars");
});

test("trillions read as T", ()=>{
  assert.equal(chartLib.formatValue(4.2e12,"$"),"$4.2T");
  assert.equal(chartLib.formatValue(1.25e9,"$"),"$1.3B");
});

const csv=(id,rows)=>`observation_date,${id}\n${rows.map(([date,value])=>`${date},${value}`).join("\n")}\n`;
const months=(start,count,value)=>Array.from({length:count},(_,index)=>{const date=new Date(Date.UTC(start,index,1));return [date.toISOString().slice(0,10),value(index)];});
const fakeFred=series=>async url=>{
  const id=new URL(url).searchParams.get("id");
  return series[id]?new Response(csv(id,series[id]),{status:200,headers:{"Content-Type":"text/csv"}}):new Response("<html>not found</html>",{status:404});
};

test("a line chart ends where the original ends: the end date keeps the period that holds it",async()=>{
  const fetch=fakeFred({IHLIDXUSTPSOFTDEVE:months(2020,70,index=>100+index)});
  const base={unit:"index",labels:[],from:"2021-01-01",markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",
    series:[{name:"Software dev postings",fred:"IHLIDXUSTPSOFTDEVE",values:[],emphasis:true}]};
  const whole=await data.resolveChartData(base,new Map(),{fetch});
  assert.equal(whole.period.to,"2025-10-01","without an end date the chart runs to the latest point");
  const cut=await data.resolveChartData({...base,to:"2024-06-15"},new Map(),{fetch});
  assert.equal(cut.period.from,"2021-01-01");
  assert.equal(cut.period.to,"2024-06-01","June 15 keeps the June point");
  assert.equal(cut.series[0].values.length,42);
});

test("a written chart carries its kind, highlights and end date to the drawer, and older charts read as lines to the latest data",async()=>{
  const written={kind:"bar",unit:"%",labels:["A","B"],series:[{name:"Score",source:"typed",fred:null,values:[50,40],emphasis:true}],from:null,to:null,markerDate:null,indexToMarker:false,
    markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",markers:[],band:null,highlight:[1]};
  assert.equal(schemas.ChartSchema.safeParse(written).success,true);
  const spec=charts.chartSpecFrom(written);
  assert.equal(spec.kind,"bar");
  assert.deepEqual(spec.highlight,[1]);
  const drawn=await charts.resolveChart(written,new Map());
  assert.equal(drawn.kind,"bar");
  assert.deepEqual(drawn.highlight,[1]);
  const {kind,to,highlight,...older}=written;
  void kind;void to;void highlight;
  const old=charts.chartSpecFrom({...older,labels:["2020","2021"]});
  assert.equal(old.kind,"line");
  assert.equal(old.to,null);
  assert.deepEqual(old.highlight,[]);
  assert.equal(schemas.ChartSchema.safeParse(older).success,false,"Engine's own agents always fill the new fields");
  const handedIn=schemas.submittableFor("data","autopilot").safeParse({charts:[{id:"main",purpose:"p",recreates:"the original's chart",chart:older,source:"s"}],notes:[]});
  assert.equal(handedIn.success,true,"a data stage handed in without them still reads");
  assert.equal(handedIn.data.charts[0].chart.kind,"line");
});

// ── The chart rebuilder (the exact copy's data stage) ───────────────────────
// Claude is a stand-in: `work` is replaced for each test, and gets the stage's own check.
const claude=load("lib/engine/agents/claude.ts");
const exactData=load("lib/engine/agents/exact-data.ts");
const plain=value=>JSON.parse(JSON.stringify(value));
const sharp=nativeRequire("sharp");
const english=load("lib/engine/page-profiles.ts").builtInPageProfiles().find(item=>item.id==="chatgptricks");
const original=async()=>({mediaType:"image/png",base64:(await sharp({create:{width:1080,height:1350,channels:3,background:"#EBE8E3"}}).png().toBuffer()).toString("base64")});
const chartSlide=original=>({original,templatePage:1,texts:[{slot:"title",text:`Chart ${original}`}],media:{kind:"chart",box:{x:100,y:300,width:800,height:500},alt:`The chart on slide ${original}`},graphic:null,posts:[]});
const photoSlide=original=>({original,templatePage:0,texts:[{slot:"cover-headline",text:"A cover"}],media:{kind:"photo",box:{x:0,y:0,width:1000,height:600},alt:"A photo"},graphic:null,posts:[]});
const BARS={kind:"bar",unit:"%",labels:["Software","Data"],series:[{name:"Change in openings",source:"typed",fred:null,values:[-29,-12],emphasis:true}],from:null,to:null,
  markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",markers:[],band:null,highlight:[]};
/** The stage's context for a transcript of `slides`, with the original slides `images`. */
const context=(slides,images,extra={})=>({
  ownerKey:"owner",profile:english,signal:new AbortController().signal,round:0,
  file:{id:"post-test",mode:"exact",source:{url:"https://www.instagram.com/p/chart/",owner:"charts_daily",caption:"Jobs vs stocks",notes:"",imageIds:[],slideCount:images.length},
    stages:{transcript:{status:"done",output:{name:"Charts",originalLanguage:"en",translated:false,caption:"",notes:[],slides}}}},
  cache:{images,chartData:new Map()},...extra,
});
/** Runs the stage with Claude handing in `answers` in turn, each checked as the real loop checks it. */
async function rebuild(stageContext,answers=[]) {
  const asked=[],problems=[],real=claude.work;
  claude.work=async call=>{
    asked.push(call);
    for(const answer of answers){const problem=await call.submit.check(answer);if(!problem)return answer;problems.push(problem);}
    throw new Error("no answer passed the check");
  };
  try{return {result:await exactData.exactData(stageContext),asked,problems};}finally{claude.work=real;}
}

test("the chart rebuilder skips a post without charts, and never asks Claude",async()=>{
  const {result,asked}=await rebuild(context([photoSlide(1)],[await original()]));
  assert.deepEqual(plain(result),{output:{note:"No chart to rebuild"},status:"skipped"});
  assert.equal(asked.length,0);
});

test("the chart rebuilder sees each chart cut from its slide, and hands in every boxed slide once, each chart drawn",async()=>{
  const slides=[photoSlide(1),chartSlide(2)];
  const good={charts:[{slide:2,chart:BARS,source:"Printed on the original"}],missing:[],notes:["Copied the printed values"]};
  const {result,asked,problems}=await rebuild(context(slides,[await original(),await original()]),[
    {charts:[{slide:1,chart:BARS,source:"s"}],missing:[],notes:[]},
    {charts:[{slide:2,chart:BARS,source:"s"}],missing:[{slide:2,why:"no data"}],notes:[]},
    {charts:[],missing:[],notes:[]},
    {charts:[{slide:2,chart:{...BARS,labels:["Software"],series:[{...BARS.series[0],values:[-29]}]},source:"s"}],missing:[],notes:[]},
    good,
  ]);
  assert.deepEqual(problems.map(problem=>problem.replace(/: .*$/s,": …")),[
    "Slide 1 has no chart to rebuild. Hand in only slide 2.",
    "Slide 2 is handed in twice. Give each slide one chart, or put it under missing.",
    "Hand in slide 2 too, rebuilt under charts or explained under missing.",
    "The chart for slide 2 can't be drawn: …",
  ]);
  assert.deepEqual(plain(result.output),plain(good));
  const [call]=asked;
  assert.equal(call.role,"data");
  assert.match(call.system,/^You are the chart rebuilder/);
  assert.deepEqual(call.serverTools.map(tool=>tool.name),["web_search","web_fetch"]);
  assert.ok(call.tools.some(tool=>tool.name==="fred_series"),"FRED, through Engine's data tools");
  const images=call.content.filter(block=>block.type==="image");
  assert.equal(images.length,1,"only the chart's slide");
  assert.equal(images[0].source.media_type,"image/jpeg","the chart cut from its slide");
  const words=call.content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
  assert.match(words,/Original slide 2: the chart to rebuild \(The chart on slide 2\)\. The slide's words: Chart 2/);
  assert.match(words,/Original creator: @charts_daily/);
  assert.match(words,/Hand in slide 2, each rebuilt under charts or explained under missing\./);
});

test("a rerun the critics didn't send keeps the charts already rebuilt, and asks only about new ones",async()=>{
  const slides=[chartSlide(2),chartSlide(3)],images=[await original(),await original(),await original()];
  const previous={charts:[{slide:2,chart:BARS,source:"Printed on the original"}],missing:[{slide:5,why:"no data"}],notes:["Earlier"]};
  const fresh={charts:[{slide:3,chart:BARS,source:"FRED"}],missing:[],notes:["New"]};
  const {result,asked}=await rebuild(context(slides,images,{previous}),[fresh]);
  assert.equal(asked.length,1);
  assert.match(asked[0].content.at(-1).text,/Hand in slide 3, each/,"slide 2's chart is kept");
  assert.deepEqual(plain(result.output),{charts:[...previous.charts,...fresh.charts],missing:[],notes:["Earlier","New"]},"slide 5 no longer shows a chart");
  const kept=await rebuild(context([chartSlide(2)],images,{previous}));
  assert.equal(kept.asked.length,0,"nothing new: no call");
  assert.deepEqual(plain(kept.result.output.charts),plain(previous.charts));
  const told=await rebuild(context(slides,images,{previous,instructions:"Slide 2's chart starts in 2020, not 2022"}),[{charts:[{slide:2,chart:BARS,source:"s"},{slide:3,chart:BARS,source:"s"}],missing:[],notes:[]}]);
  assert.match(told.asked[0].content.at(-1).text,/Hand in slides 2, 3, each/,"the critic's fix redoes every chart");
});

test("a chart whose original slide is missing is noted, and Claude is asked only about the ones it can see",async()=>{
  const alone=await rebuild(context([chartSlide(2)],[]));
  assert.equal(alone.asked.length,0);
  assert.deepEqual(plain(alone.result.output.missing),[{slide:2,why:"its original slide is missing"}]);
  const image=await original();
  const mixed=await rebuild(context([chartSlide(1),chartSlide(2)],[image]),[{charts:[{slide:1,chart:BARS,source:"s"}],missing:[],notes:[]}]);
  assert.match(mixed.asked[0].content.at(-1).text,/Hand in slide 1, each/);
  assert.deepEqual(plain(mixed.result.output.missing),[{slide:2,why:"its original slide is missing"}]);
});

// ── Two scales: only an exact copy of an original that prints them ──────────
const twoLines=(overrides={})=>({unit:"K",labels:["2003","","","2025"],series:[{name:"Job openings",values:[3000,4000,12000,7000],emphasis:true,axis:"left"},{name:"S&P 500",values:[900,1400,4800,6200],emphasis:false,axis:"right"}],
  markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"none",markers:[],band:null,range:null,right:{unit:"",range:null},...overrides});
/** Each scale label's text and baseline, by color: the scale labels are the 26 px text at 920 wide. */
const scaleLabels=(svg,color)=>[...svg.matchAll(new RegExp(`<text x="([\\d.]+)" y="([\\d.-]+)"(?: text-anchor="\\w+")? fill="${color}" font-size="26"[^>]*>([^<]+)</text>`,"g"))].map(match=>({x:Number(match[1]),y:Number(match[2]),text:match[3]}));
const EXACT_LINE={kind:"line",unit:"K",labels:["2003","","","2025"],
  series:[{name:"Job openings",source:"typed",fred:null,values:[3000,4000,12000,7000],emphasis:true,axis:"left"},{name:"S&P 500",source:"typed",fred:null,values:[900,1400,4800,6200],emphasis:false,axis:"right"}],
  from:null,to:null,markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"none",markers:[],band:null,highlight:[],
  range:{min:0,max:19000},right:{unit:"",range:{min:-800,max:7200}}};

test("two lines without end labels show their names, one line keeps none",()=>{
  const names=chartLib.validateChart({...twoLines(),series:twoLines().series.map(({axis,...item})=>{void axis;return item;}),right:null});
  assert.equal(names.endLabel,"name");
  assert.equal(chartLib.validateChart({...twoLines(),series:[twoLines().series[0]],right:null}).endLabel,"none");
  const svg=chartLib.chartSvg(names,920,640);
  assert.match(svg,/>Job openings</);
  assert.match(svg,/>S&amp;P 500</);
  assert.doesNotMatch(svg,/>6,200</,"the names alone, without last values");
});

test("an exact copy's lines read against the two scales its original prints, each scale's numbers in its line's color",()=>{
  const chart=chartLib.validateChart(twoLines());
  assert.deepEqual(chart.series.map(item=>item.axis),["left","right"]);
  assert.deepEqual(chart.right,{unit:"",range:null});
  const svg=chartLib.chartSvg(chart,920,640);
  const left=scaleLabels(svg,ACCENT),right=scaleLabels(svg,"#F9FFFE");
  assert.deepEqual(left.map(label=>label.text),["2.5M","5M","7.5M","10M","12.5M"],"job openings, emphasised, in green on the left");
  assert.deepEqual(right.map(label=>label.text),["0","2,000","4,000","6,000","8,000"],"the S&P 500 in white on the right");
  assert.deepEqual(right.map(label=>label.y),left.map(label=>label.y),"with no printed range, both scales share the gridlines");
  assert.ok(right.every(label=>label.x>600&&label.x<700),"the second scale sits in its own column, between the plot and the end labels");
  assert.match(chartLib.chartAltText(chart),/on two scales: Job openings on the left, S&P 500 on the right\./);
  const valued=chartLib.chartSvg(twoLines({endLabel:"value",right:{unit:"$",range:null}}),920,640);
  assert.match(valued,/>\$6,200</,"each line's last value in its own scale's unit");
  assert.match(valued,/>7M</);
  const alike=chartLib.chartSvg(twoLines({series:twoLines().series.map(item=>({...item,emphasis:false}))}),920,640);
  assert.match(alike,/font-weight="600"[^>]*>Job openings<\/text>.*font-weight="600"[^>]*>S&amp;P 500<\/text>/s,"lines alike in color: each scale is headed by its line's name");
});

test("a scale keeps the range its original prints, and drops one that leaves out data, saying why",()=>{
  const kept=chartLib.validateChart(twoLines({range:{min:0,max:19000},right:{unit:"",range:{min:-800,max:7200}}}));
  assert.deepEqual([kept.range,kept.right.range,kept.notes],[{min:0,max:19000},{min:-800,max:7200},undefined]);
  const svg=chartLib.chartSvg(kept,920,640);
  assert.deepEqual(scaleLabels(svg,ACCENT).map(label=>label.text),["0","5M","10M","15M"],"round numbers inside the printed range");
  assert.deepEqual(scaleLabels(svg,"#F9FFFE").map(label=>label.text),["0","2,000","4,000","6,000"]);
  // The range's ends are the plot's: S&P's 900 sits a fifth of the way up from -800 to 7,200, as on the original.
  // The emphasised line is drawn last, on top.
  const [spx,jobs]=[...svg.matchAll(/<polyline points="([^"]+)"/g)].map(match=>match[1].split(" ").map(point=>Number(point.split(",")[1])));
  const zero=scaleLabels(svg,ACCENT)[0].y+8,top=scaleLabels(svg,ACCENT).at(-1).y+8-(zero-(scaleLabels(svg,ACCENT).at(-1).y+8))*(4000/15000);
  assert.ok(Math.abs(jobs[0]-(zero-(zero-top)*3000/19000))<2,"job openings on 0 to 19M");
  assert.ok(Math.abs(spx[0]-(zero-(zero-top)*1700/8000))<2,"the S&P 500 on -800 to 7,200");
  const dropped=chartLib.validateChart(twoLines({range:{min:0,max:10000},right:{unit:"",range:{min:7200,max:-800}}}));
  assert.deepEqual([dropped.range,dropped.right.range],[null,null]);
  assert.deepEqual(dropped.notes,[
    "The left scale's range, 0 to 10M, doesn't hold every value (its lines run from 3M to 12M), so the scale fits the data instead.",
    "The right scale's range needs a lowest value below its highest, so the scale fits the data instead.",
  ]);
});

test("lines all on the second scale, or indexed lines, share one scale",()=>{
  const allRight=chartLib.validateChart(twoLines({series:twoLines().series.map(item=>({...item,axis:"right"})),right:{unit:"pts",range:{min:0,max:13000}}}));
  assert.deepEqual([allRight.series.map(item=>item.axis),allRight.unit,allRight.range,allRight.right],[["left","left"],"pts",{min:0,max:13000},null]);
  const indexed=chartLib.validateChart(twoLines({unit:"index",range:{min:0,max:200}}));
  assert.deepEqual([indexed.series.map(item=>item.axis),indexed.range,indexed.right],[["left","left"],null,null]);
  assert.deepEqual(indexed.notes,["Indexed lines share one scale, so the second scale is left out."]);
});

test("a second scale's gridlines fall on the first's; a printed range's are round numbers inside it",()=>{
  assert.deepEqual(chartLib.alignedTicks(900,6200,4),[0,2000,4000,6000,8000]);
  assert.deepEqual(chartLib.alignedTicks(-12,40,4),[-20,0,20,40,60]);
  assert.deepEqual(chartLib.ticksWithin(-800,7200),[0,2000,4000,6000]);
  assert.deepEqual(chartLib.ticksWithin(0,19000),[0,5000,10000,15000]);
});

test("only an exact copy's chart may use two scales: a full recreation's is drawn on one, whatever it's handed",async()=>{
  const exact=schemas.submittableFor("data","exact").safeParse({charts:[{slide:1,chart:EXACT_LINE,source:"FRED"}],missing:[],notes:[]});
  assert.equal(exact.success,true);
  const drawn=await charts.resolveChart(exact.data.charts[0].chart,new Map());
  assert.deepEqual([drawn.series.map(item=>item.axis),drawn.range,drawn.right],[[undefined,"right"],{min:0,max:19000},{unit:"",range:{min:-800,max:7200}}],"a line is on the left scale unless set");
  const full=schemas.DataSchema.safeParse({charts:[{id:"main",purpose:"p",recreates:"the original's chart",chart:EXACT_LINE,source:"s"}],notes:[]});
  assert.equal(full.success,true);
  assert.deepEqual(["axis" in full.data.charts[0].chart.series[1],"range" in full.data.charts[0].chart,"right" in full.data.charts[0].chart],[false,false,false],"the full recreation's schema has no second scale");
  const flat=charts.oneScale(EXACT_LINE);
  assert.deepEqual([flat.series.some(item=>"axis" in item),"range" in flat,"right" in flat,"axis" in EXACT_LINE.series[1]],[false,false,false,true],"dropped in code too, the original untouched");
  assert.equal((await charts.resolveChart(flat,new Map())).right,undefined);
  const {range,right,...older}=EXACT_LINE;
  void range;void right;
  const handedIn=schemas.submittableFor("data","exact").safeParse({charts:[{slide:1,chart:{...older,series:older.series.map(({axis,...item})=>{void axis;return item;})},source:"s"}],missing:[],notes:[]});
  assert.equal(handedIn.success,true,"an exact chart handed in without scales still reads");
  assert.deepEqual([handedIn.data.charts[0].chart.series.map(item=>item.axis),handedIn.data.charts[0].chart.range,handedIn.data.charts[0].chart.right],[["left","left"],null,null]);
});

test("the chart rebuilder is told how scales work, and gets back a printed range that leaves out real values",async()=>{
  const {result,asked,problems}=await rebuild(context([chartSlide(2)],[await original(),await original()]),[
    {charts:[{slide:2,chart:{...EXACT_LINE,range:{min:0,max:10000}},source:"FRED JTSJOL; S&P 500"}],missing:[],notes:[]},
    {charts:[{slide:2,chart:EXACT_LINE,source:"FRED JTSJOL; S&P 500"}],missing:[],notes:[]},
  ]);
  assert.deepEqual(problems,["The chart for slide 2: The left scale's range, 0 to 10M, doesn't hold every value (its lines run from 3M to 12M), so the scale fits the data instead. Set that range to null, or copy the one the original prints for the same dates."]);
  assert.deepEqual(plain(result.output.charts[0].chart.right),{unit:"",range:{min:-800,max:7200}});
  assert.match(asked[0].system,/Two scales, only when the original prints a second column of numbers/);
  assert.match(asked[0].system,/This overrides the rule to index series in different units/);
});

test("FRED's units set the scale's unit: job openings in thousands print in millions, as the original prints them",async()=>{
  const months=(start,count,value)=>Array.from({length:count},(_,index)=>{const month=start+index;return [`${2003+Math.floor(month/12)}-${String(month%12+1).padStart(2,"0")}-01`,value(index)];});
  const csv={JTSJOL:months(0,24,index=>7000+index*400),SP500:months(0,24,index=>900+index*20)};
  const units={JTSJOL:"Level in Thousands",SP500:"Index"};
  const calls=[];
  const fetch=async url=>{
    calls.push(String(url));
    const at=new URL(url), id=at.searchParams.get("id");
    if(at.pathname==="/graph/api/series/")return id in units?new Response(JSON.stringify({chart_series:[{series_objects:{a:{units:units[id],units_short:"Level"}}}]}),{status:200}):new Response("{}",{status:200});
    return csv[id]?new Response(`observation_date,${id}\n${csv[id].map(row=>row.join(",")).join("\n")}\n`,{status:200}):new Response("<html>not found</html>",{status:404});
  };
  const openings=await data.fetchFredSeries("JTSJOL",{fetch});
  assert.equal(openings.units,"Level in Thousands");
  assert.equal(new URL(calls[0]).pathname,"/graph/fredgraph.csv","the series itself comes first");
  assert.match(data.describeSeries(openings),/Units: Level in Thousands \(a scale of it takes unit K\)/);
  assert.equal(data.unitFromFred("Thousands of Persons"),"K");
  assert.equal(data.unitFromFred("Millions of Dollars"),"","money keeps its $, which a K, M or B scale wouldn't show");
  assert.equal(data.unitFromFred("Percent"),"");
  const two=await data.resolveChartData({unit:"",labels:[],from:null,markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"name",
    range:{min:0,max:19000},right:{unit:"",range:null},
    series:[{name:"New Job Openings",fred:"JTSJOL",values:[],emphasis:true},{name:"S&P500",fred:"SP500",values:[],emphasis:false,axis:"right"}]},new Map(),{fetch});
  assert.equal(two.unit,"K","the openings scale takes K from FRED's thousands");
  assert.equal(two.right.unit,"","the index scale stays plain");
  const drawn=chartLib.validateChart(two);
  assert.deepEqual(drawn.range,{min:0,max:19000},"the printed range, in thousands, still holds the data");
  const svg=chartLib.chartSvg(drawn,1080,1080);
  for(const label of ["5M","10M","15M"])assert.ok(svg.includes(`>${label}</text>`),`the openings scale prints ${label}, in millions as the original's 0-19M`);
  assert.doesNotMatch(svg,/>15,000</);
  const one=(unit,fred)=>data.resolveChartData({unit,labels:[],from:null,markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",
    series:[{name:"Series",fred,values:[],emphasis:true}]},new Map(),{fetch});
  const given=await one("M","JTSJOL");
  assert.equal(given.unit,"K","FRED's thousands win over the M a writer read off the original, which would print 19B");
  assert.ok(chartLib.chartSvg(chartLib.validateChart(given),1080,1080).includes(">10M</text>"));
  assert.equal((await one("$","SP500")).unit,"$","a series FRED gives no thousands, millions or billions keeps the unit given");
});
