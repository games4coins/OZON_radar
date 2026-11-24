const allowedPage=(url,c)=>{try{let u=new URL(url);return ['vk.ru','vk.com'].includes(u.hostname)&&u.pathname==='/im/convo/'+c.peer}catch(e){return false}};
const allowedImage=url=>{try{let u=new URL(url);return u.protocol==='https:'&&['vk.ru','vk.com','userapi.com','vkuserphoto.ru','vk-cdn.net'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch(e){return false}};
let busy=false;
async function importPhoto(src,page,automatic=false){
 const {config:c,seen=[]}=await chrome.storage.local.get(['config','seen']);
 if(!c||!c.key||!c.endpoint||!allowedPage(page,c)||!allowedImage(src)||automatic&&!c.watch)throw Error('Источник не разрешён или не настроен');
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.endpoint))throw Error('Неверный URL GAS');
 if(seen.includes(src))return 'Уже импортировано';
 if(busy)throw Error('Импорт занят; повторите');
 busy=true;
 try{
  let response=await fetch(src,{credentials:'omit',redirect:'error'});if(!response.ok)throw Error('Фото недоступно');
  let blob=await response.blob();if(blob.size>10000000||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw Error('Неподдерживаемый файл');
  let bytes=new Uint8Array(await blob.arrayBuffer()), chunks=[];
  for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  let r=await fetch(c.endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'upload',key:c.key,mime:blob.type,data:btoa(chunks.join('')),source:page}),credentials:'omit'});
  let j=await r.json();if(!j.ok)throw Error('GAS не принял фото');
  await chrome.storage.local.set({seen:[...seen,src].slice(-1000),last:j.duplicate?'Дубликат':'Добавлено в очередь'});
  return j.duplicate?'Дубликат':'Добавлено в очередь';
 }finally{busy=false}
}
chrome.runtime.onInstalled.addListener(()=>chrome.contextMenus.create({id:'radar-import',title:'Добавить фото в OZON Radar',contexts:['image'],documentUrlPatterns:['https://vk.ru/im/convo/*','https://vk.com/im/convo/*']}));
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{if(info.menuItemId!=='radar-import')return;try{await importPhoto(info.srcUrl,tab.url)}catch(e){await chrome.storage.local.set({last:e.message})}});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(m.type!=='photo'||!sender.tab)return;importPhoto(m.src,m.page||sender.tab.url,m.automatic).then(v=>reply({ok:true,message:v})).catch(e=>reply({ok:false,message:e.message}));return true});
