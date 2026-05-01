import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Recovery code helpers shared by the staff and platform 2FA flows.
 *
 * Format: 10 codes, each 10 alphanumeric chars rendered as `XXXXX-XXXXX`
 * (so 11 chars including the dash, or 10 raw chars). Generated with
 * crypto.randomBytes for proper entropy. Codes are stored bcrypt-hashed
 * and shown to the user exactly once.
 */

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10; // raw alphanumeric chars (not counting the dash)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // crockford-ish: no I/O/0/1

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = randomCode(RECOVERY_CODE_LENGTH);
    // Render as XXXXX-XXXXX for human readability when displayed/printed.
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** Bcrypt-hash an array of recovery codes (cost 10 — these are random). */
export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(normalizeCode(c), 10)));
}

/** Normalise user input — strip spaces/dashes, uppercase. */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Try to consume a recovery code. Returns the index of the matched hash
 * (so the caller can splice it out of the JSON array) or -1.
 */
export async function consumeRecoveryCode(
  input: string,
  hashes: string[],
): Promise<number> {
  const candidate = normalizeCode(input);
  if (candidate.length !== RECOVERY_CODE_LENGTH) return -1;
  for (let i = 0; i < hashes.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(candidate, hashes[i])) return i;
  }
  return -1;
}
