import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildPublicPortfolioSnapshot,
  markPrivateSubmissionRecord,
  PRIVATE_REVIEW_MARKER,
  toPrivateReviewRecord,
} from './submission-review-state.js';

describe('private submission review snapshots', () => {
  it('never checks a private submission marker into the public data source', () => {
    const dataFile = fileURLToPath(
      new URL('../src/data/portfolios.json', import.meta.url),
    );
    const records = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

    expect(records.some(
      (record) => record && Object.hasOwn(record, PRIVATE_REVIEW_MARKER),
    )).toBe(false);
  });

  it('strips queued and rejected private records from commit-ready data', () => {
    const queued = markPrivateSubmissionRecord({
      url: 'https://queued.example',
      is_portfolio: false,
      ai_processed: false,
    }, 'queued-user');
    const rejected = markPrivateSubmissionRecord({
      url: 'https://rejected.example',
      is_portfolio: false,
      ai_processed: true,
    }, 'rejected-user');
    const upstreamCandidate = {
      url: 'https://public-upstream.example',
      is_portfolio: false,
    };

    expect(buildPublicPortfolioSnapshot([
      queued,
      rejected,
      upstreamCandidate,
    ])).toEqual([upstreamCandidate]);
  });

  it('publishes an accepted review without its private marker', () => {
    const accepted = markPrivateSubmissionRecord({
      url: 'https://accepted.example',
      name: 'Accepted',
      is_portfolio: true,
      ai_processed: true,
    }, 'accepted-user');

    const [snapshot] = buildPublicPortfolioSnapshot([accepted]);
    expect(snapshot).toEqual({
      url: 'https://accepted.example',
      name: 'Accepted',
      is_portfolio: true,
      ai_processed: true,
    });
    expect(snapshot).not.toHaveProperty(PRIVATE_REVIEW_MARKER);
  });

  it('persists review state without leaking the internal submission id', () => {
    const queued = markPrivateSubmissionRecord({
      url: 'https://queued.example',
      ai_attempts: 3,
    }, 'private-user-id');

    expect(toPrivateReviewRecord(queued)).toEqual({
      url: 'https://queued.example',
      ai_attempts: 3,
    });
    expect(queued[PRIVATE_REVIEW_MARKER]).toBe('private-user-id');
  });
});
