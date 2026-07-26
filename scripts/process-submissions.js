import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { pathToFileURL } from 'url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  canonicalUrlKey,
  normalizeAndDedupe,
  normalizePortfolioUrl,
  sanitizeName,
  writeJsonAtomic,
} from './update-data.js';
import {
  buildPublicPortfolioSnapshot,
  markPrivateSubmissionRecord,
  PRIVATE_REVIEW_MARKER,
  toPrivateReviewRecord,
} from './submission-review-state.js';

const DATA_FILE = path.join(process.cwd(), 'src', 'data', 'portfolios.json');
const PRIVATE_DATA_FILE = `${DATA_FILE}.review-private`;
const EXPECTED_PROJECT_ID = 'portfolio-universe';
const ADMIN_APP_NAME = 'portfolio-universe-submissions';
const REVIEW_BATCH_LIMIT = 40;
const MODE_FLAGS = new Map([
  ['--checkpoint', 'checkpoint'],
  ['--discard-private', 'discard-private'],
  ['--finalize', 'finalize'],
  ['--prepare-public', 'prepare-public'],
  ['--restore-private', 'restore-private'],
]);

export function parseServiceAccount(raw) {
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is required to process submissions.');
  }

  let account;
  try {
    account = JSON.parse(raw);
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: ${error.message}`);
  }

  if (account && typeof account === 'object' && account.private_key) {
    account.private_key = account.private_key.replace(/\\n/g, '\n');
  }
  if (
    !account
    || typeof account !== 'object'
    || account.project_id !== EXPECTED_PROJECT_ID
    || typeof account.client_email !== 'string'
    || typeof account.private_key !== 'string'
  ) {
    throw new Error(`Credentials must be for ${EXPECTED_PROJECT_ID}.`);
  }
  return account;
}

function loadServiceAccount() {
  return parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
}

function selectedMode(argv) {
  const selected = [...MODE_FLAGS]
    .filter(([flag]) => argv.includes(flag))
    .map(([, mode]) => mode);
  if (selected.length > 1) {
    throw new Error(`Choose only one submission-processing mode: ${selected.join(', ')}.`);
  }
  return selected[0] || 'queue';
}

function isSafeSubmissionUrl(value) {
  const normalized = normalizePortfolioUrl(value);
  if (!normalized) return false;

  const hostname = new URL(normalized).hostname.toLowerCase().replace(/\.$/u, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || net.isIP(hostname) !== 0
  ) {
    return false;
  }

  return true;
}

async function loadPortfolios() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const normalized = normalizeAndDedupe(parsed);
  if (normalized.rejected > 0 || normalized.duplicates > 0) {
    throw new Error(
      `Local data validation failed (${normalized.rejected} invalid, `
      + `${normalized.duplicates} duplicate). Run npm run normalize-data first.`,
    );
  }
  return normalized.records;
}

async function preparePublicSnapshot(portfolios) {
  try {
    await fs.access(PRIVATE_DATA_FILE);
    throw new Error(
      `Refusing to overwrite the existing private review recovery file: ${PRIVATE_DATA_FILE}`,
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const publicSnapshot = buildPublicPortfolioSnapshot(portfolios);
  await writeJsonAtomic(PRIVATE_DATA_FILE, portfolios);
  try {
    await writeJsonAtomic(DATA_FILE, publicSnapshot);
  } catch (error) {
    throw new Error(
      `Could not prepare the public snapshot; private state remains in ${PRIVATE_DATA_FILE}: `
      + error.message,
    );
  }
  console.log(
    `Prepared ${publicSnapshot.length} public records and withheld `
    + `${portfolios.length - publicSnapshot.length} private review records.`,
  );
}

async function restorePrivateSnapshot() {
  let privateRecords;
  try {
    const raw = await fs.readFile(PRIVATE_DATA_FILE, 'utf8');
    privateRecords = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not read the private review recovery file: ${error.message}`);
  }

  const normalized = normalizeAndDedupe(privateRecords);
  if (normalized.rejected > 0 || normalized.duplicates > 0) {
    throw new Error(
      `Private review recovery validation failed (${normalized.rejected} invalid, `
      + `${normalized.duplicates} duplicate). The public data file was not changed.`,
    );
  }

  await writeJsonAtomic(DATA_FILE, normalized.records);
  await fs.rm(PRIVATE_DATA_FILE);
  console.log(`Restored ${normalized.records.length} records of private review state.`);
}

async function discardPrivateSnapshot() {
  try {
    await fs.rm(PRIVATE_DATA_FILE);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('The private review recovery file does not exist.');
    }
    throw error;
  }
  console.log('Removed the private review recovery file.');
}

function hydrateReviewRecord(submission, expectedUrl) {
  const rawRecord = submission?.reviewRecord;
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    return null;
  }

  const normalized = normalizeAndDedupe([{
    ...rawRecord,
    [PRIVATE_REVIEW_MARKER]: undefined,
  }]);
  if (
    normalized.rejected > 0
    || normalized.duplicates > 0
    || normalized.records.length !== 1
    || canonicalUrlKey(normalized.records[0].url) !== canonicalUrlKey(expectedUrl)
  ) {
    return null;
  }
  delete normalized.records[0][PRIVATE_REVIEW_MARKER];
  return normalized.records[0];
}

function createReviewRecord(submission, url) {
  return {
    url,
    name: sanitizeName(submission.name, url),
    role: '',
    specialization: '',
    summary: '',
    tech_stack: [],
    projects: [],
    social_links: [],
    available_for_hire: false,
    primary_language: '',
    views: 0,
    has_blog: false,
    is_portfolio: false,
    ai_processed: false,
    screenshot: `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=600`,
  };
}

async function fetchSubmissions(db, statuses) {
  const snapshots = await Promise.all(
    statuses.map((status) => db.collection('submissions').where('status', '==', status).get()),
  );

  const documents = new Map();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      documents.set(document.id, document);
    }
  }
  return [...documents.values()];
}

async function commitStatusUpdates(db, updates) {
  for (let offset = 0; offset < updates.length; offset += REVIEW_BATCH_LIMIT) {
    const batch = db.batch();
    for (const update of updates.slice(offset, offset + REVIEW_BATCH_LIMIT)) {
      batch.update(update.ref, {
        ...update.data,
        processedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

function clearedReviewState(data) {
  return {
    ...data,
    reviewRecord: FieldValue.delete(),
    reviewUpdatedAt: FieldValue.delete(),
  };
}

async function checkpointSubmissionReviews(db, portfolios) {
  const queued = await fetchSubmissions(db, ['queued']);
  const queuedById = new Map(queued.map((document) => [document.id, document]));
  const recordsBySubmissionId = new Map();

  for (const portfolio of portfolios) {
    const submissionId = portfolio[PRIVATE_REVIEW_MARKER];
    if (typeof submissionId !== 'string' || !submissionId) continue;
    if (recordsBySubmissionId.has(submissionId)) {
      throw new Error('Multiple local review records reference the same private submission.');
    }
    recordsBySubmissionId.set(submissionId, portfolio);
  }

  const updates = [];
  for (const [submissionId, portfolio] of recordsBySubmissionId) {
    const document = queuedById.get(submissionId);
    if (!document) continue;
    const submissionUrl = normalizePortfolioUrl(document.data().url);
    if (
      !submissionUrl
      || canonicalUrlKey(submissionUrl) !== canonicalUrlKey(portfolio.url)
    ) {
      throw new Error(
        'A private review record no longer matches its submission URL.',
      );
    }
    updates.push({ document, portfolio });
  }

  for (let offset = 0; offset < updates.length; offset += REVIEW_BATCH_LIMIT) {
    const batch = db.batch();
    for (
      const { document, portfolio }
      of updates.slice(offset, offset + REVIEW_BATCH_LIMIT)
    ) {
      batch.update(document.ref, {
        reviewRecord: toPrivateReviewRecord(portfolio),
        reviewUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  console.log(`Checkpointed ${updates.length} private submission review records.`);
}

async function finalizeQueuedSubmissions(db, portfolios) {
  const knownPortfolios = new Map(
    portfolios.map((portfolio) => [canonicalUrlKey(portfolio.url), portfolio]),
  );
  const queued = await fetchSubmissions(db, ['queued']);
  const updates = [];

  for (const document of queued) {
    const url = normalizePortfolioUrl(document.data().url);
    const key = canonicalUrlKey(url);
    const portfolio = key ? knownPortfolios.get(key) : null;
    if (!portfolio?.ai_processed) continue;

    updates.push({
      ref: document.ref,
      data: clearedReviewState(portfolio.is_portfolio === true
        ? { status: 'accepted', reason: 'Added to the portfolio data set.' }
        : {
            status: 'rejected',
            reason: portfolio.ai_terminal_failure === true
              ? 'Automated review could not retrieve or analyze this URL after repeated attempts.'
              : 'Automated review did not identify a portfolio.',
          }),
    });
  }

  await commitStatusUpdates(db, updates);
  console.log(`Finalized ${updates.length} AI-reviewed submissions.`);
}

async function queuePendingSubmissions(db, portfolios) {
  const byUrl = new Map(
    portfolios.map((portfolio) => [canonicalUrlKey(portfolio.url), portfolio]),
  );
  const submissions = await fetchSubmissions(db, ['pending', 'queued']);
  const updates = [];
  let added = 0;
  let requeued = 0;
  let rejected = 0;
  let duplicates = 0;
  let changedLocalData = false;

  const queueForReview = (document, record, reason) => {
    updates.push({
      ref: document.ref,
      data: {
        status: 'queued',
        reason,
        reviewRecord: toPrivateReviewRecord(record),
        reviewUpdatedAt: FieldValue.serverTimestamp(),
      },
    });
  };

  for (const document of submissions) {
    const submission = document.data();
    const url = normalizePortfolioUrl(submission.url);
    const key = canonicalUrlKey(url);

    if (!url || !key || !isSafeSubmissionUrl(url)) {
      updates.push({
        ref: document.ref,
        data: clearedReviewState({
          status: 'rejected',
          reason: 'The submitted URL is invalid or unsafe.',
        }),
      });
      rejected++;
      continue;
    }

    const existingPortfolio = byUrl.get(key);
    const existingOwner = existingPortfolio?.[PRIVATE_REVIEW_MARKER];
    if (existingOwner && existingOwner !== document.id) {
      updates.push({
        ref: document.ref,
        data: clearedReviewState({
          status: 'duplicate',
          reason: 'This URL is already queued by another submission.',
        }),
      });
      duplicates++;
      continue;
    }

    if (
      existingPortfolio?.ai_terminal_failure === true
      && submission.status === 'pending'
    ) {
      existingPortfolio.name = sanitizeName(submission.name, url);
      existingPortfolio.ai_processed = false;
      existingPortfolio.is_portfolio = false;
      for (const field of [
        'ai_attempts',
        'ai_terminal_attempts',
        'ai_last_attempt_at',
        'ai_last_error',
        'ai_next_retry_at',
        'ai_terminal_failure',
      ]) {
        delete existingPortfolio[field];
      }
      markPrivateSubmissionRecord(existingPortfolio, document.id);
      queueForReview(
        document,
        existingPortfolio,
        'Queued for another automated review attempt.',
      );
      changedLocalData = true;
      requeued++;
      continue;
    }

    if (existingPortfolio) {
      if (submission.status === 'pending') {
        updates.push({
          ref: document.ref,
          data: clearedReviewState({
            status: 'duplicate',
            reason: 'This portfolio is already in the data set.',
          }),
        });
        duplicates++;
        continue;
      }

      if (existingPortfolio.is_portfolio === true && existingPortfolio.ai_processed === true) {
        // A previous run published the accepted record but did not get as far
        // as finalizing the private submission document.
        continue;
      }

      const persistedRecord = hydrateReviewRecord(submission, url);
      if (!persistedRecord && !existingOwner && existingPortfolio.is_portfolio !== false) {
        updates.push({
          ref: document.ref,
          data: clearedReviewState({
            status: 'duplicate',
            reason: 'This portfolio is already in the data set.',
          }),
        });
        duplicates++;
        continue;
      }
      if (persistedRecord) {
        for (const field of Object.keys(existingPortfolio)) delete existingPortfolio[field];
        Object.assign(existingPortfolio, persistedRecord);
      }
      markPrivateSubmissionRecord(existingPortfolio, document.id);
      queueForReview(document, existingPortfolio, 'Queued for automated review.');
      changedLocalData = true;
      continue;
    }

    const record = markPrivateSubmissionRecord(
      hydrateReviewRecord(submission, url) || createReviewRecord(submission, url),
      document.id,
    );

    portfolios.push(record);
    byUrl.set(key, record);
    queueForReview(document, record, 'Queued for automated review.');
    changedLocalData = true;
    added++;
  }

  // Move Firestore state first. If the subsequent local write fails, queued
  // submissions remain discoverable and the next run safely retries them.
  await commitStatusUpdates(db, updates);
  if (changedLocalData) {
    await writeJsonAtomic(DATA_FILE, portfolios);
  }

  console.log(
    `Submission review queued ${added}, requeued ${requeued}, rejected ${rejected}, `
    + `and marked ${duplicates} duplicates.`,
  );
}

async function run() {
  const mode = selectedMode(process.argv.slice(2));
  if (mode === 'discard-private') {
    await discardPrivateSnapshot();
    return;
  }
  if (mode === 'restore-private') {
    await restorePrivateSnapshot();
    return;
  }

  const portfolios = await loadPortfolios();
  if (mode === 'prepare-public') {
    await preparePublicSnapshot(portfolios);
    return;
  }

  const serviceAccount = loadServiceAccount();
  const app = getApps().find((candidate) => candidate.name === ADMIN_APP_NAME)
    || initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: EXPECTED_PROJECT_ID,
      },
      ADMIN_APP_NAME,
    );
  const db = getFirestore(app);

  if (mode === 'finalize') {
    await finalizeQueuedSubmissions(db, portfolios);
  } else if (mode === 'checkpoint') {
    await checkpointSubmissionReviews(db, portfolios);
  } else {
    await queuePendingSubmissions(db, portfolios);
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  run().catch((error) => {
    console.error('Submission processing failed:', error);
    process.exitCode = 1;
  });
}
