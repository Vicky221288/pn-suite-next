import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for an invoice — header → lines → tax summary (left) + totals (right). */
export default function Loading() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <div>
        <Skeleton style={{ width: 200, height: 14 }} />
        <Skeleton style={{ width: 220, height: 30, marginTop: 12 }} />
        <Skeleton style={{ height: 2, marginTop: 16 }} />
      </div>
      <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 22 }} />)}</div></Card>
      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1].map((i) => <Skeleton key={i} style={{ height: 22 }} />)}</div></Card>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div></Card>
      </div>
    </div>
  );
}
