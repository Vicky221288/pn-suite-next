import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for folios — header → stacked folio cards (charges + total). */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Skeleton style={{ width: 70, height: 12 }} />
        <Skeleton style={{ width: 180, height: 30, marginTop: 10 }} />
        <Skeleton style={{ width: 400, height: 16, marginTop: 10 }} />
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        {[0, 1].map((i) => (
          <Card key={i}>
            <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
              <Skeleton style={{ width: '45%', height: 22 }} />
              {[0, 1, 2].map((j) => <Skeleton key={j} style={{ height: 20 }} />)}
              <Skeleton style={{ height: 36, marginTop: 8 }} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
