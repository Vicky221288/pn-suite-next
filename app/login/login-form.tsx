'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * Email + password sign-in.
 *
 * NOTE (REUSE-ANALYSIS honesty marker): rhs-crm-next used a phone +
 * synthetic-email (`${phone}@rhs.crm`) convention. PN defaults to real email
 * here. If PN staff should log in by phone, this is the one place to change.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push('/today');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
      </label>
      {error && (
        <p className="text-sm" role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  borderRadius: 'var(--input-radius)',
  color: 'var(--input-text)',
  padding: 'var(--input-pad-y) var(--input-pad-x)',
  fontSize: 'var(--text-base)',
};
