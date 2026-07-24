-- Supabase security advisor follow-up: pin the trigger function's
-- search_path (advisor lint 0011_function_search_path_mutable).
--
-- The other advisor warnings — os_key_valid() and os_verify_key(text) being
-- executable by anon as SECURITY DEFINER — are intentional: os_key_valid is
-- the RLS predicate (it must run as the querying role) and os_verify_key is
-- the pre-unlock passphrase check. Both return only a boolean.

create or replace function public.os_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
