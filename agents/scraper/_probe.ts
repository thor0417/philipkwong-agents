import { supabaseAdmin as db } from '../../lib/supabase-admin.js';
const M='gli';
const DAY=86400000, NOW=Date.parse('2026-08-15T00:00:00Z');
async function all<T>(t:string,c:string,f:(q:any)=>any=(q)=>q):Promise<T[]>{const o:T[]=[];for(let i=0;;i+=1000){const{data,error}=await f(db.from(t).select(c)).range(i,i+999);if(error)throw error;o.push(...((data??[]) as T[]));if(!data||data.length<1000)break;}return o;}
type L={id:string;project_id:string|null;market:string|null;country:string|null;region_state:string|null;source:string|null;stream:string|null;status:string;first_seen:string|null;published_date:string|null;deadline:string|null;applicant:string|null;representative:string|null;presented_by:string|null;contact_name:string|null;contact_email:string|null;contact_phone:string|null};
const leads=(await all<L>('leads','id,project_id,market,country,region_state,source,stream,status,first_seen,published_date,deadline,applicant,representative,presented_by,contact_name,contact_email,contact_phone',q=>q.eq('module',M))).filter(l=>l.status!=='dismissed');
type P={id:string;market:string|null;country:string|null;region_state:string|null;status:string;record_count:number|null};
const projects=(await all<P>('projects','id,market,country,region_state,status,record_count',q=>q.eq('module',M))).filter(p=>p.status!=='dismissed');
const liveIds=new Set(projects.map(p=>p.id));

// ---- SOURCES
const bySource=new Map<string,{n:number;newest:string|null;newestCapture:string|null}>();
for(const l of leads){
  const k=l.source??'(null)';
  const e=bySource.get(k)??{n:0,newest:null,newestCapture:null};
  e.n++;
  const d=l.published_date??l.deadline??null;
  if(d&&(!e.newest||d>e.newest)) e.newest=d;
  if(l.first_seen&&(!e.newestCapture||l.first_seen>e.newestCapture)) e.newestCapture=l.first_seen;
  bySource.set(k,e);
}
console.log(`SOURCES (${bySource.size}) - newest DOCUMENT date and newest CAPTURE, days behind ${new Date(NOW).toISOString().slice(0,10)}`);
const rows=[...bySource.entries()].map(([k,e])=>({k,...e,
  docDays: e.newest?Math.round((NOW-Date.parse(e.newest))/DAY):null,
  capDays: e.newestCapture?Math.round((NOW-Date.parse(e.newestCapture))/DAY):null}));
rows.sort((a,b)=>(b.capDays??1e9)-(a.capDays??1e9));
for(const r of rows) console.log(`  ${r.k.padEnd(24)} n=${String(r.n).padStart(5)}  newest doc ${String(r.newest??'-').slice(0,10).padEnd(11)} ${String(r.docDays??'-').padStart(6)}d   newest capture ${String(r.newestCapture??'-').slice(0,10).padEnd(11)} ${String(r.capDays??'-').padStart(5)}d`);
console.log(`sources with newest CAPTURE > 30 days: ${rows.filter(r=>(r.capDays??1e9)>30).length}`);
console.log(`sources with newest DOCUMENT > 30 days: ${rows.filter(r=>(r.docDays??1e9)>30).length}`);

// ---- MARKETS via records
const named=(l:L)=>!!(l.applicant||l.representative||l.presented_by||l.contact_name);
const contact=(l:L)=>!!(l.contact_email||l.contact_phone);
const byMarket=new Map<string,{projects:Set<string>;records:number;newestDoc:string|null;newestCap:string|null;namedProjects:Set<string>;contactProjects:Set<string>;sources:Set<string>}>();
for(const l of leads){
  if(!l.market) continue;
  const e=byMarket.get(l.market)??{projects:new Set<string>(),records:0,newestDoc:null,newestCap:null,namedProjects:new Set<string>(),contactProjects:new Set<string>(),sources:new Set<string>()};
  e.records++;
  if(l.source) e.sources.add(l.source);
  const d=l.published_date??l.deadline??null;
  if(d&&(!e.newestDoc||d>e.newestDoc)) e.newestDoc=d;
  if(l.first_seen&&(!e.newestCap||l.first_seen>e.newestCap)) e.newestCap=l.first_seen;
  if(l.project_id&&liveIds.has(l.project_id)){ e.projects.add(l.project_id); if(named(l)) e.namedProjects.add(l.project_id); if(contact(l)) e.contactProjects.add(l.project_id); }
  byMarket.set(l.market,e);
}
console.log('\nMARKETS (by any record naming them)');
for(const [m,e] of [...byMarket.entries()].sort((a,b)=>b[1].projects.size-a[1].projects.size)){
  const dd=e.newestDoc?Math.round((NOW-Date.parse(e.newestDoc))/DAY):null;
  console.log(`  ${m.padEnd(44)} proj=${String(e.projects.size).padStart(3)} rec=${String(e.records).padStart(4)} named=${String(e.namedProjects.size).padStart(3)} contact=${String(e.contactProjects.size).padStart(3)} newestDoc=${String(dd??'-').padStart(6)}d src=[${[...e.sources].join(',')}]`);
}
// press-only geographies: countries/regions with records but no government/opportunity stream
const geoByCountry=new Map<string,{records:number;projects:Set<string>;streams:Set<string>}>();
for(const l of leads){ const c=l.country??'(unresolved)'; const e=geoByCountry.get(c)??{records:0,projects:new Set<string>(),streams:new Set<string>()}; e.records++; if(l.stream) e.streams.add(l.stream); if(l.project_id&&liveIds.has(l.project_id)) e.projects.add(l.project_id); geoByCountry.set(c,e); }
console.log('\nCOUNTRIES');
for(const [c,e] of [...geoByCountry.entries()].sort((a,b)=>b[1].projects.size-a[1].projects.size)) console.log(`  ${c.padEnd(28)} proj=${String(e.projects.size).padStart(3)} rec=${String(e.records).padStart(4)} streams=[${[...e.streams].join(',')}]`);
