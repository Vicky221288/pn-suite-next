import { redirect } from 'next/navigation';

// '/' always resolves to the role-aware Today surface (OP MODEL §8).
// Middleware bounces unauthenticated users to /login first.
export default function RootPage() {
  redirect('/today');
}
