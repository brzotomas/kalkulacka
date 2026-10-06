'use strict';
/* Vynáška v3 (dk-v72): cena podle přepočtených tun po řádcích, čas jen pro plán a zisk na hodinu.
   Funkce se vykrojí přímo z index.html a spustí v izolovaném kontextu — bez UI a bez úložiště. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.FOUNDER_REFERENCE_HTML||path.join(__dirname,'../index.html'),'utf8');

/* celé tělo funkce podle párování složených závorek (řetězce a komentáře se přeskakují) */
function vyrizni(nazev){
  const i=source.indexOf('function '+nazev+'(');assert.ok(i>=0,'v index.html chybí funkce '+nazev);
  let d=0,q=null;
  for(let j=source.indexOf('{',i);j<source.length;j++){
    const c=source[j];
    if(q){if(c==='\\'){j++;continue}if(c===q)q=null;continue}
    if(c==='"'||c==="'"||c==='`'){q=c;continue}
    if(c==='/'&&source[j+1]==='*'){j=source.indexOf('*/',j+2)+1;continue}
    if(c==='/'&&source[j+1]==='/'){j=source.indexOf('\n',j);continue}
    if(c==='{')d++;else if(c==='}'&&--d===0)return source.slice(i,j+1);
  }
  throw new Error('neukončená funkce '+nazev);
}
const v3=source.match(/const VYN_V3 = (\{[^}]*\});/);assert.ok(v3,'v index.html chybí VYN_V3');
/* časová nastavení ze zadání (stav k 5. 10. 2026) + výchozí ceník vynášky */
const CASY={vynKolecko:65,vynKoleckoM3:.065,vynCyklusSek:280,vynVzdalenostSek:30,vynKbelik:25,vynKbelikM3:.03,vynPatroSek:45,vynSchodyRezieSek:25,vynVytahKoef:.35,vynShozH:4,vynRucniKoef:1.4,vynKoef:1};
function kontext(upravy){
  const n=Object.assign({},CASY,vm.runInNewContext('('+v3[1]+')'),upravy||{});
  const ctx=vm.createContext({S:{nastaveni:n}});
  vm.runInContext(['vynParam','vynJadro','vynPolozky','vynCenaJadro','vynHodinyPolozky'].map(vyrizni).join('\n'),ctx);
  return ctx;
}
/* výchozí ceník položek z index.html (tuny a m³ suti na MJ) */
function polozka(id){
  const m=source.match(new RegExp('\\{id:"'+id+'",[^}]*?sutT:([\\d.]+),sutM3:([\\d.]+)'));assert.ok(m,'v ceníku chybí položka '+id);
  return {sutT:+m[1],sutM3:+m[2]};
}
const zaokr=(x,d)=>Math.round(x*10**d)/10**d;

test('výchozí ceník vynášky odpovídá zadání',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext('('+v3[1]+')'))),{vynCenaZaklad:1140,vynCena10m:90,vynCenaPatro1:550,vynCenaPatroDalsi:350,vynCenaVytah1:320,vynCenaVytahDalsi:125,vynCenaShoz:2900,vynCenaRucniKoef:1.4,vynCenaRhoLehka:1,vynMinKcHod:600});
});

test('kontrolní tabulka A: Kč/t, Kč/m³ hutné i lehké, hodiny na 10 t a Kč/h',()=>{
  const c=kontext(),n=c.S.nastaveni;
  const radky=[ /* situace, patra, výtah, m, ručně, shoz → Kč/t, Kč/m³ hutné, Kč/m³ lehké, h na 10 t, Kč/h */
    ['přízemí, do 10 m',0,false,10,false,false,1140,1482,1140,12.0,953],['přízemí, 20 m',0,false,20,false,false,1230,1599,1230,13.2,928],
    ['přízemí, 30 m',0,false,30,false,false,1320,1716,1320,14.5,908],['přízemí, 50 m',0,false,50,false,false,1500,1950,1500,17.1,878],
    ['1. patro po schodech',1,false,10,false,false,1690,2197,1690,19.7,856],['2. patro po schodech',2,false,10,false,false,2040,2652,2040,24.7,824],
    ['3. patro po schodech',3,false,10,false,false,2390,3107,2390,29.7,804],['4. patro po schodech',4,false,10,false,false,2740,3562,2740,34.7,789],
    ['3. patro s výtahem',3,true,10,false,false,1710,2223,1710,20.0,855],['3. patro se shozem (bez paušálu)',3,false,10,false,true,1140,1482,1140,12.0,953],
    ['5. patro, 30 m, ručně',5,false,30,true,false,4578,5951,4578,59.2,773]];
  for(const [co,p,v,d,r,sh,kcT,kcM3,kcL,h10,kcH] of radky){
    const a=c.vynCenaJadro([{t:1,m3:1/1.3}],p,v,d,r,sh),l=c.vynCenaJadro([{t:.25,m3:1}],p,v,d,r,sh);
    const hod=c.vynHodinyPolozky([{t:10,m3:10/1.3}],p,v,d,r,sh).hodiny-(sh?n.vynShozH:0);
    assert.equal(Math.round(a.cena-a.pausal),kcT,co+' Kč/t');
    assert.equal(Math.round((a.cena-a.pausal)*1.3),kcM3,co+' Kč/m³ hutné');
    assert.equal(Math.round(l.cena-l.pausal),kcL,co+' Kč/m³ lehké');
    assert.equal(zaokr(hod,1),h10,co+' h na 10 t');
    assert.equal(Math.round((a.cena-a.pausal)*10/hod),kcH,co+' Kč/h');
  }
});

test('vzorové zakázky B z 06-PRIKLADY: přepočtené tuny, Kč/t, vynáška a hodiny po řádcích',()=>{
  const c=kontext();
  const vzory=[
    ['Panelák Severák',[['rez150',7.5],['otvor-zb-4m2-150',1.8],['otvor-zb-1m2-150',.77],['preklad',2.4],['jadroU',1],['sanita',3],['vana',1],['zakryti',25],['uklid',1]],0,true,15,4.628,1230,5693,6.13],
    ['Byt 3+1',[['zakryti',30],['pr100',14],['jadroZ',1],['sanita',3],['vana',1],['kuchyn',4],['dlazba',9],['obklad',22],['dvere',5],['zaruben',5],['uklid',1]],2,false,25,9.006,2220,19993,24.21],
    ['Otvor v cihlové příčce',[['zakryti',12],['otvor-cihla-m2',1.8],['preklad',2.4],['uklid',1]],0,true,8,.486,1140,554,.58]];
  for(const [co,pol,patra,vytah,vzd,tp,kcT,cena,hod] of vzory){
    const prace=pol.map(([id,mnozstvi])=>Object.assign({mnozstvi},polozka(id)));
    const p=c.vynPolozky(prace),x=c.vynCenaJadro(p,patra,vytah,vzd,false,false),h=c.vynHodinyPolozky(p,patra,vytah,vzd,false,false);
    assert.equal(zaokr(x.tp,3),tp,co+' přepočtené t');assert.equal(Math.round(x.kcT),kcT,co+' Kč/t');
    assert.equal(Math.round(x.cena),cena,co+' vynáška');assert.equal(zaokr(h.hodiny,2),hod,co+' hodiny');
  }
  /* byt 3+1 jako B2B a s interní přirážkou 10 % (B2C) — stejné koeficienty jako vynaskaVypocetZaklad */
  const byt=c.vynCenaJadro(c.vynPolozky(vzory[1][1].map(([id,mnozstvi])=>Object.assign({mnozstvi},polozka(id)))),2,false,25,false,false).cena;
  assert.equal(Math.round(byt*.9),17994);assert.equal(Math.round(byt*1.1),21993);
});

test('další kontroly C: lehká suť objemem, po řádcích, ne ze součtu',()=>{
  const c=kontext();
  assert.equal(c.vynCenaJadro([{t:.8,m3:3.2}],0,false,20,false,false).tp,3.2);
  assert.equal(Math.round(c.vynCenaJadro([{t:.8,m3:3.2}],0,false,20,false,false).cena),3936);
  assert.equal(Math.round(c.vynCenaJadro([{t:.8,m3:3.2}],2,false,20,false,false).cena),6816);
  assert.equal(zaokr(c.vynCenaJadro([{t:.8,m3:3.2},{t:3,m3:3/1.3}],0,false,10,false,false).tp,2),6.2);
  assert.equal(Math.round(c.vynCenaJadro([{t:5.5,m3:5.5/1.3}],0,false,15,false,false).cena),6765);
  assert.equal(zaokr(c.vynHodinyPolozky([{t:5.5,m3:5.5/1.3}],0,false,15,false,false).hodiny,2),7.29);
  /* řádky bez suti se přeskakují */
  assert.equal(c.vynPolozky([{mnozstvi:3,sutT:0,sutM3:0},{mnozstvi:2,sutT:.1,sutM3:.2}]).length,1);
});

test('cena modelu 3 nezávisí na čase ani na koeficientu tempa, hodiny ano',()=>{
  const pol=[{t:3,m3:2.4},{t:.8,m3:3.2}],cena=c=>c.vynCenaJadro(pol,2,false,25,false,false).cena,hod=c=>c.vynHodinyPolozky(pol,2,false,25,false,false).hodiny;
  const a=kontext(),b=kontext({vynCyklusSek:180}),k=kontext({vynKoef:1.3});
  assert.equal(cena(b),cena(a));assert.equal(cena(k),cena(a));
  assert.ok(hod(b)<hod(a));assert.ok(Math.abs(hod(k)-hod(a)*1.3)<1e-9);
  /* kalibrace počítá bez koeficientu */
  assert.equal(k.vynHodinyPolozky(pol,2,false,25,false,false,true).hodiny,hod(a));
});

test('stará zakázka (model 2): vynJadro i agregovaný výpočet beze změny — byt 3+1 za 715 Kč/h',()=>{
  const c=kontext({vynSazba:715});
  const prace=[['zakryti',30],['pr100',14],['jadroZ',1],['sanita',3],['vana',1],['kuchyn',4],['dlazba',9],['obklad',22],['dvere',5],['zaruben',5],['uklid',1]].map(([id,mnozstvi])=>Object.assign({mnozstvi},polozka(id)));
  const t=prace.reduce((a,r)=>a+r.mnozstvi*r.sutT,0),m3=prace.reduce((a,r)=>a+r.mnozstvi*r.sutM3,0);
  const y=c.vynJadro(t,m3,2,false,25,false,{model:2});
  assert.equal(zaokr(y.hodiny,2),21.26);assert.equal(Math.round(y.hodiny*715),15202);
  /* signatura vynJadro zůstává */
  assert.match(vyrizni('vynJadro'),/^function vynJadro\(t, m3, patra, vytahOK, vzdalenost, rucniNoseni, opt\)/);
});

test('nová zakázka má model 3, výpočet ho rozlišuje a migrace nechá starým zakázkám model 2',()=>{
  assert.match(vyrizni('defJob'),/vynModel:3/);
  assert.match(vyrizni('vynaskaVypocetZaklad'),/J\.vynModel===3/);
  const c=migrace({nastaveni:{vynCena10m:77},zakazky:[{id:'a'},{id:'b',vynModel:1},{id:'c',vynModel:3}],job:{prace:[]},cenik:[]});
  assert.deepEqual(c.S.zakazky.map(z=>z.vynModel),[2,1,3]);
  assert.equal(c.S.job.vynModel,3);assert.equal(c.S.nastaveni.vynCenaZaklad,1140);assert.equal(c.S.nastaveni.vynCena10m,77);assert.equal(c.S.vynV3,true);
  assert.deepEqual(c.S.cenik.map(i=>i.id),['sut-shrnuti']);
});

/* migrace v kontextu bez UI: VYN_V3, nová položka ceníku a vynMigraceV3 přímo z index.html */
function migrace(S){
  const polozkaZdroj=source.match(/const VYN_SUT_SHRNUTI = (\{[^}]*\});/);assert.ok(polozkaZdroj,'v index.html chybí VYN_SUT_SHRNUTI');
  const c=vm.createContext({S,save(){c.ulozeno=(c.ulozeno||0)+1;}});
  vm.runInContext('const VYN_V3 = '+v3[1]+';\nconst VYN_SUT_SHRNUTI = '+polozkaZdroj[1]+';\n'+vyrizni('vynMigraceV3'),c);
  c.vynMigraceV3();return c;
}

test('základ 1 140 Kč/t: výchozí 1 080 se jednorázově přepíše, ručně zadaná hodnota zůstane',()=>{
  /* zařízení, které už prošlo migrací v3 s výchozími 1 080 Kč/t */
  const a=migrace({vynV3:true,nastaveni:Object.assign(vm.runInNewContext('('+v3[1]+')'),{vynCenaZaklad:1080}),zakazky:[],cenik:[]});
  assert.equal(a.S.nastaveni.vynCenaZaklad,1140);assert.equal(a.S.vynV3b,true);
  const b=migrace({vynV3:true,nastaveni:{vynCenaZaklad:1100},zakazky:[],cenik:[]});
  assert.equal(b.S.nastaveni.vynCenaZaklad,1100);
  /* podruhé už nic nemění: smazanou položku nevrací, 1 080 zadané po migraci nechá */
  const d=migrace({vynV3:true,vynV3b:true,cenikSutShrnuti:true,nastaveni:{vynCenaZaklad:1080},zakazky:[],cenik:[]});
  assert.equal(d.S.nastaveni.vynCenaZaklad,1080);assert.equal(d.S.cenik.length,0);assert.equal(d.ulozeno,undefined);
  /* uložené zakázky drží cenu ve snímku — migrace jejich snímky nemění */
  const snimek={nastaveni:{vynCenaZaklad:1080}},e=migrace({vynV3:true,nastaveni:{vynCenaZaklad:1080},zakazky:[{id:'s',vynModel:3,snimek}],cenik:[]});
  assert.equal(e.S.zakazky[0].snimek.nastaveni.vynCenaZaklad,1080);
});

test('položka sut-shrnuti: ve výchozím ceníku, jednou v uloženém, čistá suť, vynáška ze suti',()=>{
  const m=source.match(/\{id:"sut-shrnuti",kat:KAT\[11\],nazev:"Shrnutí a naložení stávající rozházené suti \(bez bourání\)",mj:"m³",b2c:429,b2b:386,sutT:1\.3,sutM3:1\.0,hod:0\.6,hvezd:5,kod:"—"\}/);
  assert.ok(m,'položka ve výchozím ceníku (defCenik) chybí nebo má jiné hodnoty');
  assert.match(source,/const KAT = \[[^\]]*"Ostatní práce"\]/);
  /* do uloženého ceníku jen když chybí */
  const mam=migrace({vynV3:true,vynV3b:true,nastaveni:{},zakazky:[],cenik:[{id:'sut-shrnuti',b2c:500}]});
  assert.equal(mam.S.cenik.length,1);assert.equal(mam.S.cenik[0].b2c,500);
  /* odpadDruhAuto ji zařadí jako čistou suť */
  const druh=vm.createContext({});vm.runInContext(vyrizni('bezDiakritiky')+'\n'+vyrizni('odpadDruhAuto'),druh);
  assert.equal(druh.odpadDruhAuto({nazev:'Shrnutí a naložení stávající rozházené suti (bez bourání)'}),'cista');
  /* 3,846 m³ (= 5 t), přízemí 15 m: práce 1 650 Kč bez rezervy + vynáška 6 150 Kč */
  const c=kontext(),pol=c.vynPolozky([{mnozstvi:3.846,sutT:1.3,sutM3:1.0}]);
  assert.equal(Math.round(3.846*429),1650);
  assert.equal(Math.round(c.vynCenaJadro(pol,0,false,15,false,false).cena),6150);
  assert.equal(zaokr(pol[0].t,3),5);
});
