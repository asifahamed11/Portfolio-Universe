import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');
const ROOT_DIR = path.join(__dirname, '..');

let serviceAccount = null;

// Try to load service account from environment variable first
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    console.log('Loaded service account key from environment.');
  } catch (e) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_KEY from env:', e.message);
  }
}

// Fallback to searching for local JSON file starting with 'portfolio-universe-firebase-adminsdk-'
if (!serviceAccount) {
  try {
    const files = fs.readdirSync(ROOT_DIR);
    const keyFile = files.find(f => f.startsWith('portfolio-universe-firebase-adminsdk-') && f.endsWith('.json'));
    if (keyFile) {
      const filePath = path.join(ROOT_DIR, keyFile);
      serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      console.log(`Loaded service account key from file: ${keyFile}`);
    }
  } catch (e) {
    console.error('Error searching for service account JSON file:', e.message);
  }
}

if (!serviceAccount) {
  console.error('ERROR: Firebase Service Account Key not found in env (FIREBASE_SERVICE_ACCOUNT_KEY) or in local json file.');
  process.exit(1);
}

if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

// Initialize Firebase Admin SDK
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

export const urlToKey = (url) => {
  try {
    return btoa(encodeURIComponent(url)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  } catch (e) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = Math.imul(31, hash) + url.charCodeAt(i) | 0;
    }
    return `hash_${hash >>> 0}`;
  }
};

async function migrate() {
  console.log('Loading portfolio data...');
  let portfolios = [];
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    portfolios = JSON.parse(data);
  } catch (err) {
    console.error('Error reading portfolios.json:', err);
    process.exit(1);
  }

  console.log(`Found ${portfolios.length} portfolios to migrate.`);
  
  const portfoliosRef = db.collection('portfolios');
  
  let successCount = 0;
  const batches = [];
  let currentBatch = db.batch();
  let opCount = 0;

  for (let i = 0; i < portfolios.length; i++) {
    const p = portfolios[i];
    const key = urlToKey(p.url);
    const docRef = portfoliosRef.doc(key);
    
    currentBatch.set(docRef, {
      name: p.name || "",
      url: p.url || "",
      screenshot: p.screenshot || `https://s0.wp.com/mshots/v1/${encodeURIComponent(p.url)}?w=600`,
      summary: p.summary || "",
      role: p.role || "",
      tech_stack: p.tech_stack || [],
      available_for_hire: p.available_for_hire || false,
      has_blog: p.has_blog || false,
      specialization: p.specialization || "",
      primary_language: p.primary_language || "",
      is_portfolio: p.is_portfolio !== false,
      portfolio_score: p.portfolio_score || 0,
      seo_evaluation: p.seo_evaluation || ""
    }, { merge: true });
    
    opCount++;
    if (opCount === 500) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      opCount = 0;
    }
  }
  
  if (opCount > 0) {
    batches.push(currentBatch);
  }
  
  console.log(`Created ${batches.length} batches. Writing to Firestore with delays to avoid quota limits...`);
  
  for (let i = 0; i < batches.length; i++) {
    try {
      await batches[i].commit();
      const docsInBatch = (i === batches.length - 1 && opCount > 0) ? opCount : 500;
      successCount += docsInBatch;
      console.log(`Committed batch ${i + 1}/${batches.length} (${successCount} docs migrated)`);
      if (i < batches.length - 1) {
        // Built-in delay to prevent overloading backend
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (e) {
      console.error(`\nFailed to commit batch ${i + 1}:`, e.message);
      process.exit(1);
    }
  }
  
  console.log(`\nMigration completed successfully. Migrated ${successCount} items.`);
  process.exit(0);
}

migrate();
