-- ============================================================================
-- KL-3 — STORAGE for checklist/housekeeping PHOTO-PROOF
-- ----------------------------------------------------------------------------
-- A PRIVATE Supabase Storage bucket `proof-photos` + org-scoped RLS on
-- storage.objects so a member can only read/write proof photos within their own
-- org. Object path is keyed by org: `{org_id}/{entity}/{id}/{file}` — the first
-- path segment is the org_id, and the policies gate on
-- is_org_member((storage.foldername(name))[1]::uuid) — the SAME tenant isolation
-- as every other entity. Photos are served via short-lived SIGNED URLs (the
-- bucket is private; never public links). The W2/S3 photo-proof GATE is
-- unchanged — completion still requires a non-empty photo_ref; that ref is now a
-- real object key. (Binary uploads go browser→Storage under RLS; the photo_ref
-- metadata write still goes through the action-layer complete RPC.)
-- ============================================================================

-- ── private bucket (NOT public) — image-only, 10 MB cap ──────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('proof-photos', 'proof-photos', false, 10485760,
          array['image/png','image/jpeg','image/webp','image/heic'])
  on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ── org-scoped RLS on storage.objects (RLS is already enabled by Supabase) ───
--    First path segment = org_id → is_org_member gates read/write per tenant.
drop policy if exists proof_photos_member_select on storage.objects;
create policy proof_photos_member_select on storage.objects for select to authenticated
  using (bucket_id = 'proof-photos' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists proof_photos_member_insert on storage.objects;
create policy proof_photos_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'proof-photos' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists proof_photos_member_update on storage.objects;
create policy proof_photos_member_update on storage.objects for update to authenticated
  using (bucket_id = 'proof-photos' and public.is_org_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'proof-photos' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists proof_photos_member_delete on storage.objects;
create policy proof_photos_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'proof-photos' and public.is_org_member(((storage.foldername(name))[1])::uuid));
