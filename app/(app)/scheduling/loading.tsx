import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for scheduling — header → shift board → rosters → templates. */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Skeleton style={{ width: 90, height: 12 }} />
        <Skeleton style={{ width: 200, height: 30, marginTop: 10 }} />
        <Skeleton style={{ width: 400, height: 16, marginTop: 10 }} />
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <Card>
          <div className="grid" style={{ gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 120 }} />)}
          </div>
        </Card>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 24 }} />)}</div></Card>
      </div>
    </div>
  );
}
