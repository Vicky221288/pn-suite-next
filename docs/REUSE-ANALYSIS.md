# RHS CRM NXT → PN RE-PLATFORM — REUSE LEVERAGE ANALYSIS
**Closes the `[INFERRED]` gap in `AUDIT-2.0.md` §11.4 with first-hand evidence**

- **Reference repo read:** `~/Desktop/rhs-crm-next` (Next.js **15.5.18** App Router, React **19.1**, `@supabase/ssr`, Tailwind **v4**, zustand, framer-motion, CVA, lucide). Read-only — zero files modified in either repo.
- **PN target (Option B):** Next.js 15 + Supabase + Vercel, **true multi-tenant (`org_id` row isolation)**, white-label, hospitality event-spine. PN's stated top needs: convert non-atomic client writes → atomic Postgres RPCs; real WhatsApp/automation; per-tenant theming.
- **Method:** three specialist agents read the actual code (auth/RLS/audit; shell/today/design; data-access/integrations/deploy), each citing `path:line`. Chair verified the load-bearing claims against the repo's own CLAUDE.md and migrations.

> **Verdict up front — and it corrects the audit's inference.** AUDIT-2.0 §11.4 inferred RHS would let PN "lift the multi-tenant security pattern off the shelf" and save "3–6 weeks." **That inference was too optimistic on the substance.** RHS is a *single-org, multi-project* CRM — it never built tenant isolation, atomic writes, real integrations, or cron, which are exactly PN's hardest, highest-risk pieces. What RHS genuinely gives is a **stack-identical foundation of plumbing and conventions** (SSR auth, dual-client trust model, two-write audit, server-action contract, approval-flow pattern, IST utils, design-token architecture, command palette). That is real and worth lifting — but it accelerates the *scaffolding*, not the *risk*.

---

## 0. Three premise corrections (state these plainly)

| AUDIT-2.0 / brief assumed | Reality in the repo | Evidence |
|---|---|---|
| RHS has a **multi-tenant `org_id`** model PN can template | **Single-org / multi-project.** No `org_id`/`tenant`/`organization` anywhere; RLS isolates by role + agent-name; `is_md()`/`is_md_or_director()` are **hardcoded person-UUIDs**; `project_id` = RHS's own projects (1=RW, 4=RCSC) | `grep org_id` → 0 hits in `supabase/migrations/20260528091803_remote_schema.sql`; `20260528202817_d1_tx1b_rls_md_helpers.sql:32-53`; many `_select … USING (true)` |
| RHS has **real MCube call + WhatsApp** send PN can lift | **Both stubbed.** `mcube/client.ts` returns synthetic `stub_<ts>` callId; `whatsapp.ts` has `const ENGAGE_AVAILABLE = false` → `wa.me` deep-link. **Parity with PN, not ahead** | `lib/mcube/client.ts:23-36`; `lib/actions/whatsapp.ts:151,160-165` |
| RHS has a **server-side atomic write / RPC** pattern (PN's #1 need) | **Zero `.rpc()`, zero transactions.** Multi-step writes are sequential admin-client calls; RHS documents its *own* orphan-data bug | `grep "\.rpc("` → 0 hits; `lib/actions/cost_sheet.ts:360-366` ("we don't roll back the snapshot") |

Also note: `@tanstack/react-query`, `react-table`, `react-virtual`, and `zod` are in `package.json` but **never imported** (lists are hand-rolled `<ol>/<li>`, validation is hand-rolled, refresh is `router.refresh()`). "Side Effect Tags" are emitted by every action but **consumed by nothing** — they're audit metadata, not a refresh bus.

---

## 1. REUSE SCORECARD

Ratings: **LIFT** (copy ~as-is) · **ADAPT** (port w/ changes) · **REFERENCE** (pattern only) · **NOT REUSABLE**.

| # | Capability | Rating | Evidence (path) | Effort saved | Caveats |
|---|---|---|---|---|---|
| 1 | **Supabase SSR auth wiring** (login, session, middleware refresh) | **LIFT** | `lib/supabase/{client,server,middleware}.ts`, root `middleware.ts`, `app/login/login-form.tsx:34-47` | ~3–5 d | Synthetic-email hack `${phone}@rhs.crm` hardcoded in 3 spots; the inline role-gating block in middleware is RHS-specific |
| 2 | **Dual Supabase-client trust model** (RLS-enforced user client for reads, `'server-only'` service-role admin client for writes) | **LIFT** (file) / **ADAPT** (policy) | `lib/supabase/admin.ts:1,26-43` | ~2–4 d | **Service-role bypasses ALL RLS — dangerous under `org_id`**: every admin write becomes a cross-tenant-leak site if an `org_id` filter is missed. PN should prefer org-checked RPCs over blanket bypass |
| 3 | **Two-write audit pattern** (`attempted`→`completed`/`failed` + `parent_audit_id`) | **LIFT** (pattern) / **ADAPT** (impl) | `lib/audit/emit.ts`, `lib/actions/audit.ts:31-84`, `lib/actions/types.ts:74-86` | ~3–5 d | RHS jams fields into a legacy 10-col `audit_log` (parent id stuffed in jsonb); build the wide schema properly. Audit write is non-atomic w/ the mutation — fold into the RPC |
| 4 | **Server-action contract** (`'use server'`, discriminated `ActionResult<T>`, auth→validate→permission→audit→mutate→audit) | **ADAPT** | `lib/actions/{lead,site_visit,payment,call}.ts`, `types.ts:35-54`, `index.ts` | ~1.5–2 d | Validation hand-rolled (adopt zod — it's already a dep); `resolveOwnerManager` copy-pasted across 5 files; bodies are RHS domain |
| 5 | **Multi-tier approval flow** (generic `approval_requests` table, request→recommend→decide, state guards, anti-self-approval) | **ADAPT** | `lib/actions/{cost_sheet_request,cost_sheet_recommend,approval}.ts`, `lib/team.ts:26`; DB CHECK `20260528123448_…:22-34` | ~2–3 d | Best structural fit for PN expense-approval + settlement; re-key off tenant+role, drop hardcoded MD UUIDs, make the decision+ledger write atomic |
| 6 | **Role-context resolution architecture** (auth→team row→typed role→`VisibleScope{own/team/all}`, `requireRoleContext()` guard) | **ADAPT** (shape) / **REFERENCE** (values) | `lib/auth/{context,roles,hierarchy}.ts` (`context.ts:10-99`, `roles.ts:48-79`) | ~1 wk | All values RHS-specific (level/type/name-substring, literal "Vignesshwar"); `getRoleContext` must become **org-aware**; phone-last-10 `like '%…'` collides across tenants |
| 7 | **RLS helper + policy idioms** (`SECURITY DEFINER STABLE SET search_path=''`, per-command split policies, `ALTER POLICY` zero-gap swaps, anti-self-approval as DB CHECK) | **REFERENCE** | `remote_schema.sql:55-133`, `20260528202817_…:21-53` | ~2–3 d (learning) | Every policy is single-org (role/name) or `USING(true)`; **all must gain `org_id = current_org()`**; the `USING(true)` reads are net-negative to copy |
| 8 | **App shell + responsive nav + role→page guard** | **ADAPT** | `components/shell/{AppShell,Sidebar,MobileBottomTab}.tsx`, `app/(app)/layout.tsx:10-29`, `lib/auth/hierarchy.ts:7-48` | ~70% of shell | Nav items + role model are RHS; keep mechanism (role→allowed pages→filtered nav→composition key), rewrite data |
| 9 | **`/today` composition pattern** (role→composition key→bespoke server-component, header/footer primitives, "as of HH:MM IST", `Promise.all` fetch) | **ADAPT** (LIFT primitives) | `app/(app)/page.tsx:32-51`, `lib/today/composition-route.ts:20-88`, `components/today/primitives/*` | ~60% | This directly answers PN's "17-card browse wall → command surface." Composition **bodies** + all `lib/today/queries.ts` (~2,200 LOC) are RHS sales domain — REFERENCE only |
| 10 | **IST date utils** (`formatISTTime`, `todayISTBounds/week/month`; manual format to dodge SSR hydration bug) | **LIFT (verbatim)** | `lib/today/date-utils.ts:58-139` | ~2–3 d | Tenant-agnostic; PN is also IST/Chennai. **Directly fixes AUDIT-2.0 `F-DATA-02` (UTC→IST bug)** |
| 11 | **Severity engine** (count→Calm/Caution/Warning/Critical + time-of-day EOD escalation, const-lookup, "tenant-config-ready") | **LIFT** | `lib/today/severity.ts:37-101` | ~2–3 d | Author explicitly built it for white-label threshold externalization; PN edits thresholds in one file |
| 12 | **Intervention/approval queue UI** (count-badged, severity-toned, keyboard-nav, row actions, decision modal) | **ADAPT** | `components/today/intervention-queue-widget.client.tsx:52-173`, `modals/ApprovalDecisionModal.tsx:35-233` | ~55% | Prop API already generic; the row *actions* (mcube/WhatsApp/cost-sheet) are RHS. Maps to PN "money-to-collect / overdue follow-ups / pending approvals" |
| 13 | **Design-token architecture** (Tailwind v4 `@theme` semantic CSS vars: `acc`, `t1..t5`, heat tones, `hair`; components never use raw hex) | **LIFT (re-value to maroon)** | `app/globals.css:19-101` | ~80% of DS scaffolding | Ideal for a re-skin: change var values, components unchanged. Naming cryptic (`t1`/`acc`/`hair`) — alias if desired |
| 14 | **Command palette + ⌘K + keyboard-nav hook** | **LIFT** | `components/command-palette/*`, `lib/hooks/use-keyboard-nav.ts:50-110`, `lib/hooks/use-debounce.ts` | ~85% | Palette is route-jumper only; swap the routes array. Keyboard hook is reuse-designed |
| 15 | **`ui/` component library breadth** (Button/Pill/Money/Toaster) | **LIFT (what exists) + BUILD-OUT** | `components/ui/{button,pill,money,toaster}.tsx`, `lib/utils.ts:8-16` (`formatINR` L/Cr) | ~25% | Only **4** components. **No Card/Input/Select/Dialog/Table/Tabs/Tooltip/Skeleton in `ui/`** — forms/dialogs are hand-rolled inline. Budget a real DS build-out |
| 16 | **Migration discipline** (`supabase` CLI, tracked migrations, `db push`/`migration list` runbook + `verify.sh`, `.gitignore` tracks migrations) | **ADAPT** | `supabase/config.toml`, `scripts/tx1b/*`, `.gitignore:55-67` | ~1 d | Operational hygiene worth emulating; the migrations *content* is RHS |
| 17 | **Atomic multi-step writes (Postgres RPC/transaction)** — PN's #1 need | **NOT REUSABLE** | `grep "\.rpc("`→0; `cost_sheet.ts:360-366`, `approval.ts:162-168`, `site_visit.ts:137-174` | **0 (negative)** | RHS has the *same* orphan-data anti-pattern; copying it propagates the bug |
| 18 | **`org_id` multi-tenant isolation** | **NOT REUSABLE** | No tenant entity; `is_md()` hardcoded UUIDs | **0** | Net-new: add `org_id` to every table + `current_org()` helper + `org_id` term in every USING/WITH CHECK + provisioning |
| 19 | **MCube call + WhatsApp send** | **NOT REUSABLE** (template-registry shape only = REFERENCE) | `mcube/client.ts:23-36`, `whatsapp.ts:32-69,151` | ~0.5 d (template map shape) | Both stubbed; no delivery tracking/webhook/idempotency. PN at parity |
| 20 | **Cron / scheduled jobs / webhooks / route handlers** | **NOT REUSABLE / ABSENT** | `find app -name route.ts`→none; no Vercel cron; `supabase/functions/` absent; SLA derived at read-time | **0** | PN's hold-expiry sweeper + follow-up SLA are fully greenfield |
| 21 | **TanStack Query/Table/Virtual + Side-Effect-Tag refresh** | **NOT REUSABLE** (unused) | `grep useQuery|useReactTable|useVirtualizer`→0; `grep sideEffect` consumers→0 | 0 | Installed, never wired. Refresh = `router.refresh()`. PN builds its cache/refresh layer fresh |
| 22 | **Error-state UI** (distinct skeleton/empty/error) | **NOT REUSABLE** (overstated) | no `ErrorState`, no `error.tsx`; failures swallowed to empty (`lib/today/queries.ts:1-5`) | 0 | Empty and error render identically; PN builds a true error surface |
| 23 | **Deploy / CI config** | **NOT REUSABLE** (absent) | no `vercel.json`, empty `next.config.ts`, scripts only `dev/build/start/lint`, no tests/CI | 0 | Greenfield; PN also moves off Cloudflare → Vercel (net-new decision) |
| 24 | **PII encryption / DPDP controls** | **NOT REUSABLE** (absent) | leads store phone plaintext, matched on (`remote_schema.sql:145`) | 0 | RHS offers nothing for AUDIT-2.0 `F-SEC-02`; net-new |

---

## 2. THE "LIFT THIS FIRST" SHORTLIST (highest-leverage, most compresses the foundation wave)

1. **The whole `@supabase/ssr` auth spine + dual-client trust model + middleware** (`#1`, `#2`). Stack-identical, current, hard to get right — this is the cleanest, highest-confidence lift and removes the riskiest "did we wire SSR auth correctly" uncertainty from PN's Wave B. *~1 week.*
2. **`lib/today/date-utils.ts` + `lib/today/severity.ts` verbatim** (`#10`, `#11`). Both tenant-agnostic, IST-correct, hydration-bug-hardened, and explicitly built for white-label thresholds. The date-utils lift **also closes AUDIT-2.0 `F-DATA-02`** (the UTC-vs-IST "today" bug) for free. *~1 week of hard-won code.*
3. **The design-token architecture (`@theme` semantic CSS vars) + Button/Pill/Money + command palette + keyboard-nav** (`#13`, `#14`, `#15-partial`). Re-value the vars to maroon Meridian and the component layer is unchanged; the palette and keyboard hook are near-verbatim. *~1–1.5 weeks of UI scaffolding.*
4. **The server-action contract + two-write audit + multi-tier approval pattern** (`#3`, `#4`, `#5`). Adopt the `ActionResult<T>` shape, the audit `attempted/completed/failed` discipline, and the generic `approval_requests` state machine as the **template every PN mutation and the expense/settlement approvals follow** — *but* wrap each around an **atomic RPC** (see §3) rather than RHS's sequential writes. *~1 week.*
5. **The `/today` composition router + header/footer primitives + intervention-queue widget shell** (`#9`, `#12`). The pattern (role→composition key→bespoke server component with severity-toned, count-badged action queues) is the proven cure for PN's "17-card browse wall." Lift the skeleton; write hospitality bodies. *~1 week of architecture you don't have to invent.*

---

## 3. GAPS RHS CRM NXT DOES **NOT** SOLVE FOR PN (full greenfield — budget accordingly)

These are, not coincidentally, PN's **highest-risk** items — RHS gives no head start on any of them:

1. **Atomic server-side writes (Postgres RPCs/transactions).** PN's #1 reason to re-platform. RHS has *zero* RPCs and its own documented orphan-data bug. PN must author `plpgsql` functions for enquiry→event conversion and settlement and call them via `supabase.rpc()` inside the action wrapper. *Net-new, core, ~1–2 wk.*
2. **True multi-tenant `org_id` isolation.** No tenant entity exists; RLS isolates by role/name with hardcoded UUIDs. PN must add `org_id` to every table, a `current_org()` helper, an `org_id` term in every RLS policy, and org-scoped role resolution + provisioning. *Net-new, gating, ~1–2 wk.* (This is the AUDIT-2.0 `F-SEC-04`/`F-PROD-01` retrofit — confirmed unbuildable-by-copy.)
3. **Per-tenant white-label theming.** RHS theming is binary light/dark via `[data-theme]` CSS vars baked into `globals.css` — runtime-switchable but **not per-tenant**. PN must add a server-injected per-tenant `:root` style block from tenant config. *~0.5–1 wk beyond the lifted light/dark.*
4. **Real WhatsApp/call integration + delivery tracking + webhooks.** Both stubbed in RHS. PN's WhatsApp-API send (the core of its efficiency thesis) is greenfield. *~1–2 wk.*
5. **Scheduled jobs / cron** (hold-expiry sweeper, follow-up SLA firing). No cron/edge-function/route-handler pattern exists. *Net-new, ~few days–1 wk.*
6. **A complete component library** (forms, dialogs, cards, tabs, tables, tooltips) — RHS `ui/` has only 4 components. *~1 wk.*
7. **A true error-state surface** — RHS swallows failures into empty states. *~few days.*
8. **PII encryption / DPDP controls, billing/subscription/entitlements, the hospitality event-spine itself** — none have any analogue in a real-estate CRM. *Net-new (billing + spine are Wave C/D regardless).*
9. **CI / tests / deploy config** — none exist. *Greenfield.*

---

## 4. REVISED FOUNDATION-WAVE ESTIMATE

**Scope of "foundation wave" (AUDIT-2.0 Wave B):** org/tenant layer + tenant-scoped RLS + per-property counters + runtime theming + server-compute substrate (Edge/cron) + atomic-RPC pattern + app shell + auth + the `/today` command surface + design system.

| | **From scratch** | **With RHS reuse** | What reuse buys |
|---|---|---|---|
| Auth SSR + dual-client + middleware | ~1.5 wk | ~0.5 wk | LIFT (#1,#2) |
| App shell + nav + role guard | ~1 wk | ~0.3 wk | ADAPT (#8) |
| `/today` command surface + primitives + IST + severity | ~2.5 wk | ~1 wk | ADAPT + LIFT (#9–#12) |
| Design system (tokens + components) | ~2 wk | ~1 wk | token arch LIFT, components build-out (#13,#15) |
| Server-action contract + audit + approval pattern | ~1.5 wk | ~0.7 wk | ADAPT (#3,#4,#5) |
| **`org_id` isolation + tenant-scoped RLS** | ~1.5 wk | ~1.5 wk | **no help** |
| **Atomic RPC pattern (spine writes)** | ~1.5 wk | ~1.5 wk | **no help** |
| **Per-tenant theming + cron substrate + error surface** | ~2 wk | ~1.7 wk | minor |
| **Subtotal (foundation)** | **~13.5 wk** | **~8.2 wk** | |

**Honest bottom line: RHS reuse compresses the foundation wave by roughly 4–5 calendar-weeks of plumbing/UI scaffolding (~35%) — meaningfully less than the "3–6 weeks of *security pattern*" §11.4 inferred, and on different things.** The reuse lands almost entirely on *conventions and scaffolding* (auth, audit, action shape, tokens, today-pattern, IST utils). The **critical-path risks** — atomic writes, tenant isolation, real integrations, cron — get **zero acceleration**, so schedule risk is barely reduced even though calendar time drops. Plan the reuse as "we don't reinvent the plumbing," not "the hard parts are de-risked."

Single most valuable reuse decision: **adopt RHS's server-action + audit + approval contract as the wrapper, but put an atomic Postgres RPC inside it** — that combines RHS's best convention with the exact thing RHS got wrong, and is the cheapest way to avoid inheriting its orphan-data bug.

---

## 5. HONESTY MARKERS

- **All `path:line` references are first-hand** from `~/Desktop/rhs-crm-next`; the three premise corrections in §0 (no multi-tenancy, stubbed integrations, no RPCs) are each backed by a `grep`-level absence proof plus a positive citation. This section is **no longer `[INFERRED]`** — it supersedes AUDIT-2.0 §11.4.
- **AUDIT-2.0 §11.4 is now known to have been optimistic** on two counts: it inferred a liftable multi-tenant security pattern (does not exist) and implied RHS's MCube/WhatsApp were real (stubbed). The auth/RLS *hygiene* and audit *pattern* it credited are real; the *isolation model* and *integrations* are not.
- **Effort estimates (days/weeks) are `[INFERRED]`** engineering judgment, not measured — they assume one experienced full-stack engineer fluent in the stack and will shift with team familiarity. Treat the *ratios* (reuse vs scratch) as firmer than the absolute weeks.
- **Not exhaustively read:** the full `lib/today/queries.ts` (~2,200 LOC) and all 8 composition bodies were sampled, not line-by-line — but they are rated REFERENCE-only (RHS sales domain), so depth there doesn't change the verdict. The `~/Desktop/rhs-docs/migration-atlas/` (13 volumes referenced by RHS's CLAUDE.md) was **not** read — it is design spec, not reusable code, and lives outside both repos.
- **One thing to re-verify before committing:** whether PN wants to keep RHS's **phone + synthetic-email** auth convention (`${phone}@rhs.crm`) or move to email — it's baked into 3 files and affects the §1 lift's cleanliness.

---

REUSE ANALYSIS COMPLETE — REUSE-ANALYSIS.md written · 24 capabilities rated · zero files changed.
