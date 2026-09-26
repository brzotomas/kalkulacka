'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Bridge=require('../founder/bridge.js'),Adapter=require('../founder/adapter.js'),Engine=require('../founder/engine.js');
function storage(){const original=JSON.stringify({nastaveni:{koefVykon:1},zakazky:[{id:'job-1',nazev:'Original',status:'hotovo',vysCelkem:121000,dph:'21',vysZisk:40000,prace:[{mnozstvi:1,hod:24}],viceprace:[],skutHodiny:24,doplatekCastka:121000,doplatekZaplaceno:'2026-09-10'}]});const values=new Map([[Bridge.SOURCE_KEY,original]]),writes=[];return {original,values,writes,getItem:key=>values.get(key)??null,setItem:(key,value)=>{assert.equal(key,Bridge.OWNER_KEY,'calculator storage must never be written');writes.push(key);values.set(key,value);}};}
test('Founder transactions only write the separate owner namespace and never copy operational records',()=>{
  const s=storage(),b=Bridge.create(s);b.change(d=>{d.cash.bankCash=120000;d.jobFacts['job-1']={completedDate:'2026-09-10',actualDirectCosts:60000};});
  assert.equal(s.getItem(Bridge.SOURCE_KEY),s.original);assert.deepEqual(s.writes,[Bridge.OWNER_KEY]);
  const own=JSON.parse(s.getItem(Bridge.OWNER_KEY)).data;assert.equal(own.zakazky,undefined);assert.equal(own.jobFacts['job-1'].actualDirectCosts,60000);
  assert.equal(b.read().state.zakazky[0].founder.actualDirectCosts,60000);assert.equal(JSON.parse(s.original).zakazky[0].founder,undefined);
});
test('read-only source changes are reflected without altering saved snapshots',()=>{
  const s=storage(),b=Bridge.create(s);b.change(d=>d.snapshots.push({id:'old',state:{revenue:100}}));
  const raw=JSON.parse(s.original);raw.zakazky[0].nazev='Edited in calculator';s.values.set(Bridge.SOURCE_KEY,JSON.stringify(raw));
  assert.equal(b.read().state.zakazky[0].nazev,'Edited in calculator');assert.equal(b.own().snapshots[0].state.revenue,100);
});
test('source backup import is memory-only and never replaces calculator storage',()=>{
  const s=storage(),b=Bridge.create(s);const source=JSON.parse(s.original);source.zakazky[0].nazev='Imported';b.importSource(source);source.zakazky[0].nazev='mutated';
  assert.equal(b.read().state.zakazky[0].nazev,'Imported');assert.equal(s.writes.length,0);assert.equal(s.getItem(Bridge.SOURCE_KEY),s.original);
  b.useShared();assert.equal(b.read().state.zakazky[0].nazev,'Original');
});
test('storage quota failure leaves both source and previous Founder state intact',()=>{
  const s=storage(),b=Bridge.create(s);s.setItem=()=>{throw new Error('QuotaExceeded');};
  assert.throws(()=>b.change(d=>{d.cash.bankCash=123;}),/QuotaExceeded/);assert.equal(b.own().cash.bankCash,null);assert.equal(s.getItem(Bridge.SOURCE_KEY),s.original);
});
test('concurrent tab update cannot overwrite a newer Founder record',()=>{
  const s=storage(),first=Bridge.create(s),second=Bridge.create(s);first.change(d=>d.cash.bankCash=100);
  assert.throws(()=>second.change(d=>d.cash.bankCash=200),/jiná karta/);assert.equal(JSON.parse(s.getItem(Bridge.OWNER_KEY)).data.cash.bankCash,100);
});
test('separate backup restores only Founder data and rejects wrong format',()=>{
  const s=storage(),b=Bridge.create(s);b.change(d=>d.cash.bankCash=100);const backup=b.exportOwn();b.change(d=>d.cash.bankCash=200);b.importOwn(backup);
  assert.equal(b.own().cash.bankCash,100);assert.equal(s.getItem(Bridge.SOURCE_KEY),s.original);assert.throws(()=>b.importOwn(JSON.parse(s.original)),/Founder OS/);
});
test('adapter cash source flows are accepted by forecast and boolean risk remains actionable',()=>{
  const s=storage(),b=Bridge.create(s);b.change(d=>{d.cash={asOf:'2026-09-15',bankCash:500000,taxReserve:0,payrollReserve:0,committedPayables:0,customerAdvanceReserve:0,weeklyBurn:10000,overdueLiabilities:0,unfundedWork:true};});
  const raw=JSON.parse(s.original);raw.zakazky.push({id:'job-2',status:'domluveno',zalohaCastka:10000,zalohaSplatnost:'2026-09-16'});s.values.set(Bridge.SOURCE_KEY,JSON.stringify(raw));
  const input=Adapter.buildInput(b.read().state,{asOf:'2026-09-15',period:'all'}),state=Engine.analyze(input);
  assert.equal(input.cash.unfundedWork,true);assert.equal(state.primary.key,'CASH');assert.equal(Engine.forecast(state.cash,input.cashItems,'2026-09-15').weeks[0].inflows,10000);
});
test('estimated costs remain estimates while actual costs are required for gross margin',()=>{
  const s=storage(),b=Bridge.create(s);b.change(d=>{d.jobFacts['job-1']={completedDate:'2026-09-10'};});
  const first=Adapter.buildInput(b.read().state,{asOf:'2026-09-15',period:'previous'});
  assert.equal(first.metrics.estimatedDirectCosts,60000);assert.equal(first.metrics.directCosts,null);
  b.change(d=>d.jobFacts['job-1'].actualDirectCosts=72000);
  const next=Engine.analyze(Adapter.buildInput(b.read().state,{asOf:'2026-09-15',period:'previous'}));assert.equal(next.metrics.costVariance,.2);assert.equal(next.metrics.averageTicket,100000);
});
test('new planned labor reconstruction matches the existing calculator without loading its UI or mutating it',()=>{
  const source=fs.readFileSync(process.env.FOUNDER_REFERENCE_HTML||path.join(__dirname,'../index.html'),'utf8');
  const start=source.indexOf('function vynJadro('),end=source.indexOf('function vynaskaVypocet(',start);
  const settings={koefVykon:1.3,vynKolecko:65,vynKoleckoM3:.065,vynKbelik:40,vynKbelikM3:.04,vynCyklusSek:240,vynVzdalenostSek:25,vynPatroSek:35,vynVytahKoef:.25,vynRucniKoef:1.35};
  const context=vm.createContext({S:{nastaveni:settings}});vm.runInContext(source.slice(start,end),context);
  for(const floor of [0,3,6])for(const lift of [false,true])for(const manual of [false,true]){
    const job={patro:floor,vytah:lift,vytahNaSut:true,vzdalenost:30,rucniNoseni:manual,prace:[{mnozstvi:4,hod:2,sutT:.2,sutM3:.4}]};
    const actual=Bridge.planJob(job,settings).hod,expected=8*1.3+context.vynJadro(.8,1.6,floor,lift,30,manual).hodiny;
    assert.ok(Math.abs(actual-expected)<1e-8);
  }
});
test('cash freshness, healthy boolean people signal, experiment conditions and average revenue cohort',()=>{
  assert.equal(Engine.evaluateExperiment({result:8,successThreshold:6,comparison:'gte',conditionsMet:true}),'VALIDATED');
  assert.equal(Engine.evaluateExperiment({result:8,successThreshold:6,comparison:'gte',conditionsMet:false}),'INVALIDATED');
  assert.equal(Engine.evaluateExperiment({result:8,successThreshold:6,comparison:'gte'}),'INCONCLUSIVE');
  const state=Engine.analyze({asOf:'2026-09-15',completedPaidJobs:20,metrics:{revenue:100000,completedJobs:2,jobsWon:10,understaffed:true},cash:{asOf:'2026-08-01'}});
  assert.equal(state.metrics.averageTicket,50000);assert.equal(state.metrics.understaffed,1);assert.equal(state.cash.fresh,false);
  assert.equal(Engine.forecast({bankCash:10000,asOf:'2026-09-14'},[],'2026-09-15').weeks[0].committed,null);
});
test('browser scripts compile and require no calculator script',()=>{
  for(const file of ['engine.js','adapter.js','bridge.js','demo.js','cloud-config.js','cloud.js','ui.js'])new vm.Script(fs.readFileSync(path.join(__dirname,'../founder',file),'utf8'));
  const html=fs.readFileSync(path.join(__dirname,'../founder/index.html'),'utf8');assert.ok(!html.includes('src="../index.html"'));
  assert.ok(!fs.readFileSync(path.join(__dirname,'../founder/ui.js'),'utf8').includes('planZak('));
});
test('unavailable source preserves unknown job metrics even when own weekly inputs exist',()=>{
  const state={nastaveni:{},zakazky:[],founderOs:Adapter.defaults()};state.founderOs.weeklyInputs=[{week:'2026-09-07',qualifiedLeads:20,availableHours:80},{week:'2026-09-14',qualifiedLeads:20,availableHours:80}];
  const input=Adapter.buildInput(state,{asOf:'2026-09-15',period:'previous',sourceAvailable:false});
  for(const key of ['revenue','directCosts','soldHours','futureBookedHours','quotesSent','jobsWon','completedJobs'])assert.equal(input.metrics[key],null,key);
  assert.equal(input.metrics.qualifiedLeads,20);assert.equal(input.completedPaidJobs,null);
  assert.equal(Engine.analyze(input).constraints.find(x=>x.key==='CAPACITY').status,'UNKNOWN');
});
test('undated completed jobs make period totals unknown, while all-history totals stay available',()=>{
  const s=storage(),b=Bridge.create(s);const raw=JSON.parse(s.original);raw.zakazky.push({...raw.zakazky[0],id:'job-2'});s.values.set(Bridge.SOURCE_KEY,JSON.stringify(raw));b.change(d=>{d.jobFacts['job-1']={completedDate:'2026-09-10',actualDirectCosts:60000};d.jobFacts['job-2']={actualDirectCosts:60000};});
  const period=Adapter.buildInput(b.read().state,{asOf:'2026-09-15',period:'previous'});assert.equal(period.metrics.revenue,null);assert.equal(period.metrics.directCosts,null);assert.equal(period.metrics.quotesSent,null);assert.equal(period.metrics.jobsWon,null);
  assert.equal(Adapter.buildInput(b.read().state,{asOf:'2026-09-15',period:'all'}).metrics.revenue,200000);
});
test('malformed backup dates and null records are rejected before replacing own storage',()=>{
  const s=storage(),b=Bridge.create(s);const bad=b.exportOwn();bad.data.cash.asOf='not-a-date';assert.throws(()=>b.importOwn(bad),/datum/);assert.equal(s.writes.length,0);
  const another=b.exportOwn();another.data.experiments=[null];assert.throws(()=>b.importOwn(another),/seznam/);assert.equal(s.writes.length,0);
});
