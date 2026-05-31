import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewGuestForm } from '@/components/new-guest-form';
import { GuestSearch } from '@/components/guest-search';

/** Guests — shared-core identity. RLS-scoped list + search-by-name/phone. */
export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from('guests')
    .select('id, name, phone, email, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(100);
  if (q && q.trim()) query = query.or(`name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`);
  const { data: guests } = await query;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Guests</h1>

      <section style={card}>
        <h2 style={h2}>New guest</h2>
        <NewGuestForm />
      </section>

      <section style={card}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 style={{ ...h2, margin: 0 }}>Directory</h2>
          <GuestSearch initial={q ?? ''} />
        </div>
        {(guests ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{q ? 'No matches.' : 'No guests yet.'}</p>
        ) : (
          <ol className="flex flex-col">
            {(guests ?? []).map((g) => (
              <li key={g.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/guests/${g.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{g.name}</span>
                  <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{g.phone}{g.email ? ` · ${g.email}` : ''}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
