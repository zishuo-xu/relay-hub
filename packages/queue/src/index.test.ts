import { describe, expect, it } from 'vitest';
import { redisConnectionFromUrl } from './index.js';

describe('redisConnectionFromUrl', () => {
  it('parses an isolated local Redis URL', () => {
    expect(redisConnectionFromUrl('redis://127.0.0.1:56379/4')).toMatchObject({
      host: '127.0.0.1',
      port: 56379,
      db: 4,
    });
  });
});
