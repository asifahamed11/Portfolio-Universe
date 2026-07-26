import { PRIVATE_REVIEW_MARKER } from './submission-review-state.js';

/**
 * Return true when a local portfolio record is eligible for public delivery.
 *
 * Historical records without an explicit flag remain publishable to preserve
 * the site's existing behavior. Review candidates and rejected submissions use
 * an explicit `false` value and must stay out of public Firestore documents.
 */
export function isPublishablePortfolio(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }

  const hasPrivateReviewMarker = typeof record[PRIVATE_REVIEW_MARKER] === 'string'
    && record[PRIVATE_REVIEW_MARKER].length > 0;
  if (hasPrivateReviewMarker) {
    return record.ai_processed === true && record.is_portfolio === true;
  }
  return record.is_portfolio !== false;
}

export function filterPublishablePortfolios(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Portfolio records must be an array.');
  }
  return records.filter(isPublishablePortfolio);
}
