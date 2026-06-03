import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for a kitchen ticket — header → actions → requirement (left) + dishes (right). */
export default function Loading() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <div>
        <Skeleton style={{ width: 120, height: 14 }} />
        <Skeleton style={{ width: 240, height: 30, marginTop: 12 }} />
        <Skeleton style={{ height: 2, marginTop: 16 }} />
      </div>
      <Card><Skeleton style={{ width: '50%', height: 22 }} /></Card>
      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 22 }} />)}</div></Card>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div></Card>
      </div>
    </div>
  );
}
