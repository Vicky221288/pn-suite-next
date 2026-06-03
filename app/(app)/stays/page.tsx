import { BedDouble, DoorClosed } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { RoomAdmin } from '@/components/room-admin';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Board, BoardCell } from '@/components/ui/board';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface RoomType { id: string; name: string; base_rate: number }
interface Room { id: string; number: string; name: string | null; status: string; room_types: { name: string } | null }

/** Stays — room inventory (types + rooms + placeholder status). */
export default async function StaysPage() {
  const supabase = await createClient();
  const { data: typesData } = await supabase.from('room_types').select('id, name, base_rate').order('name');
  const { data: roomsData } = await supabase.from('rooms').select('id, number, name, status, room_types(name)').order('number');
  const types = (typesData ?? []) as RoomType[];
  const rooms = (roomsData ?? []) as unknown as Room[];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Stays"
        title="Rooms"
        subtitle="Room inventory and nightly rates. Rates are config-driven; GST is applied at the folio, never stored on the room."
        meta={`${rooms.length} room${rooms.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <CreatePanel label="Add room or type" title="Add a room type or room">
          <RoomAdmin types={types} />
        </CreatePanel>

        <Card title="Rooms" subtitle={`${rooms.length} in inventory`}>
          {rooms.length === 0 ? (
            <EmptyState icon={BedDouble} title="No rooms yet" message="Add a room type with its nightly rate, then add rooms of that type. They'll appear here and on the housekeeping board.">
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Use <b style={{ color: 'var(--color-text-secondary)' }}>Add room or type</b> above.</span>
            </EmptyState>
          ) : (
            <Board>
              {rooms.map((r) => (
                <BoardCell
                  key={r.id}
                  title={`#${r.number}`}
                  accent={r.status === 'available' ? 'success' : 'neutral'}
                  top={<Badge tone={r.status === 'available' ? 'success' : 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge>}
                >
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{r.room_types?.name ?? '—'}</div>
                  {r.name && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{r.name}</div>}
                </BoardCell>
              ))}
            </Board>
          )}
        </Card>

        <Card padded={false} title="Room types &amp; rates" subtitle="Config-driven · GST applied at folio (S4)">
          {types.length === 0 ? (
            <EmptyState icon={DoorClosed} title="No room types yet" message="A room type carries the nightly base rate. Add one to start building inventory." />
          ) : (
            <Table>
              <THead>
                <TR><TH>Type</TH><TH align="right">Rate / night</TH></TR>
              </THead>
              <tbody>
                {types.map((t) => (
                  <TR key={t.id}>
                    <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{t.name}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(t.base_rate)}</span></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
