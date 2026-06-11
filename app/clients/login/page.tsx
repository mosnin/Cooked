import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getClientUser } from '@/lib/client-auth';
import { AuthShell, LoginForm } from '../auth-ui';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getClientUser();
  if (user) redirect(user.emailVerifiedAt ? '/clients/dashboard' : '/clients/verify');

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your applications and tours."
      footer={
        <>
          New here?{' '}
          <Link href="/clients/signup" className="text-foreground hover:underline">
            Create an account
          </Link>
          .
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
