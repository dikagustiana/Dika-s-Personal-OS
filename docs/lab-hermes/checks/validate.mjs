// Validasi draft offline. Auth/passphrase memakai shim fixture, bukan Supabase live.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ajv=new Ajv({allErrors:true,strict:true});
addFormats(ajv);
const schemas=Object.fromEntries(['agent-config','job-payload','result'].map(name=>[name,ajv.compile(JSON.parse(fs.readFileSync(root+'/docs/lab-hermes/schemas/'+name+'.schema.json','utf8')))]));
const valid=(name,value)=>{if(!schemas[name](value))throw Error(name+': '+JSON.stringify(schemas[name].errors));};
console.log('SCHEMAS_COMPILED_OK');
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.os_key_valid() returns boolean language sql stable as $$ select coalesce(current_setting('test.owner',true),'')='on' $$;
create function public.os_read_key_valid() returns boolean language sql stable as $$ select public.os_key_valid() $$;
create function public.os_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;`);
const s73=fs.readFileSync(root+'/supabase/migrations/20260817000073_lab_schema.sql','utf8');
for(const m of s73.matchAll(/create table if not exists public\.[\s\S]*?\n\);/g)) await db.exec(m[0]);
await db.exec('alter table public.os_lab_runs add model text, add refusals jsonb;');
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260817000074_lab_data_boundary.sql','utf8'));
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260910000099_institution_schema.sql','utf8'));
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260910000100_institution_guards.sql','utf8'));
for(const f of fs.readdirSync(root+'/docs/lab-hermes/sql').filter(f=>/^00[1-5].*sql$/.test(f)).sort()){
 try {await db.exec(fs.readFileSync(root+'/docs/lab-hermes/sql/'+f,'utf8'));console.log('APPLIED',f)}
 catch(e){console.log('FAIL',f,e.message);throw e;}
}
console.log('SCHEMA_AND_FUNCTIONS_OK');
await db.exec(`insert into public.os_lab_providers(name,adapter,base_url,model,cost_in_per_mtok,cost_out_per_mtok) values('kimi','openai','https://api.moonshot.ai/v1','kimi-k2.6',0.95,4); set test.owner='on';`);
const q=async(s,args=[])=>{let r=await db.query(s,args);return r.rows[0]};
await q(`select public.lab_owner_price('kimi-global','kimi','kimi-k2.6','global','{"currency":"USD","max_context_tokens":262144,"input_usd_per_million":0.95,"output_usd_per_million":4,"cache_hit_usd_per_million":0.16,"cache_write_usd_per_million":0,"fx_usd_per_native":1}','https://platform.kimi.ai/docs/pricing/chat.md',now(),true)`);
const conf={executor:'hermes',provider:'kimi',model:'kimi-k2.6',route_id:'kimi-global',timeout_seconds:900,max_cost_usd:2,max_turns:20,max_output_tokens:4096,endpoint_region:'global',api_mode:'chat_completions',auxiliary:{},tool_allowlist:['lab.search','lab.fetch','terminal','execute_code'],fallback_routes:[],provenance_required:false};
valid('agent-config',conf);
let a=(await q(`select public.lab_owner_configure(null,$1::jsonb,$2::jsonb) id`,[JSON.stringify({slug:'lab-researcher',name:'Lab researcher',system_prompt:'Research carefully with sources.'}),JSON.stringify(conf)])).id;
let k=(await q('select gen_random_uuid() id')).id;
let j=(await q(`select public.lab_owner_submit($1,$2,'Uji rantai kebijakan publik infrastruktur pembiayaan pajak karbon','brief') result`,[k,a])).result;
let repeat=(await q(`select public.lab_owner_submit($1,$2,'Uji rantai kebijakan publik infrastruktur pembiayaan pajak karbon','brief') result`,[k,a])).result;
if(repeat.job_id!==j.job_id||!repeat.replay)throw Error('submit replay');
let user=(await q('select gen_random_uuid() id')).id;
await q('insert into auth.users values($1)',[user]);
await q(`insert into lab_private.workers(auth_user_id,name) values($1,'test-worker')`,[user]);
await db.exec(`set test.owner='off'; set role authenticated;`);
await q(`select set_config('request.jwt.claim.sub',$1,false)`,[user]);
let claim=(await q('select public.lab_worker_claim() j')).j;
if(!claim||claim.id!==j.job_id)throw Error('claim missing');
valid('job-payload',claim.payload);
for(const mutation of [p=>{p.config.unexpected=true},p=>{p.config.timeout_seconds=0},p=>{p.agent.files=[{path:'../escape',content:'x',sha256:'a'.repeat(64)}]}]){const p=structuredClone(claim.payload);mutation(p);if(schemas['job-payload'](p))throw Error('schema negative case accepted');}
const args=[claim.id,claim.attempt,claim.lease_token];
let second=(await q('select public.lab_worker_claim() j')).j;if(second!==null)throw Error('concurrency');
await q(`select public.lab_worker_heartbeat($1,$2,$3,'${'a'.repeat(40)}')`,args);
const call=(await q('select gen_random_uuid() id')).id;
await q('select public.lab_worker_reserve($1,$2,$3,$4,$5,$6)',[...args,call,'kimi-global',0.3]);
await q('select public.lab_worker_reserve($1,$2,$3,$4,$5,$6)',[...args,call,'kimi-global',0.3]);
await q('select public.lab_worker_settle($1,$2,$3,$4,$5,$6)',[...args,call,0.001,JSON.stringify({input_tokens:100,output_tokens:100})]);
const op=(await q('select gen_random_uuid() id')).id;
let corpus=(await q('select public.lab_worker_archive($1,$2,$3,$4,$5) id',[...args,op,JSON.stringify({kind:'retrieval',title:'Test source',content:'Public source fixture.',url:'https://example.org/source',fetched_at:'2026-09-26T00:00:00Z',http_status:200})])).id;
await q('select public.lab_worker_read_corpus($1,$2,$3,$4)',[...args,corpus]);
await q('select public.lab_worker_events($1,$2,$3,$4)',[...args,JSON.stringify([{sequence:1,kind:'tool.started',emitted_at:'2026-09-26T00:00:00Z',payload:{tool:'search'}}])]);
await q('select public.lab_worker_validating($1,$2,$3)',args);
const resultObject={schema_version:'1',job_id:claim.id,attempt:claim.attempt,status:'succeeded',
 output:{title:'Uji rantai',markdown:'Rantai belum terbukti.',claims:[],limitations:['Fixture, bukan hasil riset.']},
 provenance:[{corpus_id:corpus,kind:'retrieval',source:'Test source',url:'https://example.org/source',fetched_at:'2026-09-26T00:00:00Z',content_hash:'a'.repeat(64),raw_content_hash:null,locator:'full'}],
 tool_calls:[],usage:{input_tokens:100,output_tokens:100,cache_read_tokens:0,cache_write_tokens:0,known_cost_usd:0.001,unresolved_reserved_usd:0,cost_status:'calculated',price_route_id:'kimi-global',native_currency:'USD',native_cost:0.001,fx_usd_per_native:1},
 runtime:{hermes_commit:'a'.repeat(40),adapter_version:'fixture',session_id:claim.id,provider:'kimi',model:'kimi-k2.6',started_at:'2026-09-26T00:00:00Z',finished_at:'2026-09-26T00:01:00Z'},error:null,skill_proposals:[]};
valid('result',resultObject);
const badResult=structuredClone(resultObject);badResult.runtime.hermes_commit='main';if(schemas.result(badResult))throw Error('unpinned runtime accepted');
const result=JSON.stringify(resultObject);
await q('select public.lab_worker_finish($1,$2,$3,$4)',[...args,result]);
const receipt=(await q('select public.lab_worker_finish($1,$2,$3,$4) r',[...args,result])).r;
if(!receipt.replay)throw Error('finish replay');
const denies=[];
for(const [name,sql,params] of [
 ['owner_cancel','select public.lab_owner_cancel($1)',[j.job_id]],
 ['direct_read','select * from lab_private.workers',[]],
 ['stale_lease','select public.lab_worker_heartbeat($1,$2,$3)',[...args]],
 ['different_result','select public.lab_worker_finish($1,$2,$3,$4)',[...args,JSON.stringify({output:{markdown:'Altered'}})]]]){
 try{await q(sql,params);throw Error('not denied: '+name)}catch(e){if(e.message.startsWith('not denied'))throw e;denies.push(name)}
}
console.log('BEHAVIOR_OK submit+claim+concurrency+heartbeat+reserve+settle+archive+events+finish+replay; denials='+denies.join(','));
await db.exec('reset role;');
const counts=await q(`select (select count(*) from public.os_lab_hermes_jobs where status='succeeded')::int jobs,(select count(*) from public.os_inst_corpus where kind='output')::int outputs,(select status from public.os_inst_briefs limit 1) brief`);
console.log(JSON.stringify(counts));
await db.exec("set test.owner='on';");
const status=(await q('select public.lab_owner_run_status($1) r',[j.job_id])).r;
if(status.job.lease_token||status.attempts.length!==1||status.usage.known_cost_usd!==0.001)throw Error('owner projection');
// Kasus kedua: unknown usage, batas biaya, cancel dan reaper tanpa menunggu jam nyata.
const newKey=(await q('select gen_random_uuid() id')).id;
const j2=(await q("select public.lab_owner_submit($1,$2,'Fixture cancel dan batas biaya','brief') r",[newKey,a])).r;
await db.exec("set test.owner='off';set role authenticated;");
const c2=(await q('select public.lab_worker_claim() r')).r;
const arg2=[c2.id,c2.attempt,c2.lease_token];
const call2=(await q('select gen_random_uuid() id')).id;
await q('select public.lab_worker_reserve($1,$2,$3,$4,$5,$6)',[...arg2,call2,'kimi-global',1.99]);
let capped=false;try{await q('select public.lab_worker_reserve($1,$2,$3,gen_random_uuid(),$4,$5)',[...arg2,'kimi-global',0.02]);}catch(e){if(e.message.includes('budget_exceeded'))capped=true;else throw e;}if(!capped)throw Error('cost cap not enforced');
await db.exec("reset role;set test.owner='on';");
const partial=(await q('select public.lab_owner_run_status($1) r',[j2.job_id])).r;
if(partial.usage.unresolved_reserved_usd!==1.99)throw Error('unknown usage lost');
await q('select public.lab_owner_cancel($1)',[j2.job_id]);
await db.exec("set test.owner='off';set role authenticated;");
const pulse=(await q('select public.lab_worker_heartbeat($1,$2,$3) r',arg2)).r;
if(pulse.command!=='cancel')throw Error('cancel not delivered');
await db.exec('reset role;');
await q("update public.os_lab_hermes_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[j2.job_id]);
await db.exec('set role authenticated;');
await q('select public.lab_worker_claim()');
await db.exec('reset role;');
const recovered=await q('select j.status,a.status assignment,b.status brief from public.os_lab_hermes_jobs j join public.os_inst_assignments a on a.id=j.assignment_id join public.os_inst_briefs b on b.id=j.brief_id where j.id=$1',[j2.job_id]);
if(recovered.status!=='cancelled'||recovered.assignment!=='failed'||recovered.brief!=='paused')throw Error('reaper projection');
console.log('SCHEMA_NEGATIVES_AND_RECOVERY_OK owner_projection+unknown_reservation+cost_cap+cancel+expired_lease');
await db.close();
