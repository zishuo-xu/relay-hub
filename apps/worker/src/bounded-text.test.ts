import { describe, expect, it } from 'vitest';
import { truncateText } from './bounded-text.js';

describe('truncateText', () => {
  it('keeps the returned value within the declared limit including the ellipsis', () => {
    const result = truncateText('x'.repeat(2_100), 2_000);

    expect(result).toHaveLength(2_000);
    expect(result.endsWith('…')).toBe(true);
  });

  it('preserves text that already fits and handles very small limits', () => {
    expect(truncateText('ok', 2)).toBe('ok');
    expect(truncateText('too long', 1)).toBe('…');
    expect(truncateText('ignored', 0)).toBe('');
  });
});
