import { describe, expect, it } from 'vitest';
import {
  isHostnameFallbackName,
  mergeUpstreamPortfolioName,
  normalizeAndDedupe,
  parseMarkdownList,
  repairPortfolioUrlCandidate,
} from './update-data.js';

describe('upstream Markdown parsing', () => {
  it('accepts plain links and links followed by role annotations', () => {
    const markdown = [
      '- [Ada](https://ada.example) [Software Engineer]',
      '- [Grace](https://grace.example/path) [Backend Developer] - Animated',
      '- [Linus](http://linus.example)',
    ].join('\n');

    expect(parseMarkdownList(markdown)).toEqual([
      { name: 'Ada', url: 'https://ada.example' },
      { name: 'Grace', url: 'https://grace.example/path' },
      { name: 'Linus', url: 'http://linus.example' },
    ]);
  });

  it('supports balanced parentheses in a Markdown destination', () => {
    expect(parseMarkdownList(
      '- [Example](https://example.com/work_(archive)) [Engineer]',
    )).toEqual([
      { name: 'Example', url: 'https://example.com/work_(archive)' },
    ]);
  });

  it('rejects unsafe or malformed destinations', () => {
    const markdown = [
      '- [Script](javascript:alert(1))',
      '- [Whitespace](https://bad example/path)',
      '- [Credentials](https://user:pass@example.com)',
      '- [Missing close](https://example.com',
    ].join('\n');

    expect(parseMarkdownList(markdown)).toEqual([]);
  });

  it('repairs only a single accidental trailing double quote', () => {
    const malformed =
      'https://akshayabraham.vercel.app?utm_source=github"';

    expect(repairPortfolioUrlCandidate(malformed)).toBe(
      'https://akshayabraham.vercel.app?utm_source=github',
    );
    expect(parseMarkdownList(
      `- [Akshay](${malformed}) [Full Stack Developer]`,
    )).toEqual([
      { name: 'Akshay', url: 'https://akshayabraham.vercel.app' },
    ]);
    expect(repairPortfolioUrlCandidate('https://exa"mple.com"')).toBeNull();
  });
});

describe('normalization repair', () => {
  it('repairs a legacy trailing-quote record without dropping its metadata', () => {
    const result = normalizeAndDedupe([{
      name: 'Akshay',
      url: 'https://akshayabraham.vercel.app?utm_source=github"',
      summary: 'Preserve me',
    }]);

    expect(result.rejected).toBe(0);
    expect(result.records).toEqual([{
      name: 'Akshay',
      url: 'https://akshayabraham.vercel.app',
      summary: 'Preserve me',
    }]);
  });
});

describe('upstream name repair', () => {
  it('recognizes blank and hostname-derived fallback names', () => {
    const url = 'https://www.Example.com/portfolio';

    expect(isHostnameFallbackName('', url)).toBe(true);
    expect(isHostnameFallbackName(null, url)).toBe(true);
    expect(isHostnameFallbackName('example.com', url)).toBe(true);
    expect(isHostnameFallbackName('EXAMPLE.COM', url)).toBe(true);
    expect(isHostnameFallbackName('Ada Lovelace', url)).toBe(false);
  });

  it('upgrades blank and hostname fallback names from a real upstream name', () => {
    const url = 'https://example.com';

    expect(mergeUpstreamPortfolioName('', 'Ada Lovelace', url)).toBe('Ada Lovelace');
    expect(mergeUpstreamPortfolioName('example.com', 'Ada Lovelace', url))
      .toBe('Ada Lovelace');
  });

  it('never overwrites an enriched local name', () => {
    expect(mergeUpstreamPortfolioName(
      'Ada Lovelace — Computing Pioneer',
      'Ada Lovelace',
      'https://example.com',
    )).toBe('Ada Lovelace — Computing Pioneer');
  });

  it('does not replace one fallback with another fallback', () => {
    const url = 'https://example.com';

    expect(mergeUpstreamPortfolioName('example.com', '', url)).toBe('example.com');
    expect(mergeUpstreamPortfolioName('', 'example.com', url)).toBe('');
  });
});
