# PN Master Suite

Multi-tenant hospitality operating system for banquet-halls-with-rooms.
**Next.js 15 · Supabase · Vercel · TypeScript.**

> Rebuild of the legacy React/Vite build (audited 45/100). See `CLAUDE.md` and
> `docs/` for the operating model, build plan, and conventions. This is **Phase
> B0** of the foundation wave.

## Getting started

```bash
npm install
cp .env.example .env.local      # fill with PN's own Supabase project values
npm run dev                     # http://localhost:3000
```

## Scripts
| command | what it does |
|---|---|
| `npm run dev` | local dev server |
| `npm run build` | production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (next) |
| `npm run verify` | typecheck + lint + build (the CI gate) |
| `npm run check:contrast` | WCAG AA check on the design-token pairs |

## Conventions (the short version)
- **Every write** goes through `lib/actions/wrapper.ts` (the `ActionResult<T>`
  server-action wrapper) around a **single atomic Postgres RPC**. No multi-step
  client writes.
- **Reads** use the RLS-enforced user client; **writes** use the `'server-only'`
  admin client after authorization, always scoped by `org_id`.
- **No hardcoded single-property values** — multi-tenant from day one.
- **CC never pushes or deploys.** Quality gate (CI) must be green first.

See `CLAUDE.md` for the full posture and `docs/PRE-FLIGHT-5-STEP.md` before any
schema change.
