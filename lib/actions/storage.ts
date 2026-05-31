'use server';
import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { type ActionResult, err, ok } from './types';

const BUCKET = 'proof-photos';
const SIGNED_URL_TTL = 60; // seconds — short-lived; never a public link

/**
 * Short-lived SIGNED URL for a proof photo. RLS on storage.objects already gates
 * by org; this also refuses to sign a path outside the caller's org (defence in
 * depth). The bucket is private — there are no public links.
 */
export async function getProofPhotoUrl(path: string): Promise<ActionResult<string>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  if (!path || !path.startsWith(`${ctx.orgId}/`)) return err('forbidden', 'Photo is outside your org.');
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return err('not_found', error?.message ?? 'Could not sign URL.');
  return ok(data.signedUrl);
}
