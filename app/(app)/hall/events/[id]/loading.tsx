import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/** Loading scaffold for a hall event — header → roster → checklists → vendors. */
export default function Loading() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <div>
        <Skeleton style={{ width: 110, height: 14 }} />
        <Skeleton style={{ width: 200, height: 30, marginTop: 12 }} />
        <Skeleton style={{ height: 2, marginTop: 16 }} />
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i}><div className="flex flex-col" style={{ gap: 'var(--space-3)' }}><Skeleton style={{ width: '40%', height: 20 }} />{[0, 1].map((j) => <Skeleton key={j} style={{ height: 20 }} />)}</div></Card>
      ))}
    </div>
  );
}
