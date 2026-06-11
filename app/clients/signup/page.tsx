import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getClientUser } from '@/lib/client-auth';
import { AuthShell, SignupForm } from '../auth-ui';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const user = await getClientUser();
  if (user) redirect(user.emailVerifiedAt ? '/clients/dashboard' : '/clients/verify');

  return (
    <AuthShell
      title="Create your account"
      subtitle="One login for every application and tour."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/clients/login" className="text-foreground hover:underline">
            Sign in
          </Link>
          .
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
