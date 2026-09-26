/* Shared Founder storage. API is authoritative; calculator storage is read-only. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./bridge.js'):root.FounderBridge,typeof module==='object'&&module.exports?require('./adapter.js'):root.FounderAdapter);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FounderCloud=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(B,A){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const tokenPattern=/^[a-f0-9]{64}$/i;
  function accessToken(hash,session,key){
    const match=/^#(?:edit|view)=([a-f0-9]{64})$/i.exec(hash||'');
    if(match){try{session?.setItem(key,match[1]);}catch(_){}return match[1];}
    let saved;try{saved=session?.getItem(key);}catch(_){}return tokenPattern.test(saved||'')?saved:null;
  }
  function create(options){
    if(!tokenPattern.test(options.token||''))throw new Error('Chybí platný osobní přístupový odkaz.');
    const url=new URL(options.url);
    if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Sdílené úložiště musí používat HTTPS.');
    const endpoint=url.href.replace(/\/$/,'');
    const request=options.fetch||globalThis.fetch;
    let own=A.defaults(),source=null,role=null,revision=0,sourceRevision=0,savedAt=null,sourceSavedAt=null,viewerToken=null;
    let connected=false,busy=false,pendingDraft=null,attached=false,lastLocal=null,remoteChanged=false,lastError=null,lastChecked=null,mutationEpoch=0,refreshSequence=0;
    const uuid=()=>globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3)|8).toString(16);});
    function localBridge(nextOwn=own,nextSource=source){
      const values=new Map([[B.OWNER_KEY,JSON.stringify({kind:'founder-os',version:1,data:nextOwn})]]);
      if(nextSource)values.set(B.SOURCE_KEY,JSON.stringify(nextSource));
      return B.create({getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)});
    }
    async function api(path,method,body){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await request(endpoint+path,{method,headers:{Authorization:'Bearer '+options.token,'Content-Type':'application/json'},body:JSON.stringify(body||{}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
        let value;try{value=await response.json();}catch(_){throw new Error('Server nevrátil platnou odpověď. Změna není potvrzená.');}
        if(!response.ok){const error=new Error(typeof value.error==='string'?value.error:'Sdílené úložiště není dostupné.');error.status=response.status;throw error;}
        return value;
      }catch(error){lastError=error.name==='AbortError'?'Server neodpověděl včas. Změna není potvrzená.':error.message;throw error;}
      finally{clearTimeout(timer);}
    }
    const requireOwner=()=>{if(role!=='owner'){const error=new Error('Tento přístup je pouze pro čtení.');error.status=403;throw error;}};
    function checkSnapshot(next){
      if(!['owner','viewer'].includes(next.role)||!Number.isSafeInteger(next.revision)||next.revision<0||!Number.isSafeInteger(next.sourceRevision)||next.sourceRevision<0)throw new Error('Neplatný stav sdíleného úložiště.');
      localBridge(next.own||A.defaults(),next.source).read();
    }
    async function refresh({apply=true}={}){
      if(busy)return {changed:false,skipped:true};
      const epoch=mutationEpoch,sequence=++refreshSequence;
      const next=await api('/api/read','POST');checkSnapshot(next);
      if(busy||epoch!==mutationEpoch||sequence!==refreshSequence||next.revision<revision||next.sourceRevision<sourceRevision)return {changed:false,skipped:true};
      apply=typeof apply==='function'?apply():apply;
      const changed=!connected||next.revision!==revision||next.sourceRevision!==sourceRevision;
      role=next.role;viewerToken=role==='owner'&&tokenPattern.test(next.viewerToken||'')?next.viewerToken:null;
      if(apply){own=copy(next.own||A.defaults());source=next.source?copy(next.source):null;revision=next.revision;sourceRevision=next.sourceRevision;savedAt=next.savedAt;sourceSavedAt=next.sourceSavedAt;remoteChanged=false;}
      else remoteChanged=changed;
      connected=true;lastError=null;lastChecked=new Date().toISOString();return {changed,applied:apply};
    }
    async function change(callback){
      requireOwner();if(busy)throw new Error('Počkej na dokončení předchozího uložení.');
      const draft=copy(own);callback(draft);localBridge(draft).read();pendingDraft=copy(draft);busy=true;mutationEpoch++;
      try{const result=await api('/api/state','PUT',{own:draft,expectedRevision:revision,mutationId:uuid()});
        if(!Number.isSafeInteger(result.revision)||result.revision<=revision)throw new Error('Server nepotvrdil novou verzi. Nejdřív obnov data.');
        own=draft;revision=result.revision;savedAt=result.savedAt;pendingDraft=null;lastError=null;remoteChanged=false;return copy(own);
      }catch(error){if(error.status===409)remoteChanged=true;throw error;}finally{busy=false;}
    }
    async function sendSource(value){
      requireOwner();if(busy)throw new Error('Počkej na dokončení předchozího uložení.');
      const projected=B.projectSource(value);localBridge(own,projected).read();busy=true;mutationEpoch++;
      try{const result=await api('/api/source','PUT',{source:projected,expectedRevision:sourceRevision,mutationId:uuid()});
        if(!Number.isSafeInteger(result.revision)||result.revision<=sourceRevision)throw new Error('Server nepotvrdil novou verzi zakázek.');
        source=copy(projected);sourceRevision=result.revision;sourceSavedAt=result.savedAt;lastError=null;return projected;
      }catch(error){if(error.status===409){attached=false;remoteChanged=true;}throw error;}finally{busy=false;}
    }
    async function importSource(value){const result=await sendSource(value);attached=false;lastLocal=null;return result;}
    async function attachCalculator(){
      requireOwner();const raw=options.calculatorStorage?.getItem(B.SOURCE_KEY);
      if(!raw)throw new Error('V tomto prohlížeči nejsou data kalkulačky. Otevři zde nejdřív kalkulačku nebo načti její zálohu.');
      const result=await sendSource(JSON.parse(raw));lastLocal=JSON.stringify(result);attached=true;return result;
    }
    async function syncCalculator(){
      if(!attached||role!=='owner'||busy)return false;
      const raw=options.calculatorStorage?.getItem(B.SOURCE_KEY);
      if(!raw){attached=false;throw new Error('Místní kalkulačka již není dostupná. Automatické připojení se zastavilo.');}
      const projected=B.projectSource(JSON.parse(raw)),serialized=JSON.stringify(projected);
      if(serialized===lastLocal)return false;
      await sendSource(projected);lastLocal=serialized;return true;
    }
    function read(){const result=localBridge().read();return {...result,mode:'cloud',role,cloudConnected:connected,savedAt,sourceDate:sourceSavedAt,sourceSavedAt,revision,sourceRevision,attached,remoteChanged,busy,lastError,lastChecked};}
    return Object.freeze({connect:refresh,refresh,read,change,importSource,attachCalculator,syncCalculator,detachCalculator:()=>{attached=false;lastLocal=null;},
      own:()=>copy(own),exportOwn:()=>({kind:'founder-os',version:1,exportedAt:new Date().toISOString(),data:copy(own)}),
      exportDraft:()=>pendingDraft?{kind:'founder-os',version:1,exportedAt:new Date().toISOString(),data:copy(pendingDraft)}:null,
      importOwn:async value=>{const validated=localBridge();validated.importOwn(value);return change(draft=>{Object.keys(draft).forEach(k=>delete draft[k]);Object.assign(draft,validated.own());});},
      viewerLink:()=>{requireOwner();if(!viewerToken)throw new Error('Sdílecí odkaz zatím není dostupný.');return (options.publicUrl||'https://brzotomas.github.io/kalkulacka/founder/')+'#view='+viewerToken;}
    });
  }
  return Object.freeze({create,accessToken});
});
