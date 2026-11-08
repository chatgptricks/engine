/* Run: node --test tests/template-editor-x-reactions.test.mjs
 * X reactions for Recreate: scraper items become real, verbatim posts with
 * their links (no retweets, promoted posts or duplicates), trimmed to a card,
 * and the Apify call is shaped, capped and fails in plain English without ever
 * showing the token. No network: fetch is always injected here. */
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
const TOKEN="apify_api_TEST_TOKEN_never_shown";
const x=load("lib/engine/x-reactions.ts",{NODE_ENV:"test",APIFY_TOKEN:TOKEN});
const noToken=load("lib/engine/x-reactions.ts",{NODE_ENV:"test"});

/** One item in the shape apidojo~tweet-scraper returns (checked live, Nov 2026). */
function item(overrides={}) {
  const {author,...rest}=overrides;
  return {
    type:"tweet",id:"2110374957310251142",url:"https://x.com/axiatechie/status/2110374957310251142",twitterUrl:"https://twitter.com/axiatechie/status/2110374957310251142",
    text:"Bill Gates says AI will replace people.",fullText:"Bill Gates says AI will replace people.",
    retweetCount:34,replyCount:63,likeCount:212,quoteCount:5,viewCount:80070,bookmarkCount:9,createdAt:"Wed Oct 14 14:19:33 +0000 2026",lang:"en",
    isReply:false,isRetweet:false,isQuote:false,
    author:{type:"user",userName:"axiatechie",name:"Axia",isVerified:false,isBlueVerified:true,profilePicture:"https://pbs.twimg.com/profile_images/2095921218834628618/7lbFLI00_normal.jpg",...author},
    entities:{hashtags:[],symbols:[],urls:[],user_mentions:[]},
    ...rest,
  };
}
const plain=value=>JSON.parse(JSON.stringify(value));

test("a scraper item becomes a reaction with its link, author and counts",()=>{
  const reaction=x.normalizeTweet(item());
  assert.deepEqual(plain(reaction),{
    id:"2110374957310251142",url:"https://x.com/axiatechie/status/2110374957310251142",
    author:{name:"Axia",handle:"axiatechie",avatarUrl:"https://pbs.twimg.com/profile_images/2095921218834628618/7lbFLI00_400x400.jpg",verified:true},
    text:"Bill Gates says AI will replace people.",createdAt:"2026-10-14T14:19:33.000Z",likes:212,reposts:34,replies:63,views:80070,
  });
  // Numeric ids, a leading @, string counts and missing optional fields still normalize.
  const sparse=x.normalizeTweet({id:"42",text:"hi",author:{userName:"@sam",name:" Sam "},likeCount:"1,204",viewCount:undefined});
  assert.equal(sparse.url,"https://x.com/sam/status/42"); assert.equal(sparse.author.name,"Sam"); assert.equal(sparse.likes,1204);
  assert.equal(sparse.views,0); assert.equal(sparse.createdAt,null); assert.equal(sparse.author.avatarUrl,null); assert.equal(sparse.author.verified,false);
  assert.equal(x.normalizeTweet(item({author:{isBlueVerified:false,isVerified:false}})).author.verified,false);
});

test("drop rules: no id, handle or text, retweets, promoted posts, bad avatars and repeats",()=>{
  for (const [label,bad] of [
    ["no id",item({id:undefined})],["a non-numeric id",item({id:"abc"})],["no handle",item({author:{userName:""}})],["an invalid handle",item({author:{userName:"not a handle"}})],
    ["no text",item({text:"",fullText:"   "})],["a retweet flag",item({isRetweet:true})],["a retweeted post",item({retweet:{id:"1"}})],["RT text",item({fullText:"RT @someone: hello"})],
    ["a promoted flag",item({isPromoted:true})],["a promoted type",item({type:"promoted"})],["not an object",null],["an array",[item()]],
  ]) assert.equal(x.normalizeTweet(bad),null,label);
  // Avatars come only from https://pbs.twimg.com; anything else leaves the placeholder.
  for (const url of ["http://pbs.twimg.com/a_normal.jpg","https://pbs.twimg.com.evil.example/a.jpg","https://abs.twimg.com/a.jpg","data:image/png;base64,AAAA","https://user:pw@pbs.twimg.com/a.jpg","not a url"])
    assert.equal(x.normalizeTweet(item({author:{profilePicture:url}})).author.avatarUrl,null,url);
  // Repeats: the same id, or the same words posted by another account. The most engaged copy stays.
  const copy=item({id:"2109601059056554339",likeCount:112,replyCount:26,retweetCount:42,author:{userName:"AiEvolutio58513",name:"AI Evolution"},fullText:"  bill gates says AI will   replace people. "});
  const reactions=x.normalizeTweets([copy,item(),item(),item({id:"3",likeCount:5000,fullText:"Different words"}),item({id:"4",isRetweet:true,likeCount:9e6})]);
  assert.deepEqual(reactions.map(reaction=>reaction.id),["3","2110374957310251142"]);
  // Sorted by likes + reposts + replies, then views; a like floor drops the rest.
  const ranked=x.normalizeTweets([item({id:"1",likeCount:10,retweetCount:0,replyCount:0,viewCount:5,fullText:"a"}),item({id:"2",likeCount:10,retweetCount:0,replyCount:0,viewCount:50,fullText:"b"}),item({id:"5",likeCount:2,retweetCount:30,replyCount:0,fullText:"c"})]);
  assert.deepEqual(ranked.map(reaction=>reaction.id),["5","2","1"]);
  assert.deepEqual(x.normalizeTweets([item({id:"1",likeCount:99,fullText:"a"}),item({id:"2",likeCount:100,fullText:"b"})],100).map(reaction=>reaction.id),["2"]);
  assert.deepEqual(x.normalizeTweets("not a list"),[]);
});

test("post text stays verbatim: only whitespace, X's hidden links and a scraper cut are touched",()=>{
  const words="If you’ve been looking for Remote Jobs.\n\nHow to Get ChatGPT to Send You  Remote Job Postings 👇\n→ step one";
  assert.equal(x.normalizeTweet(item({fullText:`\n  ${words}  \n`})).text,words,"case, spacing, curly quotes, emoji and line breaks are kept");
  assert.equal(x.normalizeTweet(item({fullText:"Q&amp;A: 3 &lt; 4 &amp;&amp; 5 &gt; 2"})).text,"Q&A: 3 < 4 && 5 > 2","X's escaping is undone, nothing else");
  // fullText wins over the shorter text field.
  assert.equal(x.normalizeTweet(item({text:"short",fullText:"the full post"})).text,"the full post");
  // The trailing link X hides (attached media, a quoted post) is not part of the post as shown.
  const media={extendedEntities:{media:[{type:"photo",url:"https://t.co/e2r1EICfpp",media_url_https:"https://pbs.twimg.com/media/x.jpg"}]}};
  assert.equal(x.normalizeTweet(item({fullText:"Remote Job Postings Every Morning. https://t.co/e2r1EICfpp",...media})).text,"Remote Job Postings Every Morning.");
  const quote={entities:{urls:[{url:"https://t.co/q",expanded_url:"https://twitter.com/someone/status/2103881060878533066"}]}};
  assert.equal(x.normalizeTweet(item({fullText:"This is wild https://t.co/q",...quote})).text,"This is wild");
  // A link the author typed stays, shortened as X shows it.
  const typed={entities:{urls:[{url:"https://t.co/6HTwFfXnm1",expanded_url:"https://openai.com/index/navier-stokes-solution/"}]}};
  assert.equal(x.normalizeTweet(item({fullText:"Read it https://t.co/6HTwFfXnm1",...typed})).text,"Read it https://t.co/6HTwFfXnm1");
  assert.equal(x.normalizeTweet(item({fullText:"No entities https://t.co/abc"})).text,"No entities https://t.co/abc");
  // A long post the scraper cut mid-sentence (first ~278 characters plus the media link) is marked like X's "Show more".
  const long="Bill Gates says the people promising that AI will create more jobs are missing what is about to happen.\n\n“Once AI becomes reliable enough to do the work, it starts replacing people.”\n\n“Once you replace human cognition as a scarce element, you blow it away.”\n\n“Working 24 hours a";
  const cut=x.normalizeTweet(item({fullText:`${long} https://t.co/HvO3NlTgQZ`,extendedEntities:{media:[{url:"https://t.co/HvO3NlTgQZ"}]}})).text;
  assert.equal(cut,`${long}…`);
  assert.ok(cut.startsWith(long),"every word that was scraped is kept");
  // A complete post with media is not marked.
  assert.equal(x.normalizeTweet(item({fullText:`${long}. https://t.co/HvO3NlTgQZ`,extendedEntities:{media:[{url:"https://t.co/HvO3NlTgQZ"}]}})).text,`${long}.`);
  // A post that is only a hidden link has no text left.
  assert.equal(x.normalizeTweet(item({fullText:"https://t.co/e2r1EICfpp",...media})),null);
});

test("trimReaction shortens at a word boundary with … and never splits an emoji",()=>{
  assert.equal(x.trimReaction("  fits as is  ",50),"fits as is");
  const trimmed=x.trimReaction("The quick brown fox jumps over the lazy dog",20);
  assert.equal(trimmed,"The quick brown fox…"); assert.ok(Array.from(trimmed).length<=20);
  assert.equal(x.trimReaction("Wait, what, really, now",12),"Wait, what…","no comma or space before the …");
  // Emoji count as one character and are never cut in half.
  const emoji="🎉🎉🎉 party time 🚀🚀";
  assert.equal(x.trimReaction(emoji,emoji.length),emoji,"UTF-16 length is not the limit");
  for (let max=2;max<=14;max++) {
    const result=x.trimReaction(emoji,max);
    assert.ok(Array.from(result).length<=max,`${max}: ${result}`);
    assert.doesNotMatch(result,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,"no lone surrogate");
    assert.ok(emoji.startsWith(result.slice(0,-1)),"a prefix of the post, plus …");
  }
  // One very long word or link is cut inside it rather than dropped.
  assert.equal(x.trimReaction("supercalifragilisticexpialidocious",10),"supercali…");
  // With a card's line budget, blank lines and long lines count; capitals are wider.
  assert.equal(x.reactionLines("one two\n\nthree",20),3);
  assert.equal(x.reactionLines("aaaa bbbb cccc",9),2);
  assert.equal(x.reactionLines("all caps posts are wider than this",36),1);
  assert.equal(x.reactionLines("ALL CAPS POSTS ARE WIDER THAN THIS",36),2,"capitals count 1.3");
  const paragraphs="First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";
  assert.equal(x.trimReaction(paragraphs,280,{lines:3,perLine:30}),"First paragraph here.\n\nSecond paragraph here.…","the author's punctuation stays");
  assert.equal(x.trimReaction(paragraphs,280,{lines:2,perLine:30}),"First paragraph here.…","no blank line before the …");
  assert.equal(x.trimReaction(paragraphs,280,{lines:5,perLine:30}),paragraphs);
  assert.ok(x.reactionLines(x.trimReaction("word ".repeat(200),280,{lines:5,perLine:38}),38)<=5);
});

test("reactionSlots fills a card's slots and formatReactionMeta writes the stats line",()=>{
  const reaction=x.normalizeTweet(item({likeCount:48213,retweetCount:3120,createdAt:"Tue Nov 03 09:00:00 +0000 2026"}));
  assert.equal(x.formatReactionMeta(reaction),"48.2K likes · 3.1K reposts · Nov 3, 2026");
  // Spanish keeps "48,2 mil" together with a no-break space.
  assert.equal(x.formatReactionMeta(reaction,"es"),"48,2 mil me gusta · 3,1 mil reposts · 3 nov 2026");
  assert.equal(x.formatReactionMeta({likes:1,reposts:0,createdAt:null}),"1 like");
  assert.deepEqual(plain(x.reactionSlots(reaction)),{
    "reaction-name":"Axia","reaction-handle":"@axiatechie","reaction-text":"Bill Gates says AI will replace people.",
    "reaction-meta":"48.2K likes · 3.1K reposts · Nov 3, 2026","reaction-avatar":"https://pbs.twimg.com/profile_images/2095921218834628618/7lbFLI00_400x400.jpg",
  });
  assert.deepEqual(Object.keys(x.reactionSlots(reaction,{second:true})),["reaction-name-2","reaction-handle-2","reaction-text-2","reaction-meta-2","reaction-avatar-2"]);
  const noAvatar=x.normalizeTweet(item({author:{profilePicture:"https://example.com/a.jpg"}}));
  assert.equal("reaction-avatar" in x.reactionSlots(noAvatar),false,"the placeholder stays");
  // Each card's budget: 280 characters on Reaction, 160 on either Reactions card.
  const long=x.normalizeTweet(item({fullText:"word ".repeat(100).trim()}));
  assert.ok(Array.from(x.reactionSlots(long)["reaction-text"]).length<=280);
  assert.ok(Array.from(x.reactionSlots(long,{page:"reactions"})["reaction-text"]).length<=160);
  assert.ok(Array.from(x.reactionSlots(long,{second:true})["reaction-text-2"]).length<=160);
});

test("fetchXReactions asks Apify for Top posts with a like floor, a language and a start date",async()=>{
  const calls=[];
  const raw=[item(),item({id:"7",likeCount:40,fullText:"under the floor"}),item({id:"8",likeCount:900,fullText:"most liked"}),item({id:"9",isRetweet:true,likeCount:5000})];
  const fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(raw),{status:200,headers:{"Content-Type":"application/json"}});};
  const reactions=await x.fetchXReactions({terms:[" ChatGPT jobs ","ChatGPT jobs","AI layoffs"],since:"2026-10-01",max:500,minLikes:100,language:"EN",fetch});
  assert.deepEqual(reactions.map(reaction=>reaction.id),["8","2110374957310251142"],"floor applied again, retweet dropped, sorted");
  assert.equal(calls.length,1);
  const [{url,init}]=calls;
  assert.equal(url,"https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?timeout=120&maxItems=60&clean=true","max is capped at 60");
  assert.equal(init.method,"POST"); assert.equal(init.headers.Authorization,`Bearer ${TOKEN}`); assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body),{searchTerms:["ChatGPT jobs","AI layoffs"],maxItems:60,sort:"Top",tweetLanguage:"en",minimumFavorites:100,start:"2026-10-01"});
  // Defaults: 30 posts, English, 100 likes, the last 30 days.
  await x.fetchXReactions({terms:["AI"],fetch});
  const body=JSON.parse(calls[1].init.body);
  assert.equal(body.maxItems,30); assert.equal(body.tweetLanguage,"en"); assert.equal(body.minimumFavorites,100);
  const days=(Date.now()-Date.parse(`${body.start}T00:00:00Z`))/86_400_000;
  assert.ok(days>=29&&days<=31,`start is 30 days back, got ${days}`);
  assert.equal(x.X_REACTIONS_MAX,60);
});

test("fetchXReactions fails in plain English and never shows the token",async()=>{
  const rejects=async(promise,status,pattern)=>{
    await assert.rejects(promise,error=>{
      assert.ok(error instanceof x.XReactionsError||error instanceof noToken.XReactionsError,String(error));
      assert.equal(error.status,status); assert.match(error.message,pattern);
      assert.doesNotMatch(error.message+String(error.stack),/TEST_TOKEN/,"the token never appears");
      return true;
    });
  };
  let called=false;
  await rejects(noToken.fetchXReactions({terms:["AI"],fetch:async()=>{called=true;}}),503,/APIFY_TOKEN/);
  assert.equal(called,false,"nothing is sent without a token");
  await rejects(x.fetchXReactions({terms:[" ",""],fetch:async()=>{throw new Error("no call");}}),400,/search term/);
  await rejects(x.fetchXReactions({terms:["AI"],since:"not a date",fetch:async()=>{throw new Error("no call");}}),400,/start date/);
  const reply=(status,body)=>async()=>new Response(typeof body==="string"?body:JSON.stringify(body),{status});
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(401,{error:{type:"token-not-valid",message:`Token ${TOKEN} is not valid`}})}),502,/rejected the token.*\[redacted\]/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(402,{error:{message:"Not enough credit"}})}),502,/out of credit/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(408,"<html>timeout</html>")}),504,/2 minutes/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(429,{})}),429,/rate-limiting/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(500,"oops")}),502,/HTTP 500/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(200,{error:"not a list"})}),502,/isn't a list/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:reply(200,"not json")}),502,/isn't a list/);
  await rejects(x.fetchXReactions({terms:["AI"],fetch:async()=>{throw new TypeError("fetch failed");}}),502,/Couldn't reach Apify/);
  // The caller's abort passes through as the abort itself.
  const controller=new AbortController(),reason=new Error("stopped by the user");
  const pending=x.fetchXReactions({terms:["AI"],signal:controller.signal,fetch:(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener("abort",()=>reject(init.signal.reason)))});
  controller.abort(reason);
  await assert.rejects(pending,error=>error===reason);
});

test("fetchXReactions says plainly when the Apify plan can't search X",async()=>{
  // On the free plan the actor runs in demo mode: placeholders only, and the run asks for a paid plan (seen live, Nov 2026).
  const placeholders=JSON.stringify(Array.from({length:10},()=>({noResults:true})));
  const route=(statusMessage,lastStatus=200)=>{
    const calls=[];
    const fetch=async(url,init)=>{
      calls.push({url,init});
      if(url.includes("/runs/last"))return new Response(JSON.stringify({data:{status:"SUCCEEDED",statusMessage}}),{status:lastStatus});
      return new Response(placeholders,{status:200});
    };
    return {calls,fetch};
  };
  const free=route("Your run has finished. Please subscribe to a paid plan on Apify for the best experience.");
  await assert.rejects(x.fetchXReactions({terms:["ChatGPT"],fetch:free.fetch}),error=>{
    assert.ok(error instanceof x.XReactionsError); assert.equal(error.message,x.X_PAID_PLAN); assert.ok(!error.message.includes(TOKEN));
    return true;
  });
  assert.equal(free.calls.length,2);
  assert.equal(free.calls[1].url,"https://api.apify.com/v2/acts/apidojo~tweet-scraper/runs/last?status=SUCCEEDED");
  assert.equal(free.calls[1].init.headers.Authorization,`Bearer ${TOKEN}`);
  assert.match(x.X_PAID_PLAN,/paid Apify plan/);
  // On a paid plan an empty search is just empty, and so is one whose last run can't be read.
  assert.deepEqual(await x.fetchXReactions({terms:["ChatGPT"],fetch:route("Finished! Total 0 tweets scraped.").fetch}),[]);
  assert.deepEqual(await x.fetchXReactions({terms:["ChatGPT"],fetch:route("",500).fetch}),[]);
  // The same check on its own, for the photo search: false without a token or when Apify can't be reached.
  assert.equal(await x.xSearchNeedsPaidPlan({fetch:free.fetch}),true);
  assert.equal(await x.xSearchNeedsPaidPlan({fetch:route("Finished!").fetch}),false);
  assert.equal(await x.xSearchNeedsPaidPlan({fetch:async()=>{throw new TypeError("fetch failed");}}),false);
  assert.equal(await noToken.xSearchNeedsPaidPlan({fetch:async()=>{throw new Error("no call");}}),false);
});
