const P=PropertiesService.getScriptProperties();
const SCHEMA={
  QUEUE:['id','created','point','date','source','file','status','lease','note'],
  GOODS:['id','row','point','date','name','price','qty','sum','grams','category','status','source','file'],
  RULES:['category','pattern','exclude','enabled'],
  SETTINGS:['key','value']
};
const SEED=[
 ['Мясные консервы','туш[её]н|говядин.*собственн.*сок|свинин.*собственн.*сок|индейк.*собственн.*сок|мясн.*консерв|паштет','корм|со вкусом',true],
 ['Рыбные консервы','шпрот|сайр|сардин|печень трески|рыбн.*консерв|тунец.*сок|тунец.*масл','корм|со вкусом',true],
 ['Рыба и морепродукты','лосос|с[её]мг|форел|горбуш|треск|минта[йя]|скумбри|сельд|палтус|кревет|кальмар|миди|икра|рыб[аы]|тунец','корм|со вкусом|груш.*форел|имитац',true],
 ['Мясо и птица','говядин|свинин|баран|ягн[её]н|индейк|курин|куриц|утк[аи]|петелинк|троекуров|мяс[оа]|филе|стейк|грудк','корм|со вкусом|лапш|чипс|яйц|сырок|салат',true],
 ['Деликатесы','бекон|ветчин|колбас|сосиск|сардель|балык|окорок|пастром|шейка|буженин|сервелат|салями','корм|со вкусом|чипс',true],
 ['Полуфабрикаты','фрикадел|котлет|тефтел|люля|шашлык|шницел|наггет|пельмен|купат|бифштекс|бургер','корм|со вкусом',true],
 ['Прочие консервы','маслины|оливки|консерв|кукуруз.*бан|горошек.*бан','корм|со вкусом',false],
 ['Молочное','молок|кефир|творог|сыр|йогурт|сливк|сметан','со вкусом сыра',false]
];
function setup(){
 const ss=SpreadsheetApp.getActiveSpreadsheet(); if(!ss)throw Error('Запустите из привязанной таблицы');
 const owner=Session.getEffectiveUser().getEmail(); if(!owner)throw Error('Не определён владелец');
 P.setProperties({SHEET_ID:ss.getId(),OWNER:owner,UPLOAD_KEY:P.getProperty('UPLOAD_KEY')||Utilities.getUuid()+Utilities.getUuid(),WORKER_KEY:P.getProperty('WORKER_KEY')||Utilities.getUuid()+Utilities.getUuid(),FOLDER:P.getProperty('FOLDER')||DriveApp.createFolder('OZON Radar private').getId()});
 Object.keys(SCHEMA).forEach(k=>{let s=ss.getSheetByName(k)||ss.insertSheet(k);if(!s.getLastRow()){s.appendRow(SCHEMA[k]);s.setFrozenRows(1);}});
 if(sheet_('RULES').getLastRow()===1)sheet_('RULES').getRange(2,1,SEED.length,4).setValues(SEED);
}
function sheet_(k){return SpreadsheetApp.openById(P.getProperty('SHEET_ID')).getSheetByName(k)}
function rows_(k){return sheet_(k).getDataRange().getValues().slice(1)}
function owner_(){const email=Session.getActiveUser().getEmail();if(!email||email!==P.getProperty('OWNER'))throw Error('Доступ только владельцу')}
function safe_(v){return typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v}
function append_(k,a){sheet_(k).appendRow(a.map(safe_))}
function lock_(f){let l=LockService.getScriptLock();l.waitLock(25000);try{return f()}finally{l.releaseLock()}}
function out_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function clean_(s,n){return String(s||'').slice(0,n||500)}
function doGet(){try{owner_();return HtmlService.createHtmlOutputFromFile('Index').setTitle('OZON Radar')}catch(e){return HtmlService.createHtmlOutput('Доступ запрещён')}}
function doPost(e){try{const b=JSON.parse(e.postData.contents);if(b.action==='upload'&&b.key===P.getProperty('UPLOAD_KEY')&&b.key)return out_(ingest_(b));if(!b.key||b.key!==P.getProperty('WORKER_KEY'))return out_({ok:false,error:'Unauthorized'});if(b.action==='claim')return out_(claim_());if(b.action==='finish')return out_(finish_(b));if(b.action==='fail')return out_(fail_(b));return out_({ok:false,error:'Unknown action'})}catch(e){return out_({ok:false,error:'Request failed'})}}
function ingest_(b){
 if(!b.data||b.data.length>14000000||!['image/jpeg','image/png','image/webp'].includes(b.mime))throw Error('Только JPG/PNG/WebP до 10 МБ');
 let bytes=Utilities.base64Decode(b.data);if(bytes.length>10000000)throw Error('Слишком большой файл');
 const id=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(x=>('0'+((x+256)%256).toString(16)).slice(-2)).join('');
 return lock_(()=>{if(rows_('QUEUE').some(r=>r[0]===id))return {ok:true,duplicate:true,id};
 const file=DriveApp.getFolderById(P.getProperty('FOLDER')).createFile(Utilities.newBlob(bytes,b.mime,id+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[b.mime])));
 append_('QUEUE',[id,new Date(),clean_(b.point,120),clean_(b.date,30),clean_(b.source,500),file.getId(),'pending','','']);return {ok:true,id}});
}
function upload(b){owner_();return ingest_(b)}
function claim_(){return lock_(()=>{let s=sheet_('QUEUE'),rows=rows_('QUEUE');let i=rows.findIndex(r=>r[6]==='pending'||(r[6]==='processing'&&Number(r[7])<Date.now()-45*60000));if(i<0)return {ok:true,job:null};let r=rows[i];let lease=Date.now();let blob=DriveApp.getFileById(r[5]).getBlob();s.getRange(i+2,7,1,2).setValues([['processing',lease]]);return {ok:true,job:{id:r[0],point:String(r[2]),date:dateStr_(r[3]),source:String(r[4]),lease,data:Utilities.base64Encode(blob.getBytes())}}})}
function dateStr_(v){return v instanceof Date?Utilities.formatDate(v,'Europe/Moscow','yyyy-MM-dd'):String(v||'')}
function classify_(name,rules){for(const r of rules){try{if(new RegExp(r[1],'iu').test(name)&&(!r[2]||!new RegExp(r[2],'iu').test(name)))return r[0]}catch(e){}}return 'Не определено'}
function finish_(b){return lock_(()=>{const q=rows_('QUEUE'),i=q.findIndex(r=>r[0]===b.id&&r[6]==='processing'&&Number(r[7])===Number(b.lease));if(i<0)return {ok:false,error:'Lease expired'};if(!Array.isArray(b.rows)||b.rows.length>300)throw Error('Invalid rows');
 let r=q[i],g=sheet_('GOODS'),old=rows_('GOODS');for(let j=old.length-1;j>=0;j--)if(old[j][0]===b.id)g.deleteRow(j+2);
 const rules=rows_('RULES'),point=r[2]||clean_(b.point,120),date=dateStr_(r[3])||clean_(b.date,30);
 const data=b.rows.filter(x=>x.name).map((x,j)=>[b.id,j+1,point,date,clean_(x.name,800),num_(x.price),num_(x.qty),num_(x.sum),num_(x.grams),classify_(x.name,rules),clean_(x.status,80),r[4],r[5]].map(safe_));
 if(data.length)g.getRange(g.getLastRow()+1,1,data.length,13).setValues(data);
 const s=sheet_('QUEUE');s.getRange(i+2,3,1,2).setValues([[safe_(point),safe_(date)]]);s.getRange(i+2,7,1,3).setValues([[data.length?'done':'review','',clean_(b.note,300)]]);return {ok:true,count:data.length}})}
function num_(v){return v===null||v===''||v===undefined||!Number.isFinite(Number(v))?'':Number(v)}
function fail_(b){return lock_(()=>{let i=rows_('QUEUE').findIndex(r=>r[0]===b.id&&r[6]==='processing'&&Number(r[7])===Number(b.lease));if(i<0)return {ok:false};sheet_('QUEUE').getRange(i+2,7,1,3).setValues([['review','','Worker error; retry manually']]);return {ok:true}})}
function retry(id){owner_();return lock_(()=>{let i=rows_('QUEUE').findIndex(r=>r[0]===id&&['review','done'].includes(r[6]));if(i>=0)sheet_('QUEUE').getRange(i+2,7,1,3).setValues([['pending','','']]);return i>=0})}
function getData(){owner_();let rules=rows_('RULES');let goods=rows_('GOODS').map(r=>{r[3]=dateStr_(r[3]);r[9]=classify_(r[4],rules);return r});return {goods,rules,queue:rows_('QUEUE').map(r=>{r[1]=dateStr_(r[1]);r[3]=dateStr_(r[3]);return r}),settings:rows_('SETTINGS')}}
function saveRules(rules){owner_();if(!Array.isArray(rules)||rules.length>100)throw Error('Invalid rules');const a=rules.map(r=>{if(!r[0]||!r[1])throw Error('Заполните категорию и шаблон');new RegExp(r[1],'iu');if(r[2])new RegExp(r[2],'iu');return [clean_(r[0],100),clean_(r[1],1500),clean_(r[2],1500),Boolean(r[3])].map(safe_)});return lock_(()=>{let s=sheet_('RULES');if(s.getLastRow()>1)s.getRange(2,1,s.getLastRow()-1,4).clearContent();if(a.length)s.getRange(2,1,a.length,4).setValues(a);return true})}
function saveSettings(obj){owner_();return lock_(()=>{let s=sheet_('SETTINGS');if(s.getLastRow()>1)s.getRange(2,1,s.getLastRow()-1,2).clearContent();Object.entries(obj).filter(([k])=>['keywords','exclude','maxPrice','minQty','point'].includes(k)).forEach(([k,v])=>append_('SETTINGS',[k,clean_(v,1000)]));return true})}
function vkHistory_(){let token=P.getProperty('VK_TOKEN'),peer=P.getProperty('VK_PEER_ID');if(!token||!peer)throw Error('Настройте VK_TOKEN и VK_PEER_ID');let res=JSON.parse(UrlFetchApp.fetch('https://api.vk.com/method/messages.getHistory',{method:'post',payload:{access_token:token,peer_id:peer,count:'100',v:'5.199'},muteHttpExceptions:true}).getContentText());if(res.error)throw Error('VK API error '+res.error.error_code);return res.response.items||[]}
function testVk(){let a=vkHistory_();console.log('VK access OK, messages: '+a.length)}
function installVkTrigger(){if(!P.getProperty('VK_ADMIN_IDS'))throw Error('Укажите ID администраторов');testVk();ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='pollVk').forEach(t=>ScriptApp.deleteTrigger(t));ScriptApp.newTrigger('pollVk').timeBased().everyMinutes(5).create()}
function pollVk(){const ids=(P.getProperty('VK_ADMIN_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean);if(!ids.length)return;const peer=P.getProperty('VK_PEER_ID');let messages=vkHistory_().filter(m=>ids.includes(String(m.from_id))).reverse();let known=new Set(rows_('QUEUE').map(r=>r[4]));for(const m of messages){for(const a of m.attachments||[]){if(a.type!=='photo'||!a.photo)continue;let p=a.photo;let src='https://vk.ru/im/convo/'+peer+'?cmid='+m.conversation_message_id;let link=src+'#photo'+p.owner_id+'_'+p.id;if(known.has(link))continue;let size=(p.sizes||[]).sort((a,b)=>b.width*b.height-a.width*a.height)[0];if(!size||!/^https:\/\//.test(size.url))continue;try{let blob=UrlFetchApp.fetch(size.url).getBlob();ingest_({data:Utilities.base64Encode(blob.getBytes()),mime:blob.getContentType().split(';')[0],source:link});}catch(e){console.log('Photo import failed')}}}}
