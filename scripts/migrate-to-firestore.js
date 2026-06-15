import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');

const firebaseConfig = {
  apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: "portfolio-universe.firebaseapp.com",
  projectId: "portfolio-universe",
  storageBucket: "portfolio-universe.firebasestorage.app",
  messagingSenderId: "893366203418",
  appId: "1:893366203418:web:13b69c585c49a443268da3"
};

if (!firebaseConfig.apiKey) {
  console.error("ERROR: PUBLIC_FIREBASE_API_KEY is not set in .env");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
  
  const portfoliosRef = collection(db, 'portfolios');
  
  let successCount = 0;
  for (let i = 0; i < portfolios.length; i++) {
    const p = portfolios[i];
    const key = urlToKey(p.url);
    
    try {
      await setDoc(doc(portfoliosRef, key), {
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
        views: 0 // Initialize views
      }, { merge: true });
      successCount++;
      process.stdout.write(`\rMigrated ${successCount}/${portfolios.length}...`);
    } catch (e) {
      console.error(`\nFailed to migrate ${p.url}:`, e.message);
    }
  }
  
  console.log(`\nMigration completed successfully. Migrated ${successCount} items.`);
  process.exit(0);
}

migrate();
