import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for purchase orders — header → per-supplier cards. */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Skeleton style={{ width: 80, height: 12 }} />
        <Skeleton style={{ width: 240, height: 30, marginTop: 10 }} />
        <Skeleton style={{ width: 360, height: 16, marginTop: 10 }} />
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        {[0, 1].map((i) => (
          <Card key={i}><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}><Skeleton style={{ width: '40%', height: 20 }} />{[0, 1, 2].map((j) => <Skeleton key={j} style={{ height: 20 }} />)}</div></Card>
        ))}
      </div>
    </div>
  );
}
