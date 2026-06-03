'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Card } from './card';
import { Button } from './button';

/**
 * CreatePanel — the LIST-screen intake pattern: a collapsible card whose header
 * carries a top-right primary action ("New …") that reveals an inline create
 * form, so the list stays the focus until you choose to add. Reusable across every
 * list surface; pass the existing create-form component as children (logic
 * untouched). Defaults closed to keep the grid prominent.
 */
export function CreatePanel({ label, title, children, defaultOpen = false }: { label: string; title?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card
      padded={false}
      accent={open}
      title={title ?? label}
      actions={
        <Button variant={open ? 'secondary' : 'primary'} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <><X size={14} /> Close</> : <><Plus size={14} /> {label}</>}
        </Button>
      }
    >
      {open && <div style={{ padding: 'var(--card-pad)' }}>{children}</div>}
    </Card>
  );
}
