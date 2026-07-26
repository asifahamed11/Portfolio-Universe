import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  canonicalUrlKey,
  normalizeAndDedupe,
  normalizePortfolioUrl,
  writeJsonAtomic,
} from './update-data.js';
import { filterPublishablePortfolios } from './portfolio-publication.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');
const BACKUP_FILE = `${DATA_FILE}.bak`;
const EXPLICIT_EXPORT_FLAG = 'ALLOW_FIRESTORE_EXPORT';
const DEFAULT_MINIMUM_COUNT = 1000;
const MINIMUM_OVERLAP_RATIO = 0.8;
const EXPECTED_PROJECT_ID = 'portfolio-universe';
const ADMIN_APP_NAME = 'portfolio-universe-export';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is required for a Firestore export.');
  }

  let account;
  try {
    account = JSON.parse(raw);
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY is invalid JSON: ${error.message}`);
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
    throw new Error(`Firebase credentials must be for ${EXPECTED_PROJECT_ID}.`);
  }
  return account;
}

function exportCounter(raw) {
  const url = normalizePortfolioUrl(raw.url);
  if (!url) return null;

  return {
    key: canonicalUrlKey(url),
    views: Number.isInteger(raw.views) && raw.views >= 0 ? raw.views : 0,
  };
}

function safeCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function readExistingData() {
  try {
    const current = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(current)) {
      throw new TypeError(`${DATA_FILE} must contain a JSON array.`);
    }
    return current;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function sync() {
  if (process.env[EXPLICIT_EXPORT_FLAG] !== '1') {
    throw new Error(
      `Refusing to overwrite tracked data. Set ${EXPLICIT_EXPORT_FLAG}=1 for an intentional export.`,
    );
  }

  const existing = normalizeAndDedupe(await readExistingData());
  if (existing.rejected > 0 || existing.duplicates > 0) {
    throw new Error(
      `Local data validation failed (${existing.rejected} invalid, `
      + `${existing.duplicates} duplicate); normalize it before exporting.`,
    );
  }
  const publishableRecords = filterPublishablePortfolios(existing.records);
  const existingCount = publishableRecords.length;
  if (existingCount === 0) {
    throw new Error(
      'The local source-of-truth data set is empty or missing; '
      + 'Firestore view export cannot reconstruct portfolio metadata.',
    );
  }
  const configuredMinimum = Number.parseInt(
    process.env.MIN_PORTFOLIO_EXPORT_COUNT || String(DEFAULT_MINIMUM_COUNT),
    10,
  );
  const minimumCount = Math.max(
    Number.isFinite(configuredMinimum) ? configuredMinimum : DEFAULT_MINIMUM_COUNT,
    Math.floor(existingCount * 0.8),
  );

  const serviceAccount = loadServiceAccount();
  const app = getApps().find((candidate) => candidate.name === ADMIN_APP_NAME)
    || initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: EXPECTED_PROJECT_ID,
      },
      ADMIN_APP_NAME,
    );
  const snapshot = await getFirestore(app).collection('portfolios').get();

  const exportedCounters = snapshot.docs.map((document) => exportCounter(document.data()));
  const invalidDocumentCount = exportedCounters.filter((record) => record === null).length;
  if (invalidDocumentCount > 0) {
    throw new Error(
      `Firestore contains ${invalidDocumentCount} portfolio documents with invalid URLs. `
      + 'The local file was not changed.',
    );
  }
  const firestoreByKey = new Map();
  for (const counter of exportedCounters.filter(Boolean)) {
    if (firestoreByKey.has(counter.key)) {
      throw new Error(
        `Firestore contains duplicate canonical URL ${counter.key}. `
        + 'The local file was not changed.',
      );
    }
    firestoreByKey.set(counter.key, counter.views);
  }

  if (firestoreByKey.size < minimumCount) {
    throw new Error(
      `Firestore returned ${firestoreByKey.size} valid portfolios; `
      + `the safety minimum is ${minimumCount}. The local file was not changed.`,
    );
  }

  if (existingCount > 0) {
    const overlap = publishableRecords.reduce(
      (count, record) => count + Number(
        firestoreByKey.has(canonicalUrlKey(record.url)),
      ),
      0,
    );
    const requiredOverlap = Math.floor(existingCount * MINIMUM_OVERLAP_RATIO);
    if (overlap < requiredOverlap) {
      throw new Error(
        `Firestore overlaps only ${overlap}/${existingCount} local portfolios; `
        + `at least ${requiredOverlap} are required. The local file was not changed.`,
      );
    }
  }

  let preventedViewRegressions = 0;
  const mergedRecords = existing.records.map((record) => {
    const localViews = safeCounter(record.views);
    const firestoreViews = firestoreByKey.get(canonicalUrlKey(record.url));
    if (firestoreViews !== undefined && firestoreViews < localViews) {
      preventedViewRegressions += 1;
    }
    return {
      ...record,
      views: firestoreViews === undefined
        ? localViews
        : Math.max(localViews, firestoreViews),
    };
  });
  const normalized = normalizeAndDedupe(mergedRecords);
  if (normalized.rejected > 0 || normalized.duplicates > 0) {
    throw new Error(
      `Merged export validation failed (${normalized.rejected} invalid, `
      + `${normalized.duplicates} duplicate). The local file was not changed.`,
    );
  }

  normalized.records.sort(
    (left, right) => (right.views - left.views) || left.url.localeCompare(right.url),
  );

  if (existingCount > 0) {
    await fs.copyFile(DATA_FILE, BACKUP_FILE);
  }
  await writeJsonAtomic(DATA_FILE, normalized.records);
  if (preventedViewRegressions > 0) {
    console.warn(
      `Preserved higher local view totals for ${preventedViewRegressions} portfolios.`,
    );
  }
  console.log(
    `Exported ${normalized.records.length} validated portfolios. `
    + `Previous data was backed up to ${BACKUP_FILE}.`,
  );
}

sync().catch((error) => {
  console.error('Firestore export failed:', error);
  process.exitCode = 1;
});
