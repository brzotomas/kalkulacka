import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import worker from '../src/worker.mjs';
const owner='a'.repeat(64),viewer='b'.repeat(64),hash=s=>createHash('sha256').update(s).digest('hex');
function setup(){
  const db=new DatabaseSync(':memory:');
  const sql=fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort().map(f=>fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8')).join('\n');db.exec(sql);
  const DB={prepare(sql){return {bind(...params){return {async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};}};}};}};
  const env={DB,OWNER_TOKEN_HASH:hash(owner),VIEWER_TOKEN_HASH:hash(viewer),VIEWER_TOKEN:viewer,ALLOWED_ORIGIN:'https://brzotomas.github.io'};
  const call=(path,method='POST',token=owner,body,origin='https://brzotomas.github.io')=>worker.fetch(new Request('https://data.example'+path,{method,headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
  return {db,env,call};
}
const own=()=>({version:1,settings:{},cash:{asOf:''},team:{},weeklyInputs:[],forecastItems:[],decisions:[],reviews:[],snapshots:[],experiments:[],memory:[],jobFacts:{}});
test('anonymous/incorrect keys cannot read data, GET cannot cache private state, bad origin rejected',async()=>{
  const {call}=setup();assert.equal((await call('/api/read','POST','x'.repeat(64))).status,401);assert.equal((await call('/api/read','GET')).status,405);assert.equal((await call('/api/read','POST',owner,undefined,'https://other.example')).status,403);
});
test('viewer can read current shared state but cannot write or obtain editing secrets',async()=>{
  const {call}=setup();let r=await call('/api/state','PUT',owner,{own:own(),expectedRevision:0,mutationId:'first-write'});assert.equal(r.status,200);
  r=await call('/api/read','POST',viewer);assert.equal(r.headers.get('cache-control'),'no-store, private');const value=await r.json();assert.equal(value.role,'viewer');assert.equal(value.revision,1);assert.equal(value.own.version,1);assert.equal(value.viewerToken,undefined);
  assert.equal((await call('/api/state','PUT',viewer,{own:own(),expectedRevision:1,mutationId:'second-write'})).status,403);
});
test('concurrent writers cannot overwrite a newer revision; identical request retries are idempotent',async()=>{
  const {call}=setup(),payload={own:own(),expectedRevision:0,mutationId:'same-operation'};
  assert.equal((await call('/api/state','PUT',owner,payload)).status,200);
  assert.equal((await (await call('/api/state','PUT',owner,payload)).json()).revision,1);
  assert.equal((await call('/api/state','PUT',owner,{...payload,mutationId:'stale-operation'})).status,409);
  const newer=own();newer.cash.bankCash=123;
  assert.equal((await call('/api/state','PUT',owner,{own:newer,expectedRevision:1,mutationId:'fresh-operation'})).status,200);
  assert.equal((await (await call('/api/read')).json()).own.cash.bankCash,123);
});
test('source and Founder revisions are independent and malformed data cannot replace stored data',async()=>{
  const {call}=setup();assert.equal((await call('/api/source','PUT',owner,{source:{nastaveni:{},zakazky:[],vyklizeni:[]},expectedRevision:0,mutationId:'source-operation'})).status,200);
  assert.equal((await call('/api/state','PUT',owner,{own:own(),expectedRevision:0,mutationId:'own-operation'})).status,200);
  assert.equal((await call('/api/state','PUT',owner,null)).status,400);
  assert.equal((await call('/api/state','PUT',owner,{own:{version:1},expectedRevision:1,mutationId:'invalid-operation'})).status,400);
  const value=await(await call('/api/read')).json();assert.equal(value.revision,1);assert.equal(value.sourceRevision,1);
});
test('oversized writes are refused and CORS preflight allows authenticated POST and PUT',async()=>{
  const {call}=setup();const value=own();value.extra='x'.repeat(900001);
  assert.equal((await call('/api/state','PUT',owner,{own:value,expectedRevision:0,mutationId:'large-operation'})).status,413);
  const response=await call('/api/read','OPTIONS');assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),'https://brzotomas.github.io');
});
