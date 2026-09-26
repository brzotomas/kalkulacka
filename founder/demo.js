/* Development fixtures only. No browser storage is read or written. */
(function(root){
  'use strict';
  function createStorage(){
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());
    const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
    const day=new Date(today+'T12:00:00Z').getUTCDay();
    const monday=shift(today,-(day===0?6:day-1)),previous=shift(monday,-7);
    const source={nastaveni:{koefVykon:1},zakazky:[]};
    const own=root.FounderAdapter.defaults();own.settings=root.FounderEngine.defaults();
    own.cash={asOf:today,bankCash:450000,taxReserve:30000,payrollReserve:30000,committedPayables:30000,customerAdvanceReserve:10000,weeklyBurn:20000,overdueLiabilities:0,unfundedWork:false};
    own.weeklyInputs=[previous,monday].map(week=>({week,qualifiedLeads:8,availableHours:120,founderHours:40,founderDelegatableHours:8,understaffed:false}));
    const labels=['Vyklizení bytu · ukázka','Bourání jádra · ukázka','Odstranění podlah · ukázka','Strip-out · ukázka','Garáž · ukázka','Sklep · ukázka','Příčky · ukázka','Kancelář · ukázka'];
    labels.forEach((label,i)=>{
      const job={id:'demo-'+i,nazev:label,status:i<3?'hotovo':i===3?'domluveno':i<6?'zamítnuto':'nabídka',dph:'ne',vysCelkem:40000,vysZisk:16000,zdroj:'Ukázková poptávka',prace:[{mnozstvi:1,hod:i===3?32:16,sutT:0,sutM3:0}],viceprace:[],terminOd:i===3?shift(monday,2):previous,terminDo:i===3?shift(monday,3):shift(previous,4),skutHodiny:i<3?24:0,zalohaCastka:i===3?12000:0,zalohaSplatnost:today,zalohaZaplaceno:'',doplatekCastka:i<3?40000:i===3?28000:0,doplatekSplatnost:i===3?shift(today,14):shift(previous,4),doplatekZaplaceno:i<3?shift(previous,4):'',duvodProhry:i===4?'Drahé':i===5?'Nereagoval':''};
      source.zakazky.push(job);own.jobFacts[job.id]={leadDate:previous,quoteDate:previous,wonDate:i<4?shift(previous,1):'',completedDate:i<3?shift(previous,4):'',actualDirectCosts:i<3?24000:null,actualRevenue:i<3?40000:null,onTimeStart:i<3?true:null,reworkHours:i<3?0:null};
    });
    const memory=new Map([[root.FounderBridge.SOURCE_KEY,JSON.stringify(source)],[root.FounderBridge.OWNER_KEY,JSON.stringify({kind:'founder-os',version:1,data:own})]]);
    return {getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  }
  root.FounderDemo={createStorage};
})(globalThis);
