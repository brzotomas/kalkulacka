'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Cloud=require('../founder/cloud.js'),Bridge=require('../founder/bridge.js'),Adapter=require('../founder/adapter.js');
const owner='a'.repeat(64),viewer='b'.repeat(64);
function server(){let own=null,source=null,revision=0,sourceRevision=0,fail=false;const calls=[];return {calls,setFail:v=>fail=v,fetch:async(url,options)=>{calls.push({url,method:options.method});if(fail)throw Error('offline');const role=options.headers.Authorization==='Bearer '+owner?'owner':'viewer',body=JSON.parse(options.body);let status=200,result;
  if(url.endsWith('/api/read'))result={role,own,source,revision,sourceRevision,savedAt:null,sourceSavedAt:null,...(role==='owner'?{viewerToken:viewer}:{})};
  else if(role!=='owner'){status=403;result={error:'readonly'};}
  else if(url.endsWith('/api/state')){if(body.expectedRevision!==revision){status=409;result={error:'conflict'};}else{own=body.own;result={revision:++revision,savedAt:new Date().toISOString()};}}
  else {if(body.expectedRevision!==sourceRevision){status=409;result={error:'conflict'};}else{source=body.source;result={revision:++sourceRevision,savedAt:new Date().toISOString()};}}
  return {ok:status===200,status,json:async()=>structuredClone(result)};
}};}
const connect=async(s,token=owner,extra={})=>{const c=Cloud.create({url:'https://data.example',token,fetch:s.fetch,...extra});await c.connect();return c;};
test('two clients see the same saved state and reads use POST outside calculator cache',async()=>{const s=server(),a=await connect(s),b=await connect(s,viewer);await a.change(d=>d.cash.bankCash=500);await b.refresh();assert.equal(b.own().cash.bankCash,500);assert.ok(s.calls.filter(x=>x.url.endsWith('/api/read')).every(x=>x.method==='POST'));await assert.rejects(b.change(d=>d.cash.bankCash=0),/čtení/);});
test('a failed write preserves confirmed state and exposes a backup of the unsaved draft',async()=>{const s=server(),a=await connect(s);s.setFail(true);await assert.rejects(a.change(d=>d.cash.bankCash=500),/offline/);assert.equal(a.own().cash.bankCash,null);assert.equal(a.exportDraft().data.cash.bankCash,500);});
test('stale writer cannot replace newer state',async()=>{const s=server(),a=await connect(s),b=await connect(s);await a.change(d=>d.cash.bankCash=500);await assert.rejects(b.change(d=>d.cash.bankCash=200),e=>e.status===409);assert.equal(b.exportDraft().data.cash.bankCash,200);await b.refresh();assert.equal(b.own().cash.bankCash,500);});
test('calculator projection removes contacts, photos, source sessions and unrelated settings',()=>{const p=Bridge.projectSource({nastaveni:{koefVykon:1,firma:'sensitive'},zakazky:[{id:'1',nazev:'Test',status:'nabídka',telefon:'sensitive',fotky:['sensitive'],prace:[{mnozstvi:1,hod:2,fotka:'sensitive'}]}],vyklizeni:[{id:'v1',email:'sensitive'}],access:'sensitive'});assert.ok(!JSON.stringify(p).includes('sensitive'));assert.equal(p.zakazky[0].prace[0].hod,2);assert.equal(p.vyklizeni.length,1);});
test('attaching and polling calculator never writes its storage; source import detaches it',async()=>{const s=server();let source={nastaveni:{koefVykon:1},zakazky:[]};const calculatorStorage={getItem:key=>{assert.equal(key,Bridge.SOURCE_KEY);return JSON.stringify(source);},setItem:()=>assert.fail('must never write calculator')};const a=await connect(s,owner,{calculatorStorage});await a.attachCalculator();source.zakazky.push({id:'1',status:'nabídka'});assert.equal(await a.syncCalculator(),true);const b=await connect(s,viewer);assert.equal(b.read().state.zakazky.length,1);await a.importSource({nastaveni:{},zakazky:[]});assert.equal(a.read().attached,false);});
test('unmapped clearing jobs cannot silently become complete company totals',()=>{const b=Bridge.create({getItem:key=>key===Bridge.SOURCE_KEY?JSON.stringify({nastaveni:{},zakazky:[],vyklizeni:[{id:'v1'}]}):null,setItem:()=>{}});const result=Adapter.buildInput(b.read().state,{asOf:'2026-09-21',period:'previous'});assert.equal(result.completedPaidJobs,null);assert.equal(result.metrics.revenue,null);assert.match(result.dataIssues.join(' '),/vyklízení/);});

test('a delayed read cannot roll back a write completed while it was in flight',async()=>{
  const s=server();let hold=false,release;
  const a=await connect(s,owner,{fetch:async(...args)=>{const response=await s.fetch(...args);if(hold&&args[0].endsWith('/api/read'))await new Promise(resolve=>release=resolve);return response;}});
  hold=true;const reading=a.refresh();await new Promise(resolve=>setImmediate(resolve));
  await a.change(d=>d.cash.bankCash=500);release();assert.equal((await reading).skipped,true);assert.equal(a.own().cash.bankCash,500);
});

test('form protection is checked when a delayed response arrives',async()=>{
  const s=server(),a=await connect(s);let dirty=false,release;
  const b=await connect(s,owner,{fetch:async(...args)=>{const response=await s.fetch(...args);if(release!==undefined)await new Promise(resolve=>release=resolve);return response;}});
  await a.change(d=>d.cash.bankCash=500);release=null;const reading=b.refresh({apply:()=>!dirty});await new Promise(resolve=>setImmediate(resolve));dirty=true;release();
  assert.equal((await reading).applied,false);assert.equal(b.own().cash.bankCash,null);assert.equal(b.read().remoteChanged,true);
});
