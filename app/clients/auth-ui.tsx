'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';

/* ─── Shared shell ────────────────────────────────────────────────────────── */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mx-auto w-full max-w-[380px] space-y-6">
        <header className="space-y-1.5">
          <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </header>
        {children}
        {footer && <div className="pt-1 text-sm text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}

/* ─── Field primitives ────────────────────────────────────────────────────── */

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const INPUT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base sm:text-sm ' +
  'placeholder:text-muted-foreground/70 transition-colors duration-150 outline-none ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 ' +
  'focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT_CLASS, props.className)} />;
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-all duration-150 hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
    >
      {pending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

/* ─── post() helper ───────────────────────────────────────────────────────── */

export async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/* ─── Signup ──────────────────────────────────────────────────────────────── */

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const { ok, data } = await postJson('/api/clients/auth/signup', { name, email, password });
    if (!ok) {
      setError((data.error as string) ?? 'Something went wrong. Try again.');
      setPending(false);
      return;
    }
    try {
      sessionStorage.setItem('chippi_client_email', email.trim().toLowerCase());
    } catch {}
    router.push(`/clients/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Your name" htmlFor="name">
        <TextInput
          id="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Rivera"
        />
      </Field>
      <Field label="Email" htmlFor="email">
        <TextInput
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <TextInput
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </Field>
      <FormError error={error} />
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}

/* ─── Login ───────────────────────────────────────────────────────────────── */

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const { ok, data } = await postJson('/api/clients/auth/login', { email, password });
    if (!ok) {
      setError((data.error as string) ?? 'Wrong email or password.');
      setPending(false);
      return;
    }
    if (data.next === 'verify') {
      router.push(`/clients/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      return;
    }
    router.push('/clients/dashboard');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" htmlFor="email">
        <TextInput
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <TextInput
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
        />
      </Field>
      <FormError error={error} />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-sm text-muted-foreground">
        <Link href="/clients/reset" className="transition-colors hover:text-foreground">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

/* ─── Verify ──────────────────────────────────────────────────────────────── */

export function VerifyForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const { ok, data } = await postJson('/api/clients/auth/verify', { email, code });
    if (!ok) {
      setError((data.error as string) ?? 'That code is wrong or expired.');
      setPending(false);
      return;
    }
    router.push('/clients/dashboard');
  }

  async function resend() {
    setResent(false);
    setError(null);
    await postJson('/api/clients/auth/resend', { email });
    setResent(true);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!initialEmail && (
        <Field label="Email" htmlFor="email">
          <TextInput
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
          />
        </Field>
      )}
      <Field label="6-digit code" htmlFor="code">
        <TextInput
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="tracking-[0.4em]"
        />
      </Field>
      <FormError error={error} />
      <SubmitButton pending={pending}>Verify</SubmitButton>
      <button
        type="button"
        onClick={resend}
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {resent ? 'Code sent — check your inbox.' : 'Resend the code.'}
      </button>
    </form>
  );
}

/* ─── Reset (request + confirm in one screen) ─────────────────────────────── */

export function ResetForm() {
  const router = useRouter();
  const [stage, setStage] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const { ok, data } = await postJson('/api/clients/auth/request-reset', { email });
    setPending(false);
    if (!ok) {
      setError((data.error as string) ?? 'Something went wrong. Try again.');
      return;
    }
    setStage('confirm');
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const { ok, data } = await postJson('/api/clients/auth/reset', { email, code, password });
    if (!ok) {
      setError((data.error as string) ?? 'That code is wrong or expired.');
      setPending(false);
      return;
    }
    router.push('/clients/dashboard');
  }

  if (stage === 'request') {
    return (
      <form onSubmit={requestCode} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <TextInput
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
          />
        </Field>
        <FormError error={error} />
        <SubmitButton pending={pending}>Send reset code</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={confirmReset} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        If that email has an account, a code is on its way. Enter it below with a
        new password.
      </p>
      <Field label="6-digit code" htmlFor="code">
        <TextInput
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="tracking-[0.4em]"
        />
      </Field>
      <Field label="New password" htmlFor="password">
        <TextInput
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </Field>
      <FormError error={error} />
      <SubmitButton pending={pending}>Reset password</SubmitButton>
    </form>
  );
}
