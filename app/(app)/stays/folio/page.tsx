import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FolioManager } from '@/components/folio-manager';

interface Charge { id: string; charge_type: string; description: string | null; amount: number }
interface Stay { id: string; check_in: string; check_out: string; status: string; rate_quoted: number; guests: { name: string } | null; rooms: { number: string } | null; folio_charges: Charge[] }

/** Stays — folios: charges, F&B, settle → invoice. */
export default async function FolioPage() {
  const supabase = await createClient();
  const { data: stays } = await supabase
    .from('room_stays')
    .select('id, check_in, check_out, status, rate_quoted, guests(name), rooms(number), folio_charges(id, charge_type, description, amount)')
    .in('status', ['checked_in', 'checked_out', 'settled'])
    .order('check_in', { ascending: false })
    .limit(60);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/stays" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Rooms</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Stays — Folios</h1>
      <FolioManager stays={(stays ?? []) as unknown as Stay[]} />
    </div>
  );
}
