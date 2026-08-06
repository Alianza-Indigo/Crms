-- ============================================================================
-- Row-Level Security (PRD §6.1, §34.3)
-- Defense-in-depth tenant isolation for STRUCTURAL/administrative tables.
-- Even a raw, mis-scoped query cannot cross a tenant boundary: every policy
-- confines rows to the tenant in app.current_tenant_id. A single explicit,
-- audited escape hatch (app.bypass_rls='on') exists for platform admin/system
-- workers only.
--
-- Dynamic EAV tables (records/record_values/…) are ALSO protected here, but the
-- application layer additionally forces all dynamic access through the Query
-- Engine which injects tenant_id + application_id + environment.
-- ============================================================================

-- Helper: current tenant from session GUC (NULL when unset).
create or replace function app_current_tenant() returns text
  language sql stable as $$ select nullif(current_setting('app.current_tenant_id', true), '') $$;

create or replace function app_bypass_rls() returns boolean
  language sql stable as $$ select coalesce(current_setting('app.bypass_rls', true), 'off') = 'on' $$;

-- Apply a uniform tenant policy to every table that has a tenant_id column.
do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('alter table public.%I force row level security', r.table_name);
    execute format('drop policy if exists tenant_isolation on public.%I', r.table_name);
    execute format($f$
      create policy tenant_isolation on public.%I
        using (app_bypass_rls() or tenant_id = app_current_tenant())
        with check (app_bypass_rls() or tenant_id = app_current_tenant())
    $f$, r.table_name);
  end loop;
end $$;

-- The tenants table keys on id (not tenant_id): confine to the active tenant.
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
drop policy if exists tenant_self on public.tenants;
create policy tenant_self on public.tenants
  using (app_bypass_rls() or id = app_current_tenant())
  with check (app_bypass_rls() or id = app_current_tenant());

-- feature_flags may be platform-global (tenant_id IS NULL) and readable by all;
-- writes to global flags require bypass (platform admin).
drop policy if exists tenant_isolation on public.feature_flags;
drop policy if exists feature_flags_read on public.feature_flags;
drop policy if exists feature_flags_write on public.feature_flags;
create policy feature_flags_read on public.feature_flags
  for select using (app_bypass_rls() or tenant_id is null or tenant_id = app_current_tenant());
create policy feature_flags_write on public.feature_flags
  for all using (app_bypass_rls() or tenant_id = app_current_tenant())
  with check (app_bypass_rls() or tenant_id = app_current_tenant());

-- resellers + tenant_routing are platform-managed: bypass-only writes.
alter table public.resellers enable row level security;
alter table public.resellers force row level security;
drop policy if exists reseller_admin on public.resellers;
create policy reseller_admin on public.resellers using (app_bypass_rls()) with check (app_bypass_rls());

alter table public.tenant_routing enable row level security;
alter table public.tenant_routing force row level security;
drop policy if exists routing_self on public.tenant_routing;
create policy routing_self on public.tenant_routing
  using (app_bypass_rls() or tenant_id = app_current_tenant())
  with check (app_bypass_rls());
