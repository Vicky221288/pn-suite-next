import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for an enquiry detail — mirrors header → spine → actions/info. */
export default function Loading() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <div>
        <Skeleton style={{ width: 80, height: 14 }} />
        <Skeleton style={{ width: 240, height: 30, marginTop: 12 }} />
        <Skeleton style={{ height: 2, marginTop: 16 }} />
      </div>
      <Card><Skeleton style={{ width: '70%', height: 24 }} /></Card>
      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        <Card><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 34 }} />)}</div></Card>
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card><div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div></Card>
          <Card><div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>{[0, 1].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div></Card>
        </div>
      </div>
    </div>
  );
}
