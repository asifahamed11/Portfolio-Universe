import fs from 'node:fs/promises';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const RULES_FILE = path.join(process.cwd(), 'firestore.rules');
const EXPECTED_PROJECT_ID = 'portfolio-universe';
const ADMIN_APP_NAME = 'portfolio-universe-rules';
const MAX_RULESET_BYTES = 256 * 1024;

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is required to deploy Firestore rules.');
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

async function deploy() {
  const [serviceAccount, source] = await Promise.all([
    Promise.resolve(loadServiceAccount()),
    fs.readFile(RULES_FILE, 'utf8'),
  ]);
  if (!source.trim()) throw new Error('Refusing to deploy an empty Firestore ruleset.');
  if (Buffer.byteLength(source, 'utf8') > MAX_RULESET_BYTES) {
    throw new Error(`Firestore rules exceed the ${MAX_RULESET_BYTES}-byte limit.`);
  }

  const app = getApps().find((candidate) => candidate.name === ADMIN_APP_NAME)
    || initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: EXPECTED_PROJECT_ID,
      },
      ADMIN_APP_NAME,
    );
  const ruleset = await getSecurityRules(app).releaseFirestoreRulesetFromSource(source);
  console.log(`Deployed Firestore ruleset ${ruleset.name} to ${EXPECTED_PROJECT_ID}.`);
}

deploy().catch((error) => {
  console.error('Firestore rules deployment failed:', error);
  process.exitCode = 1;
});
