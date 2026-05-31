import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewEnquiryForm } from '@/components/new-enquiry-form';

/** Enquiries list — RLS-scoped reads (a member sees only their org's leads). */
export default async function EnquiriesPage() {
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, function_area, status, escalated_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Enquiries</h1>

      <section style={card}>
        <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>New enquiry</h2>
        <NewEnquiryForm />
      </section>

      <section style={card}>
        {(leads ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No enquiries yet.</p>
        ) : (
          <ol className="flex flex-col">
            {(leads ?? []).map((l) => (
              <li key={l.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/enquiries/${l.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{l.name ?? '—'} <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{l.phone}</span></span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{l.function_area}</span>
                    {l.escalated_at && <Tag bg="--color-danger-bg" fg="--color-danger">SLA</Tag>}
                    <Tag bg="--color-brand-subtle" fg="--color-brand">{l.status}</Tag>
                  </span>
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
function Tag({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span className="text-xs" style={{ background: `var(${bg})`, color: `var(${fg})`, borderRadius: 'var(--radius-full)', padding: '2px 8px' }}>{children}</span>;
}
