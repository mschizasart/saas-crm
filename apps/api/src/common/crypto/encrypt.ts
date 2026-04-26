import * as crypto from 'crypto';

/**
 * AES-256-GCM symmetric encryption for at-rest secrets
 * (SMTP passwords, API tokens for external services, etc).
 *
 * The project already uses the same primitive inside VaultService
 * (see modules/vault/vault.service.ts). This is the shared, generic
 * version — pass the key in explicitly so each caller can use its
 * own env var (ENCRYPTION_KEY, VAULT_ENCRYPTION_KEY, …).
 *
 * Format: `iv:authTag:ciphertext` all hex-encoded.
 * Key MUST be 32 bytes, hex-encoded (64 hex chars).
 *
 * Generate a key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH_BYTES = 32;

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

function resolveKey(keyHex: string | undefined): Buffer {
  if (!keyHex) {
    throw new EncryptionError(
      'ENCRYPTION_KEY env var is required (32 bytes / 64 hex chars)',
    );
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new EncryptionError(
      `Encryption key must be ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex chars); got ${buf.length} bytes`,
    );
  }
  return buf;
}

/** Encrypt a plaintext string with AES-256-GCM. Returns `iv:tag:cipher` hex. */
export function encrypt(plaintext: string, keyHex: string | undefined): string {
  const key = resolveKey(keyHex);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a value produced by `encrypt()`. Throws on tamper/bad key. */
export function decrypt(
  encryptedValue: string,
  keyHex: string | undefined,
): string {
  const key = resolveKey(keyHex);
  const parts = encryptedValue.split(':');
  if (parts.length !== 3) {
    throw new EncryptionError('Malformed encrypted value');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Best-effort check — returns true if the input looks like it was produced
 * by `encrypt()`. Does NOT verify the payload actually decrypts.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[0-9a-f]*$/i.test(p));
}
