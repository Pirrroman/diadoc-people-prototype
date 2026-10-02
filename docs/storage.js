import { ORGS, newDocument, transition, event, requireOrg } from './domain.js';
const DB_NAME='diadoc-people-demo-v1';
let db;
export function openDatabase() {return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{const d=req.result;d.createObjectStore('documents',{keyPath:'id'});d.createObjectStore('files',{keyPath:'id'});d.createObjectStore('meta');d.createObjectStore('offers',{keyPath:'id'});};
  req.onsuccess=()=>{db=req.result;db.onversionchange=()=>db.close();resolve(db);};
  req.onerror=()=>reject(new Error('Не удалось открыть хранилище браузера. Проверьте настройки приватности.'));
});}
function get(store,key) {return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function all(store) {return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function listDocuments(orgId) {return (await all('documents')).filter(d=>d.orgId===orgId).sort((a,b)=>b.createdAt-a.createdAt);}
export const getDocument=id=>get('documents',id);
export async function findByToken(token) {return (await all('documents')).find(d=>d.token===token);}
export const getFile=id=>get('files',id);
export async function listOffers(orgId) {return (await all('offers')).filter(o=>o.orgId===orgId);}
function broadcast(){try{localStorage.setItem('diadoc-people-change',String(Date.now())+Math.random());}catch{} }
export async function sha256(blob) {const bytes=await blob.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function create(input,blob,name) {
  const doc=newDocument(input);doc.fileKey=crypto.randomUUID();doc.fileName=name;doc.fileSize=blob.size;doc.hash=await sha256(blob);
  return new Promise((resolve,reject)=>{const tx=db.transaction(['documents','files'],'readwrite');tx.objectStore('documents').add(doc);tx.objectStore('files').add({id:doc.fileKey,blob});tx.oncomplete=()=>{broadcast();resolve(doc);};tx.onerror=()=>reject(new Error('Не удалось сохранить PDF. Возможно, в хранилище браузера мало места.'));});
}
export function change(id,action,context) {return new Promise((resolve,reject)=>{
  const tx=db.transaction('documents','readwrite');const s=tx.objectStore('documents');const r=s.get(id);let outcome,problem;
  r.onsuccess=()=>{try{if(!r.result)throw new Error('Документ не найден.');outcome=transition(r.result,action,context);s.put(outcome.doc);}catch(e){problem=e;tx.abort();}};
  tx.oncomplete=()=>{broadcast();if(outcome.result.error)reject(new Error(outcome.result.error));else resolve(outcome.doc);};
  tx.onabort=()=>reject(problem||tx.error||new Error('Не удалось изменить документ.'));tx.onerror=()=>{};
});}
export function removeDraft(id,orgId) {return new Promise((resolve,reject)=>{const tx=db.transaction(['documents','files'],'readwrite');const s=tx.objectStore('documents');const r=s.get(id);let error;r.onsuccess=()=>{try{const d=r.result;if(!d)throw new Error('Документ не найден.');requireOrg(d,orgId);if(d.status!=='draft')throw new Error('Можно удалить только черновик.');s.delete(id);tx.objectStore('files').delete(d.fileKey);}catch(e){error=e;tx.abort();}};tx.oncomplete=()=>{broadcast();resolve();};tx.onabort=()=>reject(error||tx.error);});}
export function recordOffer(orgId,reason) {return new Promise((resolve,reject)=>{const tx=db.transaction('offers','readwrite');tx.objectStore('offers').add({id:crypto.randomUUID(),orgId,reason,at:Date.now()});tx.oncomplete=()=>{broadcast();resolve();};tx.onerror=()=>reject(tx.error);});}
export async function seed() {
  if(await get('meta','seeded'))return;
  const config=[
    ['auto','Согласование дополнительных работ','Алексей Морозов','waiting',1,'work.pdf'],
    ['auto','Акт выполненных работ','Мария Соколова','signed',3,'act.pdf'],
    ['auto','Заказ-наряд на обслуживание','Дмитрий Волков','draft',5,'order.pdf'],
    ['auto','Согласование дополнительных работ','Анна Белова','declined',7,'work.pdf'],
    ['travel','Договор об оказании услуг','Ирина Орлова','waiting',2,'travel.pdf'],
  ];
  const prepared=[];
  for(const [orgId,title,recipient,status,days,asset] of config) {
    const response=await fetch(new URL(`./assets/${asset}`,import.meta.url));if(!response.ok)throw new Error('Не удалось загрузить примеры PDF. Обновите страницу.');const blob=await response.blob();const now=Date.now()-days*3600_000;
    let d=newDocument({orgId,title,recipient,phone:'79000000000'},now);d.fileKey=crypto.randomUUID();d.fileName=asset;d.fileSize=blob.size;d.hash=await sha256(blob);d.seed=true;
    if(status!=='draft')d=transition(d,{type:'send'},{orgId},now+1000).doc;
    if(status==='signed'){d.status='signed';d.signedAt=now+4000;event(d,'viewed',now+2000);event(d,'signed',now+4000);d.proof={id:crypto.randomUUID(),demo:true,version:1,hash:d.hash,at:d.signedAt,rules:'demo-2026-10-v1'};}
    if(status==='declined'){d.status='declined';d.reason='Хочу уточнить состав работ';event(d,'declined',now+4000,d.reason);}
    prepared.push({doc:d,file:{id:d.fileKey,blob}});
  }
  // The read and write share a transaction, so opening two tabs won't create duplicate seed rows.
  await new Promise((resolve,reject)=>{const tx=db.transaction(['documents','files','meta'],'readwrite');const meta=tx.objectStore('meta');const q=meta.get('seeded');q.onsuccess=()=>{if(q.result)return;for(const p of prepared){tx.objectStore('documents').put(p.doc);tx.objectStore('files').put(p.file);}meta.put(true,'seeded');};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
export function clearDatabase() {return new Promise((resolve,reject)=>{const tx=db.transaction(['documents','files','offers','meta'],'readwrite');for(const s of ['documents','files','offers','meta'])tx.objectStore(s).clear();tx.oncomplete=()=>{broadcast();resolve();};tx.onerror=()=>reject(tx.error);});}
