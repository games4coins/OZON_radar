let running=false;
async function scan(automatic){
 if(running||document.hidden)return {count:0};running=true;let count=0;
 try{
 const {config:c,seen=[]}=await chrome.storage.local.get(['config','seen']);
 if(!c||location.pathname!=='/im/convo/'+c.peer||automatic&&!c.watch)return {count:0};
 const images=[...document.querySelectorAll('[data-message-id] img,[data-msgid] img,[data-cmid] img,[class*="MessageItem"] img,[class*="messageItem"] img,[class*="im-mess"] img')];
 const visited=new Set(seen);
 for(const img of images){
  let src=img.currentSrc||img.src;if(!src||visited.has(src)||img.naturalWidth<320||img.naturalHeight<180)continue;
  visited.add(src);
  const parent=img.closest('[data-cmid],[data-message-id],[data-msgid]');
  const cmid=parent?.getAttribute('data-cmid');let page=location.origin+location.pathname+(cmid&&/^\d+$/.test(cmid)?'?cmid='+cmid:'');
  let result=await chrome.runtime.sendMessage({type:'photo',src,page,automatic});if(result.ok)count++;
 }
 return {count};
 }finally{running=false}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(m.type!=='scan')return;scan(false).then(reply).catch(e=>reply({error:e.message}));return true});
setInterval(()=>scan(true).catch(()=>{}),30000);
