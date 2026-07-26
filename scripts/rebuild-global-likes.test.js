import { describe, expect, it } from 'vitest';
import { normalizeLegacyBookmarkUrl } from './rebuild-global-likes.js';

describe('legacy bookmark normalization', () => {
  it('counts the historical trailing-quote Akshay bookmark', () => {
    expect(normalizeLegacyBookmarkUrl(
      'https://akshayabraham.vercel.app?utm_source=github"',
    )).toBe('https://akshayabraham.vercel.app');
  });

  it('still rejects embedded quotes and unsafe schemes', () => {
    expect(normalizeLegacyBookmarkUrl('https://exa"mple.com"')).toBeNull();
    expect(normalizeLegacyBookmarkUrl('javascript:alert(1)')).toBeNull();
  });
});
