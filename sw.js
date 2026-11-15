const C='mercado-v1',CORE=['./','index.html','app.js','local-api.js','catalogo.json','prompts.json','manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
  if(e.request.method!=='GET'||/script\.google|googleapis\.com/.test(u.hostname))return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r})
    .catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html'))));});
