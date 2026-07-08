import { describe, it, expect, vi } from 'vitest';
import { urlToKey } from '../utils.js';

describe('urlToKey', () => {
  it('encodes simple URLs correctly', () => {
    const url = 'https://example.com';
    const key = urlToKey(url);
    // https://example.com -> aHR0cHM6Ly9leGFtcGxlLmNvbQ==
    // after replace: aHR0cHM6Ly9leGFtcGxlLmNvbQ
    expect(key).toBe(btoa(encodeURIComponent(url)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, ''));
  });

  it('replaces slashes with underscores', () => {
    // We need a string that when base64 encoded contains a slash.
    // '??' is base64 encoded to 'Pz8='
    // But encodeURIComponent encodes '?' to '%3F'
    // Let's just mock btoa to return a string with a slash to test the replacement
    const url = 'https://example.com/test';
    const originalBtoa = global.btoa;
    global.btoa = vi.fn().mockReturnValue('abc/def+ghi=');

    expect(urlToKey(url)).toBe('abc_def-ghi');

    global.btoa = originalBtoa;
  });

  it('falls back to simple hash when btoa fails', () => {
    const url = 'https://example.com';
    const originalBtoa = global.btoa;

    // Make btoa throw an error to simulate environment where it's not available
    // or fails
    global.btoa = vi.fn().mockImplementation(() => {
      throw new Error('btoa failed');
    });

    const key = urlToKey(url);
    expect(key).toMatch(/^hash_\d+$/);

    global.btoa = originalBtoa;
  });
});
