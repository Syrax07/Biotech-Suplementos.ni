begin;

revoke all on function public.rls_auto_enable()
  from public, anon, authenticated, service_role;

create index if not exists business_state_updated_by_idx
  on public.business_state (updated_by);

commit;
