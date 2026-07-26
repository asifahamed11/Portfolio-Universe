import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  canonicalUrlKey,
  normalizeAndDedupe,
  normalizePortfolioUrl,
  repairPortfolioUrlCandidate,
} from './update-data.js';

const DATA_FILE = path.join(process.cwd(), 'src', 'data', 'portfolios.json');
const EXPECTED_PROJECT_ID = 'portfolio-universe';
const ADMIN_APP_NAME = 'portfolio-universe-like-aggregation';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is required to rebuild global likes.');
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

function urlToKey(url) {
  return createHash('sha256').update(canonicalUrlKey(url), 'utf8').digest('hex');
}

export function normalizeLegacyBookmarkUrl(rawUrl) {
  return normalizePortfolioUrl(repairPortfolioUrlCandidate(rawUrl));
}

async function loadPublishedPortfolios() {
  const parsed = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  const normalized = normalizeAndDedupe(parsed);
  if (normalized.rejected > 0 || normalized.duplicates > 0) {
    throw new Error(
      `Local data validation failed (${normalized.rejected} invalid, `
      + `${normalized.duplicates} duplicate).`,
    );
  }

  return new Map(
    normalized.records
      .filter((portfolio) => portfolio.is_portfolio !== false)
      .map((portfolio) => [canonicalUrlKey(portfolio.url), portfolio.url]),
  );
}

async function rebuild() {
  const [serviceAccount, publishedPortfolios] = await Promise.all([
    Promise.resolve(loadServiceAccount()),
    loadPublishedPortfolios(),
  ]);
  const app = getApps().find((candidate) => candidate.name === ADMIN_APP_NAME)
    || initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: EXPECTED_PROJECT_ID,
      },
      ADMIN_APP_NAME,
    );
  const db = getFirestore(app);
  const usersSnapshot = await db.collection('users').get();
  const counts = new Map();

  for (const userDocument of usersSnapshot.docs) {
    const bookmarks = userDocument.data().bookmarks;
    if (!Array.isArray(bookmarks)) continue;

    const countedForUser = new Set();
    for (const rawUrl of bookmarks.slice(0, 2000)) {
      const url = normalizeLegacyBookmarkUrl(rawUrl);
      if (!url) continue;

      const identity = canonicalUrlKey(url);
      const publishedUrl = publishedPortfolios.get(identity);
      if (!publishedUrl || countedForUser.has(identity)) continue;

      countedForUser.add(identity);
      const key = urlToKey(publishedUrl);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const aggregate = Object.fromEntries(counts);
  await db.collection('global_stats').doc('likes').set(aggregate);
  console.log(
    `Rebuilt ${counts.size} aggregate counters from ${usersSnapshot.size} user documents.`,
  );
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  rebuild().catch((error) => {
    console.error('Global like aggregation failed:', error);
    process.exitCode = 1;
  });
}
