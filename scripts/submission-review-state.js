export const PRIVATE_REVIEW_MARKER = '__private_submission_review_id';
const MAX_REVIEW_RECORD_BYTES = 200 * 1024;

export function markPrivateSubmissionRecord(record, submissionId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('A portfolio record is required.');
  }
  if (typeof submissionId !== 'string' || !submissionId) {
    throw new TypeError('A submission document id is required.');
  }
  record[PRIVATE_REVIEW_MARKER] = submissionId;
  return record;
}

export function toPrivateReviewRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('A portfolio record is required.');
  }

  const reviewRecord = structuredClone(record);
  delete reviewRecord[PRIVATE_REVIEW_MARKER];
  const serialized = JSON.stringify(reviewRecord);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REVIEW_RECORD_BYTES) {
    throw new Error('A private submission review record exceeded the size limit.');
  }
  return reviewRecord;
}

/**
 * Remove private review candidates from a snapshot that may be committed.
 * Successfully reviewed portfolios are retained, but their internal marker is
 * always removed. Unmarked upstream/history records are preserved.
 */
export function buildPublicPortfolioSnapshot(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Portfolio records must be an array.');
  }

  const publicRecords = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('Every portfolio record must be an object.');
    }

    const snapshot = structuredClone(record);
    const isPrivateReview = typeof snapshot[PRIVATE_REVIEW_MARKER] === 'string'
      && snapshot[PRIVATE_REVIEW_MARKER].length > 0;
    delete snapshot[PRIVATE_REVIEW_MARKER];

    if (
      isPrivateReview
      && !(snapshot.ai_processed === true && snapshot.is_portfolio === true)
    ) {
      continue;
    }
    publicRecords.push(snapshot);
  }
  return publicRecords;
}
