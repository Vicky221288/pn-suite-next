import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for reservations — header → summary strip → intake → grid. */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Skeleton style={{ width: 70, height: 12 }} />
        <Skeleton style={{ width: 240, height: 30, marginTop: 10 }} />
        <Skeleton style={{ width: 380, height: 16, marginTop: 10 }} />
      </div>
      <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 'var(--space-6)' }}>
        {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 116 }} />)}
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <Card><Skeleton style={{ width: '35%', height: 22 }} /></Card>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 28 }} />)}</div></Card>
      </div>
    </div>
  );
}
