import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.CLERK_SECRET_KEY;
  if (!secret) {
    // Fail closed: never derive a key from the empty string — sha256("") is a
    // public constant, so the old `|| ''` fallback made every encrypted value
    // trivially reversible if both env vars were absent. ENCRYPTION_KEY is
    // preferred; CLERK_SECRET_KEY stays as a fallback ONLY so data encrypted
    // before ENCRYPTION_KEY was provisioned still decrypts. Moving to a
    // dedicated key is a separate re-encryption task, not a silent default.
    throw new Error('ENCRYPTION_KEY (or CLERK_SECRET_KEY) must be set for encryption');
  }
  // Derive a 32-byte key from the secret using SHA-256
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a hex-encoded string: iv + authTag + ciphertext.
 */
export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Concatenate iv + authTag + ciphertext and hex-encode
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

/**
 * Decrypt a hex-encoded string produced by encrypt().
 */
export function decrypt(encryptedHex: string): string {
  const key = getKey();
  const data = Buffer.from(encryptedHex, 'hex');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Soft-migration helper for fields that USED to be stored plaintext and now
 * land encrypted. Attempts decrypt; on any failure (wrong shape, wrong
 * algorithm, GCM tag mismatch — i.e. the value is legacy plaintext), returns
 * the raw input unchanged.
 *
 * Used by Google Calendar access-token reads while existing rows from before
 * the encrypt-at-rest migration drain off the table. New writes always go
 * through encrypt(), so the legacy branch self-extinguishes within one
 * refresh cycle (~1 hour for Google access tokens).
 *
 * Anti-pattern alert: do NOT use this for fields that have ALWAYS been
 * encrypted (e.g. refreshToken). On those, a decrypt failure means data
 * corruption and should surface, not silently return garbage. This is only
 * safe for the soft-migration window.
 */
export function decryptOrPassthrough(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
