/**
 * Storage adapter — the only module that talks to a storage provider. Every
 * upload route in this app goes through these four functions. Wasabi
 * (S3-compatible) is the live provider; the surface is shaped so we could
 * swap to raw S3 / R2 / Backblaze without touching call sites.
 *
 * Bucket strategy: ONE Wasabi bucket, prefixes per feature. Operationally
 * simpler than five buckets (one set of credentials, one CORS config, one
 * lifecycle policy) without losing logical isolation.
 *
 * Object keys are prefixed by domain:
 *   chat-attachments/{spaceId}/{uuid}-{filename}
 *   deal-documents/{spaceId}/{dealId}/{uuid}-{filename}
 *   contact-documents/{spaceId}/{contactId}/{uuid}-{filename}
 *   files/{spaceId}/{uuid}-{filename}          — generic file uploader
 *   property-photos/{spaceId}/{propertyId}/{uuid}-{filename}
 *   onboarding/{userId}/{uuid}-{filename}
 *   studio/{spaceId}/{uuid}-{filename}          — Studio-generated media
 *   profile-cover/{spaceId}/{uuid}-{filename}   — realtor's public-page cover photo
 *
 * Public vs signed: feature attachments stay PRIVATE — we serve them via
 * `getSignedUrl()` with a short TTL. Property photos and avatars can be
 * PUBLIC (the realtor wants them on a public-facing intake form anyway);
 * those use `getPublicUrl()`.
 */

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getWasabiClient, getWasabiBucket } from './client';

/** Default signed URL lifetime (seconds). 1 hour — enough for the realtor
 *  to actually download a doc; short enough that a leaked URL is bounded. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface UploadObjectInput {
  /** Object key including the prefix, e.g. "deal-documents/space123/doc-uuid.pdf". */
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  /** When true the object is uploaded with public-read ACL. Default false. */
  isPublic?: boolean;
  /** Optional content-disposition (e.g. attachment; filename="..."). */
  contentDisposition?: string;
  /** Arbitrary user-defined metadata stored alongside the object. */
  metadata?: Record<string, string>;
}

export interface UploadObjectResult {
  key: string;
  publicUrl?: string;
}

/**
 * Upload an object to Wasabi. Caller picks the key (no name mangling here);
 * convention is `{prefix}/{spaceId}/{uuid}-{filename}`.
 */
export async function uploadObject(input: UploadObjectInput): Promise<UploadObjectResult> {
  const client = getWasabiClient();
  const bucket = getWasabiBucket();
  const cmd: PutObjectCommandInput = {
    Bucket: bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ContentDisposition: input.contentDisposition,
    Metadata: input.metadata,
    // Wasabi honors S3 ACLs. We avoid making things public unless explicitly
    // asked — most uploads should be signed-URL access only.
    ACL: input.isPublic ? 'public-read' : undefined,
  };
  await client.send(new PutObjectCommand(cmd));
  return {
    key: input.key,
    publicUrl: input.isPublic ? getPublicUrl(input.key) : undefined,
  };
}

/**
 * Build the public URL for an object. Honors WASABI_PUBLIC_BASE_URL when
 * set (CDN / custom domain), otherwise constructs from endpoint + bucket.
 *
 * Note: only meaningful if the object was uploaded with `isPublic: true`.
 * Private objects will return 403 if accessed without a signed URL.
 */
export function getPublicUrl(key: string): string {
  const customBase = process.env.WASABI_PUBLIC_BASE_URL;
  if (customBase) {
    const trimmed = customBase.replace(/\/$/, '');
    return `${trimmed}/${encodeKey(key)}`;
  }
  const endpoint = process.env.WASABI_ENDPOINT ?? '';
  const bucket = getWasabiBucket();
  const trimmedEndpoint = endpoint.replace(/\/$/, '');
  return `${trimmedEndpoint}/${bucket}/${encodeKey(key)}`;
}

/**
 * Generate a presigned URL for a private object. Default TTL 1 hour.
 * Use for downloading deal documents, chat attachments, etc.
 */
export async function getSignedDownloadUrl(
  key: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const client = getWasabiClient();
  const bucket = getWasabiBucket();
  return awsGetSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}

/**
 * Fetch an object's full contents as a UTF-8 string. For small text objects
 * we own — editor-authored documents — where the caller needs the body
 * inline rather than a download URL.
 */
export async function getObjectText(key: string): Promise<string> {
  const client = getWasabiClient();
  const bucket = getWasabiBucket();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!res.Body) return '';
  return res.Body.transformToString('utf-8');
}

/**
 * Server-side copy an object to a new key. The source bytes never round
 * trip through our infrastructure — Wasabi handles it internally. Use to
 * promote a private file to a public prefix (e.g. files/ → property-photos/)
 * without re-uploading.
 */
export async function copyObject(args: {
  sourceKey: string;
  destinationKey: string;
  isPublic?: boolean;
  contentType?: string;
}): Promise<void> {
  const client = getWasabiClient();
  const bucket = getWasabiBucket();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      // CopySource is bucket + key, URL-encoded.
      CopySource: `/${bucket}/${args.sourceKey.split('/').map(encodeURIComponent).join('/')}`,
      Key: args.destinationKey,
      ACL: args.isPublic ? 'public-read' : undefined,
      ContentType: args.contentType,
      MetadataDirective: args.contentType ? 'REPLACE' : 'COPY',
    }),
  );
}

/** Delete an object. Idempotent — S3 doesn't error on missing keys. */
export async function deleteObject(key: string): Promise<void> {
  const client = getWasabiClient();
  const bucket = getWasabiBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * List objects under a key prefix. Used by the storage-gc sweeper to diff
 * the bucket against DB-tracked storage keys. Capped at `maxKeys` per
 * page (S3 max is 1000); resumes with `continuationToken` for the next page.
 *
 * Returns object keys + their last-modified timestamps so the sweeper can
 * skip very-recent uploads (sub-minute) — a race window where the DB row
 * insert is still pending and a delete would be a self-inflicted orphan.
 */
export async function listObjectsByPrefix(args: {
  prefix: string;
  maxKeys?: number;
  continuationToken?: string;
}): Promise<{
  keys: { key: string; lastModified: Date | null; size: number }[];
  nextToken: string | null;
  isTruncated: boolean;
}> {
  const client = getWasabiClient();
  const bucket = getWasabiBucket();
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: args.prefix,
      MaxKeys: args.maxKeys ?? 1000,
      ContinuationToken: args.continuationToken,
    }),
  );
  const keys = (res.Contents ?? [])
    .map((obj) => ({
      key: obj.Key ?? '',
      lastModified: obj.LastModified ?? null,
      size: obj.Size ?? 0,
    }))
    .filter((k) => k.key.length > 0);
  return {
    keys,
    nextToken: res.NextContinuationToken ?? null,
    isTruncated: Boolean(res.IsTruncated),
  };
}

/**
 * Best-effort batch delete. Fires every delete in parallel and swallows
 * individual failures (logged via the caller, not here — this module
 * doesn't import a logger). Returns the count that succeeded; the
 * caller can compare against `keys.length` to detect partial failures.
 *
 * Used by entity-DELETE handlers to drop Wasabi objects when the
 * underlying row is removed. A failure here orphans an object — the
 * nightly storage-gc cron will catch it on the next sweep.
 */
export async function deleteObjectsBestEffort(keys: string[]): Promise<{
  ok: number;
  failed: { key: string; error: unknown }[];
}> {
  if (keys.length === 0) return { ok: 0, failed: [] };
  const results = await Promise.allSettled(keys.map((k) => deleteObject(k)));
  const failed: { key: string; error: unknown }[] = [];
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok += 1;
    else failed.push({ key: keys[i], error: r.reason });
  });
  return { ok, failed };
}

/**
 * Reverse `getPublicUrl` — given a stored public photo URL, return the
 * object key (e.g. `property-photos/sp_x/prop_y/uuid-name.jpg`). Returns
 * null if the URL doesn't match our bucket's public shape, which makes the
 * caller skip the delete instead of guessing.
 *
 * Used by Property DELETE: the `photos` column is a JSONB array of public
 * URLs (legacy schema), and we need to map each one back to a key so we
 * can clean up Wasabi when the row is removed.
 */
export function publicUrlToKey(url: string): string | null {
  const customBase = process.env.WASABI_PUBLIC_BASE_URL;
  const endpoint = process.env.WASABI_ENDPOINT ?? '';
  const bucket = getWasabiBucket();

  const candidates: string[] = [];
  if (customBase) candidates.push(customBase.replace(/\/$/, ''));
  if (endpoint) candidates.push(`${endpoint.replace(/\/$/, '')}/${bucket}`);

  for (const base of candidates) {
    if (!base) continue;
    if (url.startsWith(`${base}/`)) {
      const rest = url.slice(base.length + 1);
      try {
        // Decode each path segment — `getPublicUrl` percent-encodes them.
        return rest
          .split('/')
          .map((seg) => decodeURIComponent(seg))
          .join('/');
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Encode each path segment without touching slashes (S3 treats them as
 *  hierarchy separators in the URL). */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

// ─── Prefix helpers — single source of truth for object key shapes ──────────

export const STORAGE_PREFIXES = {
  chatAttachments: 'chat-attachments',
  dealDocuments: 'deal-documents',
  contactDocuments: 'contact-documents',
  files: 'files',
  propertyPhotos: 'property-photos',
  onboarding: 'onboarding',
  studio: 'studio',
  profileCover: 'profile-cover',
  profilePhoto: 'profile-photo',
} as const;

/** Convenient key builder. Pass the prefix + the suffix segments and get a
 *  normalized key with `/` separators and no leading/trailing slashes. */
export function buildKey(
  prefix: keyof typeof STORAGE_PREFIXES,
  ...segments: string[]
): string {
  const parts = [STORAGE_PREFIXES[prefix], ...segments].filter(
    (s) => s != null && s !== '',
  );
  return parts.join('/');
}
