// READ-ONLY. Brief R item 2: how far into the future does published_date go, per
// market? A rule that refuses a far-future date must not strip a hearing date a
// source published early, so the threshold is chosen from the distribution
// rather than picked.
import { supabaseAdmin } from '../../../lib/supabase-admin';
const rows:any[]=[];
for(let f=0;;f+=1000){
  const {data,error}=await supabaseAdmin.from('leads')
    .select('id,market,source,title,published_date,date_source,status,lifecycle').range(f,f+999);
  if(error) throw new Error(error.message);
  const r=(data??[]) as any[]; rows.push(...r); if(r.length<1000) break;
}
const live=rows.filter(l=>l.status!=='dismissed'&&l.lifecycle!=='retired'&&l.published_date);
const NOW=Date.parse('2026-08-23T00:00:00Z');
const days=(d:string)=>Math.round((Date.parse(d)-NOW)/86400000);
console.log('live records carrying a published_date: '+live.length+'   [paged to exhaustion, NO CAP]');
const fut=live.filter(l=>days(l.published_date)>0).sort((a,b)=>days(b.published_date)-days(a.published_date));
console.log('with a FUTURE published_date: '+fut.length);
console.log('\nby market, and how far ahead:');
const m=new Map<string,number[]>();
for(const l of fut){ const k=String(l.market??'(none)'); if(!m.has(k)) m.set(k,[]); m.get(k)!.push(days(l.published_date)); }
for(const [k,v] of [...m].sort((a,b)=>Math.max(...b[1])-Math.max(...a[1]))){
  v.sort((a,b)=>b-a);
  console.log('  '+k.padEnd(34)+String(v.length).padStart(3)+' records   max +'+v[0]+'d   all: '+v.map(x=>'+'+x+'d').join(', '));
}
console.log('\nthreshold sweep - how many records a cutoff would demote:');
for(const t of [7,14,30,60,90,120]){
  const hit=fut.filter(l=>days(l.published_date)>t);
  const mk=[...new Set(hit.map(l=>String(l.market)))];
  console.log('  > +'+String(t).padStart(3)+'d : '+String(hit.length).padStart(3)+' records   markets: '+(mk.join(', ')||'none'));
}
console.log('\nthe far-future records, named:');
for(const l of fut.filter(l=>days(l.published_date)>30)) console.log('  +'+days(l.published_date)+'d  ['+l.market+'/'+l.source+'] date_source='+l.date_source+'  '+String(l.title).slice(0,70));
