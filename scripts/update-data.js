import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';

dotenv.config();

const README_URL = 'https://raw.githubusercontent.com/emmabostian/developer-portfolios/master/README.md';

const firebaseConfig = {
  apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: "portfolio-universe.firebaseapp.com",
  projectId: "portfolio-universe",
  storageBucket: "portfolio-universe.firebasestorage.app",
  messagingSenderId: "893366203418",
  appId: "1:893366203418:web:13b69c585c49a443268da3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const urlToKey = (url) => {
  try {
    return btoa(encodeURIComponent(url)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  } catch (e) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
      hash |= 0;
    }
    return `hash_${Math.abs(hash)}`;
  }
};

async function fetchReadme() {
  const response = await fetch(README_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch README.md: ${response.statusText}`);
  }
  return await response.text();
}

function parseMarkdownList(markdown) {
  const lines = markdown.split('\n');
  const portfolios = [];
  const linkRegex = /^\s*-\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;

  for (const line of lines) {
    const match = line.match(linkRegex);
    if (match) {
      const nameRaw = match[1].trim();
      const url = match[2].trim();
      const name = nameRaw.replace(/[*_~`]/g, '');
      portfolios.push({ name, url });
    }
  }
  return portfolios;
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (err) {
    return false;
  }
}

async function run() {
  try {
    console.log('Fetching README.md...');
    const markdown = await fetchReadme();
    
    console.log('Parsing markdown...');
    const extractedData = parseMarkdownList(markdown);
    
    const cleanedData = extractedData
      .filter(item => isValidUrl(item.url))
      .map(item => ({
        name: item.name,
        url: item.url,
        screenshot: `https://s0.wp.com/mshots/v1/${encodeURIComponent(item.url)}?w=600`
      }));

    const uniqueMap = new Map();
    cleanedData.forEach(item => uniqueMap.set(item.url, item));

    const finalData = Array.from(uniqueMap.values());
    console.log(`Found ${finalData.length} valid portfolios from GitHub.`);

    const portfoliosRef = collection(db, 'portfolios');
    let successCount = 0;

    for (const p of finalData) {
      const key = urlToKey(p.url);
      try {
        await setDoc(doc(portfoliosRef, key), {
          name: p.name,
          url: p.url,
          screenshot: p.screenshot
        }, { merge: true });
        successCount++;
        process.stdout.write(`\rUpserted ${successCount}/${finalData.length}...`);
      } catch (e) {
        console.error(`\nFailed to sync ${p.url}:`, e.message);
      }
    }
    
    console.log(`\nSuccessfully synced ${successCount} portfolios to Firestore.`);
    process.exit(0);
  } catch (error) {
    console.error('Error during data update:', error);
    process.exit(1);
  }
}

run();
