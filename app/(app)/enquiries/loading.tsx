import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for the enquiries list — mirrors the header → stats → grid layout. */
export default function Loading() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <div>
        <Skeleton style={{ width: 90, height: 12 }} />
        <Skeleton style={{ width: 180, height: 30, marginTop: 8 }} />
        <Skeleton style={{ width: 320, height: 14, marginTop: 10, maxWidth: '80%' }} />
      </div>
      <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 104, borderRadius: 'var(--card-radius)' }} />)}
      </div>
      <Card padded={false} title="All enquiries">
        <div className="flex flex-col" style={{ padding: 'var(--card-pad)', gap: 'var(--space-3)' }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} style={{ height: 36 }} />)}
        </div>
      </Card>
    </div>
  );
}
