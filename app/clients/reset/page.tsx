import Link from 'next/link';
import { AuthShell, ResetForm } from '../auth-ui';

export const dynamic = 'force-dynamic';

export default function ResetPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a code to set a new one."
      footer={
        <>
          Remembered it?{' '}
          <Link href="/clients/login" className="text-foreground hover:underline">
            Sign in
          </Link>
          .
        </>
      }
    >
      <ResetForm />
    </AuthShell>
  );
}
