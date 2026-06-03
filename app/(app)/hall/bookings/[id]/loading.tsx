import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for a hall booking — header → contract → milestones. */
export default function Loading() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <div>
        <Skeleton style={{ width: 80, height: 14 }} />
        <Skeleton style={{ width: 240, height: 30, marginTop: 12 }} />
        <Skeleton style={{ height: 2, marginTop: 16 }} />
      </div>
      <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}><Skeleton style={{ width: '60%', height: 22 }} />{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div></Card>
      <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 22 }} />)}</div></Card>
    </div>
  );
}
