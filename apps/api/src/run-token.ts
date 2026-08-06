import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_RUN_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;

export interface IssuedRunToken {
  plaintext: string;
  hash: string;
  issuedAt: Date;
  expiresAt: Date;
}

export function hashRunToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function issueRunToken(now = new Date(), ttlMs = DEFAULT_RUN_TOKEN_TTL_MS): IssuedRunToken {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Run token TTL must be a positive integer');
  const plaintext = `rht_${randomBytes(32).toString('base64url')}`;
  return {
    plaintext,
    hash: hashRunToken(plaintext),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export function verifyRunToken(plaintext: string, expectedHash: string): boolean {
  if (!plaintext || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(hashRunToken(plaintext), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
