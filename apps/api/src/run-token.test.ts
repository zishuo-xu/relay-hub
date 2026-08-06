import { describe, expect, it } from 'vitest';
import { hashRunToken, issueRunToken, verifyRunToken } from './run-token.js';

describe('run token', () => {
  it('issues an opaque expiring token and stores only its SHA-256 hash', () => {
    const now = new Date('2026-08-06T00:00:00.000Z');
    const token = issueRunToken(now, 60_000);

    expect(token.plaintext).toMatch(/^rht_[A-Za-z0-9_-]{43}$/);
    expect(token.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.hash).not.toContain(token.plaintext);
    expect(token.issuedAt).toEqual(now);
    expect(token.expiresAt.toISOString()).toBe('2026-08-06T00:01:00.000Z');
    expect(token.hash).toBe(hashRunToken(token.plaintext));
  });

  it('accepts only the matching plaintext token', () => {
    const token = issueRunToken();
    expect(verifyRunToken(token.plaintext, token.hash)).toBe(true);
    expect(verifyRunToken(`${token.plaintext}x`, token.hash)).toBe(false);
    expect(verifyRunToken(token.plaintext, 'not-a-hash')).toBe(false);
  });
});
