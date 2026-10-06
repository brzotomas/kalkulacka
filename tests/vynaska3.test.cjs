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
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext('('+v3[1]+')'))),{vynCenaZaklad:1080,vynCena10m:90,vynCenaPatro1:550,vynCenaPatroDalsi:350,vynCenaVytah1:320,vynCenaVytahDalsi:125,vynCenaShoz:2900,vynCenaRucniKoef:1.4,vynCenaRhoLehka:1,vynMinKcHod:600});
});

test('kontrolní tabulka A: Kč/t, Kč/m³ hutné i lehké, hodiny na 10 t a Kč/h',()=>{
  const c=kontext(),n=c.S.nastaveni;
  const radky=[ /* situace, patra, výtah, m, ručně, shoz → Kč/t, Kč/m³ hutné, Kč/m³ lehké, h na 10 t, Kč/h */
    ['přízemí, do 10 m',0,false,10,false,false,1080,1404,1080,12.0,903],['přízemí, 20 m',0,false,20,false,false,1170,1521,1170,13.2,883],
    ['přízemí, 30 m',0,false,30,false,false,1260,1638,1260,14.5,867],['přízemí, 50 m',0,false,50,false,false,1440,1872,1440,17.1,842],
    ['1. patro po schodech',1,false,10,false,false,1630,2119,1630,19.7,826],['2. patro po schodech',2,false,10,false,false,1980,2574,1980,24.7,800],
    ['3. patro po schodech',3,false,10,false,false,2330,3029,2330,29.7,783],['4. patro po schodech',4,false,10,false,false,2680,3484,2680,34.7,771],
    ['3. patro s výtahem',3,true,10,false,false,1650,2145,1650,20.0,825],['3. patro se shozem (bez paušálu)',3,false,10,false,true,1080,1404,1080,12.0,903],
    ['5. patro, 30 m, ručně',5,false,30,true,false,4494,5842,4494,59.2,759]];
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
    ['Panelák Severák',[['rez150',7.5],['otvor-zb-4m2-150',1.8],['otvor-zb-1m2-150',.77],['preklad',2.4],['jadroU',1],['sanita',3],['vana',1],['zakryti',25],['uklid',1]],0,true,15,4.628,1170,5415,6.13],
    ['Byt 3+1',[['zakryti',30],['pr100',14],['jadroZ',1],['sanita',3],['vana',1],['kuchyn',4],['dlazba',9],['obklad',22],['dvere',5],['zaruben',5],['uklid',1]],2,false,25,9.006,2160,19453,24.21],
    ['Otvor v cihlové příčce',[['zakryti',12],['otvor-cihla-m2',1.8],['preklad',2.4],['uklid',1]],0,true,8,.486,1080,525,.58]];
  for(const [co,pol,patra,vytah,vzd,tp,kcT,cena,hod] of vzory){
    const prace=pol.map(([id,mnozstvi])=>Object.assign({mnozstvi},polozka(id)));
    const p=c.vynPolozky(prace),x=c.vynCenaJadro(p,patra,vytah,vzd,false,false),h=c.vynHodinyPolozky(p,patra,vytah,vzd,false,false);
    assert.equal(zaokr(x.tp,3),tp,co+' přepočtené t');assert.equal(Math.round(x.kcT),kcT,co+' Kč/t');
    assert.equal(Math.round(x.cena),cena,co+' vynáška');assert.equal(zaokr(h.hodiny,2),hod,co+' hodiny');
  }
  /* byt 3+1 jako B2B a s interní přirážkou 10 % (B2C) — stejné koeficienty jako vynaskaVypocetZaklad */
  const byt=c.vynCenaJadro(c.vynPolozky(vzory[1][1].map(([id,mnozstvi])=>Object.assign({mnozstvi},polozka(id)))),2,false,25,false,false).cena;
  assert.equal(Math.round(byt*.9),17508);assert.equal(Math.round(byt*1.1),21398);
});

test('další kontroly C: lehká suť objemem, po řádcích, ne ze součtu',()=>{
  const c=kontext();
  assert.equal(c.vynCenaJadro([{t:.8,m3:3.2}],0,false,20,false,false).tp,3.2);
  assert.equal(Math.round(c.vynCenaJadro([{t:.8,m3:3.2}],0,false,20,false,false).cena),3744);
  assert.equal(Math.round(c.vynCenaJadro([{t:.8,m3:3.2}],2,false,20,false,false).cena),6624);
  assert.equal(zaokr(c.vynCenaJadro([{t:.8,m3:3.2},{t:3,m3:3/1.3}],0,false,10,false,false).tp,2),6.2);
  assert.equal(Math.round(c.vynCenaJadro([{t:5.5,m3:5.5/1.3}],0,false,15,false,false).cena),6435);
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
  const c=vm.createContext({S:{nastaveni:{vynCena10m:77},zakazky:[{id:'a'},{id:'b',vynModel:1},{id:'c',vynModel:3}],job:{prace:[]}},save(){}});
  vm.runInContext('const VYN_V3 = '+v3[1]+';\n'+vyrizni('vynMigraceV3'),c);
  c.vynMigraceV3();
  assert.deepEqual(c.S.zakazky.map(z=>z.vynModel),[2,1,3]);
  assert.equal(c.S.job.vynModel,3);assert.equal(c.S.nastaveni.vynCenaZaklad,1080);assert.equal(c.S.nastaveni.vynCena10m,77);assert.equal(c.S.vynV3,true);
});
