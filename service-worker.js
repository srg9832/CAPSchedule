const CACHE='cap-schedule-v3-shell-1';
const RUNTIME='cap-schedule-v3-runtime-1';
const SUPABASE_ESM='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SHELL=[
  './','./index.html','./styles.css','./config.js','./manifest.json','./service-worker.js',
  './js/app.js','./js/db.js','./js/demo-data.js','./js/offline-store.js',
  './assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(SHELL);
    try{await cache.add(SUPABASE_ESM)}catch(err){console.warn('Supabase module was not precached',err)}
  })());
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keep=new Set([CACHE,RUNTIME]);
    for(const key of await caches.keys())if(!keep.has(key))await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);

  // Never service Supabase REST/Auth/Functions data from the service-worker cache.
  if(url.hostname.endsWith('.supabase.co'))return;

  // Cache the Supabase browser module after the first successful online load.
  if(event.request.url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@')){
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if(url.origin!==self.location.origin)return;

  if(event.request.mode==='navigate'){
    event.respondWith(networkFirst(event.request,'./index.html'));
    return;
  }

  // config.js should favor the latest network copy; static assets can be served immediately and refreshed.
  if(url.pathname.endsWith('/config.js')){
    event.respondWith(networkFirst(event.request,'./config.js'));
    return;
  }
  event.respondWith(staleWhileRevalidate(event.request));
});

async function cacheFirst(request){
  const hit=await caches.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  if(response&&response.ok)(await caches.open(RUNTIME)).put(request,response.clone());
  return response;
}
async function networkFirst(request,fallback){
  try{
    const response=await fetch(request);
    if(response&&response.ok)(await caches.open(CACHE)).put(request,response.clone());
    return response;
  }catch{
    return (await caches.match(request))||(await caches.match(fallback));
  }
}
async function staleWhileRevalidate(request){
  const hit=await caches.match(request);
  const network=fetch(request).then(async response=>{
    if(response&&response.ok)(await caches.open(RUNTIME)).put(request,response.clone());
    return response;
  }).catch(()=>null);
  return hit||await network||new Response('Offline',{status:503,statusText:'Offline'});
}
