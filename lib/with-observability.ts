/**
 * withObservability — minimal route handler wrapper.
 *
 * Runs the handler inside a named Sentry span so the route appears in
 * distributed traces. On an unhandled throw, the error is captured before
 * rethrowing so the original response / error boundary is unchanged.
 *
 * Usage:
 *   export const GET = withObservability(async (req, ctx) => { ... }, 'api.sync');
 */
import { captureError, withSpan } from '@/lib/observability';

/**
 * Generic over the handler's exact argument tuple so the wrapped export keeps
 * the SAME signature Next.js generated route-type validation expects — works
 * for both static routes `(req)` and dynamic ones `(req, { params })`.
 */
export function withObservability<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
  opName: string,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await withSpan(opName, 'http.server', async () => handler(...args));
    } catch (err) {
      captureError(err, { route: opName });
      throw err;
    }
  };
}
