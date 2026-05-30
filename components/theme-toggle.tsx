'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

/**
 * Light/dark toggle — flips [data-theme] (tokens.css §3) and persists to
 * localStorage. The runtime CSS-variable mechanism here is the same hook a
 * per-tenant white-label theme will use later (tokens.css §8).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light';
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('pn-theme', next);
    } catch {
      /* private mode — ignore */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="inline-flex items-center justify-center"
      style={{ color: 'var(--color-text-secondary)', width: 32, height: 32 }}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
