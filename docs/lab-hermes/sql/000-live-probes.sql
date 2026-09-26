-- READ ONLY. Fable menjalankan setiap blok dan menyimpan output teredaksi.
begin transaction read only;
select current_database(), version(), now() as db_time;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema in ('public','private')
 and (table_name like 'os_lab_%' or table_name like 'os_inst_%')
order by table_schema,table_name,ordinal_position;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where tablename like 'os_lab_%' or tablename like 'os_inst_%'
order by tablename,policyname;
select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and (c.relname like 'os_lab_%' or c.relname like 'os_inst_%');
select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and (p.proname like 'os_inst_%' or p.proname like 'os_lab_%');
select 'briefs' as kind,count(*) from public.os_inst_briefs
union all select 'corpus',count(*) from public.os_inst_corpus
union all select 'runs',count(*) from public.os_lab_runs;
select id,question,status,weight_class,created_at,started_at,finished_at,cost_estimate_usd,cost_actual_usd
from public.os_inst_briefs order by created_at desc limit 20;
select id,agent_id,provider_id,status,left(error,200) as error_summary,model,tokens_in,tokens_out,cost_usd,created_at
from public.os_lab_runs order by created_at desc limit 30;
select a.id,a.slug,a.data_class,a.version,a.is_active,
 count(v.id) filter(where v.status='active') as active_versions
from public.os_lab_agents a left join public.os_inst_agent_versions v on v.agent_id=a.id
 group by a.id order by a.slug;
select slug,kind,lead_agent_slug,pipeline_order from public.os_inst_departments order by pipeline_order;
select extname,extversion from pg_extension where extname in ('pg_cron','pg_net','pgcrypto');
select pubname,tablename from pg_publication_tables where pubname='supabase_realtime';
select version,name from supabase_migrations.schema_migrations order by version;
rollback;
-- Plan Supabase, deployment SHA, logs, Auth settings dan secret alerts bukan SQL catalog:
-- O-02/O-05/O-08 memberi probe MCP/dashboard read-only. Jangan SELECT nilai secret.
