const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {data}=require('./quote-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../index.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/boot\(\);\s*$/,'');
const clone=x=>JSON.parse(JSON.stringify(x));
function storage(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)}}
function setup(){
 const elements=new Map();function el(){return {value:'',textContent:'',innerHTML:'',style:{},hidden:false,disabled:false,classList:{toggle(){}},querySelectorAll(){return []}}}
 const local=storage(),session=storage();local.setItem('bhCrmToken','fixture-token');
 const ctx={console,crypto:webcrypto,TextEncoder,Uint8Array,setTimeout(){},localStorage:local,sessionStorage:session,window:{scrollTo(){}},confirm(){return true},alert(){throw Error('Unexpected blocking alert')},document:{querySelector(s){if(!elements.has(s))elements.set(s,el());return elements.get(s)},querySelectorAll(){return []},getElementById(){return el()}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 let paints=0;ctx.render=()=>{paints++;ctx.screenRevision++;ctx.screenIsForm=false};ctx.showLogin=()=>{};
 const requests=[];ctx.post=body=>new Promise((resolve,reject)=>requests.push({body,resolve,reject}));
 return {ctx,elements,local,session,requests,paints:()=>paints};
}
const tick=()=>new Promise(r=>setImmediate(r));
async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await tick()}throw Error('Condition was not reached')}
async function seed(t){await t.ctx.writeDataCache(clone(data),'fixture-token',t.ctx.apiUrl(),t.ctx.dataEpoch);assert(t.session.getItem(t.ctx.K_DATA_CACHE))}
(async()=>{
 let t=setup(),p=t.ctx.boot();assert.equal(t.requests.length,1);assert.equal(t.ctx.D,null);assert(t.elements.get('#app').innerHTML.includes('正在讀取案件資料'));
 assert.strictEqual(t.ctx.load(),t.ctx.loadPending.promise);assert.equal(t.requests.length,1,'parallel refresh must share the request');
 t.requests[0].resolve({ok:true,result:clone(data)});await p;assert.equal(t.paints(),1);await until(()=>t.session.getItem(t.ctx.K_DATA_CACHE));
 // A warm reload paints data while the server promise remains unresolved.
 t=setup();await seed(t);p=t.ctx.boot();await until(()=>t.ctx.D!==null);assert.equal(t.paints(),1);assert(t.elements.get('#syncText').textContent.includes('背景更新'));
 const updated=clone(data);updated.cases[0]['案名']='fresh-from-server';t.requests[0].resolve({ok:true,result:updated});await p;assert.equal(t.ctx.D.cases[0]['案名'],'fresh-from-server');assert.equal(t.paints(),2);
 // A late response cannot overwrite a form opened after the cached first paint.
 t=setup();await seed(t);p=t.ctx.boot();await until(()=>t.ctx.D!==null);t.ctx.S.view='editor';t.ctx.screenRevision++;const paints=t.paints();t.requests[0].resolve({ok:true,result:updated});await p;assert.equal(t.paints(),paints);assert.equal(t.ctx.S.view,'editor');
 // An explicit background refresh also preserves an already-open generic form.
 t.ctx.S.view='list';t.ctx.screenIsForm=true;p=t.ctx.load({background:true});t.requests[1].resolve({ok:true,result:clone(data)});await p;assert.equal(t.paints(),paints);
 // Failed synchronization keeps cached data available, with an honest error state.
 t=setup();await seed(t);p=t.ctx.boot();t.requests[0].reject(Error('offline'));await p;assert(t.ctx.D);assert(t.elements.get('#syncText').textContent.includes('更新失敗'));assert.equal(t.elements.get('#syncRetry').disabled,false);
 // Logout and expired authorization remove cached data and ignore late reads.
 t=setup();await seed(t);p=t.ctx.boot();await until(()=>t.ctx.D!==null);t.ctx.logout();t.requests[0].resolve({ok:true,result:clone(data)});await p;assert.equal(t.ctx.D,null);assert.equal(t.session.getItem(t.ctx.K_DATA_CACHE),null);
 t=setup();await seed(t);p=t.ctx.boot();await until(()=>t.ctx.D!==null);t.requests[0].resolve({ok:false,error:'auth'});await p;assert.equal(t.ctx.D,null);assert.equal(t.session.getItem(t.ctx.K_DATA_CACHE),null);assert.equal(t.local.getItem(t.ctx.K_TOK),null);
 // Cache isolation, expiry and corruption all fall back to an ordinary fresh read.
 for(const bad of ['token','url','expired','corrupt']){
  t=setup();await seed(t);
  if(bad==='token')t.local.setItem(t.ctx.K_TOK,'different-user');
  if(bad==='url')t.ctx.API_URL_DEFAULT='https://example.test/another-api';
  if(bad==='expired'){const e=JSON.parse(t.session.getItem(t.ctx.K_DATA_CACHE));e.savedAt=Date.now()-t.ctx.DATA_CACHE_TTL-1;t.session.setItem(t.ctx.K_DATA_CACHE,JSON.stringify(e))}
  if(bad==='corrupt')t.session.setItem(t.ctx.K_DATA_CACHE,'{bad');
  assert.equal(await t.ctx.readDataCache(t.local.getItem(t.ctx.K_TOK),t.ctx.apiUrl()),null,bad);
 }
 // No browser storage / Web Crypto support must never prevent loading fresh data.
 t=setup();t.ctx.crypto=undefined;t.session.getItem=()=>{throw Error('blocked')};p=t.ctx.boot();t.requests[0].resolve({ok:true,result:clone(data)});await p;assert(t.ctx.D);
 // Writes invalidate an older pending read and force the post-save load to be fresh.
 t=setup();const old=t.ctx.load();const write=t.ctx.api('saveCase',{'案件ID':'DEMO-K'});t.requests[1].resolve({ok:true,result:{}});await write;const fresh=t.ctx.load();assert.equal(t.requests.length,3);t.requests[2].resolve({ok:true,result:updated});await fresh;t.requests[0].resolve({ok:true,result:clone(data)});await old;assert.equal(t.ctx.D.cases[0]['案名'],'fresh-from-server');
 console.log('PASS: cached first paint before network, refresh deduplication, fresh synchronization, form preservation, offline fallback, logout/auth cleanup, token/API isolation, expiry, storage failure, mutation/read races');
})().catch(e=>{console.error(e);process.exitCode=1});
