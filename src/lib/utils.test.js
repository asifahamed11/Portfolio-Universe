import { describe, expect, it } from 'vitest';
import {
  canonicalUrlKey,
  getPortfolioDisplayName,
  normalizePortfolioUrl,
  sanitizeBookmarks,
  sanitizePortfolio,
  toSafeCount,
  urlToDocumentKey,
  urlToKey,
} from './utils.js';
import { urlToKey as adminUrlToKey } from '../../scripts/migrate-to-firestore.js';

describe('normalizePortfolioUrl', () => {
  it('canonicalizes equivalent URLs and removes tracking parameters', () => {
    expect(normalizePortfolioUrl(
      'https://EXAMPLE.com:443/?utm_source=test&project=one#section'
    )).toBe('https://example.com?project=one');
    expect(normalizePortfolioUrl(
      'https://example.com/?utm_=x&a=1'
    )).toBe('https://example.com?a=1');
    expect(normalizePortfolioUrl('https://example.com/')).toBe('https://example.com');
  });

  it('rejects unsafe schemes, credentials, whitespace, and quote injection', () => {
    expect(normalizePortfolioUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePortfolioUrl('https://user:secret@example.com')).toBeNull();
    expect(normalizePortfolioUrl('https://example.com/a b')).toBeNull();
    expect(normalizePortfolioUrl('https://example.com/" onmouseover="alert(1)')).toBeNull();
  });
});

describe('portfolio sanitization', () => {
  it('drops rejected records and normalizes untrusted fields', () => {
    expect(sanitizePortfolio({
      is_portfolio: false,
      url: 'https://example.com',
    })).toBeNull();

    expect(sanitizePortfolio({
      name: '  Example   Developer  ',
      url: 'https://EXAMPLE.com/',
      screenshot: 'data:text/html,test',
      summary: `  ${'word '.repeat(200)} `,
      role: '  Frontend   Developer ',
      tech_stack: [' React ', 'React', '', 12],
      available_for_hire: 1,
      views: '<script>',
    }, 3)).toMatchObject({
      index: 3,
      name: 'Example Developer',
      url: 'https://example.com',
      screenshot: null,
      role: 'Frontend Developer',
      tech_stack: ['React'],
      available_for_hire: false,
      views: 0,
    });
  });

  it('uses the hostname when enrichment left the name blank', () => {
    expect(getPortfolioDisplayName('', 'https://www.example.dev/path')).toBe('example.dev');
  });
});

describe('bookmark and counter helpers', () => {
  it('deduplicates bookmarks by canonical URL and drops invalid entries', () => {
    expect(sanitizeBookmarks([
      'https://example.com/',
      'https://example.com',
      'javascript:alert(1)',
      null,
    ])).toEqual(['https://example.com']);
  });

  it('clamps untrusted counters and produces stable keys', () => {
    expect(toSafeCount(-1)).toBe(0);
    expect(toSafeCount('12.9')).toBe(12);
    expect(toSafeCount('<img>')).toBe(0);
    expect(urlToKey('https://example.com/')).toBe(urlToKey('https://example.com'));
  });

  it('uses the same fixed SHA-256 document key in browser and Admin code', async () => {
    const variants = [
      'https://www.example.com/?b=2&a=1',
      'http://example.com?a=1&b=2',
      'https://example.com/?utm_=x&a=1&b=2',
    ];
    expect(canonicalUrlKey(variants[0])).toBe('example.com/?a=1&b=2');
    expect(await urlToDocumentKey(variants[0])).toBe(
      'b4fc32c64140a5734c4110b11a9b02b7f64e49d8921c9fcf8099faccd9c5ee96'
    );
    expect(adminUrlToKey(variants[0])).toBe(await urlToDocumentKey(variants[0]));
    expect(adminUrlToKey(variants[1])).toBe(await urlToDocumentKey(variants[1]));
    expect(adminUrlToKey(variants[2])).toBe(await urlToDocumentKey(variants[2]));
  });
});
