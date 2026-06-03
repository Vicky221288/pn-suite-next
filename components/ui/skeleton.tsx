import { cn } from '@/lib/utils';

/**
 * Skeleton — a token-driven shimmer placeholder for loading.tsx states. Reusable
 * across every screen's loading scaffold so loads read as intentional, not blank.
 * Honors prefers-reduced-motion (globals disables the sweep).
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn('pn-skeleton', className)} style={style} />;
}
