const DB_NAME='cap-schedule-offline';
const DB_VERSION=1;
let dbPromise=null;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('cache')) db.createObjectStore('cache',{keyPath:'key'});
      if(!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName,mode,work){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(storeName,mode);
    const store=t.objectStore(storeName);
    let result;
    try{result=work(store);}catch(err){reject(err);return;}
    t.oncomplete=()=>resolve(result);
    t.onerror=()=>reject(t.error);
    t.onabort=()=>reject(t.error||new Error('IndexedDB transaction aborted'));
  });
}

export async function putCache(key,value){
  return tx('cache','readwrite',store=>store.put({key,value,updated_at:new Date().toISOString()}));
}
export async function getCache(key){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('cache','readonly').objectStore('cache').get(key);
    req.onsuccess=()=>resolve(req.result?.value??null);
    req.onerror=()=>reject(req.error);
  });
}
export async function putDraft(key,value,dirty=false){
  return tx('drafts','readwrite',store=>store.put({key,value,dirty,updated_at:new Date().toISOString()}));
}
export async function getDraft(key){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('drafts','readonly').objectStore('drafts').get(key);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}
export async function getDirtyDrafts(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('drafts','readonly').objectStore('drafts').getAll();
    req.onsuccess=()=>resolve((req.result||[]).filter(x=>x.dirty));
    req.onerror=()=>reject(req.error);
  });
}
export async function markDraftClean(key,value=null){
  const current=await getDraft(key);
  if(!current && value==null)return;
  return putDraft(key,value??current.value,false);
}
export async function clearOfflineData(){
  const db=await openDB();
  await Promise.all(['cache','drafts'].map(storeName=>new Promise((resolve,reject)=>{
    const req=db.transaction(storeName,'readwrite').objectStore(storeName).clear();
    req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);
  })));
}

export const offlineKeys={
  units:'units',
  lookup:unitId=>`lookup:${unitId}`,
  publicMonth:(unitId,year,month,program)=>`public:${unitId}:${year}:${month}:${program}`,
  specialActivities:'special:published',
  specialDetail:id=>`special-detail:${id}`,
  draft:(unitId,program,year,month)=>`draft:${unitId}:${program}:${year}:${month}`
};
