import { describe, expect, it } from 'vitest';
import {
  normalizePortfolio,
  normalizePortfolioCollection,
  portfolioIdentity,
  toSafeHttpsUrl,
} from './portfolio.js';

describe('portfolio URL validation', () => {
  it('accepts ordinary HTTPS URLs and canonicalizes them', () => {
    expect(toSafeHttpsUrl('https://Example.com/work')).toBe(
      'https://example.com/work',
    );
  });

  it.each([
    'javascript:alert(1)',
    'http://example.com',
    'https://example.com/" onmouseover="alert(1)',
    'https://user:password@example.com',
    'https://example.com:8443',
    ' https://example.com',
  ])('rejects unsafe URL %s', (url) => {
    expect(toSafeHttpsUrl(url)).toBeNull();
  });
});

describe('portfolio normalization', () => {
  it('falls back to the hostname and clamps untrusted fields', () => {
    const portfolio = normalizePortfolio({
      name: '',
      url: 'https://example.com',
      role: ' Developer ',
      tech_stack: [' Astro ', '', 42],
      views: -10,
    });

    expect(portfolio).toMatchObject({
      name: 'example.com',
      role: 'Developer',
      tech_stack: ['Astro'],
      views: 0,
    });
  });

  it('excludes false positives, unsafe URLs, and duplicates', () => {
    const values = [
      { name: 'One', url: 'https://example.com/' },
      { name: 'Duplicate', url: 'https://EXAMPLE.com' },
      { name: 'HTTP', url: 'http://example.net' },
      { name: 'False positive', url: 'https://example.org', is_portfolio: false },
    ];

    expect(normalizePortfolioCollection(values)).toHaveLength(1);
    expect(portfolioIdentity(values[0].url)).toBe(
      portfolioIdentity(values[1].url),
    );
  });

  it('keeps user submissions private until AI review accepts them', () => {
    const pending = {
      name: 'Pending',
      url: 'https://pending.example.com/',
      source: 'user_submission',
      ai_processed: false,
    };
    const accepted = {
      ...pending,
      ai_processed: true,
      is_portfolio: true,
    };

    expect(normalizePortfolio(pending)).toBeNull();
    expect(normalizePortfolio(accepted)).toMatchObject({
      name: 'Pending',
      url: 'https://pending.example.com/',
    });
  });
});
