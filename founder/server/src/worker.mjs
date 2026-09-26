/* Founder OS: isolated shared storage. Never reads or writes calculator databases. */
const LIMIT=900000;
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=200&&!['__proto__','prototype','constructor'].includes(x);
function validateOwn(x){
  if(!object(x)||x.version!==1||!object(x.cash)||!object(x.settings)||!object(x.team))return false;
  for(const k of ['weeklyInputs','forecastItems','decisions','reviews','snapshots','experiments','memory'])if(!Array.isArray(x[k])||x[k].some(y=>!object(y)))return false;
  if(x.jobFacts!==undefined&&(!object(x.jobFacts)||Object.entries(x.jobFacts).some(([k,v])=>!safeId(k)||!object(v))))return false;
  if(x.cash.asOf&&!validDate(x.cash.asOf))return false;
  if(x.weeklyInputs.some(y=>!validDate(y.week)))return false;
  if(x.forecastItems.some(y=>!validDate(y.date)||!Number.isFinite(y.amount)||y.amount<0||!['in','out'].includes(y.direction)||!['committed','expected'].includes(y.layer)||!Number.isFinite(y.probability)||y.probability<0||y.probability>1))return false;
  for(const y of Object.values(x.jobFacts||{}))for(const k of ['leadDate','quoteDate','wonDate','completedDate'])if(y[k]&&!validDate(y[k]))return false;
  if(x.experiments.some(y=>!validDate(y.startDate)||!validDate(y.endDate)||!Number.isFinite(y.successThreshold)||!['ACTIVE','VALIDATED','INVALIDATED','INCONCLUSIVE'].includes(y.status)))return false;
  if(x.reviews.some(y=>!object(y.plan)||!Array.isArray(y.plan.actions)||!Array.isArray(y.plan.avoid)||!object(y.answers)))return false;
  if(x.decisions.some(y=>!object(y.result)||!Array.isArray(y.result.reasons)))return false;
  return true;
}
function validateSource(x){
  if(!object(x)||!object(x.nastaveni)||!Array.isArray(x.zakazky))return false;
  const ids=new Set();
  for(const y of x.zakazky){if(!object(y)||!safeId(y.id)||ids.has(y.id))return false;ids.add(y.id);}
  return x.vyklizeni===undefined||Array.isArray(x.vyklizeni);
}
const bytesToHex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async text=>bytesToHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
function same(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let mismatch=0;for(let i=0;i<64;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
function headers(origin){const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Vary':'Origin'};if(origin)h['Access-Control-Allow-Origin']=origin;return h;}
const json=(value,status,origin)=>new Response(JSON.stringify(value),{status,headers:headers(origin)});
async function body(request){
  if(Number(request.headers.get('content-length'))>LIMIT)throw Object.assign(new Error('Záznam je příliš velký. Exportuj zálohu a zkrať historii.'),{status:413});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('Chybí údaje k uložení.'),{status:400});
  let length=0;const parts=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT){await reader.cancel();throw Object.assign(new Error('Záznam je příliš velký. Exportuj zálohu a zkrať historii.'),{status:413});}parts.push(value);}
  const data=new Uint8Array(length);let offset=0;for(const p of parts){data.set(p,offset);offset+=p.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{throw Object.assign(new Error('Neplatný formát dat.'),{status:400});}
}
async function readDocument(db,id){return db.prepare('SELECT payload, revision, updated_at, mutation_id FROM founder_documents WHERE id = ?').bind(id).first();}
async function saveDocument(db,id,value,expected,mutationId){
  const payload=JSON.stringify(value),prior=await readDocument(db,id);
  if(prior?.mutation_id===mutationId){if(prior.payload!==payload)throw Object.assign(new Error('Uložení se stejným označením má jiný obsah.'),{status:409});return {revision:prior.revision,savedAt:prior.updated_at};}
  if((prior?.revision||0)!==expected)throw Object.assign(new Error('Data mezitím změnilo jiné zařízení. Nejdřív načti aktuální verzi; tvůj návrh zůstal k zálohování.'),{status:409});
  const savedAt=new Date().toISOString();
  const row=await db.prepare('INSERT INTO founder_documents (id,payload,revision,updated_at,mutation_id) VALUES (?, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, revision=founder_documents.revision+1, updated_at=excluded.updated_at, mutation_id=excluded.mutation_id WHERE founder_documents.revision = ? RETURNING revision, updated_at').bind(id,payload,savedAt,mutationId,expected).first();
  if(!row)throw Object.assign(new Error('Souběžná změna: načti aktuální verzi před dalším uložením.'),{status:409});
  return {revision:row.revision,savedAt:row.updated_at};
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin');
    const allowed=env.ALLOWED_ORIGIN||'https://brzotomas.github.io';
    if(origin&&origin!==allowed&&origin!==url.origin)return json({error:'Tento původ není povolený.'},403,null);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers(origin),'Access-Control-Allow-Methods':'POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    if(url.pathname==='/'&&request.method==='GET')return json({service:'Founder OS — sdílené úložiště',status:'ready',app:'https://brzotomas.github.io/kalkulacka/founder/'},200,origin);
    if(!['/api/read','/api/state','/api/source'].includes(url.pathname))return json({error:'Nenalezeno.'},404,origin);
    if((url.pathname==='/api/read'&&request.method!=='POST')||(url.pathname!=='/api/read'&&request.method!=='PUT'))return json({error:'Nepovolená metoda.'},405,origin);
    try{
      if(!env.DB||!env.OWNER_TOKEN_HASH||!env.VIEWER_TOKEN_HASH)return json({error:'Sdílené úložiště ještě není připravené.'},503,origin);
      const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('Authorization')||'')?.[1];
      if(!token)return json({error:'Použij svůj osobní přístupový odkaz.'},401,origin);
      const digest=await hash(token),role=same(digest,env.OWNER_TOKEN_HASH)?'owner':same(digest,env.VIEWER_TOKEN_HASH)?'viewer':null;
      if(!role)return json({error:'Přístupový odkaz není platný.'},401,origin);
      if(url.pathname==='/api/read'){
        const rows=await env.DB.prepare('SELECT id,payload,revision,updated_at FROM founder_documents WHERE id IN (?,?)').bind('founder','source').all();
        const own=rows.results.find(x=>x.id==='founder'),source=rows.results.find(x=>x.id==='source');
        const result={role,own:own?JSON.parse(own.payload):null,revision:own?.revision||0,savedAt:own?.updated_at||null,source:source?JSON.parse(source.payload):null,sourceRevision:source?.revision||0,sourceSavedAt:source?.updated_at||null};
        if(role==='owner'&&/^[a-f0-9]{64}$/i.test(env.VIEWER_TOKEN||''))result.viewerToken=env.VIEWER_TOKEN;
        return json(result,200,origin);
      }
      if(role!=='owner')return json({error:'Tento odkaz dovoluje pouze náhled.'},403,origin);
      const value=await body(request),source=url.pathname==='/api/source',document=source?value?.source:value?.own;
      if(!object(value)||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||typeof value.mutationId!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(value.mutationId)||!(source?validateSource(document):validateOwn(document)))return json({error:'Údaje nejsou platným záznamem Founder OS.'},400,origin);
      return json(await saveDocument(env.DB,source?'source':'founder',document,value.expectedRevision,value.mutationId),200,origin);
    }catch(error){
      if([400,409,413].includes(error.status))return json({error:error.message},error.status,origin);
      console.error('Founder OS storage request failed; data and credentials omitted.');
      return json({error:'Uložení se nepodařilo potvrdit. Zachovej rozepsaný formulář a zkus to znovu.'},503,origin);
    }
  }
};
