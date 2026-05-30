# The 5-Step Pre-Flight Schema Discipline

**Standing rule (carried from rhs-crm-next R-005, OP MODEL §10): before writing
ANY new mutation/RPC or schema change, run all five steps. No exceptions.**

The legacy PN build shipped non-atomic client writes against an under-constrained
schema (AUDIT-2.0 L4/L5). This discipline + the wrapper+RPC pattern (OP MODEL
inv. #1) is how that class of bug is made structurally impossible.

Run these read-only queries (Supabase SQL editor or `psql`) against the target
table **before** authoring the action/RPC:

```sql
-- 1. Column shape
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '<target>'
ORDER BY ordinal_position;

-- 2. One real row (understand the actual data, not the assumed shape)
SELECT * FROM <target> LIMIT 1;

-- 3. RLS policies (know what the user-client can and can't do)
SELECT pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid)     AS using_clause,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = '<target>';

-- 4. Value-shape audit (≥100 rows — find the messy real-world values)
SELECT <suspect_column>, COUNT(*)
FROM <target>
GROUP BY <suspect_column>
ORDER BY COUNT(*) DESC
LIMIT 20;

-- 5. High-volume smoke (after the migration, before declaring done)
SELECT COUNT(*), MIN(<col>), MAX(<col>) FROM <target>;
```

## Multi-tenant additions (PN-specific, OP MODEL §10)
- **Every** table carries `org_id` and is covered by tenant-scoped RLS. Step 3
  must confirm the policy isolates by `org_id`, not just by role.
- **Every** admin-client write (RLS bypassed) MUST filter by `org_id`. A missing
  `org_id` is a cross-tenant leak (AUDIT-2.0 F-SEC-04) — verify in code review.
- Prefer an **atomic Postgres RPC** (`SECURITY INVOKER`, or `DEFINER` with an
  explicit `org_id` check) over raw multi-statement writes from the action.

## The `audit_log` table (referenced by lib/audit/emit.ts)
Created in the schema phase. Expected shape (wide, purpose-built — not the
legacy jam-into-jsonb pattern RHS used):

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| org_id | uuid null | tenant scope (null only for pre-tenant system events) |
| action | text | e.g. 'booking.confirm' |
| sub_event | text | 'attempted' \| 'completed' \| 'failed' |
| actor_id | uuid null | auth user |
| entity_type | text null | |
| entity_id | text null | |
| parent_audit_id | uuid null | links completed/failed → attempted |
| meta | jsonb null | structured, non-PII context |
| error_code | text null | |
| error_message | text null | |
| created_at | timestamptz default now() | |
