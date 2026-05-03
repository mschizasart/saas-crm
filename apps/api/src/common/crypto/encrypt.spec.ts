import { encrypt, decrypt, isEncrypted, EncryptionError } from './encrypt';

/**
 * Crypto primitives are load-bearing for SMTP password / 2FA secret storage.
 * Any regression here corrupts existing secrets in the DB silently, so we
 * cover roundtrip + tamper detection + error paths exhaustively.
 */
describe('encrypt/decrypt (AES-256-GCM)', () => {
  // 32 bytes = 64 hex chars. Use a fixed key so failures are deterministic.
  const KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('roundtrips ASCII plaintext', () => {
    const plaintext = 'super-secret-smtp-password';
    const ciphertext = encrypt(plaintext, KEY);
    expect(ciphertext).not.toEqual(plaintext);
    expect(decrypt(ciphertext, KEY)).toEqual(plaintext);
  });

  it('roundtrips multi-byte unicode plaintext', () => {
    const plaintext = '🔒 Καλημέρα 你好 — emoji + greek + chinese';
    const ciphertext = encrypt(plaintext, KEY);
    expect(decrypt(ciphertext, KEY)).toEqual(plaintext);
  });

  it('produces a different ciphertext on every call (non-deterministic IV)', () => {
    const plaintext = 'idempotency check';
    const a = encrypt(plaintext, KEY);
    const b = encrypt(plaintext, KEY);
    expect(a).not.toEqual(b);
    expect(decrypt(a, KEY)).toEqual(plaintext);
    expect(decrypt(b, KEY)).toEqual(plaintext);
  });

  it('emits the iv:tag:cipher hex format', () => {
    const ciphertext = encrypt('whatever', KEY);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((p) => expect(p).toMatch(/^[0-9a-f]+$/));
  });

  it('throws EncryptionError when the key env var is missing', () => {
    expect(() => encrypt('x', undefined)).toThrow(EncryptionError);
    expect(() => encrypt('x', undefined)).toThrow(/ENCRYPTION_KEY env var is required/);
  });

  it('throws EncryptionError when the key is the wrong length', () => {
    expect(() => encrypt('x', 'deadbeef')).toThrow(EncryptionError);
    expect(() => encrypt('x', 'deadbeef')).toThrow(/Encryption key must be 32 bytes/);
  });

  it('throws EncryptionError on a malformed encrypted value', () => {
    expect(() => decrypt('not-three-parts', KEY)).toThrow(EncryptionError);
    expect(() => decrypt('only:two', KEY)).toThrow(/Malformed encrypted value/);
  });

  it('throws on GCM authentication tag mismatch (tamper detection)', () => {
    const ciphertext = encrypt('payload', KEY);
    const [iv, tag, data] = ciphertext.split(':');
    // Flip a bit in the auth tag so GCM rejects it.
    const flippedTag = (
      tag.slice(0, -1) + (tag.slice(-1) === '0' ? '1' : '0')
    ).padEnd(tag.length, '0');
    const tampered = `${iv}:${flippedTag}:${data}`;
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it('throws when decrypted with the wrong key', () => {
    const ciphertext = encrypt('payload', KEY);
    const wrongKey =
      '1111111111111111111111111111111111111111111111111111111111111111';
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  describe('isEncrypted()', () => {
    it('returns true for values produced by encrypt()', () => {
      expect(isEncrypted(encrypt('hi', KEY))).toBe(true);
    });

    it('returns false for plain strings', () => {
      expect(isEncrypted('not-encrypted-just-a-password')).toBe(false);
      expect(isEncrypted('a:b')).toBe(false);
      expect(isEncrypted('a:b:c:d')).toBe(false);
    });

    it('returns false for null / undefined / empty', () => {
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('returns false when one segment contains a non-hex char', () => {
      expect(isEncrypted('aa:bb:zz')).toBe(false);
    });
  });
});
