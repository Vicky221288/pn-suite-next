'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Search guests by name or phone (navigates to /guests?q=). */
export function GuestSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/guests?q=${encodeURIComponent(q.trim())}` : '/guests');
  }
  return (
    <form onSubmit={submit}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name / phone"
        aria-label="Search guests"
        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)', width: 220 }}
      />
    </form>
  );
}
