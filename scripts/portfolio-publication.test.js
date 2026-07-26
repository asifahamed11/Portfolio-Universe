import { describe, expect, it } from 'vitest';
import {
  filterPublishablePortfolios,
  isPublishablePortfolio,
} from './portfolio-publication.js';

describe('public portfolio selection', () => {
  it('excludes explicit review/rejection records and keeps historical records', () => {
    const historical = { url: 'https://historical.example' };
    const accepted = { url: 'https://accepted.example', is_portfolio: true };
    const privateReview = { url: 'https://queued.example', is_portfolio: false };

    expect(filterPublishablePortfolios([
      historical,
      accepted,
      privateReview,
    ])).toEqual([historical, accepted]);
    expect(isPublishablePortfolio(privateReview)).toBe(false);
  });

  it('fails closed for marked reviews even when their classification is missing', () => {
    expect(isPublishablePortfolio({
      url: 'https://private.example',
      __private_submission_review_id: 'private-id',
      ai_processed: false,
    })).toBe(false);
    expect(isPublishablePortfolio({
      url: 'https://accepted.example',
      __private_submission_review_id: 'accepted-id',
      ai_processed: true,
      is_portfolio: true,
    })).toBe(true);
  });

  it('rejects non-record values', () => {
    expect(isPublishablePortfolio(null)).toBe(false);
    expect(isPublishablePortfolio([])).toBe(false);
    expect(() => filterPublishablePortfolios({})).toThrow(TypeError);
  });
});
