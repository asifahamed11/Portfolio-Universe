import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

async function sync() {
  console.log('Fetching all portfolios from Firestore...');
  try {
    const snapshot = await getDocs(collection(db, 'portfolios'));
    const portfolios = snapshot.docs.map(doc => doc.data());

    console.log(`Successfully fetched ${portfolios.length} portfolios from database.`);

    // Sort by views if available
    portfolios.sort((a, b) => (b.views || 0) - (a.views || 0));

    // Save to local JSON file
    fs.writeFileSync(DATA_FILE, JSON.stringify(portfolios, null, 2), 'utf-8');
    
    console.log(`Successfully saved ${portfolios.length} portfolios to src/data/portfolios.json.`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to sync Firestore data to JSON:', error);
    process.exit(1);
  }
}

sync();
