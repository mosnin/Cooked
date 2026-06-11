import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getClientUser } from '@/lib/client-auth';
import { TITLE_FONT } from '@/lib/typography';

export const dynamic = 'force-dynamic';

/**
 * Public portal landing. A signed-in client goes straight to the dashboard;
 * everyone else gets the one-idea pitch and a single way in.
 */
export default async function ClientPortalLanding() {
  const user = await getClientUser();
  if (user) {
    redirect(user.emailVerifiedAt ? '/clients/dashboard' : '/clients/verify');
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
      <div className="max-w-xl space-y-6">
        <h1
          className="text-3xl tracking-tight text-foreground sm:text-4xl"
          style={TITLE_FONT}
        >
          Track your application. Book tours. Message your agent.
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          One place for everything you have in motion with a realtor — wherever
          you applied, whatever you&apos;re touring. Sign in with the email you
          used and it&apos;s all here.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/clients/signup"
            className="inline-flex h-9 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-all duration-150 hover:bg-foreground/90 active:scale-[0.98]"
          >
            Create your account
          </Link>
          <Link
            href="/clients/login"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
