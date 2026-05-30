-- B0.3 — audit_log: the table behind lib/audit/emit.ts (the loud two-write
-- audit util). Wide, purpose-built schema (NOT the legacy jam-into-jsonb
-- pattern). Multi-tenant from day one: org_id is first-class (inv. #3).
--
-- Writes go through the service-role admin client (RLS bypassed) inside the
-- action wrapper. RLS is ENABLED with NO authenticated read policy yet — audit
-- reads are deliberately locked down until the roles-as-capabilities model
-- (B2) defines who may read the trail. The append-only intent is enforced:
-- no UPDATE/DELETE policy exists for anyone.

create extension if not exists pgcrypto;

create table if not exists public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid,                       -- tenant scope (null only for pre-tenant system events)
  action          text        not null,       -- e.g. 'booking.confirm'
  sub_event       text        not null check (sub_event in ('attempted','completed','failed')),
  actor_id        uuid,                        -- auth.users id of the performer
  entity_type     text,
  entity_id       text,
  parent_audit_id uuid references public.audit_log(id) on delete set null,
  meta            jsonb,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_log_org_created on public.audit_log (org_id, created_at desc);
create index if not exists idx_audit_log_action      on public.audit_log (action);
create index if not exists idx_audit_log_parent      on public.audit_log (parent_audit_id);
create index if not exists idx_audit_log_actor       on public.audit_log (actor_id);

alter table public.audit_log enable row level security;

-- Service role (the admin client) may write and read everything; this is the
-- only write path. No other role gets INSERT/UPDATE/DELETE — append-only by
-- omission. Authenticated read policy is intentionally deferred to B2.
drop policy if exists audit_log_service_all on public.audit_log;
create policy audit_log_service_all on public.audit_log
  for all to service_role using (true) with check (true);
