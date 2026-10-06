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
  /* Carrying-out hours exactly like the calculator: vynParam + vynJadro (models 1 and 2, aggregated),
     model 3 per work row like vynHodinyPolozky (+ chute assembly once). Hours only, never prices.
     Defaults for stair overhead, chute assembly and pace factor mirror the calculator's vynParam. */
  function vynParams(settings,model,bezKoef){
    const n=settings,v1=model===1,s=v1&&isObject(n.vynV1)?Object.assign({},n,n.vynV1):n;
    return {kolecko:s.vynKolecko||65,koleckoM3:s.vynKoleckoM3||0.065,cyklus:s.vynCyklusSek||(v1?240:270),
      kbelik:s.vynKbelik||(v1?40:25),kbelikM3:s.vynKbelikM3||0.040,patroSek:s.vynPatroSek||(v1?35:50),
      rezie:v1?0:(n.vynSchodyRezieSek>=0?n.vynSchodyRezieSek:20),
      vzdSek:s.vynVzdalenostSek>=0?s.vynVzdalenostSek:25,vytahKoef:s.vynVytahKoef>=0?s.vynVytahKoef:0.25,
      rucniKoef:s.vynRucniKoef||1,koef:v1||bezKoef?1:(n.vynKoef>0?n.vynKoef:1),
      shozH:n.vynShozH>=0?n.vynShozH:3,model:v1?1:2};
  }
  function vynHours(settings,t,m3,patra,vytahOK,vzdalenost,rucniNoseni,opt){
    const P=vynParams(settings,opt.model,opt.bezKoef);
    t=Math.max(0,t||0);m3=Math.max(0,m3||0);patra=Math.max(0,patra||0);
    const shoz=!!opt.shoz&&patra>0&&P.model===2;
    const koefP=vytahOK&&!shoz?P.vytahKoef:1;
    const vzdNavic=shoz?0:Math.max(0,Math.ceil(((vzdalenost||0)-10)/10));
    const rucni=rucniNoseni?P.rucniKoef:1;
    const cestyKolecko=Math.max(t*1000/P.kolecko,m3/P.koleckoM3);
    const sekKolecko=P.cyklus+vzdNavic*P.vzdSek;
    const cestyKbelik=patra>0&&!shoz?Math.max(t*1000/P.kbelik,m3/P.kbelikM3):0;
    const sekCesta=patra>0?P.rezie+patra*P.patroSek*koefP:0;
    const hodKolecko=cestyKolecko*sekKolecko/3600*rucni*P.koef;
    const hodPatra=cestyKbelik*sekCesta/3600*rucni*P.koef;
    const hodShoz=shoz&&!opt.bezMontaze&&(t>0||m3>0)?P.shozH:0;
    return hodKolecko+hodPatra+hodShoz;
  }
  /* Reconstruct only saved planned labor, never prices. Uses the calculator's
     existing persisted labor parameters; absent base parameters stay unknown. */
  function planJob(job,settings){
    if(Number.isFinite(job.vysHodiny)&&job.vysHodiny>=0)return {hod:Math.max(0,job.vysHodiny-(job.viceprace||[]).filter(x=>x.stav==='odsouhlaseno').reduce((s,x)=>s+(Number.isFinite(x.hod)?x.hod:0),0))};
    if(!Array.isArray(job.prace)||!isObject(settings))return {hod:null};
    let base=0,tonnes=0,volume=0;const rows=[];
    for(const item of job.prace){
      if(!Number.isFinite(item.mnozstvi)||item.mnozstvi<0||!Number.isFinite(item.hod)||item.hod<0)return {hod:null};
      const t=item.mnozstvi*(Number.isFinite(item.sutT)?item.sutT:0),m3=item.mnozstvi*(Number.isFinite(item.sutM3)?item.sutM3:0);
      base+=item.mnozstvi*item.hod;tonnes+=t;volume+=m3;if(t>0||m3>0)rows.push({t,m3});
    }
    if(!(settings.koefVykon>0))return {hod:null};
    if(tonnes===0&&volume===0)return {hod:base*settings.koefVykon};
    const required=['vynKolecko','vynKoleckoM3','vynKbelik','vynKbelikM3','vynCyklusSek','vynVzdalenostSek','vynPatroSek','vynVytahKoef','vynRucniKoef'];
    if(required.some(k=>!Number.isFinite(settings[k])||settings[k]<0)||required.slice(0,4).some(k=>settings[k]===0))return {hod:null};
    const distance=Number.isFinite(job.vzdalenost)?job.vzdalenost:10, floors=Math.max(0,job.patro||0);
    /* same inputs as the calculator's vynaskaVypocet: lift only when rubble may go in it, model 3 per row */
    const lift=!!(job.vytah&&job.vytahNaSut),manual=!!job.rucniNoseni,chute=!!job.shoz;
    let transport;
    if(job.vynModel===3){
      transport=rows.reduce((sum,r)=>sum+vynHours(settings,r.t,r.m3,floors,lift,distance,manual,{model:2,shoz:chute,bezMontaze:true}),0)
        +(chute&&floors>0&&rows.length?(settings.vynShozH>=0?+settings.vynShozH:3):0);
    }else transport=vynHours(settings,tonnes,volume,floors,lift,distance,manual,{model:job.vynModel===1?1:2,shoz:chute});
    return {hod:base*settings.koefVykon+transport};
  }
  function projectSource(value){
    validateSource(value);
    const select=(object,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(object,k)).map(k=>[k,copy(object[k])]));
    const settings=['koefVykon','vynKolecko','vynKoleckoM3','vynKbelik','vynKbelikM3','vynCyklusSek','vynVzdalenostSek','vynPatroSek','vynVytahKoef','vynRucniKoef','vynSchodyRezieSek','vynShozH','vynKoef','vynV1'];
    const fields=['id','nazev','status','dph','vysCelkem','vysZisk','vysNaklady','vysHodiny','skutHodiny','terminOd','terminDo','duvodProhry','zalohaCastka','zalohaZaplaceno','zalohaSplatnost','doplatekCastka','doplatekZaplaceno','doplatekSplatnost','vzdalenost','patro','vytah','vytahNaSut','rucniNoseni','shoz','vynModel'];
    const facts=['leadDate','quoteDate','wonDate','completedDate','actualDirectCosts','actualRevenue','onTimeStart','reworkHours'];
    return {nastaveni:select(value.nastaveni,settings),zakazky:value.zakazky.map(job=>({...select(job,fields),prace:(job.prace||[]).map(x=>select(x,['mnozstvi','hod','sutT','sutM3'])),denniZapis:(job.denniZapis||[]).map(x=>select(x,['datum','lide','hodiny'])),viceprace:(job.viceprace||[]).map(x=>select(x,['stav','hod'])),founder:select(job.founder||{},facts)})),vyklizeni:(value.vyklizeni||[]).map(job=>select(job,['id','status']))};
  }
  return Object.freeze({create,planJob,projectSource,SOURCE_KEY,OWNER_KEY});
});
