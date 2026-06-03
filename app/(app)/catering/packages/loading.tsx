import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for catering packages — header → intake → list. */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Skeleton style={{ width: 80, height: 12 }} />
        <Skeleton style={{ width: 200, height: 30, marginTop: 10 }} />
        <Skeleton style={{ width: 360, height: 16, marginTop: 10 }} />
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <Card><Skeleton style={{ width: '35%', height: 22 }} /></Card>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 24 }} />)}</div></Card>
      </div>
    </div>
  );
}
