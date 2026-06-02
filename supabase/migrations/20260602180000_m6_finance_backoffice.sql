-- ============================================================================
-- M6 — FINANCE BACK-OFFICE: expense ledger + tiered approval (REUSE) + ageing
-- ----------------------------------------------------------------------------
-- Benchmarked vs Zoho Books/Expense / SAP Concur (NOT a legacy re-skin). Three
-- pieces, all REUSING the shared core (invariant #10: one ledger, many streams;
-- P&L is a QUERY, not a reconciliation).
--
--  A) EXPENSE LEDGER — posts to the EXISTING W0 finance_ledger (NO parallel
--     ledger). On approval, the expense writes a DEBIT/cost entry via W0
--     write_ledger (supply_type tag 'expense', source_domain hall|stays|catering|
--     core, linked to the expense row). Input GST on an expense is DATA on the
--     row (`input_gst_amount`/`supply_type` tag) — NEVER run through the OUTPUT
--     resolve_gst engine.
--
--  B) TIERED APPROVAL — REUSES the M1b GENERIC primitive (submit_approval_request
--     / decide_approval) with request_type='expense', subject_id = the expense.
--     ZERO new approval tables/machinery. Anti-self-approval, distinct-approver,
--     multi-tier (required_approvals>=1) — all inherited unchanged.
--
--  C) COLLECTIONS / AGEING — a READ over the EXISTING invoices (NO new AR table).
--     Outstanding (status='issued', coalesce(amount_due,total) > 0) bucketed by age
--     (0-30/31-60/61-90/90+) from issued_at. Money figures gated by pnl.view_margin;
--     bucket COUNTS are member-visible (consistent with hall_analytics/stays_report).
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ THE FINANCE FIREWALL — M6 NEVER touches resolve_gst, the invoice/settlement ║
-- ║  engine, or the revenue (credit) path. It reads/writes finance_ledger + the ║
-- ║  M1b approval primitive ONLY, and READS invoices for ageing. An expense's   ║
-- ║  input GST is stored DATA, never resolved. No coupling to output-GST.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Lifecycle: draft → submit (enters the primitive) → approved | rejected; on
-- approval POSTS to the ledger (atomic decide+post). mark_expense_paid is a STATUS
-- update only — NO payment execution / NO money movement.
--
-- Atomic + audited + tenant-scoped (RLS default-deny + auth.uid() self-auth).
-- Cap `expense.manage` gates create/submit/category/paid; decide_expense reuses
-- `approval.decide`; ageing money figures gated by `pnl.view_margin`.
-- ============================================================================

create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_expense_categories_org_name on public.expense_categories (org_id, lower(btrim(name)));

create table if not exists public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  category_id         uuid references public.expense_categories(id) on delete set null,
  vendor_id           uuid references public.vendors(id) on delete set null,   -- REUSE W1d vendors (payee)
  payee_name          text,                                                    -- when not a vendor
  amount              numeric(14,2) not null check (amount > 0),
  expense_date        date not null,
  supply_type         text,                                                    -- input-GST DATA tag ONLY (never resolve_gst)
  input_gst_amount    numeric(14,2),                                           -- DATA ONLY (recorded, never computed by output-GST)
  source_domain       text not null default 'core' check (source_domain in ('hall','stays','catering','core')),
  notes               text,
  status              text not null default 'draft' check (status in ('draft','pending','approved','rejected','paid')),
  approval_request_id uuid references public.approval_requests(id) on delete set null,  -- the M1b primitive
  ledger_entry_id     uuid references public.finance_ledger(id) on delete set null,     -- the posted cost entry
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_expenses_org_status on public.expenses (org_id, status);
create index if not exists idx_expenses_vendor on public.expenses (vendor_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['expense_categories','expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- upsert_expense_category — config (cap expense.manage).
-- ============================================================================
create or replace function public.upsert_expense_category(p_org uuid, p_name text, p_category_id uuid default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'expense.manage') then raise exception 'forbidden' using errcode='42501', detail='expense.manage required'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'bad_name' using errcode='22023'; end if;
  if p_category_id is null then
    insert into public.expense_categories(org_id, name) values (p_org, btrim(p_name)) returning id into v_id;
  else
    update public.expense_categories set name = btrim(p_name) where id = p_category_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'category_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'finance.expense_category_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'expense_category', v_id::text);
  return jsonb_build_object('category_id', v_id);
end; $$;

-- ============================================================================
-- record_expense — create/update a DRAFT expense (cap expense.manage). Stores
-- input GST as DATA only (never resolve_gst). Posts NOTHING (post is on approval).
-- ============================================================================
create or replace function public.record_expense(
  p_org uuid, p_amount numeric, p_expense_date date, p_category_id uuid default null, p_vendor_id uuid default null,
  p_payee_name text default null, p_supply_type text default null, p_input_gst_amount numeric default null,
  p_source_domain text default 'core', p_notes text default null, p_expense_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'expense.manage') then raise exception 'forbidden' using errcode='42501', detail='expense.manage required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount' using errcode='22023'; end if;
  if p_source_domain not in ('hall','stays','catering','core') then raise exception 'bad_domain' using errcode='22023'; end if;
  if p_vendor_id is not null and not exists (select 1 from public.vendors where id = p_vendor_id and org_id = p_org) then raise exception 'vendor_not_found' using errcode='P0002'; end if;
  if p_category_id is not null and not exists (select 1 from public.expense_categories where id = p_category_id and org_id = p_org) then raise exception 'category_not_found' using errcode='P0002'; end if;

  if p_expense_id is null then
    insert into public.expenses(org_id, category_id, vendor_id, payee_name, amount, expense_date, supply_type, input_gst_amount, source_domain, notes)
      values (p_org, p_category_id, p_vendor_id, p_payee_name, p_amount, p_expense_date, p_supply_type, p_input_gst_amount, p_source_domain, p_notes)
      returning id into v_id;
  else
    select status into v_status from public.expenses where id = p_expense_id and org_id = p_org;
    if v_status is null then raise exception 'expense_not_found' using errcode='P0002'; end if;
    if v_status <> 'draft' then raise exception 'expense_not_draft' using errcode='22023', detail=v_status; end if;   -- only a draft is editable
    update public.expenses set category_id = p_category_id, vendor_id = p_vendor_id, payee_name = p_payee_name, amount = p_amount,
        expense_date = p_expense_date, supply_type = p_supply_type, input_gst_amount = p_input_gst_amount, source_domain = p_source_domain,
        notes = p_notes, updated_at = now()
      where id = p_expense_id and org_id = p_org returning id into v_id;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'finance.expense_record', 'completed', coalesce(p_actor_id, auth.uid()), 'expense', v_id::text, jsonb_build_object('amount', p_amount, 'domain', p_source_domain));
  return jsonb_build_object('expense_id', v_id, 'status', 'draft');
end; $$;

-- ============================================================================
-- submit_expense — draft → pending; enters the M1b GENERIC primitive as
-- request_type='expense' (cap expense.manage). Two writes, ONE tx: the expense
-- → pending update then submit_approval_request — a bad required_approvals fails
-- in the primitive's CHECK mid-tx and the expense update rolls back (atomicity).
-- ============================================================================
create or replace function public.submit_expense(
  p_org uuid, p_expense_id uuid, p_required_approvals int default 1, p_requested_by_user uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_appr uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'expense.manage') then raise exception 'forbidden' using errcode='42501', detail='expense.manage required'; end if;
  select status into v_status from public.expenses where id = p_expense_id and org_id = p_org for update;
  if v_status is null then raise exception 'expense_not_found' using errcode='P0002'; end if;
  if v_status <> 'draft' then raise exception 'expense_not_draft' using errcode='22023', detail=v_status; end if;

  update public.expenses set status = 'pending', updated_at = now() where id = p_expense_id and org_id = p_org;   -- write 1
  -- REUSE the M1b primitive (request_type='expense', subject=this expense). write 2 → rolls back write 1 on failure.
  v_appr := (public.submit_approval_request(p_org, 'expense', p_expense_id, p_required_approvals, coalesce(p_requested_by_user, auth.uid()), p_actor_id) ->> 'approval_request_id')::uuid;
  update public.expenses set approval_request_id = v_appr, updated_at = now() where id = p_expense_id and org_id = p_org;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'finance.expense_submit', 'completed', coalesce(p_actor_id, auth.uid()), 'expense', p_expense_id::text, jsonb_build_object('approval_request_id', v_appr));
  return jsonb_build_object('expense_id', p_expense_id, 'status', 'pending', 'approval_request_id', v_appr);
end; $$;

-- ============================================================================
-- decide_expense — approve/reject via the M1b primitive (cap approval.decide).
-- On reaching required approvals → POSTS a DEBIT cost entry to finance_ledger via
-- W0 write_ledger (atomic decide+post: the decision + the ledger row are ONE tx).
-- Reject → terminal, NO ledger post. Anti-self / distinct / multi-tier inherited.
-- ============================================================================
create or replace function public.decide_expense(p_org uuid, p_expense_id uuid, p_decision text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.expenses%rowtype; v_res jsonb; v_new text; v_led uuid; v_cat text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'approval.decide') then raise exception 'forbidden' using errcode='42501', detail='approval.decide required'; end if;
  select * into e from public.expenses where id = p_expense_id and org_id = p_org for update;
  if e.id is null then raise exception 'expense_not_found' using errcode='P0002'; end if;
  if e.status <> 'pending' then raise exception 'expense_not_pending' using errcode='22023', detail=e.status; end if;
  if e.approval_request_id is null then raise exception 'no_approval_thread' using errcode='P0002'; end if;

  v_res := public.decide_approval(p_org, e.approval_request_id, p_decision, p_actor_id);   -- inherits anti-self/distinct/multi-tier
  v_new := v_res ->> 'status';

  if v_new = 'approved' then
    select name into v_cat from public.expense_categories where id = e.category_id and org_id = p_org;
    -- POST a DEBIT/cost entry to the SHARED ledger (NO parallel ledger; NO resolve_gst).
    v_led := (public.write_ledger(p_org, 'expense', e.amount, 'debit', e.source_domain, 'expense', e.id::text,
                'expense: ' || coalesce(v_cat, e.payee_name, 'uncategorised'), p_actor_id) ->> 'ledger_id')::uuid;
    update public.expenses set status = 'approved', ledger_entry_id = v_led, updated_at = now() where id = e.id;
  elsif v_new = 'rejected' then
    update public.expenses set status = 'rejected', updated_at = now() where id = e.id;     -- NO ledger post
  end if;   -- still 'pending' (multi-tier not yet reached) → expense stays pending, no post

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'finance.expense_decide', 'completed', coalesce(p_actor_id, auth.uid()), 'expense', e.id::text,
            jsonb_build_object('decision', p_decision, 'status', coalesce(v_new,'pending'), 'ledger_entry_id', v_led));
  return jsonb_build_object('expense_id', e.id, 'status', coalesce(v_new, 'pending'), 'ledger_entry_id', v_led, 'approval', v_res);
end; $$;

-- ============================================================================
-- mark_expense_paid — STATUS only (cap expense.manage). NO money movement.
-- ============================================================================
create or replace function public.mark_expense_paid(p_org uuid, p_expense_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'expense.manage') then raise exception 'forbidden' using errcode='42501', detail='expense.manage required'; end if;
  select status into v_status from public.expenses where id = p_expense_id and org_id = p_org for update;
  if v_status is null then raise exception 'expense_not_found' using errcode='P0002'; end if;
  if v_status <> 'approved' then raise exception 'expense_not_approved' using errcode='22023', detail=v_status; end if;
  update public.expenses set status = 'paid', updated_at = now() where id = p_expense_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'finance.expense_paid', 'completed', coalesce(p_actor_id, auth.uid()), 'expense', p_expense_id::text);
  return jsonb_build_object('expense_id', p_expense_id, 'status', 'paid');
end; $$;

-- ============================================================================
-- collections_ageing — READ over the EXISTING invoices (NO new AR table).
-- Outstanding = status='issued' AND coalesce(amount_due,total) > 0, bucketed by
-- age from issued_at. Amounts gated by pnl.view_margin; counts member-visible.
-- ============================================================================
create or replace function public.collections_ageing(p_org uuid, p_as_of date default (now() at time zone 'Asia/Kolkata')::date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; r record;
  c0 int := 0; c1 int := 0; c2 int := 0; c3 int := 0;
  a0 numeric := 0; a1 numeric := 0; a2 numeric := 0; a3 numeric := 0;
  v_age int; v_out numeric;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  for r in
    select coalesce(amount_due, total) as outstanding, (issued_at at time zone 'Asia/Kolkata')::date as idate
    from public.invoices
    where org_id = p_org and status = 'issued' and coalesce(amount_due, total) > 0
  loop
    v_out := r.outstanding; v_age := p_as_of - r.idate;
    if v_age <= 30 then c0 := c0+1; a0 := a0+v_out;
    elsif v_age <= 60 then c1 := c1+1; a1 := a1+v_out;
    elsif v_age <= 90 then c2 := c2+1; a2 := a2+v_out;
    else c3 := c3+1; a3 := a3+v_out;
    end if;
  end loop;

  return jsonb_build_object(
    'as_of', p_as_of, 'can_see_amounts', v_can,
    'buckets', jsonb_build_object(
      '0_30',  jsonb_build_object('count', c0, 'amount', case when v_can then a0 else null end),
      '31_60', jsonb_build_object('count', c1, 'amount', case when v_can then a1 else null end),
      '61_90', jsonb_build_object('count', c2, 'amount', case when v_can then a2 else null end),
      '90_plus', jsonb_build_object('count', c3, 'amount', case when v_can then a3 else null end)),
    'total_count', c0+c1+c2+c3,
    'total_outstanding', case when v_can then a0+a1+a2+a3 else null end);
end; $$;

-- ── grants ────────────────────────────────────────────────────────────────--
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_expense_category(uuid,text,uuid,uuid)',
    'record_expense(uuid,numeric,date,uuid,uuid,text,text,numeric,text,text,uuid,uuid)',
    'submit_expense(uuid,uuid,int,uuid,uuid)',
    'decide_expense(uuid,uuid,text,uuid)',
    'mark_expense_paid(uuid,uuid,uuid)',
    'collections_ageing(uuid,date)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
