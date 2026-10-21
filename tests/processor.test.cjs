const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname,'../files/podcast_processor_v2.js'),'utf8');
const iterator = values => { let i=0; return {hasNext:()=>i<values.length,next:()=>values[i++]}; };
function folder(texts=[]) {
  const files=texts.map(text=>file('podcasts.txt',text));
  function file(name,text) {return {name,text,trashed:false,getMimeType:()=> 'text/plain',getBlob(){return {getDataAsString:()=>this.text};},setTrashed(v){this.trashed=v;}};}
  return {files,getFilesByName:name=>iterator(files.filter(f=>f.name===name&&!f.trashed)),createFile(name,text){const f=file(name,text);files.push(f);return f;}};
}
function xmlItem(fields={}) {
  fields={title:'פרק Test 1',pubDate:new Date().toUTCString(),guid:'guid-1',duration:'12:34',...fields};
  return {getChildText:name=>fields[name] || '',getChild(name){return name==='enclosure'?{getAttribute:k=>({getValue:()=>k==='url'?(fields.audio||'https://audio.test/1.mp3'):'audio/mpeg'})}:null;}};
}
function setup(items=[xmlItem()]) {
  const mails=[];
  const ch={getChildText:n=>({title:'ערוץ Test',author:'מחבר'})[n] || '',getChildren:()=>items,getChild:()=>null};
  const ctx={console,Date,JSON,Math,Logger:{log(){}},MimeType:{PLAIN_TEXT:'text/plain',GOOGLE_DOCS:'docs'},
    Session:{getEffectiveUser:()=>({getEmail:()=> 'me@test.invalid'})},
    MailApp:{sendEmail:m=>mails.push(m)},GmailApp:{search:()=>[]},
    UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>'<rss/>'})},
    XmlService:{parse:()=>({getRootElement:()=>({getChild:()=>ch})}),getNamespace:()=>({})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  ctx._emailsData=null;ctx.initEmailsStructure(null);ctx._downloadHistory=[];
  return {ctx,mails};
}
function buttons(html) {return [...html.matchAll(/<a[^>]*href="mailto:([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({label:m[2],uri:m[1].replace(/&amp;/g,'&')}));}
const feed='https://feed.test/rss?x=1&y=2';
test('legacy TXT and notify flag round-trip with comments, days and CRLF',()=>{
  const {ctx}=setup(),f=folder(['# old\r\n'+feed+'\r\n30\r\n\r\n# alerts\r\nhttps://feed.test/alerts --notify-only\r\n14']);
  let list=ctx.loadRssList(f);assert.equal(list[0].days,30);assert.equal(list[0].notifyOnly,false);assert.equal(list[1].notifyOnly,true);
  ctx.writeMergedPodcastsFile(f,ctx.parsePodcastsFiles(f));list=ctx.loadRssList(f);assert.equal(list.length,2);assert.equal(list[1].days,14);
  assert.match(f.files.findLast(x=>!x.trashed).text,/# alerts/);
});
test('duplicate TXT copies retain notifications, maximum days and first comment',()=>{
  const {ctx}=setup(),f=folder(['# first\n'+feed+'\n30',feed+' --notify-only\n14']);ctx.mergePodcastsFiles(f);
  const merged=ctx.parsePodcastsFiles(f);assert.equal(merged.order.length,1);assert.equal(merged.byUrl[feed].notifyOnly,true);assert.equal(merged.byUrl[feed].days,30);assert.equal(merged.byUrl[feed].comment,'first');
});
test('invalid flags do not silently enable automatic downloads or overwrite TXT',()=>{
  const {ctx}=setup(),f=folder([feed+' --notify-onyl']);assert.throws(()=>ctx.loadRssList(f));assert.throws(()=>ctx.mergePodcastsFiles(folder([feed,feed+' --wrong'])));
  assert.equal(ctx.parseSubscriptionInput(feed+' --wrong').error.length>0,true);
  assert.equal(ctx.parseSubscriptionInput('שם ערוץ --notify-only').query,'שם ערוץ');
});
test('mode changes preserve comments, custom scan days and do not duplicate feeds',()=>{
  const {ctx}=setup(),f=folder(['# keep\n'+feed+'\n30']);const list=ctx.loadRssList(f);
  const thread=subject=>({getMessages:()=>[{getSubject:()=>subject}]});
  assert.equal(ctx.processSubscribeEmail(thread(feed+' --notify-only'),f,list,null,new Date()).type,'subscribe_changed');
  assert.equal(ctx.loadRssList(f)[0].notifyOnly,true);assert.equal(ctx.loadRssList(f)[0].days,30);
  assert.equal(ctx.processSubscribeEmail(thread(feed+' --notify-only'),f,list,null,new Date()).type,'subscribe_duplicate');
  ctx.processSubscribeEmail(thread(feed),f,list,null,new Date());assert.equal(ctx.loadRssList(f)[0].notifyOnly,false);assert.equal(ctx.loadRssList(f).length,1);
});
test('notify scanning does not create a folder or queue downloads, and deduplicates across runs',()=>{
  const {ctx}=setup(),queue=[];const main={getFoldersByName(){throw Error('must not touch audio folders');},createFolder(){throw Error('no folders');}};
  ctx.scanFeed(feed,7,main,queue,{}, {},true);ctx.scanFeed(feed,7,main,queue,{}, {},true);
  assert.equal(queue.length,0);assert.equal(ctx._downloadHistory.length,0);
  const groups=Object.values(ctx._emailsData.weekly.channels);assert.equal(groups[0].items.length,1);assert.equal(groups[0].rssUrl,feed);assert.equal(groups[0].items[0].guid,'guid-1');
});
test('notify scanner uses audio URL fallback for missing GUID',()=>{
  const {ctx}=setup([xmlItem({guid:''})]);ctx.scanFeed(feed,7,null,[],{},{},true);
  assert.equal(Object.values(ctx._emailsData.weekly.channels)[0].items[0].guid,'https://audio.test/1.mp3');
});
test('normal scan still queues audio, image and metadata with the feed URL',()=>{
  const {ctx}=setup(),queue=[];let covers=0;
  ctx.getOrCreateFolder=()=>({});ctx.savePodcastCoverArt=()=>covers++;
  ctx.scanFeed(feed,7,{getFoldersByName:()=>iterator([])},queue,{},{},false);
  assert.equal(queue.length,1);assert.equal(queue[0].rssUrl,feed);assert.equal(queue[0].url,'https://audio.test/1.mp3');assert.equal(covers,1);assert.equal(queue[0].source,'automatic');
});
test('all three modes have correct subscription controls plus unchanged catalog action',()=>{
  const {ctx}=setup();
  for(const mode of ['none','regular','notify']) {
    ctx._rssList=mode==='none'?[]:[{url:feed,notifyOnly:mode==='notify'}];
    const b=buttons(ctx.buildChannelControlButtons('שם',feed));
    assert.equal(b.length,3);assert.equal(b.filter(x=>x.label==='קבל פרקים').length,1);
    assert.equal(b.some(x=>x.label==='הסר'),mode!=='none');
    assert.equal(b.some(x=>x.label==='הירשם'),mode!=='regular');
    assert.equal(b.some(x=>x.label==='הירשם להתראות בלבד'),mode!=='notify');
    const catalog=b.find(x=>x.label==='קבל פרקים');assert.equal(new URL('mailto:'+catalog.uri).searchParams.get('subject'),feed);
  }
});
test('weekly separates notification items from failure counts, retains them after failure',()=>{
  const {ctx,mails}=setup(),data=ctx._emailsData;
  ctx.scanFeed(feed,7,null,[],{},{},true);const before=JSON.stringify(data.weekly.channels);
  ctx.MailApp.sendEmail=()=>{throw Error('quota');};assert.equal(ctx.sendWeeklyEmail(null,data,[{url:feed,notifyOnly:true}],null),false);assert.equal(JSON.stringify(data.weekly.channels),before);
  ctx.MailApp.sendEmail=m=>mails.push(m);assert.equal(ctx.sendWeeklyEmail(null,data,[{url:feed,notifyOnly:true}],null),true);
  const html=mails.at(-1).htmlBody;assert.match(html,/התראות בלבד/);assert.doesNotMatch(html,/נכשלו/);
  const get=buttons(html).find(b=>b.label==='קבל פרק');const payload=JSON.parse(new URL('mailto:'+get.uri).searchParams.get('subject'));
  assert.equal(payload.channelUrl,feed);assert.equal(payload.episodeGuid,'guid-1');assert.equal(Object.keys(data.weekly.channels).length,0);
  ctx.scanFeed(feed,7,null,[],{},{},true);assert.equal(Object.keys(data.weekly.channels).length,0);
});
test('manual request remains manual under notifications and supports no-GUID feeds',()=>{
  const {ctx}=setup([xmlItem({guid:''})]),q=[];ctx.getOrCreateFolder=()=>({});ctx.savePodcastCoverArt=()=>{};
  const result=ctx.addSpecificEpisodeToQueueEx(feed,'https://audio.test/1.mp3',q,null);assert.equal(result.ok,true);assert.equal(q[0].source,'manual');
  ctx.reconcileAutomaticQueue(q,[{url:feed,notifyOnly:true}],ctx._emailsData);assert.equal(q.length,1);
  ctx.addSpecificEpisodeToQueueEx(feed,'https://audio.test/1.mp3',q,null);assert.equal(q.length,1);
});
test('switch to alerts cancels automatic work, preserves manual work and resumable state of other feeds',()=>{
  const {ctx}=setup(),data=ctx._emailsData;
  const q=[{rssUrl:feed,url:'auto',source:'automatic',chunkState:{offset:123}},{rssUrl:feed,url:'manual',source:'manual'},{rssUrl:'https://other/feed',url:'other',source:'automatic',chunkState:{offset:456}}];
  ctx.reconcileAutomaticQueue(q,[{url:feed,notifyOnly:true}],data);assert.equal(q.length,2);assert.equal(q[1].chunkState.offset,456);
});
test('old queue and digest records recover feed from unique metadata without using audio URLs',()=>{
  const {ctx,mails}=setup(),d=ctx._emailsData;d.subscriptions.details[feed]={title:'ערוץ Test'};
  d.weekly.channels['ערוץ Test']={rssUrl:'https://audio.test/1.mp3',items:[{episodeTitle:'ישן',status:'success'}]};
  d.storage.pending=[{channelTitle:'ערוץ Test',episodeTitle:'ישן',url:'https://audio.test/1.mp3'}];
  const q=[{channelTitle:'ערוץ Test',url:'https://audio.test/1.mp3',chunkState:{offset:12}}];
  ctx.repairSavedFeedUrls(q,d,[{url:feed}]);assert.equal(q[0].rssUrl,feed);assert.equal(q[0].chunkState.offset,12);
  ctx.sendStorageEmail(null,d,null);for(const b of buttons(mails.at(-1).htmlBody)) if(b.label!=='הירשם להתראות בלבד') assert.doesNotMatch(b.uri,/audio\.test/);
  ctx.sendWeeklyEmail(null,d,[{url:feed}],null);assert.doesNotMatch(mails.at(-1).htmlBody,/subject=https%3A%2F%2Faudio/);
});
test('subscription snapshots change only after successful delivery, including mode-only changes',()=>{
  const {ctx}=setup(),d=ctx._emailsData,list=[{url:feed,days:7,notifyOnly:true}];
  d.subscriptions.list=[{url:feed,days:7}];assert.equal(ctx.checkSubscriptionChanges(list,d),true);
  ctx.MailApp.sendEmail=()=>{throw Error('quota');};ctx.sendSubscriptionEmail(list,null,d,new Date(),null);assert.equal(ctx.checkSubscriptionChanges(list,d),true);
  ctx.MailApp.sendEmail=()=>{};ctx.sendSubscriptionEmail(list,null,d,new Date(),null);assert.equal(ctx.checkSubscriptionChanges(list,d),false);
});
test('welcome contains parseable TXT example for both modes and 30-day scanning',()=>{
  const {ctx,mails}=setup();ctx.sendMissingRssFileEmail();const html=mails.at(-1).htmlBody;
  const example=html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1];const list=ctx.loadRssList(folder([example]));
  assert.equal(list.length,3);assert.equal(list[0].notifyOnly,false);assert.equal(list[1].notifyOnly,true);assert.equal(list[2].days,30);
  assert.match(html,/הכתובות בדוגמה הן להמחשה/);assert.match(html,/<td dir="rtl"/);assert.match(html,/<pre dir="ltr"/);
});
test('catalog keeps channel actions and per-episode requests including no-GUID case',()=>{
  const {ctx,mails}=setup([xmlItem({guid:''})]);ctx._rssList=[{url:feed,notifyOnly:true}];ctx.sendEpisodeCatalogEmail(feed,new Date());
  const b=buttons(mails[0].htmlBody);assert.equal(b.length,4);assert.ok(b.some(x=>x.label==='קבל פרקים'));assert.ok(b.some(x=>x.label==='קבל פרק זה'));
  const payload=JSON.parse(new URL('mailto:'+b.find(x=>x.label==='קבל פרק זה').uri).searchParams.get('subject'));assert.equal(payload.episodeGuid,'https://audio.test/1.mp3');
});
test('same Gmail conversation can change mode more than once and messages apply chronologically',()=>{
  const {ctx}=setup(),f=folder([feed]);const list=ctx.loadRssList(f);ctx._rssList=list;
  function msg(id,subject,time){return {getId:()=>id,getSubject:()=>subject,getFrom:()=> 'me@test.invalid',getTo:()=>ctx.CTRL_SUBSCRIBE,getDate:()=>new Date(time),isInTrash:()=>false,moveToTrash(){this.trashed=true;}};}
  const a=msg('a',feed+' --notify-only',1),b=msg('b',feed,2);
  ctx.GmailApp.search=q=>q.includes(ctx.CTRL_SUBSCRIBE)?[{getMessages:()=>[b,a]}]:[];
  ctx.saveEmailsData=()=>{};ctx.saveStatusQueue=()=>{};
  ctx.checkSentMailbox(f,null,[],list,new Date());assert.equal(list[0].notifyOnly,false);assert.ok(a.trashed&&b.trashed);
});
test('LRC timestamps and filenames retain original behavior',()=>{
  const {ctx}=setup();assert.match(ctx.convertTimestampsToLrc('Intro 1:23 text'),/\[01:23\.00\]/);assert.equal(ctx.buildFileName('Test','3','.mp3'),'[3] Test.mp3');
});

function mainSetup({notifyOnly=false,queue=[],noSubscriptions=false}={}) {
  const env=setup(),{ctx}=env,sys=folder(noSubscriptions?['# empty']:[feed+(notifyOnly?' --notify-only':'')]);
  if(queue.length) sys.createFile('status_queue.json',JSON.stringify(queue));
  let released=0,downloads=0,lrc=0;
  ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})};
  ctx.submitUserDataToForm=()=>{};ctx.getFreeStorageBytes=()=>10*1024**3;
  ctx.getOrCreateFolder=()=>({getFilesByName:()=>iterator([])});ctx.savePodcastCoverArt=()=>{};
  ctx.createLrcFile=()=>lrc++;
  ctx.downloadAndSaveAudio=()=>{downloads++;return {success:true,fileId:'saved-file'};};
  const mainFolder={getFoldersByName:()=>iterator([])};
  return {...env,sys,mainFolder,stats:()=>({released,downloads,lrc})};
}
test('full hourly run downloads normally, preserves metadata and releases its lock',()=>{
  const {ctx,sys,mainFolder,stats}=mainSetup();ctx.main(sys,mainFolder);
  assert.equal(stats().downloads,1);assert.equal(stats().lrc,1);assert.equal(stats().released,1);
  const history=ctx.loadDownloadHistory(sys);assert.equal(history.length,1);
  assert.equal(ctx.loadStatusQueue(sys).length,0);
  const weekly=Object.values(ctx._emailsData.weekly.channels)[0];assert.equal(weekly.rssUrl,feed);
});
test('full hourly run for notifications persists reports without downloading any audio',()=>{
  const {ctx,sys,mainFolder,stats}=mainSetup({notifyOnly:true});ctx.main(sys,mainFolder);ctx.main(sys,mainFolder);
  assert.equal(stats().downloads,0);assert.equal(ctx.loadStatusQueue(sys).length,0);
  assert.equal(Object.values(ctx._emailsData.weekly.channels)[0].items.length,1);
});
test('full hourly run continues manual episode requests even with an empty subscription list',()=>{
  const {ctx,sys,mainFolder,stats}=mainSetup({noSubscriptions:true,queue:[{url:'https://audio.test/manual.mp3',rssUrl:feed,source:'manual',channelTitle:'ערוץ Test',episodeTitle:'Manual',folderName:'Test',fileName:'manual.mp3'}]});
  ctx.main(sys,mainFolder);assert.equal(stats().downloads,1);assert.equal(ctx.loadStatusQueue(sys).length,0);
});
test('full hourly run preserves resumable upload offset and retry state',()=>{
  const {ctx,sys,mainFolder}=mainSetup({queue:[{url:'https://audio.test/1.mp3',rssUrl:feed,source:'automatic',channelTitle:'ערוץ Test',episodeTitle:'Paused',folderName:'Test',fileName:'pause.mp3',retryCount:1,chunkState:{uploadUrl:'session',offset:100,contentLength:1000}}]});
  ctx.downloadChunked=()=>({paused:true,chunkState:{uploadUrl:'session',offset:500,contentLength:1000}});
  ctx.main(sys,mainFolder);const q=ctx.loadStatusQueue(sys);assert.equal(q.length,1);assert.equal(q[0].chunkState.offset,500);assert.equal(q[0].retryCount,1);
});
test('large-file downloader resumes the original session and uses correct byte ranges',()=>{
  const {ctx}=setup();ctx.ScriptApp={getOAuthToken:()=> 'mock-token'};const calls=[];
  const chunk=15*1024*1024,total=chunk+100;
  ctx.UrlFetchApp.fetch=(url,options)=>{
    calls.push({url,options});return url==='session'?{getResponseCode:()=>200,getContentText:()=>'{"id":"file"}'}:{getResponseCode:()=>206,getContent:()=>[0]};
  };
  const result=ctx.downloadChunked('audio','file.mp3','audio/mpeg',null,total,new Date(),{uploadUrl:'session',offset:chunk});
  assert.equal(result.success,true);assert.equal(result.fileId,'file');assert.equal(calls.length,2);
  assert.equal(calls[0].options.headers.Range,`bytes=${chunk}-${total-1}`);assert.equal(calls[1].options.headers['Content-Range'],`bytes ${chunk}-${total-1}/${total}`);
});
test('lock contention prevents a second hourly run from touching persisted state',()=>{
  const {ctx}=setup();ctx.LockService={getScriptLock:()=>({tryLock:()=>false})};assert.equal(ctx.main(null,null),true);
});
