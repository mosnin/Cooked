import { redirect } from 'next/navigation';

/**
 * Redirect /sign-in to /login/rep so all sign-in flows use
 * Clerk's path-based routing consistently. This prevents mobile
 * navigation issues when switching between manager/rep tabs.
 */
export default function SignInPage() {
  redirect('/login/rep');
}
