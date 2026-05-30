import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl" style={{ color: 'var(--color-brand)' }}>
            PN Master Suite
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Hospitality operations
          </p>
        </div>
        <div
          className="p-6"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: 'var(--card-radius)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
