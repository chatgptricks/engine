/* Run: node --test tests/template-editor-recreate-logos.test.mjs
 * Logos for graphics an exact copy rebuilds: looked up by exact name in the
 * brand guide, svgl, Simple Icons and Lobe Icons, in that order; cleaned before
 * use; drawn in their dark-page version on a dark card, recolored or tiled when
 * they would vanish, trimmed to their mark; fetched once. A one-color line
 * drawing (mostly anti-aliased edges at the size it is judged at) still counts
 * as one flat color. Every request goes to a stand-in fetch: nothing here
 * reaches the network. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import sharp from "sharp";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const environment={cwd:()=>"/tmp/none",env:{NODE_ENV:"test"}};
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
const logos=load("lib/engine/logos.ts");
const model=load("lib/template-editor/model.ts");

const SVGL="https://api.svgl.app", SIMPLE=`${logos.LOGO_SOURCES.simpleIcons}`, LOBE=logos.LOGO_SOURCES.lobe;
const CARD="#1A242B", PAGE_LIGHT="#FAFAFA";
const square=(color,{box="0 0 24 24",d="M2 2h20v20H2z"}={})=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"><path fill="${color}" d="${d}"/></svg>`;
const simpleIcon=title=>`<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${title}</title><path d="M2 2h20v20H2z"/></svg>`;
/** A stand-in for fetch over a fixed set of files: every other URL is a 404. It records each URL asked for. */
function web(files) {
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(!Object.hasOwn(files,url))return new Response("not found",{status:404});
    const body=files[url];
    return new Response(typeof body==="string"?body:JSON.stringify(body),{status:200});
  };
  return {fetch:fetcher,calls,count:url=>calls.filter(call=>call===url).length};
}
const svglIndex=entries=>({[SVGL]:entries});
const simpleIndex=icons=>({[`${SIMPLE}/data/simple-icons.json`]:icons});
const svgOf=src=>decodeURIComponent(src.slice(model.BRAND_SVG_PREFIX.length));

test("names match exactly: Java isn't JavaScript, Git isn't GitHub Copilot, and short names find full ones",async()=>{
  const site=web({
    ...svglIndex([
      {title:"JavaScript",route:`${SVGL}/library/javascript.svg`},
      {title:"GitHub Copilot",route:`${SVGL}/library/copilot.svg`},
      {title:"Amazon Web Services",route:`${SVGL}/library/aws.svg`},
      {title:"Kafka",route:`${SVGL}/library/kafka.svg`},
    ]),
    [`${SVGL}/library/javascript.svg`]:square("#F7DF1E"),[`${SVGL}/library/copilot.svg`]:square("#FFFFFF"),
    [`${SVGL}/library/aws.svg`]:square("#FF9900"),[`${SVGL}/library/kafka.svg`]:square("#FFFFFF"),
  });
  const [java,git,aws,kafka,js]=await logos.findLogos([{brand:"Java"},{brand:"Git"},{brand:"AWS"},{brand:"Apache Kafka"},{brand:"JS"}],{background:CARD,fetch:site.fetch});
  assert.equal(java,null,"Java is not JavaScript");
  assert.equal(git,null,"Git is not GitHub Copilot");
  assert.equal(aws?.name,"Amazon Web Services","AWS is the short name for Amazon Web Services");
  assert.equal(kafka?.name,"Kafka","Apache Kafka is Kafka without its vendor");
  assert.equal(js?.name,"JavaScript");
  assert.equal(logos.logoKey("Node.js"),"nodejs");
  assert.equal(logos.logoKey("C++"),"cplusplus");
});

test("the guide's own logos come first, then svgl, then Simple Icons, then Lobe Icons",async()=>{
  const guideLogo={id:"claude",name:"Claude logo",src:"/logos/claude.png",width:100,height:100,role:"topic",topics:["Claude","Anthropic"],note:""};
  const site=web({
    ...svglIndex([{title:"Claude",route:`${SVGL}/library/claude.svg`},{title:"Figma",route:`${SVGL}/library/figma.svg`}]),
    [`${SVGL}/library/claude.svg`]:square("#D97757"),[`${SVGL}/library/figma.svg`]:square("#A259FF"),
    ...simpleIndex([{title:"Figma",slug:"figma",hex:"F24E1E"},{title:"Docker",slug:"docker",hex:"2496ED"}]),
    [`${SIMPLE}/icons/figma.svg`]:simpleIcon("Figma"),[`${SIMPLE}/icons/docker.svg`]:simpleIcon("Docker"),
    [`${LOBE}/deepseek-color.svg`]:square("#4D6BFE"),
  });
  const [claude,figma,docker,deepseek,nothing]=await logos.findLogos([{brand:"Anthropic"},{brand:"Figma"},{brand:"Docker"},{brand:"DeepSeek"},{brand:"Nowhere Inc"}],{guide:{logos:[guideLogo]},background:CARD,fetch:site.fetch});
  assert.equal(claude.source,"guide","the team's approved file wins");
  assert.equal(claude.src,"/logos/claude.png");
  assert.equal(figma.source,"svgl","svgl before Simple Icons");
  assert.equal(figma.sourceUrl,`${SVGL}/library/figma.svg`);
  assert.equal(docker.source,"simple-icons");
  assert.match(svgOf(docker.src),/#2496ED/i,"a Simple Icons mark takes its brand's color");
  assert.equal(deepseek.source,"lobe");
  assert.equal(nothing,null,"a brand no source has is left for the caller to cut from the original");
});

test("the brand is tried in every source before the label: the mark decides",async()=>{
  const site=web({
    ...svglIndex([{title:"Codex",route:`${SVGL}/library/codex.svg`}]),[`${SVGL}/library/codex.svg`]:square("#FFFFFF"),
    ...simpleIndex([{title:"OpenAI",slug:"openai",hex:"412991"}]),[`${SIMPLE}/icons/openai.svg`]:simpleIcon("OpenAI"),
  });
  const [found]=await logos.findLogos([{brand:"OpenAI",label:"Codex"}],{background:CARD,fetch:site.fetch});
  assert.equal(found.name,"OpenAI","the OpenAI knot over a Codex label is OpenAI's");
});

test("on a dark card a logo uses its dark-page version; on a light page its light one",async()=>{
  const files={...svglIndex([{title:"Cursor",route:{light:`${SVGL}/library/cursor_light.svg`,dark:`${SVGL}/library/cursor_dark.svg`}}]),
    [`${SVGL}/library/cursor_light.svg`]:square("#141414"),[`${SVGL}/library/cursor_dark.svg`]:square("#EDECEC")};
  const [dark]=await logos.findLogos([{brand:"Cursor"}],{background:CARD,fetch:web(files).fetch});
  const [light]=await logos.findLogos([{brand:"Cursor"}],{background:PAGE_LIGHT,fetch:web(files).fetch});
  assert.equal(dark.sourceUrl,`${SVGL}/library/cursor_dark.svg`);
  assert.match(svgOf(dark.src),/#EDECEC/i);
  assert.equal(light.sourceUrl,`${SVGL}/library/cursor_light.svg`);
});

test("a one-color mark that would vanish is drawn in the page's ink; one with several colors sits on a light tile",async()=>{
  const site=web({
    ...svglIndex([{title:"Vanta",route:`${SVGL}/library/vanta.svg`},{title:"Duo",route:`${SVGL}/library/duo.svg`},{title:"Bright",route:`${SVGL}/library/bright.svg`}]),
    [`${SVGL}/library/vanta.svg`]:square("#111111"),
    [`${SVGL}/library/duo.svg`]:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#111111" d="M0 0h12v24H0z"/><path fill="#3A1A8A" d="M12 0h12v24H12z"/></svg>',
    [`${SVGL}/library/bright.svg`]:square("#F7DF1E"),
  });
  const [vanta,duo,bright]=await logos.findLogos([{brand:"Vanta"},{brand:"Duo"},{brand:"Bright"}],{background:CARD,ink:"#FFFFFF",fetch:site.fetch});
  assert.match(svgOf(vanta.src),/fill="#FFFFFF"/,"a black mark on the dark card is drawn white");
  assert.doesNotMatch(svgOf(vanta.src),/#111111/);
  assert.equal(vanta.tile,false);
  assert.equal(duo.tile,true,"a dark mark with several colors keeps its colors on a light tile");
  assert.match(svgOf(duo.src),/#3A1A8A/i);
  assert.equal(bright.tile,false);
  assert.match(svgOf(bright.src),/#F7DF1E/i,"a mark that shows is left as it is");
});

test("a mark in one flat color keeps it only at the contrast text needs: Jenkins red turns white, Docker blue stays",async()=>{
  const site=web({
    ...simpleIndex([{title:"Jenkins",slug:"jenkins",hex:"D24939"},{title:"Docker",slug:"docker",hex:"2496ED"},{title:"Kubernetes",slug:"kubernetes",hex:"326CE5"}]),
    [`${SIMPLE}/icons/jenkins.svg`]:simpleIcon("Jenkins"),[`${SIMPLE}/icons/docker.svg`]:simpleIcon("Docker"),[`${SIMPLE}/icons/kubernetes.svg`]:simpleIcon("Kubernetes"),
    ...svglIndex([{title:"LinkedIn",route:`${SVGL}/library/linkedin.svg`}]),
    [`${SVGL}/library/linkedin.svg`]:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0A66C2" d="M0 0h24v24H0z"/><path fill="#FFFFFF" d="M5 9h3v10H5zM10 9h3v10h-3zM14 12h4v7h-4z"/></svg>',
  });
  const [jenkins,docker,kubernetes,linkedin]=await logos.findLogos([{brand:"Jenkins"},{brand:"Docker"},{brand:"Kubernetes"},{brand:"LinkedIn"}],{background:CARD,ink:"#F9FFFE",fetch:site.fetch});
  assert.equal(logos.FLAT_MARK_CONTRAST,4.5);
  assert.match(svgOf(jenkins.src),/fill="#F9FFFE"/,"Jenkins red (3.6:1 on the card) is drawn in the page's ink");
  assert.doesNotMatch(svgOf(jenkins.src),/#D24939/i);
  assert.match(svgOf(kubernetes.src),/fill="#F9FFFE"/,"Kubernetes blue (3.3:1) too");
  assert.match(svgOf(docker.src),/#2496ED/i,"Docker blue (5.0:1) keeps its color");
  assert.match(svgOf(linkedin.src),/#0A66C2/i,"a logo with details in a second color is never flattened");
  assert.match(svgOf(linkedin.src),/#FFFFFF/i);
  assert.equal(linkedin.tile,false);
  assert.ok([jenkins,docker,kubernetes].every(logo=>logo.tile===false));
});

// A line drawing like Jenkins' butler: strokes thin enough that, at the 48 px a logo is judged at, most
// of what shows is an anti-aliased edge. A <style> makes it a file the safe vector form can't hold, so it
// is drawn as a PNG, as Jenkins' was.
const CARD_RGB=[0x1A,0x24,0x2B],INK="#F9FFFE",STYLED="<style>.unused{fill:#000}</style>";
const lineDrawing=(colors,extra="")=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="384" height="384">${extra}<g fill="none" stroke-width="4"><circle stroke="${colors[0]}" cx="50" cy="50" r="40"/><path stroke="${colors.at(-1)}" d="M30 35Q50 20 70 35M35 60L65 60M40 70Q50 80 60 70M50 10L50 90"/></g></svg>`;
const drawn=svg=>sharp(Buffer.from(svg)).png().toBuffer();
/** A PNG data URL's colors where it is at least half covered, most used first. */
async function inks(src) {
  const {data}=await sharp(Buffer.from(src.slice(src.indexOf(",")+1),"base64")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const counts=new Map();
  for(let at=0;at<data.length;at+=4)if(data[at+3]>=128){const hex=`#${[0,1,2].map(channel=>data[at+channel].toString(16).padStart(2,"0")).join("").toUpperCase()}`;counts.set(hex,(counts.get(hex)??0)+1);}
  return [...counts].sort((a,b)=>b[1]-a[1]).map(([hex])=>hex);
}

test("a thin line drawing in one color is one flat color, though at 48 px it is mostly anti-aliased edges, and is drawn in ink under 4.5:1",async()=>{
  const red=await drawn(lineDrawing(["#D24939"]));
  // Judged on every pixel at least half covered, edges and all, its color spreads too far to count as flat.
  const {data}=await sharp(red).resize({width:48,height:48,fit:"inside"}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const covered=[];
  for(let at=0;at<data.length;at+=4)if(data[at+3]>=128)covered.push([data[at],data[at+1],data[at+2]]);
  const middle=[0,1,2].map(channel=>covered.map(color=>color[channel]).sort((a,b)=>a-b)[covered.length>>1]);
  const same=covered.filter(color=>color.reduce((sum,value,channel)=>sum+Math.abs(value-middle[channel]),0)/3<=12).length/covered.length;
  assert.ok(same<.98,`the drawing's edges spread its color (${same.toFixed(3)} the same), as Jenkins' did`);

  const seen=await logos.visibility(red,CARD_RGB);
  assert.equal(seen.flat,true,"its color is judged on its solid pixels");
  assert.ok(seen.contrast<logos.FLAT_MARK_CONTRAST,`under 4.5:1 on the card (${seen.contrast.toFixed(2)})`);
  const logo=await logos.prepareLogo(lineDrawing(["#D24939"],STYLED),"Jenkins",CARD_RGB,INK);
  assert.match(logo.src,/^data:image\/png;base64,/,"drawn as a PNG");
  assert.deepEqual(await inks(logo.src),[INK],"every pixel of the mark is in the page's ink");
  assert.equal(logo.tile,false);
});

test("a line drawing in several colors keeps them, and one in a color that reaches 4.5:1 keeps it",async()=>{
  const two=await logos.visibility(await drawn(lineDrawing(["#D24939","#2496ED"])),CARD_RGB);
  assert.deepEqual([two.flat,two.oneColor],[false,false],"two colors are neither flat nor one color");
  const duo=await logos.prepareLogo(lineDrawing(["#D24939","#2496ED"],STYLED),"Duo",CARD_RGB,INK);
  assert.deepEqual((await inks(duo.src)).slice(0,2).sort(),["#2496ED","#D24939"],"a mark with a second color is never flattened");
  assert.equal(duo.tile,false,"nor tiled, as neither color vanishes");

  const blue=await logos.visibility(await drawn(lineDrawing(["#2496ED"])),CARD_RGB);
  assert.equal(blue.flat,true);
  assert.ok(blue.contrast>=logos.FLAT_MARK_CONTRAST,`Docker blue reaches 4.5:1 on the card (${blue.contrast.toFixed(2)})`);
  const docker=await logos.prepareLogo(lineDrawing(["#2496ED"],STYLED),"Docker",CARD_RGB,INK);
  assert.equal((await inks(docker.src))[0],"#2496ED","so it keeps its color");
});

test("files are cleaned: scripts, outside links and files over 200 KB are refused, and the next source is tried",async()=>{
  const big=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FF0000" d="M2 2h20v20H2z"/>${"<!-- padding -->".repeat(14_000)}</svg>`;
  const site=web({
    ...svglIndex([
      {title:"Kubernetes",route:`${SVGL}/library/kubernetes.svg`},
      {title:"Linked",route:`${SVGL}/library/linked.svg`},
      {title:"Huge",route:`${SVGL}/library/huge.svg`},
      {title:"Elsewhere",route:"https://example.com/elsewhere.svg"},
    ]),
    [`${SVGL}/library/kubernetes.svg`]:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><path fill="#326CE5" d="M2 2h20v20H2z"/></svg>`,
    [`${SVGL}/library/linked.svg`]:`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><use xlink:href="https://example.com/x.svg#a"/></svg>`,
    [`${SVGL}/library/huge.svg`]:big,
    ...simpleIndex([{title:"Kubernetes",slug:"kubernetes",hex:"326CE5"}]),[`${SIMPLE}/icons/kubernetes.svg`]:simpleIcon("Kubernetes"),
  });
  assert.ok(big.length>200_000);
  const [kubernetes,linked,huge,elsewhere]=await logos.findLogos([{brand:"Kubernetes"},{brand:"Linked"},{brand:"Huge"},{brand:"Elsewhere"}],{background:CARD,fetch:site.fetch});
  assert.equal(kubernetes.source,"simple-icons","svgl's file had a script, so Simple Icons' is used");
  assert.equal(linked,null);
  assert.equal(huge,null);
  assert.equal(elsewhere,null);
  assert.equal(site.count("https://example.com/elsewhere.svg"),0,"a file on another host is never fetched");
  assert.equal(logos.cleanSvg("<svg onload=\"x()\"></svg>"),null);
  assert.equal(logos.cleanSvg("<svg><image href=\"https://example.com/a.png\"/></svg>"),null);
  assert.match(logos.cleanSvg('<?xml version="1.0"?><!-- made by hand --><svg viewBox="0 0 1 1"></svg>'),/^<svg/);
});

test("indexes and files are fetched once, and the same brand asked twice is looked up once",async()=>{
  const site=web({...svglIndex([{title:"Slack",route:`${SVGL}/library/slack.svg`}]),[`${SVGL}/library/slack.svg`]:square("#4A154B")});
  const first=await logos.findLogos([{brand:"Slack"},{brand:"Slack"}],{background:PAGE_LIGHT,fetch:site.fetch});
  const second=await logos.findLogos([{brand:"Slack"}],{background:PAGE_LIGHT,fetch:site.fetch});
  assert.equal(first[0].name,"Slack");
  assert.equal(first[1].src,first[0].src);
  assert.equal(second[0].src,first[0].src);
  assert.equal(site.count(SVGL),1,"the svgl index is fetched once");
  assert.equal(site.count(`${SVGL}/library/slack.svg`),1,"the file is fetched once");
});

test("a logo is trimmed to its mark, so marks fill their cells alike",async()=>{
  const site=web({...svglIndex([{title:"Roomy",route:`${SVGL}/library/roomy.svg`},{title:"Tight",route:`${SVGL}/library/tight.svg`}]),
    [`${SVGL}/library/roomy.svg`]:square("#D97757",{box:"0 0 100 100",d:"M30 30h40v40H30z"}),[`${SVGL}/library/tight.svg`]:square("#D97757",{box:"0 0 100 100",d:"M0 0h100v100H0z"})});
  const [roomy,tight]=await logos.findLogos([{brand:"Roomy"},{brand:"Tight"}],{background:CARD,fetch:site.fetch});
  const viewBox=src=>svgOf(src).match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  assert.ok(model.isSafeBrandSvgUrl(roomy.src),"the trimmed logo is still a safe vector");
  assert.ok(viewBox(roomy.src)[2]<viewBox(tight.src)[2]*.5,"the empty margin around the mark is gone");
  assert.ok(Math.abs(roomy.width/roomy.height-1)<.02,"the mark keeps its shape");
  assert.ok(roomy.width<50,"its size is the mark's");
  assert.deepEqual(viewBox(tight.src),[0,0,360,360],"a mark that fills its box is left as it is");
  assert.equal(tight.width,100);
});
