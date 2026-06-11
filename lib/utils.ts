import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function normalizeRootDomain(value: string) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '')
    .replace(/^www\./, '');

  return sanitized;
}

export const protocol =
  process.env.NODE_ENV === 'production' ? 'https' : 'http';

const configuredRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
const defaultRootDomain =
  process.env.NODE_ENV === 'production'
    ? 'my.usechippi.com'
    : 'localhost:3000';

if (!configuredRootDomain && process.env.NODE_ENV !== 'production') {
  console.warn(
    '[chippi] NEXT_PUBLIC_ROOT_DOMAIN is not set. Intake URLs will use the default domain:',
    defaultRootDomain,
    '— set this env var to match your actual deployment domain.'
  );
}

export const rootDomain =
  normalizeRootDomain(configuredRootDomain || defaultRootDomain);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize a user-provided URL for safe use in href attributes.
 * Only allows http: and https: protocols. Returns '#' for invalid/dangerous URLs.
 * Prevents javascript:, data:, vbscript: protocol XSS.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (!trimmed) return '#';
  try {
    const parsed = new URL(trimmed, 'https://placeholder.invalid');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
    return '#';
  } catch {
    // Relative URLs starting with / are safe
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    return '#';
  }
}

/**
 * Sanitize a URL intended for an <img src> attribute. Modern browsers
 * already refuse to execute javascript: / data: in image src, but
 * defense-in-depth: validate the scheme on our side so we never even
 * hand a hostile URL to the browser. Allows http(s) and same-origin
 * relative paths; rejects everything else (returns null so the caller
 * can render a placeholder icon instead of a broken image).
 *
 * Used by the chat markdown renderer where the model could in theory
 * emit `![alt](javascript:...)` or `![alt](data:text/html,...)`. Real
 * exploitation requires browser bugs we don't depend on; this is the
 * belt to the browser's suspenders.
 */
export function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, 'https://placeholder.invalid');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
    return null;
  } catch {
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    return null;
  }
}
