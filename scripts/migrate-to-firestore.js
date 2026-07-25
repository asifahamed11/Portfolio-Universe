import fs from 'node:fs/promises';
import path from 'node:path';
import { FieldValue } from 'firebase-admin/firestore';
import {
  normalizePortfolioCollection,
  portfolioIdentity,
  toSafeHttpsUrl,
} from '../src/lib/portfolio.js';
import { urlToKey } from '../src/lib/utils.js';
import { getAdminFirestore } from './firebase-admin.js';

const dataFile = path.resolve(
  process.env.DATA_FILE || 'src/data/portfolios.json',
);
const reconcileDeletions =
  process.env.RECONCILE_DELETIONS?.toLowerCase() !== 'false';
const db = getAdminFirestore();

const source = JSON.parse(await fs.readFile(dataFile, 'utf8'));
if (!Array.isArray(source)) {
  throw new TypeError('Portfolio data must be a JSON array.');
}

const portfolios = normalizePortfolioCollection(source);
const targetDocuments = new Map(
  portfolios.map((portfolio) => [urlToKey(portfolio.url), portfolio]),
);
const existingSnapshot = await db.collection('portfolios').get();
const existingDocuments = new Map(
  existingSnapshot.docs.map((document) => [document.id, document]),
);

const sameValue = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
const operations = [];

for (const [documentId, portfolio] of targetDocuments) {
  const existing = existingDocuments.get(documentId);
  if (!existing || !sameValue(existing.data(), portfolio)) {
    operations.push({
      type: 'set',
      reference: db.collection('portfolios').doc(documentId),
      value: portfolio,
    });
  }
}

if (reconcileDeletions) {
  for (const [documentId, document] of existingDocuments) {
    if (!targetDocuments.has(documentId)) {
      operations.push({ type: 'delete', reference: document.ref });
    }
  }
}

for (let offset = 0; offset < operations.length; offset += 450) {
  const batch = db.batch();
  for (const operation of operations.slice(offset, offset + 450)) {
    if (operation.type === 'set') {
      batch.set(operation.reference, operation.value);
    } else {
      batch.delete(operation.reference);
    }
  }
  await batch.commit();
}

const acceptedIdentities = new Set(
  portfolios.map((portfolio) => portfolioIdentity(portfolio.url)),
);
const rejectedIdentities = new Set(
  source
    .filter((portfolio) => portfolio?.is_portfolio === false)
    .map((portfolio) => portfolioIdentity(portfolio.url))
    .filter(Boolean),
);
const reviewStates = new Map(
  source
    .filter((portfolio) => portfolio?.source === 'user_submission')
    .map((portfolio) => [
      portfolioIdentity(portfolio.url),
      portfolio.ai_state,
    ])
    .filter(([identity]) => Boolean(identity)),
);
const pendingSubmissions = await db
  .collection('submissions')
  .where('status', '==', 'pending')
  .get();
const submissionOperations = [];

for (const submission of pendingSubmissions.docs) {
  const identity = portfolioIdentity(
    toSafeHttpsUrl(submission.data().url),
  );
  if (identity && acceptedIdentities.has(identity)) {
    submissionOperations.push({
      reference: submission.ref,
      status: 'imported',
    });
  } else if (identity && rejectedIdentities.has(identity)) {
    submissionOperations.push({
      reference: submission.ref,
      status: 'rejected',
    });
  } else if (identity && reviewStates.get(identity) === 'dead_letter') {
    submissionOperations.push({
      reference: submission.ref,
      status: 'needs_review',
    });
  }
}

for (
  let offset = 0;
  offset < submissionOperations.length;
  offset += 450
) {
  const batch = db.batch();
  for (const operation of submissionOperations.slice(offset, offset + 450)) {
    batch.update(operation.reference, {
      status: operation.status,
      processedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

console.log(
  `Firestore reconciliation complete: ${portfolios.length} source portfolio(s), ${operations.length} portfolio mutation(s), ${submissionOperations.length} submission status update(s).`,
);
