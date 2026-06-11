/**
 * Splash greeting. Picked SERVER-side per request and passed into the client
 * splash as a prop, so the server-rendered text and the hydrated text always
 * match — doing the random pick inside the client component caused a React
 * hydration mismatch. Still varies on every open because the server picks
 * fresh each request.
 *
 * Time-neutral on purpose: the server clock is UTC, so "good morning" would be
 * wrong for most realtors. These read warm at any hour.
 */
export function pickGreeting(firstName: string): string {
  const n = (firstName ?? '').trim();
  const pool = n
    ? [
        `Welcome back, ${n}.`,
        `Good to see you, ${n}.`,
        `Hey, ${n}.`,
        `${n}, let's get into it.`,
        `Back at it, ${n}.`,
        `Ready when you are, ${n}.`,
        `Let's make it count, ${n}.`,
      ]
    : [
        'Welcome back.',
        'Good to see you.',
        "Let's get into it.",
        'Back at it.',
        'Ready when you are.',
      ];
  return pool[Math.floor(Math.random() * pool.length)];
}
