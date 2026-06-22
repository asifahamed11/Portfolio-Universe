import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');
const CONCURRENCY = 5;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[Rate limited] Waiting 5s before retry ${i + 1}/${maxRetries}`);
          await delay(5000);
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await delay(2000 * (i + 1));
    }
  }
}

async function resolveScreenshots() {
  console.log('Reading portfolios.json...');
  const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf-8'));
  let updatedCount = 0;
  let failedCount = 0;

  // Find portfolios that need resolving (either no screenshot, or using the dynamic microlink api url)
  const toResolve = data.filter(p => !p.screenshot || p.screenshot.includes('api.microlink.io/?url='));
  console.log(`Found ${toResolve.length} portfolios that need screenshot resolution.`);

  for (let i = 0; i < toResolve.length; i += CONCURRENCY) {
    const batch = toResolve.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (portfolio) => {
      console.log(`Resolving screenshot for: ${portfolio.url}`);
      try {
        const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(portfolio.url)}&screenshot=true&meta=false`;
        const res = await fetchWithRetry(apiUrl);
        if (res.status === 'success' && res.data && res.data.screenshot && res.data.screenshot.url) {
          portfolio.screenshot = res.data.screenshot.url;
          updatedCount++;
          console.log(`[OK] ${portfolio.url} -> ${portfolio.screenshot}`);
        } else {
          console.log(`[SKIPPED] No screenshot in response for ${portfolio.url}`);
          failedCount++;
        }
      } catch (err) {
        console.error(`[ERROR] Failed to resolve ${portfolio.url}: ${err.message}`);
        failedCount++;
      }
    });

    await Promise.all(promises);
    
    // Save periodically
    if ((i + CONCURRENCY) % 50 === 0) {
      console.log(`Saving progress... (${i + CONCURRENCY} / ${toResolve.length})`);
      await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }
    
    // Slight delay between batches to respect rate limits
    await delay(1000);
  }

  // Final save
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\nResolution complete. Successfully updated: ${updatedCount}, Failed: ${failedCount}`);
}

resolveScreenshots().catch(console.error);
