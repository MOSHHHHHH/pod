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
  const ctx={console,Date,JSON,Math,Utilities:{newBlob:(text,type,name)=>({getBytes:()=>[...Buffer.from(String(text),'utf8')],getDataAsString:()=>String(text),getContentType:()=>type,getName:()=>name})},Logger:{log(){}},MimeType:{PLAIN_TEXT:'text/plain',GOOGLE_DOCS:'docs'},
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
  ctx.MailApp.sendEmail=()=>{throw Error('quota');};assert.equal(ctx.sendWeeklyEmail(folder(),data,[{url:feed,notifyOnly:true}],null),false);assert.ok(data.weekly.delivery);assert.equal(Object.keys(data.weekly.channels).length,0);
  ctx.MailApp.sendEmail=m=>mails.push(m);assert.equal(ctx.sendWeeklyEmail(folder(),data,[{url:feed,notifyOnly:true}],null),true);
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
  ctx.sendWeeklyEmail(folder(),d,[{url:feed}],null);assert.doesNotMatch(mails.at(-1).htmlBody,/subject=https%3A%2F%2Faudio/);
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
  const b=buttons(mails[0].htmlBody);assert.equal(b.length,7);assert.ok(b.some(x=>x.label===ctx.CTRL_GET_EPISODE && x.uri===ctx.CTRL_GET_EPISODE));assert.ok(b.some(x=>x.label==='קבל פרקים'));assert.ok(b.some(x=>x.label==='קבל פרק'));
  const payload=JSON.parse(new URL('mailto:'+b.find(x=>x.label==='קבל פרק').uri).searchParams.get('subject'));assert.equal(payload.episodeGuid,'https://audio.test/1.mp3');
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

function attachment(value,name='podki-selection.json',type='application/json') {
  const text=typeof value==='string'?value:JSON.stringify(value);
  return {getName:()=>name,getContentType:()=>type,getSize:()=>Buffer.byteLength(text),getDataAsString:()=>text};
}
function incoming(subject='',files=[],id='message-1') {
  return {getMessages:()=>[{getSubject:()=>subject,getId:()=>id,getAttachments:()=>files}]};
}
const selection=(id='selection-1',episodes=[{channelUrl:feed,episodeGuid:'guid-1'}])=>({format:'podki-request',version:1,requestId:id,episodes});

test('JSON attachments need no subject and do not implicitly initiate a search',()=>{
  const {ctx}=setup();const result=ctx.processGetEpisodeEmail(incoming('',[attachment(selection())]),[],[],null,new Date());
  assert.equal(result.jobs,1);assert.equal(ctx.podkiState().jobs.length,1);assert.equal(ctx.podkiState().jobs[0].type,'episodes');
});
test('attachments and free-text subjects are independently queued',()=>{
  const {ctx}=setup();ctx.processGetEpisodeEmail(incoming('חיות כיס',[attachment(selection())]),[],[],null,new Date());
  assert.equal(ctx.podkiState().jobs.length,2);assert.equal(ctx.podkiState().jobs[1].type,'search');assert.equal(ctx.podkiState().jobs[1].payload.query,'חיות כיס');
});
test('RSS catalog subject still works alongside a JSON selection',()=>{
  const {ctx}=setup();ctx.processGetEpisodeEmail(incoming(feed,[attachment(selection())]),[],[],null,new Date());
  assert.equal(ctx.podkiState().jobs[1].type,'catalog');
});
test('invalid JSON does not suppress a valid independent subject',()=>{
  const {ctx}=setup();const r=ctx.processGetEpisodeEmail(incoming(feed,[attachment('{broken')]),[],[],null,new Date());
  assert.equal(r.jobs,1);assert.equal(ctx.podkiState().jobs[0].type,'catalog');assert.equal(ctx.podkiState().jobs[1].type,'notice');
});
test('unrelated attachments are reported and never executed',()=>{
  const {ctx}=setup();ctx.processGetEpisodeEmail(incoming('',[attachment('throw Error("execute")','catalog.html','text/html')]),[],[],null,new Date());
  assert.equal(ctx.podkiState().jobs.length,1);assert.equal(ctx.podkiState().jobs[0].type,'notice');
});
test('BOM JSON and filename-only MIME attachments are accepted',()=>{
  const {ctx}=setup();ctx.processGetEpisodeEmail(incoming('',[attachment('\uFEFF'+JSON.stringify(selection()),'selection.JSON','application/octet-stream')]),[],[],null,new Date());
  assert.equal(ctx.podkiState().jobs[0].type,'episodes');
});
test('request IDs and duplicate episodes do not queue repeated work',()=>{
  const {ctx}=setup();const a=attachment(selection('same',[{channelUrl:feed,episodeGuid:'guid-1'},{channelUrl:feed,episodeGuid:'guid-1'}]));
  ctx.processGetEpisodeEmail(incoming('',[a],'one'),[],[],null,new Date());ctx.processGetEpisodeEmail(incoming('',[a],'two'),[],[],null,new Date());
  assert.equal(ctx.podkiState().jobs.filter(j=>j.type==='episodes').length,1);assert.equal(ctx.podkiState().jobs[0].payload.length,1);
});
test('malformed entries and unsupported versions get actionable feedback',()=>{
  const {ctx}=setup();assert.throws(()=>ctx.podkiSelection({version:99,episodes:[{}]}),/גרסת/);
  const parsed=ctx.podkiSelection(selection('mix',[{channelUrl:feed,episodeGuid:'guid-1'},{channelUrl:'javascript:bad',episodeGuid:'x'}]));
  assert.equal(parsed.episodes.length,1);assert.equal(parsed.errors.length,1);
});
test('old single-episode JSON subjects retain support',()=>{
  const {ctx}=setup();ctx.processGetEpisodeEmail(incoming(JSON.stringify({channelUrl:feed,episodeGuid:'guid-1'})),[],[],null,new Date());
  assert.equal(ctx.podkiState().jobs[0].type,'episodes');
});
test('large selections resume from saved item cursor and fetch a feed once per run',()=>{
  const items=Array.from({length:45},(_,i)=>xmlItem({guid:'guid-'+i,audio:'https://audio.test/'+i+'.mp3'}));
  const {ctx}=setup(items),sys=folder(),q=[];ctx._sysFolder=sys;let fetches=0;
  ctx.UrlFetchApp.fetch=()=>{fetches++;return {getResponseCode:()=>200,getContentText:()=>'<rss/>'};};
  ctx.podkiEnqueueJob('episodes',items.map((_,i)=>({channelUrl:feed,episodeGuid:'guid-'+i})),'many');
  ctx.podkiPumpJobs(sys,q,null,new Date());assert.equal(q.length,30);assert.equal(ctx.podkiState().jobs[0].index,30);
  ctx.podkiPumpJobs(sys,q,null,new Date());assert.equal(q.length,45);assert.equal(ctx.podkiState().jobs.length,0);assert.equal(fetches,1);
  assert.equal(q.every(x=>x.source==='manual'),true);
});
test('a failed confirmation send retains resolved episodes without downloading duplicates',()=>{
  const {ctx}=setup(),sys=folder(),q=[];ctx._sysFolder=sys;
  ctx.podkiEnqueueJob('episodes',[{channelUrl:feed,episodeGuid:'guid-1'}],'one');
  ctx.MailApp.sendEmail=()=>{throw Error('quota');};ctx.podkiPumpJobs(sys,q,null,new Date());assert.equal(q.length,1);assert.equal(ctx.podkiState().jobs[0].index,1);
  ctx.MailApp.sendEmail=()=>{};ctx.podkiPumpJobs(sys,q,null,new Date());assert.equal(q.length,1);assert.equal(ctx.podkiState().jobs.length,0);
});
test('safe state writes keep the original JSON if creating replacement fails',()=>{
  const {ctx}=setup(),sys=folder();const original=sys.createFile('emails.json','{"safe":true}');sys.createFile=()=>{throw Error('Drive unavailable');};
  assert.throws(()=>ctx.saveEmailsData(sys,{changed:true}));assert.equal(original.trashed,false);assert.equal(original.text,'{"safe":true}');
});
test('catalog is attached for a small feed while preserving inline episode actions',()=>{
  const {ctx,mails}=setup();ctx.sendEpisodeCatalogEmail(feed,new Date());const mail=mails[0];
  assert.equal(mail.attachments.length,1);assert.equal(mail.attachments[0].getName(),'קטלוג פודקי ערוץ Test.html');assert.match(mail.htmlBody,/קבל פרק/);
  const html=mail.attachments[0].getDataAsString();assert.match(html,/application\/json/);assert.match(html,/אין צורך בנושא/);assert.match(html,/type="search"/);
});
test('large catalog sends one email containing all feed episodes in one HTML attachment',()=>{
  const {ctx,mails}=setup(Array.from({length:100},(_,i)=>xmlItem({guid:'g'+i,title:'כותרת '+i,audio:'https://audio.test/'+i+'.mp3'})));
  ctx.sendEpisodeCatalogEmail(feed,new Date());assert.equal(mails.length,1);assert.match(mails[0].htmlBody,/הרשימה ארוכה/);
  const data=mails[0].attachments[0].getDataAsString().match(/id="catalog-data">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(data).episodes.length,100);
});
test('oversized catalog is saved privately without changing sharing permissions',()=>{
  const {ctx,mails}=setup();ctx.PODKI_ATTACHMENT_BYTES=1;let created=0;
  ctx._sysFolder={createFile(){created++;return {getUrl:()=> 'https://drive.google.com/file/d/private/view'};}};
  ctx.sendEpisodeCatalogEmail(feed,new Date());assert.equal(created,1);assert.equal(mails[0].attachments.length,0);assert.match(mails[0].htmlBody,/ללא פתיחת שיתוף ציבורי/);
});
test('catalog data escapes hostile feed markup without losing episode text',()=>{
  const {ctx}=setup();const title='</script><img src=x onerror=alert(1)>';
  const html=ctx.podkiCatalogHtml({title:'Safe',url:feed,episodes:[{channelUrl:feed,episodeGuid:'g',episodeTitle:title,description:title}]});
  const embedded=html.match(/id="catalog-data">([\s\S]*?)<\/script>/)[1];assert.doesNotMatch(embedded,/<img/);assert.equal(JSON.parse(embedded).episodes[0].episodeTitle,title);
});
test('weekly report splits by UTF-8 bytes and retries only unsent parts, retaining new events',()=>{
  const {ctx,mails}=setup(),sys=folder(),d=ctx._emailsData;ctx.PODKI_BODY_BYTES=12000;
  d.weekly.channels[feed]={title:'ערוץ',rssUrl:feed,items:Array.from({length:14},(_,i)=>({episodeTitle:'עברית '+i,status:'success',pubDate:'today'}))};
  let attempts=0;ctx.MailApp.sendEmail=m=>{if(++attempts===2)throw Error('temporary');mails.push(m);};
  assert.equal(ctx.sendWeeklyEmail(sys,d,[{url:feed}],null),false);assert.equal(d.weekly.delivery.next,1);const total=d.weekly.delivery.pages.length;assert.ok(total>1);
  ctx.addToWeeklyPending(d,{rssUrl:feed,url:'new',channelTitle:'ערוץ',episodeTitle:'אירוע חדש'},'notification',null);
  ctx.MailApp.sendEmail=m=>mails.push(m);assert.equal(ctx.sendWeeklyEmail(sys,d,[{url:feed}],null),true);
  assert.equal(mails.length,total);assert.equal(Object.values(d.weekly.channels)[0].items[0].episodeTitle,'אירוע חדש');
  for(const m of mails)assert.ok(Buffer.byteLength(m.htmlBody,'utf8')<15000);
});
test('Apple episode search uses episodeGuid rather than trackId and caches full audio fallback',()=>{
  const {ctx}=setup();let requested='';
  ctx.UrlFetchApp.fetch=url=>{requested=url;return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({results:[{kind:'podcast-episode',feedUrl:feed,episodeGuid:'rss-guid',trackId:123,trackName:'מצאתי',collectionName:'ערוץ',episodeUrl:'https://audio.test/old.mp3'}]})};};
  const rows=ctx.podkiSearchEpisodes('עברית');assert.match(requested,/entity=podcastEpisode/);assert.equal(rows[0].episodeGuid,'rss-guid');assert.equal(rows[0].appleTrackId,123);
  ctx.UrlFetchApp.fetch=()=>{throw Error('feed offline');};const q=[];assert.equal(ctx.podkiQueueEpisode({channelUrl:feed,episodeGuid:'rss-guid',appleTrackId:123},q).status,'queued');assert.equal(q[0].url,'https://audio.test/old.mp3');
});
test('Apple collection lookup fills missing RSS URL',()=>{
  const {ctx}=setup();ctx.UrlFetchApp.fetch=url=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({results:url.includes('/lookup')?[{feedUrl:feed}]:[{kind:'podcast-episode',collectionId:77,episodeGuid:'guid',trackId:1,trackName:'פרק'}]})});
  assert.equal(ctx.podkiSearchEpisodes('query')[0].channelUrl,feed);
});
test('untrusted attachment audio URLs cannot bypass feed resolution',()=>{
  const {ctx}=setup([]),q=[];const r=ctx.podkiQueueEpisode({channelUrl:feed,episodeGuid:'missing',episodeUrl:'https://arbitrary.test/file.mp3'},q);
  assert.equal(r.status,'failed');assert.equal(q.length,0);
});
test('every JS email carries the Podki sender, image and both universal action buttons',()=>{
  const {ctx,mails}=setup();ctx.sendMissingRssFileEmail();ctx.sendFailureEmail({channelTitle:'ערוץ',rssUrl:feed,episodeTitle:'פרק'},'HTTP 500');ctx.sendNoResultsEmail('nothing');
  for(const m of mails){assert.equal(m.name,'פודקי — בוט הפודקאסטים שלך');assert.match(m.htmlBody,/assets\/podki\//);assert.ok(buttons(m.htmlBody).some(x=>x.label==='חפש פרק'));assert.ok(buttons(m.htmlBody).some(x=>x.label==='חפש ערוץ'));}
});
test('full hourly run processes a no-subject attachment using existing GS entry point',()=>{
  const {ctx,sys,mainFolder,stats}=mainSetup({noSubscriptions:true});
  const m={getId:()=> 'real-like-id',getSubject:()=>'',getAttachments:()=>[attachment(selection())],getFrom:()=> 'me@test.invalid',getTo:()=>ctx.CTRL_GET_EPISODE,getDate:()=>new Date(),isInTrash:()=>false,moveToTrash(){this.trashed=true;}};
  ctx.GmailApp.search=q=>q.includes(ctx.CTRL_GET_EPISODE)?[{getMessages:()=>[m]}]:[];
  ctx.main(sys,mainFolder);assert.equal(stats().downloads,1);assert.equal(m.trashed,true);assert.equal(ctx.podkiState().jobs.length,0);
});


test('standalone catalog filters, keeps selection across searches, sorts and exports only selected IDs',()=>{
  const {ctx}=setup();
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';}
    append(...els){this.children.push(...els);} replaceChildren(){this.children=[];} setAttribute(n,v){this[n]=v;}
    click(){if(this.tag==='a')downloaded=this;else this.onclick?.();} remove(){}
  }
  const nodes={};['catalog-data','search','sort','list','count','selected','download','notice','clear','select-visible','share','only-selected'].forEach(id=>nodes[id]=new Element());
  nodes.sort.value='new';nodes['catalog-data'].textContent=JSON.stringify({episodes:[
    {channelUrl:feed,episodeGuid:'one',episodeTitle:'ישן',description:'חלל',pubDate:'2020-01-01'},
    {channelUrl:feed,episodeGuid:'two',episodeTitle:'חדש',description:'מוח',pubDate:'2026-01-01'}]});
  let exported,downloaded;
  Object.assign(ctx,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag),body:new Element()},
    navigator:{},File:class {constructor(parts,name,options){this.text=parts.join('');this.name=name;this.type=options.type;}},
    URL:{createObjectURL:f=>{exported=f;return 'blob:test';},revokeObjectURL(){}},setTimeout:fn=>fn()});
  ctx.podkiCatalogClient();assert.equal(nodes.list.children.length,2);
  assert.equal(nodes.list.children[0].children[0].children[1].children[0].textContent,'חדש');
  nodes.search.value='חלל';nodes.search.oninput();assert.equal(nodes.list.children.length,1);
  nodes['select-visible'].onclick();assert.match(nodes.selected.textContent,/1/);
  nodes.search.value='';nodes.search.oninput();nodes.sort.value='old';nodes.sort.onchange();
  assert.equal(nodes.list.children[0].children[0].children[0].checked,true);
  nodes.download.onclick();assert.equal(downloaded.download,'הקבצים שבחרתי.json');assert.equal(exported.type,'application/json');
  const parsed=ctx.podkiSelection(JSON.parse(exported.text));assert.equal(parsed.episodes.length,1);assert.equal(parsed.episodes[0].episodeGuid,'one');
  nodes.clear.onclick();assert.equal(nodes.download.disabled,true);
});

test('welcome explains all new actions, attachment detection and independent subject handling',()=>{
  const {ctx,mails}=setup();ctx.sendMissingRssFileEmail();const html=mails[0].htmlBody;
  for(const phrase of ['JSON','HTML','אפשר להשאיר אותה ריקה','בודק גם את שורת הנושא בנפרד','חפש פרק','הודעות ממוספרות','1,000','אינה מצרפת','--notify-only'])assert.ok(html.includes(phrase),phrase);
});

test('separate single-episode emails share one persisted confirmation batch',()=>{
  const items=Array.from({length:3},(_,i)=>xmlItem({guid:'g'+i,audio:'https://audio.test/'+i+'.mp3',title:'Requested '+i}));
  const {ctx,mails}=setup(items),sys=folder(),q=[];ctx._sysFolder=sys;
  items.forEach((_,i)=>ctx.processGetEpisodeEmail(incoming(JSON.stringify({channelUrl:feed,episodeGuid:'g'+i}),[],'mail-'+i),q,[],null,new Date()));
  ctx.podkiPumpJobs(sys,q,null,new Date());
  assert.equal(mails.length,1);assert.equal(q.length,3);assert.equal(ctx.podkiState().jobs.length,0);
  for(let i=0;i<3;i++){assert.match(mails[0].htmlBody,new RegExp('Requested '+i));assert.ok(ctx.podkiState().receipts['subject:mail-'+i]);}
});
test('merged JSON selection IDs remain deduplicated before and after a retry',()=>{
  const items=[xmlItem({guid:'a'}),xmlItem({guid:'b',audio:'https://audio.test/b.mp3'})];
  const {ctx,mails}=setup(items),sys=folder(),q=[];ctx._sysFolder=sys;
  ['a','b'].forEach(id=>ctx.processGetEpisodeEmail(incoming('',[attachment(selection(id,[{channelUrl:feed,episodeGuid:id}]))],id),q,[],null,new Date()));
  ctx.MailApp.sendEmail=()=>{throw Error('quota');};ctx.podkiPumpJobs(sys,q,null,new Date());
  assert.equal(q.length,2);assert.equal(ctx.podkiState().jobs.length,1);
  assert.equal(ctx.podkiEnqueueJob('episodes',[{channelUrl:feed,episodeGuid:'b'}],'selection:b'),false);
  const restarted=setup(items);restarted.ctx._emailsData=JSON.parse(JSON.stringify(ctx._emailsData));restarted.ctx._sysFolder=sys;
  restarted.ctx.podkiPumpJobs(sys,q,null,new Date());assert.equal(restarted.mails.length,1);assert.equal(q.length,2);
  assert.equal(restarted.ctx.podkiEnqueueJob('episodes',[{channelUrl:feed,episodeGuid:'b'}],'selection:b'),false);
});
test('new episode requests join an unfinished batch without losing resolved work',()=>{
  const {ctx,mails}=setup(),sys=folder(),q=[];ctx._sysFolder=sys;
  ctx.podkiEnqueueJob('episodes',[{channelUrl:feed,episodeGuid:'guid-1'}],'first');
  ctx.MailApp.sendEmail=()=>{throw Error('quota');};ctx.podkiPumpJobs(sys,q,null,new Date());
  ctx.podkiEnqueueJob('episodes',[{channelUrl:feed,episodeGuid:'missing',episodeTitle:'Missing episode'}],'next');
  ctx.MailApp.sendEmail=m=>mails.push(m);ctx.podkiPumpJobs(sys,q,null,new Date());
  assert.equal(mails.length,1);assert.equal(q.length,1);assert.match(mails[0].htmlBody,/Missing episode/);
  assert.ok(ctx.podkiState().receipts.first);assert.ok(ctx.podkiState().receipts.next);
});
test('partly delivered summaries stay frozen while other episode jobs combine',()=>{
  const {ctx}=setup(),sys=folder();
  ['sent','one','two'].forEach(id=>ctx.podkiEnqueueJob('episodes',[{channelUrl:feed,episodeGuid:id}],id));
  ctx.podkiState().jobs[0].summaryIndex=1;ctx.podkiMergeEpisodeJobs(sys);
  const jobs=ctx.podkiState().jobs;assert.equal(jobs.length,2);assert.equal(jobs[0].summaryIndex,1);
  assert.equal(jobs[0].payload.length,1);assert.equal(jobs[1].payload.length,2);
});

test('catalog search ranks title matches, highlights literal text safely and filters selected episodes',()=>{
  const {ctx}=setup();
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';}
    append(...els){this.children.push(...els);} replaceChildren(){this.children=[];} setAttribute(n,v){this[n]=v;}
  }
  const nodes={};['catalog-data','search','sort','list','count','selected','download','notice','clear','select-visible','share','only-selected'].forEach(id=>nodes[id]=new Element());
  nodes.sort.value='relevance';nodes['catalog-data'].textContent=JSON.stringify({episodes:[
    {episodeTitle:'תיאור בלבד',description:'חלל ומדע',pubDate:'2026-01-01'},
    {episodeTitle:'חלל ומדע',description:'<img src=x> חלל [',pubDate:'2020-01-01'},
    {episodeTitle:'אחר',description:'מוזיקה',pubDate:'2025-01-01'}]});
  Object.assign(ctx,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},navigator:{}});
  ctx.podkiCatalogClient();nodes.search.value='חלל מדע';nodes.search.oninput();
  assert.equal(nodes.list.children.length,2);
  const first=nodes.list.children[0],title=first.children[0].children[1].children[0];
  assert.deepEqual(title.children.filter(n=>n.tag==='mark').map(n=>n.textContent),['חלל','מדע']);
  const description=first.children[0].children[1].children[2];
  assert.equal(description.children[0].textContent,'<img src=x> ');
  assert.ok(description.children.every(n=>['span','mark'].includes(n.tag)));
  const check=first.children[0].children[0];check.checked=true;check.onchange();
  nodes.search.value='';nodes.search.oninput();nodes['only-selected'].checked=true;nodes['only-selected'].onchange();
  assert.equal(nodes.list.children.length,1);assert.equal(nodes.list.children[0].className,'card selected');
  nodes.search.value='[';nodes.search.oninput();assert.equal(nodes.list.children.length,1);
  assert.equal(nodes.list.children[0].children[0].children[1].children[2].children.find(n=>n.tag==='mark').textContent,'[');
  nodes.search.value='לא קיים';nodes.search.oninput();assert.equal(nodes.list.children[0].className,'empty');
  nodes.clear.onclick();assert.equal(nodes.download.disabled,true);
});

test('episode search groups interleaved results by feed and keeps every episode request',()=>{
  const {ctx,mails}=setup();
  const results=[
    {channelUrl:'https://a/feed',channelTitle:'שם משותף',episodeGuid:'a1',episodeTitle:'ראשון',description:'<script>bad</script>'},
    {channelUrl:'https://b/feed',channelTitle:'שם משותף',episodeGuid:'b1',episodeTitle:'שני'},
    {channelUrl:'https://a/feed',channelTitle:'שם משותף',episodeGuid:'a2',episodeTitle:'שלישי'}];
  ctx.podkiSearchEpisodes=()=>results;
  const originalCard=ctx.channelCard;
  ctx.channelCard=(title,url,image,content,mainFolder)=>'<section data-channel="'+url+'">'+originalCard(title,url,image,content,mainFolder)+'</section>';
  ctx.podkiSendEpisodeSearch('בדיקה',null);
  const html=mails[0].htmlBody;
  assert.equal((html.match(/data-channel=/g)||[]).length,2);
  assert.equal(buttons(html).filter(b=>b.label==='קבל פרקים').length,2);
  assert.ok(html.indexOf('>ראשון</h3>')<html.indexOf('>שלישי</h3>'));assert.ok(html.indexOf('>שלישי</h3>')<html.indexOf('>שני</h3>'));
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  const requests=buttons(html).filter(b=>b.label==='קבל פרק').map(b=>JSON.parse(new URL('mailto:'+b.uri).searchParams.get('subject')));
  assert.deepEqual(requests.map(r=>r.episodeGuid),['a1','a2','b1']);
  assert.equal(results[1].episodeGuid,'b1');
});

test('selection confirmation groups mixed statuses under one card per feed',()=>{
  const {ctx,mails}=setup();
  const originalCard=ctx.channelCard;
  ctx.channelCard=(title,url,image,content,mainFolder)=>'<section data-channel="'+url+'">'+originalCard(title,url,image,content,mainFolder)+'</section>';
  ctx.podkiSendRequestSummary([
    {channelUrl:'https://a/feed',channelTitle:'A',episodeTitle:'A1',status:'queued'},
    {channelUrl:'https://b/feed',channelTitle:'B',episodeTitle:'B1',status:'already'},
    {channelUrl:'https://a/feed',channelTitle:'A',episodeTitle:'A2',status:'failed',error:'<error>'}],null);
  const html=mails[0].htmlBody;
  assert.equal((html.match(/data-channel=/g)||[]).length,2);
  assert.equal(buttons(html).filter(b=>b.label==='קבל פרקים').length,2);
  assert.ok(html.indexOf('>A1</p>')<html.indexOf('>A2</p>'));assert.ok(html.indexOf('>A2</p>')<html.indexOf('>B1</p>'));
  assert.match(html,/נוסף לתור/);assert.match(html,/כבר ממתין בתור/);assert.match(html,/לא נוסף לתור — &lt;error&gt;/);
  assert.match(html,/1 פרקים נוספו לתור, 1 כבר ממתינים, ו-1 לא נוספו/);
});

test('large grouped confirmations split between episodes and retry only unsent pages',()=>{
  const {ctx,mails}=setup();ctx.PODKI_BODY_BYTES=14000;
  const results=Array.from({length:45},(_,i)=>({channelUrl:feed,channelTitle:'ערוץ',episodeTitle:'פרק-'+i+' '+('תיאור '.repeat(30)),status:'queued'}));
  const job={summaryIndex:0};ctx.podkiState().jobs.push(job);
  let attempts=0;ctx.MailApp.sendEmail=m=>{if(++attempts===2)throw Error('quota');mails.push(m);};
  assert.throws(()=>ctx.podkiSendRequestSummary(results,null),/quota/);assert.equal(job.summaryIndex,1);
  ctx.MailApp.sendEmail=m=>mails.push(m);ctx.podkiSendRequestSummary(results,null);
  assert.ok(mails.length>1);assert.equal(job.summaryIndex,mails.length);
  for(const mail of mails)assert.ok(Buffer.byteLength(mail.htmlBody,'utf8')<=ctx.PODKI_BODY_BYTES);
  const html=mails.map(m=>m.htmlBody).join('');
  for(let i=0;i<45;i++)assert.equal(html.split('פרק-'+i+' ').length-1,1);
});

test('channel search button has its new name and opens with an empty subject',()=>{
  const {ctx}=setup(),button=buttons(ctx.buildAddChannelBtn())[0];
  assert.equal(button.label,'חפש ערוץ');
  const uri=new URL('mailto:'+button.uri);
  assert.equal(uri.searchParams.get('subject'),'');assert.equal(uri.pathname,ctx.CTRL_SUBSCRIBE);
  assert.ok(!ctx.buildAddChannelBtn().includes('[כתובת RSS או מחרוזת חיפוש]'));
});

test('every email footer includes help and the current main folder in HTML and plain text',()=>{
  const {ctx,mails}=setup();let reads=0;
  ctx.podkiInitMainFolder({getUrl(){reads++;return 'https://drive.google.com/drive/folders/first';}});
  ctx.sendMissingRssFileEmail();ctx.sendNoResultsEmail('query');
  assert.equal(reads,1);
  for(const m of mails){assert.ok(m.htmlBody.includes(ctx.PODKI_HELP_URL));assert.ok(m.htmlBody.includes('/folders/first'));assert.ok(m.body.includes(ctx.PODKI_HELP_URL));assert.ok(m.body.includes('/folders/first'));}
  ctx.podkiInitMainFolder({getUrl(){reads++;return 'https://drive.google.com/drive/folders/second';}});
  ctx.sendNoResultsEmail('new');assert.equal(reads,2);assert.ok(mails.at(-1).htmlBody.includes('/folders/second'));assert.ok(!mails.at(-1).htmlBody.includes('/folders/first'));
});

test('main folder URL is reacquired on every hourly run and never falls back to a stale link',()=>{
  const {ctx,sys,mainFolder}=mainSetup({noSubscriptions:true});let calls=0;
  mainFolder.getUrl=()=> 'https://drive.google.com/drive/folders/run-'+(++calls);
  ctx.main(sys,mainFolder);assert.equal(ctx._podkiMainFolderUrl,'https://drive.google.com/drive/folders/run-1');
  ctx.main(sys,mainFolder);assert.equal(ctx._podkiMainFolderUrl,'https://drive.google.com/drive/folders/run-2');assert.equal(calls,2);
  ctx.podkiInitMainFolder({getUrl(){throw Error('unavailable');}});assert.equal(ctx._podkiMainFolderUrl,'');
});

test('episode search caps Apple results at twenty even when the service returns more',()=>{
  const {ctx}=setup();ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({results:Array.from({length:25},(_,i)=>({kind:'podcast-episode',feedUrl:feed,episodeGuid:'g'+i,trackName:'Episode '+i}))})});
  assert.equal(ctx.podkiSearchEpisodes('query').length,20);
  assert.equal(Object.keys(ctx.podkiState().appleResults).length,20);
});

test('long episode search is capped across pages and resumes without refetching or resending',()=>{
  const {ctx,mails}=setup(),sys=folder();ctx._sysFolder=sys;ctx.PODKI_BODY_BYTES=14000;
  let searches=0;ctx.podkiSearchEpisodes=()=>{searches++;return Array.from({length:25},(_,i)=>({channelUrl:feed,channelTitle:'ערוץ',episodeGuid:'g'+i,episodeTitle:'Result '+i,description:'מידע '.repeat(70)}));};
  ctx.podkiEnqueueJob('search',{query:'query'},'search-test');
  let sends=0;ctx.MailApp.sendEmail=m=>{if(++sends===2)throw Error('quota');mails.push(m);};
  ctx.podkiPumpJobs(sys,[],null,new Date());
  const delivery=ctx.podkiState().jobs[0].searchDelivery;assert.equal(delivery.next,1);assert.ok(delivery.pages.length>1);
  ctx.podkiInitMainFolder({getUrl:()=> 'https://drive.google.com/drive/folders/current'});
  ctx.MailApp.sendEmail=m=>mails.push(m);ctx.podkiPumpJobs(sys,[],null,new Date());
  assert.equal(searches,1);assert.equal(ctx.podkiState().jobs.length,0);assert.equal(mails.length,delivery.pages.length);
  const requests=mails.flatMap(m=>buttons(m.htmlBody).filter(b=>b.label==='קבל פרק'));
  assert.equal(requests.length,20);assert.equal(new Set(requests.map(b=>b.uri)).size,20);
  assert.match(mails[0].subject,/חלק 1 מתוך/);assert.match(mails[1].subject,/חלק 2 מתוך/);
  assert.ok(mails[1].htmlBody.includes('/folders/current'));
  // A new runtime's footer may add a folder link to previously prepared pages.
  for(const m of mails)assert.ok(Buffer.byteLength(m.htmlBody,'utf8')<=ctx.PODKI_BODY_BYTES);
});

test('long channel search keeps at most twenty results and resumes saved pages before another API call',()=>{
  const {ctx,mails}=setup(),sys=folder();ctx._sysFolder=sys;ctx.PODKI_BODY_BYTES=14000;
  const results=Array.from({length:25},(_,i)=>({title:'ערוץ '+i,rssUrl:'https://feed.test/'+i,author:'מחבר '.repeat(45),episodeCount:10}));
  let sends=0;ctx.MailApp.sendEmail=m=>{if(++sends===2)throw Error('quota');mails.push(m);};
  assert.throws(()=>ctx.sendPodcastSearchResultsEmail('query',results,null),/quota/);
  const delivery=ctx._emailsData.pendingSearches.query.delivery;assert.equal(delivery.count,20);assert.equal(delivery.next,1);
  ctx.handleITunesRetry=()=>{throw Error('must use saved results');};ctx.MailApp.sendEmail=m=>mails.push(m);
  const response=ctx.processSubscribeEmail(incoming('query'),sys,[],null,new Date());
  assert.equal(response.type,'subscribe_search');assert.equal(response.count,20);assert.equal(ctx._emailsData.pendingSearches.query,undefined);
  assert.equal(mails.length,delivery.pages.length);
  const catalogs=mails.flatMap(m=>buttons(m.htmlBody).filter(b=>b.label==='קבל פרקים'));assert.equal(catalogs.length,20);
  for(const m of mails)assert.ok(Buffer.byteLength(m.htmlBody,'utf8')<=ctx.PODKI_BODY_BYTES);
});

test('loader critical-error mail includes help and the current Drive folder even when processor loading fails',()=>{
  const {ctx,mails}=setup(),sys=folder(),mainFolder={getUrl:()=> 'https://drive.google.com/drive/folders/loader',getFoldersByName:()=>iterator([sys])};
  ctx.PropertiesService={getScriptProperties:()=>({getProperty:()=> 'hour'})};
  ctx.ScriptApp={getProjectTriggers:()=>[{getUniqueId:()=> 'hour'}]};
  ctx.DriveApp={getRootFolder:()=>({getFoldersByName:()=>iterator([mainFolder])})};
  ctx.UrlFetchApp.fetch=()=>{throw Error('load <failed>');};
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../files/podcast_v2.gs'),'utf8'),ctx);
  ctx.setUp();assert.equal(mails.length,1);
  assert.ok(mails[0].htmlBody.includes(ctx.PODKI_HELP_URL));assert.ok(mails[0].htmlBody.includes('/folders/loader'));
  assert.match(mails[0].htmlBody,/load &lt;failed&gt;/);assert.ok(mails[0].body.includes('/folders/loader'));
});

test('weekly report lists subscribed channels with no activity in both modes, including empty records and missing metadata',()=>{
  const {ctx,mails}=setup(),d=ctx._emailsData;
  const regular='https://quiet.test/regular',notify='https://quiet.test/notify',unknown='https://quiet.test/unknown',active='https://active.test/feed',removed='https://removed.test/feed';
  d.subscriptions.details[regular]={title:'ערוץ שקט רגיל'};
  d.subscriptions.details[notify]={title:'ערוץ שקט להתראות'};
  d.subscriptions.details[removed]={title:'ערוץ שהוסר'};
  d.weekly.channels[notify]={title:'ערוץ שקט להתראות',rssUrl:notify,items:[]};
  d.weekly.channels[active]={title:'ערוץ עם פרק חדש',rssUrl:active,items:[{episodeTitle:'פרק חדש',status:'notification',guid:'new'}]};
  const rssList=[{url:regular,notifyOnly:false},{url:notify,notifyOnly:true},{url:unknown,notifyOnly:false},{url:active,notifyOnly:true}];
  assert.equal(ctx.sendWeeklyEmail(folder(),d,rssList,null),true);assert.equal(mails.length,1);
  const html=mails[0].htmlBody;
  assert.equal(html.split('לא נרשמה פעילות בערוץ השבוע.').length-1,3);
  assert.match(html,/ערוץ שקט רגיל/);assert.match(html,/ערוץ שקט להתראות/);assert.ok(html.includes(unknown));
  assert.match(html,/מצב ההרשמה: שמירה אוטומטית בדרייב/);assert.match(html,/מצב ההרשמה: התראות בלבד/);
  assert.ok(!html.includes('ערוץ שהוסר'));assert.match(html,/פרק חדש — התראות בלבד/);
  const actions=buttons(html),catalogs=actions.filter(b=>b.label==='קבל פרקים');
  for(const url of [regular,notify,unknown,active])assert.equal(catalogs.filter(b=>new URL('mailto:'+b.uri).searchParams.get('subject')===url).length,1);
  for(const url of [regular,notify,unknown])assert.ok(actions.some(b=>b.label==='הסר'&&new URL('mailto:'+b.uri).searchParams.get('subject')===url));
});
