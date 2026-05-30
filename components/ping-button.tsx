'use client';
import { useState } from 'react';
import { pingAudit } from '@/lib/actions/ping';
import { Button } from '@/components/ui/button';

/** Exercises the wrapper + audit util (B0 exit criterion). */
export function PingButton() {
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const res = await pingAudit({ note: 'B0 audit probe' });
    setPending(false);
    setResult(
      res.ok
        ? `OK — audit completed (id: ${res.auditId ?? 'n/a'})`
        : `${res.error}: ${res.message}`,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={run} disabled={pending}>
        {pending ? 'Pinging…' : 'Run audit ping'}
      </Button>
      {result && (
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {result}
        </p>
      )}
    </div>
  );
}
