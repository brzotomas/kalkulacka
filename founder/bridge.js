/* The calculator is an external, read-only source. Only OWNER_KEY can be written. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./adapter.js'):root.FounderAdapter);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FounderBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Adapter){
  'use strict';
  const SOURCE_KEY='demolice-kalk-v1',OWNER_KEY='demolice-founder-os-v1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  function validateSource(value){
    if(!isObject(value)||!Array.isArray(value.zakazky)||!isObject(value.nastaveni))throw new Error('Soubor není záloha demoliční kalkulačky.');
    const ids=new Set();
    for(const job of value.zakazky){if(!isObject(job)||typeof job.id!=='string'||['__proto__','constructor','prototype'].includes(job.id)||ids.has(job.id))throw new Error('Záloha obsahuje neplatná nebo duplicitní ID zakázek.');ids.add(job.id);}
    return value;
  }
  function validateOwn(value){
    if(!isObject(value)||value.version!==1||!isObject(value.cash)||!isObject(value.settings)||!isObject(value.team))throw new Error('Neplatná záloha Founder OS.');
    for(const key of ['weeklyInputs','forecastItems','decisions','reviews','snapshots','experiments','memory'])if(!Array.isArray(value[key])||value[key].some(item=>!isObject(item)))throw new Error('V záloze Founder OS je neplatný seznam '+key+'.');
    if(value.jobFacts!==undefined&&!isObject(value.jobFacts))throw new Error('Neplatné doplňující údaje zakázek.');
    if(Object.entries(value.jobFacts||{}).some(([key,item])=>['__proto__','constructor','prototype'].includes(key)||!isObject(item)))throw new Error('Neplatná vazba doplňujících údajů zakázky.');
    if(value.cash.asOf && !validDate(value.cash.asOf))throw new Error('Neplatné datum cash snímku.');
    for(const item of value.weeklyInputs)if(!validDate(item.week))throw new Error('Neplatné datum týdenního vstupu.');
    for(const item of value.forecastItems)if(!validDate(item.date)||!Number.isFinite(item.amount)||item.amount<0||!['in','out'].includes(item.direction)||!['committed','expected'].includes(item.layer)||!Number.isFinite(item.probability)||item.probability<0||item.probability>1)throw new Error('Neplatná plánovaná platba.');
    for(const item of Object.values(value.jobFacts||{}))for(const key of ['leadDate','quoteDate','wonDate','completedDate'])if(item[key]&&!validDate(item[key]))throw new Error('Neplatné datum doplnění zakázky.');
    for(const item of value.experiments)if(!validDate(item.startDate)||!validDate(item.endDate)||!Number.isFinite(item.successThreshold)||!['ACTIVE','VALIDATED','INVALIDATED','INCONCLUSIVE'].includes(item.status))throw new Error('Neplatný záznam experimentu.');
    for(const item of value.reviews)if(!isObject(item.plan)||!Array.isArray(item.plan.actions)||!isObject(item.answers))throw new Error('Neplatný záznam review.');
    for(const item of value.decisions)if(!isObject(item.result)||!Array.isArray(item.result.reasons))throw new Error('Neplatný záznam rozhodnutí.');
    return value;
  }
  function create(storage){
    let imported=null,mode='shared',lastSaved=storage.getItem(OWNER_KEY),own;
    if(lastSaved){const envelope=JSON.parse(lastSaved);if(envelope.kind!=='founder-os')throw new Error('Neznámý formát úložiště Founder OS.');own=validateOwn(envelope.data);}
    else own=Adapter.defaults();
    if(!own.jobFacts)own.jobFacts={};
    function read(){
      const raw=mode==='shared'?storage.getItem(SOURCE_KEY):null;
      const source=mode==='shared'?(raw?validateSource(JSON.parse(raw)):null):imported;
      const state={nastaveni:copy(source?.nastaveni||{}),vyklizeni:copy(source?.vyklizeni||[]),zakazky:(source?.zakazky||[]).map(job=>({...copy(job),founder:{...(job.founder||{}),...(own.jobFacts[job.id]||{})}})),founderOs:own};
      return {state,connected:!!source,mode,jobCount:state.zakazky.length,sourceDate:source?._datum||null};
    }
    function change(callback){
      const current=storage.getItem(OWNER_KEY);
      if(current!==lastSaved)throw new Error('Founder OS změnila jiná karta. Obnov stránku před další úpravou.');
      const draft=copy(own);callback(draft);validateOwn(draft);
      const serialized=JSON.stringify({kind:'founder-os',version:1,savedAt:new Date().toISOString(),data:draft});
      // No function in this bridge writes, deletes or clears SOURCE_KEY.
      storage.setItem(OWNER_KEY,serialized);lastSaved=serialized;own=draft;return own;
    }
    return Object.freeze({
      read,change,own:()=>copy(own),
      importSource:value=>{imported=copy(validateSource(value));mode='import';return read();},
      useShared:()=>{mode='shared';imported=null;return read();},
      exportOwn:()=>({kind:'founder-os',version:1,exportedAt:new Date().toISOString(),data:copy(own)}),
      importOwn:value=>{if(!isObject(value)||value.kind!=='founder-os')throw new Error('Vyber zálohu Founder OS, nikoli kalkulačky.');const next=copy(validateOwn(value.data));return change(draft=>{Object.keys(draft).forEach(k=>delete draft[k]);Object.assign(draft,next);if(!draft.jobFacts)draft.jobFacts={};});}
    });
  }
  /* Reconstruct only saved planned labor, never prices. Uses the calculator's
     existing persisted labor parameters; absent parameters stay unknown. */
  function planJob(job,settings){
    if(Number.isFinite(job.vysHodiny)&&job.vysHodiny>=0)return {hod:Math.max(0,job.vysHodiny-(job.viceprace||[]).filter(x=>x.stav==='odsouhlaseno').reduce((s,x)=>s+(Number.isFinite(x.hod)?x.hod:0),0))};
    if(!Array.isArray(job.prace)||!isObject(settings))return {hod:null};
    let base=0,tonnes=0,volume=0;
    for(const item of job.prace){
      if(!Number.isFinite(item.mnozstvi)||item.mnozstvi<0||!Number.isFinite(item.hod)||item.hod<0)return {hod:null};
      base+=item.mnozstvi*item.hod;tonnes+=item.mnozstvi*(Number.isFinite(item.sutT)?item.sutT:0);volume+=item.mnozstvi*(Number.isFinite(item.sutM3)?item.sutM3:0);
    }
    if(!(settings.koefVykon>0))return {hod:null};
    if(tonnes===0&&volume===0)return {hod:base*settings.koefVykon};
    const required=['vynKolecko','vynKoleckoM3','vynKbelik','vynKbelikM3','vynCyklusSek','vynVzdalenostSek','vynPatroSek','vynVytahKoef','vynRucniKoef'];
    if(required.some(k=>!Number.isFinite(settings[k])||settings[k]<0)||required.slice(0,4).some(k=>settings[k]===0))return {hod:null};
    const distance=Number.isFinite(job.vzdalenost)?job.vzdalenost:10, floors=Math.max(0,job.patro||0);
    const wheelTrips=Math.max(tonnes*1000/settings.vynKolecko,volume/settings.vynKoleckoM3);
    const bucketTrips=floors>0?Math.max(tonnes*1000/settings.vynKbelik,volume/settings.vynKbelikM3):0;
    const horizontalSeconds=settings.vynCyklusSek+Math.max(0,Math.ceil((distance-10)/10))*settings.vynVzdalenostSek;
    const verticalSeconds=floors*settings.vynPatroSek*(job.vytah&&job.vytahNaSut!==false?settings.vynVytahKoef:1);
    const transport=(wheelTrips*horizontalSeconds+bucketTrips*verticalSeconds)/3600*(job.rucniNoseni?settings.vynRucniKoef:1);
    return {hod:base*settings.koefVykon+transport};
  }
  function projectSource(value){
    validateSource(value);
    const select=(object,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(object,k)).map(k=>[k,copy(object[k])]));
    const settings=['koefVykon','vynKolecko','vynKoleckoM3','vynKbelik','vynKbelikM3','vynCyklusSek','vynVzdalenostSek','vynPatroSek','vynVytahKoef','vynRucniKoef'];
    const fields=['id','nazev','status','dph','vysCelkem','vysZisk','vysNaklady','vysHodiny','skutHodiny','terminOd','terminDo','duvodProhry','zalohaCastka','zalohaZaplaceno','zalohaSplatnost','doplatekCastka','doplatekZaplaceno','doplatekSplatnost','vzdalenost','patro','vytah','vytahNaSut','rucniNoseni'];
    const facts=['leadDate','quoteDate','wonDate','completedDate','actualDirectCosts','actualRevenue','onTimeStart','reworkHours'];
    return {nastaveni:select(value.nastaveni,settings),zakazky:value.zakazky.map(job=>({...select(job,fields),prace:(job.prace||[]).map(x=>select(x,['mnozstvi','hod','sutT','sutM3'])),denniZapis:(job.denniZapis||[]).map(x=>select(x,['datum','lide','hodiny'])),viceprace:(job.viceprace||[]).map(x=>select(x,['stav','hod'])),founder:select(job.founder||{},facts)})),vyklizeni:(value.vyklizeni||[]).map(job=>select(job,['id','status']))};
  }
  return Object.freeze({create,planJob,projectSource,SOURCE_KEY,OWNER_KEY});
});
