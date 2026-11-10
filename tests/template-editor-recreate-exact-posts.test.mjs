/* Run: node --test tests/template-editor-recreate-exact-posts.test.mjs
 * An exact copy's posts from X: telling the post a screenshot shows from any
 * other, the one X search Engine makes for it, and the card it gets: the real
 * post when it's found by its link (X's embed, free) or by search (Apify, at
 * most six a deck), else one built from the screenshot with its photos cut
 * from the original. No network: X and Apify are stand-ins. */
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
/** A fresh copy of the modules with `env` as the server's environment. */
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
const TOKEN="apify_api_TEST_TOKEN_never_shown";
const posts=load("lib/engine/agents/exact-posts.ts",{NODE_ENV:"test",APIFY_TOKEN:TOKEN});
const noToken=load("lib/engine/agents/exact-posts.ts");
const plain=value=>JSON.parse(JSON.stringify(value));

const BAUDE_TEXT="Yesterday while I was at lunch, Claude deleted a year of con law lecture notes and my current syllabus.";
/** X's embed answer for one post (the shape fetchXPost reads). */
const EMBED={__typename:"Tweet",id_str:"2118420271333777856",text:`${BAUDE_TEXT} https://t.co/o3XB8Uiugk`,created_at:"2026-11-05T19:08:45.000Z",favorite_count:7291,
  user:{name:"William Baude",screen_name:"WilliamBaude",profile_image_url_https:"https://pbs.twimg.com/profile_images/2110968185717428224/sYEkjNW0_normal.jpg",is_blue_verified:false},
  entities:{media:[{url:"https://t.co/o3XB8Uiugk"}]},mediaDetails:[{type:"photo",media_url_https:"https://pbs.twimg.com/media/HWYj89XW8AABX1T.png",original_info:{width:758,height:372}}]};
/** One search result in the shape the Apify tweet scraper returns. */
const found=(handle,text,id="2118500000000000001",extra={})=>({type:"tweet",id,url:`https://x.com/${handle}/status/${id}`,text,fullText:text,likeCount:12,retweetCount:1,replyCount:0,viewCount:900,
  createdAt:"Fri Nov 06 10:00:00 +0000 2026",isRetweet:false,isQuote:false,isReply:false,author:{userName:handle,name:"Alice",isBlueVerified:true,profilePicture:"https://pbs.twimg.com/profile_images/1/a_normal.jpg"},...extra});
/** A post as the copier transcribes it. */
const copied=(fields={})=>({box:{x:60,y:120,width:880,height:400},name:"William Baude",handle:"WilliamBaude",badge:"none",square:false,text:BAUDE_TEXT,language:"en",
  date:"2026-11-05",link:null,avatar:{x:80,y:130,width:60,height:48},photo:null,...fields});

/** X and Apify as stand-ins: the embed knows EMBED; the search answers `results` (or a status). */
function web({results=[],status=200}={}) {
  const calls=[];
  const fetch=async(url,init={})=>{
    const asked=new URL(String(url));
    calls.push({url:asked,body:init.body?JSON.parse(init.body):null,headers:init.headers});
    if(asked.hostname==="cdn.syndication.twimg.com")
      return asked.searchParams.get("id")===EMBED.id_str?new Response(JSON.stringify(EMBED),{status:200}):new Response("",{status:404});
    if(asked.hostname==="api.apify.com")return new Response(JSON.stringify(status===200?results:{error:{message:"nope"}}),{status});
    return new Response("",{status:404});
  };
  return {fetch,calls,embeds:()=>calls.filter(call=>call.url.hostname==="cdn.syndication.twimg.com").length,searches:()=>calls.filter(call=>call.url.hostname==="api.apify.com")};
}
const cuts=[];
const lookup=(site,extra={})=>({cut:async box=>{cuts.push(box);return {url:`data:image/jpeg;base64,${box.width}x${box.height}`,width:box.width,height:box.height};},
  signal:new AbortController().signal,budget:{searches:posts.MAX_POST_SEARCHES},known:new Map(),fetch:site.fetch,now:Date.parse("2026-11-08T00:00:00Z"),...extra});

test("a post counts only from the same account and with nearly all the screenshot's words",()=>{
  const real={author:{handle:"WilliamBaude"},text:`${BAUDE_TEXT} https://t.co/o3XB8Uiugk`};
  assert.ok(posts.samePost(real,{handle:"williambaude",text:BAUDE_TEXT}),"the handle in any case; the link isn't a word");
  assert.ok(!posts.samePost(real,{handle:"WilliamBaude2",text:BAUDE_TEXT}),"another account");
  assert.ok(!posts.samePost(real,{handle:"WilliamBaude",text:"Claude deleted my homework while I was at lunch"}),"another post by the same account");
  assert.ok(posts.samePost(real,{handle:"WilliamBaude",text:"Yesterday while I was at lunch, Claude deleted a year of con law"}),"a screenshot that cuts the post short");
  assert.ok(!posts.samePost(real,{handle:"WilliamBaude",text:"Yesterday"}),"one word is too little of the post to tell");
  assert.ok(posts.samePost({author:{handle:"OpenAI"},text:"We just shipped GPT-6 to everyone @sama"},{handle:"openai",text:"we just shipped GPT-6 to everyone!!! 🤯 @sama"}),"punctuation, emoji and @ aside");
  assert.deepEqual(posts.postWords("It's 96% up, @sama! #AI https://t.co/x"),["it's","96%","up","sama","ai"]);
  assert.equal(posts.postKey({handle:"WilliamBaude",text:"Hello, world!"}),"williambaude\nhello world");
  // X's font draws a capital I and a small l alike, so a screenshot's handle may have either.
  assert.equal(posts.shownHandle("mclIark"),"mcllark"); assert.equal(posts.shownHandle("Alice"),"allce"); assert.equal(posts.shownHandle("bob"),"bob");
  assert.ok(posts.postMatch({author:{handle:"mclIark"},text:"It looks like this"},{handle:"mcllark",text:"It looks like this"})>0,"I and l are one letter");
  assert.equal(posts.postMatch({author:{handle:"mcllarks"},text:"It looks like this"},{handle:"mcllark",text:"It looks like this"}),0,"another handle");
});

test("a handle's spellings: each look-alike letter either way, the handle as given first, at most 8",()=>{
  assert.deepEqual(plain(posts.handleSpellings("bob")),["bob"],"no l or i: one spelling");
  const cherry=posts.handleSpellings("mcllark");
  assert.equal(cherry[0],"mcllark");
  for (const spelling of ["mcliark","mcilark","mciiark"]) assert.ok(cherry.includes(spelling),spelling);
  const real=posts.handleSpellings("mclIark").map(spelling=>spelling.toLowerCase());
  assert.equal(posts.handleSpellings("mclIark")[0],"mclIark");
  assert.ok(real.includes("mcliark")&&real.includes("mcllark"));
  assert.equal(new Set(real).size,real.length,"no spelling twice, whatever its case");
  for (const handle of ["lil","Illilil","lllllllllllllll"]) assert.ok(posts.handleSpellings(handle).length<=8,handle);
});

test("the one search for a post is its author and its first telling words",()=>{
  assert.equal(posts.postSearch({handle:"bob",text:"Back up your notes, people! https://t.co/abc It's 2026."}),"from:bob Back your notes people It's");
  assert.equal(posts.postSearch({handle:"bob",text:"ok 👍"}),"from:bob","a post without long words searches its author");
  // A handle with an l or an I is searched under every spelling the screenshot could show.
  assert.equal(posts.postSearch({handle:"mcllark",text:"The leaves look like this"}),"(from:mcllark OR from:mcilark OR from:mcliark OR from:mciiark) leaves look like this");
});

test("a post linked on the slide or in the caption is read from X's embed, for free, once a deck",async()=>{
  const site=web(),search=lookup(site,{caption:"So bad https://twitter.com/WilliamBaude/status/2118420271333777856?s=20",reading:new Map()});
  const [card]=await posts.cardsFor([copied()],1,search);
  assert.equal(card.found,true);
  assert.equal(card.post.url,"https://x.com/WilliamBaude/status/2118420271333777856");
  assert.equal(card.post.text,BAUDE_TEXT,"X's own words");
  assert.equal(card.post.media.url,"https://pbs.twimg.com/media/HWYj89XW8AABX1T.png?name=large","and its photo");
  assert.equal(card.note,"Slide 1: the post by @WilliamBaude is the real one from X (https://x.com/WilliamBaude/status/2118420271333777856).");
  assert.equal(search.budget.searches,posts.MAX_POST_SEARCHES,"no search was needed");
  assert.equal(site.embeds(),1);
  assert.ok(search.known.has(posts.postKey(copied()))&&search.known.has("id:2118420271333777856"),"remembered for the next build");
  // The same link for another post of the deck is read once; that post isn't this one, so it's searched.
  const [other]=await posts.cardsFor([copied({name:"Alice",handle:"alice",text:"Back up your notes, people"})],2,search);
  assert.equal(other.found,false);
  assert.equal(site.embeds(),1,"the link was read once for the deck");
  assert.equal(site.searches().length,1);
  // A link on the slide itself works too.
  const own=web(),[linked]=await posts.cardsFor([copied({link:"x.com/WilliamBaude/status/2118420271333777856"})],1,lookup(own));
  assert.equal(linked.found,true);
  assert.equal(own.searches().length,0);
});

test("a post without a link is found by one X search, at most six a deck",async()=>{
  const site=web({results:[found("alice","Back up your notes people, seriously"),found("alice","Back up your notes, people","2118500000000000002")]});
  const search=lookup(site);
  const [card]=await posts.cardsFor([copied({name:"Alice",handle:"alice",text:"Back up your notes, people",date:"2026-11-06",language:"es"})],3,search);
  assert.equal(card.found,true);
  assert.equal(card.post.url,"https://x.com/alice/status/2118500000000000002","the result with the screenshot's words, not just the author");
  assert.equal(search.budget.searches,posts.MAX_POST_SEARCHES-1);
  const [asked]=site.searches();
  assert.deepEqual(plain(asked.body.searchTerms),["(from:alice OR from:allce OR from:ailce OR from:aiice) Back your notes people"]);
  assert.equal(asked.body.sort,"Latest","every match, replies too, which X's top results leave out");
  assert.equal(asked.body.tweetLanguage,"es","in the post's own language");
  assert.equal(asked.body.minimumFavorites,0,"any post, however few likes");
  assert.equal(asked.headers.Authorization,`Bearer ${TOKEN}`);
  assert.ok(!card.note.includes(TOKEN));
  // With the searches used up, a post is built from its screenshot without searching.
  const spent=web(),[built]=await posts.cardsFor([copied({handle:"bob",name:"Bob",text:"Never again"})],4,lookup(spent,{budget:{searches:0}}));
  assert.equal(built.found,false);
  assert.equal(spent.searches().length,0);
  assert.match(built.note,/wasn't found on X \(this deck's 6 searches of X were used\)/);
});

test("a post X doesn't have is built from the screenshot: its words as copied, its photos cut from the original",async()=>{
  cuts.length=0;
  const site=web({results:[found("someone_else","Back up your notes, people")]}),search=lookup(site);
  const avatar={x:120,y:320,width:60,height:48},photo={x:120,y:450,width:760,height:150};
  const [card]=await posts.cardsFor([copied({name:"Acme",handle:"acme",badge:"gold",square:true,text:"Back up your notes, people",date:"2026-11-06",avatar,photo})],2,search);
  assert.equal(card.found,false);
  assert.deepEqual(plain(card.post),{
    id:"copied-2-1",url:"",
    author:{name:"Acme",handle:"acme",avatarUrl:"data:image/jpeg;base64,60x48",verified:true,badge:"gold",square:true},
    text:"Back up your notes, people",media:{url:"data:image/jpeg;base64,760x150",width:760,height:150},
    createdAt:"2026-11-06T12:00:00.000Z",likes:0,reposts:0,replies:0,views:0,
  });
  assert.deepEqual(plain(cuts),[avatar,photo]);
  assert.equal(card.note,"Slide 2: the post by @acme wasn't found on X (X search didn't find it), so its card is built from the screenshot, with its profile photo and its photo cut from the original.");
  assert.equal(search.known.get(posts.postKey({handle:"acme",text:"Back up your notes, people"})),null,"the search's answer is remembered");
  const [again]=await posts.cardsFor([copied({name:"Acme",handle:"acme",badge:"gold",square:true,text:"Back up your notes, people"})],2,search);
  assert.equal(site.searches().length,1,"the next build doesn't search again");
  assert.match(again.note,/wasn't found on X \(an earlier X search didn't find it\)/);
  // A photo that can't be cut is left for a person to add.
  const [lost]=await posts.cardsFor([copied({handle:"dana",name:"Dana",text:"Hi there"})],1,{...lookup(web()),cut:async()=>{throw new Error("its original slide is missing");}});
  assert.equal(lost.post.author.avatarUrl,null);
  assert.match(lost.note,/so its card is built from the screenshot\. Add its profile photo by hand\.$/);
});

test("a reply is found under a look-alike handle and shown without the handles it opens with",async()=>{
  // A screenshot of a reply shows no "@mclIark"; the copier read the handle with small l's.
  const reply=found("shirokonek0chan","@mclIark It’s actually true https://t.co/IQH3GHEeK6","2116662657206096012",{isReply:true,inReplyToUsername:"mclIark",extendedEntities:{media:[{url:"https://t.co/IQH3GHEeK6"}]}});
  const site=web({results:[reply]}),[card]=await posts.cardsFor([copied({name:"Shiro",handle:"shirokonek0chan",text:"It’s actually true"})],1,lookup(site));
  assert.equal(card.found,true); assert.equal(card.post.text,"It’s actually true");
  const original=found("mclIark","The leaves look like this on camera","2116600000000000000");
  const other=web({results:[original]}),[post]=await posts.cardsFor([copied({name:"cherry",handle:"mcllark",text:"The leaves look like this on camera"})],1,lookup(other));
  assert.equal(post.found,true); assert.equal(post.post.author.handle,"mclIark","the real handle, as X spells it");
  assert.match(other.searches()[0].body.searchTerms[0],/^\(from:mcllark OR [^)]*from:mcliark[^)]*\) /);
});

test("a search that fails is tried again next build, and a server without Apify never spends one",async()=>{
  const broken=web({status:500}),search=lookup(broken);
  const [card]=await posts.cardsFor([copied({handle:"erin",name:"Erin",text:"Big news today"})],1,search);
  assert.match(card.note,/wasn't found on X \(X search failed: Apify's X search failed \(HTTP 500\)\. Apify said: nope\)/);
  assert.ok(!search.known.has(posts.postKey({handle:"erin",text:"Big news today"})),"not remembered as missing");
  const none=web(),unset=lookup(none);
  const [built]=await noToken.cardsFor([copied({handle:"erin",name:"Erin",text:"Big news today"})],1,unset);
  assert.match(built.note,/wasn't found on X \(X search isn't set up on this server\)/);
  assert.equal(unset.budget.searches,noToken.MAX_POST_SEARCHES,"nothing was spent");
  assert.equal(none.calls.length,0);
});

test("a found post with several photos keeps them all, cut together from the screenshot, as its card draws one",async()=>{
  const photo=name=>({type:"photo",media_url_https:`https://pbs.twimg.com/media/${name}.jpg`,original_info:{width:1200,height:1600}});
  const words="Hand in the frame and the colors come back";
  const two=found("alice",words,"2118500000000000009",{extendedEntities:{media:[photo("A1"),photo("A2")]}});
  const box={x:80,y:400,width:880,height:500};
  cuts.length=0;
  const [card]=await posts.cardsFor([copied({name:"Alice",handle:"alice",text:words,photo:box})],2,lookup(web({results:[two]})));
  assert.equal(card.found,true);
  assert.equal(card.post.mediaCount,2);
  assert.equal(card.post.media.url,"data:image/jpeg;base64,880x500","both photos, as the screenshot shows them side by side");
  assert.deepEqual(plain(cuts),[box],"only the photos are cut: the real post brings its profile photo");
  assert.match(card.note,/the real one from X .* Its 2 photos are cut together from the original, as X shows them\./);
  const [boxless]=await posts.cardsFor([copied({name:"Alice",handle:"alice",text:words,photo:null})],2,lookup(web({results:[two]})));
  assert.match(boxless.post.media.url,/media\/A1\.jpg/,"without a box around them, the card keeps the first photo");
  assert.match(boxless.note,/shows 2 photos; its card has only the first, so add the others by hand/);
  const [one]=await posts.cardsFor([copied({name:"Alice",handle:"alice",text:words,photo:box})],2,lookup(web({results:[found("alice",words,"2118500000000000010",{extendedEntities:{media:[photo("B1")]}})]})));
  assert.equal(one.post.mediaCount,undefined,"one photo needs no count");
  assert.match(one.post.media.url,/media\/B1\.jpg/,"a post with one photo keeps X's own, sharper than a cut");
});
