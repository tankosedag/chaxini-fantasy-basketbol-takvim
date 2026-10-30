const CACHE='chaxini-pwa-v18-background-refresh';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./icons/maskable-512.png','./icons/favicon-32.png','./icons/favicon-64.png','./favicon.ico','./team-engine.js','./team-analysis.js','./team-snapshot.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('chaxini-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(url.pathname.includes('/api/'))return;
 if(e.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 e.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try {
   const response=await fetch(e.request);
   if(response.ok)await cache.put(e.request,response.clone());
   return response;
  }catch(error){
   const cached=await cache.match(e.request);
   if(cached)return cached;
   if(e.request.mode==='navigate')return (await cache.match('./index.html'))||Response.error();
   return Response.error();
  }
 })());
});
