import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  canonicalUrlKey,
  normalizeAndDedupe,
  normalizePortfolioUrl,
  repairPortfolioUrlCandidate,
  sanitizeName,
} from './update-data.js';
import { filterPublishablePortfolios } from './portfolio-publication.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');
const ROOT_DIR = path.join(__dirname, '..');
const BATCH_LIMIT = 400;
const EXPECTED_PROJECT_ID = 'portfolio-universe';
const ADMIN_APP_NAME = 'portfolio-universe-migration';
const PRUNE_STALE = process.argv.includes('--prune');
const DEFAULT_MINIMUM_PRUNE_COUNT = 1000;
const MINIMUM_PRUNE_OVERLAP_RATIO = 0.8;

function validateServiceAccount(account) {
  if (
    !account
    || typeof account !== 'object'
    || account.project_id !== EXPECTED_PROJECT_ID
    || typeof account.client_email !== 'string'
    || typeof account.private_key !== 'string'
  ) {
    throw new Error(
      `Firebase credentials must be a service account for ${EXPECTED_PROJECT_ID}.`,
    );
  }
  return account;
}

async function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    let account;
    try {
      account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY is invalid JSON: ${error.message}`);
    }
    if (account && typeof account === 'object' && account.private_key) {
      account.private_key = account.private_key.replace(/\\n/g, '\n');
    }
    return validateServiceAccount(account);
  }

  const files = await fs.readdir(ROOT_DIR);
  const keyFile = files.find(
    (file) => file.startsWith('portfolio-universe-firebase-adminsdk-') && file.endsWith('.json'),
  );
  if (!keyFile) {
    throw new Error(
      'Firebase Admin credentials were not found. Set FIREBASE_SERVICE_ACCOUNT_KEY.',
    );
  }

  const account = JSON.parse(await fs.readFile(path.join(ROOT_DIR, keyFile), 'utf8'));
  if (account && typeof account === 'object' && account.private_key) {
    account.private_key = account.private_key.replace(/\\n/g, '\n');
  }
  return validateServiceAccount(account);
}

export function urlToKey(url) {
  const identity = canonicalUrlKey(url);
  if (!identity) throw new TypeError(`Cannot create a Firestore key for invalid URL: ${url}`);
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

function legacyUrlToKey(url) {
  return Buffer.from(encodeURIComponent(url), 'latin1').toString('base64url');
}

export function decodeLegacyUrlKey(key) {
  if (typeof key !== 'string' || !key) return null;
  try {
    const encodedUrl = Buffer.from(key, 'base64url').toString('latin1');
    const rawUrl = decodeURIComponent(encodedUrl);
    if (legacyUrlToKey(rawUrl) !== key) return null;
    return repairPortfolioUrlCandidate(rawUrl);
  } catch {
    return null;
  }
}

function legacyUrlVariants(url) {
  const normalized = normalizePortfolioUrl(url);
  if (!normalized) return [];

  const parsed = new URL(normalized);
  const variants = new Set([normalized]);
  const hostnames = new Set([
    parsed.hostname,
    parsed.hostname.startsWith('www.')
      ? parsed.hostname.slice(4)
      : `www.${parsed.hostname}`,
  ]);

  const addVariant = (protocol, hostname, trailingSlash) => {
    const variant = new URL(normalized);
    variant.protocol = protocol;
    variant.hostname = hostname;
    if (trailingSlash && !variant.pathname.endsWith('/')) variant.pathname += '/';
    let serialized = variant.toString();
    if (!trailingSlash && variant.pathname === '/') {
      serialized = serialized.replace(`${variant.origin}/`, variant.origin);
    }
    variants.add(serialized);
  };

  for (const protocol of ['https:', 'http:']) {
    for (const hostname of hostnames) {
      addVariant(protocol, hostname, false);
      addVariant(protocol, hostname, true);
    }
  }

  return [...variants];
}

export function legacyDocumentKeysForAliases(aliases) {
  const keys = new Set();
  for (const alias of aliases) {
    if (typeof alias !== 'string' || !alias) continue;
    keys.add(legacyUrlToKey(alias));
    for (const variant of legacyUrlVariants(alias)) {
      keys.add(legacyUrlToKey(variant));
    }
  }
  return [...keys];
}

export function countPublishablePruneCoverage(
  existingDocuments,
  localRecords,
  rawAliasesByIdentity = new Map(),
) {
  const publishableIdentities = new Set();
  const publishableDocumentIds = new Set();

  for (const portfolio of filterPublishablePortfolios(localRecords)) {
    const identity = canonicalUrlKey(portfolio.url);
    if (!identity) continue;
    publishableIdentities.add(identity);
    publishableDocumentIds.add(urlToKey(portfolio.url));
    for (const legacyId of legacyDocumentKeysForAliases([
      portfolio.url,
      ...(rawAliasesByIdentity.get(identity) || []),
    ])) {
      publishableDocumentIds.add(legacyId);
    }
  }

  return existingDocuments.reduce((covered, document) => {
    const storedIdentity = canonicalUrlKey(document.url);
    const decodedIdentity = canonicalUrlKey(decodeLegacyUrlKey(document.id));
    return covered + Number(
      publishableDocumentIds.has(document.id)
      || (storedIdentity && publishableIdentities.has(storedIdentity))
      || (decodedIdentity && publishableIdentities.has(decodedIdentity)),
    );
  }, 0);
}

function safeCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function sumSafeCounters(values) {
  let total = 0;
  for (const value of values) {
    const counter = safeCounter(value);
    total = counter > Number.MAX_SAFE_INTEGER - total
      ? Number.MAX_SAFE_INTEGER
      : total + counter;
  }
  return total;
}

export function reconcileViewCounters(localViews, targetViews, legacyViews = []) {
  const storedViews = sumSafeCounters([
    targetViews,
    ...(Array.isArray(legacyViews) ? legacyViews : []),
  ]);
  return Math.max(safeCounter(localViews), storedViews);
}

export function reconcileLikeCounterMap(
  existingLikes,
  plans,
  { pruneStale = false } = {},
) {
  const source = existingLikes && typeof existingLikes === 'object'
    ? existingLikes
    : {};
  const reconciled = pruneStale ? {} : { ...source };

  for (const plan of plans) {
    const sourceKeys = [...new Set(plan.sourceKeys)];
    const total = sumSafeCounters(sourceKeys.map((key) => source[key]));
    for (const key of sourceKeys) delete reconciled[key];
    if (total > 0) reconciled[plan.targetKey] = total;
  }

  return reconciled;
}

function cleanString(value, maxLength = 600) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, maxLength)
    : '';
}

function cleanStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item) => typeof item === 'string')
      .map((item) => cleanString(item, maxLength))
      .filter(Boolean),
  )].slice(0, maxItems);
}

function chunkMigrationPlans(plans, maximumWrites = BATCH_LIMIT) {
  const chunks = [];
  let chunk = [];
  let writes = 0;

  for (const plan of plans) {
    const planWrites = 1 + plan.legacyRefs.length;
    if (planWrites > maximumWrites) {
      throw new Error(
        `Portfolio ${plan.portfolio.url} requires ${planWrites} migration writes; `
        + `the safety limit is ${maximumWrites}.`,
      );
    }
    if (chunk.length > 0 && writes + planWrites > maximumWrites) {
      chunks.push(chunk);
      chunk = [];
      writes = 0;
    }
    chunk.push(plan);
    writes += planWrites;
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function toFirestoreRecord(portfolio) {
  const url = normalizePortfolioUrl(portfolio.url);
  if (!url) throw new TypeError('Portfolio URL is invalid.');

  const screenshot = normalizePortfolioUrl(portfolio.screenshot);
  return {
    url,
    name: sanitizeName(portfolio.name, url),
    screenshot: screenshot
      || `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=600`,
    summary: cleanString(portfolio.summary, 600),
    role: cleanString(portfolio.role, 80),
    specialization: cleanString(portfolio.specialization, 100),
    primary_language: cleanString(portfolio.primary_language, 40),
    location: cleanString(portfolio.location, 120),
    experience_level: cleanString(portfolio.experience_level, 40),
    tech_stack: cleanStringArray(portfolio.tech_stack, 12, 40),
    projects: cleanStringArray(portfolio.projects, 8, 120),
    social_links: cleanStringArray(portfolio.social_links, 10, 2048)
      .map(normalizePortfolioUrl)
      .filter(Boolean),
    available_for_hire: portfolio.available_for_hire === true,
    has_blog: portfolio.has_blog === true,
    is_portfolio: portfolio.is_portfolio !== false,
    portfolio_score: Number.isInteger(portfolio.portfolio_score)
      ? Math.max(0, Math.min(10, portfolio.portfolio_score))
      : 0,
    seo_evaluation: cleanString(portfolio.seo_evaluation, 40),
    ai_processed: portfolio.ai_processed === true,
    views: safeCounter(portfolio.views),
  };
}

async function loadPortfolioData() {
  const parsed = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  const normalized = normalizeAndDedupe(parsed);
  const rawAliasesByIdentity = new Map();
  for (const rawRecord of parsed) {
    const rawUrl = rawRecord && typeof rawRecord === 'object'
      ? rawRecord.url
      : null;
    const identity = canonicalUrlKey(repairPortfolioUrlCandidate(rawUrl));
    if (!identity || typeof rawUrl !== 'string') continue;
    const aliases = rawAliasesByIdentity.get(identity) || new Set();
    aliases.add(rawUrl);
    rawAliasesByIdentity.set(identity, aliases);
  }

  if (normalized.rejected > 0) {
    throw new Error(
      `Refusing a partial migration: ${normalized.rejected} portfolio records have invalid URLs.`,
    );
  }
  if (normalized.duplicates > 0) {
    throw new Error(
      `Refusing a partial migration: ${normalized.duplicates} duplicate URLs remain in the data set.`,
    );
  }

  return {
    portfolios: filterPublishablePortfolios(normalized.records).map(toFirestoreRecord),
    localRecords: normalized.records,
    rawAliasesByIdentity,
  };
}

async function migrate() {
  const [serviceAccount, portfolioData] = await Promise.all([
    loadServiceAccount(),
    loadPortfolioData(),
  ]);
  const {
    portfolios,
    localRecords,
    rawAliasesByIdentity,
  } = portfolioData;
  if (portfolios.length === 0) {
    throw new Error('Refusing to migrate an empty portfolio data set.');
  }

  const app = getApps().find((candidate) => candidate.name === ADMIN_APP_NAME)
    || initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: EXPECTED_PROJECT_ID,
      },
      ADMIN_APP_NAME,
    );
  const db = getFirestore(app);
  const portfoliosRef = db.collection('portfolios');
  const existingSnapshot = await portfoliosRef.get();
  const existingByCanonicalUrl = new Map();
  const existingByDecodedLegacyIdentity = new Map();
  const existingById = new Map(
    existingSnapshot.docs.map((document) => [document.id, document]),
  );

  for (const document of existingSnapshot.docs) {
    const rawUrl = document.data().url;
    let identity = null;
    try {
      identity = canonicalUrlKey(rawUrl);
    } catch {
      identity = null;
    }
    if (identity) {
      const matches = existingByCanonicalUrl.get(identity) || [];
      matches.push(document);
      existingByCanonicalUrl.set(identity, matches);
    }

    const decodedLegacyUrl = decodeLegacyUrlKey(document.id);
    const decodedIdentity = canonicalUrlKey(decodedLegacyUrl);
    if (decodedIdentity) {
      const matches = existingByDecodedLegacyIdentity.get(decodedIdentity) || [];
      matches.push(document);
      existingByDecodedLegacyIdentity.set(decodedIdentity, matches);
    }
  }

  console.log(`Migrating ${portfolios.length} validated portfolios to Firestore...`);
  const plans = portfolios.map((portfolio) => {
    const identity = canonicalUrlKey(portfolio.url);
    const targetId = urlToKey(portfolio.url);
    const matches = existingByCanonicalUrl.get(identity) || [];
    const decodedLegacyMatches = existingByDecodedLegacyIdentity.get(identity) || [];
    const legacyIds = legacyDocumentKeysForAliases([
      portfolio.url,
      ...(rawAliasesByIdentity.get(identity) || []),
    ]);
    const legacyDocuments = [
      ...matches,
      ...decodedLegacyMatches,
      ...legacyIds
        .map((legacyId) => existingById.get(legacyId))
        .filter(Boolean),
    ];
    return {
      portfolio,
      identity,
      targetRef: portfoliosRef.doc(targetId),
      legacyRefs: [...new Map(legacyDocuments
        .filter((document) => document.id !== targetId)
        .map((document) => [document.ref.path, document.ref])).values()],
    };
  });

  if (PRUNE_STALE) {
    if (process.env.ALLOW_FIRESTORE_PRUNE !== '1') {
      throw new Error(
        'Refusing to prune Firestore without ALLOW_FIRESTORE_PRUNE=1.',
      );
    }

    const configuredMinimum = Number.parseInt(
      process.env.MIN_FIRESTORE_PRUNE_COUNT
        || String(DEFAULT_MINIMUM_PRUNE_COUNT),
      10,
    );
    const minimumCount = Number.isSafeInteger(configuredMinimum)
      && configuredMinimum > 0
      ? configuredMinimum
      : DEFAULT_MINIMUM_PRUNE_COUNT;
    if (plans.length < minimumCount) {
      throw new Error(
        `Refusing to prune from only ${plans.length} local records; `
        + `at least ${minimumCount} are required.`,
      );
    }

    if (existingSnapshot.size > 0) {
      const coveredDocumentCount = countPublishablePruneCoverage(
        existingSnapshot.docs.map((document) => ({
          id: document.id,
          url: document.data().url,
        })),
        localRecords,
        rawAliasesByIdentity,
      );
      const overlapRatio = coveredDocumentCount / existingSnapshot.size;
      if (overlapRatio < MINIMUM_PRUNE_OVERLAP_RATIO) {
        throw new Error(
          `Refusing to prune with only ${coveredDocumentCount}/${existingSnapshot.size} `
          + `existing documents matched (${(overlapRatio * 100).toFixed(1)}%; `
          + `${MINIMUM_PRUNE_OVERLAP_RATIO * 100}% required).`,
        );
      }
    }
  }

  let reconciledLegacyDocuments = 0;
  let committedPortfolios = 0;
  for (const chunk of chunkMigrationPlans(plans)) {
    await db.runTransaction(async (transaction) => {
      const refsByPath = new Map();
      for (const plan of chunk) {
        refsByPath.set(plan.targetRef.path, plan.targetRef);
        for (const ref of plan.legacyRefs) refsByPath.set(ref.path, ref);
      }
      const snapshots = await Promise.all(
        [...refsByPath.values()].map((ref) => transaction.get(ref)),
      );
      const snapshotsByPath = new Map(
        snapshots.map((snapshot) => [snapshot.ref.path, snapshot]),
      );

      for (const plan of chunk) {
        const targetSnapshot = snapshotsByPath.get(plan.targetRef.path);
        const targetViews = targetSnapshot?.exists
          ? targetSnapshot.data().views
          : 0;
        const legacyViews = plan.legacyRefs.map((ref) => {
          const snapshot = snapshotsByPath.get(ref.path);
          return snapshot?.exists ? snapshot.data().views : 0;
        });
        const views = reconcileViewCounters(
          plan.portfolio.views,
          targetViews,
          legacyViews,
        );

        transaction.set(plan.targetRef, { ...plan.portfolio, views });
        for (const legacyRef of plan.legacyRefs) transaction.delete(legacyRef);
      }
    });

    reconciledLegacyDocuments += chunk.reduce(
      (count, plan) => count + plan.legacyRefs.length,
      0,
    );
    committedPortfolios += chunk.length;
    console.log(`Committed ${committedPortfolios}/${plans.length} portfolios.`);
  }

  let prunedDocuments = 0;
  if (PRUNE_STALE) {
    const desiredIdentities = new Set(plans.map((plan) => plan.identity));
    const desiredIds = new Set(plans.map((plan) => plan.targetRef.id));
    const staleDocuments = existingSnapshot.docs.filter((document) => {
      if (desiredIds.has(document.id)) return false;
      try {
        return !desiredIdentities.has(canonicalUrlKey(document.data().url));
      } catch {
        return true;
      }
    });

    for (let offset = 0; offset < staleDocuments.length; offset += BATCH_LIMIT) {
      const batch = db.batch();
      for (const document of staleDocuments.slice(offset, offset + BATCH_LIMIT)) {
        batch.delete(document.ref);
      }
      await batch.commit();
    }
    prunedDocuments = staleDocuments.length;
  }

  const likesRef = db.collection('global_stats').doc('likes');
  const likesSnapshot = await likesRef.get();
  if (likesSnapshot.exists) {
    const existingLikes = likesSnapshot.data();
    const decodedLikesByIdentity = new Map();
    for (const key of Object.keys(existingLikes)) {
      const rawUrl = decodeLegacyUrlKey(key);
      const identity = canonicalUrlKey(rawUrl);
      if (!identity) continue;
      const entry = decodedLikesByIdentity.get(identity) || {
        aliases: new Set(),
        keys: new Set(),
      };
      entry.aliases.add(rawUrl);
      entry.keys.add(key);
      decodedLikesByIdentity.set(identity, entry);
    }

    const likePlans = [];
    for (const portfolio of portfolios) {
      const identity = canonicalUrlKey(portfolio.url);
      const aliases = new Set([portfolio.url]);
      for (const rawAlias of rawAliasesByIdentity.get(identity) || []) {
        aliases.add(rawAlias);
      }
      for (const document of existingByCanonicalUrl.get(identity) || []) {
        const legacyUrl = document.data().url;
        if (typeof legacyUrl === 'string') aliases.add(legacyUrl);
      }
      const decodedLikes = decodedLikesByIdentity.get(identity);
      for (const decodedAlias of decodedLikes?.aliases || []) {
        aliases.add(decodedAlias);
      }

      const sourceKeys = new Set(legacyDocumentKeysForAliases([...aliases]));
      for (const decodedKey of decodedLikes?.keys || []) {
        sourceKeys.add(decodedKey);
      }
      const targetKey = urlToKey(portfolio.url);
      sourceKeys.add(targetKey);
      likePlans.push({ targetKey, sourceKeys: [...sourceKeys] });
    }

    const migratedLikes = reconcileLikeCounterMap(existingLikes, likePlans, {
      pruneStale: PRUNE_STALE,
    });
    await likesRef.set(migratedLikes);
    console.log(`Reconciled ${Object.keys(migratedLikes).length} aggregate like counters.`);
  }

  console.log(
    `Migration complete: ${plans.length} portfolio records updated, `
    + `${reconciledLegacyDocuments} legacy aliases reconciled, and `
    + `${prunedDocuments} stale documents pruned.`,
  );
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  migrate().catch((error) => {
    console.error('Firestore migration failed:', error);
    process.exitCode = 1;
  });
}
